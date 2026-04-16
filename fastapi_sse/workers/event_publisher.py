"""Synchronous event publisher for Celery workers using Redis Streams."""
import json
import time
import uuid
from typing import Any, Optional, Dict
from dataclasses import dataclass, field
from datetime import datetime
import redis
import structlog

from fastapi_sse.app.config import get_settings

logger = structlog.get_logger(__name__)


def generate_event_id() -> str:
    """Generate unique event ID using UUID4."""
    return str(uuid.uuid4())


@dataclass
class EventMetadata:
    """Metadata attached to each event."""
    session_id: str
    user_id: Optional[str] = None
    task_id: Optional[str] = None
    source: str = "celery_worker"
    extra: Dict[str, Any] = field(default_factory=dict)


class StreamEventPublisher:
    """
    Helper class for publishing events to Redis Streams from Celery workers.
    
    Uses XADD with maxlen for stream size limits and generates unique event_ids.
    """
    
    STREAM_PREFIX = "stream:session:"
    CANCEL_FLAG_PREFIX = "cancel:session:"
    DEFAULT_MAXLEN = 1000
    
    def __init__(
        self,
        redis_url: Optional[str] = None,
        maxlen: int = DEFAULT_MAXLEN
    ):
        """
        Initialize the event publisher.
        
        Args:
            redis_url: Redis connection URL (defaults to settings)
            maxlen: Maximum stream length for XADD
        """
        settings = get_settings()
        self._redis_url = redis_url or settings.redis_url
        self._maxlen = maxlen
        self._client: Optional[redis.Redis] = None
    
    def _get_client(self) -> redis.Redis:
        """Get or create Redis client."""
        if self._client is None:
            self._client = redis.from_url(
                self._redis_url,
                decode_responses=True
            )
        return self._client
    
    def _stream_key(self, session_id: str) -> str:
        """Get Redis stream key for session."""
        return f"{self.STREAM_PREFIX}{session_id}"
    
    def _cancel_key(self, session_id: str) -> str:
        """Get Redis key for cancellation flag."""
        return f"{self.CANCEL_FLAG_PREFIX}{session_id}"
    
    def publish(
        self,
        session_id: str,
        event_type: str,
        data: Any,
        metadata: Optional[EventMetadata] = None,
        event_id: Optional[str] = None
    ) -> str:
        """
        Publish an event to the session's Redis Stream.
        
        Args:
            session_id: Session identifier
            event_type: Event type (trace, tool_call, tool_result, final, error)
            data: Event data payload
            metadata: Optional event metadata
            event_id: Optional custom event ID
            
        Returns:
            Redis stream entry ID
        """
        client = self._get_client()
        stream_key = self._stream_key(session_id)
        
        evt_id = event_id or generate_event_id()
        timestamp = datetime.utcnow().isoformat()
        
        payload = {
            "type": event_type,
            "event_id": evt_id,
            "timestamp": timestamp,
            "data": json.dumps(data) if not isinstance(data, str) else data,
        }
        
        if metadata:
            payload["session_id"] = metadata.session_id
            if metadata.user_id:
                payload["user_id"] = metadata.user_id
            if metadata.task_id:
                payload["task_id"] = metadata.task_id
            payload["source"] = metadata.source
            if metadata.extra:
                payload["meta"] = json.dumps(metadata.extra)
        else:
            payload["session_id"] = session_id
        
        try:
            entry_id = client.xadd(
                stream_key,
                payload,
                maxlen=self._maxlen,
                approximate=True
            )
            
            logger.debug(
                "event_published",
                session_id=session_id,
                event_type=event_type,
                event_id=evt_id,
                entry_id=entry_id
            )
            
            return entry_id
            
        except redis.RedisError as e:
            logger.error(
                "event_publish_failed",
                session_id=session_id,
                event_type=event_type,
                error=str(e)
            )
            raise
    
    def publish_trace(
        self,
        session_id: str,
        thinking: str,
        metadata: Optional[EventMetadata] = None,
        stage: Optional[str] = None
    ) -> str:
        """
        Publish a trace (thinking) event.
        
        Args:
            session_id: Session identifier
            thinking: Agent's thinking/reasoning text
            metadata: Optional event metadata
            stage: Optional stage name
            
        Returns:
            Redis stream entry ID
        """
        data = {
            "thinking": thinking,
            "stage": stage,
        }
        return self.publish(session_id, "trace", data, metadata)
    
    def publish_tool_call(
        self,
        session_id: str,
        tool_name: str,
        tool_input: Any,
        metadata: Optional[EventMetadata] = None,
        call_id: Optional[str] = None
    ) -> str:
        """
        Publish a tool_call event.
        
        Args:
            session_id: Session identifier
            tool_name: Name of the tool being invoked
            tool_input: Input parameters for the tool
            metadata: Optional event metadata
            call_id: Optional tool call identifier
            
        Returns:
            Redis stream entry ID
        """
        data = {
            "tool_name": tool_name,
            "tool_input": tool_input,
            "call_id": call_id or generate_event_id(),
        }
        return self.publish(session_id, "tool_call", data, metadata)
    
    def publish_tool_result(
        self,
        session_id: str,
        tool_name: str,
        result: Any,
        metadata: Optional[EventMetadata] = None,
        call_id: Optional[str] = None,
        success: bool = True,
        duration_ms: Optional[float] = None
    ) -> str:
        """
        Publish a tool_result event.
        
        Args:
            session_id: Session identifier
            tool_name: Name of the tool
            result: Tool execution result
            metadata: Optional event metadata
            call_id: Tool call identifier
            success: Whether the tool execution succeeded
            duration_ms: Execution duration in milliseconds
            
        Returns:
            Redis stream entry ID
        """
        data = {
            "tool_name": tool_name,
            "result": result,
            "call_id": call_id,
            "success": success,
            "duration_ms": duration_ms,
        }
        return self.publish(session_id, "tool_result", data, metadata)
    
    def publish_final(
        self,
        session_id: str,
        response: str,
        metadata: Optional[EventMetadata] = None,
        total_duration_ms: Optional[float] = None,
        token_usage: Optional[Dict[str, int]] = None
    ) -> str:
        """
        Publish a final (complete response) event.
        
        Args:
            session_id: Session identifier
            response: Final agent response
            metadata: Optional event metadata
            total_duration_ms: Total execution duration
            token_usage: Optional token usage statistics
            
        Returns:
            Redis stream entry ID
        """
        data = {
            "response": response,
            "complete": True,
            "total_duration_ms": total_duration_ms,
            "token_usage": token_usage,
        }
        return self.publish(session_id, "final", data, metadata)
    
    def publish_error(
        self,
        session_id: str,
        error_message: str,
        metadata: Optional[EventMetadata] = None,
        error_type: Optional[str] = None,
        recoverable: bool = False,
        details: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Publish an error event.
        
        Args:
            session_id: Session identifier
            error_message: Error message
            metadata: Optional event metadata
            error_type: Error classification
            recoverable: Whether the error is recoverable
            details: Additional error details
            
        Returns:
            Redis stream entry ID
        """
        data = {
            "message": error_message,
            "error_type": error_type or "unknown",
            "recoverable": recoverable,
            "details": details,
        }
        return self.publish(session_id, "error", data, metadata)
    
    def is_cancelled(self, session_id: str) -> bool:
        """
        Check if the task has been cancelled.
        
        Args:
            session_id: Session identifier
            
        Returns:
            True if cancellation was requested
        """
        client = self._get_client()
        cancel_key = self._cancel_key(session_id)
        return client.exists(cancel_key) > 0
    
    def set_cancel_flag(self, session_id: str, ttl_seconds: int = 3600) -> None:
        """
        Set cancellation flag for a session.
        
        Args:
            session_id: Session identifier
            ttl_seconds: TTL for the cancellation flag
        """
        client = self._get_client()
        cancel_key = self._cancel_key(session_id)
        client.setex(cancel_key, ttl_seconds, "1")
        logger.info("cancel_flag_set", session_id=session_id)
    
    def clear_cancel_flag(self, session_id: str) -> None:
        """
        Clear cancellation flag for a session.
        
        Args:
            session_id: Session identifier
        """
        client = self._get_client()
        cancel_key = self._cancel_key(session_id)
        client.delete(cancel_key)
    
    def close(self) -> None:
        """Close the Redis connection."""
        if self._client:
            self._client.close()
            self._client = None


_publisher_instance: Optional[StreamEventPublisher] = None


def get_event_publisher() -> StreamEventPublisher:
    """Get singleton event publisher instance."""
    global _publisher_instance
    if _publisher_instance is None:
        _publisher_instance = StreamEventPublisher()
    return _publisher_instance
