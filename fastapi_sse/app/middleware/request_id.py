"""
Request ID Middleware for logging correlation.

Features:
- Generate or extract X-Request-ID header
- Add to request state for logging correlation
- Include in response headers
"""
import uuid
import time
from typing import Callable, Optional
from contextvars import ContextVar

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import structlog

logger = structlog.get_logger(__name__)

request_id_ctx: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


def get_request_id() -> Optional[str]:
    """Get current request ID from context."""
    return request_id_ctx.get()


def generate_request_id() -> str:
    """Generate a unique request ID."""
    return str(uuid.uuid4())


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add unique request ID for tracing.
    
    Features:
    - Uses X-Request-ID header if provided
    - Generates UUID if not provided
    - Adds to request.state for handler access
    - Includes in response headers
    - Sets context var for structured logging
    """
    
    HEADER_NAME = "X-Request-ID"
    
    def __init__(
        self,
        app,
        header_name: str = "X-Request-ID",
        generate_if_missing: bool = True,
        include_in_response: bool = True,
        log_requests: bool = True,
        exclude_paths: Optional[list[str]] = None
    ):
        super().__init__(app)
        self.header_name = header_name
        self.generate_if_missing = generate_if_missing
        self.include_in_response = include_in_response
        self.log_requests = log_requests
        self.exclude_paths = exclude_paths or [
            "/healthz",
            "/readyz",
            "/metrics",
        ]
    
    def _should_log(self, path: str) -> bool:
        """Check if request should be logged."""
        if not self.log_requests:
            return False
        return not any(path.startswith(p) for p in self.exclude_paths)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with request ID tracking."""
        request_id = request.headers.get(self.header_name)
        
        if not request_id and self.generate_if_missing:
            request_id = generate_request_id()
        
        request.state.request_id = request_id
        
        token = request_id_ctx.set(request_id)
        
        start_time = time.time()
        
        try:
            response = await call_next(request)
            
            duration_ms = (time.time() - start_time) * 1000
            
            if self.include_in_response and request_id:
                response.headers[self.header_name] = request_id
                response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
            
            if self._should_log(request.url.path):
                logger.info(
                    "request_completed",
                    request_id=request_id,
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    duration_ms=round(duration_ms, 2),
                    user_id=getattr(request.state, "user_id", None)
                )
            
            return response
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            
            logger.error(
                "request_failed",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                duration_ms=round(duration_ms, 2),
                error=str(e)
            )
            raise
            
        finally:
            request_id_ctx.reset(token)


def create_request_id_middleware(
    header_name: str = "X-Request-ID",
    generate_if_missing: bool = True,
    include_in_response: bool = True,
    log_requests: bool = True,
    exclude_paths: Optional[list[str]] = None
) -> type:
    """
    Factory function to create configured request ID middleware.
    
    Args:
        header_name: Name of the request ID header
        generate_if_missing: Generate ID if not in request
        include_in_response: Add ID to response headers
        log_requests: Log request completion
        exclude_paths: Paths to skip logging
    """
    class ConfiguredRequestIDMiddleware(RequestIDMiddleware):
        def __init__(self, app):
            super().__init__(
                app,
                header_name=header_name,
                generate_if_missing=generate_if_missing,
                include_in_response=include_in_response,
                log_requests=log_requests,
                exclude_paths=exclude_paths
            )
    
    return ConfiguredRequestIDMiddleware
