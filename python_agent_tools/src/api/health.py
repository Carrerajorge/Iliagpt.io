"""Health check endpoints for Kubernetes and monitoring."""

from fastapi import APIRouter, Response
from pydantic import BaseModel
from typing import Dict, List, Optional
from enum import Enum
import time
import asyncio
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["health"])


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class ComponentHealth(BaseModel):
    name: str
    status: HealthStatus
    message: Optional[str] = None
    latency_ms: Optional[float] = None


class HealthResponse(BaseModel):
    status: HealthStatus
    version: str
    uptime_seconds: float
    components: List[ComponentHealth]
    tools_count: int
    timestamp: str


class ReadinessResponse(BaseModel):
    ready: bool
    checks: Dict[str, bool]


_start_time = time.time()


async def check_registry_health() -> ComponentHealth:
    """Check if tool registry is accessible."""
    start = time.perf_counter()
    try:
        from ..core.registry import registry
        tools = registry.list_all()
        latency = (time.perf_counter() - start) * 1000
        
        if len(tools) > 0:
            return ComponentHealth(
                name="registry",
                status=HealthStatus.HEALTHY,
                message=f"{len(tools)} tools registered",
                latency_ms=round(latency, 2)
            )
        else:
            return ComponentHealth(
                name="registry",
                status=HealthStatus.DEGRADED,
                message="No tools registered",
                latency_ms=round(latency, 2)
            )
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        return ComponentHealth(
            name="registry",
            status=HealthStatus.UNHEALTHY,
            message=str(e),
            latency_ms=round(latency, 2)
        )


async def check_factory_health() -> ComponentHealth:
    """Check if tool factory can create tools."""
    start = time.perf_counter()
    try:
        from ..core.factory import ToolFactory
        factory = ToolFactory()
        latency = (time.perf_counter() - start) * 1000
        
        return ComponentHealth(
            name="factory",
            status=HealthStatus.HEALTHY,
            message="Factory operational",
            latency_ms=round(latency, 2)
        )
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        return ComponentHealth(
            name="factory",
            status=HealthStatus.UNHEALTHY,
            message=str(e),
            latency_ms=round(latency, 2)
        )


async def check_config_health() -> ComponentHealth:
    """Check if configuration is loaded."""
    start = time.perf_counter()
    try:
        from ..utils.config import get_settings
        settings = get_settings()
        latency = (time.perf_counter() - start) * 1000
        
        return ComponentHealth(
            name="config",
            status=HealthStatus.HEALTHY,
            message=f"Environment: {settings.environment}",
            latency_ms=round(latency, 2)
        )
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        return ComponentHealth(
            name="config",
            status=HealthStatus.UNHEALTHY,
            message=str(e),
            latency_ms=round(latency, 2)
        )


async def check_memory_health() -> ComponentHealth:
    """Check memory usage."""
    start = time.perf_counter()
    try:
        import resource
        usage = resource.getrusage(resource.RUSAGE_SELF)
        memory_mb = usage.ru_maxrss / 1024  # Convert to MB on Linux
        latency = (time.perf_counter() - start) * 1000
        
        if memory_mb < 512:
            status = HealthStatus.HEALTHY
        elif memory_mb < 1024:
            status = HealthStatus.DEGRADED
        else:
            status = HealthStatus.UNHEALTHY
        
        return ComponentHealth(
            name="memory",
            status=status,
            message=f"Memory usage: {memory_mb:.1f} MB",
            latency_ms=round(latency, 2)
        )
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        return ComponentHealth(
            name="memory",
            status=HealthStatus.HEALTHY,
            message="Memory check not available",
            latency_ms=round(latency, 2)
        )


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Detailed health check endpoint."""
    from ..core.registry import registry
    from datetime import datetime, timezone
    
    components = await asyncio.gather(
        check_registry_health(),
        check_factory_health(),
        check_config_health(),
        check_memory_health(),
    )
    
    unhealthy_count = sum(1 for c in components if c.status == HealthStatus.UNHEALTHY)
    degraded_count = sum(1 for c in components if c.status == HealthStatus.DEGRADED)
    
    if unhealthy_count > 0:
        overall_status = HealthStatus.UNHEALTHY
    elif degraded_count > 0:
        overall_status = HealthStatus.DEGRADED
    else:
        overall_status = HealthStatus.HEALTHY
    
    return HealthResponse(
        status=overall_status,
        version="1.0.0",
        uptime_seconds=round(time.time() - _start_time, 2),
        components=list(components),
        tools_count=len(registry.list_all()),
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@router.get("/readyz", response_model=ReadinessResponse)
async def readiness_probe():
    """Kubernetes readiness probe - indicates if the service can accept traffic."""
    checks = {}
    
    try:
        from ..core.registry import registry
        checks["registry"] = len(registry.list_all()) > 0
    except Exception:
        checks["registry"] = False
    
    try:
        from ..core.factory import ToolFactory
        factory = ToolFactory()
        checks["factory"] = True
    except Exception:
        checks["factory"] = False
    
    try:
        from ..utils.config import get_settings
        get_settings()
        checks["config"] = True
    except Exception:
        checks["config"] = False
    
    ready = all(checks.values())
    
    return ReadinessResponse(ready=ready, checks=checks)


@router.get("/livez")
async def liveness_probe():
    """Kubernetes liveness probe - indicates if the service is alive."""
    return {"alive": True, "uptime_seconds": round(time.time() - _start_time, 2)}


@router.get("/metrics")
async def metrics_endpoint():
    """Prometheus metrics endpoint."""
    from ..utils.middleware import get_metrics, get_metrics_content_type
    
    return Response(
        content=get_metrics(),
        media_type=get_metrics_content_type()
    )
