"""Pydantic schemas for request/response validation."""
from pydantic import BaseModel, Field
from typing import Optional, Any, Literal
from datetime import datetime


class ChatRequest(BaseModel):
    """Request to start a chat session."""
    message: str = Field(..., min_length=1, max_length=10000)
    context: Optional[dict] = None
    model: Optional[str] = None


class SessionState(BaseModel):
    """Session state stored in Redis."""
    session_id: str
    user_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    status: Literal["idle", "processing", "completed", "error"] = "idle"
    task_id: Optional[str] = None
    message_count: int = 0
    context: dict = Field(default_factory=dict)


class TraceEvent(BaseModel):
    """Trace event during agent execution."""
    event_id: str
    timestamp: datetime
    event_type: str
    stage: Optional[str] = None
    data: Any = None
    duration_ms: Optional[float] = None


class FinalEvent(BaseModel):
    """Final result event."""
    session_id: str
    success: bool
    result: Any = None
    error: Optional[str] = None
    total_duration_ms: float
    trace_count: int


class SSEMessage(BaseModel):
    """SSE message format."""
    event: str
    data: Any
    id: Optional[str] = None
    retry: Optional[int] = None


class HealthResponse(BaseModel):
    """Health check response."""
    status: Literal["healthy", "unhealthy", "degraded"]
    version: str
    redis: bool
    celery: bool
    uptime_seconds: float


class ErrorResponse(BaseModel):
    """Error response."""
    error: str
    detail: Optional[str] = None
    request_id: Optional[str] = None
