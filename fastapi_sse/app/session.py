"""Session management with Redis hash storage and distributed locks."""
import asyncio
import json
import time
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
from dataclasses import dataclass, field, asdict
import structlog

from .config import get_settings
from .redis_client import redis_manager

logger = structlog.get_logger(__name__)


@dataclass
class SessionData:
    """Session state stored in Redis hash."""
    status: str = "idle"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    last_activity: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    prompt: str = ""
    user_id: Optional[str] = None
    task_id: Optional[str] = None
    message_count: int = 0
    context: str = "{}"
    
    def to_hash(self) -> Dict[str, str]:
        """Convert to Redis hash-compatible dict."""
        return {k: str(v) if v is not None else "" for k, v in asdict(self).items()}
    
    @classmethod
    def from_hash(cls, data: Dict[str, str]) -> "SessionData":
        """Create from Redis hash dict."""
        return cls(
            status=data.get("status", "idle"),
            created_at=data.get("created_at", datetime.utcnow().isoformat()),
            last_activity=data.get("last_activity", datetime.utcnow().isoformat()),
            prompt=data.get("prompt", ""),
            user_id=data.get("user_id") or None,
            task_id=data.get("task_id") or None,
            message_count=int(data.get("message_count", "0")),
            context=data.get("context", "{}")
        )


class DistributedLock:
    """Redis-based distributed lock using SETNX with TTL."""
    
    LOCK_PREFIX = "lock:"
    
    def __init__(self, redis_mgr, lock_name: str, ttl_seconds: int = 30):
        self.redis = redis_mgr
        self.lock_key = f"{self.LOCK_PREFIX}{lock_name}"
        self.ttl = ttl_seconds
        self.lock_id = str(uuid.uuid4())
        self._acquired = False
    
    async def acquire(self, timeout: float = 10.0) -> bool:
        """
        Attempt to acquire the lock.
        
        Args:
            timeout: Maximum time to wait for lock
            
        Returns:
            True if lock acquired, False otherwise
        """
        client = await self.redis.get_client()
        start = time.time()
        
        while time.time() - start < timeout:
            acquired = await client.set(
                self.lock_key,
                self.lock_id,
                nx=True,
                ex=self.ttl
            )
            
            if acquired:
                self._acquired = True
                logger.debug("lock_acquired", key=self.lock_key)
                return True
            
            await asyncio.sleep(0.1)
        
        logger.warning(
            "lock_acquisition_timeout",
            key=self.lock_key,
            timeout=timeout
        )
        return False
    
    async def release(self) -> bool:
        """
        Release the lock if we own it.
        
        Returns:
            True if released, False if not owner
        """
        if not self._acquired:
            return False
        
        client = await self.redis.get_client()
        
        lua_script = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
        """
        
        result = await client.eval(lua_script, 1, self.lock_key, self.lock_id)
        self._acquired = False
        
        if result == 1:
            logger.debug("lock_released", key=self.lock_key)
            return True
        return False
    
    async def extend(self, additional_seconds: int = None) -> bool:
        """Extend the lock TTL if we own it."""
        if not self._acquired:
            return False
        
        client = await self.redis.get_client()
        extend_time = additional_seconds or self.ttl
        
        lua_script = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("expire", KEYS[1], ARGV[2])
        else
            return 0
        end
        """
        
        result = await client.eval(
            lua_script,
            1,
            self.lock_key,
            self.lock_id,
            str(extend_time)
        )
        
        return result == 1
    
    async def __aenter__(self):
        if not await self.acquire():
            raise RuntimeError(f"Failed to acquire lock: {self.lock_key}")
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.release()


class SessionManager:
    """
    Manages session state in Redis using hash data structure.
    
    Features:
    - Redis hash storage for session fields
    - Distributed locks for idempotent operations
    - Automatic TTL expiry
    - Last activity tracking
    """
    
    SESSION_PREFIX = "session:"
    
    def __init__(self):
        self.settings = get_settings()
        self.redis = redis_manager
    
    def _key(self, session_id: str) -> str:
        """Get Redis key for session hash."""
        return f"{self.SESSION_PREFIX}{session_id}"
    
    async def create(
        self,
        session_id: str,
        prompt: str = "",
        user_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> SessionData:
        """
        Create a new session with initial state.
        
        Args:
            session_id: Unique session identifier
            prompt: Initial prompt text
            user_id: Optional user identifier
            context: Optional context dictionary
            
        Returns:
            SessionData object
        """
        client = await self.redis.get_client()
        key = self._key(session_id)
        
        session = SessionData(
            status="idle",
            prompt=prompt,
            user_id=user_id,
            context=json.dumps(context or {})
        )
        
        await client.hset(key, mapping=session.to_hash())
        await client.expire(key, self.settings.session_ttl_seconds)
        
        logger.info(
            "session_created",
            session_id=session_id,
            user_id=user_id
        )
        
        return session
    
    async def get(self, session_id: str) -> Optional[SessionData]:
        """
        Get session state by ID.
        
        Args:
            session_id: Session identifier
            
        Returns:
            SessionData if exists, None otherwise
        """
        client = await self.redis.get_client()
        key = self._key(session_id)
        
        data = await client.hgetall(key)
        
        if not data:
            return None
        
        return SessionData.from_hash(data)
    
    async def update(
        self,
        session_id: str,
        **fields
    ) -> Optional[SessionData]:
        """
        Update session fields atomically.
        
        Args:
            session_id: Session identifier
            **fields: Fields to update
            
        Returns:
            Updated SessionData if exists, None otherwise
        """
        client = await self.redis.get_client()
        key = self._key(session_id)
        
        if not await client.exists(key):
            return None
        
        fields["last_activity"] = datetime.utcnow().isoformat()
        
        if "context" in fields and isinstance(fields["context"], dict):
            fields["context"] = json.dumps(fields["context"])
        
        update_data = {k: str(v) if v is not None else "" for k, v in fields.items()}
        await client.hset(key, mapping=update_data)
        await client.expire(key, self.settings.session_ttl_seconds)
        
        return await self.get(session_id)
    
    async def set_status(
        self,
        session_id: str,
        status: str
    ) -> bool:
        """
        Update session status.
        
        Args:
            session_id: Session identifier
            status: New status (idle, processing, completed, error)
            
        Returns:
            True if updated, False if session not found
        """
        result = await self.update(session_id, status=status)
        return result is not None
    
    async def touch(self, session_id: str) -> bool:
        """
        Update last_activity and refresh TTL.
        
        Args:
            session_id: Session identifier
            
        Returns:
            True if session exists and was touched
        """
        client = await self.redis.get_client()
        key = self._key(session_id)
        
        if not await client.exists(key):
            return False
        
        await client.hset(key, "last_activity", datetime.utcnow().isoformat())
        await client.expire(key, self.settings.session_ttl_seconds)
        
        return True
    
    async def exists(self, session_id: str) -> bool:
        """Check if session exists."""
        client = await self.redis.get_client()
        return await client.exists(self._key(session_id)) > 0
    
    async def delete(self, session_id: str) -> bool:
        """
        Delete a session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            True if deleted, False if not found
        """
        client = await self.redis.get_client()
        key = self._key(session_id)
        
        deleted = await client.delete(key)
        
        if deleted:
            logger.info("session_deleted", session_id=session_id)
        
        return deleted > 0
    
    async def increment_message_count(self, session_id: str) -> int:
        """
        Increment message count atomically.
        
        Returns:
            New message count
        """
        client = await self.redis.get_client()
        key = self._key(session_id)
        
        count = await client.hincrby(key, "message_count", 1)
        await client.expire(key, self.settings.session_ttl_seconds)
        
        return count
    
    def get_lock(
        self,
        lock_name: str,
        ttl_seconds: Optional[int] = None
    ) -> DistributedLock:
        """
        Get a distributed lock.
        
        Args:
            lock_name: Name of the lock
            ttl_seconds: Lock TTL (defaults to config value)
            
        Returns:
            DistributedLock instance
        """
        return DistributedLock(
            self.redis,
            lock_name,
            ttl_seconds or self.settings.lock_ttl_seconds
        )
    
    async def with_lock(
        self,
        session_id: str,
        operation_name: str = "default"
    ) -> DistributedLock:
        """
        Get a session-specific lock for idempotent operations.
        
        Usage:
            async with session_manager.with_lock(session_id, "process"):
                # Critical section
                pass
        """
        lock_name = f"session:{session_id}:{operation_name}"
        return self.get_lock(lock_name)


session_manager = SessionManager()


def get_session_manager() -> SessionManager:
    """Get SessionManager instance."""
    return session_manager
