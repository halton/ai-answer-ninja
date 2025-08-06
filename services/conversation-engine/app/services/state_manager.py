"""
Advanced conversation state management service.
Handles conversation context, memory, and state transitions.
"""

import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from sqlalchemy.exc import SQLAlchemyError

from app.core.cache import CacheManager, CacheKeys
from app.core.logging import ConversationLogger
from app.models.conversation import ConversationState, ConversationMessage
from app.models.user import UserProfile


class ConversationStateManager:
    """Manages conversation state and context with advanced memory."""
    
    def __init__(self, cache_manager: CacheManager):
        self.cache = cache_manager
        self.logger = ConversationLogger("state_manager")
        
        # State transition rules
        self.state_transitions = {
            'initial': {
                'sales_call': 'handling_sales',
                'loan_offer': 'handling_loan',
                'investment_pitch': 'handling_investment',
                'insurance_sales': 'handling_insurance',
                'survey_request': 'handling_survey',
                'unknown': 'general_response'
            },
            'handling_sales': {
                'persistence': 'firm_rejection',
                'question': 'polite_decline',
                'agreement': 'gentle_termination',
                'goodbye': 'call_end',
                'escalation': 'escalated_response'
            },
            'handling_loan': {
                'interest_inquiry': 'loan_details_decline',
                'persistence': 'firm_loan_rejection',
                'personal_info_request': 'privacy_protection',
                'goodbye': 'call_end'
            },
            'handling_investment': {
                'risk_discussion': 'investment_decline',
                'return_promises': 'skeptical_response',
                'urgency_tactics': 'firm_rejection',
                'goodbye': 'call_end'
            },
            'firm_rejection': {
                'continued_persistence': 'final_warning',
                'new_angle': 'reinforced_rejection',
                'goodbye': 'call_end',
                'escalation': 'hang_up'
            },
            'final_warning': {
                'any': 'hang_up'
            }
        }
        
        # Context memory configuration
        self.max_context_messages = 10
        self.context_decay_hours = 24
        self.memory_weight_factors = {
            'recency': 0.4,     # Recent messages have higher weight
            'importance': 0.3,   # Important intents have higher weight
            'emotional': 0.2,    # Emotional content has higher weight
            'user_focus': 0.1    # User-specific focus areas
        }

    async def get_conversation_state(
        self,
        conversation_id: str,
        db: AsyncSession
    ) -> Optional[ConversationState]:
        """Get current conversation state with caching."""
        
        # Try cache first
        cache_key = CacheKeys.conversation_state(conversation_id)
        cached_state = await self.cache.get(cache_key)
        
        if cached_state:
            return ConversationState(**cached_state)
        
        # Query database
        try:
            stmt = select(ConversationState).where(
                ConversationState.conversation_id == conversation_id
            )
            result = await db.execute(stmt)
            state = result.scalar_one_or_none()
            
            if state:
                # Cache the state
                state_dict = {
                    'id': str(state.id),
                    'conversation_id': state.conversation_id,
                    'user_id': str(state.user_id),
                    'current_stage': state.current_stage,
                    'intent_category': state.intent_category,
                    'personality_type': state.personality_type,
                    'turn_count': state.turn_count,
                    'context_data': state.context_data,
                    'caller_phone': state.caller_phone,
                    'spam_category': state.spam_category,
                    'is_active': state.is_active,
                    'should_terminate': state.should_terminate,
                    'termination_reason': state.termination_reason,
                    'created_at': state.created_at.isoformat(),
                    'updated_at': state.updated_at.isoformat()
                }
                await self.cache.set(cache_key, state_dict, ttl=1800)  # 30 minutes
            
            return state
            
        except SQLAlchemyError as e:
            self.logger.log_error(
                conversation_id,
                "database_error",
                f"Error fetching conversation state: {str(e)}",
                {"operation": "get_conversation_state"}
            )
            return None

    async def create_conversation_state(
        self,
        conversation_id: str,
        user_id: UUID,
        caller_phone: str,
        personality_type: str,
        spam_category: Optional[str],
        call_record_id: Optional[UUID],
        db: AsyncSession
    ) -> ConversationState:
        """Create new conversation state."""
        
        initial_context = {
            'caller_phone': caller_phone,
            'start_time': datetime.utcnow().isoformat(),
            'recent_intents': [],
            'emotional_history': [],
            'user_responses': [],
            'conversation_summary': '',
            'key_topics': [],
            'caller_behavior_patterns': []
        }
        
        new_state = ConversationState(
            conversation_id=conversation_id,
            user_id=user_id,
            call_record_id=call_record_id,
            current_stage='initial',
            personality_type=personality_type,
            context_data=initial_context,
            caller_phone=caller_phone,
            spam_category=spam_category,
            is_active=True,
            should_terminate=False
        )
        
        try:
            db.add(new_state)
            await db.commit()
            await db.refresh(new_state)
            
            # Cache the new state
            cache_key = CacheKeys.conversation_state(conversation_id)
            state_dict = {
                'id': str(new_state.id),
                'conversation_id': new_state.conversation_id,
                'user_id': str(new_state.user_id),
                'current_stage': new_state.current_stage,
                'intent_category': new_state.intent_category,
                'personality_type': new_state.personality_type,
                'turn_count': new_state.turn_count,
                'context_data': new_state.context_data,
                'caller_phone': new_state.caller_phone,
                'spam_category': new_state.spam_category,
                'is_active': new_state.is_active,
                'should_terminate': new_state.should_terminate,
                'termination_reason': new_state.termination_reason,
                'created_at': new_state.created_at.isoformat(),
                'updated_at': new_state.updated_at.isoformat()
            }
            await self.cache.set(cache_key, state_dict, ttl=1800)
            
            self.logger.log_conversation_start(
                conversation_id,
                str(user_id),
                caller_phone,
                personality_type
            )
            
            return new_state
            
        except SQLAlchemyError as e:
            await db.rollback()
            self.logger.log_error(
                conversation_id,
                "database_error", 
                f"Error creating conversation state: {str(e)}",
                {"user_id": str(user_id), "caller_phone": caller_phone}
            )
            raise

    async def update_conversation_state(
        self,
        conversation_id: str,
        updates: Dict[str, Any],
        db: AsyncSession
    ) -> bool:
        """Update conversation state with new information."""
        
        try:
            # Update database
            stmt = (
                update(ConversationState)
                .where(ConversationState.conversation_id == conversation_id)
                .values(**updates, updated_at=datetime.utcnow())
            )
            result = await db.execute(stmt)
            await db.commit()
            
            if result.rowcount > 0:
                # Invalidate cache
                cache_key = CacheKeys.conversation_state(conversation_id)
                await self.cache.delete(cache_key)
                return True
            
            return False
            
        except SQLAlchemyError as e:
            await db.rollback()
            self.logger.log_error(
                conversation_id,
                "database_error",
                f"Error updating conversation state: {str(e)}",
                {"updates": updates}
            )
            return False

    async def transition_state(
        self,
        conversation_id: str,
        current_stage: str,
        detected_intent: str,
        context: Dict[str, Any],
        db: AsyncSession
    ) -> Optional[str]:
        """Handle state transitions based on detected intent."""
        
        # Get transition rules for current stage
        stage_transitions = self.state_transitions.get(current_stage, {})
        
        # Determine next stage
        next_stage = stage_transitions.get(detected_intent)
        
        # If no specific transition, check for generic transitions
        if not next_stage:
            if detected_intent in ['goodbye', 'hang_up', 'end_call']:
                next_stage = 'call_end'
            elif 'persistence' in detected_intent.lower():
                next_stage = 'firm_rejection' if current_stage != 'firm_rejection' else 'final_warning'
            elif current_stage in ['firm_rejection', 'final_warning']:
                next_stage = 'hang_up'
        
        # Apply context-based modifications
        if next_stage:
            next_stage = await self._apply_contextual_modifications(
                next_stage, context, conversation_id
            )
            
            # Update state
            updates = {
                'current_stage': next_stage,
                'intent_category': detected_intent,
                'last_activity': datetime.utcnow()
            }
            
            await self.update_conversation_state(conversation_id, updates, db)
            
            self.logger.logger.info(
                "state_transition",
                conversation_id=conversation_id,
                from_stage=current_stage,
                to_stage=next_stage,
                intent=detected_intent
            )
        
        return next_stage

    async def build_conversation_context(
        self,
        conversation_id: str,
        db: AsyncSession,
        include_history: bool = True
    ) -> Dict[str, Any]:
        """Build rich conversation context for AI processing."""
        
        # Get conversation state
        state = await self.get_conversation_state(conversation_id, db)
        if not state:
            return {}
        
        context = {
            'conversation_id': conversation_id,
            'current_stage': state.current_stage,
            'intent_category': state.intent_category,
            'personality_type': state.personality_type,
            'turn_count': state.turn_count,
            'caller_phone': state.caller_phone,
            'spam_category': state.spam_category,
            'base_context': state.context_data
        }
        
        if include_history:
            # Get recent conversation history
            history = await self._get_conversation_history(conversation_id, db)
            context['recent_messages'] = history['messages']
            context['conversation_summary'] = history['summary']
            context['emotional_pattern'] = history['emotional_pattern']
            context['caller_behavior'] = history['caller_behavior']
        
        # Add contextual intelligence
        context['memory_weights'] = await self._calculate_memory_weights(
            conversation_id, context
        )
        context['contextual_cues'] = await self._extract_contextual_cues(
            conversation_id, context
        )
        
        return context

    async def _get_conversation_history(
        self,
        conversation_id: str,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """Get and analyze conversation history."""
        
        # Check cache first
        cache_key = CacheKeys.conversation_history(conversation_id)
        cached_history = await self.cache.get(cache_key)
        
        if cached_history:
            return cached_history
        
        try:
            # Get recent messages
            stmt = (
                select(ConversationMessage)
                .where(ConversationMessage.conversation_id == conversation_id)
                .order_by(ConversationMessage.timestamp.desc())
                .limit(self.max_context_messages)
            )
            result = await db.execute(stmt)
            messages = result.scalars().all()
            
            # Process history
            history = {
                'messages': [],
                'summary': '',
                'emotional_pattern': [],
                'caller_behavior': []
            }
            
            if messages:
                # Convert messages to context format
                for msg in reversed(messages):  # Chronological order
                    history['messages'].append({
                        'speaker': msg.speaker,
                        'text': msg.message_text,
                        'intent': msg.intent,
                        'sentiment': msg.sentiment,
                        'emotion': msg.emotion,
                        'timestamp': msg.timestamp.isoformat(),
                        'confidence': msg.confidence_score
                    })
                
                # Analyze patterns
                history['emotional_pattern'] = self._analyze_emotional_pattern(messages)
                history['caller_behavior'] = self._analyze_caller_behavior(messages)
                history['summary'] = self._generate_conversation_summary(messages)
            
            # Cache the history
            await self.cache.set(cache_key, history, ttl=600)  # 10 minutes
            
            return history
            
        except SQLAlchemyError as e:
            self.logger.log_error(
                conversation_id,
                "database_error",
                f"Error fetching conversation history: {str(e)}",
                {"operation": "get_conversation_history"}
            )
            return {'messages': [], 'summary': '', 'emotional_pattern': [], 'caller_behavior': []}

    def _analyze_emotional_pattern(self, messages: List[ConversationMessage]) -> List[str]:
        """Analyze emotional progression in conversation."""
        pattern = []
        
        for msg in messages:
            if msg.emotion and msg.emotion != 'neutral':
                pattern.append(msg.emotion)
        
        # Identify trends
        if len(pattern) >= 3:
            if pattern[-3:] == ['neutral', 'frustrated', 'angry']:
                pattern.append('escalating_frustration')
            elif 'persistent' in [msg.intent for msg in messages[-3:]]:
                pattern.append('increasing_persistence')
        
        return pattern[-5:]  # Keep last 5 emotional states

    def _analyze_caller_behavior(self, messages: List[ConversationMessage]) -> List[str]:
        """Analyze caller behavioral patterns."""
        behaviors = []
        caller_messages = [msg for msg in messages if msg.speaker == 'caller']
        
        if not caller_messages:
            return behaviors
        
        # Analyze persistence
        persistent_count = sum(1 for msg in caller_messages 
                             if msg.intent and 'persist' in msg.intent.lower())
        if persistent_count > 2:
            behaviors.append('highly_persistent')
        elif persistent_count > 0:
            behaviors.append('moderately_persistent')
        
        # Analyze question patterns
        question_count = sum(1 for msg in caller_messages 
                           if '?' in msg.message_text)
        if question_count > 3:
            behaviors.append('inquisitive')
        
        # Analyze emotional escalation
        emotions = [msg.emotion for msg in caller_messages if msg.emotion]
        if 'angry' in emotions or 'frustrated' in emotions:
            behaviors.append('emotionally_escalated') 
        
        return behaviors

    def _generate_conversation_summary(self, messages: List[ConversationMessage]) -> str:
        """Generate concise conversation summary."""
        if not messages:
            return "No conversation history"
        
        # Key points to summarize
        caller_intents = []
        ai_strategies = []
        
        for msg in messages:
            if msg.speaker == 'caller' and msg.intent:
                caller_intents.append(msg.intent)
            elif msg.speaker == 'ai' and msg.response_strategy:
                ai_strategies.append(msg.response_strategy)
        
        summary_parts = []
        
        if caller_intents:
            primary_intent = max(set(caller_intents), key=caller_intents.count)
            summary_parts.append(f"Caller primary intent: {primary_intent}")
        
        if ai_strategies:
            primary_strategy = max(set(ai_strategies), key=ai_strategies.count)
            summary_parts.append(f"AI response strategy: {primary_strategy}")
        
        summary_parts.append(f"Turn count: {len(messages)}")
        
        return " | ".join(summary_parts)

    async def _apply_contextual_modifications(
        self,
        proposed_stage: str,
        context: Dict[str, Any],
        conversation_id: str
    ) -> str:
        """Apply contextual intelligence to modify state transitions."""
        
        # Get user profile for personality-based modifications
        user_id = context.get('user_id')
        if user_id:
            profile_key = CacheKeys.user_profile(str(user_id))
            user_profile = await self.cache.get(profile_key)
            
            if user_profile:
                # Adjust based on user's assertiveness level
                assertiveness = user_profile.get('assertiveness_level', 0.5)
                
                if assertiveness > 0.8 and proposed_stage == 'polite_decline':
                    proposed_stage = 'firm_rejection'
                elif assertiveness < 0.3 and proposed_stage == 'firm_rejection':
                    proposed_stage = 'polite_decline'
        
        # Consider emotional context
        emotional_pattern = context.get('emotional_pattern', [])
        if 'escalating_frustration' in emotional_pattern:
            if proposed_stage in ['polite_decline', 'gentle_termination']:
                proposed_stage = 'firm_rejection'
        
        return proposed_stage

    async def _calculate_memory_weights(
        self,
        conversation_id: str,
        context: Dict[str, Any]
    ) -> Dict[str, float]:
        """Calculate memory weights for context prioritization."""
        
        weights = {}
        recent_messages = context.get('recent_messages', [])
        
        for i, msg in enumerate(recent_messages):
            # Recency weight (more recent = higher weight)
            recency_weight = (i + 1) / len(recent_messages) * self.memory_weight_factors['recency']
            
            # Importance weight (based on intent significance)
            importance_weight = self._get_intent_importance(msg.get('intent', '')) * self.memory_weight_factors['importance']
            
            # Emotional weight (emotional content = higher weight)
            emotional_weight = self._get_emotional_importance(msg.get('emotion', '')) * self.memory_weight_factors['emotional']
            
            # Total weight
            total_weight = recency_weight + importance_weight + emotional_weight
            weights[f"message_{i}"] = min(total_weight, 1.0)
        
        return weights

    def _get_intent_importance(self, intent: str) -> float:
        """Get importance score for different intents."""
        importance_map = {
            'hang_up': 1.0,
            'escalation': 0.9,
            'personal_info_request': 0.8,
            'persistence': 0.7,
            'goodbye': 0.6,
            'question': 0.4,
            'greeting': 0.2
        }
        return importance_map.get(intent, 0.3)

    def _get_emotional_importance(self, emotion: str) -> float:
        """Get importance score for different emotions."""
        emotion_map = {
            'angry': 1.0,
            'frustrated': 0.8,
            'confused': 0.6,
            'neutral': 0.2,
            'satisfied': 0.4
        }
        return emotion_map.get(emotion, 0.3)

    async def _extract_contextual_cues(
        self,
        conversation_id: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Extract contextual cues for enhanced AI processing."""
        
        cues = {
            'urgency_level': 'normal',
            'caller_sophistication': 'medium',
            'conversation_tone': 'neutral',
            'termination_readiness': 0.0,
            'user_comfort_level': 0.5
        }
        
        recent_messages = context.get('recent_messages', [])
        emotional_pattern = context.get('emotional_pattern', [])
        caller_behavior = context.get('caller_behavior', [])
        
        # Assess urgency
        if 'highly_persistent' in caller_behavior:
            cues['urgency_level'] = 'high'
        elif len(recent_messages) > 6:
            cues['urgency_level'] = 'elevated'
        
        # Assess caller sophistication
        question_complexity = sum(1 for msg in recent_messages 
                                if msg.get('speaker') == 'caller' and len(msg.get('text', '').split()) > 10)
        if question_complexity > 2:
            cues['caller_sophistication'] = 'high'
        elif question_complexity == 0:
            cues['caller_sophistication'] = 'low'
        
        # Assess conversation tone
        if 'emotionally_escalated' in caller_behavior:
            cues['conversation_tone'] = 'tense'
        elif 'frustrated' in emotional_pattern:
            cues['conversation_tone'] = 'strained'
        elif 'satisfied' in emotional_pattern:
            cues['conversation_tone'] = 'positive'
        
        # Assess termination readiness
        turn_count = context.get('turn_count', 0)
        if turn_count > 8:
            cues['termination_readiness'] = 0.9
        elif turn_count > 5:
            cues['termination_readiness'] = 0.6
        elif turn_count > 3:
            cues['termination_readiness'] = 0.3
        
        return cues

    async def cleanup_expired_states(self, db: AsyncSession) -> int:
        """Clean up expired conversation states."""
        
        cutoff_time = datetime.utcnow() - timedelta(hours=self.context_decay_hours)
        
        try:
            # Update expired active states to inactive
            stmt = (
                update(ConversationState)
                .where(
                    and_(
                        ConversationState.is_active == True,
                        ConversationState.last_activity < cutoff_time
                    )
                )
                .values(
                    is_active=False,
                    should_terminate=True,
                    termination_reason='timeout',
                    updated_at=datetime.utcnow()
                )
            )
            result = await db.execute(stmt)
            await db.commit()
            
            cleaned_count = result.rowcount
            
            if cleaned_count > 0:
                self.logger.logger.info(
                    "expired_states_cleaned",
                    count=cleaned_count,
                    cutoff_time=cutoff_time.isoformat()
                )
            
            return cleaned_count
            
        except SQLAlchemyError as e:
            await db.rollback()
            self.logger.log_error(
                "system",
                "cleanup_error",
                f"Error cleaning expired states: {str(e)}",
                {"cutoff_time": cutoff_time.isoformat()}
            )
            return 0