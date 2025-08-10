"""
Conversation Learning System
Real-time learning and optimization from conversation outcomes
"""

import asyncio
import json
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from collections import defaultdict
import numpy as np
import structlog

from ..core.config import settings
from ..core.cache import conversation_cache
from ..models.conversation import (
    ConversationContext, IntentCategory, EmotionalState,
    ConversationStage, DialogueState
)

logger = structlog.get_logger(__name__)


@dataclass
class ConversationPattern:
    """Pattern identified in conversations"""
    pattern_type: str  # 'successful', 'failed', 'escalation', 'de-escalation'
    intent_sequence: List[IntentCategory]
    emotional_progression: List[EmotionalState]
    stage_transitions: List[ConversationStage]
    turn_count: int
    outcome: str
    effectiveness_score: float
    frequency: int = 1


@dataclass
class StrategyPerformance:
    """Performance metrics for a response strategy"""
    strategy_name: str
    usage_count: int
    success_count: int
    avg_turn_reduction: float
    avg_effectiveness: float
    emotional_impact: Dict[str, float]  # emotion -> frequency
    best_contexts: List[str]  # Contexts where strategy works best
    worst_contexts: List[str]  # Contexts where strategy fails


@dataclass
class LearningInsight:
    """Insight derived from conversation analysis"""
    insight_type: str
    description: str
    confidence: float
    affected_intents: List[IntentCategory]
    recommended_action: str
    expected_improvement: float


class PatternRecognizer:
    """Recognize patterns in conversation data"""
    
    def __init__(self):
        self.patterns = defaultdict(list)
        self.pattern_threshold = 3  # Minimum occurrences to be a pattern
    
    async def extract_patterns(
        self,
        call_records: List[Dict[str, Any]]
    ) -> List[ConversationPattern]:
        """Extract conversation patterns from call records"""
        patterns = []
        
        for record in call_records:
            pattern = await self._analyze_single_conversation(record)
            if pattern:
                # Check if similar pattern exists
                similar_pattern = self._find_similar_pattern(pattern, patterns)
                if similar_pattern:
                    similar_pattern.frequency += 1
                else:
                    patterns.append(pattern)
        
        # Filter patterns by frequency threshold
        significant_patterns = [
            p for p in patterns 
            if p.frequency >= self.pattern_threshold
        ]
        
        return significant_patterns
    
    async def _analyze_single_conversation(
        self,
        record: Dict[str, Any]
    ) -> Optional[ConversationPattern]:
        """Analyze a single conversation for patterns"""
        try:
            # Determine pattern type
            pattern_type = self._determine_pattern_type(record)
            
            # Extract sequences
            intent_sequence = record.get("intent_history", [])
            emotional_progression = record.get("emotional_trajectory", [])
            stage_transitions = record.get("stage_history", [])
            
            # Calculate effectiveness
            effectiveness = await self._calculate_effectiveness(record)
            
            return ConversationPattern(
                pattern_type=pattern_type,
                intent_sequence=intent_sequence,
                emotional_progression=emotional_progression,
                stage_transitions=stage_transitions,
                turn_count=record.get("turn_count", 0),
                outcome=record.get("outcome", "unknown"),
                effectiveness_score=effectiveness
            )
            
        except Exception as e:
            logger.warning("Failed to analyze conversation", error=str(e))
            return None
    
    def _determine_pattern_type(self, record: Dict[str, Any]) -> str:
        """Determine the type of conversation pattern"""
        outcome = record.get("outcome", "unknown")
        turn_count = record.get("turn_count", 0)
        
        if outcome == "successful_termination" and turn_count <= 5:
            return "successful"
        elif outcome == "failed" or turn_count > 10:
            return "failed"
        elif self._is_escalation(record.get("emotional_trajectory", [])):
            return "escalation"
        elif self._is_de_escalation(record.get("emotional_trajectory", [])):
            return "de-escalation"
        else:
            return "neutral"
    
    def _is_escalation(self, emotional_trajectory: List[EmotionalState]) -> bool:
        """Check if emotional trajectory shows escalation"""
        if len(emotional_trajectory) < 3:
            return False
        
        emotion_values = {
            EmotionalState.FRIENDLY: 1,
            EmotionalState.NEUTRAL: 2,
            EmotionalState.POLITE: 2,
            EmotionalState.PATIENT: 3,
            EmotionalState.FIRM: 4,
            EmotionalState.ANNOYED: 5,
            EmotionalState.FRUSTRATED: 6,
            EmotionalState.AGGRESSIVE: 7
        }
        
        values = [emotion_values.get(e, 2) for e in emotional_trajectory]
        # Check if trend is increasing
        return values[-1] > values[0] and values[-1] >= 5
    
    def _is_de_escalation(self, emotional_trajectory: List[EmotionalState]) -> bool:
        """Check if emotional trajectory shows de-escalation"""
        if len(emotional_trajectory) < 3:
            return False
        
        emotion_values = {
            EmotionalState.AGGRESSIVE: 7,
            EmotionalState.FRUSTRATED: 6,
            EmotionalState.ANNOYED: 5,
            EmotionalState.FIRM: 4,
            EmotionalState.PATIENT: 3,
            EmotionalState.NEUTRAL: 2,
            EmotionalState.POLITE: 2,
            EmotionalState.FRIENDLY: 1
        }
        
        values = [emotion_values.get(e, 2) for e in emotional_trajectory]
        # Check if trend is decreasing
        return values[-1] < values[0] and values[-1] <= 3
    
    async def _calculate_effectiveness(self, record: Dict[str, Any]) -> float:
        """Calculate conversation effectiveness score"""
        effectiveness = 0.0
        
        # Factor 1: Quick resolution (40% weight)
        turn_count = record.get("turn_count", 10)
        turn_score = max(0, 1 - (turn_count / 10))
        effectiveness += turn_score * 0.4
        
        # Factor 2: Successful outcome (40% weight)
        outcome = record.get("outcome", "unknown")
        if outcome in ["successful_termination", "caller_accepted"]:
            effectiveness += 0.4
        elif outcome == "caller_hung_up":
            effectiveness += 0.2
        
        # Factor 3: Emotional control (20% weight)
        if not self._is_escalation(record.get("emotional_trajectory", [])):
            effectiveness += 0.2
        
        return min(effectiveness, 1.0)
    
    def _find_similar_pattern(
        self,
        pattern: ConversationPattern,
        existing_patterns: List[ConversationPattern]
    ) -> Optional[ConversationPattern]:
        """Find similar pattern in existing patterns"""
        for existing in existing_patterns:
            if (existing.pattern_type == pattern.pattern_type and
                existing.intent_sequence == pattern.intent_sequence and
                abs(existing.turn_count - pattern.turn_count) <= 2):
                return existing
        return None


class StrategyOptimizer:
    """Optimize response strategies based on performance"""
    
    def __init__(self):
        self.strategy_performance = {}
        self.optimization_history = []
    
    async def analyze_strategy_performance(
        self,
        conversation_data: List[Dict[str, Any]]
    ) -> Dict[str, StrategyPerformance]:
        """Analyze performance of different response strategies"""
        strategy_stats = defaultdict(lambda: {
            "usage_count": 0,
            "success_count": 0,
            "total_turns": 0,
            "total_effectiveness": 0,
            "emotional_impacts": defaultdict(int),
            "contexts": {"best": [], "worst": []}
        })
        
        for conv in conversation_data:
            strategies_used = conv.get("strategies_used", [])
            outcome = conv.get("outcome", "unknown")
            effectiveness = conv.get("effectiveness_score", 0.5)
            
            for strategy in strategies_used:
                stats = strategy_stats[strategy]
                stats["usage_count"] += 1
                
                if outcome in ["successful_termination", "caller_accepted"]:
                    stats["success_count"] += 1
                
                stats["total_turns"] += conv.get("turn_count", 0)
                stats["total_effectiveness"] += effectiveness
                
                # Track emotional impact
                final_emotion = conv.get("final_emotion", "neutral")
                stats["emotional_impacts"][final_emotion] += 1
                
                # Track context performance
                if effectiveness > 0.7:
                    stats["contexts"]["best"].append(conv.get("context_summary", ""))
                elif effectiveness < 0.3:
                    stats["contexts"]["worst"].append(conv.get("context_summary", ""))
        
        # Convert to StrategyPerformance objects
        performance_results = {}
        for strategy, stats in strategy_stats.items():
            if stats["usage_count"] > 0:
                performance_results[strategy] = StrategyPerformance(
                    strategy_name=strategy,
                    usage_count=stats["usage_count"],
                    success_count=stats["success_count"],
                    avg_turn_reduction=stats["total_turns"] / stats["usage_count"],
                    avg_effectiveness=stats["total_effectiveness"] / stats["usage_count"],
                    emotional_impact=dict(stats["emotional_impacts"]),
                    best_contexts=stats["contexts"]["best"][:5],  # Top 5
                    worst_contexts=stats["contexts"]["worst"][:5]  # Bottom 5
                )
        
        self.strategy_performance = performance_results
        return performance_results
    
    async def optimize_strategies(
        self,
        patterns: List[ConversationPattern],
        performance: Dict[str, StrategyPerformance]
    ) -> List[Dict[str, Any]]:
        """Generate strategy optimizations based on patterns and performance"""
        optimizations = []
        
        # Identify underperforming strategies
        for strategy_name, perf in performance.items():
            success_rate = perf.success_count / max(perf.usage_count, 1)
            
            if success_rate < 0.5:  # Less than 50% success
                optimization = {
                    "strategy": strategy_name,
                    "action": "replace_or_modify",
                    "reason": f"Low success rate: {success_rate:.2%}",
                    "recommendation": self._get_replacement_strategy(strategy_name, patterns),
                    "expected_improvement": 0.2
                }
                optimizations.append(optimization)
            
            elif perf.avg_turn_reduction > 8:  # Takes too many turns
                optimization = {
                    "strategy": strategy_name,
                    "action": "enhance_firmness",
                    "reason": f"High turn count: {perf.avg_turn_reduction:.1f}",
                    "recommendation": "Increase directness and firmness",
                    "expected_improvement": 0.15
                }
                optimizations.append(optimization)
        
        # Identify successful patterns to replicate
        successful_patterns = [p for p in patterns if p.pattern_type == "successful"]
        for pattern in successful_patterns[:3]:  # Top 3 successful patterns
            optimization = {
                "strategy": "new_pattern_based",
                "action": "implement",
                "reason": f"Successful pattern with {pattern.effectiveness_score:.2f} effectiveness",
                "recommendation": self._pattern_to_strategy(pattern),
                "expected_improvement": pattern.effectiveness_score - 0.5
            }
            optimizations.append(optimization)
        
        self.optimization_history.extend(optimizations)
        return optimizations
    
    def _get_replacement_strategy(
        self,
        failing_strategy: str,
        patterns: List[ConversationPattern]
    ) -> str:
        """Get replacement for failing strategy"""
        # Find successful patterns with similar context
        replacements = {
            "gentle_decline": "firm_decline",
            "explain_not_interested": "clear_refusal",
            "deflect_with_humor": "professional_response"
        }
        
        return replacements.get(failing_strategy, "firm_decline")
    
    def _pattern_to_strategy(self, pattern: ConversationPattern) -> str:
        """Convert successful pattern to strategy recommendation"""
        if pattern.turn_count <= 3:
            return "Use direct, clear refusal early"
        elif pattern.emotional_progression[-1] == EmotionalState.FRIENDLY:
            return "Maintain friendly tone throughout"
        elif pattern.stage_transitions[-1] == ConversationStage.CALL_END:
            return "Progress quickly to call termination"
        else:
            return "Adapt strategy based on caller response"


class ConversationLearningSystem:
    """
    Main learning system that coordinates pattern recognition,
    strategy optimization, and continuous improvement
    """
    
    def __init__(self):
        self.pattern_recognizer = PatternRecognizer()
        self.strategy_optimizer = StrategyOptimizer()
        self.effectiveness_tracker = ResponseEffectivenessTracker()
        
        # Learning metrics
        self.total_conversations_analyzed = 0
        self.insights_generated = 0
        self.improvements_applied = 0
        
        # Learning cache
        self.learning_cache = {}
    
    async def learn_from_conversation(self, call_record: Dict[str, Any]) -> None:
        """Learn from a single conversation"""
        try:
            # Analyze conversation effectiveness
            effectiveness = await self.effectiveness_tracker.analyze(call_record)
            
            # Extract patterns
            patterns = await self.pattern_recognizer.extract_patterns([call_record])
            
            # Update strategy performance
            await self._update_strategy_performance(call_record, effectiveness)
            
            # Generate insights if enough data
            if self.total_conversations_analyzed % 10 == 0:
                insights = await self._generate_insights()
                await self._apply_insights(insights)
            
            self.total_conversations_analyzed += 1
            
            logger.info(
                "Learned from conversation",
                call_id=call_record.get("call_id"),
                effectiveness=effectiveness["score"],
                patterns_found=len(patterns)
            )
            
        except Exception as e:
            logger.error("Learning failed", error=str(e))
    
    async def batch_learning(
        self,
        call_records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Perform batch learning from multiple conversations"""
        logger.info(f"Starting batch learning on {len(call_records)} conversations")
        
        # Extract patterns
        patterns = await self.pattern_recognizer.extract_patterns(call_records)
        
        # Analyze strategy performance
        performance = await self.strategy_optimizer.analyze_strategy_performance(call_records)
        
        # Generate optimizations
        optimizations = await self.strategy_optimizer.optimize_strategies(patterns, performance)
        
        # Generate insights
        insights = await self._generate_comprehensive_insights(patterns, performance)
        
        # Update learning metrics
        self.total_conversations_analyzed += len(call_records)
        self.insights_generated += len(insights)
        
        return {
            "patterns_identified": len(patterns),
            "top_patterns": patterns[:5],
            "strategy_performance": performance,
            "optimizations": optimizations,
            "insights": insights,
            "learning_metrics": await self.get_learning_metrics()
        }
    
    async def _update_strategy_performance(
        self,
        call_record: Dict[str, Any],
        effectiveness: Dict[str, Any]
    ) -> None:
        """Update strategy performance based on single conversation"""
        strategies_used = call_record.get("strategies_used", [])
        
        for strategy in strategies_used:
            cache_key = f"strategy_perf:{strategy}"
            
            # Get current performance
            current_perf = self.learning_cache.get(cache_key, {
                "usage_count": 0,
                "total_effectiveness": 0
            })
            
            # Update performance
            current_perf["usage_count"] += 1
            current_perf["total_effectiveness"] += effectiveness["score"]
            
            # Store updated performance
            self.learning_cache[cache_key] = current_perf
    
    async def _generate_insights(self) -> List[LearningInsight]:
        """Generate insights from accumulated learning data"""
        insights = []
        
        # Analyze strategy performance trends
        for strategy_key, perf in self.learning_cache.items():
            if strategy_key.startswith("strategy_perf:"):
                strategy_name = strategy_key.replace("strategy_perf:", "")
                avg_effectiveness = perf["total_effectiveness"] / max(perf["usage_count"], 1)
                
                if avg_effectiveness < 0.4:
                    insight = LearningInsight(
                        insight_type="strategy_underperformance",
                        description=f"Strategy '{strategy_name}' is underperforming",
                        confidence=0.8,
                        affected_intents=[],
                        recommended_action=f"Consider replacing or modifying {strategy_name}",
                        expected_improvement=0.2
                    )
                    insights.append(insight)
        
        self.insights_generated += len(insights)
        return insights
    
    async def _generate_comprehensive_insights(
        self,
        patterns: List[ConversationPattern],
        performance: Dict[str, StrategyPerformance]
    ) -> List[LearningInsight]:
        """Generate comprehensive insights from patterns and performance"""
        insights = []
        
        # Insight 1: Most effective patterns
        successful_patterns = sorted(
            [p for p in patterns if p.pattern_type == "successful"],
            key=lambda x: x.effectiveness_score,
            reverse=True
        )
        
        if successful_patterns:
            top_pattern = successful_patterns[0]
            insight = LearningInsight(
                insight_type="effective_pattern",
                description=f"Pattern with {top_pattern.turn_count} turns achieves {top_pattern.effectiveness_score:.2f} effectiveness",
                confidence=0.9,
                affected_intents=list(set(top_pattern.intent_sequence)),
                recommended_action="Replicate this pattern in similar contexts",
                expected_improvement=top_pattern.effectiveness_score - 0.5
            )
            insights.append(insight)
        
        # Insight 2: Problematic escalation patterns
        escalation_patterns = [p for p in patterns if p.pattern_type == "escalation"]
        if len(escalation_patterns) > 2:
            insight = LearningInsight(
                insight_type="escalation_risk",
                description=f"Found {len(escalation_patterns)} escalation patterns",
                confidence=0.85,
                affected_intents=[],
                recommended_action="Implement de-escalation strategies earlier",
                expected_improvement=0.25
            )
            insights.append(insight)
        
        # Insight 3: Strategy effectiveness
        for strategy_name, perf in performance.items():
            if perf.usage_count > 10:
                success_rate = perf.success_count / perf.usage_count
                if success_rate > 0.8:
                    insight = LearningInsight(
                        insight_type="high_performing_strategy",
                        description=f"Strategy '{strategy_name}' has {success_rate:.1%} success rate",
                        confidence=0.95,
                        affected_intents=[],
                        recommended_action=f"Increase usage of {strategy_name} in appropriate contexts",
                        expected_improvement=0.1
                    )
                    insights.append(insight)
        
        return insights
    
    async def _apply_insights(self, insights: List[LearningInsight]) -> None:
        """Apply insights to improve system behavior"""
        for insight in insights:
            try:
                if insight.confidence > 0.7:  # Only apply high-confidence insights
                    # Log the insight application
                    logger.info(
                        "Applying insight",
                        type=insight.insight_type,
                        action=insight.recommended_action,
                        expected_improvement=insight.expected_improvement
                    )
                    
                    # Store insight for future reference
                    cache_key = f"applied_insight:{insight.insight_type}:{datetime.utcnow().isoformat()}"
                    await conversation_cache.set(
                        cache_key,
                        json.dumps(asdict(insight)),
                        ttl=86400  # 24 hours
                    )
                    
                    self.improvements_applied += 1
                    
            except Exception as e:
                logger.error(f"Failed to apply insight: {e}")
    
    async def get_learning_metrics(self) -> Dict[str, Any]:
        """Get learning system metrics"""
        # Calculate improvement rate
        improvement_rate = 0.0
        if self.insights_generated > 0:
            improvement_rate = self.improvements_applied / self.insights_generated
        
        return {
            "total_conversations_analyzed": self.total_conversations_analyzed,
            "insights_generated": self.insights_generated,
            "improvements_applied": self.improvements_applied,
            "improvement_rate": improvement_rate,
            "cached_patterns": len(self.learning_cache),
            "optimization_history": len(self.strategy_optimizer.optimization_history)
        }
    
    async def export_learning_model(self) -> Dict[str, Any]:
        """Export learned model for backup or transfer"""
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "metrics": await self.get_learning_metrics(),
            "strategy_performance": self.strategy_optimizer.strategy_performance,
            "optimization_history": self.strategy_optimizer.optimization_history,
            "learning_cache": self.learning_cache
        }
    
    async def import_learning_model(self, model_data: Dict[str, Any]) -> None:
        """Import previously learned model"""
        try:
            self.strategy_optimizer.strategy_performance = model_data.get("strategy_performance", {})
            self.strategy_optimizer.optimization_history = model_data.get("optimization_history", [])
            self.learning_cache = model_data.get("learning_cache", {})
            
            metrics = model_data.get("metrics", {})
            self.total_conversations_analyzed = metrics.get("total_conversations_analyzed", 0)
            self.insights_generated = metrics.get("insights_generated", 0)
            self.improvements_applied = metrics.get("improvements_applied", 0)
            
            logger.info("Learning model imported successfully")
            
        except Exception as e:
            logger.error(f"Failed to import learning model: {e}")


class ResponseEffectivenessTracker:
    """Track and analyze response effectiveness"""
    
    async def analyze(self, call_record: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze conversation effectiveness"""
        metrics = {
            "call_duration": call_record.get("duration_seconds", 0),
            "turn_count": call_record.get("turn_count", 0),
            "termination_reason": call_record.get("termination_reason", "unknown"),
            "caller_persistence": self._measure_persistence(call_record),
            "response_coherence": await self._measure_coherence(call_record)
        }
        
        # Calculate overall effectiveness score
        effectiveness_score = self._calculate_effectiveness_score(metrics)
        
        return {
            "score": effectiveness_score,
            "metrics": metrics,
            "successful": effectiveness_score > 0.7
        }
    
    def _measure_persistence(self, call_record: Dict[str, Any]) -> float:
        """Measure caller persistence level"""
        turn_count = call_record.get("turn_count", 0)
        repeated_intents = call_record.get("repeated_intents", 0)
        
        persistence = min((turn_count / 10) + (repeated_intents / 5), 1.0)
        return persistence
    
    async def _measure_coherence(self, call_record: Dict[str, Any]) -> float:
        """Measure response coherence"""
        # Simplified coherence measure
        # In production, would use NLP to analyze actual coherence
        responses = call_record.get("ai_responses", [])
        if not responses:
            return 0.5
        
        # Check for consistency in responses
        coherence = 0.8  # Base coherence
        
        # Penalize contradictions or repetitions
        if len(set(responses)) < len(responses) * 0.7:  # Too many repetitions
            coherence -= 0.2
        
        return max(coherence, 0.0)
    
    def _calculate_effectiveness_score(self, metrics: Dict[str, Any]) -> float:
        """Calculate overall effectiveness score"""
        # Short duration is good
        duration_score = max(0, 1 - metrics["call_duration"] / 180)
        
        # Few turns is good
        turn_score = max(0, 1 - metrics["turn_count"] / 10)
        
        # Natural termination is good
        termination_score = 1.0 if metrics["termination_reason"] == "caller_hangup" else 0.5
        
        # High coherence is good
        coherence_score = metrics["response_coherence"]
        
        # Weighted average
        effectiveness = (
            duration_score * 0.3 +
            turn_score * 0.3 +
            termination_score * 0.2 +
            coherence_score * 0.2
        )
        
        return min(effectiveness, 1.0)


# Global learning system instance
conversation_learning_system = ConversationLearningSystem()