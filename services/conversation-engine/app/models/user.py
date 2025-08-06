"""
User-related database models for conversation management.
"""

from datetime import datetime
from typing import Dict, Any, Optional, List
from uuid import UUID, uuid4
from enum import Enum

from sqlalchemy import (
    String, Integer, Float, DateTime, Boolean, Text, JSON,
    ForeignKey, Index, Enum as SQLEnum
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class PersonalityType(str, Enum):
    """User personality types for conversation adaptation."""
    POLITE = "polite"
    DIRECT = "direct"
    HUMOROUS = "humorous"
    PROFESSIONAL = "professional"


class UserProfile(Base):
    """User profile information for conversation personalization."""
    
    __tablename__ = "user_profiles"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        unique=True,
        index=True
    )
    
    # Basic profile information
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )
    phone_number: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )
    
    # Personality configuration
    default_personality: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="polite"
    )
    personality_adaptiveness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5  # 0.0 = fixed, 1.0 = highly adaptive
    )
    
    # Communication preferences
    preferred_response_length: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="medium"  # short, medium, long
    )
    politeness_level: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.7  # 0.0 = direct, 1.0 = very polite
    )
    humor_tolerance: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5  # 0.0 = no humor, 1.0 = high humor
    )
    assertiveness_level: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5  # 0.0 = passive, 1.0 = very assertive
    )
    
    # Conversation behavior
    max_conversation_duration: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=300  # seconds
    )
    max_turns_before_firm: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=3
    )
    enable_learning: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True
    )
    
    # Voice and speech preferences
    voice_profile_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True
    )
    speech_pace: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="normal"  # slow, normal, fast
    )
    emotional_expressiveness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.6  # 0.0 = monotone, 1.0 = very expressive
    )
    
    # Advanced settings
    context_awareness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.8  # How much context to consider
    )
    termination_strategy: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="adaptive"  # gentle, firm, adaptive, immediate
    )
    
    # Metadata
    preferences: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    custom_responses: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    last_used: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Indexes
    __table_args__ = (
        Index("idx_user_profile_personality", "default_personality"),
        Index("idx_user_profile_phone", "phone_number"),
        Index("idx_user_profile_updated", "updated_at"),
    )


class UserPersonality(Base):
    """Dynamic personality tracking and adaptation."""
    
    __tablename__ = "user_personalities"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True
    )
    
    # Personality dimensions (Big Five + Custom)
    openness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    conscientiousness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    extraversion: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    agreeableness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    neuroticism: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    
    # Custom dimensions for conversation
    directness: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    patience: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    humor_usage: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.3
    )
    formality: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.6
    )
    empathy: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.7
    )
    
    # Context-specific adaptations
    situation_adaptations: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    spam_type_preferences: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Learning and evolution
    adaptation_rate: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.1  # How quickly personality adapts
    )
    confidence_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5  # Confidence in current personality model
    )
    sample_size: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0  # Number of conversations used for learning
    )
    
    # Performance tracking
    effectiveness_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    last_optimization: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    
    # Indexes
    __table_args__ = (
        Index("idx_user_personality_user", "user_id"),
        Index("idx_user_personality_updated", "updated_at"),
        Index("idx_user_personality_confidence", "confidence_score"),
    )


class PersonalityAdaptation(Base):
    """Track personality adaptations over time."""
    
    __tablename__ = "personality_adaptations"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True
    )
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("conversation_states.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # Adaptation details
    adaptation_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False  # "personality_shift", "strategy_change", "threshold_adjust"
    )
    field_changed: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )
    old_value: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    new_value: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    trigger_reason: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )
    
    # Effectiveness measurement
    effectiveness_before: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    effectiveness_after: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    confidence_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    
    # Metadata
    metadata: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    # Indexes
    __table_args__ = (
        Index("idx_personality_adaptation_user", "user_id"),
        Index("idx_personality_adaptation_conversation", "conversation_id"),
        Index("idx_personality_adaptation_created", "created_at"),
    )


class ConversationTemplate(Base):
    """Response templates for different scenarios and personalities."""
    
    __tablename__ = "conversation_templates"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    template_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True
    )
    
    # Template categorization
    category: Mapped[str] = mapped_column(
        String(50),
        nullable=False  # "greeting", "rejection", "question", "termination"
    )
    intent_category: Mapped[str] = mapped_column(
        String(50),
        nullable=False  # "sales_call", "loan_offer", "investment_pitch", etc.
    )
    personality_type: Mapped[PersonalityType] = mapped_column(
        SQLEnum(PersonalityType),
        nullable=False
    )
    
    # Template content
    template_text: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )
    variables: Mapped[List[str]] = mapped_column(
        JSON,
        nullable=False,
        default=list  # List of template variables like {user_name}, {company}
    )
    
    # Usage and effectiveness
    usage_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    effectiveness_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    avg_response_time: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Configuration
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True
    )
    priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1  # Higher number = higher priority
    )
    
    # Conditions for usage
    usage_conditions: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict  # Conditions like turn_count, sentiment, etc.
    )
    
    # Metadata
    metadata: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    last_used: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Indexes
    __table_args__ = (
        Index("idx_template_category_personality", "category", "personality_type"),
        Index("idx_template_intent_active", "intent_category", "is_active"),
        Index("idx_template_effectiveness", "effectiveness_score"),
        Index("idx_template_usage", "usage_count"),
    )