"""
Profile data models and schemas
"""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, Boolean, 
    JSON, Text, ForeignKey, Index, CheckConstraint
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from pydantic import BaseModel, Field, validator

from app.core.database import Base


class SpamCategory(str, Enum):
    """Spam categories"""
    SALES = "sales_call"
    LOAN_OFFER = "loan_offer"
    INVESTMENT = "investment_pitch"
    INSURANCE = "insurance_sales"
    REAL_ESTATE = "real_estate"
    MARKETING = "marketing"
    SURVEY = "survey"
    POLITICAL = "political"
    CHARITY = "charity"
    UNKNOWN = "unknown"


class RiskLevel(str, Enum):
    """Risk levels for spam profiles"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SpamProfile(Base):
    """Spam profile database model"""
    
    __tablename__ = "spam_profiles"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_hash = Column(String(64), unique=True, nullable=False, index=True)
    spam_category = Column(String(50), nullable=False, index=True)
    risk_score = Column(Float, nullable=False, default=0.5)
    confidence_level = Column(Float, nullable=False, default=0.5)
    
    # ML Feature vectors and patterns
    feature_vector = Column(JSON)
    behavioral_patterns = Column(JSON)
    linguistic_features = Column(JSON)
    temporal_patterns = Column(JSON)
    
    # Statistics
    total_reports = Column(Integer, default=1)
    successful_blocks = Column(Integer, default=0)
    bypass_attempts = Column(Integer, default=0)
    
    # Metadata
    last_activity = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user_interactions = relationship("UserSpamInteraction", back_populates="spam_profile")
    
    # Constraints and indexes
    __table_args__ = (
        CheckConstraint('risk_score >= 0.0 AND risk_score <= 1.0', name='risk_score_range'),
        CheckConstraint('confidence_level >= 0.0 AND confidence_level <= 1.0', name='confidence_range'),
        Index('idx_spam_profiles_category_risk', 'spam_category', 'risk_score'),
        Index('idx_spam_profiles_activity', 'last_activity'),
    )


class UserSpamInteraction(Base):
    """User-spam interaction database model"""
    
    __tablename__ = "user_spam_interactions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    spam_profile_id = Column(UUID(as_uuid=True), ForeignKey('spam_profiles.id'), nullable=False)
    
    # Interaction data
    interaction_count = Column(Integer, default=1)
    last_interaction = Column(DateTime, nullable=False, default=datetime.utcnow)
    user_feedback = Column(String(20))  # 'spam', 'not_spam', 'unknown'
    effectiveness_score = Column(Float)  # How well AI handled this spam
    
    # Response patterns
    response_patterns = Column(JSON)
    call_outcomes = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    spam_profile = relationship("SpamProfile", back_populates="user_interactions")
    
    __table_args__ = (
        Index('idx_user_interactions_user_time', 'user_id', 'last_interaction'),
    )


class UserProfile(Base):
    """Enhanced user profile database model"""
    
    __tablename__ = "user_profiles"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), unique=True, nullable=False, index=True)
    
    # Basic profile data
    personality_type = Column(String(20), default="polite")  # polite, direct, humorous
    communication_style = Column(String(20), default="formal")  # formal, casual, professional
    response_preferences = Column(JSON)
    
    # Behavioral analytics
    call_patterns = Column(JSON)
    response_effectiveness = Column(JSON)
    spam_tolerance = Column(Float, default=0.5)
    
    # Learning data
    preferred_strategies = Column(ARRAY(String))
    avoided_strategies = Column(ARRAY(String))
    success_metrics = Column(JSON)
    
    # Temporal patterns
    active_hours = Column(JSON)
    timezone = Column(String(50))
    weekly_patterns = Column(JSON)
    
    # Privacy and preferences
    data_sharing_consent = Column(Boolean, default=False)
    analytics_level = Column(String(20), default="basic")  # basic, standard, advanced
    retention_preference = Column(Integer, default=90)  # days
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_user_profiles_personality', 'personality_type'),
        Index('idx_user_profiles_updated', 'updated_at'),
    )


class FeatureStore(Base):
    """Feature store for ML models"""
    
    __tablename__ = "feature_store"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feature_name = Column(String(100), nullable=False, index=True)
    feature_type = Column(String(50), nullable=False)  # numeric, categorical, text, temporal
    feature_value = Column(JSON, nullable=False)
    
    # Context
    entity_id = Column(String(100), nullable=False, index=True)  # phone_hash, user_id, etc.
    entity_type = Column(String(50), nullable=False)  # spam_profile, user_profile, call
    
    # Metadata
    version = Column(String(20), default="1.0")
    source = Column(String(100))  # feature extraction source
    quality_score = Column(Float)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_features_entity', 'entity_id', 'entity_type'),
        Index('idx_features_name_type', 'feature_name', 'feature_type'),
    )


# Pydantic schemas for API

class SpamProfileBase(BaseModel):
    """Base spam profile schema"""
    spam_category: SpamCategory
    risk_score: float = Field(ge=0.0, le=1.0)
    confidence_level: float = Field(ge=0.0, le=1.0)
    feature_vector: Optional[Dict[str, Any]] = None
    behavioral_patterns: Optional[Dict[str, Any]] = None
    
    @validator('risk_score', 'confidence_level')
    def validate_scores(cls, v):
        return round(v, 3)


class SpamProfileCreate(SpamProfileBase):
    """Create spam profile schema"""
    phone_hash: str = Field(min_length=32, max_length=64)


class SpamProfileUpdate(BaseModel):
    """Update spam profile schema"""
    spam_category: Optional[SpamCategory] = None
    risk_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    confidence_level: Optional[float] = Field(None, ge=0.0, le=1.0)
    feature_vector: Optional[Dict[str, Any]] = None
    behavioral_patterns: Optional[Dict[str, Any]] = None
    total_reports: Optional[int] = None


class SpamProfileResponse(SpamProfileBase):
    """Spam profile response schema"""
    id: uuid.UUID
    phone_hash: str
    total_reports: int
    successful_blocks: int
    bypass_attempts: int
    last_activity: datetime
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class UserProfileBase(BaseModel):
    """Base user profile schema"""
    personality_type: str = "polite"
    communication_style: str = "formal"
    response_preferences: Optional[Dict[str, Any]] = None
    spam_tolerance: float = Field(default=0.5, ge=0.0, le=1.0)


class UserProfileCreate(UserProfileBase):
    """Create user profile schema"""
    user_id: uuid.UUID


class UserProfileUpdate(BaseModel):
    """Update user profile schema"""
    personality_type: Optional[str] = None
    communication_style: Optional[str] = None
    response_preferences: Optional[Dict[str, Any]] = None
    call_patterns: Optional[Dict[str, Any]] = None
    response_effectiveness: Optional[Dict[str, Any]] = None
    spam_tolerance: Optional[float] = Field(None, ge=0.0, le=1.0)
    preferred_strategies: Optional[List[str]] = None
    avoided_strategies: Optional[List[str]] = None


class UserProfileResponse(UserProfileBase):
    """User profile response schema"""
    id: uuid.UUID
    user_id: uuid.UUID
    call_patterns: Optional[Dict[str, Any]] = None
    response_effectiveness: Optional[Dict[str, Any]] = None
    preferred_strategies: Optional[List[str]] = None
    avoided_strategies: Optional[List[str]] = None
    success_metrics: Optional[Dict[str, Any]] = None
    active_hours: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ProfileAnalyticsRequest(BaseModel):
    """Profile analytics request schema"""
    user_id: Optional[uuid.UUID] = None
    phone_numbers: Optional[List[str]] = None
    analysis_type: str = Field(default="comprehensive")  # basic, comprehensive, real_time
    include_predictions: bool = True
    include_recommendations: bool = True
    time_range_days: int = Field(default=30, ge=1, le=365)


class ProfileAnalyticsResponse(BaseModel):
    """Profile analytics response schema"""
    user_profile: Optional[UserProfileResponse] = None
    spam_profiles: List[SpamProfileResponse] = []
    analytics: Dict[str, Any]
    predictions: Optional[Dict[str, Any]] = None
    recommendations: Optional[List[Dict[str, Any]]] = None
    generated_at: datetime = Field(default_factory=datetime.utcnow)