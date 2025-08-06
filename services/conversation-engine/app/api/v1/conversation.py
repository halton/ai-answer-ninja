"""Conversation management API endpoints."""

import asyncio
from typing import Dict, List, Optional, Any
from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
import structlog

from ...core.config import get_settings
from ...models.conversation import (
    ConversationRequest, ConversationResponse, ConversationContext,
    ConversationMessage, AIResponse, IntentCategory, EmotionalState
)
from ...models.user import UserProfileData, PersonalizationContext
from ...services.azure_openai import azure_openai_service
from ...services.sentiment_analyzer import sentiment_analyzer
from ...services.state_manager import state_manager

router = APIRouter()
logger = structlog.get_logger(__name__)
settings = get_settings()


async def get_user_profile(user_id: UUID) -> Optional[UserProfileData]:
    """Get user profile (placeholder - would integrate with user-management service)."""
    # In a real implementation, this would call the user-management service
    return UserProfileData(
        user_id=user_id,
        name="用户",
        phone_number="1234567890"
    )


@router.post("/manage", response_model=ConversationResponse)
async def manage_conversation(
    request: ConversationRequest,
    background_tasks: BackgroundTasks
) -> ConversationResponse:
    """
    Manage conversation with advanced AI response generation.
    
    This endpoint handles the core conversation management with:
    - Emotional intelligence analysis
    - Personalized response generation
    - State tracking and context management
    - Performance optimization with caching
    """
    start_time = datetime.utcnow()
    
    try:
        # Get or create conversation context
        context = await state_manager.get_conversation_context(request.call_id)
        
        if not context:
            # Start new conversation
            user_profile = await get_user_profile(request.user_id)
            context = await state_manager.start_conversation(
                call_id=request.call_id,
                user_id=request.user_id,
                caller_phone=request.caller_phone,
                initial_intent=request.detected_intent,
                user_profile=user_profile,
                spam_category=request.spam_category
            )
        
        # Create user message
        user_message = ConversationMessage(
            speaker="user",
            text=request.input_text,
            timestamp=datetime.utcnow(),
            intent=request.detected_intent,
            intent_confidence=request.intent_confidence
        )
        
        # Analyze emotional state
        emotional_analysis = await sentiment_analyzer.analyze_emotional_state(
            text=request.input_text,
            conversation_history=context.conversation_history,
            call_id=request.call_id
        )
        
        # Update emotional information in message
        user_message.emotion = EmotionalState(emotional_analysis["emotional_state"])
        user_message.emotion_confidence = emotional_analysis["confidence"]
        
        # Update conversation state
        context = await state_manager.update_conversation_state(
            call_id=request.call_id,
            new_message=user_message,
            detected_intent=request.detected_intent,
            emotional_analysis=emotional_analysis
        )
        
        # Generate AI response
        user_profile = await get_user_profile(request.user_id)
        ai_response = await azure_openai_service.generate_response(
            context=context,
            user_profile=user_profile,
            force_generation=False
        )
        
        # Create AI message
        ai_message = ConversationMessage(
            speaker="ai",
            text=ai_response.text,
            timestamp=datetime.utcnow(),
            intent=ai_response.intent,
            intent_confidence=ai_response.confidence,
            emotion=ai_response.emotional_tone,
            processing_time_ms=ai_response.generation_time_ms,
            cached=ai_response.cached
        )
        
        # Update conversation state with AI response
        context = await state_manager.update_conversation_state(
            call_id=request.call_id,
            new_message=ai_message,
            detected_intent=ai_response.intent
        )
        
        # Evaluate termination conditions
        termination_eval = await state_manager.evaluate_termination_conditions(
            call_id=request.call_id,
            persistence_score=emotional_analysis.get("persistence_score"),
            frustration_level=emotional_analysis.get("frustration_level"),
            response_effectiveness=ai_response.confidence
        )
        
        # End conversation if needed
        if termination_eval["should_terminate"]:
            background_tasks.add_task(
                state_manager.end_conversation,
                request.call_id,
                termination_eval["reason"],
                f"Conversation ended: {ai_response.text}"
            )
        
        # Calculate total processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        # Log performance warning if too slow
        if processing_time > 300:  # 300ms threshold
            logger.warning(
                "Slow conversation processing",
                call_id=request.call_id,
                processing_time_ms=processing_time,
                target_ms=300
            )
        
        # Build response
        response = ConversationResponse(
            response_text=ai_response.text,
            intent=ai_response.intent,
            emotional_tone=ai_response.emotional_tone,
            confidence=ai_response.confidence,
            should_terminate=termination_eval["should_terminate"],
            next_stage=ai_response.next_stage or context.current_stage,
            processing_time_ms=processing_time,
            cached=ai_response.cached,
            turn_number=context.turn_count,
            conversation_id=request.call_id,
            response_strategy=ai_response.response_strategy,
            cache_key=ai_response.cache_key,
            suggested_cache_ttl=settings.cache_ttl_seconds if not ai_response.cached else None
        )
        
        logger.info(
            "Conversation managed successfully",
            call_id=request.call_id,
            turn_number=context.turn_count,
            processing_time_ms=processing_time,
            cached=ai_response.cached,
            should_terminate=termination_eval["should_terminate"]
        )
        
        return response
        
    except Exception as e:
        logger.error(
            "Conversation management failed",
            call_id=request.call_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Conversation management failed: {str(e)}"
        )


@router.post("/personalize", response_model=Dict[str, Any])
async def personalize_response(
    call_id: str,
    user_id: UUID,
    personalization_context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Apply personalization to conversation responses.
    
    This endpoint allows real-time personalization adjustments
    based on user feedback and conversation context.
    """
    try:
        context = await state_manager.get_conversation_context(call_id)
        if not context:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        user_profile = await get_user_profile(user_id)
        if not user_profile:
            raise HTTPException(status_code=404, detail="User profile not found")
        
        # Apply personalization context
        personalization = PersonalizationContext(
            user_profile=user_profile,
            conversation_history=[msg.dict() for msg in context.conversation_history],
            caller_context=personalization_context.get("caller_context"),
            time_context=personalization_context.get("time_context", {}),
            current_effectiveness=personalization_context.get("effectiveness", 0.5),
            mood_adjustment=personalization_context.get("mood_adjustment", 0.0),
            energy_level=personalization_context.get("energy_level", 0.7)
        )
        
        # Generate personalized response
        ai_response = await azure_openai_service.generate_response(
            context=context,
            user_profile=user_profile,
            force_generation=True  # Force new generation for personalization
        )
        
        result = {
            "personalized_response": ai_response.text,
            "personalization_applied": True,
            "confidence": ai_response.confidence,
            "emotional_tone": ai_response.emotional_tone.value,
            "strategy": ai_response.response_strategy,
            "processing_time_ms": ai_response.generation_time_ms
        }
        
        logger.info(
            "Response personalized",
            call_id=call_id,
            user_id=str(user_id),
            strategy=ai_response.response_strategy
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Personalization failed",
            call_id=call_id,
            user_id=str(user_id),
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Personalization failed: {str(e)}"
        )


@router.post("/emotion/analyze", response_model=Dict[str, Any])
async def analyze_emotion(
    text: str,
    call_id: Optional[str] = None,
    conversation_history: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Analyze emotional state from text input.
    
    This endpoint provides detailed emotional analysis including:
    - Primary emotional state
    - Confidence score
    - Persistence and frustration levels
    - Response recommendations
    """
    try:
        # Convert history if provided
        history = None
        if conversation_history:
            history = [ConversationMessage(**msg) for msg in conversation_history]
        
        # Perform emotional analysis
        analysis = await sentiment_analyzer.analyze_emotional_state(
            text=text,
            conversation_history=history,
            call_id=call_id
        )
        
        logger.info(
            "Emotional analysis completed",
            call_id=call_id,
            emotion=analysis["emotional_state"],
            confidence=analysis["confidence"]
        )
        
        return analysis
        
    except Exception as e:
        logger.error(
            "Emotional analysis failed",
            call_id=call_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Emotional analysis failed: {str(e)}"
        )


@router.get("/state/{call_id}", response_model=Dict[str, Any])
async def get_conversation_state(call_id: str) -> Dict[str, Any]:
    """Get current conversation state and context."""
    try:
        context = await state_manager.get_conversation_context(call_id)
        if not context:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Get analytics
        analytics = await state_manager.get_conversation_analytics(call_id)
        
        result = {
            "call_id": call_id,
            "user_id": str(context.user_id),
            "current_stage": context.current_stage.value,
            "emotional_state": context.emotional_state.value,
            "turn_count": context.turn_count,
            "start_time": context.start_time.isoformat(),
            "duration_seconds": (datetime.utcnow() - context.start_time).total_seconds(),
            "conversation_history": [msg.dict() for msg in context.conversation_history],
            "analytics": analytics
        }
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get conversation state",
            call_id=call_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get conversation state: {str(e)}"
        )


@router.post("/terminate/{call_id}")
async def terminate_conversation(
    call_id: str,
    reason: Optional[str] = "manual_termination",
    summary: Optional[str] = None
) -> Dict[str, Any]:
    """Manually terminate a conversation."""
    try:
        result = await state_manager.end_conversation(
            call_id=call_id,
            termination_reason=reason,
            final_summary=summary
        )
        
        if not result.get("success"):
            raise HTTPException(
                status_code=404,
                detail=result.get("reason", "Conversation not found")
            )
        
        logger.info(
            "Conversation terminated manually",
            call_id=call_id,
            reason=reason
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to terminate conversation",
            call_id=call_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to terminate conversation: {str(e)}"
        )


@router.get("/history/{call_id}", response_model=List[Dict[str, Any]])
async def get_conversation_history(call_id: str) -> List[Dict[str, Any]]:
    """Get conversation message history."""
    try:
        context = await state_manager.get_conversation_context(call_id)
        if not context:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        history = [msg.dict() for msg in context.conversation_history]
        
        logger.info(
            "Conversation history retrieved",
            call_id=call_id,
            message_count=len(history)
        )
        
        return history
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get conversation history",
            call_id=call_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get conversation history: {str(e)}"
        )


@router.post("/batch/terminate")
async def batch_terminate_conversations(
    call_ids: List[str],
    reason: str = "batch_termination"
) -> Dict[str, Any]:
    """Terminate multiple conversations in batch."""
    try:
        results = []
        successful = 0
        failed = 0
        
        for call_id in call_ids:
            try:
                result = await state_manager.end_conversation(
                    call_id=call_id,
                    termination_reason=reason,
                    final_summary=f"Batch termination: {reason}"
                )
                
                if result.get("success"):
                    successful += 1
                else:
                    failed += 1
                
                results.append({
                    "call_id": call_id,
                    "success": result.get("success", False),
                    "reason": result.get("reason")
                })
                
            except Exception as e:
                failed += 1
                results.append({
                    "call_id": call_id,
                    "success": False,
                    "error": str(e)
                })
        
        summary = {
            "total": len(call_ids),
            "successful": successful,
            "failed": failed,
            "results": results
        }
        
        logger.info(
            "Batch conversation termination completed",
            total=len(call_ids),
            successful=successful,
            failed=failed
        )
        
        return summary
        
    except Exception as e:
        logger.error(
            "Batch termination failed",
            call_ids_count=len(call_ids),
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Batch termination failed: {str(e)}"
        )