"""Configuration management with environment variables."""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    app_name: str = "IliaGPT SSE Backend"
    debug: bool = False
    
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    redis_max_connections: int = Field(default=50, alias="REDIS_MAX_CONNECTIONS")
    redis_socket_timeout: float = Field(default=5.0, alias="REDIS_SOCKET_TIMEOUT")
    
    celery_broker_url: Optional[str] = Field(default=None, alias="CELERY_BROKER_URL")
    celery_result_backend: Optional[str] = Field(default=None, alias="CELERY_RESULT_BACKEND")
    
    session_ttl_seconds: int = Field(default=3600, alias="SESSION_TTL_SECONDS")
    sse_heartbeat_interval: float = Field(default=15.0, alias="SSE_HEARTBEAT_INTERVAL")
    sse_heartbeat_sec: float = Field(default=15.0, alias="SSE_HEARTBEAT_SEC")
    sse_idle_timeout_sec: float = Field(default=300.0, alias="SSE_IDLE_TIMEOUT_SEC")
    sse_client_timeout: float = Field(default=300.0, alias="SSE_CLIENT_TIMEOUT")
    sse_max_queue_size: int = Field(default=100, alias="SSE_MAX_QUEUE_SIZE")
    
    stream_block_timeout_ms: int = Field(default=5000, alias="STREAM_BLOCK_TIMEOUT_MS")
    stream_max_pending_claim_age_ms: int = Field(default=30000, alias="STREAM_MAX_PENDING_CLAIM_AGE_MS")
    lock_ttl_seconds: int = Field(default=30, alias="LOCK_TTL_SECONDS")
    
    rate_limit_requests: int = Field(default=60, alias="RATE_LIMIT_REQUESTS")
    rate_limit_window: int = Field(default=60, alias="RATE_LIMIT_WINDOW")
    rate_limit_window_sec: int = Field(default=60, alias="RATE_LIMIT_WINDOW_SEC")
    rate_limit_stream_requests: int = Field(default=30, alias="RATE_LIMIT_STREAM_REQUESTS")
    rate_limit_stream_window_sec: int = Field(default=60, alias="RATE_LIMIT_STREAM_WINDOW_SEC")
    
    sse_max_buffer_size: int = Field(default=100, alias="SSE_MAX_BUFFER_SIZE")
    sse_write_timeout: float = Field(default=5.0, alias="SSE_WRITE_TIMEOUT")
    
    circuit_breaker_failure_threshold: int = Field(default=5, alias="CIRCUIT_BREAKER_FAILURE_THRESHOLD")
    circuit_breaker_recovery_timeout: float = Field(default=30.0, alias="CIRCUIT_BREAKER_RECOVERY_TIMEOUT")
    circuit_breaker_success_threshold: int = Field(default=2, alias="CIRCUIT_BREAKER_SUCCESS_THRESHOLD")
    
    agent_task_timeout: int = Field(default=120, alias="AGENT_TASK_TIMEOUT")
    agent_max_retries: int = Field(default=3, alias="AGENT_MAX_RETRIES")
    
    workers: int = Field(default=4, alias="WORKERS")
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    
    @property
    def celery_broker(self) -> str:
        return self.celery_broker_url or self.redis_url
    
    @property
    def celery_backend(self) -> str:
        return self.celery_result_backend or self.redis_url
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
