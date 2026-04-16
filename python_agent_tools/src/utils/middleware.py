"""Production middleware for FastAPI application."""

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import time
import asyncio
from collections import defaultdict
from typing import Dict, List, Optional, Tuple
import structlog
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

logger = structlog.get_logger(__name__)

REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint'],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

ACTIVE_REQUESTS = Gauge(
    'http_requests_active',
    'Number of active HTTP requests'
)

TOOL_EXECUTIONS = Counter(
    'tool_executions_total',
    'Tool executions',
    ['tool_name', 'success']
)

REQUEST_SIZE = Histogram(
    'http_request_size_bytes',
    'HTTP request size in bytes',
    ['method', 'endpoint'],
    buckets=[100, 1000, 10000, 100000, 1000000]
)

RESPONSE_SIZE = Histogram(
    'http_response_size_bytes',
    'HTTP response size in bytes',
    ['method', 'endpoint'],
    buckets=[100, 1000, 10000, 100000, 1000000]
)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging all HTTP requests with structured logging."""
    
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(time.time_ns()))
        start_time = time.perf_counter()
        
        structlog.contextvars.bind_contextvars(request_id=request_id)
        
        logger.info(
            "request_started",
            method=request.method,
            path=request.url.path,
            query=str(request.query_params),
            client_ip=request.client.host if request.client else "unknown"
        )
        
        ACTIVE_REQUESTS.inc()
        
        try:
            response = await call_next(request)
            duration = time.perf_counter() - start_time
            
            endpoint = self._normalize_path(request.url.path)
            
            REQUEST_COUNT.labels(
                method=request.method,
                endpoint=endpoint,
                status=response.status_code
            ).inc()
            
            REQUEST_LATENCY.labels(
                method=request.method,
                endpoint=endpoint
            ).observe(duration)
            
            content_length = response.headers.get("content-length")
            if content_length:
                RESPONSE_SIZE.labels(
                    method=request.method,
                    endpoint=endpoint
                ).observe(int(content_length))
            
            logger.info(
                "request_completed",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round(duration * 1000, 2)
            )
            
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Response-Time"] = f"{duration * 1000:.2f}ms"
            
            return response
            
        except Exception as e:
            duration = time.perf_counter() - start_time
            logger.error(
                "request_failed",
                method=request.method,
                path=request.url.path,
                error=str(e),
                duration_ms=round(duration * 1000, 2)
            )
            raise
        finally:
            ACTIVE_REQUESTS.dec()
            structlog.contextvars.unbind_contextvars("request_id")
    
    def _normalize_path(self, path: str) -> str:
        """Normalize path for metrics to avoid cardinality explosion."""
        parts = path.strip("/").split("/")
        normalized = []
        for part in parts:
            if part.isdigit() or len(part) > 32:
                normalized.append("{id}")
            else:
                normalized.append(part)
        return "/" + "/".join(normalized) if normalized else "/"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token bucket rate limiting middleware."""
    
    def __init__(
        self,
        app,
        requests_per_minute: int = 100,
        burst_size: int = 20,
        exclude_paths: Optional[List[str]] = None
    ):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.burst_size = burst_size
        self.exclude_paths = exclude_paths or ["/health", "/readyz", "/metrics"]
        self._buckets: Dict[str, Tuple[float, float]] = defaultdict(
            lambda: (time.time(), float(burst_size))
        )
        self._lock = asyncio.Lock()
    
    async def dispatch(self, request: Request, call_next):
        if any(request.url.path.startswith(p) for p in self.exclude_paths):
            return await call_next(request)
        
        client_id = self._get_client_id(request)
        
        async with self._lock:
            allowed, retry_after = self._check_rate_limit(client_id)
        
        if not allowed:
            logger.warning(
                "rate_limit_exceeded",
                client_id=client_id,
                path=request.url.path
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too Many Requests",
                    "message": "Rate limit exceeded. Please retry later.",
                    "retry_after": retry_after
                },
                headers={"Retry-After": str(int(retry_after))}
            )
        
        return await call_next(request)
    
    def _get_client_id(self, request: Request) -> str:
        """Get client identifier for rate limiting."""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
    
    def _check_rate_limit(self, client_id: str) -> Tuple[bool, float]:
        """Check if request is allowed using token bucket algorithm."""
        now = time.time()
        last_time, tokens = self._buckets[client_id]
        
        time_passed = now - last_time
        tokens_to_add = time_passed * (self.requests_per_minute / 60.0)
        tokens = min(self.burst_size, tokens + tokens_to_add)
        
        if tokens >= 1:
            tokens -= 1
            self._buckets[client_id] = (now, tokens)
            return True, 0
        else:
            retry_after = (1 - tokens) / (self.requests_per_minute / 60.0)
            self._buckets[client_id] = (now, tokens)
            return False, retry_after


class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """Global error handling middleware."""
    
    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response
        except Exception as e:
            logger.exception(
                "unhandled_exception",
                path=request.url.path,
                method=request.method,
                error_type=type(e).__name__,
                error=str(e)
            )
            
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Internal Server Error",
                    "message": "An unexpected error occurred. Please try again later.",
                    "request_id": request.headers.get("X-Request-ID", "unknown")
                }
            )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        
        return response


def get_metrics() -> bytes:
    """Generate Prometheus metrics output."""
    return generate_latest()


def get_metrics_content_type() -> str:
    """Get content type for metrics response."""
    return CONTENT_TYPE_LATEST
