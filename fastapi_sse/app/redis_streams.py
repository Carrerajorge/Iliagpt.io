"""Redis Streams manager for reliable event delivery with consumer groups."""
import asyncio
import json
import time
import uuid
from typing import Optional, Any, AsyncIterator, List, Dict
from dataclasses import dataclass
import structlog

from .config import get_settings
from .redis_client import redis_manager

logger = structlog.get_logger(__name__)


@dataclass
class StreamEvent:
    """Represents an event from Redis Stream."""
    event_id: str
    event_type: str
    data: dict
    timestamp: float


class RedisStreamsManager:
    """
    Manages Redis Streams operations for event delivery.
    
    Uses consumer groups for reliable delivery with:
    - XADD for publishing events
    - XREADGROUP for consuming with acknowledgment
    - XACK for confirming delivery
    - XCLAIM for recovering pending messages
    - Deduplication via delivered event IDs stored in Redis SET
    """
    
    STREAM_PREFIX = "stream:"
    GROUP_PREFIX = "group:"
    CONSUMER_PREFIX = "consumer:"
    DELIVERED_PREFIX = "delivered:"
    
    def __init__(self):
        self.settings = get_settings()
    
    def _stream_key(self, session_id: str) -> str:
        """Get Redis key for session stream."""
        return f"{self.STREAM_PREFIX}{session_id}"
    
    def _group_name(self, session_id: str) -> str:
        """Get consumer group name for session."""
        return f"{self.GROUP_PREFIX}{session_id}"
    
    def _delivered_key(self, session_id: str) -> str:
        """Get Redis key for delivered event IDs set."""
        return f"{self.DELIVERED_PREFIX}{session_id}"
    
    async def ensure_consumer_group(
        self,
        session_id: str,
        consumer_name: Optional[str] = None
    ) -> str:
        """
        Create consumer group for session if not exists.
        
        Args:
            session_id: Session identifier
            consumer_name: Optional consumer name, auto-generated if not provided
            
        Returns:
            Consumer name for this connection
        """
        client = await redis_manager.get_client()
        stream_key = self._stream_key(session_id)
        group_name = self._group_name(session_id)
        consumer = consumer_name or f"{self.CONSUMER_PREFIX}{uuid.uuid4().hex[:8]}"
        
        try:
            await client.xgroup_create(
                stream_key,
                group_name,
                id="0",
                mkstream=True
            )
            logger.info(
                "consumer_group_created",
                session_id=session_id,
                group=group_name
            )
        except Exception as e:
            if "BUSYGROUP" in str(e):
                logger.debug(
                    "consumer_group_exists",
                    session_id=session_id,
                    group=group_name
                )
            else:
                raise
        
        return consumer
    
    async def add_event(
        self,
        session_id: str,
        event_type: str,
        data: Any,
        event_id: Optional[str] = None,
        maxlen: int = 1000
    ) -> str:
        """
        Add event to session stream with auto-generated ID.
        
        Args:
            session_id: Session identifier
            event_type: Event type (trace, tool_call, tool_result, final, error)
            data: Event data payload
            event_id: Optional custom event ID for deduplication
            maxlen: Maximum stream length (approximate)
            
        Returns:
            Redis stream entry ID
        """
        client = await redis_manager.get_client()
        stream_key = self._stream_key(session_id)
        
        payload = {
            "type": event_type,
            "event_id": event_id or str(uuid.uuid4()),
            "data": json.dumps(data) if not isinstance(data, str) else data,
            "timestamp": str(time.time())
        }
        
        entry_id = await client.xadd(
            stream_key,
            payload,
            maxlen=maxlen,
            approximate=True
        )
        
        logger.debug(
            "event_added",
            session_id=session_id,
            event_type=event_type,
            entry_id=entry_id
        )
        
        return entry_id
    
    async def read_events(
        self,
        session_id: str,
        consumer_name: str,
        count: int = 10,
        block_ms: Optional[int] = None,
        start_id: str = ">"
    ) -> List[StreamEvent]:
        """
        Read events from stream using consumer group.
        
        Args:
            session_id: Session identifier
            consumer_name: Consumer name within the group
            count: Maximum events to read
            block_ms: Block timeout in milliseconds (None = no block)
            start_id: Starting ID (">" for new messages, "0" for pending)
            
        Returns:
            List of StreamEvent objects
        """
        client = await redis_manager.get_client()
        stream_key = self._stream_key(session_id)
        group_name = self._group_name(session_id)
        block = block_ms if block_ms is not None else self.settings.stream_block_timeout_ms
        
        try:
            results = await client.xreadgroup(
                groupname=group_name,
                consumername=consumer_name,
                streams={stream_key: start_id},
                count=count,
                block=block
            )
        except Exception as e:
            if "NOGROUP" in str(e):
                await self.ensure_consumer_group(session_id, consumer_name)
                return []
            raise
        
        events = []
        if results:
            for stream_name, messages in results:
                for msg_id, fields in messages:
                    try:
                        data = json.loads(fields.get("data", "{}"))
                    except json.JSONDecodeError:
                        data = {"raw": fields.get("data", "")}
                    
                    events.append(StreamEvent(
                        event_id=fields.get("event_id", msg_id),
                        event_type=fields.get("type", "unknown"),
                        data=data,
                        timestamp=float(fields.get("timestamp", time.time()))
                    ))
        
        return events
    
    async def acknowledge(
        self,
        session_id: str,
        *entry_ids: str
    ) -> int:
        """
        Acknowledge events as successfully processed.
        
        Args:
            session_id: Session identifier
            entry_ids: Redis stream entry IDs to acknowledge
            
        Returns:
            Number of acknowledged entries
        """
        if not entry_ids:
            return 0
        
        client = await redis_manager.get_client()
        stream_key = self._stream_key(session_id)
        group_name = self._group_name(session_id)
        
        count = await client.xack(stream_key, group_name, *entry_ids)
        
        logger.debug(
            "events_acknowledged",
            session_id=session_id,
            count=count,
            entry_ids=entry_ids
        )
        
        return count
    
    async def get_pending_info(
        self,
        session_id: str
    ) -> Dict[str, Any]:
        """
        Get pending messages info for session stream.
        
        Returns summary of pending messages including count and consumer info.
        """
        client = await redis_manager.get_client()
        stream_key = self._stream_key(session_id)
        group_name = self._group_name(session_id)
        
        try:
            pending = await client.xpending(stream_key, group_name)
            return {
                "count": pending.get("pending", 0) if isinstance(pending, dict) else 0,
                "raw": pending
            }
        except Exception as e:
            if "NOGROUP" in str(e):
                return {"count": 0, "raw": None}
            raise
    
    async def claim_pending(
        self,
        session_id: str,
        consumer_name: str,
        min_idle_ms: Optional[int] = None,
        count: int = 10
    ) -> List[StreamEvent]:
        """
        Claim pending messages that have been idle too long.
        
        Used for recovery when a consumer dies without acknowledging.
        
        Args:
            session_id: Session identifier
            consumer_name: Consumer name to claim messages for
            min_idle_ms: Minimum idle time before claiming
            count: Maximum messages to claim
            
        Returns:
            List of claimed StreamEvent objects
        """
        client = await redis_manager.get_client()
        stream_key = self._stream_key(session_id)
        group_name = self._group_name(session_id)
        min_idle = min_idle_ms or self.settings.stream_max_pending_claim_age_ms
        
        try:
            pending_range = await client.xpending_range(
                stream_key,
                group_name,
                min="-",
                max="+",
                count=count
            )
        except Exception as e:
            if "NOGROUP" in str(e):
                return []
            raise
        
        if not pending_range:
            return []
        
        claim_ids = []
        for entry in pending_range:
            entry_id = entry.get("message_id") or entry.get("entry_id") or (entry[0] if isinstance(entry, tuple) else None)
            idle_time = entry.get("time_since_delivered", 0) if isinstance(entry, dict) else 0
            
            if entry_id and idle_time >= min_idle:
                claim_ids.append(entry_id)
        
        if not claim_ids:
            return []
        
        claimed = await client.xclaim(
            stream_key,
            group_name,
            consumer_name,
            min_idle_time=min_idle,
            message_ids=claim_ids
        )
        
        events = []
        for msg_id, fields in claimed:
            if fields:
                try:
                    data = json.loads(fields.get("data", "{}"))
                except json.JSONDecodeError:
                    data = {"raw": fields.get("data", "")}
                
                events.append(StreamEvent(
                    event_id=fields.get("event_id", msg_id),
                    event_type=fields.get("type", "unknown"),
                    data=data,
                    timestamp=float(fields.get("timestamp", time.time()))
                ))
        
        logger.info(
            "pending_claimed",
            session_id=session_id,
            claimed_count=len(events)
        )
        
        return events
    
    async def mark_delivered(
        self,
        session_id: str,
        event_id: str
    ) -> bool:
        """
        Mark event as delivered for deduplication.
        
        Args:
            session_id: Session identifier
            event_id: Event ID to mark
            
        Returns:
            True if newly added, False if already existed
        """
        client = await redis_manager.get_client()
        delivered_key = self._delivered_key(session_id)
        
        added = await client.sadd(delivered_key, event_id)
        await client.expire(delivered_key, self.settings.session_ttl_seconds)
        
        return added == 1
    
    async def is_delivered(
        self,
        session_id: str,
        event_id: str
    ) -> bool:
        """
        Check if event was already delivered.
        
        Args:
            session_id: Session identifier
            event_id: Event ID to check
            
        Returns:
            True if already delivered
        """
        client = await redis_manager.get_client()
        delivered_key = self._delivered_key(session_id)
        
        return await client.sismember(delivered_key, event_id)
    
    async def iter_events(
        self,
        session_id: str,
        consumer_name: str,
        last_event_id: Optional[str] = None
    ) -> AsyncIterator[StreamEvent]:
        """
        Iterate over stream events with automatic acknowledgment.
        
        Handles pending message recovery, deduplication, and heartbeats.
        
        Args:
            session_id: Session identifier
            consumer_name: Consumer name for this connection
            last_event_id: Last event ID for replay (from Last-Event-ID header)
            
        Yields:
            StreamEvent objects as they become available
        """
        await self.ensure_consumer_group(session_id, consumer_name)
        
        claimed = await self.claim_pending(session_id, consumer_name)
        for event in claimed:
            if not await self.is_delivered(session_id, event.event_id):
                await self.mark_delivered(session_id, event.event_id)
                yield event
        
        start_id = ">"
        
        while True:
            events = await self.read_events(
                session_id,
                consumer_name,
                count=10,
                start_id=start_id
            )
            
            if not events:
                yield StreamEvent(
                    event_id="",
                    event_type="heartbeat",
                    data={"ts": time.time()},
                    timestamp=time.time()
                )
                continue
            
            for event in events:
                if await self.is_delivered(session_id, event.event_id):
                    continue
                
                await self.mark_delivered(session_id, event.event_id)
                yield event
                
                if event.event_type in ("final", "error"):
                    return
    
    async def cleanup_stream(self, session_id: str) -> None:
        """Clean up stream and related keys for a session."""
        client = await redis_manager.get_client()
        
        stream_key = self._stream_key(session_id)
        delivered_key = self._delivered_key(session_id)
        
        await client.delete(stream_key, delivered_key)
        
        logger.info("stream_cleaned", session_id=session_id)


streams_manager = RedisStreamsManager()


def get_streams_manager() -> RedisStreamsManager:
    """Get Redis Streams manager instance."""
    return streams_manager
