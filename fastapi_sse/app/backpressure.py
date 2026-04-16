"""
Backpressure Handler for SSE Connections.

Features:
- Track write buffer per SSE connection
- Max buffer size from SSE_MAX_BUFFER_SIZE env var (default 100 events)
- Write timeout detection
- Close connection and emit error event if client is slow
- Metrics for slow client detection
"""
import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, AsyncIterator
from collections import deque
from contextlib import asynccontextmanager
import structlog

from .config import get_settings

logger = structlog.get_logger(__name__)


@dataclass
class BufferMetrics:
    """Metrics for a single connection buffer."""
    connection_id: str
    created_at: float = field(default_factory=time.time)
    events_queued: int = 0
    events_sent: int = 0
    events_dropped: int = 0
    slow_client_warnings: int = 0
    buffer_overflows: int = 0
    write_timeouts: int = 0
    last_activity: float = field(default_factory=time.time)
    peak_buffer_size: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "connection_id": self.connection_id,
            "created_at": self.created_at,
            "events_queued": self.events_queued,
            "events_sent": self.events_sent,
            "events_dropped": self.events_dropped,
            "slow_client_warnings": self.slow_client_warnings,
            "buffer_overflows": self.buffer_overflows,
            "write_timeouts": self.write_timeouts,
            "last_activity": self.last_activity,
            "peak_buffer_size": self.peak_buffer_size,
            "uptime_seconds": time.time() - self.created_at
        }


@dataclass
class SSEEvent:
    """SSE event with metadata."""
    event_type: str
    data: str
    event_id: Optional[str] = None
    retry: Optional[int] = None
    timestamp: float = field(default_factory=time.time)
    
    def format(self) -> str:
        """Format as SSE message."""
        lines = []
        if self.event_id:
            lines.append(f"id: {self.event_id}")
        if self.event_type:
            lines.append(f"event: {self.event_type}")
        if self.retry is not None:
            lines.append(f"retry: {self.retry}")
        for line in self.data.split("\n"):
            lines.append(f"data: {line}")
        lines.append("")
        return "\n".join(lines) + "\n"


class BackpressureBuffer:
    """
    Manages write buffer for a single SSE connection with backpressure handling.
    
    Features:
    - Bounded buffer with configurable max size
    - Write timeout detection
    - Slow client metrics
    - Graceful connection closure
    """
    
    def __init__(
        self,
        connection_id: str,
        max_buffer_size: Optional[int] = None,
        write_timeout: float = 5.0,
        slow_threshold_percent: float = 80.0
    ):
        settings = get_settings()
        
        self.connection_id = connection_id
        self.max_buffer_size = max_buffer_size or settings.sse_max_queue_size
        self.write_timeout = write_timeout
        self.slow_threshold = int(self.max_buffer_size * slow_threshold_percent / 100)
        
        self._buffer: deque[SSEEvent] = deque(maxlen=self.max_buffer_size)
        self._event = asyncio.Event()
        self._closed = False
        self._error: Optional[str] = None
        
        self.metrics = BufferMetrics(connection_id=connection_id)
        
        logger.debug(
            "backpressure_buffer_created",
            connection_id=connection_id,
            max_size=self.max_buffer_size
        )
    
    @property
    def is_closed(self) -> bool:
        """Check if buffer is closed."""
        return self._closed
    
    @property
    def buffer_size(self) -> int:
        """Current buffer size."""
        return len(self._buffer)
    
    @property
    def is_slow_client(self) -> bool:
        """Check if client is considered slow."""
        return len(self._buffer) >= self.slow_threshold
    
    def push(self, event: SSEEvent) -> bool:
        """
        Push event to buffer.
        
        Returns:
            True if event was added, False if buffer is full or closed
        """
        if self._closed:
            return False
        
        if len(self._buffer) >= self.max_buffer_size:
            self.metrics.events_dropped += 1
            self.metrics.buffer_overflows += 1
            
            logger.warning(
                "buffer_overflow",
                connection_id=self.connection_id,
                dropped=self.metrics.events_dropped,
                buffer_size=len(self._buffer)
            )
            
            if self.metrics.buffer_overflows >= 3:
                self._error = "Client too slow - buffer overflow"
                self.close()
            
            return False
        
        self._buffer.append(event)
        self.metrics.events_queued += 1
        self.metrics.last_activity = time.time()
        
        if len(self._buffer) > self.metrics.peak_buffer_size:
            self.metrics.peak_buffer_size = len(self._buffer)
        
        if self.is_slow_client:
            self.metrics.slow_client_warnings += 1
            logger.debug(
                "slow_client_detected",
                connection_id=self.connection_id,
                buffer_size=len(self._buffer),
                threshold=self.slow_threshold
            )
        
        self._event.set()
        return True
    
    async def pop(self, timeout: Optional[float] = None) -> Optional[SSEEvent]:
        """
        Pop event from buffer with timeout.
        
        Returns:
            SSEEvent if available, None if closed or timeout
        """
        timeout = timeout or self.write_timeout
        
        while not self._buffer:
            if self._closed:
                return None
            
            self._event.clear()
            
            try:
                await asyncio.wait_for(self._event.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                if self._closed:
                    return None
                continue
        
        if self._buffer:
            event = self._buffer.popleft()
            self.metrics.events_sent += 1
            return event
        
        return None
    
    async def iter_events(self) -> AsyncIterator[str]:
        """
        Iterate over formatted SSE events.
        
        Yields SSE-formatted strings until buffer is closed.
        """
        while not self._closed:
            event = await self.pop()
            
            if event is None:
                if self._error:
                    error_event = SSEEvent(
                        event_type="error",
                        data=f'{{"message": "{self._error}"}}'
                    )
                    yield error_event.format()
                break
            
            yield event.format()
    
    def close(self, error: Optional[str] = None) -> None:
        """Close the buffer."""
        if self._closed:
            return
        
        self._closed = True
        self._error = error
        self._event.set()
        
        logger.info(
            "backpressure_buffer_closed",
            connection_id=self.connection_id,
            error=error,
            metrics=self.metrics.to_dict()
        )


class BackpressureManager:
    """
    Manages backpressure buffers for all SSE connections.
    
    Provides:
    - Connection tracking
    - Aggregate metrics
    - Cleanup of stale connections
    """
    
    def __init__(self):
        self._buffers: Dict[str, BackpressureBuffer] = {}
        self._lock = asyncio.Lock()
        
        self.total_connections = 0
        self.total_events = 0
        self.total_dropped = 0
        self.slow_clients = 0
    
    async def create_buffer(
        self,
        connection_id: str,
        max_buffer_size: Optional[int] = None
    ) -> BackpressureBuffer:
        """Create and register a new buffer."""
        async with self._lock:
            if connection_id in self._buffers:
                await self.remove_buffer(connection_id)
            
            buffer = BackpressureBuffer(
                connection_id=connection_id,
                max_buffer_size=max_buffer_size
            )
            
            self._buffers[connection_id] = buffer
            self.total_connections += 1
            
            return buffer
    
    async def remove_buffer(self, connection_id: str) -> None:
        """Remove and cleanup a buffer."""
        async with self._lock:
            buffer = self._buffers.pop(connection_id, None)
            
            if buffer:
                self.total_events += buffer.metrics.events_sent
                self.total_dropped += buffer.metrics.events_dropped
                
                if buffer.metrics.slow_client_warnings > 0:
                    self.slow_clients += 1
                
                buffer.close()
    
    def get_buffer(self, connection_id: str) -> Optional[BackpressureBuffer]:
        """Get buffer by connection ID."""
        return self._buffers.get(connection_id)
    
    @asynccontextmanager
    async def managed_buffer(
        self,
        connection_id: str,
        max_buffer_size: Optional[int] = None
    ) -> AsyncIterator[BackpressureBuffer]:
        """Context manager for automatic buffer lifecycle."""
        buffer = await self.create_buffer(connection_id, max_buffer_size)
        try:
            yield buffer
        finally:
            await self.remove_buffer(connection_id)
    
    async def cleanup_stale(self, max_idle_seconds: float = 300.0) -> int:
        """Remove stale buffers that haven't had activity."""
        now = time.time()
        stale_ids = []
        
        async with self._lock:
            for conn_id, buffer in self._buffers.items():
                idle_time = now - buffer.metrics.last_activity
                if idle_time > max_idle_seconds:
                    stale_ids.append(conn_id)
        
        for conn_id in stale_ids:
            await self.remove_buffer(conn_id)
            logger.info("stale_buffer_removed", connection_id=conn_id)
        
        return len(stale_ids)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get aggregate metrics."""
        active_buffers = len(self._buffers)
        current_slow_clients = sum(
            1 for b in self._buffers.values() if b.is_slow_client
        )
        
        total_buffer_size = sum(
            b.buffer_size for b in self._buffers.values()
        )
        
        return {
            "active_connections": active_buffers,
            "total_connections": self.total_connections,
            "total_events_sent": self.total_events + sum(
                b.metrics.events_sent for b in self._buffers.values()
            ),
            "total_events_dropped": self.total_dropped + sum(
                b.metrics.events_dropped for b in self._buffers.values()
            ),
            "current_slow_clients": current_slow_clients,
            "total_slow_clients": self.slow_clients,
            "total_buffer_size": total_buffer_size,
            "connections": {
                conn_id: buffer.metrics.to_dict()
                for conn_id, buffer in self._buffers.items()
            }
        }


backpressure_manager = BackpressureManager()


def get_backpressure_manager() -> BackpressureManager:
    """Get global backpressure manager instance."""
    return backpressure_manager
