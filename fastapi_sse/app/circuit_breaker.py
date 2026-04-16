"""
Circuit Breaker Pattern Implementation.

Features:
- Wrapper for external calls (Redis, Celery)
- States: closed, open, half-open
- Configurable failure threshold and recovery time
- Fallback behavior when open
- Metrics and monitoring
"""
import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional, Callable, Any, TypeVar, Generic, Dict
from enum import Enum
from functools import wraps
import structlog

logger = structlog.get_logger(__name__)

T = TypeVar("T")


class CircuitState(str, Enum):
    """Circuit breaker states."""
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker."""
    failure_threshold: int = 5
    success_threshold: int = 2
    recovery_timeout: float = 30.0
    half_open_max_calls: int = 3
    
    excluded_exceptions: tuple = ()
    
    @classmethod
    def from_env(cls, prefix: str = "CIRCUIT_BREAKER") -> "CircuitBreakerConfig":
        """Load config from environment variables."""
        import os
        
        return cls(
            failure_threshold=int(os.getenv(f"{prefix}_FAILURE_THRESHOLD", "5")),
            success_threshold=int(os.getenv(f"{prefix}_SUCCESS_THRESHOLD", "2")),
            recovery_timeout=float(os.getenv(f"{prefix}_RECOVERY_TIMEOUT", "30.0")),
            half_open_max_calls=int(os.getenv(f"{prefix}_HALF_OPEN_MAX_CALLS", "3")),
        )


@dataclass
class CircuitBreakerMetrics:
    """Metrics for circuit breaker."""
    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    rejected_calls: int = 0
    state_changes: int = 0
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    consecutive_failures: int = 0
    consecutive_successes: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "total_calls": self.total_calls,
            "successful_calls": self.successful_calls,
            "failed_calls": self.failed_calls,
            "rejected_calls": self.rejected_calls,
            "state_changes": self.state_changes,
            "last_failure_time": self.last_failure_time,
            "last_success_time": self.last_success_time,
            "consecutive_failures": self.consecutive_failures,
            "consecutive_successes": self.consecutive_successes,
            "success_rate": (
                self.successful_calls / self.total_calls * 100
                if self.total_calls > 0 else 0
            )
        }


class CircuitBreakerError(Exception):
    """Raised when circuit is open and call is rejected."""
    
    def __init__(self, name: str, message: str = "Circuit breaker is open"):
        self.name = name
        self.message = message
        super().__init__(f"{name}: {message}")


class CircuitBreaker:
    """
    Circuit breaker for protecting external service calls.
    
    States:
    - CLOSED: Normal operation, calls pass through
    - OPEN: Circuit tripped, calls are rejected
    - HALF_OPEN: Testing recovery, limited calls allowed
    """
    
    def __init__(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None,
        fallback: Optional[Callable[..., Any]] = None
    ):
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self.fallback = fallback
        
        self._state = CircuitState.CLOSED
        self._opened_at: Optional[float] = None
        self._half_open_calls = 0
        self._lock = asyncio.Lock()
        
        self.metrics = CircuitBreakerMetrics()
        
        logger.info(
            "circuit_breaker_created",
            name=name,
            failure_threshold=self.config.failure_threshold,
            recovery_timeout=self.config.recovery_timeout
        )
    
    @property
    def state(self) -> CircuitState:
        """Current circuit state."""
        return self._state
    
    @property
    def is_closed(self) -> bool:
        """Check if circuit is closed (normal operation)."""
        return self._state == CircuitState.CLOSED
    
    @property
    def is_open(self) -> bool:
        """Check if circuit is open (rejecting calls)."""
        return self._state == CircuitState.OPEN
    
    @property
    def is_half_open(self) -> bool:
        """Check if circuit is half-open (testing recovery)."""
        return self._state == CircuitState.HALF_OPEN
    
    async def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state."""
        if self._state == new_state:
            return
        
        old_state = self._state
        self._state = new_state
        self.metrics.state_changes += 1
        
        if new_state == CircuitState.OPEN:
            self._opened_at = time.time()
            self._half_open_calls = 0
        elif new_state == CircuitState.HALF_OPEN:
            self._half_open_calls = 0
        elif new_state == CircuitState.CLOSED:
            self._opened_at = None
            self.metrics.consecutive_failures = 0
        
        logger.info(
            "circuit_state_changed",
            name=self.name,
            old_state=old_state.value,
            new_state=new_state.value
        )
    
    async def _check_state_transition(self) -> None:
        """Check if state should transition based on current conditions."""
        if self._state == CircuitState.OPEN:
            if self._opened_at and time.time() - self._opened_at >= self.config.recovery_timeout:
                await self._transition_to(CircuitState.HALF_OPEN)
    
    async def _record_success(self) -> None:
        """Record a successful call."""
        self.metrics.successful_calls += 1
        self.metrics.last_success_time = time.time()
        self.metrics.consecutive_successes += 1
        self.metrics.consecutive_failures = 0
        
        if self._state == CircuitState.HALF_OPEN:
            if self.metrics.consecutive_successes >= self.config.success_threshold:
                await self._transition_to(CircuitState.CLOSED)
    
    async def _record_failure(self, error: Exception) -> None:
        """Record a failed call."""
        self.metrics.failed_calls += 1
        self.metrics.last_failure_time = time.time()
        self.metrics.consecutive_failures += 1
        self.metrics.consecutive_successes = 0
        
        logger.warning(
            "circuit_breaker_failure",
            name=self.name,
            error=str(error),
            consecutive_failures=self.metrics.consecutive_failures
        )
        
        if self._state == CircuitState.HALF_OPEN:
            await self._transition_to(CircuitState.OPEN)
        elif self._state == CircuitState.CLOSED:
            if self.metrics.consecutive_failures >= self.config.failure_threshold:
                await self._transition_to(CircuitState.OPEN)
    
    async def call(
        self,
        func: Callable[..., Any],
        *args,
        fallback: Optional[Callable[..., Any]] = None,
        **kwargs
    ) -> Any:
        """
        Execute a function through the circuit breaker.
        
        Args:
            func: Async function to execute
            *args: Positional arguments for func
            fallback: Optional fallback function if circuit is open
            **kwargs: Keyword arguments for func
            
        Returns:
            Result of func or fallback
            
        Raises:
            CircuitBreakerError: If circuit is open and no fallback provided
        """
        async with self._lock:
            await self._check_state_transition()
            
            self.metrics.total_calls += 1
            
            if self._state == CircuitState.OPEN:
                self.metrics.rejected_calls += 1
                
                fb = fallback or self.fallback
                if fb:
                    logger.debug(
                        "circuit_breaker_fallback",
                        name=self.name
                    )
                    if asyncio.iscoroutinefunction(fb):
                        return await fb(*args, **kwargs)
                    return fb(*args, **kwargs)
                
                raise CircuitBreakerError(
                    self.name,
                    f"Circuit is open, will retry after {self.config.recovery_timeout}s"
                )
            
            if self._state == CircuitState.HALF_OPEN:
                self._half_open_calls += 1
                if self._half_open_calls > self.config.half_open_max_calls:
                    self.metrics.rejected_calls += 1
                    raise CircuitBreakerError(
                        self.name,
                        "Maximum half-open calls exceeded"
                    )
        
        try:
            if asyncio.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = func(*args, **kwargs)
            
            async with self._lock:
                await self._record_success()
            
            return result
            
        except self.config.excluded_exceptions:
            raise
        except Exception as e:
            async with self._lock:
                await self._record_failure(e)
            raise
    
    def __call__(
        self,
        func: Optional[Callable] = None,
        fallback: Optional[Callable] = None
    ):
        """
        Decorator to wrap a function with circuit breaker.
        
        Usage:
            @circuit_breaker
            async def my_func():
                ...
            
            @circuit_breaker(fallback=default_value)
            async def my_func():
                ...
        """
        def decorator(f: Callable) -> Callable:
            @wraps(f)
            async def wrapper(*args, **kwargs):
                return await self.call(f, *args, fallback=fallback, **kwargs)
            return wrapper
        
        if func is not None:
            return decorator(func)
        return decorator
    
    async def reset(self) -> None:
        """Reset circuit breaker to closed state."""
        async with self._lock:
            await self._transition_to(CircuitState.CLOSED)
            self.metrics = CircuitBreakerMetrics()
            logger.info("circuit_breaker_reset", name=self.name)
    
    def get_status(self) -> Dict[str, Any]:
        """Get current circuit breaker status."""
        return {
            "name": self.name,
            "state": self._state.value,
            "opened_at": self._opened_at,
            "time_in_current_state": (
                time.time() - self._opened_at if self._opened_at else None
            ),
            "metrics": self.metrics.to_dict(),
            "config": {
                "failure_threshold": self.config.failure_threshold,
                "success_threshold": self.config.success_threshold,
                "recovery_timeout": self.config.recovery_timeout,
            }
        }


class CircuitBreakerRegistry:
    """Registry for managing multiple circuit breakers."""
    
    def __init__(self):
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._lock = asyncio.Lock()
    
    async def get_or_create(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None,
        fallback: Optional[Callable] = None
    ) -> CircuitBreaker:
        """Get existing circuit breaker or create new one."""
        async with self._lock:
            if name not in self._breakers:
                self._breakers[name] = CircuitBreaker(
                    name=name,
                    config=config,
                    fallback=fallback
                )
            return self._breakers[name]
    
    def get(self, name: str) -> Optional[CircuitBreaker]:
        """Get circuit breaker by name."""
        return self._breakers.get(name)
    
    async def reset_all(self) -> None:
        """Reset all circuit breakers."""
        for breaker in self._breakers.values():
            await breaker.reset()
    
    def get_all_status(self) -> Dict[str, Any]:
        """Get status of all circuit breakers."""
        return {
            name: breaker.get_status()
            for name, breaker in self._breakers.items()
        }


circuit_registry = CircuitBreakerRegistry()

redis_circuit = CircuitBreaker(
    name="redis",
    config=CircuitBreakerConfig(
        failure_threshold=3,
        recovery_timeout=10.0,
        success_threshold=2
    )
)

celery_circuit = CircuitBreaker(
    name="celery",
    config=CircuitBreakerConfig(
        failure_threshold=5,
        recovery_timeout=30.0,
        success_threshold=3
    )
)


def get_circuit_registry() -> CircuitBreakerRegistry:
    """Get global circuit breaker registry."""
    return circuit_registry


def get_redis_circuit() -> CircuitBreaker:
    """Get Redis circuit breaker."""
    return redis_circuit


def get_celery_circuit() -> CircuitBreaker:
    """Get Celery circuit breaker."""
    return celery_circuit


def circuit_breaker(
    name: str,
    failure_threshold: int = 5,
    recovery_timeout: float = 30.0,
    fallback: Optional[Callable] = None
):
    """
    Decorator factory for circuit breaker protection.
    
    Usage:
        @circuit_breaker("external_api")
        async def call_external_api():
            ...
    """
    config = CircuitBreakerConfig(
        failure_threshold=failure_threshold,
        recovery_timeout=recovery_timeout
    )
    
    breaker = CircuitBreaker(name=name, config=config, fallback=fallback)
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await breaker.call(func, *args, **kwargs)
        
        wrapper._circuit_breaker = breaker
        return wrapper
    
    return decorator
