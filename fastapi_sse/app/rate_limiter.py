"""Rate limiting middleware using Redis."""
import time
from typing import Optional, Callable
from fastapi import Request, Response, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import structlog

from .config import get_settings
from .redis_client import get_redis_manager

logger = structlog.get_logger(__name__)


class RateLimiter:
    """Token bucket rate limiter backed by Redis."""
    
    RATE_LIMIT_PREFIX = "rate_limit:"
    
    def __init__(
        self,
        requests_per_window: Optional[int] = None,
        window_seconds: Optional[int] = None
    ):
        settings = get_settings()
        self.requests_per_window = requests_per_window or settings.rate_limit_requests
        self.window_seconds = window_seconds or settings.rate_limit_window
        self.redis_manager = get_redis_manager()
    
    def _get_key(self, identifier: str) -> str:
        return f"{self.RATE_LIMIT_PREFIX}{identifier}"
    
    async def is_allowed(self, identifier: str) -> tuple[bool, dict]:
        """
        Check if request is allowed under rate limit.
        Returns (allowed, info) where info contains limit details.
        """
        client = await self.redis_manager.get_client()
        key = self._get_key(identifier)
        now = int(time.time())
        window_start = now - self.window_seconds
        
        pipe = client.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zadd(key, {str(now): now})
        pipe.zcard(key)
        pipe.expire(key, self.window_seconds)
        results = await pipe.execute()
        
        request_count = results[2]
        
        info = {
            "limit": self.requests_per_window,
            "remaining": max(0, self.requests_per_window - request_count),
            "reset": now + self.window_seconds,
            "current": request_count
        }
        
        allowed = request_count <= self.requests_per_window
        
        if not allowed:
            logger.warning(
                "rate_limit_exceeded",
                identifier=identifier,
                count=request_count,
                limit=self.requests_per_window
            )
        
        return allowed, info


def get_client_identifier(request: Request) -> str:
    """Get unique identifier for rate limiting (IP or user ID)."""
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    
    return f"ip:{ip}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Middleware to apply rate limiting to all requests."""
    
    def __init__(
        self,
        app,
        limiter: Optional[RateLimiter] = None,
        exclude_paths: Optional[list[str]] = None
    ):
        super().__init__(app)
        self.limiter = limiter or RateLimiter()
        self.exclude_paths = exclude_paths or ["/health", "/ready", "/metrics"]
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if any(request.url.path.startswith(p) for p in self.exclude_paths):
            return await call_next(request)
        
        identifier = get_client_identifier(request)
        allowed, info = await self.limiter.is_allowed(identifier)
        
        if not allowed:
            return Response(
                content='{"error": "Rate limit exceeded"}',
                status_code=429,
                media_type="application/json",
                headers={
                    "X-RateLimit-Limit": str(info["limit"]),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(info["reset"]),
                    "Retry-After": str(info["reset"] - int(time.time()))
                }
            )
        
        response = await call_next(request)
        
        response.headers["X-RateLimit-Limit"] = str(info["limit"])
        response.headers["X-RateLimit-Remaining"] = str(info["remaining"])
        response.headers["X-RateLimit-Reset"] = str(info["reset"])
        
        return response
