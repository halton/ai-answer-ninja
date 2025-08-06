"""
Call data models and schemas for analytics
"""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, Boolean, 
    JSON, Text, Index
)
from sqlalchemy.dialects.postgresql import UUID
from pydantic import BaseModel, Field, validator

from app.core.database import Base


class CallOutcome(str, Enum):
    """Call outcome types"""
    BLOCKED_SUCCESSFULLY = "blocked_successfully"
    TRANSFERRED_TO_USER = "transferred_to_user"
    HANDLED_BY_AI = "handled_by_ai"
    CALLER_HUNG_UP = "caller_hung_up"
    SYSTEM_ERROR = "system_error"
    INCOMPLETE = "incomplete"


class CallType(str, Enum):
    """Call types"""
    SPAM = "spam"
    LEGITIMATE = "legitimate"
    UNKNOWN = "unknown"
    WHITELISTED = "whitelisted"


class ProcessedCallData(Base):
    """Processed call data for analytics"""
    
    __tablename__ = "processed_call_data"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    call_id = Column(String(100), unique=True, nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    # Call basic info
    caller_phone_hash = Column(String(64), nullable=False, index=True)
    call_type = Column(String(20), nullable=False, index=True)
    call_outcome = Column(String(30), nullable=False, index=True)
    
    # Timing data
    start_time = Column(DateTime, nullable=False, index=True)
    end_time = Column(DateTime)
    duration_seconds = Column(Integer)
    response_time_ms = Column(Integer)  # Time to first AI response
    
    # Audio analysis
    audio_features = Column(JSON)
    speech_patterns = Column(JSON)
    emotional_indicators = Column(JSON)
    voice_characteristics = Column(JSON)
    
    # Content analysis
    transcript_summary = Column(Text)
    intent_classification = Column(JSON)
    sentiment_analysis = Column(JSON)
    topic_extraction = Column(JSON)
    language_features = Column(JSON)
    
    # AI performance
    ai_responses = Column(JSON)
    response_effectiveness = Column(JSON)
    conversation_flow = Column(JSON)
    termination_reason = Column(String(50))
    
    # Spam detection results
    spam_indicators = Column(JSON)
    risk_factors = Column(JSON)
    detection_confidence = Column(Float)
    false_positive_flag = Column(Boolean, default=False)
    
    # User feedback
    user_rating = Column(Integer)  # 1-5 scale
    user_feedback = Column(Text)
    reported_as_spam = Column(Boolean)
    
    # Processing metadata
    processed_at = Column(DateTime, default=datetime.utcnow)
    processing_version = Column(String(10), default="1.0")
    data_quality_score = Column(Float)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_call_data_user_time', 'user_id', 'start_time'),
        Index('idx_call_data_phone_time', 'caller_phone_hash', 'start_time'),
        Index('idx_call_data_type_outcome', 'call_type', 'call_outcome'),
    )


class ConversationAnalysis(Base):
    """Detailed conversation analysis"""
    
    __tablename__ = "conversation_analysis"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    call_id = Column(String(100), nullable=False, index=True)
    
    # Conversation structure
    turn_count = Column(Integer)
    average_turn_length = Column(Float)
    conversation_coherence = Column(Float)
    topic_shifts = Column(JSON)
    
    # Speaker analysis
    caller_characteristics = Column(JSON)
    ai_performance_metrics = Column(JSON)
    interaction_patterns = Column(JSON)
    
    # Effectiveness metrics
    spam_detection_accuracy = Column(Float)
    response_appropriateness = Column(Float)
    conversation_success_score = Column(Float)
    termination_effectiveness = Column(Float)
    
    # Learning insights
    successful_strategies = Column(JSON)
    failed_strategies = Column(JSON)
    improvement_suggestions = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)


class CallPattern(Base):
    """Call patterns and trends"""
    
    __tablename__ = "call_patterns"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pattern_type = Column(String(50), nullable=False, index=True)  # temporal, behavioral, linguistic
    entity_id = Column(String(100), nullable=False, index=True)  # phone_hash or user_id
    entity_type = Column(String(20), nullable=False)  # caller or user
    
    # Pattern data
    pattern_data = Column(JSON, nullable=False)
    pattern_strength = Column(Float)  # 0-1 confidence in pattern
    frequency = Column(Integer)  # How often this pattern occurs
    
    # Time bounds
    first_observed = Column(DateTime, nullable=False)
    last_observed = Column(DateTime, nullable=False)
    observation_count = Column(Integer, default=1)
    
    # Context
    associated_outcomes = Column(JSON)
    effectiveness_metrics = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_patterns_entity', 'entity_id', 'entity_type'),
        Index('idx_patterns_type_strength', 'pattern_type', 'pattern_strength'),
    )


# Pydantic schemas

class CallDataCreate(BaseModel):
    """Create processed call data schema"""
    call_id: str
    user_id: uuid.UUID
    caller_phone_hash: str
    call_type: CallType
    call_outcome: CallOutcome
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    response_time_ms: Optional[int] = None
    
    @validator('caller_phone_hash')
    def validate_phone_hash(cls, v):
        if len(v) < 32:
            raise ValueError('Phone hash too short')
        return v


class CallDataUpdate(BaseModel):
    """Update call data schema"""
    end_time: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    call_outcome: Optional[CallOutcome] = None
    audio_features: Optional[Dict[str, Any]] = None
    transcript_summary: Optional[str] = None
    intent_classification: Optional[Dict[str, Any]] = None
    sentiment_analysis: Optional[Dict[str, Any]] = None
    ai_responses: Optional[Dict[str, Any]] = None
    spam_indicators: Optional[Dict[str, Any]] = None
    detection_confidence: Optional[float] = None
    user_rating: Optional[int] = Field(None, ge=1, le=5)
    user_feedback: Optional[str] = None


class CallDataResponse(BaseModel):
    """Call data response schema"""
    id: uuid.UUID
    call_id: str
    user_id: uuid.UUID
    caller_phone_hash: str
    call_type: str
    call_outcome: str
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    response_time_ms: Optional[int] = None
    transcript_summary: Optional[str] = None
    detection_confidence: Optional[float] = None
    user_rating: Optional[int] = None
    processed_at: datetime
    created_at: datetime
    
    class Config:
        from_attributes = True


class ConversationAnalysisCreate(BaseModel):
    """Create conversation analysis schema"""
    call_id: str
    turn_count: int
    average_turn_length: Optional[float] = None
    conversation_coherence: Optional[float] = None
    caller_characteristics: Optional[Dict[str, Any]] = None
    ai_performance_metrics: Optional[Dict[str, Any]] = None


class ConversationAnalysisResponse(BaseModel):
    """Conversation analysis response schema"""
    id: uuid.UUID
    call_id: str
    turn_count: int
    average_turn_length: Optional[float] = None
    conversation_coherence: Optional[float] = None
    spam_detection_accuracy: Optional[float] = None
    response_appropriateness: Optional[float] = None
    conversation_success_score: Optional[float] = None
    successful_strategies: Optional[Dict[str, Any]] = None
    failed_strategies: Optional[Dict[str, Any]] = None
    improvement_suggestions: Optional[Dict[str, Any]] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class CallPatternCreate(BaseModel):
    """Create call pattern schema"""
    pattern_type: str
    entity_id: str
    entity_type: str = Field(regex='^(caller|user)$')
    pattern_data: Dict[str, Any]
    pattern_strength: float = Field(ge=0.0, le=1.0)
    frequency: int = Field(ge=1)
    first_observed: datetime
    last_observed: datetime


class CallPatternResponse(BaseModel):
    """Call pattern response schema"""
    id: uuid.UUID
    pattern_type: str
    entity_id: str
    entity_type: str
    pattern_data: Dict[str, Any]
    pattern_strength: float
    frequency: int
    first_observed: datetime
    last_observed: datetime
    observation_count: int
    associated_outcomes: Optional[Dict[str, Any]] = None
    effectiveness_metrics: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class CallAnalysisRequest(BaseModel):
    """Call analysis request schema"""
    call_id: str
    analysis_types: List[str] = ["basic", "conversation", "pattern"]
    include_ml_insights: bool = True
    include_recommendations: bool = True


class CallAnalysisResponse(BaseModel):
    """Comprehensive call analysis response"""
    call_data: CallDataResponse
    conversation_analysis: Optional[ConversationAnalysisResponse] = None
    patterns: List[CallPatternResponse] = []
    ml_insights: Optional[Dict[str, Any]] = None
    recommendations: Optional[List[Dict[str, Any]]] = None
    analysis_summary: Dict[str, Any]
    generated_at: datetime = Field(default_factory=datetime.utcnow)