"""
Configuration settings for Profile Analytics Service
"""

import os
from functools import lru_cache
from typing import List, Optional

from pydantic import Field, PostgresDsn, validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings"""
    
    # Basic settings
    environment: str = Field(default="development", env="ENVIRONMENT")
    debug: bool = Field(default=False, env="DEBUG")
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    
    # Server settings
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=3004, env="PORT")
    
    # Database settings
    database_url: PostgresDsn = Field(env="DATABASE_URL")
    database_pool_size: int = Field(default=10, env="DATABASE_POOL_SIZE")
    database_pool_overflow: int = Field(default=20, env="DATABASE_POOL_OVERFLOW")
    
    # Redis settings
    redis_url: str = Field(default="redis://localhost:6379/0", env="REDIS_URL")
    redis_prefix: str = Field(default="profile_analytics:", env="REDIS_PREFIX")
    cache_ttl: int = Field(default=3600, env="CACHE_TTL")  # 1 hour default
    
    # CORS settings
    cors_origins: List[str] = Field(
        default=["http://localhost:3000", "http://localhost:8080"],
        env="CORS_ORIGINS"
    )
    
    # Machine Learning settings
    ml_model_path: str = Field(default="./ml/models", env="ML_MODEL_PATH")
    ml_model_update_interval: int = Field(default=3600, env="ML_MODEL_UPDATE_INTERVAL")  # 1 hour
    feature_store_path: str = Field(default="./ml/features", env="FEATURE_STORE_PATH")
    
    # Azure Cognitive Services
    azure_cognitive_key: Optional[str] = Field(default=None, env="AZURE_COGNITIVE_KEY")
    azure_cognitive_endpoint: Optional[str] = Field(default=None, env="AZURE_COGNITIVE_ENDPOINT")
    azure_cognitive_region: str = Field(default="eastus2", env="AZURE_COGNITIVE_REGION")
    
    # Monitoring and metrics
    prometheus_metrics_path: str = Field(default="/metrics", env="PROMETHEUS_METRICS_PATH")
    health_check_timeout: int = Field(default=30, env="HEALTH_CHECK_TIMEOUT")
    
    # Service discovery and communication
    service_registry_url: str = Field(default="http://localhost:8500", env="SERVICE_REGISTRY_URL")
    user_management_url: str = Field(default="http://localhost:3005", env="USER_MANAGEMENT_URL")
    smart_whitelist_url: str = Field(default="http://localhost:3006", env="SMART_WHITELIST_URL")
    conversation_engine_url: str = Field(default="http://localhost:3003", env="CONVERSATION_ENGINE_URL")
    
    # Rate limiting
    rate_limit_requests: int = Field(default=1000, env="RATE_LIMIT_REQUESTS")
    rate_limit_window: int = Field(default=60, env="RATE_LIMIT_WINDOW")  # seconds
    
    # Background tasks and batch processing
    batch_size: int = Field(default=1000, env="BATCH_SIZE")
    batch_processing_interval: int = Field(default=300, env="BATCH_PROCESSING_INTERVAL")  # 5 minutes
    
    # Data retention settings
    profile_data_retention_days: int = Field(default=365, env="PROFILE_DATA_RETENTION_DAYS")
    call_data_retention_days: int = Field(default=90, env="CALL_DATA_RETENTION_DAYS")
    analytics_data_retention_days: int = Field(default=730, env="ANALYTICS_DATA_RETENTION_DAYS")  # 2 years
    
    # Security settings
    secret_key: str = Field(env="SECRET_KEY")
    algorithm: str = Field(default="HS256", env="ALGORITHM")
    access_token_expire_minutes: int = Field(default=30, env="ACCESS_TOKEN_EXPIRE_MINUTES")
    
    # Feature flags
    enable_real_time_profiling: bool = Field(default=True, env="ENABLE_REAL_TIME_PROFILING")
    enable_batch_learning: bool = Field(default=True, env="ENABLE_BATCH_LEARNING")
    enable_advanced_analytics: bool = Field(default=False, env="ENABLE_ADVANCED_ANALYTICS")
    enable_nlp_features: bool = Field(default=True, env="ENABLE_NLP_FEATURES")
    
    @validator("cors_origins", pre=True)
    def assemble_cors_origins(cls, v):
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings"""
    return Settings()