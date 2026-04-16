"""FastAPI SSE Backend for Agent Tracing - Production-ready with Redis Streams."""
import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from pathlib import Path

from fastapi import FastAPI, Request, Query, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import structlog

from .config import get_settings, Settings
from .redis_client import redis_manager
from .routes import stream_router, chat_router, health_router, metrics_router
from .session import get_session_manager, SessionManager
from .observability import get_telemetry, get_prometheus_metrics
from .middleware import RateLimitMiddleware, AuthMiddleware, RequestIDMiddleware
from .circuit_breaker import get_circuit_registry, get_redis_circuit, get_celery_circuit
from .backpressure import get_backpressure_manager

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan management.
    
    Handles startup and shutdown of:
    - Redis connection pools
    - Background tasks
    """
    logger.info("application_starting", version="1.0.0")
    
    telemetry = get_telemetry()
    telemetry.setup()
    telemetry.instrument_redis()
    logger.info("telemetry_initialized")
    
    try:
        await redis_manager.initialize()
        logger.info("redis_connected")
    except Exception as e:
        logger.error("redis_connection_failed", error=str(e))
    
    yield
    
    logger.info("application_shutting_down")
    await redis_manager.close()
    logger.info("application_stopped")


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.
    
    Sets up:
    - CORS middleware for cross-origin requests
    - Request ID middleware for tracing
    - Route modules for different functionality
    """
    settings = get_settings()
    
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Production-grade SSE streaming backend for agent tracing with Redis Streams",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json"
    )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "X-Request-ID",
            "Last-Event-ID",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
            "Retry-After"
        ]
    )
    
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RequestIDMiddleware)
    
    app.include_router(health_router)
    app.include_router(stream_router)
    app.include_router(chat_router)
    app.include_router(metrics_router)
    
    static_dir = Path(__file__).parent.parent / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir), html=True), name="static")
        logger.info("static_files_mounted", path=str(static_dir))
    
    telemetry = get_telemetry()
    telemetry.instrument_fastapi(app)
    
    return app


app = create_app()


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """
    Add unique request ID to each request for tracing.
    
    Uses X-Request-ID header if provided, otherwise generates UUID.
    Request ID is available via request.state.request_id.
    """
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    
    start_time = time.time()
    
    response = await call_next(request)
    
    duration_ms = (time.time() - start_time) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
    
    if request.url.path not in ["/healthz", "/readyz", "/docs", "/openapi.json"]:
        logger.info(
            "request_completed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2)
        )
    
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with consistent error format."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code,
            "request_id": getattr(request.state, "request_id", None)
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions with logging."""
    request_id = getattr(request.state, "request_id", None)
    
    logger.exception(
        "unhandled_exception",
        request_id=request_id,
        path=request.url.path,
        error=str(exc)
    )
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "request_id": request_id
        }
    )


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API information."""
    return {
        "service": "Agent Tracing SSE API",
        "version": "1.0.0",
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "endpoints": {
            "stream": "GET /chat/stream?session_id=...&prompt=...",
            "chat": "POST /chat",
            "health": "GET /healthz",
            "ready": "GET /readyz",
            "docs": "GET /docs",
            "test_client": "GET /static/index.html"
        }
    }


@app.get("/session/{session_id}", tags=["Session"])
async def get_session(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """Get current session state."""
    session = await session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/session/{session_id}", tags=["Session"])
async def delete_session(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """Delete a session."""
    if not await session_manager.exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    
    await session_manager.delete(session_id)
    return {"deleted": True, "session_id": session_id}


@app.get("/metrics", tags=["Monitoring"])
async def get_metrics():
    """
    Prometheus-compatible metrics endpoint.
    
    Returns basic service metrics for monitoring.
    """
    uptime = time.time() - START_TIME
    
    backpressure = get_backpressure_manager()
    circuit_registry = get_circuit_registry()
    
    return {
        "uptime_seconds": uptime,
        "service": "agent-tracing-sse",
        "version": "1.0.0",
        "start_time": START_TIME,
        "backpressure": backpressure.get_metrics(),
        "circuit_breakers": circuit_registry.get_all_status()
    }


@app.get("/circuit-breakers", tags=["Monitoring"])
async def get_circuit_breakers():
    """Get status of all circuit breakers."""
    redis_cb = get_redis_circuit()
    celery_cb = get_celery_circuit()
    
    return {
        "redis": redis_cb.get_status(),
        "celery": celery_cb.get_status()
    }


@app.post("/circuit-breakers/{name}/reset", tags=["Monitoring"])
async def reset_circuit_breaker(name: str):
    """Reset a specific circuit breaker to closed state."""
    if name == "redis":
        await get_redis_circuit().reset()
    elif name == "celery":
        await get_celery_circuit().reset()
    else:
        raise HTTPException(status_code=404, detail=f"Circuit breaker '{name}' not found")
    
    return {"reset": True, "name": name}


@app.get("/backpressure", tags=["Monitoring"])
async def get_backpressure_status():
    """Get backpressure metrics for all SSE connections."""
    return get_backpressure_manager().get_metrics()


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "fastapi_sse.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        workers=1 if settings.debug else settings.workers
    )
