"""Rate limiting utilities for API calls."""

import asyncio
import time
from typing import Optional
from dataclasses import dataclass
import structlog

logger = structlog.get_logger(__name__)


@dataclass
class TokenBucket:
    """Token bucket rate limiter implementation."""
    
    capacity: int
    refill_rate: float
    tokens: float = 0.0
    last_refill: float = 0.0
    
    def __post_init__(self):
        self.tokens = float(self.capacity)
        self.last_refill = time.monotonic()
        self._lock = asyncio.Lock()
    
    def _refill(self) -> None:
        """Refill tokens based on elapsed time."""
        now = time.monotonic()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
    
    async def acquire(self, tokens: int = 1) -> bool:
        """Attempt to acquire tokens, returns True if successful."""
        async with self._lock:
            self._refill()
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False
    
    async def wait_for_tokens(self, tokens: int = 1) -> None:
        """Wait until tokens are available."""
        while True:
            if await self.acquire(tokens):
                return
            wait_time = (tokens - self.tokens) / self.refill_rate
            await asyncio.sleep(min(wait_time, 1.0))


class RateLimiter:
    """Rate limiter for controlling request frequency."""
    
    def __init__(
        self,
        requests_per_second: float = 10.0,
        burst_size: Optional[int] = None,
    ):
        self.requests_per_second = requests_per_second
        self.burst_size = burst_size or int(requests_per_second * 2)
        self._bucket = TokenBucket(
            capacity=self.burst_size,
            refill_rate=requests_per_second,
        )
        self.logger = logger.bind(
            rate_limit=requests_per_second,
            burst_size=self.burst_size,
        )
    
    async def acquire(self) -> None:
        """Acquire permission to make a request."""
        await self._bucket.wait_for_tokens(1)
    
    async def try_acquire(self) -> bool:
        """Try to acquire permission without waiting."""
        return await self._bucket.acquire(1)
    
    def __call__(self, func):
        """Decorator to apply rate limiting to a function."""
        async def wrapper(*args, **kwargs):
            await self.acquire()
            return await func(*args, **kwargs)
        return wrapper


class SlidingWindowRateLimiter:
    """Sliding window rate limiter for more precise rate limiting."""
    
    def __init__(
        self,
        max_requests: int,
        window_seconds: float,
    ):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._timestamps: list[float] = []
        self._lock = asyncio.Lock()
    
    async def acquire(self) -> None:
        """Acquire permission to make a request."""
        async with self._lock:
            now = time.monotonic()
            cutoff = now - self.window_seconds
            self._timestamps = [ts for ts in self._timestamps if ts > cutoff]
            
            while len(self._timestamps) >= self.max_requests:
                oldest = self._timestamps[0]
                wait_time = oldest - cutoff
                await asyncio.sleep(max(wait_time, 0.01))
                now = time.monotonic()
                cutoff = now - self.window_seconds
                self._timestamps = [ts for ts in self._timestamps if ts > cutoff]
            
            self._timestamps.append(now)
