"""
Learning and feedback models for conversation improvement.
"""

from datetime import datetime
from typing import Dict, Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Integer, Float, DateTime, Boolean, Text, JSON,
    ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class ConversationFeedback(Base):
    """User feedback on conversation quality and effectiveness."""
    
    __tablename__ = "conversation_feedback"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("conversation_states.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True
    )
    
    # Feedback scores (1-5 scale)
    overall_satisfaction: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    response_appropriateness: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    personality_match: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    termination_timing: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    politeness_level: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    
    # Binary feedback
    was_effective: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True
    )
    would_use_again: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True
    )
    responses_natural: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True
    )
    
    # Specific feedback
    feedback_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="rating"  # rating, text, behavioral
    )
    feedback_text: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    suggested_improvements: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    
    # Context information
    spam_category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )
    conversation_outcome: Mapped[Optional[str]] = mapped_column(
        String(30),
        nullable=True
    )
    caller_persistence: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True
    )
    
    # Metadata
    feedback_metadata: Mapped[Dict[str, Any]] = mapped_column(
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
    
    # Indexes
    __table_args__ = (
        Index("idx_feedback_user_created", "user_id", "created_at"),
        Index("idx_feedback_conversation", "conversation_id"),
        Index("idx_feedback_satisfaction", "overall_satisfaction"),
        Index("idx_feedback_spam_category", "spam_category"),
    )


class ResponseTemplate(Base):
    """Dynamic response templates learned from successful conversations."""
    
    __tablename__ = "response_templates"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    
    # Template identification
    template_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )
    intent_category: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True
    )
    personality_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True
    )
    spam_category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        index=True
    )
    
    # Template content
    template_text: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )
    variables: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    variations: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=list
    )
    
    # Usage context
    conversation_stage: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="any"
    )
    response_strategy: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )
    trigger_conditions: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Performance metrics
    usage_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    success_rate: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0
    )
    avg_effectiveness: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    user_satisfaction: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Template quality
    confidence_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    is_validated: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False
    )
    validation_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    
    # Learning metadata
    learning_source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="manual"  # manual, learned, imported
    )
    source_conversations: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=list
    )
    
    # Status and lifecycle
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True
    )
    priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1  # 1 = highest priority
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
        Index("idx_template_intent_personality", "intent_category", "personality_type"),
        Index("idx_template_spam_category", "spam_category"),
        Index("idx_template_success_rate", "success_rate"),
        Index("idx_template_active_priority", "is_active", "priority"),
        Index("idx_template_usage", "usage_count"),
    )


class ConversationLearning(Base):
    """Aggregated learning insights from conversation patterns."""
    
    __tablename__ = "conversation_learning"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    
    # Learning context
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
        index=True
    )
    spam_category: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True
    )
    personality_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True
    )
    
    # Pattern identification
    pattern_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )
    pattern_description: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )
    pattern_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Learning metrics
    sample_size: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1
    )
    confidence_level: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5
    )
    statistical_significance: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Recommendations
    recommended_actions: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    impact_estimate: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    implementation_priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=3  # 1 = high, 5 = low
    )
    
    # Status
    is_applied: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False
    )
    validation_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending"  # pending, validated, rejected
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
        Index("idx_learning_spam_personality", "spam_category", "personality_type"),
        Index("idx_learning_user_confidence", "user_id", "confidence_level"),
        Index("idx_learning_priority", "implementation_priority"),
        Index("idx_learning_applied", "is_applied", "validation_status"),
    )