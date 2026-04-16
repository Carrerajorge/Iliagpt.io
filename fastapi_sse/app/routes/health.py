"""Health check endpoints for liveness and readiness probes."""
import asyncio
import time
import concurrent.futures
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import structlog

from ..redis_client import redis_manager
from ..config import get_settings

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["Health"])

START_TIME = time.time()


class LivenessResponse(BaseModel):
    """Liveness probe response."""
    status: Literal["alive"]
    uptime_seconds: float


class ReadinessResponse(BaseModel):
    """Readiness probe response."""
    status: Literal["ready", "not_ready"]
    redis: bool
    celery: bool
    details: dict = {}


@router.get("/healthz", response_model=LivenessResponse)
async def liveness_probe():
    """
    Liveness probe - checks if the service is running.
    
    This endpoint should return quickly and only fail if the process
    is in an unrecoverable state. Used by Kubernetes to restart pods.
    
    Returns:
        LivenessResponse with uptime
    """
    return LivenessResponse(
        status="alive",
        uptime_seconds=time.time() - START_TIME
    )


@router.get("/readyz", response_model=ReadinessResponse)
async def readiness_probe():
    """
    Readiness probe - checks if the service is ready to accept traffic.
    
    Verifies connectivity to required external dependencies:
    - Redis: Required for session state and event streaming
    - Celery: Optional, degraded mode if unavailable
    
    Returns 503 if Redis is unavailable.
    
    Returns:
        ReadinessResponse with dependency status
    """
    redis_ok = False
    celery_ok = False
    details = {}
    
    try:
        client = await redis_manager.get_client()
        start = time.time()
        await client.ping()
        details["redis_latency_ms"] = round((time.time() - start) * 1000, 2)
        redis_ok = True
    except Exception as e:
        details["redis_error"] = str(e)
        logger.warning("readiness_redis_failed", error=str(e))
    
    def check_celery_sync():
        """Check Celery workers in thread to avoid blocking."""
        try:
            from ..celery_app import celery_app
            inspect = celery_app.control.inspect()
            ping_result = inspect.ping()
            return ping_result is not None and len(ping_result) > 0
        except Exception:
            return False
    
    try:
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            celery_ok = await asyncio.wait_for(
                loop.run_in_executor(pool, check_celery_sync),
                timeout=3.0
            )
        if celery_ok:
            details["celery_workers"] = "available"
        else:
            details["celery_workers"] = "unavailable"
    except asyncio.TimeoutError:
        details["celery_workers"] = "timeout"
    except Exception as e:
        details["celery_error"] = str(e)
    
    if not redis_ok:
        raise HTTPException(
            status_code=503,
            detail=ReadinessResponse(
                status="not_ready",
                redis=False,
                celery=celery_ok,
                details=details
            ).model_dump()
        )
    
    return ReadinessResponse(
        status="ready",
        redis=redis_ok,
        celery=celery_ok,
        details=details
    )
