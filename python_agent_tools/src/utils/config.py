"""Configuration management using pydantic-settings."""

from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    app_name: str = "python-agent-tools"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"
    
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    
    database_url: Optional[str] = None
    redis_url: Optional[str] = None
    
    pinecone_api_key: Optional[str] = None
    pinecone_environment: Optional[str] = None
    pinecone_index: Optional[str] = None
    
    max_retries: int = 3
    retry_delay: float = 1.0
    request_timeout: float = 30.0
    
    rate_limit_requests: int = 100
    rate_limit_period: int = 60


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
