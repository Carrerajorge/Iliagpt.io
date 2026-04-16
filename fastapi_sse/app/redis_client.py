"""Redis client with connection pooling for state and pub/sub."""
import asyncio
import redis.asyncio as aioredis
from redis.asyncio import ConnectionPool, Redis
from typing import Optional, AsyncIterator, Any
import json
import structlog
from contextlib import asynccontextmanager

from .config import get_settings

logger = structlog.get_logger(__name__)


class RedisManager:
    """Manages Redis connections for state and pub/sub operations."""
    
    _instance: Optional["RedisManager"] = None
    _pool: Optional[ConnectionPool] = None
    _pubsub_pool: Optional[ConnectionPool] = None
    
    def __new__(cls) -> "RedisManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    async def initialize(self) -> None:
        """Initialize connection pools."""
        settings = get_settings()
        
        self._pool = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=settings.redis_max_connections,
            socket_timeout=settings.redis_socket_timeout,
            decode_responses=True
        )
        
        self._pubsub_pool = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=settings.redis_max_connections // 2,
            socket_timeout=settings.redis_socket_timeout,
            decode_responses=True
        )
        
        client = await self.get_client()
        await client.ping()
        logger.info("redis_initialized", url=settings.redis_url)
    
    async def close(self) -> None:
        """Close connection pools."""
        if self._pool:
            await self._pool.disconnect()
        if self._pubsub_pool:
            await self._pubsub_pool.disconnect()
        logger.info("redis_closed")
    
    async def get_client(self) -> Redis:
        """Get a Redis client from the pool."""
        if not self._pool:
            raise RuntimeError("Redis not initialized")
        return Redis(connection_pool=self._pool)
    
    async def get_pubsub_client(self) -> Redis:
        """Get a Redis client for pub/sub from dedicated pool."""
        if not self._pubsub_pool:
            raise RuntimeError("Redis not initialized")
        return Redis(connection_pool=self._pubsub_pool)


class SessionManager:
    """Manages session state in Redis."""
    
    SESSION_PREFIX = "session:"
    
    def __init__(self, redis_manager: RedisManager):
        self.redis = redis_manager
        self.settings = get_settings()
    
    def _key(self, session_id: str) -> str:
        return f"{self.SESSION_PREFIX}{session_id}"
    
    async def get(self, session_id: str) -> Optional[dict]:
        """Get session state."""
        client = await self.redis.get_client()
        data = await client.get(self._key(session_id))
        if data:
            return json.loads(data)
        return None
    
    async def set(self, session_id: str, state: dict) -> None:
        """Set session state with TTL."""
        client = await self.redis.get_client()
        await client.setex(
            self._key(session_id),
            self.settings.session_ttl_seconds,
            json.dumps(state)
        )
    
    async def update(self, session_id: str, updates: dict) -> dict:
        """Update session state atomically."""
        state = await self.get(session_id) or {}
        state.update(updates)
        await self.set(session_id, state)
        return state
    
    async def delete(self, session_id: str) -> None:
        """Delete session."""
        client = await self.redis.get_client()
        await client.delete(self._key(session_id))
    
    async def exists(self, session_id: str) -> bool:
        """Check if session exists."""
        client = await self.redis.get_client()
        return await client.exists(self._key(session_id)) > 0
    
    async def touch(self, session_id: str) -> None:
        """Refresh session TTL."""
        client = await self.redis.get_client()
        await client.expire(
            self._key(session_id),
            self.settings.session_ttl_seconds
        )


class EventPublisher:
    """Publishes events to Redis Pub/Sub channels."""
    
    CHANNEL_PREFIX = "events:"
    
    def __init__(self, redis_manager: RedisManager):
        self.redis = redis_manager
    
    def _channel(self, session_id: str) -> str:
        return f"{self.CHANNEL_PREFIX}{session_id}"
    
    async def publish(self, session_id: str, event_type: str, data: Any) -> int:
        """Publish event to session channel."""
        client = await self.redis.get_client()
        message = json.dumps({
            "type": event_type,
            "data": data
        })
        return await client.publish(self._channel(session_id), message)
    
    async def publish_trace(self, session_id: str, trace_data: dict) -> int:
        """Publish trace event."""
        return await self.publish(session_id, "trace", trace_data)
    
    async def publish_final(self, session_id: str, result: Any) -> int:
        """Publish final result event."""
        return await self.publish(session_id, "final", result)
    
    async def publish_error(self, session_id: str, error: str) -> int:
        """Publish error event."""
        return await self.publish(session_id, "error", {"message": error})


class EventSubscriber:
    """Subscribes to Redis Pub/Sub channels for SSE fan-out."""
    
    CHANNEL_PREFIX = "events:"
    
    def __init__(self, redis_manager: RedisManager):
        self.redis = redis_manager
        self.settings = get_settings()
    
    def _channel(self, session_id: str) -> str:
        return f"{self.CHANNEL_PREFIX}{session_id}"
    
    @asynccontextmanager
    async def subscribe(self, session_id: str) -> AsyncIterator[aioredis.client.PubSub]:
        """Subscribe to session events channel."""
        client = await self.redis.get_pubsub_client()
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(self._channel(session_id))
            yield pubsub
        finally:
            await pubsub.unsubscribe(self._channel(session_id))
            await pubsub.close()
    
    async def iter_events(
        self,
        session_id: str,
        timeout: Optional[float] = None
    ) -> AsyncIterator[dict]:
        """Iterate over events from the channel."""
        timeout = timeout or self.settings.sse_client_timeout
        
        async with self.subscribe(session_id) as pubsub:
            while True:
                try:
                    message = await asyncio.wait_for(
                        pubsub.get_message(ignore_subscribe_messages=True),
                        timeout=self.settings.sse_heartbeat_interval
                    )
                    
                    if message and message.get("type") == "message":
                        data = message.get("data")
                        if data:
                            yield json.loads(data)
                except asyncio.TimeoutError:
                    yield {"type": "heartbeat", "data": {}}


redis_manager = RedisManager()


def get_redis_manager() -> RedisManager:
    return redis_manager


def get_session_manager() -> SessionManager:
    return SessionManager(redis_manager)


def get_event_publisher() -> EventPublisher:
    return EventPublisher(redis_manager)


def get_event_subscriber() -> EventSubscriber:
    return EventSubscriber(redis_manager)
