"""
Call Termination Manager Service
Intelligent call termination with persistence detection and frustration tracking
"""

import asyncio
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from dataclasses import dataclass
import structlog

from ..models.conversation import (
    ConversationStage, EmotionalState, DialogueState,
    AIResponse, IntentCategory
)

logger = structlog.get_logger(__name__)


@dataclass
class TerminationMetrics:
    """Metrics for termination decision"""
    turn_count: int
    duration_seconds: float
    persistence_score: float
    frustration_level: float
    response_effectiveness: float
    caller_aggression: float
    repetition_ratio: float


class PersistenceDetector:
    """Detect caller persistence patterns"""
    
    def __init__(self):
        self.persistence_indicators = [
            "再", "还是", "真的", "确实", "一定", "肯定",
            "但是", "其实", "只要", "只需", "机会", "错过",
            "考虑", "试试", "了解", "听我说"
        ]
        
        self.insistence_phrases = [
            "最后一次", "再给我", "就一分钟", "听完再",
            "别挂", "等等", "先别", "再说一句"
        ]
    
    async def analyze(self, dialogue_state: DialogueState) -> float:
        """
        Analyze persistence level from conversation history
        Returns score from 0.0 (not persistent) to 1.0 (extremely persistent)
        """
        if not dialogue_state or dialogue_state.turn_count < 2:
            return 0.0
        
        persistence_score = 0.0
        
        # Factor 1: Turn count (30% weight)
        turn_score = min(dialogue_state.turn_count / 10, 1.0)
        persistence_score += turn_score * 0.3
        
        # Factor 2: Intent repetition (30% weight)
        repetition_score = self._calculate_repetition_score(dialogue_state.intent_history)
        persistence_score += repetition_score * 0.3
        
        # Factor 3: Persistence keywords (20% weight)
        keyword_score = await self._calculate_keyword_score(dialogue_state)
        persistence_score += keyword_score * 0.2
        
        # Factor 4: Stage progression resistance (20% weight)
        resistance_score = self._calculate_resistance_score(dialogue_state)
        persistence_score += resistance_score * 0.2
        
        return min(persistence_score, 1.0)
    
    def _calculate_repetition_score(self, intent_history: List[IntentCategory]) -> float:
        """Calculate how repetitive the caller's intents are"""
        if len(intent_history) < 3:
            return 0.0
        
        # Check last 5 intents
        recent_intents = intent_history[-5:]
        unique_intents = set(recent_intents)
        
        # High repetition = high persistence
        repetition_ratio = 1 - (len(unique_intents) / len(recent_intents))
        return repetition_ratio
    
    async def _calculate_keyword_score(self, dialogue_state: DialogueState) -> float:
        """Calculate persistence based on keyword usage"""
        # This would analyze actual conversation messages
        # Simplified for now based on turn count
        base_score = 0.0
        
        # More turns with persistence indicators = higher score
        if dialogue_state.turn_count > 5:
            base_score = 0.5
        if dialogue_state.turn_count > 8:
            base_score = 0.8
        
        return base_score
    
    def _calculate_resistance_score(self, dialogue_state: DialogueState) -> float:
        """Calculate resistance to stage progression"""
        # If still in early stages after many turns, caller is resistant
        if dialogue_state.turn_count > 5:
            if dialogue_state.stage in [ConversationStage.INITIAL, ConversationStage.HANDLING_SALES]:
                return 0.8
            elif dialogue_state.stage == ConversationStage.POLITE_DECLINE:
                return 0.6
        
        return 0.0


class FrustrationTracker:
    """Track frustration levels in conversation"""
    
    def __init__(self):
        self.frustration_indicators = {
            EmotionalState.FRUSTRATED: 0.8,
            EmotionalState.AGGRESSIVE: 1.0,
            EmotionalState.ANNOYED: 0.6,
            EmotionalState.FIRM: 0.4,
            EmotionalState.NEUTRAL: 0.2,
            EmotionalState.POLITE: 0.0,
            EmotionalState.FRIENDLY: 0.0
        }
    
    async def analyze(self, dialogue_state: DialogueState) -> float:
        """
        Analyze frustration level from emotional trajectory
        Returns score from 0.0 (calm) to 1.0 (highly frustrated)
        """
        if not dialogue_state.emotional_trajectory:
            return 0.0
        
        # Analyze emotional progression
        frustration_score = 0.0
        
        # Recent emotions (50% weight)
        recent_emotions = dialogue_state.emotional_trajectory[-3:]
        recent_score = sum(
            self.frustration_indicators.get(emotion, 0.0) 
            for emotion in recent_emotions
        ) / len(recent_emotions)
        frustration_score += recent_score * 0.5
        
        # Peak frustration (30% weight)
        peak_emotion = max(
            dialogue_state.emotional_trajectory,
            key=lambda e: self.frustration_indicators.get(e, 0.0)
        )
        peak_score = self.frustration_indicators.get(peak_emotion, 0.0)
        frustration_score += peak_score * 0.3
        
        # Escalation trend (20% weight)
        escalation_score = self._calculate_escalation_trend(dialogue_state.emotional_trajectory)
        frustration_score += escalation_score * 0.2
        
        return min(frustration_score, 1.0)
    
    def _calculate_escalation_trend(self, emotional_trajectory: List[EmotionalState]) -> float:
        """Calculate if emotions are escalating"""
        if len(emotional_trajectory) < 3:
            return 0.0
        
        # Compare early vs recent emotions
        early_emotions = emotional_trajectory[:len(emotional_trajectory)//2]
        recent_emotions = emotional_trajectory[len(emotional_trajectory)//2:]
        
        early_avg = sum(
            self.frustration_indicators.get(e, 0.0) for e in early_emotions
        ) / max(len(early_emotions), 1)
        
        recent_avg = sum(
            self.frustration_indicators.get(e, 0.0) for e in recent_emotions
        ) / max(len(recent_emotions), 1)
        
        # Positive difference means escalation
        escalation = max(0, recent_avg - early_avg)
        return escalation


class ResponseEffectivenessAnalyzer:
    """Analyze how effective AI responses have been"""
    
    async def analyze(
        self,
        dialogue_state: DialogueState,
        current_response: AIResponse
    ) -> float:
        """
        Analyze response effectiveness
        Returns score from 0.0 (ineffective) to 1.0 (highly effective)
        """
        effectiveness_score = 1.0
        
        # Factor 1: Stage progression (40% weight)
        if dialogue_state.stage == ConversationStage.CALL_END:
            stage_score = 1.0
        elif dialogue_state.stage == ConversationStage.HANG_UP_WARNING:
            stage_score = 0.8
        elif dialogue_state.stage == ConversationStage.FIRM_REJECTION:
            stage_score = 0.6
        else:
            stage_score = 0.3
        
        effectiveness_score = stage_score * 0.4
        
        # Factor 2: Turn efficiency (30% weight)
        # Fewer turns = more effective
        turn_efficiency = max(0, 1 - (dialogue_state.turn_count / 10))
        effectiveness_score += turn_efficiency * 0.3
        
        # Factor 3: Response confidence (30% weight)
        if current_response:
            effectiveness_score += current_response.confidence * 0.3
        
        return effectiveness_score


class CallTerminationManager:
    """
    Intelligent call termination management
    Decides when and how to end conversations
    """
    
    def __init__(self):
        self.persistence_detector = PersistenceDetector()
        self.frustration_tracker = FrustrationTracker()
        self.effectiveness_analyzer = ResponseEffectivenessAnalyzer()
        
        # Termination thresholds
        self.thresholds = {
            "max_turns": 8,
            "max_duration": 180,  # 3 minutes in seconds
            "persistence_score": 0.8,
            "frustration_level": 0.9,
            "min_effectiveness": 0.3
        }
        
        # Performance tracking
        self.total_evaluations = 0
        self.termination_decisions = 0
        self.successful_terminations = 0
    
    async def should_terminate_call(
        self,
        dialogue_state: DialogueState,
        current_response: AIResponse,
        intent_result: Any = None
    ) -> Dict[str, Any]:
        """
        Determine if call should be terminated
        Returns decision with reason and suggested action
        """
        self.total_evaluations += 1
        
        try:
            # Gather termination metrics
            metrics = await self._gather_metrics(dialogue_state, current_response)
            
            # Check termination conditions
            termination_checks = await asyncio.gather(
                self._check_turn_limit(metrics),
                self._check_duration_limit(metrics),
                self._check_persistence_level(metrics),
                self._check_frustration_level(metrics),
                self._check_response_effectiveness(metrics),
                self._check_explicit_termination(current_response)
            )
            
            # Find if any condition triggers termination
            for check in termination_checks:
                if check["terminate"]:
                    self.termination_decisions += 1
                    
                    # Generate appropriate final response
                    final_response = await self._generate_final_response(
                        check["reason"],
                        dialogue_state
                    )
                    
                    logger.info(
                        "Termination decision made",
                        reason=check["reason"],
                        metrics=metrics.__dict__
                    )
                    
                    return {
                        "terminate": True,
                        "reason": check["reason"],
                        "final_response": final_response,
                        "confidence": check.get("confidence", 0.9),
                        "metrics": metrics.__dict__
                    }
            
            # No termination conditions met
            return {
                "terminate": False,
                "reason": None,
                "continue_strategy": self._suggest_continuation_strategy(metrics),
                "metrics": metrics.__dict__
            }
            
        except Exception as e:
            logger.error("Termination evaluation failed", error=str(e))
            return {
                "terminate": False,
                "reason": "evaluation_error",
                "error": str(e)
            }
    
    async def _gather_metrics(
        self,
        dialogue_state: DialogueState,
        current_response: AIResponse
    ) -> TerminationMetrics:
        """Gather all metrics for termination decision"""
        
        # Calculate duration
        duration = 0
        if dialogue_state.start_time:
            duration = (datetime.utcnow() - dialogue_state.start_time).total_seconds()
        
        # Analyze various aspects in parallel
        persistence_score, frustration_level, effectiveness = await asyncio.gather(
            self.persistence_detector.analyze(dialogue_state),
            self.frustration_tracker.analyze(dialogue_state),
            self.effectiveness_analyzer.analyze(dialogue_state, current_response)
        )
        
        # Calculate additional metrics
        repetition_ratio = self._calculate_repetition_ratio(dialogue_state)
        caller_aggression = self._calculate_aggression_level(dialogue_state)
        
        return TerminationMetrics(
            turn_count=dialogue_state.turn_count,
            duration_seconds=duration,
            persistence_score=persistence_score,
            frustration_level=frustration_level,
            response_effectiveness=effectiveness,
            caller_aggression=caller_aggression,
            repetition_ratio=repetition_ratio
        )
    
    async def _check_turn_limit(self, metrics: TerminationMetrics) -> Dict[str, Any]:
        """Check if turn count exceeds limit"""
        if metrics.turn_count >= self.thresholds["max_turns"]:
            return {
                "terminate": True,
                "reason": "max_turns_exceeded",
                "confidence": 0.95
            }
        return {"terminate": False}
    
    async def _check_duration_limit(self, metrics: TerminationMetrics) -> Dict[str, Any]:
        """Check if call duration exceeds limit"""
        if metrics.duration_seconds >= self.thresholds["max_duration"]:
            return {
                "terminate": True,
                "reason": "max_duration_exceeded",
                "confidence": 0.95
            }
        return {"terminate": False}
    
    async def _check_persistence_level(self, metrics: TerminationMetrics) -> Dict[str, Any]:
        """Check if caller persistence is too high"""
        if metrics.persistence_score >= self.thresholds["persistence_score"]:
            return {
                "terminate": True,
                "reason": "excessive_persistence",
                "confidence": metrics.persistence_score
            }
        return {"terminate": False}
    
    async def _check_frustration_level(self, metrics: TerminationMetrics) -> Dict[str, Any]:
        """Check if frustration level is too high"""
        if metrics.frustration_level >= self.thresholds["frustration_level"]:
            return {
                "terminate": True,
                "reason": "high_frustration",
                "confidence": metrics.frustration_level
            }
        return {"terminate": False}
    
    async def _check_response_effectiveness(self, metrics: TerminationMetrics) -> Dict[str, Any]:
        """Check if responses are ineffective"""
        if metrics.response_effectiveness < self.thresholds["min_effectiveness"] and metrics.turn_count > 4:
            return {
                "terminate": True,
                "reason": "ineffective_responses",
                "confidence": 0.8
            }
        return {"terminate": False}
    
    async def _check_explicit_termination(self, current_response: AIResponse) -> Dict[str, Any]:
        """Check if current response explicitly requests termination"""
        if current_response and current_response.should_terminate:
            return {
                "terminate": True,
                "reason": "explicit_termination",
                "confidence": 1.0
            }
        return {"terminate": False}
    
    def _calculate_repetition_ratio(self, dialogue_state: DialogueState) -> float:
        """Calculate how repetitive the conversation is"""
        if len(dialogue_state.intent_history) < 3:
            return 0.0
        
        recent_intents = dialogue_state.intent_history[-5:]
        unique_intents = set(recent_intents)
        
        return 1 - (len(unique_intents) / len(recent_intents))
    
    def _calculate_aggression_level(self, dialogue_state: DialogueState) -> float:
        """Calculate caller's aggression level"""
        aggressive_emotions = [
            EmotionalState.AGGRESSIVE,
            EmotionalState.FRUSTRATED,
            EmotionalState.ANNOYED
        ]
        
        if not dialogue_state.emotional_trajectory:
            return 0.0
        
        aggressive_count = sum(
            1 for emotion in dialogue_state.emotional_trajectory[-5:]
            if emotion in aggressive_emotions
        )
        
        return aggressive_count / min(len(dialogue_state.emotional_trajectory), 5)
    
    async def _generate_final_response(
        self,
        reason: str,
        dialogue_state: DialogueState
    ) -> str:
        """Generate appropriate final response based on termination reason"""
        final_responses = {
            "excessive_persistence": "我已经说得很清楚了，请不要再打扰我。再见。",
            "max_duration": "很抱歉，我现在真的有事要忙，先挂了。",
            "ineffective_responses": "看来我们的对话没有什么意义，就此结束吧。",
            "high_frustration": "我觉得这个对话没有必要继续下去了。",
            "max_turns_exceeded": "我们已经聊了很久了，我的立场不会改变。再见。",
            "explicit_termination": "好的，再见。",
            "caller_hangup": "",  # Caller hung up
            "system_termination": "对话已结束，谢谢。"
        }
        
        return final_responses.get(reason, "好的，再见。")
    
    def _suggest_continuation_strategy(self, metrics: TerminationMetrics) -> str:
        """Suggest strategy if conversation continues"""
        if metrics.persistence_score > 0.6:
            return "escalate_firmness"
        elif metrics.frustration_level > 0.6:
            return "de_escalate"
        elif metrics.response_effectiveness < 0.5:
            return "change_approach"
        else:
            return "maintain_current"
    
    async def analyze_termination_success(
        self,
        call_id: str,
        actual_outcome: str
    ) -> None:
        """Analyze if termination was successful"""
        if actual_outcome in ["caller_accepted", "caller_hung_up"]:
            self.successful_terminations += 1
        
        success_rate = self.successful_terminations / max(self.termination_decisions, 1)
        
        logger.info(
            "Termination outcome analyzed",
            call_id=call_id,
            outcome=actual_outcome,
            success_rate=success_rate
        )
    
    async def get_performance_metrics(self) -> Dict[str, Any]:
        """Get termination manager performance metrics"""
        success_rate = self.successful_terminations / max(self.termination_decisions, 1)
        termination_rate = self.termination_decisions / max(self.total_evaluations, 1)
        
        return {
            "total_evaluations": self.total_evaluations,
            "termination_decisions": self.termination_decisions,
            "successful_terminations": self.successful_terminations,
            "success_rate": success_rate,
            "termination_rate": termination_rate,
            "thresholds": self.thresholds,
            "target_success_rate": 0.9
        }
    
    async def adapt_thresholds(self, performance_data: Dict[str, Any]) -> None:
        """Adapt termination thresholds based on performance"""
        try:
            # If success rate is low, adjust thresholds
            if performance_data.get("success_rate", 0) < 0.8:
                # Be more conservative with termination
                self.thresholds["max_turns"] = min(self.thresholds["max_turns"] + 1, 12)
                self.thresholds["persistence_score"] = min(
                    self.thresholds["persistence_score"] + 0.05, 0.95
                )
                
                logger.info(
                    "Adjusted termination thresholds",
                    new_thresholds=self.thresholds
                )
            
            # If termination rate is too high, be less aggressive
            elif performance_data.get("termination_rate", 0) > 0.7:
                self.thresholds["max_turns"] = max(self.thresholds["max_turns"] - 1, 6)
                self.thresholds["frustration_level"] = max(
                    self.thresholds["frustration_level"] - 0.05, 0.75
                )
                
                logger.info(
                    "Relaxed termination thresholds",
                    new_thresholds=self.thresholds
                )
                
        except Exception as e:
            logger.error("Failed to adapt thresholds", error=str(e))


# Global termination manager instance
termination_manager = CallTerminationManager()