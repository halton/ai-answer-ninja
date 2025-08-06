"""
Analytics data models and schemas
"""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, Boolean, 
    JSON, Text, ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID
from pydantic import BaseModel, Field

from app.core.database import Base


class AnalysisType(str, Enum):
    """Types of analysis"""
    SPAM_DETECTION = "spam_detection"
    BEHAVIORAL_ANALYSIS = "behavioral_analysis"
    PATTERN_RECOGNITION = "pattern_recognition"
    SENTIMENT_ANALYSIS = "sentiment_analysis"
    TREND_ANALYSIS = "trend_analysis"
    EFFECTIVENESS_ANALYSIS = "effectiveness_analysis"


class AnalysisStatus(str, Enum):
    """Analysis status"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AnalysisJob(Base):
    """Analysis job tracking"""
    
    __tablename__ = "analysis_jobs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_type = Column(String(50), nullable=False, index=True)
    status = Column(String(20), nullable=False, default=AnalysisStatus.PENDING, index=True)
    
    # Job configuration
    config = Column(JSON, nullable=False)
    input_data = Column(JSON)
    
    # Results
    results = Column(JSON)
    metrics = Column(JSON)
    error_message = Column(Text)
    
    # Timing
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    duration_seconds = Column(Float)
    
    # Metadata
    created_by = Column(String(100))
    priority = Column(Integer, default=5)
    retry_count = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_jobs_status_priority', 'status', 'priority'),
        Index('idx_jobs_type_status', 'job_type', 'status'),
        Index('idx_jobs_created', 'created_at'),
    )


class UserAnalytics(Base):
    """User analytics and insights"""
    
    __tablename__ = "user_analytics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    analysis_date = Column(DateTime, nullable=False, index=True)
    
    # Call statistics
    total_calls = Column(Integer, default=0)
    spam_calls = Column(Integer, default=0)
    blocked_calls = Column(Integer, default=0)
    successful_responses = Column(Integer, default=0)
    
    # Performance metrics
    average_response_time = Column(Float)
    spam_detection_accuracy = Column(Float)
    user_satisfaction_score = Column(Float)
    ai_effectiveness_score = Column(Float)
    
    # Behavioral insights
    call_patterns = Column(JSON)
    response_patterns = Column(JSON)
    preference_changes = Column(JSON)
    
    # Predictions
    spam_risk_prediction = Column(Float)
    trend_indicators = Column(JSON)
    recommendations = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_user_analytics_user_date', 'user_id', 'analysis_date'),
    )


class SpamAnalytics(Base):
    """Spam analytics and patterns"""
    
    __tablename__ = "spam_analytics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_hash = Column(String(64), nullable=False, index=True)
    analysis_date = Column(DateTime, nullable=False, index=True)
    
    # Activity statistics
    total_attempts = Column(Integer, default=0)
    successful_contacts = Column(Integer, default=0)
    blocked_attempts = Column(Integer, default=0)
    user_reports = Column(Integer, default=0)
    
    # Pattern analysis
    temporal_patterns = Column(JSON)
    target_patterns = Column(JSON)
    behavior_evolution = Column(JSON)
    
    # Risk assessment
    current_risk_score = Column(Float)
    risk_trend = Column(String(20))  # increasing, decreasing, stable
    threat_level = Column(String(20))  # low, medium, high, critical
    
    # ML insights
    feature_importance = Column(JSON)
    anomaly_scores = Column(JSON)
    clustering_results = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_spam_analytics_hash_date', 'phone_hash', 'analysis_date'),
        Index('idx_spam_analytics_risk', 'current_risk_score'),
    )


class TrendAnalysis(Base):
    """System-wide trend analysis"""
    
    __tablename__ = "trend_analysis"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_type = Column(String(50), nullable=False, index=True)
    time_period = Column(String(20), nullable=False)  # daily, weekly, monthly
    period_start = Column(DateTime, nullable=False, index=True)
    period_end = Column(DateTime, nullable=False)
    
    # Trend data
    metrics = Column(JSON, nullable=False)
    trends = Column(JSON, nullable=False)
    anomalies = Column(JSON)
    forecasts = Column(JSON)
    
    # Insights
    key_findings = Column(JSON)
    recommendations = Column(JSON)
    alert_conditions = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_trends_type_period', 'analysis_type', 'period_start'),
    )


# Pydantic schemas

class AnalysisJobCreate(BaseModel):
    """Create analysis job schema"""
    job_type: AnalysisType
    config: Dict[str, Any]
    input_data: Optional[Dict[str, Any]] = None
    priority: int = Field(default=5, ge=1, le=10)
    created_by: Optional[str] = None


class AnalysisJobUpdate(BaseModel):
    """Update analysis job schema"""
    status: Optional[AnalysisStatus] = None
    results: Optional[Dict[str, Any]] = None
    metrics: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None


class AnalysisJobResponse(BaseModel):
    """Analysis job response schema"""
    id: uuid.UUID
    job_type: str
    status: str
    config: Dict[str, Any]
    results: Optional[Dict[str, Any]] = None
    metrics: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class UserAnalyticsCreate(BaseModel):
    """Create user analytics schema"""
    user_id: uuid.UUID
    analysis_date: datetime = Field(default_factory=datetime.utcnow)
    total_calls: int = 0
    spam_calls: int = 0
    blocked_calls: int = 0
    successful_responses: int = 0
    call_patterns: Optional[Dict[str, Any]] = None
    response_patterns: Optional[Dict[str, Any]] = None


class UserAnalyticsResponse(BaseModel):
    """User analytics response schema"""
    id: uuid.UUID
    user_id: uuid.UUID
    analysis_date: datetime
    total_calls: int
    spam_calls: int
    blocked_calls: int
    successful_responses: int
    average_response_time: Optional[float] = None
    spam_detection_accuracy: Optional[float] = None
    user_satisfaction_score: Optional[float] = None
    ai_effectiveness_score: Optional[float] = None
    call_patterns: Optional[Dict[str, Any]] = None
    response_patterns: Optional[Dict[str, Any]] = None
    spam_risk_prediction: Optional[float] = None
    trend_indicators: Optional[Dict[str, Any]] = None
    recommendations: Optional[Dict[str, Any]] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class AnalyticsRequest(BaseModel):
    """Analytics request schema"""
    user_id: Optional[uuid.UUID] = None
    phone_numbers: Optional[List[str]] = None
    analysis_types: List[AnalysisType] = [AnalysisType.BEHAVIORAL_ANALYSIS]
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = Field(default_factory=datetime.utcnow)
    include_predictions: bool = True
    include_recommendations: bool = True
    aggregation_level: str = Field(default="daily")  # hourly, daily, weekly, monthly


class AnalyticsResponse(BaseModel):
    """Comprehensive analytics response schema"""
    user_analytics: Optional[List[UserAnalyticsResponse]] = None
    spam_analytics: Optional[Dict[str, Any]] = None
    trend_analysis: Optional[Dict[str, Any]] = None
    predictions: Optional[Dict[str, Any]] = None
    recommendations: Optional[List[Dict[str, Any]]] = None
    insights: Dict[str, Any]
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class RealTimeAnalyticsRequest(BaseModel):
    """Real-time analytics request schema"""
    phone_number: str
    user_id: uuid.UUID
    call_data: Dict[str, Any]
    analysis_depth: str = Field(default="standard")  # basic, standard, deep
    return_predictions: bool = True


class RealTimeAnalyticsResponse(BaseModel):
    """Real-time analytics response schema"""
    spam_probability: float = Field(ge=0.0, le=1.0)
    spam_category: Optional[str] = None
    risk_level: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    behavioral_insights: Dict[str, Any]
    recommended_actions: List[Dict[str, Any]]
    processing_time_ms: float
    generated_at: datetime = Field(default_factory=datetime.utcnow)