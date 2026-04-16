"""FastAPI route modules."""
from .stream import router as stream_router
from .chat import router as chat_router
from .health import router as health_router
from .metrics import router as metrics_router

__all__ = ["stream_router", "chat_router", "health_router", "metrics_router"]
