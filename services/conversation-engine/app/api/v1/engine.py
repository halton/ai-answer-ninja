"""
Conversation Engine API Endpoints
Main API for AI dialogue engine functionality
"""

from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
import structlog

from ....services import (
    intent_classifier,
    conversation_manager,
    response_generator,
    termination_manager,
    conversation_learning_system
)
from ....models.conversation import ConversationContext, IntentCategory
from ....models.user import UserProfileData, PersonalityType, SpeechStyle

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/engine", tags=["conversation-engine"])


# Request/Response Models
class IntentClassificationRequest(BaseModel):
    """Request for intent classification"""
    transcript: str = Field(..., description="Text to classify")
    call_id: Optional[str] = Field(None, description="Call ID for context")
    user_id: Optional[str] = Field(None, description="User ID for context")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context")


class IntentClassificationResponse(BaseModel):
    """Response for intent classification"""
    intent: str
    confidence: float
    sub_category: Optional[str]
    emotional_tone: Optional[str]
    keywords_matched: List[str]
    processing_time_ms: float


class ConversationRequest(BaseModel):
    """Request for conversation management"""
    input_text: str = Field(..., description="Caller's input text")
    call_id: str = Field(..., description="Unique call identifier")
    user_id: str = Field(..., description="User identifier")
    caller_phone: Optional[str] = Field(None, description="Caller's phone number")
    user_profile: Optional[Dict[str, Any]] = Field(None, description="User profile data")
    context: Optional[Dict[str, Any]] = Field(None, description="Conversation context")


class ConversationResponse(BaseModel):
    """Response from conversation management"""
    response: str
    audio_response: Optional[str] = None
    next_state: str
    should_terminate: bool
    termination_reason: Optional[str]
    intent: str
    confidence: float
    emotional_tone: str
    turn_count: int
    processing_time_ms: float


class TerminationCheckRequest(BaseModel):
    """Request for termination check"""
    call_id: str
    turn_count: int
    duration_seconds: float
    persistence_indicators: List[str]
    current_stage: str
    emotional_state: str


class TerminationCheckResponse(BaseModel):
    """Response for termination check"""
    should_terminate: bool
    reason: Optional[str]
    final_response: Optional[str]
    confidence: float
    continuation_strategy: Optional[str]
    metrics: Dict[str, Any]


class LearningRequest(BaseModel):
    """Request for learning from conversation"""
    call_record: Dict[str, Any] = Field(..., description="Complete call record")
    immediate_feedback: Optional[Dict[str, Any]] = Field(None, description="Immediate feedback if available")


class BatchLearningRequest(BaseModel):
    """Request for batch learning"""
    call_records: List[Dict[str, Any]] = Field(..., description="Multiple call records")
    time_range: Optional[Dict[str, str]] = Field(None, description="Time range for analysis")


# API Endpoints

@router.post("/classify-intent", response_model=IntentClassificationResponse)
async def classify_intent(request: IntentClassificationRequest):
    """
    Classify intent from transcript using multi-layer analysis
    
    Features:
    - Keyword-based classification
    - Semantic analysis
    - Contextual understanding
    """
    try:
        import time
        start_time = time.time()
        
        # Build context if provided
        context = None
        if request.context and request.call_id:
            context = ConversationContext(
                call_id=request.call_id,
                user_id=request.user_id or "unknown",
                caller_phone=request.context.get("caller_phone", "unknown"),
                spam_category=request.context.get("spam_category"),
                turn_count=request.context.get("turn_count", 0)
            )
        
        # Classify intent
        result = await intent_classifier.classify_intent(
            request.transcript,
            context
        )
        
        processing_time = (time.time() - start_time) * 1000
        
        return IntentClassificationResponse(
            intent=result.intent.value,
            confidence=result.confidence,
            sub_category=result.sub_category,
            emotional_tone=result.emotional_tone,
            keywords_matched=result.keywords_matched or [],
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        logger.error("Intent classification failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process-conversation", response_model=ConversationResponse)
async def process_conversation(request: ConversationRequest):
    """
    Process conversation input and generate AI response
    
    Features:
    - Intent recognition
    - State tracking
    - Personalized response generation
    - Termination decision
    """
    try:
        # Parse user profile if provided
        user_profile = None
        if request.user_profile:
            user_profile = UserProfileData(
                user_id=request.user_id,
                name=request.user_profile.get("name", "用户"),
                phone_number=request.user_profile.get("phone_number", ""),
                personality_type=PersonalityType(
                    request.user_profile.get("personality_type", "polite")
                ),
                speech_style=SpeechStyle(
                    request.user_profile.get("speech_style", "friendly")
                ),
                occupation=request.user_profile.get("occupation")
            )
        
        # Build context if provided
        context = None
        if request.context:
            context = ConversationContext(
                call_id=request.call_id,
                user_id=request.user_id,
                caller_phone=request.caller_phone or "unknown",
                spam_category=request.context.get("spam_category"),
                turn_count=request.context.get("turn_count", 0),
                conversation_history=request.context.get("history", [])
            )
        
        # Process conversation
        result = await conversation_manager.manage_conversation(
            input_text=request.input_text,
            call_id=request.call_id,
            user_id=request.user_id,
            user_profile=user_profile,
            context=context
        )
        
        return ConversationResponse(**result)
        
    except Exception as e:
        logger.error("Conversation processing failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/check-termination", response_model=TerminationCheckResponse)
async def check_termination(request: TerminationCheckRequest):
    """
    Check if conversation should be terminated
    
    Features:
    - Persistence detection
    - Frustration tracking
    - Response effectiveness analysis
    """
    try:
        from ....models.conversation import DialogueState, ConversationStage, EmotionalState
        
        # Build dialogue state
        dialogue_state = DialogueState(
            call_id=request.call_id,
            stage=ConversationStage(request.current_stage),
            turn_count=request.turn_count,
            emotional_trajectory=[EmotionalState(request.emotional_state)]
        )
        
        # Check termination
        result = await termination_manager.should_terminate_call(
            dialogue_state=dialogue_state,
            current_response=None,
            intent_result=None
        )
        
        return TerminationCheckResponse(
            should_terminate=result["terminate"],
            reason=result.get("reason"),
            final_response=result.get("final_response"),
            confidence=result.get("confidence", 0.0),
            continuation_strategy=result.get("continue_strategy"),
            metrics=result.get("metrics", {})
        )
        
    except Exception as e:
        logger.error("Termination check failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/learn", status_code=202)
async def learn_from_conversation(
    request: LearningRequest,
    background_tasks: BackgroundTasks
):
    """
    Learn from a completed conversation
    
    Features:
    - Pattern recognition
    - Strategy optimization
    - Performance tracking
    """
    try:
        # Add learning task to background
        background_tasks.add_task(
            conversation_learning_system.learn_from_conversation,
            request.call_record
        )
        
        return {
            "status": "learning_initiated",
            "call_id": request.call_record.get("call_id"),
            "message": "Learning process started in background"
        }
        
    except Exception as e:
        logger.error("Learning initiation failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-learn")
async def batch_learn(request: BatchLearningRequest):
    """
    Perform batch learning from multiple conversations
    
    Features:
    - Pattern extraction
    - Strategy performance analysis
    - Insight generation
    """
    try:
        result = await conversation_learning_system.batch_learning(
            request.call_records
        )
        
        return {
            "status": "completed",
            "patterns_identified": result["patterns_identified"],
            "insights_generated": len(result["insights"]),
            "optimizations": len(result["optimizations"]),
            "top_insights": result["insights"][:5],
            "learning_metrics": result["learning_metrics"]
        }
        
    except Exception as e:
        logger.error("Batch learning failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/performance-metrics")
async def get_performance_metrics():
    """
    Get AI dialogue engine performance metrics
    
    Returns metrics for:
    - Intent classification accuracy
    - Conversation management efficiency
    - Termination success rate
    - Learning system progress
    """
    try:
        # Gather metrics from all components
        conversation_metrics = await conversation_manager.get_performance_metrics()
        termination_metrics = await termination_manager.get_performance_metrics()
        learning_metrics = await conversation_learning_system.get_learning_metrics()
        
        return {
            "conversation_management": conversation_metrics,
            "termination_management": termination_metrics,
            "learning_system": learning_metrics,
            "overall_health": "healthy",
            "targets": {
                "intent_accuracy": ">95%",
                "avg_turns": "<5",
                "termination_success": ">90%"
            }
        }
        
    except Exception as e:
        logger.error("Failed to get performance metrics", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversation-summary/{call_id}")
async def get_conversation_summary(call_id: str):
    """
    Get summary of a specific conversation
    
    Returns:
    - Conversation metrics
    - Intent distribution
    - Emotional progression
    - Key points
    """
    try:
        summary = await conversation_manager.get_conversation_summary(call_id)
        
        if "error" in summary:
            raise HTTPException(status_code=404, detail=summary["error"])
        
        return summary
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get conversation summary", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export-learning-model")
async def export_learning_model():
    """
    Export the current learning model for backup or transfer
    """
    try:
        model_data = await conversation_learning_system.export_learning_model()
        
        return {
            "status": "exported",
            "timestamp": model_data["timestamp"],
            "metrics": model_data["metrics"],
            "model_size": len(str(model_data))
        }
        
    except Exception as e:
        logger.error("Failed to export learning model", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import-learning-model")
async def import_learning_model(model_data: Dict[str, Any]):
    """
    Import a previously exported learning model
    """
    try:
        await conversation_learning_system.import_learning_model(model_data)
        
        return {
            "status": "imported",
            "message": "Learning model imported successfully"
        }
        
    except Exception as e:
        logger.error("Failed to import learning model", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))