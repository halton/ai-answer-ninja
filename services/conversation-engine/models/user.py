from datetime import datetime
from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from sqlalchemy import Column, String, Text, Integer, Float, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from pydantic import BaseModel, Field, validator
from enum import Enum

from ..core.database import Base


class PersonalityType(str, Enum):
    """User personality types for response personalization."""
    POLITE = "polite"
    DIRECT = "direct"
    HUMOROUS = "humorous"
    PROFESSIONAL = "professional"
    CASUAL = "casual"
    ASSERTIVE = "assertive"


class SpeechStyle(str, Enum):
    """User speech style preferences."""
    FORMAL = "formal"
    INFORMAL = "informal"
    FRIENDLY = "friendly"
    BUSINESS = "business"
    BRIEF = "brief"
    DETAILED = "detailed"


# Database Models
class UserProfile(Base):
    """Database model for user profiles."""
    __tablename__ = "user_profiles"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(PGUUID(as_uuid=True), unique=True, nullable=False, index=True)
    
    # Basic user info
    name = Column(String(100), nullable=False)
    phone_number = Column(String(20), nullable=False)
    
    # Personality and preferences
    personality_type = Column(String(50), default=PersonalityType.POLITE)
    speech_style = Column(String(50), default=SpeechStyle.FRIENDLY)
    occupation = Column(String(100))
    
    # AI behavior settings
    max_conversation_turns = Column(Integer, default=8)
    response_delay_seconds = Column(Float, default=0.5)
    termination_threshold = Column(Float, default=0.8)
    
    # Learning preferences
    enable_learning = Column(Boolean, default=True)
    personalization_level = Column(Float, default=0.7)  # 0-1 scale
    
    # Conversation history summary
    total_conversations = Column(Integer, default=0)
    successful_terminations = Column(Integer, default=0)
    avg_conversation_duration = Column(Float, default=0.0)
    
    # Custom responses and phrases
    custom_responses = Column(JSON)  # Custom response templates
    preferred_phrases = Column(JSON)  # User's preferred phrases
    avoided_phrases = Column(JSON)   # Phrases to avoid
    
    # Analytics
    effectiveness_score = Column(Float, default=0.5)  # Overall effectiveness
    last_updated = Column(DateTime, default=datetime.utcnow)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserConversationStats(Base):
    """Database model for user conversation statistics."""
    __tablename__ = "user_conversation_stats"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    
    # Time period
    date = Column(DateTime, nullable=False, index=True)
    period_type = Column(String(20), default="daily")  # daily, weekly, monthly
    
    # Conversation metrics
    total_calls = Column(Integer, default=0)
    spam_calls_blocked = Column(Integer, default=0)
    avg_call_duration = Column(Float, default=0.0)
    
    # Intent breakdown
    sales_calls = Column(Integer, default=0)
    loan_offers = Column(Integer, default=0)
    investment_pitches = Column(Integer, default=0)
    insurance_sales = Column(Integer, default=0)
    surveys = Column(Integer, default=0)
    scams = Column(Integer, default=0)
    
    # Performance metrics
    avg_response_time = Column(Float, default=0.0)
    cache_hit_rate = Column(Float, default=0.0)
    termination_success_rate = Column(Float, default=0.0)
    
    # AI effectiveness
    conversation_effectiveness = Column(Float, default=0.5)
    user_satisfaction_score = Column(Float, default=0.5)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Pydantic Models
class UserProfileData(BaseModel):
    """Pydantic model for user profile data."""
    user_id: UUID
    name: str = Field(..., min_length=1, max_length=100)
    phone_number: str = Field(..., min_length=10, max_length=20)
    personality_type: PersonalityType = PersonalityType.POLITE
    speech_style: SpeechStyle = SpeechStyle.FRIENDLY
    occupation: Optional[str] = Field(None, max_length=100)
    
    # AI behavior settings
    max_conversation_turns: int = Field(default=8, ge=1, le=20)
    response_delay_seconds: float = Field(default=0.5, ge=0.0, le=5.0)
    termination_threshold: float = Field(default=0.8, ge=0.1, le=1.0)
    
    # Learning settings
    enable_learning: bool = True
    personalization_level: float = Field(default=0.7, ge=0.0, le=1.0)
    
    # Custom content
    custom_responses: Optional[Dict[str, List[str]]] = None
    preferred_phrases: Optional[List[str]] = None
    avoided_phrases: Optional[List[str]] = None
    
    @validator('custom_responses')
    def validate_custom_responses(cls, v):
        if v is not None:
            for intent, responses in v.items():
                if not isinstance(responses, list) or len(responses) == 0:
                    raise ValueError(f"Custom responses for {intent} must be a non-empty list")
                for response in responses:
                    if not isinstance(response, str) or len(response.strip()) == 0:
                        raise ValueError(f"Each response must be a non-empty string")
        return v
    
    class Config:
        use_enum_values = True


class UserPreferences(BaseModel):
    """User preferences for conversation management."""
    # Response style preferences
    personality_type: PersonalityType
    speech_style: SpeechStyle
    response_length: str = Field(default="medium", regex="^(brief|medium|detailed)$")
    
    # Conversation behavior
    max_turns: int = Field(default=8, ge=1, le=20)
    patience_level: float = Field(default=0.7, ge=0.1, le=1.0)
    humor_level: float = Field(default=0.3, ge=0.0, le=1.0)
    
    # Termination preferences
    aggressive_callers: str = Field(default="firm", regex="^(polite|firm|immediate)$")
    persistent_callers: str = Field(default="escalate", regex="^(patient|escalate|terminate)$")
    
    # Learning preferences
    adapt_to_caller_type: bool = True
    learn_from_outcomes: bool = True
    share_learnings: bool = False  # Share with other users (anonymized)
    
    class Config:
        use_enum_values = True


class UserConversationInsights(BaseModel):
    """Insights and analytics for user conversations."""
    user_id: UUID
    time_period: str  # "daily", "weekly", "monthly"
    start_date: datetime
    end_date: datetime
    
    # High-level statistics
    total_conversations: int
    spam_calls_blocked: int
    success_rate: float = Field(..., ge=0.0, le=1.0)
    avg_duration_seconds: float
    
    # Intent breakdown
    intent_distribution: Dict[str, int]
    most_common_intents: List[str]
    
    # Performance metrics
    avg_response_time_ms: float
    fastest_response_ms: float
    slowest_response_ms: float
    cache_efficiency: float = Field(..., ge=0.0, le=1.0)
    
    # Effectiveness analysis
    conversation_effectiveness: float = Field(..., ge=0.0, le=1.0)
    termination_appropriateness: float = Field(..., ge=0.0, le=1.0)
    caller_satisfaction_estimate: float = Field(..., ge=0.0, le=1.0)
    
    # Improvement suggestions
    suggested_optimizations: List[str]
    personality_adjustments: Optional[Dict[str, Any]] = None
    
    # Trends
    performance_trend: str = Field(..., regex="^(improving|stable|declining)$")
    volume_trend: str = Field(..., regex="^(increasing|stable|decreasing)$")


class UserLearningData(BaseModel):
    """Data structure for user-specific learning."""
    user_id: UUID
    
    # Successful patterns
    effective_responses: Dict[str, List[str]]  # intent -> effective responses
    successful_strategies: Dict[str, float]    # strategy -> effectiveness score
    optimal_conversation_flow: List[str]       # sequence of effective stages
    
    # Failed patterns
    ineffective_responses: Dict[str, List[str]]
    failed_strategies: Dict[str, float]
    problematic_patterns: List[str]
    
    # Caller-specific learnings
    caller_type_preferences: Dict[str, UserPreferences]  # caller_type -> preferences
    intent_specific_settings: Dict[str, Dict[str, Any]]  # intent -> settings
    
    # Temporal patterns
    time_of_day_effectiveness: Dict[str, float]  # hour -> effectiveness
    day_of_week_patterns: Dict[str, Any]
    
    # Continuous learning metrics
    learning_rate: float = Field(default=0.1, ge=0.01, le=1.0)
    adaptation_speed: float = Field(default=0.3, ge=0.1, le=1.0)
    confidence_threshold: float = Field(default=0.7, ge=0.5, le=0.95)
    
    # Meta-learning
    learning_effectiveness: float = Field(default=0.5, ge=0.0, le=1.0)
    last_update: datetime = Field(default_factory=datetime.utcnow)
    update_frequency: int = Field(default=10)  # updates per N conversations


class PersonalizationContext(BaseModel):
    """Context for personalizing responses."""
    user_profile: UserProfileData
    conversation_history: List[Dict[str, Any]] = Field(default_factory=list)
    caller_context: Optional[Dict[str, Any]] = None
    time_context: Dict[str, Any] = Field(default_factory=dict)
    
    # Dynamic adjustments
    current_effectiveness: float = Field(default=0.5, ge=0.0, le=1.0)
    mood_adjustment: float = Field(default=0.0, ge=-0.5, le=0.5)
    energy_level: float = Field(default=0.7, ge=0.0, le=1.0)
    
    # Contextual factors
    recent_call_frequency: int = Field(default=0, ge=0)
    caller_persistence_level: float = Field(default=0.0, ge=0.0, le=1.0)
    conversation_complexity: float = Field(default=0.5, ge=0.0, le=1.0)
    
    # Learning state
    learning_phase: str = Field(default="active", regex="^(learning|adapting|stable|optimizing)$")
    confidence_level: float = Field(default=0.5, ge=0.0, le=1.0)
    
    class Config:
        arbitrary_types_allowed = True
