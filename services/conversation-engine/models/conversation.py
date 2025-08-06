from datetime import datetime
from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from sqlalchemy import Column, String, Text, Integer, Float, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from pydantic import BaseModel, Field, validator
from enum import Enum

from ..core.database import Base


class ConversationStage(str, Enum):
    """Conversation stage enumeration."""
    INITIAL = "initial"
    HANDLING_SALES = "handling_sales"
    HANDLING_LOAN = "handling_loan"
    HANDLING_INVESTMENT = "handling_investment"
    HANDLING_INSURANCE = "handling_insurance"
    FIRM_REJECTION = "firm_rejection"
    POLITE_DECLINE = "polite_decline"
    HANG_UP_WARNING = "hang_up_warning"
    CALL_END = "call_end"


class EmotionalState(str, Enum):
    """Emotional state enumeration."""
    NEUTRAL = "neutral"
    FRIENDLY = "friendly"
    ANNOYED = "annoyed"
    FRUSTRATED = "frustrated"
    PATIENT = "patient"
    FIRM = "firm"
    POLITE = "polite"
    DISMISSIVE = "dismissive"


class IntentCategory(str, Enum):
    """Intent category enumeration."""
    SALES_CALL = "sales_call"
    LOAN_OFFER = "loan_offer"
    INVESTMENT_PITCH = "investment_pitch"
    INSURANCE_SALES = "insurance_sales"
    SURVEY = "survey"
    SCAM = "scam"
    UNKNOWN = "unknown"
    GOODBYE = "goodbye"
    QUESTION = "question"
    PERSISTENCE = "persistence"


# Database Models
class ConversationSession(Base):
    """Database model for conversation sessions."""
    __tablename__ = "conversation_sessions"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    call_id = Column(String(100), unique=True, nullable=False, index=True)
    user_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    caller_phone = Column(String(20), nullable=False)
    
    # Session metadata
    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime)
    duration_seconds = Column(Integer)
    turn_count = Column(Integer, default=0)
    
    # Conversation state
    current_stage = Column(String(50), default=ConversationStage.INITIAL)
    emotional_state = Column(String(50), default=EmotionalState.NEUTRAL)
    intent_category = Column(String(50))
    
    # Performance metrics
    avg_response_time_ms = Column(Float)
    total_cache_hits = Column(Integer, default=0)
    total_cache_misses = Column(Integer, default=0)
    
    # Conversation data
    conversation_history = Column(JSON)
    context_data = Column(JSON)
    final_summary = Column(Text)
    
    # Status
    is_active = Column(Boolean, default=True)
    termination_reason = Column(String(100))
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConversationTurn(Base):
    """Database model for individual conversation turns."""
    __tablename__ = "conversation_turns"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    turn_number = Column(Integer, nullable=False)
    
    # Turn content
    speaker = Column(String(10), nullable=False)  # 'user' or 'ai'
    input_text = Column(Text)
    response_text = Column(Text)
    
    # AI processing data
    detected_intent = Column(String(50))
    intent_confidence = Column(Float)
    emotional_tone = Column(String(50))
    emotional_confidence = Column(Float)
    
    # Performance metrics
    processing_time_ms = Column(Float)
    response_cached = Column(Boolean, default=False)
    
    # Metadata
    context_hash = Column(String(64))
    response_strategy = Column(String(100))
    
    timestamp = Column(DateTime, default=datetime.utcnow)


# Pydantic Models
class ConversationMessage(BaseModel):
    """Pydantic model for conversation messages."""
    speaker: str = Field(..., regex="^(user|ai)$")
    text: str = Field(..., min_length=1, max_length=2000)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    intent: Optional[IntentCategory] = None
    intent_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    emotion: Optional[EmotionalState] = None
    emotion_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    processing_time_ms: Optional[float] = Field(None, ge=0.0)
    cached: bool = False


class ConversationContext(BaseModel):
    """Pydantic model for conversation context."""
    call_id: str = Field(..., min_length=1, max_length=100)
    user_id: UUID
    caller_phone: str = Field(..., min_length=10, max_length=20)
    conversation_history: List[ConversationMessage] = Field(default_factory=list, max_items=50)
    current_stage: ConversationStage = ConversationStage.INITIAL
    emotional_state: EmotionalState = EmotionalState.NEUTRAL
    turn_count: int = Field(default=0, ge=0)
    start_time: datetime = Field(default_factory=datetime.utcnow)
    user_profile: Optional[Dict[str, Any]] = None
    spam_category: Optional[str] = None
    
    @validator('conversation_history')
    def validate_history_length(cls, v):
        if len(v) > 50:
            return v[-50:]  # Keep only last 50 messages
        return v


class ConversationState(BaseModel):
    """Pydantic model for conversation state tracking."""
    stage: ConversationStage
    emotional_state: EmotionalState
    intent_history: List[IntentCategory] = Field(default_factory=list, max_items=10)
    persistence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    frustration_level: float = Field(default=0.0, ge=0.0, le=1.0)
    response_effectiveness: float = Field(default=0.5, ge=0.0, le=1.0)
    should_terminate: bool = False
    termination_reason: Optional[str] = None
    
    # Performance tracking
    total_response_time_ms: float = Field(default=0.0, ge=0.0)
    cache_hit_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    
    # Learning data
    successful_strategies: List[str] = Field(default_factory=list)
    failed_strategies: List[str] = Field(default_factory=list)


class AIResponse(BaseModel):
    """Pydantic model for AI response data."""
    text: str = Field(..., min_length=1, max_length=500)
    intent: IntentCategory
    confidence: float = Field(..., ge=0.0, le=1.0)
    emotional_tone: EmotionalState
    response_strategy: str
    should_terminate: bool = False
    next_stage: Optional[ConversationStage] = None
    
    # Performance data
    generation_time_ms: float = Field(..., ge=0.0)
    cached: bool = False
    cache_key: Optional[str] = None
    
    # Metadata
    context_hash: str
    model_version: str = "gpt-4"
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    
    class Config:
        use_enum_values = True


class ConversationAnalytics(BaseModel):
    """Pydantic model for conversation analytics."""
    session_id: UUID
    call_id: str
    user_id: UUID
    
    # Duration metrics
    total_duration_seconds: int
    avg_response_time_ms: float
    max_response_time_ms: float
    
    # Conversation metrics
    total_turns: int
    user_turns: int
    ai_turns: int
    
    # Intent analysis
    primary_intent: IntentCategory
    intent_confidence: float
    intent_changes: int
    
    # Emotional analysis
    emotional_journey: List[EmotionalState]
    final_emotional_state: EmotionalState
    emotional_stability: float  # 0-1, higher = more stable
    
    # Performance metrics
    cache_hit_rate: float
    total_cache_hits: int
    total_cache_misses: int
    
    # Effectiveness scores
    conversation_effectiveness: float  # 0-1
    termination_appropriateness: float  # 0-1
    response_relevance: float  # 0-1
    
    # Learning insights
    successful_strategies: List[str]
    improvement_suggestions: List[str]
    
    class Config:
        use_enum_values = True


class ConversationRequest(BaseModel):
    """Request model for conversation management."""
    call_id: str = Field(..., min_length=1, max_length=100)
    user_id: UUID
    caller_phone: str = Field(..., min_length=10, max_length=20)
    input_text: str = Field(..., min_length=1, max_length=2000)
    detected_intent: Optional[IntentCategory] = None
    intent_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    conversation_history: Optional[List[ConversationMessage]] = None
    user_profile: Optional[Dict[str, Any]] = None
    spam_category: Optional[str] = None
    priority: int = Field(default=1, ge=1, le=10)


class ConversationResponse(BaseModel):
    """Response model for conversation management."""
    response_text: str
    intent: IntentCategory
    emotional_tone: EmotionalState
    confidence: float = Field(..., ge=0.0, le=1.0)
    should_terminate: bool
    next_stage: ConversationStage
    processing_time_ms: float
    cached: bool = False
    
    # Additional context
    turn_number: int
    conversation_id: str
    response_strategy: str
    
    # Performance hints
    cache_key: Optional[str] = None
    suggested_cache_ttl: Optional[int] = None
    
    class Config:
        use_enum_values = True
