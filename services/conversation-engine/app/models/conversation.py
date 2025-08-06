"""
Conversation-related database models.
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


class ConversationState(Base):
    """Conversation state tracking model."""
    
    __tablename__ = "conversation_states"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    conversation_id: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True
    )
    call_record_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("call_records.id"),
        nullable=True
    )
    
    # State information
    current_stage: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="initial"
    )
    intent_category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )
    personality_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="polite"
    )
    
    # Conversation metrics
    turn_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    total_duration: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    avg_response_time: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Context and metadata
    context_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    caller_phone: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True
    )
    spam_category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )
    
    # Status flags
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True
    )
    should_terminate: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False
    )
    termination_reason: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )
    
    # Effectiveness tracking
    effectiveness_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    user_satisfaction: Mapped[Optional[float]] = mapped_column(
        Float,
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
    last_activity: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    
    # Relationships
    messages: Mapped[list["ConversationMessage"]] = relationship(
        "ConversationMessage",
        back_populates="conversation",
        cascade="all, delete-orphan"
    )
    metrics: Mapped[Optional["ConversationMetrics"]] = relationship(
        "ConversationMetrics",
        back_populates="conversation",
        uselist=False
    )
    
    # Indexes
    __table_args__ = (
        Index("idx_conv_state_user_active", "user_id", "is_active"),
        Index("idx_conv_state_phone_category", "caller_phone", "spam_category"),
        Index("idx_conv_state_created", "created_at"),
    )


class ConversationMessage(Base):
    """Individual conversation messages."""
    
    __tablename__ = "conversation_messages"
    
    # Primary fields
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("conversation_states.id", ondelete="CASCADE"),
        nullable=False
    )
    
    # Message content
    speaker: Mapped[str] = mapped_column(
        String(10),
        nullable=False  # 'user' or 'ai'
    )
    message_text: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )
    message_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="text"  # 'text', 'audio', 'system'
    )
    
    # Processing results
    intent: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )
    confidence_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    sentiment: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True
    )
    emotion: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True
    )
    
    # Response generation metadata
    response_strategy: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )
    template_used: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True
    )
    tokens_used: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True
    )
    
    # Performance metrics
    processing_time_ms: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    generation_time_ms: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Metadata
    metadata: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=dict
    )
    
    # Timestamp
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    # Relationships
    conversation: Mapped["ConversationState"] = relationship(
        "ConversationState",
        back_populates="messages"
    )
    
    # Indexes
    __table_args__ = (
        Index("idx_conv_msg_conversation_time", "conversation_id", "timestamp"),
        Index("idx_conv_msg_speaker_intent", "speaker", "intent"),
        Index("idx_conv_msg_timestamp", "timestamp"),
    )


class ConversationMetrics(Base):
    """Aggregated conversation performance metrics."""
    
    __tablename__ = "conversation_metrics"
    
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
        unique=True
    )
    
    # Performance metrics
    total_messages: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    avg_response_time: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    max_response_time: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    min_response_time: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Quality metrics
    avg_confidence_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    intent_accuracy: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    response_coherence: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Conversation outcome
    termination_efficiency: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    user_frustration_level: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    caller_persistence_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    
    # Learning indicators
    personality_effectiveness: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )
    strategy_success_rate: Mapped[Optional[float]] = mapped_column(
        Float,
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
    
    # Relationships
    conversation: Mapped["ConversationState"] = relationship(
        "ConversationState",
        back_populates="metrics"
    )