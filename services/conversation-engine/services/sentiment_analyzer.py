import asyncio
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
import json
import re
from azure.ai.textanalytics.aio import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential
import structlog

from ..core.config import settings
from ..core.cache import conversation_cache
from ..models.conversation import EmotionalState, ConversationMessage

logger = structlog.get_logger(__name__)


class EmotionalIntelligenceService:
    """Service for emotional intelligence and sentiment analysis."""
    
    def __init__(self):
        self.text_analytics_client = TextAnalyticsClient(
            endpoint=settings.azure_text_analytics_endpoint,
            credential=AzureKeyCredential(settings.azure_text_analytics_key)
        )
        
        # Emotional state mapping from Azure sentiment
        self.sentiment_to_emotion = {
            "positive": EmotionalState.FRIENDLY,
            "neutral": EmotionalState.NEUTRAL,
            "negative": EmotionalState.ANNOYED,
            "mixed": EmotionalState.NEUTRAL
        }
        
        # Chinese emotional keywords and patterns
        self.emotion_patterns = {
            EmotionalState.FRUSTRATED: [
                "为什么", "怎么这样", "太过分", "真是的", "不能接受",
                "太讨厌", "真烦人", "不耐烦", "没必要", "很生气"
            ],
            EmotionalState.ANNOYED: [
                "不耐烦", "烦人", "算了", "不用了", "老是",
                "总是", "又来", "不想听", "烦死了", "让人烦"
            ],
            EmotionalState.PATIENT: [
                "我理解", "没关系", "可以理解", "没问题", "好的",
                "不急", "慢慢说", "没事", "等一下", "慢慢来"
            ],
            EmotionalState.POLITE: [
                "谢谢", "抱歉", "麻烦", "请问", "您好",
                "不好意思", "劳烦", "辛苦", "感谢", "对不起"
            ],
            EmotionalState.FIRM: [
                "不可能", "绝对不", "明确拒绝", "坂决不", "一定不",
                "没商量", "不用谈", "无法接受", "不可行", "不同意"
            ],
            EmotionalState.FRIENDLY: [
                "哈哈", "好的呀", "不错呀", "挺好", "可以的",
                "没问题呀", "好啊", "行啊", "当然", "欢迎"
            ],
            EmotionalState.DISMISSIVE: [
                "算了吧", "随便吧", "无所谓", "在乎吗", "无论如何",
                "没兴趣", "不在乎", "無所謂", "随个便", "不管了"
            ]
        }
        
        # Persistence and frustration indicators
        self.persistence_indicators = [
            "再考虑", "再想想", "不要急", "给个机会", "等一下",
            "听我说", "先听听", "不用急着决定", "了解一下", "介绍一下"
        ]
        
        self.frustration_indicators = [
            "为什么不", "为什么还", "怎么还", "怎么不", "你们怎么",
            "不是说了", "已经说了", "不是已经", "明明说了", "不是告诉"
        ]
        
        # Performance metrics
        self.total_analyses = 0
        self.accuracy_estimates = []
    
    async def analyze_emotional_state(
        self,
        text: str,
        conversation_history: Optional[List[ConversationMessage]] = None,
        call_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Analyze emotional state from text with conversation context."""
        start_time = datetime.utcnow()
        
        try:
            # Perform multiple analysis methods
            azure_sentiment = await self._analyze_azure_sentiment(text)
            pattern_emotion = self._analyze_emotion_patterns(text)
            context_emotion = self._analyze_conversation_context(conversation_history)
            progression_analysis = self._analyze_emotional_progression(conversation_history)
            
            # Fusion of different analysis methods
            final_emotion = self._fuse_emotional_analysis(
                azure_sentiment,
                pattern_emotion,
                context_emotion,
                progression_analysis
            )
            
            # Calculate confidence and additional metrics
            confidence = self._calculate_confidence(
                azure_sentiment, pattern_emotion, context_emotion
            )
            
            # Analyze caller persistence and frustration
            persistence_score = self._analyze_persistence(text, conversation_history)
            frustration_level = self._analyze_frustration(text, conversation_history)
            
            processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            result = {
                "emotional_state": final_emotion,
                "confidence": confidence,
                "persistence_score": persistence_score,
                "frustration_level": frustration_level,
                "emotional_intensity": self._calculate_intensity(text),
                "emotional_stability": self._calculate_stability(conversation_history),
                "processing_time_ms": processing_time,
                
                # Detailed analysis
                "azure_sentiment": azure_sentiment,
                "pattern_matches": pattern_emotion["matches"],
                "context_factors": context_emotion["factors"],
                "progression_trend": progression_analysis["trend"],
                
                # Recommendations
                "response_recommendations": self._get_response_recommendations(
                    final_emotion, persistence_score, frustration_level
                )
            }
            
            # Cache result for performance
            if call_id:
                await self._cache_analysis_result(call_id, text, result)
            
            self.total_analyses += 1
            
            logger.info(
                "Emotional analysis completed",
                call_id=call_id,
                emotion=final_emotion.value,
                confidence=confidence,
                processing_time_ms=processing_time
            )
            
            return result
            
        except Exception as e:
            logger.error(
                "Emotional analysis failed",
                call_id=call_id,
                error=str(e)
            )
            # Return neutral fallback
            return {
                "emotional_state": EmotionalState.NEUTRAL,
                "confidence": 0.3,
                "persistence_score": 0.5,
                "frustration_level": 0.0,
                "emotional_intensity": 0.5,
                "emotional_stability": 0.5,
                "processing_time_ms": 5.0,
                "error": str(e)
            }
    
    async def _analyze_azure_sentiment(self, text: str) -> Dict[str, Any]:
        """Analyze sentiment using Azure Text Analytics."""
        try:
            documents = [text]
            response = await self.text_analytics_client.analyze_sentiment(
                documents=documents,
                show_opinion_mining=True,
                language="zh-Hans"
            )
            
            doc_result = response[0]
            
            if doc_result.is_error:
                logger.warning(
                    "Azure sentiment analysis error",
                    error=doc_result.error
                )
                return {"sentiment": "neutral", "confidence": 0.5, "scores": {}}
            
            sentiment_scores = {
                "positive": doc_result.confidence_scores.positive,
                "neutral": doc_result.confidence_scores.neutral,
                "negative": doc_result.confidence_scores.negative
            }
            
            return {
                "sentiment": doc_result.sentiment,
                "confidence": max(sentiment_scores.values()),
                "scores": sentiment_scores,
                "sentences": [
                    {
                        "text": sentence.text,
                        "sentiment": sentence.sentiment,
                        "confidence": max(
                            sentence.confidence_scores.positive,
                            sentence.confidence_scores.neutral,
                            sentence.confidence_scores.negative
                        )
                    }
                    for sentence in doc_result.sentences
                ]
            }
            
        except Exception as e:
            logger.warning(
                "Azure sentiment analysis failed",
                error=str(e)
            )
            return {"sentiment": "neutral", "confidence": 0.3, "scores": {}}
    
    def _analyze_emotion_patterns(self, text: str) -> Dict[str, Any]:
        """Analyze emotional patterns using keyword matching."""
        text_lower = text.lower()
        emotion_scores = {}
        matches = {}
        
        for emotion, patterns in self.emotion_patterns.items():
            score = 0
            emotion_matches = []
            
            for pattern in patterns:
                if pattern in text_lower:
                    score += 1
                    emotion_matches.append(pattern)
            
            # Normalize score by pattern count
            emotion_scores[emotion] = score / len(patterns)
            matches[emotion] = emotion_matches
        
        # Find dominant emotion
        if emotion_scores:
            dominant_emotion = max(emotion_scores.keys(), key=lambda k: emotion_scores[k])
            confidence = emotion_scores[dominant_emotion]
        else:
            dominant_emotion = EmotionalState.NEUTRAL
            confidence = 0.5
        
        return {
            "emotion": dominant_emotion,
            "confidence": confidence,
            "scores": emotion_scores,
            "matches": matches
        }
    
    def _analyze_conversation_context(
        self,
        conversation_history: Optional[List[ConversationMessage]] = None
    ) -> Dict[str, Any]:
        """Analyze emotional context from conversation history."""
        if not conversation_history or len(conversation_history) < 2:
            return {
                "emotion": EmotionalState.NEUTRAL,
                "confidence": 0.5,
                "factors": ["insufficient_history"]
            }
        
        factors = []
        context_emotion = EmotionalState.NEUTRAL
        
        # Analyze conversation length
        if len(conversation_history) > 8:
            factors.append("long_conversation")
            context_emotion = EmotionalState.FRUSTRATED
        elif len(conversation_history) > 5:
            factors.append("extended_conversation")
            context_emotion = EmotionalState.ANNOYED
        elif len(conversation_history) > 2:
            factors.append("normal_conversation")
            context_emotion = EmotionalState.PATIENT
        
        # Analyze repetition patterns
        user_messages = [msg.text for msg in conversation_history if msg.speaker == "user"]
        if len(user_messages) >= 2:
            if self._detect_repetition(user_messages):
                factors.append("repetitive_caller")
                if context_emotion == EmotionalState.PATIENT:
                    context_emotion = EmotionalState.ANNOYED
        
        # Analyze escalation patterns
        if self._detect_escalation(conversation_history):
            factors.append("escalating_tension")
            context_emotion = EmotionalState.FRUSTRATED
        
        confidence = 0.7 if len(factors) > 1 else 0.5
        
        return {
            "emotion": context_emotion,
            "confidence": confidence,
            "factors": factors
        }
    
    def _analyze_emotional_progression(
        self,
        conversation_history: Optional[List[ConversationMessage]] = None
    ) -> Dict[str, Any]:
        """Analyze emotional progression throughout conversation."""
        if not conversation_history or len(conversation_history) < 3:
            return {
                "trend": "stable",
                "progression": [],
                "volatility": 0.0
            }
        
        # Analyze emotional progression from previous messages
        emotional_progression = []
        for msg in conversation_history:
            if msg.emotion:
                emotional_progression.append(msg.emotion)
        
        if len(emotional_progression) < 2:
            return {
                "trend": "stable",
                "progression": emotional_progression,
                "volatility": 0.0
            }
        
        # Determine trend
        trend = self._calculate_emotional_trend(emotional_progression)
        volatility = self._calculate_emotional_volatility(emotional_progression)
        
        return {
            "trend": trend,
            "progression": [emotion.value for emotion in emotional_progression],
            "volatility": volatility
        }
    
    def _fuse_emotional_analysis(
        self,
        azure_sentiment: Dict[str, Any],
        pattern_emotion: Dict[str, Any],
        context_emotion: Dict[str, Any],
        progression_analysis: Dict[str, Any]
    ) -> EmotionalState:
        """Fuse different emotional analysis methods."""
        
        # Weight different analysis methods
        weights = {
            "azure": 0.3,
            "pattern": 0.4,
            "context": 0.2,
            "progression": 0.1
        }
        
        # Convert Azure sentiment to emotion
        azure_emotion = self.sentiment_to_emotion.get(
            azure_sentiment.get("sentiment", "neutral"),
            EmotionalState.NEUTRAL
        )
        
        # Collect all emotions with weights
        weighted_emotions = {
            azure_emotion: weights["azure"] * azure_sentiment.get("confidence", 0.5),
            pattern_emotion["emotion"]: weights["pattern"] * pattern_emotion["confidence"],
            context_emotion["emotion"]: weights["context"] * context_emotion["confidence"]
        }
        
        # Apply progression influence
        if progression_analysis["trend"] == "escalating":
            # Increase negative emotions
            for emotion in [EmotionalState.ANNOYED, EmotionalState.FRUSTRATED]:
                if emotion in weighted_emotions:
                    weighted_emotions[emotion] *= 1.3
        elif progression_analysis["trend"] == "de-escalating":
            # Increase positive emotions
            for emotion in [EmotionalState.PATIENT, EmotionalState.FRIENDLY]:
                if emotion in weighted_emotions:
                    weighted_emotions[emotion] *= 1.2
        
        # Find emotion with highest weighted score
        if weighted_emotions:
            final_emotion = max(weighted_emotions.keys(), key=lambda k: weighted_emotions[k])
        else:
            final_emotion = EmotionalState.NEUTRAL
        
        return final_emotion
    
    def _calculate_confidence(
        self,
        azure_sentiment: Dict[str, Any],
        pattern_emotion: Dict[str, Any],
        context_emotion: Dict[str, Any]
    ) -> float:
        """Calculate overall confidence in emotional analysis."""
        
        confidences = [
            azure_sentiment.get("confidence", 0.5),
            pattern_emotion["confidence"],
            context_emotion["confidence"]
        ]
        
        # Calculate weighted average
        weights = [0.3, 0.4, 0.3]
        weighted_confidence = sum(c * w for c, w in zip(confidences, weights))
        
        # Boost confidence if multiple methods agree
        azure_emotion = self.sentiment_to_emotion.get(
            azure_sentiment.get("sentiment", "neutral"),
            EmotionalState.NEUTRAL
        )
        
        agreement_count = 0
        if azure_emotion == pattern_emotion["emotion"]:
            agreement_count += 1
        if azure_emotion == context_emotion["emotion"]:
            agreement_count += 1
        if pattern_emotion["emotion"] == context_emotion["emotion"]:
            agreement_count += 1
        
        # Boost confidence based on agreement
        confidence_boost = agreement_count * 0.1
        final_confidence = min(weighted_confidence + confidence_boost, 1.0)
        
        return round(final_confidence, 2)
    
    def _analyze_persistence(self, text: str, history: Optional[List[ConversationMessage]] = None) -> float:
        """Analyze caller persistence level."""
        persistence_score = 0.0
        
        # Check for persistence keywords in current text
        for indicator in self.persistence_indicators:
            if indicator in text.lower():
                persistence_score += 0.2
        
        # Analyze conversation history for persistence patterns
        if history and len(history) > 2:
            # Long conversations indicate persistence
            length_factor = min(len(history) / 10.0, 0.5)
            persistence_score += length_factor
            
            # Repetitive messages indicate persistence
            user_messages = [msg.text for msg in history if msg.speaker == "user"]
            if self._detect_repetition(user_messages):
                persistence_score += 0.3
        
        return min(persistence_score, 1.0)
    
    def _analyze_frustration(self, text: str, history: Optional[List[ConversationMessage]] = None) -> float:
        """Analyze caller frustration level."""
        frustration_score = 0.0
        
        # Check for frustration indicators in current text
        for indicator in self.frustration_indicators:
            if indicator in text.lower():
                frustration_score += 0.25
        
        # Check for escalating patterns in history
        if history and len(history) > 3:
            if self._detect_escalation(history):
                frustration_score += 0.4
        
        # High turn count indicates potential frustration
        if history:
            turn_factor = min(len(history) / 15.0, 0.3)
            frustration_score += turn_factor
        
        return min(frustration_score, 1.0)
    
    def _calculate_intensity(self, text: str) -> float:
        """Calculate emotional intensity from text features."""
        intensity_factors = {
            "exclamation_marks": text.count("!") * 0.1,
            "question_marks": text.count("?") * 0.05,
            "caps_words": len(re.findall(r'\b[A-Z一-鿿]{2,}\b', text)) * 0.1,
            "repeated_chars": len(re.findall(r'(.)\1{2,}', text)) * 0.15,
            "text_length": min(len(text) / 100.0, 0.2)
        }
        
        total_intensity = sum(intensity_factors.values())
        return min(total_intensity + 0.3, 1.0)  # Base intensity of 0.3
    
    def _calculate_stability(self, history: Optional[List[ConversationMessage]] = None) -> float:
        """Calculate emotional stability from conversation history."""
        if not history or len(history) < 3:
            return 0.5  # Neutral stability
        
        emotions = [msg.emotion for msg in history if msg.emotion]
        if len(emotions) < 2:
            return 0.5
        
        # Calculate emotional changes
        changes = 0
        for i in range(1, len(emotions)):
            if emotions[i] != emotions[i-1]:
                changes += 1
        
        # Higher stability = fewer changes
        stability = max(0.0, 1.0 - (changes / len(emotions)))
        return stability
    
    def _detect_repetition(self, messages: List[str]) -> bool:
        """Detect repetitive patterns in messages."""
        if len(messages) < 2:
            return False
        
        # Check for similar messages
        for i in range(1, len(messages)):
            current = messages[i].lower()
            previous = messages[i-1].lower()
            
            # Simple similarity check (can be enhanced)
            common_words = set(current.split()) & set(previous.split())
            if len(common_words) >= 3:  # At least 3 common words
                return True
        
        return False
    
    def _detect_escalation(self, history: List[ConversationMessage]) -> bool:
        """Detect escalating emotional patterns."""
        if len(history) < 4:
            return False
        
        # Define emotion intensity levels
        emotion_intensity = {
            EmotionalState.FRIENDLY: 1,
            EmotionalState.NEUTRAL: 2,
            EmotionalState.PATIENT: 2,
            EmotionalState.POLITE: 2,
            EmotionalState.ANNOYED: 3,
            EmotionalState.FIRM: 3,
            EmotionalState.FRUSTRATED: 4,
            EmotionalState.DISMISSIVE: 4
        }
        
        user_emotions = [
            emotion_intensity.get(msg.emotion, 2)
            for msg in history[-4:] if msg.speaker == "user" and msg.emotion
        ]
        
        if len(user_emotions) < 2:
            return False
        
        # Check if emotions are generally increasing
        increasing_trend = sum(
            1 for i in range(1, len(user_emotions))
            if user_emotions[i] > user_emotions[i-1]
        )
        
        return increasing_trend >= len(user_emotions) // 2
    
    def _calculate_emotional_trend(self, progression: List[EmotionalState]) -> str:
        """Calculate emotional trend from progression."""
        if len(progression) < 2:
            return "stable"
        
        # Map emotions to intensity scores
        intensity_map = {
            EmotionalState.FRIENDLY: 1,
            EmotionalState.POLITE: 2,
            EmotionalState.NEUTRAL: 3,
            EmotionalState.PATIENT: 3,
            EmotionalState.ANNOYED: 4,
            EmotionalState.FIRM: 4,
            EmotionalState.FRUSTRATED: 5,
            EmotionalState.DISMISSIVE: 5
        }
        
        intensities = [intensity_map.get(emotion, 3) for emotion in progression]
        
        # Calculate trend
        first_half_avg = sum(intensities[:len(intensities)//2]) / (len(intensities)//2)
        second_half_avg = sum(intensities[len(intensities)//2:]) / (len(intensities) - len(intensities)//2)
        
        if second_half_avg > first_half_avg + 0.5:
            return "escalating"
        elif second_half_avg < first_half_avg - 0.5:
            return "de-escalating"
        else:
            return "stable"
    
    def _calculate_emotional_volatility(self, progression: List[EmotionalState]) -> float:
        """Calculate emotional volatility (how much emotions change)."""
        if len(progression) < 2:
            return 0.0
        
        changes = sum(
            1 for i in range(1, len(progression))
            if progression[i] != progression[i-1]
        )
        
        return changes / (len(progression) - 1)
    
    def _get_response_recommendations(
        self,
        emotion: EmotionalState,
        persistence: float,
        frustration: float
    ) -> List[str]:
        """Get response strategy recommendations based on emotional analysis."""
        recommendations = []
        
        # Base recommendations by emotion
        emotion_recommendations = {
            EmotionalState.FRIENDLY: ["maintain_friendly_tone", "be_conversational"],
            EmotionalState.NEUTRAL: ["standard_polite_response", "provide_clear_information"],
            EmotionalState.PATIENT: ["acknowledge_patience", "be_thorough"],
            EmotionalState.POLITE: ["mirror_politeness", "show_appreciation"],
            EmotionalState.ANNOYED: ["be_concise", "acknowledge_feelings", "offer_quick_resolution"],
            EmotionalState.FRUSTRATED: ["de-escalate", "be_empathetic", "consider_termination"],
            EmotionalState.FIRM: ["match_firmness", "be_direct", "set_boundaries"],
            EmotionalState.DISMISSIVE: ["professional_response", "consider_termination"]
        }
        
        recommendations.extend(emotion_recommendations.get(emotion, []))
        
        # Persistence-based recommendations
        if persistence > 0.7:
            recommendations.extend(["firm_boundary_setting", "consider_termination"])
        elif persistence > 0.4:
            recommendations.extend(["clear_rejection", "redirect_conversation"])
        
        # Frustration-based recommendations
        if frustration > 0.6:
            recommendations.extend(["immediate_de-escalation", "prepare_termination"])
        elif frustration > 0.3:
            recommendations.extend(["empathetic_response", "validation"])
        
        return list(set(recommendations))  # Remove duplicates
    
    async def _cache_analysis_result(
        self,
        call_id: str,
        text: str,
        result: Dict[str, Any]
    ) -> None:
        """Cache analysis result for performance optimization."""
        try:
            cache_key = f"emotion_analysis:{call_id}:{hash(text) % 10000}"
            await conversation_cache.cache.set(
                cache_key,
                result,
                ttl=300  # Cache for 5 minutes
            )
        except Exception as e:
            logger.warning(
                "Failed to cache emotional analysis",
                call_id=call_id,
                error=str(e)
            )
    
    async def get_performance_metrics(self) -> Dict[str, Any]:
        """Get service performance metrics."""
        avg_accuracy = sum(self.accuracy_estimates) / len(self.accuracy_estimates) if self.accuracy_estimates else 0.5
        
        return {
            "total_analyses": self.total_analyses,
            "estimated_accuracy": avg_accuracy,
            "service_status": "healthy",
            "supported_emotions": [emotion.value for emotion in EmotionalState],
            "analysis_features": [
                "azure_sentiment",
                "pattern_matching",
                "context_analysis",
                "progression_tracking",
                "persistence_detection",
                "frustration_analysis"
            ]
        }
    
    async def train_emotion_patterns(
        self,
        training_data: List[Tuple[str, EmotionalState, float]]
    ) -> Dict[str, Any]:
        """Train and update emotion patterns based on feedback data."""
        logger.info(
            "Starting emotion pattern training",
            training_samples=len(training_data)
        )
        
        pattern_improvements = {}
        
        for text, true_emotion, confidence in training_data:
            # Analyze current performance
            current_analysis = self._analyze_emotion_patterns(text)
            predicted_emotion = current_analysis["emotion"]
            
            # If prediction was wrong, extract potential new patterns
            if predicted_emotion != true_emotion and confidence > 0.8:
                # Extract keywords from misclassified text
                words = text.lower().split()
                for word in words:
                    if len(word) >= 2:  # Minimum word length
                        if true_emotion not in pattern_improvements:
                            pattern_improvements[true_emotion] = []
                        if word not in pattern_improvements[true_emotion]:
                            pattern_improvements[true_emotion].append(word)
        
        # Update patterns (in a production system, this would be more sophisticated)
        patterns_added = 0
        for emotion, new_patterns in pattern_improvements.items():
            if emotion in self.emotion_patterns:
                # Add top new patterns (limit to prevent overfitting)
                top_patterns = new_patterns[:5]
                self.emotion_patterns[emotion].extend(top_patterns)
                patterns_added += len(top_patterns)
        
        logger.info(
            "Emotion pattern training completed",
            patterns_added=patterns_added,
            emotions_updated=len(pattern_improvements)
        )
        
        return {
            "training_samples": len(training_data),
            "patterns_added": patterns_added,
            "emotions_updated": list(pattern_improvements.keys()),
            "training_success": True
        }


# Global service instance
sentiment_analyzer = EmotionalIntelligenceService()
