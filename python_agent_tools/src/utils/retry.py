"""Retry utilities with exponential backoff using tenacity."""

from functools import wraps
from typing import Any, Callable, Optional, Tuple, Type, Union
import asyncio
import logging
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
    RetryError,
)
import structlog

logger = structlog.get_logger(__name__)


def with_retry(
    max_attempts: int = 3,
    min_wait: float = 1.0,
    max_wait: float = 60.0,
    exponential_base: float = 2.0,
    retry_exceptions: Tuple[Type[Exception], ...] = (Exception,),
) -> Callable:
    """Decorator for synchronous functions with exponential backoff retry."""
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        @retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(multiplier=min_wait, max=max_wait, exp_base=exponential_base),
            retry=retry_if_exception_type(retry_exceptions),
            before_sleep=before_sleep_log(logger, logging.INFO),
            reraise=True,
        )
        def wrapper(*args, **kwargs) -> Any:
            return func(*args, **kwargs)
        return wrapper
    return decorator


def async_retry(
    max_attempts: int = 3,
    min_wait: float = 1.0,
    max_wait: float = 60.0,
    exponential_base: float = 2.0,
    retry_exceptions: Tuple[Type[Exception], ...] = (Exception,),
) -> Callable:
    """Decorator for async functions with exponential backoff retry."""
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        @retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(multiplier=min_wait, max=max_wait, exp_base=exponential_base),
            retry=retry_if_exception_type(retry_exceptions),
            before_sleep=before_sleep_log(logger, logging.INFO),
            reraise=True,
        )
        async def wrapper(*args, **kwargs) -> Any:
            return await func(*args, **kwargs)
        return wrapper
    return decorator


class RetryConfig:
    """Configuration class for retry behavior."""
    
    def __init__(
        self,
        max_attempts: int = 3,
        min_wait: float = 1.0,
        max_wait: float = 60.0,
        exponential_base: float = 2.0,
        retry_exceptions: Optional[Tuple[Type[Exception], ...]] = None,
    ):
        self.max_attempts = max_attempts
        self.min_wait = min_wait
        self.max_wait = max_wait
        self.exponential_base = exponential_base
        self.retry_exceptions = retry_exceptions or (Exception,)
    
    def get_retry_decorator(self, is_async: bool = False) -> Callable:
        """Get the appropriate retry decorator based on configuration."""
        if is_async:
            return async_retry(
                max_attempts=self.max_attempts,
                min_wait=self.min_wait,
                max_wait=self.max_wait,
                exponential_base=self.exponential_base,
                retry_exceptions=self.retry_exceptions,
            )
        return with_retry(
            max_attempts=self.max_attempts,
            min_wait=self.min_wait,
            max_wait=self.max_wait,
            exponential_base=self.exponential_base,
            retry_exceptions=self.retry_exceptions,
        )
