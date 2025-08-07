"""Configuration settings for Conversation Analyzer Service."""

import os
from typing import Any, Dict, List, Optional

from pydantic import Field, validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""
    
    # Service Configuration
    service_name: str = Field(default="conversation-analyzer", env="SERVICE_NAME")
    service_port: int = Field(default=3010, env="SERVICE_PORT")
    service_host: str = Field(default="0.0.0.0", env="SERVICE_HOST")
    debug: bool = Field(default=False, env="DEBUG")
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    
    # Database Configuration
    database_url: str = Field(..., env="DATABASE_URL")
    redis_url: str = Field(default="redis://localhost:6379", env="REDIS_URL")
    
    # Azure Services Configuration
    azure_speech_key: str = Field(..., env="AZURE_SPEECH_KEY")
    azure_speech_region: str = Field(..., env="AZURE_SPEECH_REGION")
    azure_openai_endpoint: str = Field(..., env="AZURE_OPENAI_ENDPOINT")
    azure_openai_api_key: str = Field(..., env="AZURE_OPENAI_API_KEY")
    azure_openai_api_version: str = Field(default="2024-02-01", env="AZURE_OPENAI_API_VERSION")
    azure_openai_deployment_name: str = Field(default="gpt-4", env="AZURE_OPENAI_DEPLOYMENT_NAME")
    
    # Storage Configuration
    azure_storage_account: Optional[str] = Field(default=None, env="AZURE_STORAGE_ACCOUNT")
    azure_storage_key: Optional[str] = Field(default=None, env="AZURE_STORAGE_KEY")
    azure_storage_container: str = Field(default="audio-recordings", env="AZURE_STORAGE_CONTAINER")
    
    # ML Configuration
    huggingface_cache_dir: str = Field(default="/app/cache/huggingface", env="HUGGINGFACE_CACHE_DIR")
    spacy_model: str = Field(default="zh_core_web_sm", env="SPACY_MODEL")
    torch_device: str = Field(default="cpu", env="TORCH_DEVICE")
    
    # Performance Configuration
    max_audio_duration: int = Field(default=600, env="MAX_AUDIO_DURATION")  # seconds
    max_concurrent_analyses: int = Field(default=10, env="MAX_CONCURRENT_ANALYSES")
    cache_ttl: int = Field(default=3600, env="CACHE_TTL")  # seconds
    batch_size: int = Field(default=32, env="BATCH_SIZE")
    
    # Analysis Configuration
    confidence_threshold: float = Field(default=0.7, env="CONFIDENCE_THRESHOLD")
    sentiment_model: str = Field(default="cardiffnlp/twitter-roberta-base-sentiment-latest", env="SENTIMENT_MODEL")
    intent_model: str = Field(default="microsoft/DialoGPT-medium", env="INTENT_MODEL")
    
    # Service Integration
    profile_analytics_url: str = Field(default="http://profile-analytics:3004", env="PROFILE_ANALYTICS_URL")
    realtime_processor_url: str = Field(default="http://realtime-processor:3002", env="REALTIME_PROCESSOR_URL")
    conversation_engine_url: str = Field(default="http://conversation-engine:3003", env="CONVERSATION_ENGINE_URL")
    user_management_url: str = Field(default="http://user-management:3005", env="USER_MANAGEMENT_URL")
    
    # Security Configuration
    secret_key: str = Field(..., env="SECRET_KEY")
    access_token_expire_minutes: int = Field(default=30, env="ACCESS_TOKEN_EXPIRE_MINUTES")
    allowed_origins: List[str] = Field(default=["*"], env="ALLOWED_ORIGINS")
    
    # Monitoring Configuration
    enable_metrics: bool = Field(default=True, env="ENABLE_METRICS")
    metrics_port: int = Field(default=8000, env="METRICS_PORT")
    sentry_dsn: Optional[str] = Field(default=None, env="SENTRY_DSN")
    
    @validator("allowed_origins", pre=True)
    def validate_allowed_origins(cls, v):
        """Validate and parse allowed origins."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v
    
    @validator("log_level")
    def validate_log_level(cls, v):
        """Validate log level."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if v.upper() not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v.upper()
    
    @validator("torch_device")
    def validate_torch_device(cls, v):
        """Validate torch device."""
        if v not in ["cpu", "cuda", "mps"]:
            return "cpu"  # Default to CPU if invalid
        return v
    
    class Config:
        """Pydantic config."""
        env_file = ".env"
        case_sensitive = False


class MLModelConfig:
    """Machine Learning model configurations."""
    
    # Intent Recognition Models
    INTENT_CATEGORIES = [
        "sales_call",
        "loan_offer", 
        "investment_pitch",
        "insurance_sales",
        "debt_collection",
        "survey_request",
        "scam_attempt",
        "legitimate_business",
        "unknown"
    ]
    
    # Sentiment Analysis Labels
    SENTIMENT_LABELS = [
        "positive",
        "negative", 
        "neutral",
        "frustrated",
        "aggressive",
        "confused"
    ]
    
    # Audio Processing Config
    SAMPLE_RATE = 16000
    CHUNK_DURATION = 1.0  # seconds
    VAD_AGGRESSIVENESS = 2  # 0-3, higher = more aggressive
    
    # NLP Processing Config
    MAX_TEXT_LENGTH = 512
    MIN_TEXT_LENGTH = 10
    LANGUAGE_CODES = ["zh-CN", "en-US", "zh-TW"]
    
    # Feature Extraction
    AUDIO_FEATURES = [
        "mfcc",
        "spectral_centroid",
        "zero_crossing_rate",
        "tempo",
        "chroma",
        "spectral_rolloff"
    ]
    
    # Performance Thresholds
    TRANSCRIPTION_CONFIDENCE_MIN = 0.6
    SENTIMENT_CONFIDENCE_MIN = 0.5
    INTENT_CONFIDENCE_MIN = 0.7


class CacheConfig:
    """Cache configuration."""
    
    # Cache Keys Prefixes
    TRANSCRIPTION_PREFIX = "transcription:"
    ANALYSIS_PREFIX = "analysis:"
    SUMMARY_PREFIX = "summary:"
    USER_PROFILE_PREFIX = "user_profile:"
    CALL_CONTEXT_PREFIX = "call_context:"
    
    # TTL Settings (seconds)
    TRANSCRIPTION_TTL = 1800  # 30 minutes
    ANALYSIS_TTL = 3600      # 1 hour
    SUMMARY_TTL = 86400      # 24 hours
    USER_PROFILE_TTL = 7200  # 2 hours
    CALL_CONTEXT_TTL = 900   # 15 minutes
    
    # Cache Sizes
    MAX_CACHE_SIZE = 1000
    MEMORY_CACHE_SIZE = 100


# Global settings instance
settings = Settings()