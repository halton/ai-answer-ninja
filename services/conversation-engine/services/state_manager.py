import asyncio
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from uuid import UUID
import json
import structlog
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..core.cache import conversation_cache
from ..models.conversation import (
    ConversationSession, ConversationTurn, ConversationContext,
    ConversationState, ConversationStage, EmotionalState, 
    IntentCategory, ConversationMessage
)
from ..models.user import UserProfileData, PersonalityType

logger = structlog.get_logger(__name__)


class ConversationStateManager:
    """Manages conversation state tracking and context management."""
    
    def __init__(self):
        self.active_conversations: Dict[str, ConversationContext] = {}
        self.state_transitions = self._initialize_state_transitions()
        self.termination_conditions = self._initialize_termination_conditions()
        
        # Performance tracking
        self.total_conversations = 0
        self.active_count = 0
        self.avg_conversation_duration = 0.0
    
    def _initialize_state_transitions(self) -> Dict[ConversationStage, Dict[IntentCategory, ConversationStage]]:
        """Initialize conversation state transition rules."""
        return {
            ConversationStage.INITIAL: {
                IntentCategory.SALES_CALL: ConversationStage.HANDLING_SALES,
                IntentCategory.LOAN_OFFER: ConversationStage.HANDLING_LOAN,
                IntentCategory.INVESTMENT_PITCH: ConversationStage.HANDLING_INVESTMENT,
                IntentCategory.INSURANCE_SALES: ConversationStage.HANDLING_INSURANCE,
                IntentCategory.SURVEY: ConversationStage.POLITE_DECLINE,
                IntentCategory.SCAM: ConversationStage.FIRM_REJECTION,
                IntentCategory.GOODBYE: ConversationStage.CALL_END
            },
            ConversationStage.HANDLING_SALES: {
                IntentCategory.PERSISTENCE: ConversationStage.FIRM_REJECTION,
                IntentCategory.QUESTION: ConversationStage.POLITE_DECLINE,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.SALES_CALL: ConversationStage.HANDLING_SALES  # Stay in same stage
            },
            ConversationStage.HANDLING_LOAN: {
                IntentCategory.PERSISTENCE: ConversationStage.FIRM_REJECTION,
                IntentCategory.QUESTION: ConversationStage.POLITE_DECLINE,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.LOAN_OFFER: ConversationStage.HANDLING_LOAN
            },
            ConversationStage.HANDLING_INVESTMENT: {
                IntentCategory.PERSISTENCE: ConversationStage.FIRM_REJECTION,
                IntentCategory.QUESTION: ConversationStage.POLITE_DECLINE,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.INVESTMENT_PITCH: ConversationStage.HANDLING_INVESTMENT
            },
            ConversationStage.HANDLING_INSURANCE: {
                IntentCategory.PERSISTENCE: ConversationStage.FIRM_REJECTION,
                IntentCategory.QUESTION: ConversationStage.POLITE_DECLINE,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.INSURANCE_SALES: ConversationStage.HANDLING_INSURANCE
            },
            ConversationStage.POLITE_DECLINE: {
                IntentCategory.PERSISTENCE: ConversationStage.FIRM_REJECTION,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.QUESTION: ConversationStage.POLITE_DECLINE
            },
            ConversationStage.FIRM_REJECTION: {
                IntentCategory.PERSISTENCE: ConversationStage.HANG_UP_WARNING,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.QUESTION: ConversationStage.FIRM_REJECTION
            },
            ConversationStage.HANG_UP_WARNING: {
                IntentCategory.PERSISTENCE: ConversationStage.CALL_END,
                IntentCategory.GOODBYE: ConversationStage.CALL_END,
                IntentCategory.QUESTION: ConversationStage.CALL_END
            },
            ConversationStage.CALL_END: {}
        }
    
    def _initialize_termination_conditions(self) -> Dict[str, Dict[str, Any]]:
        """Initialize conversation termination conditions."""
        return {
            "max_turns": {
                "threshold": 8,
                "action": "terminate",
                "reason": "max_turns_reached"
            },
            "max_duration": {
                "threshold": 180,  # 3 minutes in seconds
                "action": "terminate",
                "reason": "max_duration_reached"
            },
            "persistence_level": {
                "threshold": 0.8,
                "action": "escalate",
                "reason": "high_persistence_detected"
            },
            "frustration_level": {
                "threshold": 0.9,
                "action": "terminate",
                "reason": "high_frustration_detected"
            },
            "response_ineffectiveness": {
                "threshold": 0.2,
                "consecutive_count": 3,
                "action": "escalate",
                "reason": "ineffective_responses"
            }
        }
    
    async def start_conversation(
        self,
        call_id: str,
        user_id: UUID,
        caller_phone: str,
        initial_intent: Optional[IntentCategory] = None,
        user_profile: Optional[UserProfileData] = None,
        spam_category: Optional[str] = None
    ) -> ConversationContext:
        """Start a new conversation and initialize context."""
        try:
            # Create conversation context
            context = ConversationContext(
                call_id=call_id,
                user_id=user_id,
                caller_phone=caller_phone,
                current_stage=ConversationStage.INITIAL,
                emotional_state=EmotionalState.NEUTRAL,
                turn_count=0,
                start_time=datetime.utcnow(),
                user_profile=user_profile.dict() if user_profile else None,
                spam_category=spam_category
            )
            
            # Store in active conversations
            self.active_conversations[call_id] = context
            
            # Create database session record
            await self._create_session_record(context, initial_intent)
            
            # Cache conversation context
            await conversation_cache.set_conversation_state(
                call_id,
                {
                    "stage": context.current_stage.value,
                    "emotional_state": context.emotional_state.value,
                    "turn_count": context.turn_count,
                    "start_time": context.start_time.isoformat()
                }
            )
            
            self.total_conversations += 1
            self.active_count += 1
            
            logger.info(
                "Conversation started",
                call_id=call_id,
                user_id=str(user_id),
                caller_phone=caller_phone[:6] + "****",
                initial_intent=initial_intent.value if initial_intent else None
            )
            
            return context
            
        except Exception as e:
            logger.error(
                "Failed to start conversation",
                call_id=call_id,
                error=str(e)
            )
            raise
    
    async def update_conversation_state(
        self,
        call_id: str,
        new_message: ConversationMessage,
        detected_intent: Optional[IntentCategory] = None,
        emotional_analysis: Optional[Dict[str, Any]] = None
    ) -> ConversationContext:
        """Update conversation state with new message and analysis."""
        try:
            # Get current context
            context = await self.get_conversation_context(call_id)
            if not context:
                raise ValueError(f"Conversation {call_id} not found")
            
            # Add message to history
            context.conversation_history.append(new_message)
            context.turn_count += 1
            
            # Update emotional state if provided
            if emotional_analysis:
                new_emotional_state = EmotionalState(emotional_analysis["emotional_state"])
                context.emotional_state = new_emotional_state
            
            # Determine stage transition
            if detected_intent:
                new_stage = self._get_next_stage(
                    context.current_stage,
                    detected_intent,
                    context
                )
                context.current_stage = new_stage
            
            # Update active conversations
            self.active_conversations[call_id] = context
            
            # Create turn record in database
            await self._create_turn_record(context, new_message, detected_intent, emotional_analysis)
            
            # Update cached state
            await conversation_cache.set_conversation_state(
                call_id,
                {
                    "stage": context.current_stage.value,
                    "emotional_state": context.emotional_state.value,
                    "turn_count": context.turn_count,
                    "last_updated": datetime.utcnow().isoformat()
                }
            )
            
            # Cache conversation history
            await conversation_cache.set_conversation_history(
                call_id,
                [msg.dict() for msg in context.conversation_history]
            )
            
            logger.info(
                "Conversation state updated",
                call_id=call_id,
                new_stage=context.current_stage.value,
                turn_count=context.turn_count,
                emotional_state=context.emotional_state.value
            )
            
            return context
            
        except Exception as e:
            logger.error(
                "Failed to update conversation state",
                call_id=call_id,
                error=str(e)
            )
            raise
    
    async def evaluate_termination_conditions(
        self,
        call_id: str,
        persistence_score: Optional[float] = None,
        frustration_level: Optional[float] = None,
        response_effectiveness: Optional[float] = None
    ) -> Dict[str, Any]:
        """Evaluate if conversation should be terminated."""
        try:
            context = await self.get_conversation_context(call_id)
            if not context:
                return {"should_terminate": False, "reason": "context_not_found"}
            
            termination_reasons = []
            
            # Check turn count
            if context.turn_count >= self.termination_conditions["max_turns"]["threshold"]:
                termination_reasons.append("max_turns_reached")
            
            # Check duration
            duration_seconds = (datetime.utcnow() - context.start_time).total_seconds()
            if duration_seconds >= self.termination_conditions["max_duration"]["threshold"]:
                termination_reasons.append("max_duration_reached")
            
            # Check persistence level
            if persistence_score and persistence_score >= self.termination_conditions["persistence_level"]["threshold"]:
                termination_reasons.append("high_persistence_detected")
            
            # Check frustration level
            if frustration_level and frustration_level >= self.termination_conditions["frustration_level"]["threshold"]:
                termination_reasons.append("high_frustration_detected")
            
            # Check response effectiveness
            if response_effectiveness and response_effectiveness <= self.termination_conditions["response_ineffectiveness"]["threshold"]:
                # Track consecutive ineffective responses
                ineffective_count = self._count_recent_ineffective_responses(context)
                if ineffective_count >= self.termination_conditions["response_ineffectiveness"]["consecutive_count"]:
                    termination_reasons.append("ineffective_responses")
            
            # Check current stage
            if context.current_stage == ConversationStage.CALL_END:
                termination_reasons.append("conversation_ended")
            
            should_terminate = len(termination_reasons) > 0
            primary_reason = termination_reasons[0] if termination_reasons else None
            
            # Determine termination type
            termination_type = "normal"
            if "high_frustration_detected" in termination_reasons:
                termination_type = "escalated"
            elif "max_duration_reached" in termination_reasons or "max_turns_reached" in termination_reasons:
                termination_type = "timeout"
            elif "conversation_ended" in termination_reasons:
                termination_type = "natural"
            
            result = {
                "should_terminate": should_terminate,
                "reason": primary_reason,
                "termination_type": termination_type,
                "all_reasons": termination_reasons,
                "conversation_duration_seconds": duration_seconds,
                "turn_count": context.turn_count
            }
            
            logger.info(
                "Termination evaluation completed",
                call_id=call_id,
                should_terminate=should_terminate,
                reason=primary_reason,
                termination_type=termination_type
            )
            
            return result
            
        except Exception as e:
            logger.error(
                "Failed to evaluate termination conditions",
                call_id=call_id,
                error=str(e)
            )
            return {"should_terminate": False, "error": str(e)}
    
    async def end_conversation(
        self,
        call_id: str,
        termination_reason: str,
        final_summary: Optional[str] = None
    ) -> Dict[str, Any]:
        """End conversation and perform cleanup."""
        try:
            context = self.active_conversations.get(call_id)
            if not context:
                logger.warning("Attempted to end non-existent conversation", call_id=call_id)
                return {"success": False, "reason": "conversation_not_found"}
            
            # Calculate conversation metrics
            end_time = datetime.utcnow()
            duration = (end_time - context.start_time).total_seconds()
            
            # Update database session record
            async with get_db_session() as session:
                # Find session record
                stmt = select(ConversationSession).where(
                    ConversationSession.call_id == call_id
                )
                result = await session.execute(stmt)
                session_record = result.scalar_one_or_none()
                
                if session_record:
                    # Update session with final data
                    session_record.end_time = end_time
                    session_record.duration_seconds = int(duration)
                    session_record.turn_count = context.turn_count
                    session_record.is_active = False
                    session_record.termination_reason = termination_reason
                    session_record.final_summary = final_summary
                    session_record.conversation_history = json.dumps(
                        [msg.dict() for msg in context.conversation_history]
                    )
                    
                    await session.commit()
            
            # Remove from active conversations
            del self.active_conversations[call_id]
            self.active_count -= 1
            
            # Update average conversation duration
            self.avg_conversation_duration = (
                (self.avg_conversation_duration * (self.total_conversations - 1) + duration) /
                self.total_conversations
            )
            
            # Clear cache
            await conversation_cache.clear_conversation_data(call_id)
            
            conversation_summary = {
                "call_id": call_id,
                "duration_seconds": duration,
                "turn_count": context.turn_count,
                "termination_reason": termination_reason,
                "final_stage": context.current_stage.value,
                "final_emotional_state": context.emotional_state.value,
                "success": True
            }
            
            logger.info(
                "Conversation ended",
                call_id=call_id,
                duration_seconds=duration,
                turn_count=context.turn_count,
                reason=termination_reason
            )
            
            return conversation_summary
            
        except Exception as e:
            logger.error(
                "Failed to end conversation",
                call_id=call_id,
                error=str(e)
            )
            return {"success": False, "error": str(e)}
    
    async def get_conversation_context(self, call_id: str) -> Optional[ConversationContext]:
        """Get conversation context from memory or cache."""
        # First check active conversations
        if call_id in self.active_conversations:
            return self.active_conversations[call_id]
        
        # Try to load from cache
        try:
            cached_state = await conversation_cache.get_conversation_state(call_id)
            cached_history = await conversation_cache.get_conversation_history(call_id)
            
            if cached_state and cached_history:
                # Reconstruct context from cache
                context = ConversationContext(
                    call_id=call_id,
                    user_id=UUID(cached_state.get("user_id")),  # This might need to be stored in cache
                    caller_phone=cached_state.get("caller_phone", "unknown"),
                    current_stage=ConversationStage(cached_state["stage"]),
                    emotional_state=EmotionalState(cached_state["emotional_state"]),
                    turn_count=cached_state["turn_count"],
                    start_time=datetime.fromisoformat(cached_state["start_time"]),
                    conversation_history=[
                        ConversationMessage(**msg) for msg in cached_history
                    ]
                )
                
                # Re-add to active conversations
                self.active_conversations[call_id] = context
                return context
        
        except Exception as e:
            logger.warning(
                "Failed to load conversation from cache",
                call_id=call_id,
                error=str(e)
            )
        
        return None
    
    def _get_next_stage(
        self,
        current_stage: ConversationStage,
        intent: IntentCategory,
        context: ConversationContext
    ) -> ConversationStage:
        """Determine next conversation stage based on current stage and intent."""
        
        # Get transition rules for current stage
        transitions = self.state_transitions.get(current_stage, {})
        
        # Apply special rules based on context
        if context.turn_count >= 6 and intent in [IntentCategory.PERSISTENCE, IntentCategory.SALES_CALL]:
            return ConversationStage.FIRM_REJECTION
        
        if context.turn_count >= 8:
            return ConversationStage.HANG_UP_WARNING
        
        # Apply standard transition or stay in current stage
        return transitions.get(intent, current_stage)
    
    def _count_recent_ineffective_responses(self, context: ConversationContext) -> int:
        """Count recent ineffective responses (simplified heuristic)."""
        if len(context.conversation_history) < 6:
            return 0
        
        # Look at last 3 AI responses and check if user keeps persisting
        recent_messages = context.conversation_history[-6:]
        ai_responses = [msg for msg in recent_messages if msg.speaker == "ai"]
        user_messages = [msg for msg in recent_messages if msg.speaker == "user"]
        
        # If user keeps responding after AI messages, consider responses ineffective
        ineffective_count = 0
        for i, ai_msg in enumerate(ai_responses[-3:]):
            # Check if there's a user response after this AI message
            ai_index = recent_messages.index(ai_msg)
            user_responses_after = [
                msg for msg in recent_messages[ai_index+1:] 
                if msg.speaker == "user"
            ]
            if user_responses_after:
                ineffective_count += 1
        
        return ineffective_count
    
    async def _create_session_record(
        self,
        context: ConversationContext,
        initial_intent: Optional[IntentCategory] = None
    ) -> None:
        """Create conversation session record in database."""
        try:
            async with get_db_session() as session:
                session_record = ConversationSession(
                    call_id=context.call_id,
                    user_id=context.user_id,
                    caller_phone=context.caller_phone,
                    start_time=context.start_time,
                    current_stage=context.current_stage.value,
                    emotional_state=context.emotional_state.value,
                    intent_category=initial_intent.value if initial_intent else None,
                    turn_count=0,
                    is_active=True,
                    conversation_history=json.dumps([]),
                    context_data=json.dumps({
                        "spam_category": context.spam_category,
                        "user_profile": context.user_profile
                    })
                )
                
                session.add(session_record)
                await session.commit()
                
        except Exception as e:
            logger.error(
                "Failed to create session record",
                call_id=context.call_id,
                error=str(e)
            )
            # Don't raise - this is not critical for conversation flow
    
    async def _create_turn_record(
        self,
        context: ConversationContext,
        message: ConversationMessage,
        detected_intent: Optional[IntentCategory] = None,
        emotional_analysis: Optional[Dict[str, Any]] = None
    ) -> None:
        """Create conversation turn record in database."""
        try:
            async with get_db_session() as session:
                # Find session record first
                stmt = select(ConversationSession).where(
                    ConversationSession.call_id == context.call_id
                )
                result = await session.execute(stmt)
                session_record = result.scalar_one_or_none()
                
                if session_record:
                    turn_record = ConversationTurn(
                        session_id=session_record.id,
                        turn_number=context.turn_count,
                        speaker=message.speaker,
                        input_text=message.text if message.speaker == "user" else None,
                        response_text=message.text if message.speaker == "ai" else None,
                        detected_intent=detected_intent.value if detected_intent else None,
                        intent_confidence=message.intent_confidence,
                        emotional_tone=message.emotion.value if message.emotion else None,
                        emotional_confidence=message.emotion_confidence,
                        processing_time_ms=message.processing_time_ms,
                        response_cached=message.cached,
                        timestamp=message.timestamp
                    )
                    
                    session.add(turn_record)
                    await session.commit()
                
        except Exception as e:
            logger.error(
                "Failed to create turn record",
                call_id=context.call_id,
                error=str(e)
            )
            # Don't raise - this is not critical for conversation flow
    
    async def get_conversation_analytics(
        self,
        call_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get analytics for a conversation."""
        try:
            context = await self.get_conversation_context(call_id)
            if not context:
                return None
            
            # Calculate metrics
            duration = (datetime.utcnow() - context.start_time).total_seconds()
            
            # Analyze message distribution
            user_messages = [msg for msg in context.conversation_history if msg.speaker == "user"]
            ai_messages = [msg for msg in context.conversation_history if msg.speaker == "ai"]
            
            # Calculate response times
            response_times = [msg.processing_time_ms for msg in ai_messages if msg.processing_time_ms]
            avg_response_time = sum(response_times) / len(response_times) if response_times else 0
            
            # Analyze emotional progression
            emotional_states = [msg.emotion for msg in context.conversation_history if msg.emotion]
            
            # Count cached responses
            cached_responses = sum(1 for msg in ai_messages if msg.cached)
            cache_hit_rate = cached_responses / len(ai_messages if ai_messages else [1])
            
            analytics = {
                "call_id": call_id,
                "duration_seconds": duration,
                "turn_count": context.turn_count,
                "user_messages": len(user_messages),
                "ai_messages": len(ai_messages),
                "current_stage": context.current_stage.value,
                "current_emotional_state": context.emotional_state.value,
                "avg_response_time_ms": avg_response_time,
                "max_response_time_ms": max(response_times) if response_times else 0,
                "cache_hit_rate": cache_hit_rate,
                "emotional_progression": [state.value for state in emotional_states],
                "conversation_efficiency": self._calculate_efficiency_score(context),
                "predicted_outcome": self._predict_conversation_outcome(context)
            }
            
            return analytics
            
        except Exception as e:
            logger.error(
                "Failed to get conversation analytics",
                call_id=call_id,
                error=str(e)
            )
            return None
    
    def _calculate_efficiency_score(self, context: ConversationContext) -> float:
        """Calculate conversation efficiency score (0-1)."""
        # Simple heuristic - shorter conversations with clear outcomes are more efficient
        base_score = 1.0
        
        # Penalize long conversations
        turn_penalty = min(context.turn_count / 10.0, 0.5)
        base_score -= turn_penalty
        
        # Bonus for reaching definitive stages
        if context.current_stage in [ConversationStage.CALL_END, ConversationStage.FIRM_REJECTION]:
            base_score += 0.2
        
        # Penalize stuck conversations
        if context.current_stage == ConversationStage.INITIAL and context.turn_count > 3:
            base_score -= 0.3
        
        return max(0.0, min(1.0, base_score))
    
    def _predict_conversation_outcome(self, context: ConversationContext) -> str:
        """Predict likely conversation outcome."""
        if context.current_stage == ConversationStage.CALL_END:
            return "completed"
        elif context.current_stage in [ConversationStage.FIRM_REJECTION, ConversationStage.HANG_UP_WARNING]:
            return "likely_termination"
        elif context.turn_count >= 6:
            return "extended_conversation"
        elif context.current_stage in [ConversationStage.POLITE_DECLINE]:
            return "polite_resolution"
        else:
            return "ongoing"
    
    async def get_performance_metrics(self) -> Dict[str, Any]:
        """Get state manager performance metrics."""
        return {
            "total_conversations": self.total_conversations,
            "active_conversations": self.active_count,
            "avg_conversation_duration_seconds": self.avg_conversation_duration,
            "state_transition_rules": len(self.state_transitions),
            "termination_conditions": len(self.termination_conditions),
            "service_status": "healthy"
        }
    
    async def cleanup_inactive_conversations(self, max_age_hours: int = 2) -> int:
        """Clean up inactive conversations older than specified hours."""
        cleaned_count = 0
        cutoff_time = datetime.utcnow() - timedelta(hours=max_age_hours)
        
        inactive_calls = []
        for call_id, context in self.active_conversations.items():
            if context.start_time < cutoff_time:
                inactive_calls.append(call_id)
        
        for call_id in inactive_calls:
            try:
                await self.end_conversation(
                    call_id,
                    "cleanup_timeout",
                    "Conversation cleaned up due to inactivity"
                )
                cleaned_count += 1
            except Exception as e:
                logger.error(
                    "Failed to cleanup conversation",
                    call_id=call_id,
                    error=str(e)
                )
        
        logger.info(
            "Conversation cleanup completed",
            cleaned_count=cleaned_count,
            max_age_hours=max_age_hours
        )
        
        return cleaned_count


# Global state manager instance
state_manager = ConversationStateManager()
