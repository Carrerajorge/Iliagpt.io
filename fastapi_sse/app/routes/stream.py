"""SSE streaming endpoint with Redis Streams consumer groups and backpressure."""
import asyncio
import json
import time
import uuid
from typing import Optional, AsyncIterator
from fastapi import APIRouter, Request, Query, Header, HTTPException, Depends
from fastapi.responses import StreamingResponse
import structlog

from ..session import get_session_manager, SessionManager
from ..redis_streams import get_streams_manager, RedisStreamsManager, StreamEvent
from ..backpressure import get_backpressure_manager, BackpressureManager, BackpressureBuffer, SSEEvent
from ..config import get_settings

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["Streaming"])


class SSEFormatter:
    """Formats events for Server-Sent Events protocol."""
    
    @staticmethod
    def format(
        event: str,
        data: dict,
        event_id: Optional[str] = None,
        retry: Optional[int] = None
    ) -> str:
        """
        Format data as SSE message.
        
        Args:
            event: Event type name
            data: Event data payload (will be JSON encoded)
            event_id: Optional event ID for client replay
            retry: Optional retry interval in milliseconds
            
        Returns:
            SSE formatted string
        """
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


async def _producer_task(
    session_id: str,
    consumer_name: str,
    buffer: BackpressureBuffer,
    request: Request,
    last_event_id: Optional[str],
    session_manager: SessionManager,
    streams_manager: RedisStreamsManager
) -> None:
    """Background task that reads from Redis Streams and pushes to backpressure buffer."""
    settings = get_settings()
    start_time = time.time()
    last_activity = time.time()
    events_pushed = 0
    
    try:
        await streams_manager.ensure_consumer_group(session_id, consumer_name)
        
        async for event in streams_manager.iter_events(
            session_id,
            consumer_name,
            last_event_id=last_event_id
        ):
            if await request.is_disconnected() or buffer.is_closed:
                break
            
            elapsed = time.time() - start_time
            idle_time = time.time() - last_activity
            
            if idle_time > settings.sse_idle_timeout_sec:
                buffer.push(SSEEvent(
                    event_type="timeout",
                    data=json.dumps({"reason": "idle_timeout", "idle_seconds": idle_time})
                ))
                break
            
            if event.event_type == "heartbeat":
                buffer.push(SSEEvent(
                    event_type="heartbeat",
                    data=json.dumps({
                        "ts": time.time(),
                        "session_id": session_id,
                        "events_sent": events_pushed,
                        "elapsed_seconds": elapsed
                    })
                ))
                continue
            
            last_activity = time.time()
            
            success = buffer.push(SSEEvent(
                event_type=event.event_type,
                data=json.dumps(event.data) if isinstance(event.data, dict) else str(event.data),
                event_id=event.event_id
            ))
            
            if success:
                events_pushed += 1
                await session_manager.touch(session_id)
            
            if event.event_type in ("final", "error"):
                logger.info(
                    "producer_completed",
                    session_id=session_id,
                    event_type=event.event_type,
                    events_pushed=events_pushed
                )
                break
    
    except asyncio.CancelledError:
        logger.debug("producer_cancelled", session_id=session_id)
    except Exception as e:
        logger.exception("producer_error", session_id=session_id, error=str(e))
        buffer.push(SSEEvent(
            event_type="error",
            data=json.dumps({"message": str(e), "type": type(e).__name__})
        ))
    finally:
        buffer.close()


async def stream_events(
    session_id: str,
    request: Request,
    last_event_id: Optional[str],
    session_manager: SessionManager,
    streams_manager: RedisStreamsManager,
    backpressure_mgr: BackpressureManager
) -> AsyncIterator[str]:
    """
    Stream events from Redis Streams to SSE client with backpressure handling.
    
    Features:
    - Consumer group for reliable delivery
    - Last-Event-ID support for replay/retry
    - Heartbeat to keep connection alive
    - Idle timeout to close stale connections
    - Backpressure with bounded buffer and write timeouts
    - Slow client detection and graceful termination
    
    Args:
        session_id: Session to stream events for
        request: FastAPI request for disconnect detection
        last_event_id: Last event ID from client for replay
        session_manager: Session manager instance
        streams_manager: Redis Streams manager instance
        backpressure_mgr: Backpressure manager for buffer handling
        
    Yields:
        SSE formatted event strings
    """
    consumer_name = f"sse-{uuid.uuid4().hex[:8]}"
    connection_id = f"{session_id}:{consumer_name}"
    formatter = SSEFormatter()
    
    start_time = time.time()
    events_sent = 0
    producer: Optional[asyncio.Task] = None
    
    async with backpressure_mgr.managed_buffer(connection_id) as buffer:
        try:
            yield formatter.format("connected", {
                "session_id": session_id,
                "consumer": consumer_name,
                "timestamp": time.time(),
                "backpressure_enabled": True
            })
            events_sent += 1
            
            producer = asyncio.create_task(
                _producer_task(
                    session_id=session_id,
                    consumer_name=consumer_name,
                    buffer=buffer,
                    request=request,
                    last_event_id=last_event_id,
                    session_manager=session_manager,
                    streams_manager=streams_manager
                )
            )
            
            async for event_str in buffer.iter_events():
                if await request.is_disconnected():
                    logger.info(
                        "client_disconnected",
                        session_id=session_id,
                        events_sent=events_sent
                    )
                    break
                
                yield event_str
                events_sent += 1
        
        except asyncio.CancelledError:
            logger.info("stream_cancelled", session_id=session_id, events_sent=events_sent)
        except Exception as e:
            logger.exception("stream_error", session_id=session_id, error=str(e))
            yield formatter.format("error", {
                "message": str(e),
                "type": type(e).__name__
            })
        finally:
            if producer and not producer.done():
                producer.cancel()
                try:
                    await producer
                except asyncio.CancelledError:
                    pass
            
            logger.debug(
                "stream_closed",
                session_id=session_id,
                events_sent=events_sent,
                duration=time.time() - start_time,
                buffer_metrics=buffer.metrics.to_dict()
            )


@router.get("/chat/stream")
async def chat_stream(
    request: Request,
    session_id: str = Query(..., description="Session ID for the chat"),
    prompt: Optional[str] = Query(None, description="Optional prompt to start processing"),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID", description="Last received event ID for replay"),
    session_manager: SessionManager = Depends(get_session_manager),
    streams_manager: RedisStreamsManager = Depends(get_streams_manager),
    backpressure_mgr: BackpressureManager = Depends(get_backpressure_manager)
):
    """
    Stream chat events via Server-Sent Events.
    
    Opens a persistent SSE connection and streams events from Redis Streams.
    Uses consumer groups for reliable at-least-once delivery with acknowledgment.
    
    **Event Types:**
    - `connected`: Initial connection confirmation
    - `trace`: Intermediate processing events (agent steps, reasoning)
    - `tool_call`: Tool invocation events
    - `tool_result`: Tool execution results
    - `final`: Final result when processing completes
    - `error`: Error events
    - `heartbeat`: Keep-alive pings (every SSE_HEARTBEAT_SEC seconds)
    - `timeout`: Connection closed due to idle timeout
    
    **Replay Support:**
    Include `Last-Event-ID` header to replay events after that ID.
    Useful for recovering from disconnections.
    
    **Connection Lifecycle:**
    - Heartbeat sent every SSE_HEARTBEAT_SEC (default 15s)
    - Connection closed after SSE_IDLE_TIMEOUT_SEC idle time (default 300s)
    - Session TTL refreshed on each non-heartbeat event
    
    Args:
        session_id: Required session identifier
        prompt: Optional prompt to initiate processing
        last_event_id: Optional event ID for replay (from header)
        
    Returns:
        StreamingResponse with text/event-stream content type
        
    Raises:
        404: Session not found
    """
    session = await session_manager.get(session_id)
    
    if not session:
        if prompt:
            session = await session_manager.create(
                session_id=session_id,
                prompt=prompt
            )
            
            try:
                from ..workers.agent_tasks import execute_agent
                task = execute_agent.delay(
                    session_id=session_id,
                    message=prompt,
                    context=None,
                    model=None
                )
                await session_manager.update(session_id, task_id=task.id, status="processing")
            except ImportError:
                await streams_manager.add_event(
                    session_id,
                    "trace",
                    {"message": "Agent worker not available, demo mode"}
                )
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Session {session_id} not found. Provide prompt parameter to create."
            )
    
    logger.info(
        "sse_connection_opened",
        session_id=session_id,
        has_last_event_id=last_event_id is not None,
        has_prompt=prompt is not None
    )
    
    return StreamingResponse(
        stream_events(
            session_id=session_id,
            request=request,
            last_event_id=last_event_id,
            session_manager=session_manager,
            streams_manager=streams_manager,
            backpressure_mgr=backpressure_mgr
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Last-Event-ID"
        }
    )
