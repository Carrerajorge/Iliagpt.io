"""SSE streaming with backpressure and timeout handling."""
import asyncio
import json
import time
from typing import AsyncIterator, Optional
from fastapi import Request
from fastapi.responses import StreamingResponse
import structlog

from .redis_client import get_event_subscriber, get_session_manager
from .config import get_settings

logger = structlog.get_logger(__name__)


class SSEConnection:
    """Manages a single SSE connection with backpressure detection."""
    
    def __init__(
        self,
        session_id: str,
        request: Request,
        timeout: Optional[float] = None,
        max_queue_size: Optional[int] = None
    ):
        self.session_id = session_id
        self.request = request
        self.settings = get_settings()
        self.timeout = timeout or self.settings.sse_client_timeout
        self.max_queue_size = max_queue_size or self.settings.sse_max_queue_size
        self.start_time = time.time()
        self.events_sent = 0
        self.last_event_time = time.time()
        self._closed = False
        self._should_terminate = False
    
    def format_sse(
        self,
        event: str,
        data: dict,
        event_id: Optional[str] = None,
        retry: Optional[int] = None
    ) -> str:
        """Format data as SSE message."""
        lines = []
        if event_id:
            lines.append(f"id: {event_id}")
        if retry:
            lines.append(f"retry: {retry}")
        lines.append(f"event: {event}")
        lines.append(f"data: {json.dumps(data)}")
        lines.append("")
        lines.append("")
        return "\n".join(lines)
    
    async def is_client_connected(self) -> bool:
        """Check if client is still connected."""
        if self._closed or self._should_terminate:
            return False
        return not await self.request.is_disconnected()
    
    def check_timeout(self) -> bool:
        """Check if connection has exceeded timeout."""
        elapsed = time.time() - self.start_time
        if elapsed > self.timeout:
            logger.warning(
                "connection_timeout",
                session_id=self.session_id,
                elapsed=elapsed,
                timeout=self.timeout
            )
            return True
        return False
    
    async def try_send(self, event: str, data: dict, event_id: Optional[str] = None) -> tuple[bool, str]:
        """
        Try to send an event with backpressure detection.
        Returns (success, formatted_message).
        If client is slow (backpressure), returns (False, "") to signal termination.
        """
        if not await self.is_client_connected():
            logger.info("client_disconnected", session_id=self.session_id)
            return False, ""
        
        if self.check_timeout():
            return False, ""
        
        formatted = self.format_sse(event, data, event_id)
        self.events_sent += 1
        self.last_event_time = time.time()
        
        return True, formatted
    
    def mark_for_termination(self, reason: str) -> None:
        """Mark connection for termination due to backpressure or other issues."""
        logger.warning(
            "connection_terminated",
            session_id=self.session_id,
            reason=reason,
            events_sent=self.events_sent
        )
        self._should_terminate = True
    
    async def close(self) -> None:
        """Close the connection."""
        self._closed = True
        logger.info(
            "sse_connection_closed",
            session_id=self.session_id,
            events_sent=self.events_sent,
            duration=time.time() - self.start_time
        )


async def stream_events_with_backpressure(
    session_id: str,
    request: Request
) -> AsyncIterator[str]:
    """
    Stream events from Redis Pub/Sub to SSE client with proper backpressure handling.
    
    Uses a bounded queue to detect slow consumers. If the queue fills up
    (client not reading fast enough), the connection is terminated.
    """
    settings = get_settings()
    subscriber = get_event_subscriber()
    session_manager = get_session_manager()
    
    connection = SSEConnection(session_id, request)
    event_queue: asyncio.Queue = asyncio.Queue(maxsize=settings.sse_max_queue_size)
    producer_done = asyncio.Event()
    backpressure_detected = asyncio.Event()
    
    async def producer():
        """Fetch events from Redis and put them in the queue."""
        try:
            async for event in subscriber.iter_events(session_id):
                if backpressure_detected.is_set():
                    break
                
                if connection._closed or connection._should_terminate:
                    break
                
                try:
                    await asyncio.wait_for(
                        event_queue.put(event),
                        timeout=2.0
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "backpressure_queue_full",
                        session_id=session_id,
                        queue_size=event_queue.qsize()
                    )
                    backpressure_detected.set()
                    connection.mark_for_termination("backpressure_queue_full")
                    break
                
                event_type = event.get("type")
                if event_type in ("final", "error"):
                    break
        finally:
            producer_done.set()
    
    producer_task = asyncio.create_task(producer())
    
    try:
        success, msg = await connection.try_send("connected", {"session_id": session_id})
        if success:
            yield msg
        
        while not connection._should_terminate:
            if await request.is_disconnected():
                break
            
            if connection.check_timeout():
                connection.mark_for_termination("timeout")
                break
            
            try:
                event = await asyncio.wait_for(
                    event_queue.get(),
                    timeout=settings.sse_heartbeat_interval
                )
            except asyncio.TimeoutError:
                if producer_done.is_set() and event_queue.empty():
                    break
                success, msg = await connection.try_send("heartbeat", {"ts": time.time()})
                if success:
                    yield msg
                else:
                    break
                continue
            
            event_type = event.get("type", "unknown")
            event_data = event.get("data", {})
            
            success, msg = await connection.try_send(
                event_type,
                event_data,
                event_id=event_data.get("event_id")
            )
            
            if not success:
                connection.mark_for_termination("send_failed")
                break
            
            yield msg
            
            if event_type in ("final", "error"):
                break
            
            await session_manager.touch(session_id)
    
    except asyncio.CancelledError:
        logger.info("stream_cancelled", session_id=session_id)
    except Exception as e:
        logger.exception("stream_error", session_id=session_id, error=str(e))
        success, msg = await connection.try_send("error", {"message": str(e)})
        if success:
            yield msg
    finally:
        producer_task.cancel()
        try:
            await producer_task
        except asyncio.CancelledError:
            pass
        await connection.close()


def create_sse_response(
    session_id: str,
    request: Request
) -> StreamingResponse:
    """Create SSE streaming response with backpressure handling."""
    return StreamingResponse(
        stream_events_with_backpressure(session_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )
