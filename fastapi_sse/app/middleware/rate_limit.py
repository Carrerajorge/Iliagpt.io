"""
Rate Limiting Middleware using Redis Token Bucket Algorithm.

Features:
- Redis-backed token bucket implementation
- Rate limit by IP, user_id, and route
- Configurable via environment variables
- Different limits for /chat/stream vs /chat
- Returns 429 with Retry-After header when exceeded
- X-RateLimit-* headers on all responses
"""
import time
from dataclasses import dataclass, field
from typing import Optional, Callable, Dict
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import structlog

from ..config import get_settings
from ..redis_client import redis_manager

logger = structlog.get_logger(__name__)


@dataclass
class RouteRateLimits:
    """Configuration for route-specific rate limits."""
    default_requests: int = 60
    default_window_sec: int = 60
    route_limits: Dict[str, tuple[int, int]] = field(default_factory=dict)
    
    def get_limit(self, path: str) -> tuple[int, int]:
        """Get (requests, window_sec) for a given path."""
        for route_pattern, limits in self.route_limits.items():
            if path.startswith(route_pattern):
                return limits
        return (self.default_requests, self.default_window_sec)


class RateLimiter:
    """
    Token bucket rate limiter backed by Redis.
    
    Uses Redis sorted sets for sliding window rate limiting.
    Supports multiple rate limit tiers (IP, user, route).
    """
    
    RATE_LIMIT_PREFIX = "rl:"
    
    def __init__(
        self,
        requests_per_window: Optional[int] = None,
        window_seconds: Optional[int] = None
    ):
        settings = get_settings()
        self.default_requests = requests_per_window or settings.rate_limit_requests
        self.default_window = window_seconds or settings.rate_limit_window
    
    def _get_key(self, identifier: str, route_key: str = "") -> str:
        """Generate Redis key for rate limit bucket."""
        if route_key:
            return f"{self.RATE_LIMIT_PREFIX}{identifier}:{route_key}"
        return f"{self.RATE_LIMIT_PREFIX}{identifier}"
    
    async def is_allowed(
        self,
        identifier: str,
        route_key: str = "",
        requests_limit: Optional[int] = None,
        window_seconds: Optional[int] = None
    ) -> tuple[bool, dict]:
        """
        Check if request is allowed under rate limit using token bucket algorithm.
        
        Args:
            identifier: Unique client identifier (IP or user_id)
            route_key: Optional route-specific key for different limits
            requests_limit: Override default request limit
            window_seconds: Override default window
            
        Returns:
            Tuple of (allowed: bool, info: dict with limit details)
        """
        limit = requests_limit or self.default_requests
        window = window_seconds or self.default_window
        
        try:
            client = await redis_manager.get_client()
            key = self._get_key(identifier, route_key)
            now = time.time()
            window_start = now - window
            
            lua_script = """
            local key = KEYS[1]
            local now = tonumber(ARGV[1])
            local window_start = tonumber(ARGV[2])
            local limit = tonumber(ARGV[3])
            local window = tonumber(ARGV[4])
            
            -- Remove old entries outside the window
            redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
            
            -- Count current requests in window
            local count = redis.call('ZCARD', key)
            
            -- Check if under limit
            local allowed = count < limit
            
            if allowed then
                -- Add current request
                redis.call('ZADD', key, now, now .. '-' .. math.random())
                count = count + 1
            end
            
            -- Set expiry on the key
            redis.call('EXPIRE', key, window)
            
            return {allowed and 1 or 0, count}
            """
            
            result = await client.eval(
                lua_script,
                1,
                key,
                str(now),
                str(window_start),
                str(limit),
                str(window)
            )
            
            allowed = result[0] == 1
            current_count = result[1]
            reset_time = int(now) + window
            
            info = {
                "limit": limit,
                "remaining": max(0, limit - current_count),
                "reset": reset_time,
                "current": current_count,
                "window_sec": window,
                "retry_after": window if not allowed else 0
            }
            
            if not allowed:
                logger.warning(
                    "rate_limit_exceeded",
                    identifier=identifier,
                    route_key=route_key,
                    count=current_count,
                    limit=limit
                )
            
            return allowed, info
            
        except Exception as e:
            logger.error("rate_limit_check_failed", error=str(e), identifier=identifier)
            return True, {
                "limit": limit,
                "remaining": limit,
                "reset": int(time.time()) + window,
                "current": 0,
                "window_sec": window,
                "retry_after": 0
            }
    
    async def get_remaining(self, identifier: str, route_key: str = "") -> int:
        """Get remaining requests in current window."""
        try:
            client = await redis_manager.get_client()
            key = self._get_key(identifier, route_key)
            now = time.time()
            window_start = now - self.default_window
            
            await client.zremrangebyscore(key, 0, window_start)
            count = await client.zcard(key)
            
            return max(0, self.default_requests - count)
        except Exception:
            return self.default_requests


def get_client_identifier(request: Request) -> str:
    """
    Get unique identifier for rate limiting.
    
    Priority:
    1. Authenticated user_id from request.state
    2. X-Forwarded-For header (first IP)
    3. Direct client IP
    """
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    
    return f"ip:{ip}"


def get_route_key(path: str) -> str:
    """Extract route key for route-specific rate limiting."""
    if path.startswith("/chat/stream"):
        return "stream"
    elif path.startswith("/chat"):
        return "chat"
    return "default"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Middleware to apply rate limiting to all requests.
    
    Features:
    - Route-specific rate limits
    - User and IP based limiting
    - Configurable exclusion paths
    - Standard rate limit headers
    """
    
    def __init__(
        self,
        app,
        route_limits: Optional[RouteRateLimits] = None,
        exclude_paths: Optional[list[str]] = None
    ):
        super().__init__(app)
        
        settings = get_settings()
        
        self.route_limits = route_limits or RouteRateLimits(
            default_requests=settings.rate_limit_requests,
            default_window_sec=settings.rate_limit_window,
            route_limits={
                "/chat/stream": (30, 60),
                "/chat": (60, 60),
            }
        )
        
        self.exclude_paths = exclude_paths or [
            "/healthz",
            "/readyz",
            "/metrics",
            "/docs",
            "/redoc",
            "/openapi.json",
        ]
        
        self.limiter = RateLimiter()
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with rate limiting."""
        path = request.url.path
        
        if any(path.startswith(p) for p in self.exclude_paths):
            return await call_next(request)
        
        identifier = get_client_identifier(request)
        route_key = get_route_key(path)
        
        requests_limit, window_sec = self.route_limits.get_limit(path)
        
        allowed, info = await self.limiter.is_allowed(
            identifier=identifier,
            route_key=route_key,
            requests_limit=requests_limit,
            window_seconds=window_sec
        )
        
        if not allowed:
            return Response(
                content='{"error": "Rate limit exceeded", "retry_after": ' + str(info["retry_after"]) + '}',
                status_code=429,
                media_type="application/json",
                headers={
                    "X-RateLimit-Limit": str(info["limit"]),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(info["reset"]),
                    "Retry-After": str(info["retry_after"]),
                }
            )
        
        response = await call_next(request)
        
        response.headers["X-RateLimit-Limit"] = str(info["limit"])
        response.headers["X-RateLimit-Remaining"] = str(info["remaining"])
        response.headers["X-RateLimit-Reset"] = str(info["reset"])
        
        return response


def create_rate_limit_middleware(
    default_requests: int = 60,
    default_window_sec: int = 60,
    stream_requests: int = 30,
    stream_window_sec: int = 60,
    chat_requests: int = 60,
    chat_window_sec: int = 60,
    exclude_paths: Optional[list[str]] = None
) -> type:
    """
    Factory function to create configured rate limit middleware.
    
    Args:
        default_requests: Default requests per window
        default_window_sec: Default window in seconds
        stream_requests: Requests limit for /chat/stream
        stream_window_sec: Window for /chat/stream
        chat_requests: Requests limit for /chat
        chat_window_sec: Window for /chat
        exclude_paths: Paths to exclude from rate limiting
    """
    route_limits = RouteRateLimits(
        default_requests=default_requests,
        default_window_sec=default_window_sec,
        route_limits={
            "/chat/stream": (stream_requests, stream_window_sec),
            "/chat": (chat_requests, chat_window_sec),
        }
    )
    
    class ConfiguredRateLimitMiddleware(RateLimitMiddleware):
        def __init__(self, app):
            super().__init__(app, route_limits=route_limits, exclude_paths=exclude_paths)
    
    return ConfiguredRateLimitMiddleware
