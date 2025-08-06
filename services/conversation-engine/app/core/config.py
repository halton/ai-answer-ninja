"""
Configuration management for Conversation Engine service.
"""

import os
from functools import lru_cache
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration settings."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )
    
    # Server configuration
    host: str = Field(default="0.0.0.0", description="Server host")
    port: int = Field(default=3003, description="Server port")
    environment: str = Field(default="development", description="Environment")
    log_level: str = Field(default="INFO", description="Logging level")
    
    # CORS configuration
    cors_origins: List[str] = Field(
        default=["*"],
        description="Allowed CORS origins"
    )
    
    # Database configuration
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:password@localhost:5432/ai_answer_ninja",
        description="Database connection URL"
    )
    database_pool_size: int = Field(default=10, description="Database pool size")
    database_max_overflow: int = Field(default=20, description="Database max overflow")
    database_pool_timeout: int = Field(default=30, description="Database pool timeout")
    
    # Redis configuration
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL"
    )
    redis_pool_size: int = Field(default=10, description="Redis pool size")
    redis_timeout: int = Field(default=5, description="Redis timeout")
    
    # Azure OpenAI configuration
    azure_openai_endpoint: str = Field(
        description="Azure OpenAI endpoint"
    )
    azure_openai_api_key: str = Field(
        description="Azure OpenAI API key"
    )
    azure_openai_api_version: str = Field(
        default="2024-02-01",
        description="Azure OpenAI API version"
    )
    azure_openai_deployment_id: str = Field(
        default="gpt-4",
        description="Azure OpenAI deployment ID"
    )
    azure_openai_max_tokens: int = Field(
        default=200,
        description="Maximum tokens for OpenAI responses"
    )
    azure_openai_temperature: float = Field(
        default=0.7,
        description="Temperature for OpenAI responses"
    )
    
    # Azure Text Analytics configuration
    azure_text_analytics_endpoint: str = Field(
        description="Azure Text Analytics endpoint"
    )
    azure_text_analytics_key: str = Field(
        description="Azure Text Analytics key"
    )
    
    # Conversation configuration
    conversation_timeout: int = Field(
        default=300,
        description="Conversation timeout in seconds"
    )
    max_conversation_turns: int = Field(
        default=10,
        description="Maximum conversation turns"
    )
    response_cache_ttl: int = Field(
        default=3600,
        description="Response cache TTL in seconds"
    )
    personality_cache_ttl: int = Field(
        default=1800,
        description="Personality cache TTL in seconds"
    )
    
    # Performance settings
    max_concurrent_conversations: int = Field(
        default=100,
        description="Maximum concurrent conversations"
    )
    response_timeout: int = Field(
        default=5,
        description="Response generation timeout in seconds"
    )
    cache_preload_enabled: bool = Field(
        default=True,
        description="Enable cache preloading"
    )
    
    # AI model settings
    sentiment_model_name: str = Field(
        default="cardiffnlp/twitter-roberta-base-sentiment-latest",
        description="Sentiment analysis model name"
    )
    emotion_model_name: str = Field(
        default="j-hartmann/emotion-english-distilroberta-base",
        description="Emotion analysis model name"
    )
    
    # Security settings
    jwt_secret_key: str = Field(
        description="JWT secret key"
    )
    jwt_algorithm: str = Field(
        default="HS256",
        description="JWT algorithm"
    )
    jwt_expiration: int = Field(
        default=3600,
        description="JWT expiration time in seconds"
    )
    
    # Monitoring settings
    enable_metrics: bool = Field(
        default=True,
        description="Enable Prometheus metrics"
    )
    enable_tracing: bool = Field(
        default=True,
        description="Enable OpenTelemetry tracing"
    )
    metrics_port: int = Field(
        default=9090,
        description="Metrics server port"
    )
    
    # External service URLs
    user_management_service_url: str = Field(
        default="http://localhost:3005",
        description="User Management Service URL"
    )
    profile_analytics_service_url: str = Field(
        default="http://localhost:3004",
        description="Profile Analytics Service URL"
    )
    phone_gateway_service_url: str = Field(
        default="http://localhost:3001",
        description="Phone Gateway Service URL"
    )
    
    # Feature flags
    enable_personality_adaptation: bool = Field(
        default=True,
        description="Enable personality adaptation"
    )
    enable_emotion_detection: bool = Field(
        default=True,
        description="Enable emotion detection"
    )
    enable_learning_mode: bool = Field(
        default=True,
        description="Enable learning from conversations"
    )
    enable_advanced_termination: bool = Field(
        default=True,
        description="Enable advanced termination strategies"
    )


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()