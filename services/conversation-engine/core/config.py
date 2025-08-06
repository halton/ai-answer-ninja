import os
from typing import List, Optional
from pydantic import BaseSettings, Field
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    # Service configuration
    app_name: str = "conversation-engine"
    version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")
    port: int = Field(default=3003, env="PORT")
    host: str = Field(default="0.0.0.0", env="HOST")
    
    # Database configuration
    database_url: str = Field(env="DATABASE_URL")
    database_pool_size: int = Field(default=10, env="DATABASE_POOL_SIZE")
    database_max_overflow: int = Field(default=20, env="DATABASE_MAX_OVERFLOW")
    
    # Redis configuration
    redis_url: str = Field(env="REDIS_URL")
    redis_max_connections: int = Field(default=20, env="REDIS_MAX_CONNECTIONS")
    
    # Azure OpenAI configuration
    azure_openai_endpoint: str = Field(env="AZURE_OPENAI_ENDPOINT")
    azure_openai_key: str = Field(env="AZURE_OPENAI_KEY")
    azure_openai_api_version: str = Field(default="2023-12-01-preview", env="AZURE_OPENAI_API_VERSION")
    azure_openai_deployment_name: str = Field(default="gpt-4", env="AZURE_OPENAI_DEPLOYMENT_NAME")
    
    # Azure Text Analytics configuration
    azure_text_analytics_endpoint: str = Field(env="AZURE_TEXT_ANALYTICS_ENDPOINT")
    azure_text_analytics_key: str = Field(env="AZURE_TEXT_ANALYTICS_KEY")
    
    # Conversation settings
    max_conversation_history: int = Field(default=10, env="MAX_CONVERSATION_HISTORY")
    response_timeout_seconds: int = Field(default=5, env="RESPONSE_TIMEOUT_SECONDS")
    cache_ttl_seconds: int = Field(default=300, env="CACHE_TTL_SECONDS")
    
    # Performance settings
    max_concurrent_conversations: int = Field(default=100, env="MAX_CONCURRENT_CONVERSATIONS")
    response_cache_size: int = Field(default=1000, env="RESPONSE_CACHE_SIZE")
    
    # Security settings
    allowed_origins: List[str] = Field(default=["*"], env="ALLOWED_ORIGINS")
    jwt_secret_key: str = Field(env="JWT_SECRET_KEY")
    jwt_algorithm: str = Field(default="HS256", env="JWT_ALGORITHM")
    
    # Monitoring settings
    enable_prometheus: bool = Field(default=True, env="ENABLE_PROMETHEUS")
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    
    # AI model settings
    temperature: float = Field(default=0.7, env="AI_TEMPERATURE")
    max_tokens: int = Field(default=150, env="AI_MAX_TOKENS")
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()


# Export settings instance
settings = get_settings()
