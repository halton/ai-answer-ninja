"""Call effectiveness evaluation system."""

import asyncio
import time
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta

import numpy as np

from app.core.config import settings
from app.core.database import conversation_queries
from app.core.logging import get_logger, analysis_logger
from app.models.analysis import CallEffectivenessMetrics
from app.services.service_client import ServiceClient

logger = get_logger(__name__)


class CallEffectivenessEvaluator:
    """Evaluates the effectiveness of AI call handling."""
    
    def __init__(self):
        self.service_client = ServiceClient()
        self.evaluation_criteria = self._load_evaluation_criteria()
    
    def _load_evaluation_criteria(self) -> Dict[str, Any]:
        """Load evaluation criteria and weights."""
        return {
            "response_quality": {
                "weight": 0.25,
                "criteria": {
                    "relevance": 0.4,
                    "naturalness": 0.3,
                    "coherence": 0.3
                }
            },
            "conversation_flow": {
                "weight": 0.20,
                "criteria": {
                    "smooth_transitions": 0.4,
                    "appropriate_responses": 0.4,
                    "context_awareness": 0.2
                }
            },
            "caller_satisfaction": {
                "weight": 0.20,
                "criteria": {
                    "politeness_maintained": 0.3,
                    "frustration_managed": 0.4,
                    "clear_communication": 0.3
                }
            },
            "termination_appropriateness": {
                "weight": 0.15,
                "criteria": {
                    "timing": 0.4,
                    "method": 0.3,
                    "outcome": 0.3
                }
            },
            "response_latency": {
                "weight": 0.10,
                "criteria": {
                    "average_latency": 0.6,
                    "consistency": 0.4
                }
            },
            "contextual_awareness": {
                "weight": 0.10,
                "criteria": {
                    "user_profile_usage": 0.3,
                    "conversation_history": 0.4,
                    "situational_adaptation": 0.3
                }
            }
        }
    
    async def evaluate_call_effectiveness(
        self, 
        call_id: str, 
        user_id: str
    ) -> CallEffectivenessMetrics:
        """Evaluate overall call effectiveness."""
        analysis_logger.log_analysis_start(call_id, "effectiveness_evaluation")
        start_time = time.time()
        
        try:
            # Gather call data
            call_data = await self._gather_call_data(call_id, user_id)
            
            # Perform evaluations in parallel
            evaluation_tasks = [
                self._evaluate_response_quality(call_data),
                self._evaluate_conversation_flow(call_data),
                self._evaluate_caller_satisfaction(call_data),
                self._evaluate_termination_appropriateness(call_data),
                self._evaluate_response_latency(call_data),
                self._evaluate_contextual_awareness(call_data)
            ]
            
            results = await asyncio.gather(*evaluation_tasks)
            
            # Calculate scores
            metrics = CallEffectivenessMetrics(
                ai_response_quality=results[0],
                conversation_flow=results[1],
                caller_satisfaction=results[2],
                termination_appropriateness=results[3],
                response_latency_score=results[4],
                contextual_awareness=results[5],
                overall_score=0.0  # Will be calculated below
            )
            
            # Calculate overall score
            metrics.overall_score = self._calculate_overall_score(metrics)
            
            processing_time = int((time.time() - start_time) * 1000)
            analysis_logger.log_analysis_complete(
                call_id,
                "effectiveness_evaluation", 
                processing_time,
                {"overall_score": metrics.overall_score}
            )
            
            return metrics
            
        except Exception as e:
            analysis_logger.log_error("effectiveness_evaluation", call_id, e)
            raise
    
    async def _gather_call_data(self, call_id: str, user_id: str) -> Dict[str, Any]:
        """Gather all relevant call data for evaluation."""
        try:
            # Get call record and conversations
            conversations = await conversation_queries.get_call_conversations(call_id)
            
            # Get user profile and preferences
            user_profile = await self.service_client.get_user_profile(user_id)
            
            # Get call context and metadata
            call_record = await self._get_call_record(call_id)
            
            # Get recent conversation history for context
            recent_conversations = await conversation_queries.get_recent_user_conversations(
                user_id, limit=20
            )
            
            return {
                "call_id": call_id,
                "user_id": user_id,
                "conversations": conversations,
                "user_profile": user_profile,
                "call_record": call_record,
                "recent_conversations": recent_conversations,
                "total_duration": call_record.get("duration_seconds", 0),
                "ai_responses": [c for c in conversations if c.get("speaker") == "ai"],
                "caller_responses": [c for c in conversations if c.get("speaker") == "caller"]
            }
            
        except Exception as e:
            logger.error("call_data_gathering_failed", call_id=call_id, error=str(e))
            raise
    
    async def _get_call_record(self, call_id: str) -> Dict[str, Any]:
        """Get call record from database."""
        query = """
        SELECT 
            id, user_id, caller_phone, call_type, call_status,
            start_time, end_time, duration_seconds,
            response_time_ms, cache_hit_ratio, ai_model_version,
            processing_metadata
        FROM call_records 
        WHERE id = $1
        """
        results = await conversation_queries.db.execute_raw_query(query, call_id)
        return dict(results[0]) if results else {}
    
    async def _evaluate_response_quality(self, call_data: Dict[str, Any]) -> float:
        """Evaluate AI response quality."""
        try:
            ai_responses = call_data.get("ai_responses", [])
            if not ai_responses:
                return 0.0
            
            quality_scores = []
            
            for response in ai_responses:
                response_text = response.get("message_text", "")
                intent_category = response.get("intent_category", "")
                confidence = response.get("confidence_score", 0.0)
                
                # Evaluate relevance
                relevance_score = await self._evaluate_response_relevance(
                    response_text, 
                    intent_category, 
                    call_data
                )
                
                # Evaluate naturalness
                naturalness_score = self._evaluate_response_naturalness(response_text)
                
                # Evaluate coherence
                coherence_score = self._evaluate_response_coherence(
                    response_text, 
                    call_data["conversations"]
                )
                
                # Weighted score for this response
                criteria = self.evaluation_criteria["response_quality"]["criteria"]
                response_score = (
                    relevance_score * criteria["relevance"] +
                    naturalness_score * criteria["naturalness"] +
                    coherence_score * criteria["coherence"]
                )
                
                quality_scores.append(response_score)
            
            return np.mean(quality_scores) if quality_scores else 0.0
            
        except Exception as e:
            logger.error("response_quality_evaluation_failed", error=str(e))
            return 0.0
    
    async def _evaluate_response_relevance(
        self, 
        response: str, 
        intent: str, 
        call_data: Dict[str, Any]
    ) -> float:
        """Evaluate response relevance to caller intent."""
        # Simple relevance scoring based on intent matching
        intent_response_patterns = {
            "sales_call": ["不需要", "不感兴趣", "谢谢", "现在不方便"],
            "loan_offer": ["不需要贷款", "不缺钱", "有其他安排"],
            "investment_pitch": ["不投资", "风险太大", "有理财规划"],
            "insurance_sales": ["有保险了", "不需要", "考虑中"],
            "debt_collection": ["会处理", "了解了", "联系相关部门"],
            "survey_request": ["没时间", "不参与", "谢谢"]
        }
        
        if intent in intent_response_patterns:
            patterns = intent_response_patterns[intent]
            for pattern in patterns:
                if pattern in response:
                    return 0.8  # High relevance
            return 0.4  # Medium relevance
        
        return 0.6  # Default relevance
    
    def _evaluate_response_naturalness(self, response: str) -> float:
        """Evaluate naturalness of AI responses."""
        naturalness_indicators = {
            "positive": [
                "谢谢", "不好意思", "抱歉", "理解", "明白", 
                "现在", "时间", "方便", "考虑"
            ],
            "negative": [
                "系统", "程序", "算法", "机器", "自动", 
                "错误", "无法", "不能"
            ]
        }
        
        response_lower = response.lower()
        positive_count = sum(1 for word in naturalness_indicators["positive"] if word in response_lower)
        negative_count = sum(1 for word in naturalness_indicators["negative"] if word in response_lower)
        
        # Calculate naturalness score
        if len(response) < 5:
            return 0.3  # Too short
        
        if len(response) > 100:
            return 0.7  # Might be too verbose
        
        base_score = 0.6
        base_score += positive_count * 0.1
        base_score -= negative_count * 0.15
        
        return max(0.0, min(1.0, base_score))
    
    def _evaluate_response_coherence(
        self, 
        response: str, 
        conversation_history: List[Dict]
    ) -> float:
        """Evaluate coherence with conversation context."""
        if not conversation_history or len(conversation_history) < 2:
            return 0.7  # Default for single response
        
        # Check if response follows logically from previous exchanges
        recent_messages = conversation_history[-3:] if len(conversation_history) >= 3 else conversation_history
        
        coherence_score = 0.7  # Base score
        
        # Check for repetition
        previous_ai_responses = [
            msg.get("message_text", "") 
            for msg in recent_messages 
            if msg.get("speaker") == "ai"
        ]
        
        if response in previous_ai_responses:
            coherence_score -= 0.3  # Penalty for repetition
        
        # Check for appropriate response progression
        last_caller_message = None
        for msg in reversed(recent_messages):
            if msg.get("speaker") == "caller":
                last_caller_message = msg.get("message_text", "")
                break
        
        if last_caller_message:
            # Simple coherence check based on response appropriateness
            if self._is_appropriate_response(last_caller_message, response):
                coherence_score += 0.2
            else:
                coherence_score -= 0.2
        
        return max(0.0, min(1.0, coherence_score))
    
    def _is_appropriate_response(self, caller_message: str, ai_response: str) -> bool:
        """Check if AI response is appropriate to caller message."""
        caller_lower = caller_message.lower()
        response_lower = ai_response.lower()
        
        # Check for appropriate responses to common patterns
        if any(word in caller_lower for word in ["再见", "挂了", "不用了"]):
            return any(word in response_lower for word in ["再见", "好的", "谢谢"])
        
        if any(word in caller_lower for word in ["什么", "不懂", "不明白"]):
            return any(word in response_lower for word in ["抱歉", "解释", "是这样"])
        
        if any(word in caller_lower for word in ["不需要", "不要", "不感兴趣"]):
            return any(word in response_lower for word in ["理解", "好的", "打扰了", "谢谢"])
        
        return True  # Default to appropriate
    
    async def _evaluate_conversation_flow(self, call_data: Dict[str, Any]) -> float:
        """Evaluate conversation flow quality."""
        conversations = call_data.get("conversations", [])
        if len(conversations) < 2:
            return 0.5
        
        # Analyze conversation patterns
        turn_count = len(conversations)
        ai_turns = len(call_data.get("ai_responses", []))
        caller_turns = len(call_data.get("caller_responses", []))
        
        # Evaluate smooth transitions
        transition_score = self._evaluate_conversation_transitions(conversations)
        
        # Evaluate appropriate responses
        appropriateness_score = await self._evaluate_response_appropriateness(call_data)
        
        # Evaluate context awareness
        context_score = self._evaluate_conversation_context_awareness(conversations)
        
        criteria = self.evaluation_criteria["conversation_flow"]["criteria"]
        return (
            transition_score * criteria["smooth_transitions"] +
            appropriateness_score * criteria["appropriate_responses"] + 
            context_score * criteria["context_awareness"]
        )
    
    def _evaluate_conversation_transitions(self, conversations: List[Dict]) -> float:
        """Evaluate smoothness of conversation transitions."""
        if len(conversations) < 3:
            return 0.7
        
        transition_scores = []
        
        for i in range(1, len(conversations) - 1):
            prev_msg = conversations[i-1]
            curr_msg = conversations[i] 
            next_msg = conversations[i+1]
            
            # Check response times
            if (curr_msg.get("processing_latency") and 
                curr_msg["processing_latency"] < 2000):  # Less than 2 seconds
                transition_scores.append(0.8)
            else:
                transition_scores.append(0.4)
        
        return np.mean(transition_scores) if transition_scores else 0.7
    
    async def _evaluate_response_appropriateness(self, call_data: Dict[str, Any]) -> float:
        """Evaluate appropriateness of AI responses."""
        ai_responses = call_data.get("ai_responses", [])
        appropriate_count = 0
        
        for response in ai_responses:
            response_text = response.get("message_text", "")
            intent = response.get("intent_category", "")
            
            if self._is_response_appropriate_for_intent(response_text, intent):
                appropriate_count += 1
        
        return appropriate_count / len(ai_responses) if ai_responses else 0.0
    
    def _is_response_appropriate_for_intent(self, response: str, intent: str) -> bool:
        """Check if response is appropriate for detected intent."""
        # Define appropriate response patterns for each intent
        appropriate_patterns = {
            "sales_call": ["不需要", "不感兴趣", "现在不方便", "谢谢"],
            "loan_offer": ["不需要贷款", "经济状况", "不缺资金"],
            "investment_pitch": ["不投资", "有风险", "不感兴趣", "有规划"],
            "insurance_sales": ["有保险", "不需要", "考虑中"],
            "debt_collection": ["会处理", "联系", "了解"],
            "survey_request": ["没时间", "不参与", "太忙"]
        }
        
        if intent in appropriate_patterns:
            patterns = appropriate_patterns[intent]
            return any(pattern in response for pattern in patterns)
        
        return True  # Default to appropriate for unknown intents
    
    def _evaluate_conversation_context_awareness(self, conversations: List[Dict]) -> float:
        """Evaluate context awareness in conversation."""
        if len(conversations) < 2:
            return 0.5
        
        context_scores = []
        
        for i in range(1, len(conversations)):
            current = conversations[i]
            previous = conversations[i-1]
            
            # Check if AI response acknowledges previous context
            if (current.get("speaker") == "ai" and 
                self._shows_context_awareness(current, previous)):
                context_scores.append(0.8)
            else:
                context_scores.append(0.5)
        
        return np.mean(context_scores) if context_scores else 0.5
    
    def _shows_context_awareness(self, current_msg: Dict, previous_msg: Dict) -> bool:
        """Check if current message shows awareness of previous context."""
        current_text = current_msg.get("message_text", "").lower()
        previous_text = previous_msg.get("message_text", "").lower()
        
        # Simple context awareness indicators
        context_indicators = ["理解", "明白", "刚才", "您说的", "关于"]
        
        return any(indicator in current_text for indicator in context_indicators)
    
    async def _evaluate_caller_satisfaction(self, call_data: Dict[str, Any]) -> float:
        """Evaluate caller satisfaction based on conversation patterns."""
        conversations = call_data.get("conversations", [])
        caller_responses = call_data.get("caller_responses", [])
        
        if not caller_responses:
            return 0.5
        
        # Analyze sentiment progression
        sentiment_scores = []
        frustration_indicators = []
        politeness_maintained = True
        
        for response in caller_responses:
            message = response.get("message_text", "")
            emotion = response.get("emotion", "neutral")
            
            # Check for frustration indicators
            frustration_words = ["烦", "够了", "别", "停", "不耐烦", "麻烦"]
            if any(word in message for word in frustration_words):
                frustration_indicators.append(response)
            
            # Check for impoliteness
            impolite_words = ["滚", "死", "神经病", "有病", "白痴"]
            if any(word in message for word in impolite_words):
                politeness_maintained = False
            
            # Score based on emotion
            emotion_scores = {
                "positive": 1.0,
                "neutral": 0.7,
                "frustrated": 0.3,
                "aggressive": 0.1,
                "confused": 0.5
            }
            sentiment_scores.append(emotion_scores.get(emotion, 0.5))
        
        # Calculate component scores
        politeness_score = 1.0 if politeness_maintained else 0.3
        frustration_score = max(0.0, 1.0 - (len(frustration_indicators) / len(caller_responses)))
        sentiment_score = np.mean(sentiment_scores) if sentiment_scores else 0.5
        
        criteria = self.evaluation_criteria["caller_satisfaction"]["criteria"]
        return (
            politeness_score * criteria["politeness_maintained"] +
            frustration_score * criteria["frustration_managed"] +
            sentiment_score * criteria["clear_communication"]
        )
    
    async def _evaluate_termination_appropriateness(self, call_data: Dict[str, Any]) -> float:
        """Evaluate appropriateness of call termination."""
        call_record = call_data.get("call_record", {})
        conversations = call_data.get("conversations", [])
        
        call_status = call_record.get("call_status", "")
        duration = call_record.get("duration_seconds", 0)
        
        # Evaluate timing appropriateness
        timing_score = self._evaluate_termination_timing(duration, conversations)
        
        # Evaluate termination method
        method_score = self._evaluate_termination_method(conversations, call_status)
        
        # Evaluate outcome appropriateness
        outcome_score = self._evaluate_termination_outcome(call_data)
        
        criteria = self.evaluation_criteria["termination_appropriateness"]["criteria"]
        return (
            timing_score * criteria["timing"] +
            method_score * criteria["method"] +
            outcome_score * criteria["outcome"]
        )
    
    def _evaluate_termination_timing(self, duration: int, conversations: List[Dict]) -> float:
        """Evaluate appropriateness of termination timing."""
        turn_count = len(conversations)
        
        # Ideal range: 2-8 turns, 30-300 seconds
        if turn_count < 2:
            return 0.3  # Too short
        elif turn_count > 15:
            return 0.4  # Too long
        elif 3 <= turn_count <= 8:
            return 1.0  # Optimal
        else:
            return 0.7  # Acceptable
    
    def _evaluate_termination_method(self, conversations: List[Dict], call_status: str) -> float:
        """Evaluate method of call termination."""
        if not conversations:
            return 0.5
        
        last_messages = conversations[-2:] if len(conversations) >= 2 else conversations
        
        # Check for polite termination
        polite_endings = ["再见", "谢谢", "打扰了", "好的", "理解"]
        for msg in last_messages:
            if msg.get("speaker") == "ai":
                message = msg.get("message_text", "")
                if any(ending in message for ending in polite_endings):
                    return 0.9
        
        # Check call status
        if call_status == "completed":
            return 0.8
        elif call_status == "terminated":
            return 0.6
        else:
            return 0.4
    
    def _evaluate_termination_outcome(self, call_data: Dict[str, Any]) -> float:
        """Evaluate outcome appropriateness."""
        # This would ideally involve checking if the spam call was effectively handled
        # For now, we'll use proxy metrics
        
        caller_responses = call_data.get("caller_responses", [])
        if not caller_responses:
            return 0.5
        
        # Check if caller seemed satisfied or gave up
        last_caller_msg = caller_responses[-1].get("message_text", "").lower()
        
        positive_outcomes = ["好的", "明白", "再见", "谢谢", "理解"]
        negative_outcomes = ["烦", "够了", "挂了", "不听"]
        
        if any(outcome in last_caller_msg for outcome in positive_outcomes):
            return 0.9
        elif any(outcome in last_caller_msg for outcome in negative_outcomes):
            return 0.3
        else:
            return 0.6
    
    async def _evaluate_response_latency(self, call_data: Dict[str, Any]) -> float:
        """Evaluate AI response latency performance."""
        ai_responses = call_data.get("ai_responses", [])
        if not ai_responses:
            return 0.0
        
        latencies = []
        for response in ai_responses:
            latency = response.get("processing_latency")
            if latency:
                latencies.append(latency)
        
        if not latencies:
            return 0.5
        
        avg_latency = np.mean(latencies)
        consistency = 1.0 - (np.std(latencies) / np.mean(latencies)) if np.mean(latencies) > 0 else 0.0
        
        # Score based on latency (lower is better)
        if avg_latency < 1000:  # < 1 second
            latency_score = 1.0
        elif avg_latency < 2000:  # < 2 seconds  
            latency_score = 0.8
        elif avg_latency < 3000:  # < 3 seconds
            latency_score = 0.6
        else:
            latency_score = 0.3
        
        criteria = self.evaluation_criteria["response_latency"]["criteria"]
        return (
            latency_score * criteria["average_latency"] +
            consistency * criteria["consistency"]
        )
    
    async def _evaluate_contextual_awareness(self, call_data: Dict[str, Any]) -> float:
        """Evaluate contextual awareness of the AI system."""
        user_profile = call_data.get("user_profile", {})
        conversations = call_data.get("conversations", [])
        recent_conversations = call_data.get("recent_conversations", [])
        
        # Evaluate user profile usage
        profile_score = self._evaluate_profile_usage(conversations, user_profile)
        
        # Evaluate conversation history usage  
        history_score = self._evaluate_history_usage(conversations, recent_conversations)
        
        # Evaluate situational adaptation
        adaptation_score = self._evaluate_situational_adaptation(call_data)
        
        criteria = self.evaluation_criteria["contextual_awareness"]["criteria"]
        return (
            profile_score * criteria["user_profile_usage"] +
            history_score * criteria["conversation_history"] +
            adaptation_score * criteria["situational_adaptation"]
        )
    
    def _evaluate_profile_usage(self, conversations: List[Dict], user_profile: Dict) -> float:
        """Evaluate usage of user profile information."""
        if not user_profile or not conversations:
            return 0.0
        
        # Check if AI responses reflect user personality
        personality = user_profile.get("personality", "")
        ai_messages = [c.get("message_text", "") for c in conversations if c.get("speaker") == "ai"]
        
        if not ai_messages:
            return 0.0
        
        # Simple personality matching
        personality_patterns = {
            "polite": ["谢谢", "不好意思", "抱歉", "请"],
            "direct": ["不需要", "没兴趣", "不要"],
            "professional": ["理解", "考虑", "情况", "需要"]
        }
        
        if personality in personality_patterns:
            patterns = personality_patterns[personality]
            matches = sum(
                1 for msg in ai_messages 
                for pattern in patterns 
                if pattern in msg
            )
            return min(matches / len(ai_messages), 1.0)
        
        return 0.5
    
    def _evaluate_history_usage(self, conversations: List[Dict], recent_conversations: List[Dict]) -> float:
        """Evaluate usage of conversation history."""
        # For simplicity, we'll check if the current conversation shows awareness
        # of patterns from recent conversations
        
        if not recent_conversations or len(conversations) < 2:
            return 0.5
        
        # Check for references to previous interactions
        ai_messages = [c.get("message_text", "") for c in conversations if c.get("speaker") == "ai"]
        
        history_indicators = ["之前", "上次", "记得", "提到过", "说过"]
        
        for msg in ai_messages:
            if any(indicator in msg for indicator in history_indicators):
                return 0.8
        
        return 0.3
    
    def _evaluate_situational_adaptation(self, call_data: Dict[str, Any]) -> float:
        """Evaluate adaptation to current situation."""
        conversations = call_data.get("conversations", [])
        caller_responses = call_data.get("caller_responses", [])
        
        if not caller_responses:
            return 0.5
        
        # Check if AI adapted its responses based on caller behavior
        adaptation_indicators = []
        
        for i, caller_msg in enumerate(caller_responses):
            emotion = caller_msg.get("emotion", "neutral")
            
            # Find corresponding AI response
            ai_response = None
            for conv in conversations:
                if (conv.get("sequence_number", 0) > caller_msg.get("sequence_number", 0) and 
                    conv.get("speaker") == "ai"):
                    ai_response = conv
                    break
            
            if ai_response:
                ai_text = ai_response.get("message_text", "").lower()
                
                # Check adaptation to emotion
                if emotion == "frustrated" and any(word in ai_text for word in ["理解", "抱歉", "打扰"]):
                    adaptation_indicators.append(1.0)
                elif emotion == "confused" and any(word in ai_text for word in ["解释", "是这样", "意思"]):
                    adaptation_indicators.append(1.0)
                else:
                    adaptation_indicators.append(0.3)
        
        return np.mean(adaptation_indicators) if adaptation_indicators else 0.5
    
    def _calculate_overall_score(self, metrics: CallEffectivenessMetrics) -> float:
        """Calculate weighted overall effectiveness score."""
        weights = {key: config["weight"] for key, config in self.evaluation_criteria.items()}
        
        weighted_score = (
            metrics.ai_response_quality * weights["response_quality"] +
            metrics.conversation_flow * weights["conversation_flow"] +
            metrics.caller_satisfaction * weights["caller_satisfaction"] +
            metrics.termination_appropriateness * weights["termination_appropriateness"] +
            metrics.response_latency_score * weights["response_latency"] +
            metrics.contextual_awareness * weights["contextual_awareness"]
        )
        
        return round(weighted_score, 3)
    
    async def batch_evaluate_effectiveness(
        self, 
        call_ids: List[str], 
        user_id: str
    ) -> List[Tuple[str, CallEffectivenessMetrics]]:
        """Evaluate effectiveness for multiple calls."""
        results = []
        
        # Process in batches to avoid overwhelming the system
        batch_size = 5
        for i in range(0, len(call_ids), batch_size):
            batch = call_ids[i:i + batch_size]
            
            batch_tasks = [
                self.evaluate_call_effectiveness(call_id, user_id) 
                for call_id in batch
            ]
            
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            for call_id, result in zip(batch, batch_results):
                if isinstance(result, Exception):
                    logger.error("batch_effectiveness_evaluation_failed", 
                                call_id=call_id, error=str(result))
                    # Create default metrics for failed evaluation
                    result = CallEffectivenessMetrics(
                        overall_score=0.0,
                        ai_response_quality=0.0,
                        conversation_flow=0.0,
                        caller_satisfaction=0.0,
                        termination_appropriateness=0.0,
                        response_latency_score=0.0,
                        contextual_awareness=0.0
                    )
                
                results.append((call_id, result))
        
        return results


# Singleton instance
effectiveness_evaluator = CallEffectivenessEvaluator()