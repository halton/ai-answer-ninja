from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from uuid import UUID, uuid4
from sqlalchemy import Column, String, Text, Integer, Float, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from pydantic import BaseModel, Field, validator
from enum import Enum

from ..core.database import Base
from .conversation import IntentCategory, EmotionalState, ConversationStage


class LearningType(str, Enum):
    """Types of learning data."""
    RESPONSE_EFFECTIVENESS = "response_effectiveness"
    STRATEGY_OPTIMIZATION = "strategy_optimization"
    INTENT_RECOGNITION = "intent_recognition"
    EMOTIONAL_ADAPTATION = "emotional_adaptation"
    TERMINATION_TIMING = "termination_timing"
    PERSONALIZATION = "personalization"


class OutcomeType(str, Enum):
    """Conversation outcome types."""
    SUCCESS = "success"  # Caller terminated appropriately
    PARTIAL_SUCCESS = "partial_success"  # Some progress made
    FAILURE = "failure"  # Caller persisted or became aggressive
    INCONCLUSIVE = "inconclusive"  # Unclear outcome
    TIMEOUT = "timeout"  # System timeout
    ERROR = "error"  # Technical error


class OptimizationStrategy(str, Enum):
    """AI optimization strategies."""
    GRADIENT_DESCENT = "gradient_descent"
    REINFORCEMENT_LEARNING = "reinforcement_learning"
    BAYESIAN_OPTIMIZATION = "bayesian_optimization"
    A_B_TESTING = "a_b_testing"
    GENETIC_ALGORITHM = "genetic_algorithm"
    ENSEMBLE_LEARNING = "ensemble_learning"


# Database Models
class ConversationOutcome(Base):
    """Database model for conversation learning outcomes."""
    __tablename__ = "conversation_outcomes"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    conversation_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    
    # Outcome data
    outcome_type = Column(String(50), nullable=False)
    success_score = Column(Float, nullable=False)  # 0-1 scale
    
    # Context data
    intent_category = Column(String(50), nullable=False)
    emotional_progression = Column(JSON)  # List of emotional states
    conversation_stages = Column(JSON)    # List of conversation stages
    
    # Performance metrics
    total_duration_ms = Column(Integer, nullable=False)
    total_turns = Column(Integer, nullable=False)
    avg_response_time_ms = Column(Float, nullable=False)
    
    # Strategy data
    strategies_used = Column(JSON)        # List of strategies used
    effective_strategies = Column(JSON)   # Strategies that worked
    ineffective_strategies = Column(JSON) # Strategies that didn't work
    
    # Learning metadata
    confidence_score = Column(Float, default=0.5)
    learning_weight = Column(Float, default=1.0)  # Weight for learning algorithm
    
    # External factors
    time_of_day = Column(Integer)  # Hour of day (0-23)
    day_of_week = Column(Integer)  # Day of week (0-6)
    caller_persistence_level = Column(Float)
    
    created_at = Column(DateTime, default=datetime.utcnow)


class LearningModel(Base):
    """Database model for AI learning models."""
    __tablename__ = "learning_models"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    model_type = Column(String(50), nullable=False)
    
    # Model data
    model_version = Column(String(20), nullable=False)
    model_parameters = Column(JSON, nullable=False)
    feature_weights = Column(JSON)
    
    # Performance metrics
    accuracy_score = Column(Float, default=0.5)
    precision_score = Column(Float, default=0.5)
    recall_score = Column(Float, default=0.5)
    f1_score = Column(Float, default=0.5)
    
    # Training data
    training_samples = Column(Integer, default=0)
    validation_samples = Column(Integer, default=0)
    last_training_date = Column(DateTime)
    
    # Status
    is_active = Column(Boolean, default=True)
    deployment_date = Column(DateTime)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ResponseEffectiveness(Base):
    """Database model for tracking response effectiveness."""
    __tablename__ = "response_effectiveness"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    
    # Response identification
    response_template = Column(Text, nullable=False)
    response_hash = Column(String(64), nullable=False, index=True)
    intent_category = Column(String(50), nullable=False)
    
    # Effectiveness metrics
    usage_count = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    effectiveness_score = Column(Float, default=0.5)
    
    # Context effectiveness
    context_effectiveness = Column(JSON)  # effectiveness by context
    emotional_effectiveness = Column(JSON)  # effectiveness by emotional state
    
    # Performance data
    avg_response_time_ms = Column(Float)
    caller_reaction_score = Column(Float)  # How callers react to this response
    
    # Learning data
    confidence_interval = Column(JSON)  # Statistical confidence bounds
    last_updated = Column(DateTime, default=datetime.utcnow)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Pydantic Models
class LearningEvent(BaseModel):
    """Pydantic model for learning events."""
    event_id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    user_id: UUID
    
    # Event data
    learning_type: LearningType
    event_data: Dict[str, Any]
    outcome: OutcomeType
    success_score: float = Field(..., ge=0.0, le=1.0)
    
    # Context
    intent_category: IntentCategory
    emotional_context: List[EmotionalState]
    conversation_stage: ConversationStage
    
    # Performance metrics
    response_time_ms: float = Field(..., ge=0.0)
    processing_efficiency: float = Field(default=0.5, ge=0.0, le=1.0)
    
    # Learning metadata
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    learning_weight: float = Field(default=1.0, ge=0.0, le=10.0)
    
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        use_enum_values = True


class ModelPerformance(BaseModel):
    """Model performance metrics."""
    model_id: UUID
    model_type: LearningType
    version: str
    
    # Core metrics
    accuracy: float = Field(..., ge=0.0, le=1.0)
    precision: float = Field(..., ge=0.0, le=1.0)
    recall: float = Field(..., ge=0.0, le=1.0)
    f1_score: float = Field(..., ge=0.0, le=1.0)
    
    # Advanced metrics
    auc_roc: Optional[float] = Field(None, ge=0.0, le=1.0)
    auc_pr: Optional[float] = Field(None, ge=0.0, le=1.0)
    confusion_matrix: Optional[List[List[int]]] = None
    
    # Training metrics
    training_samples: int = Field(..., ge=0)
    validation_samples: int = Field(..., ge=0)
    training_time_seconds: float = Field(..., ge=0.0)
    
    # Deployment metrics
    inference_time_ms: float = Field(..., ge=0.0)
    memory_usage_mb: float = Field(..., ge=0.0)
    
    # Business metrics
    conversation_success_rate: float = Field(..., ge=0.0, le=1.0)
    user_satisfaction_score: float = Field(..., ge=0.0, le=1.0)
    cost_per_conversation: float = Field(..., ge=0.0)
    
    last_evaluated: datetime = Field(default_factory=datetime.utcnow)


class OptimizationResult(BaseModel):
    """Results from AI optimization process."""
    optimization_id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    strategy: OptimizationStrategy
    
    # Optimization parameters
    target_metric: str
    optimization_duration_seconds: float
    iterations: int
    
    # Results
    improvement_percentage: float  # Can be negative
    before_score: float = Field(..., ge=0.0, le=1.0)
    after_score: float = Field(..., ge=0.0, le=1.0)
    
    # Parameter changes
    parameter_changes: Dict[str, Tuple[Any, Any]]  # parameter -> (old, new)
    significant_changes: List[str]  # List of significantly changed parameters
    
    # Statistical significance
    p_value: Optional[float] = Field(None, ge=0.0, le=1.0)
    confidence_interval: Optional[Tuple[float, float]] = None
    sample_size: int = Field(..., ge=0)
    
    # Deployment info
    deployed: bool = False
    deployment_date: Optional[datetime] = None
    rollback_date: Optional[datetime] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        use_enum_values = True


class LearningInsights(BaseModel):
    """Insights from learning analysis."""
    user_id: UUID
    analysis_period: str  # "daily", "weekly", "monthly"
    start_date: datetime
    end_date: datetime
    
    # Learning effectiveness
    learning_rate: float = Field(..., ge=0.0, le=1.0)
    adaptation_speed: float = Field(..., ge=0.0, le=1.0)
    model_stability: float = Field(..., ge=0.0, le=1.0)
    
    # Key discoveries
    most_effective_strategies: List[Tuple[str, float]]  # (strategy, effectiveness)
    least_effective_strategies: List[Tuple[str, float]]
    emerging_patterns: List[str]
    declining_patterns: List[str]
    
    # Performance trends
    accuracy_trend: str = Field(..., regex="^(improving|stable|declining)$")
    response_time_trend: str = Field(..., regex="^(improving|stable|declining)$")
    user_satisfaction_trend: str = Field(..., regex="^(improving|stable|declining)$")
    
    # Recommendations
    optimization_recommendations: List[str]
    parameter_adjustments: Dict[str, Any]
    strategy_recommendations: List[str]
    
    # Risk assessment
    overfitting_risk: float = Field(..., ge=0.0, le=1.0)
    concept_drift_detected: bool = False
    model_degradation_risk: float = Field(..., ge=0.0, le=1.0)
    
    # Next steps
    recommended_actions: List[str]
    priority_areas: List[str]
    experiment_suggestions: List[str]


class ExperimentResult(BaseModel):
    """Results from A/B testing experiments."""
    experiment_id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    experiment_name: str
    
    # Experiment setup
    control_group_size: int = Field(..., ge=0)
    treatment_group_size: int = Field(..., ge=0)
    duration_days: int = Field(..., ge=1)
    
    # Hypothesis
    hypothesis: str
    expected_improvement: float  # Expected percentage improvement
    
    # Results
    control_success_rate: float = Field(..., ge=0.0, le=1.0)
    treatment_success_rate: float = Field(..., ge=0.0, le=1.0)
    improvement_observed: float  # Actual percentage improvement (can be negative)
    
    # Statistical analysis
    statistical_power: float = Field(..., ge=0.0, le=1.0)
    p_value: float = Field(..., ge=0.0, le=1.0)
    confidence_level: float = Field(default=0.95, ge=0.0, le=1.0)
    effect_size: float
    
    # Secondary metrics
    control_avg_response_time: float
    treatment_avg_response_time: float
    control_user_satisfaction: float = Field(..., ge=0.0, le=1.0)
    treatment_user_satisfaction: float = Field(..., ge=0.0, le=1.0)
    
    # Conclusion
    statistically_significant: bool
    practically_significant: bool
    recommendation: str = Field(..., regex="^(deploy|reject|continue|modify)$")
    
    # Follow-up
    follow_up_experiments: List[str] = Field(default_factory=list)
    lessons_learned: List[str] = Field(default_factory=list)
    
    start_date: datetime
    end_date: datetime
    analyzed_date: datetime = Field(default_factory=datetime.utcnow)


class ContinuousLearningState(BaseModel):
    """State of continuous learning system."""
    user_id: UUID
    
    # Learning status
    learning_enabled: bool = True
    learning_phase: str = Field(..., regex="^(initialization|exploration|exploitation|optimization)$")
    
    # Model versions
    active_model_version: str
    candidate_model_version: Optional[str] = None
    model_update_frequency: int = Field(default=100)  # Update every N conversations
    
    # Performance tracking
    conversations_since_update: int = Field(default=0, ge=0)
    current_performance_score: float = Field(..., ge=0.0, le=1.0)
    performance_history: List[float] = Field(default_factory=list, max_items=100)
    
    # Adaptation parameters
    learning_rate: float = Field(default=0.01, ge=0.001, le=0.1)
    exploration_rate: float = Field(default=0.1, ge=0.0, le=1.0)
    confidence_threshold: float = Field(default=0.8, ge=0.5, le=0.99)
    
    # Quality control
    minimum_samples_for_update: int = Field(default=50, ge=10)
    maximum_parameter_change: float = Field(default=0.2, ge=0.01, le=1.0)
    
    # Monitoring
    last_update: datetime = Field(default_factory=datetime.utcnow)
    next_scheduled_update: Optional[datetime] = None
    
    # Flags
    auto_update_enabled: bool = True
    emergency_rollback_available: bool = True
    
    class Config:
        arbitrary_types_allowed = True
