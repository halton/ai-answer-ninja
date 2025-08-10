"""
Conversation Manager Service
Manages dialogue state tracking, response strategy, and conversation flow
"""

import asyncio
import json
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from enum import Enum
import structlog

from ..core.config import settings
from ..core.cache import conversation_cache
from ..models.conversation import (
    ConversationContext, ConversationStage, EmotionalState,
    DialogueState, ConversationMessage, IntentCategory
)
from ..models.user import UserProfileData, PersonalityType
from .intent_classifier import intent_classifier
from .response_generator import response_generator
from .termination_manager import termination_manager

logger = structlog.get_logger(__name__)


class ResponseStrategy(Enum):
    """Response strategy types"""
    GENTLE_DECLINE = "gentle_decline"
    FIRM_DECLINE = "firm_decline"
    WITTY_RESPONSE = "witty_response"
    EXPLAIN_NOT_INTERESTED = "explain_not_interested"
    CLEAR_REFUSAL = "clear_refusal"
    DEFLECT_WITH_HUMOR = "deflect_with_humor"
    PROFESSIONAL_RESPONSE = "professional_response"
    FINAL_WARNING = "final_warning"
    IMMEDIATE_HANGUP = "immediate_hangup"


class DialogueStateTracker:
    """Track and manage dialogue state throughout conversation"""
    
    def __init__(self):
        self.states = {}  # call_id -> DialogueState
        self.state_transition_rules = self._initialize_transition_rules()
        
    def _initialize_transition_rules(self) -> Dict[str, Dict[str, str]]:
        """Initialize state transition rules"""
        return {
            ConversationStage.INITIAL: {
                IntentCategory.SALES_CALL: ConversationStage.HANDLING_SALES,
                IntentCategory.LOAN_OFFER: ConversationStage.HANDLING_LOAN,
                IntentCategory.INVESTMENT_PITCH: ConversationStage.HANDLING_INVESTMENT,
                IntentCategory.INSURANCE_SALES: ConversationStage.HANDLING_INSURANCE,
                IntentCategory.TELECOM_OFFER: ConversationStage.HANDLING_TELECOM,
                "greeting": ConversationStage.INITIAL,
                "unknown": ConversationStage.INITIAL
            },
            ConversationStage.HANDLING_SALES: {
                "persistence": ConversationStage.FIRM_REJECTION,
                "question": ConversationStage.POLITE_DECLINE,
                "acceptance": ConversationStage.CALL_END,
                "goodbye": ConversationStage.CALL_END,
                "escalation": ConversationStage.FIRM_REJECTION
            },
            ConversationStage.HANDLING_LOAN: {
                "persistence": ConversationStage.FIRM_REJECTION,
                "clarification": ConversationStage.POLITE_DECLINE,
                "rejection_accepted": ConversationStage.CALL_END,
                "continued_pitch": ConversationStage.FIRM_REJECTION
            },
            ConversationStage.POLITE_DECLINE: {
                "acceptance": ConversationStage.CALL_END,
                "persistence": ConversationStage.FIRM_REJECTION,
                "question": ConversationStage.POLITE_DECLINE,
                "escalation": ConversationStage.FIRM_REJECTION
            },
            ConversationStage.FIRM_REJECTION: {
                "continued_persistence": ConversationStage.HANG_UP_WARNING,
                "acceptance": ConversationStage.CALL_END,
                "apology": ConversationStage.CALL_END,
                "aggression": ConversationStage.HANG_UP_WARNING
            },
            ConversationStage.HANG_UP_WARNING: {
                "any": ConversationStage.CALL_END
            }
        }
    
    async def get_state(self, call_id: str) -> DialogueState:
        """Get current dialogue state for a call"""
        if call_id not in self.states:
            # Try to recover from cache
            cached_state = await self._get_cached_state(call_id)
            if cached_state:
                self.states[call_id] = cached_state
            else:
                # Create new state
                self.states[call_id] = DialogueState(
                    call_id=call_id,
                    stage=ConversationStage.INITIAL,
                    turn_count=0,
                    start_time=datetime.utcnow(),
                    intent_history=[],
                    emotional_trajectory=[EmotionalState.NEUTRAL],
                    key_points=[]
                )
        
        return self.states[call_id]
    
    async def update_state(
        self,
        call_id: str,
        intent: IntentCategory,
        emotional_state: EmotionalState,
        message: str,
        response_type: str = None
    ) -> DialogueState:
        """Update dialogue state based on new interaction"""
        state = await self.get_state(call_id)
        
        # Update basic counters
        state.turn_count += 1
        state.last_update = datetime.utcnow()
        
        # Track intent history
        state.intent_history.append(intent)
        
        # Track emotional trajectory
        state.emotional_trajectory.append(emotional_state)
        
        # Determine transition trigger
        transition_trigger = self._determine_transition_trigger(
            state, intent, emotional_state, message
        )
        
        # Apply state transition
        new_stage = self._apply_transition(state.stage, transition_trigger)
        state.stage = new_stage
        
        # Extract and store key points
        key_point = self._extract_key_point(message, intent)
        if key_point:
            state.key_points.append(key_point)
        
        # Cache the updated state
        await self._cache_state(call_id, state)
        
        logger.info(
            "Dialogue state updated",
            call_id=call_id,
            stage=new_stage.value,
            turn_count=state.turn_count,
            trigger=transition_trigger
        )
        
        return state
    
    def _determine_transition_trigger(
        self,
        state: DialogueState,
        intent: IntentCategory,
        emotional_state: EmotionalState,
        message: str
    ) -> str:
        """Determine what triggers a state transition"""
        message_lower = message.lower()
        
        # Check for persistence
        if state.turn_count > 3 and intent in state.intent_history[-3:]:
            return "persistence"
        
        # Check for acceptance/goodbye
        goodbye_phrases = ["好的", "再见", "知道了", "明白了", "拜拜", "挂了"]
        if any(phrase in message_lower for phrase in goodbye_phrases):
            return "goodbye" if state.stage != ConversationStage.FIRM_REJECTION else "acceptance"
        
        # Check for escalation
        if emotional_state in [EmotionalState.AGGRESSIVE, EmotionalState.FRUSTRATED]:
            return "escalation"
        
        # Check for questions
        if "?" in message or "吗" in message or "呢" in message:
            return "question"
        
        # Check for continued pitch after rejection
        if state.stage in [ConversationStage.POLITE_DECLINE, ConversationStage.FIRM_REJECTION]:
            sales_keywords = ["但是", "其实", "真的", "确实", "机会", "错过"]
            if any(keyword in message_lower for keyword in sales_keywords):
                return "continued_persistence"
        
        # Default to intent-based trigger
        return intent.value if intent != IntentCategory.UNKNOWN else "unknown"
    
    def _apply_transition(
        self,
        current_stage: ConversationStage,
        trigger: str
    ) -> ConversationStage:
        """Apply state transition based on rules"""
        transitions = self.state_transition_rules.get(current_stage, {})
        
        # Check for specific trigger
        if trigger in transitions:
            return transitions[trigger]
        
        # Check for 'any' trigger (catch-all)
        if "any" in transitions:
            return transitions["any"]
        
        # No transition, stay in current stage
        return current_stage
    
    def _extract_key_point(self, message: str, intent: IntentCategory) -> Optional[str]:
        """Extract key information from message"""
        # Extract product/service names, amounts, etc.
        key_patterns = {
            IntentCategory.LOAN_OFFER: ["额度", "利率", "期限"],
            IntentCategory.INVESTMENT_PITCH: ["收益", "风险", "产品"],
            IntentCategory.SALES_CALL: ["产品", "价格", "优惠"]
        }
        
        patterns = key_patterns.get(intent, [])
        for pattern in patterns:
            if pattern in message:
                # Extract surrounding context
                idx = message.find(pattern)
                start = max(0, idx - 10)
                end = min(len(message), idx + len(pattern) + 10)
                return message[start:end].strip()
        
        return None
    
    async def _get_cached_state(self, call_id: str) -> Optional[DialogueState]:
        """Get cached dialogue state"""
        try:
            cache_key = f"dialogue_state:{call_id}"
            cached = await conversation_cache.get(cache_key)
            if cached:
                state_dict = json.loads(cached)
                # Reconstruct DialogueState from dict
                return DialogueState(**state_dict)
        except Exception as e:
            logger.warning("Failed to get cached state", error=str(e))
        return None
    
    async def _cache_state(self, call_id: str, state: DialogueState) -> None:
        """Cache dialogue state"""
        try:
            cache_key = f"dialogue_state:{call_id}"
            state_dict = {
                "call_id": state.call_id,
                "stage": state.stage.value,
                "turn_count": state.turn_count,
                "start_time": state.start_time.isoformat(),
                "last_update": state.last_update.isoformat() if state.last_update else None,
                "intent_history": [i.value for i in state.intent_history],
                "emotional_trajectory": [e.value for e in state.emotional_trajectory],
                "key_points": state.key_points
            }
            await conversation_cache.set(
                cache_key,
                json.dumps(state_dict),
                ttl=7200  # 2 hours
            )
        except Exception as e:
            logger.warning("Failed to cache state", error=str(e))


class ConversationManager:
    """
    Main conversation management service
    Orchestrates intent recognition, state tracking, and response generation
    """
    
    def __init__(self):
        self.state_tracker = DialogueStateTracker()
        self.response_strategies = self._initialize_response_strategies()
        
        # Performance metrics
        self.total_conversations = 0
        self.successful_terminations = 0
        self.avg_turn_count = 0.0
    
    def _initialize_response_strategies(self) -> Dict[str, Dict[str, ResponseStrategy]]:
        """Initialize response strategy mappings"""
        return {
            ConversationStage.INITIAL: {
                PersonalityType.POLITE: ResponseStrategy.GENTLE_DECLINE,
                PersonalityType.DIRECT: ResponseStrategy.FIRM_DECLINE,
                PersonalityType.HUMOROUS: ResponseStrategy.WITTY_RESPONSE,
                PersonalityType.PROFESSIONAL: ResponseStrategy.PROFESSIONAL_RESPONSE
            },
            ConversationStage.HANDLING_SALES: {
                PersonalityType.POLITE: ResponseStrategy.EXPLAIN_NOT_INTERESTED,
                PersonalityType.DIRECT: ResponseStrategy.CLEAR_REFUSAL,
                PersonalityType.HUMOROUS: ResponseStrategy.DEFLECT_WITH_HUMOR,
                PersonalityType.PROFESSIONAL: ResponseStrategy.PROFESSIONAL_RESPONSE
            },
            ConversationStage.FIRM_REJECTION: {
                "any": ResponseStrategy.FINAL_WARNING
            },
            ConversationStage.HANG_UP_WARNING: {
                "any": ResponseStrategy.IMMEDIATE_HANGUP
            }
        }
    
    async def manage_conversation(
        self,
        input_text: str,
        call_id: str,
        user_id: str,
        user_profile: Optional[UserProfileData] = None,
        context: Optional[ConversationContext] = None
    ) -> Dict[str, Any]:
        """
        Main conversation management method
        Processes input and generates appropriate response
        """
        start_time = datetime.utcnow()
        
        try:
            # Get current dialogue state
            current_state = await self.state_tracker.get_state(call_id)
            
            # Classify intent from input
            intent_result = await intent_classifier.classify_intent(input_text, context)
            
            # Update dialogue state
            new_state = await self.state_tracker.update_state(
                call_id,
                intent_result.intent,
                self._analyze_emotional_state(input_text),
                input_text
            )
            
            # Determine response strategy
            response_strategy = await self._determine_response_strategy(
                new_state,
                user_profile,
                intent_result
            )
            
            # Generate personalized response
            response = await response_generator.generate_personalized_response(
                response_strategy,
                context or self._build_context(call_id, user_id, new_state),
                user_profile,
                intent_result
            )
            
            # Check if conversation should terminate
            termination_check = await termination_manager.should_terminate_call(
                new_state,
                response,
                intent_result
            )
            
            # Update metrics
            self._update_metrics(new_state, termination_check)
            
            # Calculate processing time
            processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            logger.info(
                "Conversation managed",
                call_id=call_id,
                stage=new_state.stage.value,
                turn=new_state.turn_count,
                should_terminate=termination_check["terminate"],
                processing_time_ms=processing_time
            )
            
            return {
                "response": response.text,
                "audio_response": response.audio_data if hasattr(response, 'audio_data') else None,
                "next_state": new_state.stage.value,
                "should_terminate": termination_check["terminate"],
                "termination_reason": termination_check.get("reason"),
                "intent": intent_result.intent.value,
                "confidence": intent_result.confidence,
                "emotional_tone": response.emotional_tone.value,
                "turn_count": new_state.turn_count,
                "processing_time_ms": processing_time
            }
            
        except Exception as e:
            logger.error(
                "Conversation management failed",
                call_id=call_id,
                error=str(e)
            )
            # Return fallback response
            return {
                "response": "不好意思，我现在有点忙，稍后再说。",
                "should_terminate": False,
                "intent": "unknown",
                "confidence": 0.0,
                "emotional_tone": "neutral",
                "error": str(e)
            }
    
    async def _determine_response_strategy(
        self,
        state: DialogueState,
        user_profile: Optional[UserProfileData],
        intent_result: Any
    ) -> ResponseStrategy:
        """Determine appropriate response strategy"""
        strategies = self.response_strategies.get(state.stage, {})
        
        # Check for stage-specific 'any' strategy
        if "any" in strategies:
            return strategies["any"]
        
        # Get user personality-based strategy
        personality = user_profile.personality_type if user_profile else PersonalityType.POLITE
        strategy = strategies.get(personality, ResponseStrategy.GENTLE_DECLINE)
        
        # Adjust based on conversation dynamics
        if state.turn_count > 8:
            strategy = ResponseStrategy.FINAL_WARNING
        elif state.turn_count > 5 and intent_result.emotional_tone == "aggressive":
            strategy = ResponseStrategy.FIRM_DECLINE
        
        return strategy
    
    def _analyze_emotional_state(self, text: str) -> EmotionalState:
        """Analyze emotional state from text"""
        text_lower = text.lower()
        
        # Emotional indicators
        if any(word in text_lower for word in ["生气", "恼火", "讨厌", "烦"]):
            return EmotionalState.FRUSTRATED
        elif any(word in text_lower for word in ["威胁", "投诉", "曝光"]):
            return EmotionalState.AGGRESSIVE
        elif any(word in text_lower for word in ["谢谢", "抱歉", "理解"]):
            return EmotionalState.POLITE
        elif any(word in text_lower for word in ["哈哈", "开玩笑", "有意思"]):
            return EmotionalState.FRIENDLY
        else:
            return EmotionalState.NEUTRAL
    
    def _build_context(
        self,
        call_id: str,
        user_id: str,
        state: DialogueState
    ) -> ConversationContext:
        """Build conversation context from state"""
        return ConversationContext(
            call_id=call_id,
            user_id=user_id,
            caller_phone="unknown",
            current_stage=state.stage,
            turn_count=state.turn_count,
            emotional_state=state.emotional_trajectory[-1] if state.emotional_trajectory else EmotionalState.NEUTRAL,
            conversation_history=[]  # Would be populated from message history
        )
    
    def _update_metrics(self, state: DialogueState, termination_check: Dict[str, Any]) -> None:
        """Update conversation metrics"""
        self.total_conversations += 1
        
        if termination_check.get("terminate"):
            self.successful_terminations += 1
        
        # Update average turn count
        self.avg_turn_count = (
            (self.avg_turn_count * (self.total_conversations - 1) + state.turn_count) /
            self.total_conversations
        )
    
    async def get_conversation_summary(self, call_id: str) -> Dict[str, Any]:
        """Get summary of a conversation"""
        state = await self.state_tracker.get_state(call_id)
        
        if not state:
            return {"error": "Conversation not found"}
        
        duration = (state.last_update - state.start_time).total_seconds() if state.last_update else 0
        
        # Analyze intent distribution
        intent_distribution = {}
        for intent in state.intent_history:
            intent_distribution[intent.value] = intent_distribution.get(intent.value, 0) + 1
        
        # Analyze emotional progression
        emotional_summary = {
            "start": state.emotional_trajectory[0].value if state.emotional_trajectory else "neutral",
            "end": state.emotional_trajectory[-1].value if state.emotional_trajectory else "neutral",
            "peak": max(state.emotional_trajectory, key=lambda x: x.value).value if state.emotional_trajectory else "neutral"
        }
        
        return {
            "call_id": call_id,
            "total_turns": state.turn_count,
            "duration_seconds": duration,
            "final_stage": state.stage.value,
            "intent_distribution": intent_distribution,
            "emotional_summary": emotional_summary,
            "key_points": state.key_points,
            "successful_termination": state.stage == ConversationStage.CALL_END
        }
    
    async def get_performance_metrics(self) -> Dict[str, Any]:
        """Get conversation management performance metrics"""
        success_rate = self.successful_terminations / max(self.total_conversations, 1)
        
        return {
            "total_conversations": self.total_conversations,
            "successful_terminations": self.successful_terminations,
            "success_rate": success_rate,
            "avg_turn_count": self.avg_turn_count,
            "target_metrics": {
                "intent_accuracy": ">95%",
                "avg_turns_target": "<5",
                "termination_success": ">90%"
            }
        }


# Global conversation manager instance
conversation_manager = ConversationManager()