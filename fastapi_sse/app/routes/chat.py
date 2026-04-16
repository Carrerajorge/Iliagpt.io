"""Fallback chat endpoint for synchronous responses."""
import uuid
import time
from datetime import datetime
from typing import Optional, Any, Dict
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
import structlog

from ..session import get_session_manager, SessionManager
from ..redis_streams import get_streams_manager, RedisStreamsManager
from ..config import get_settings

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["Chat"])


class ChatRequest(BaseModel):
    """Request body for synchronous chat."""
    message: str = Field(..., min_length=1, max_length=10000, description="User message")
    context: Optional[Dict[str, Any]] = Field(default=None, description="Optional context")
    model: Optional[str] = Field(default=None, description="Model to use")
    user_id: Optional[str] = Field(default=None, description="User identifier")
    timeout_seconds: Optional[float] = Field(default=60.0, description="Request timeout")


class ChatResponse(BaseModel):
    """Response for synchronous chat."""
    session_id: str
    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: float
    message_count: int = 1


@router.post("/chat", response_model=ChatResponse)
async def chat_sync(
    request: ChatRequest,
    session_id: Optional[str] = Query(None, description="Existing session ID"),
    session_manager: SessionManager = Depends(get_session_manager),
    streams_manager: RedisStreamsManager = Depends(get_streams_manager)
):
    """
    Synchronous chat endpoint for graceful degradation.
    
    Use this endpoint when SSE streaming is unavailable or not desired.
    Waits for the complete response before returning.
    
    For streaming responses, use GET /chat/stream instead.
    
    Args:
        request: Chat request with message and optional context
        session_id: Optional existing session ID (creates new if not provided)
        
    Returns:
        ChatResponse with complete result or error
    """
    start_time = time.time()
    
    if not session_id:
        session_id = str(uuid.uuid4())
    
    try:
        session = await session_manager.create(
            session_id=session_id,
            prompt=request.message,
            user_id=request.user_id,
            context=request.context
        )
        
        await session_manager.set_status(session_id, "processing")
        
        try:
            from ..workers.agent_tasks import execute_agent
            
            task = execute_agent.delay(
                session_id=session_id,
                message=request.message,
                context=request.context,
                model=request.model
            )
            
            await session_manager.update(session_id, task_id=task.id)
            
            result = task.get(timeout=request.timeout_seconds)
            
            await session_manager.set_status(session_id, "completed")
            
            duration_ms = (time.time() - start_time) * 1000
            
            logger.info(
                "chat_sync_completed",
                session_id=session_id,
                duration_ms=duration_ms
            )
            
            return ChatResponse(
                session_id=session_id,
                success=True,
                result=result,
                duration_ms=duration_ms
            )
            
        except ImportError:
            result = await _fallback_response(request.message)
            await session_manager.set_status(session_id, "completed")
            
            duration_ms = (time.time() - start_time) * 1000
            
            return ChatResponse(
                session_id=session_id,
                success=True,
                result=result,
                duration_ms=duration_ms
            )
            
    except TimeoutError:
        await session_manager.set_status(session_id, "error")
        duration_ms = (time.time() - start_time) * 1000
        
        logger.warning(
            "chat_sync_timeout",
            session_id=session_id,
            timeout=request.timeout_seconds
        )
        
        return ChatResponse(
            session_id=session_id,
            success=False,
            error=f"Request timed out after {request.timeout_seconds}s",
            duration_ms=duration_ms
        )
        
    except Exception as e:
        await session_manager.set_status(session_id, "error")
        duration_ms = (time.time() - start_time) * 1000
        
        logger.exception(
            "chat_sync_error",
            session_id=session_id,
            error=str(e)
        )
        
        return ChatResponse(
            session_id=session_id,
            success=False,
            error=str(e),
            duration_ms=duration_ms
        )


async def _fallback_response(message: str) -> Dict[str, Any]:
    """
    Fallback response when Celery workers are unavailable.
    
    Returns a placeholder response for graceful degradation.
    """
    return {
        "type": "fallback",
        "message": "Processing is currently unavailable. Please try streaming endpoint.",
        "original_message": message[:100],
        "timestamp": datetime.utcnow().isoformat()
    }
