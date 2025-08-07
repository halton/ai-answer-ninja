"""Data models for conversation analysis."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator
from sqlalchemy import Column, String, Text, DateTime, Integer, JSON, Boolean, DECIMAL
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.core.database import Base


# Database Models
class AnalysisResultDB(Base):
    """Database model for analysis results."""
    
    __tablename__ = "analysis_results"
    
    id = Column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    call_record_id = Column(PG_UUID(as_uuid=True), nullable=False, index=True)
    analysis_type = Column(String(50), nullable=False, index=True)
    results = Column(JSON, nullable=False)
    confidence_score = Column(DECIMAL(3, 2))
    processing_time_ms = Column(Integer)
    model_version = Column(String(20))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CallSummaryDB(Base):
    """Database model for call summaries."""
    
    __tablename__ = "call_summaries"
    
    id = Column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    call_record_id = Column(PG_UUID(as_uuid=True), nullable=False, unique=True, index=True)
    summary_text = Column(Text, nullable=False)
    key_events = Column(JSON)
    recommendations = Column(JSON)
    effectiveness_score = Column(DECIMAL(3, 2))
    sentiment_overview = Column(JSON)
    intent_categories = Column(JSON)
    duration_summary = Column(JSON)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TranscriptionDB(Base):
    """Database model for transcriptions."""
    
    __tablename__ = "transcriptions"
    
    id = Column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    call_record_id = Column(PG_UUID(as_uuid=True), nullable=False, unique=True, index=True)
    full_transcript = Column(Text, nullable=False)
    segments = Column(JSON)  # Timestamped segments
    language = Column(String(10))
    confidence_score = Column(DECIMAL(3, 2))
    processing_time_ms = Column(Integer)
    audio_duration_seconds = Column(Integer)
    word_count = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())


# Pydantic Models
class TranscriptionSegment(BaseModel):
    """Model for transcription segment."""
    
    start_time: float = Field(..., description="Segment start time in seconds")
    end_time: float = Field(..., description="Segment end time in seconds")
    text: str = Field(..., description="Transcribed text")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score")
    speaker: Optional[str] = Field(None, description="Speaker identifier")


class TranscriptionRequest(BaseModel):
    """Request model for transcription."""
    
    call_id: UUID = Field(..., description="Call record ID")
    audio_url: Optional[str] = Field(None, description="Audio file URL")
    audio_data: Optional[str] = Field(None, description="Base64 encoded audio data")
    language: str = Field(default="zh-CN", description="Audio language")
    
    @validator("audio_url", "audio_data")
    def validate_audio_source(cls, v, values):
        """Ensure at least one audio source is provided."""
        if not values.get("audio_url") and not v:
            raise ValueError("Either audio_url or audio_data must be provided")
        return v


class TranscriptionResponse(BaseModel):
    """Response model for transcription."""
    
    call_id: UUID
    full_transcript: str
    segments: List[TranscriptionSegment]
    language: str
    confidence_score: float
    processing_time_ms: int
    audio_duration_seconds: float
    word_count: int


class SentimentAnalysis(BaseModel):
    """Sentiment analysis results."""
    
    label: str = Field(..., description="Sentiment label")
    confidence: float = Field(..., ge=0.0, le=1.0)
    scores: Dict[str, float] = Field(..., description="Scores for all labels")
    emotion: Optional[str] = Field(None, description="Detected emotion")
    emotion_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)


class IntentRecognition(BaseModel):
    """Intent recognition results."""
    
    category: str = Field(..., description="Intent category")
    confidence: float = Field(..., ge=0.0, le=1.0)
    subcategory: Optional[str] = Field(None, description="Intent subcategory")
    keywords: List[str] = Field(default_factory=list, description="Key phrases")
    context_indicators: List[str] = Field(default_factory=list)


class EntityExtraction(BaseModel):
    """Named entity extraction results."""
    
    entities: List[Dict[str, Any]] = Field(default_factory=list)
    person_names: List[str] = Field(default_factory=list)
    organizations: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    phone_numbers: List[str] = Field(default_factory=list)
    amounts: List[Dict[str, Any]] = Field(default_factory=list)


class KeywordAnalysis(BaseModel):
    """Keyword extraction and analysis."""
    
    keywords: List[str] = Field(default_factory=list)
    phrases: List[str] = Field(default_factory=list)
    topic_categories: List[str] = Field(default_factory=list)
    spam_indicators: List[str] = Field(default_factory=list)
    urgency_indicators: List[str] = Field(default_factory=list)


class ContentAnalysisRequest(BaseModel):
    """Request model for content analysis."""
    
    call_id: UUID
    text: str = Field(..., min_length=1)
    language: str = Field(default="zh-CN")
    analysis_types: List[str] = Field(
        default=["sentiment", "intent", "entities", "keywords"],
        description="Types of analysis to perform"
    )
    user_context: Optional[Dict[str, Any]] = Field(None)


class ContentAnalysisResponse(BaseModel):
    """Response model for content analysis."""
    
    call_id: UUID
    sentiment: Optional[SentimentAnalysis] = None
    intent: Optional[IntentRecognition] = None
    entities: Optional[EntityExtraction] = None
    keywords: Optional[KeywordAnalysis] = None
    processing_time_ms: int
    confidence_score: float


class CallEffectivenessMetrics(BaseModel):
    """Call effectiveness evaluation metrics."""
    
    overall_score: float = Field(..., ge=0.0, le=1.0)
    ai_response_quality: float = Field(..., ge=0.0, le=1.0)
    conversation_flow: float = Field(..., ge=0.0, le=1.0)
    caller_satisfaction: float = Field(..., ge=0.0, le=1.0)
    termination_appropriateness: float = Field(..., ge=0.0, le=1.0)
    response_latency_score: float = Field(..., ge=0.0, le=1.0)
    contextual_awareness: float = Field(..., ge=0.0, le=1.0)


class CallSummary(BaseModel):
    """Call summary model."""
    
    call_id: UUID
    summary_text: str = Field(..., description="Concise call summary")
    key_events: List[str] = Field(default_factory=list)
    caller_intent: str
    ai_responses: List[str] = Field(default_factory=list)
    outcome: str = Field(..., description="Call outcome")
    effectiveness_metrics: CallEffectivenessMetrics
    sentiment_journey: List[Dict[str, Any]] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    duration_breakdown: Dict[str, float] = Field(default_factory=dict)


class SummaryGenerationRequest(BaseModel):
    """Request model for summary generation."""
    
    call_id: UUID
    include_recommendations: bool = Field(default=True)
    include_metrics: bool = Field(default=True)
    summary_style: str = Field(default="comprehensive", regex="^(brief|comprehensive|detailed)$")


class BatchAnalysisRequest(BaseModel):
    """Request model for batch analysis."""
    
    call_ids: List[UUID] = Field(..., min_items=1, max_items=100)
    analysis_types: List[str] = Field(
        default=["transcription", "content", "summary"],
        description="Types of analysis to perform"
    )
    priority: str = Field(default="normal", regex="^(low|normal|high)$")
    callback_url: Optional[str] = Field(None, description="Webhook URL for completion")


class BatchAnalysisResponse(BaseModel):
    """Response model for batch analysis."""
    
    task_id: UUID = Field(..., description="Batch task ID")
    call_count: int = Field(..., description="Number of calls to analyze")
    estimated_completion_time: int = Field(..., description="Estimated time in seconds")
    status: str = Field(default="queued")


class BatchTaskStatus(BaseModel):
    """Batch task status model."""
    
    task_id: UUID
    status: str = Field(..., regex="^(queued|processing|completed|failed|cancelled)$")
    progress: float = Field(..., ge=0.0, le=1.0)
    completed_calls: int
    total_calls: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    results: Optional[List[Dict[str, Any]]] = None
    error_message: Optional[str] = None


class PerformanceMetrics(BaseModel):
    """Performance metrics model."""
    
    operation: str
    average_latency_ms: float
    min_latency_ms: float
    max_latency_ms: float
    p95_latency_ms: float
    throughput_per_second: float
    error_rate: float
    cache_hit_rate: float
    total_requests: int
    time_period: str


class AnalysisError(BaseModel):
    """Error model for analysis operations."""
    
    error_code: str
    error_message: str
    operation: str
    call_id: Optional[UUID] = None
    timestamp: datetime
    retry_count: int = 0
    context: Optional[Dict[str, Any]] = None