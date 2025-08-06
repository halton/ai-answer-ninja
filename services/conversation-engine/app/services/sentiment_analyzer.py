"""
Sentiment analysis and emotion detection service using transformers.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import time

import torch
import numpy as np
from transformers import (
    AutoTokenizer, AutoModelForSequenceClassification,
    pipeline, Pipeline
)
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError

from app.core.config import get_settings
from app.core.cache import get_cache

logger = logging.getLogger(__name__)


class SentimentLabel(str, Enum):
    """Sentiment classification labels."""
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"


class EmotionLabel(str, Enum):
    """Emotion classification labels."""
    JOY = "joy"
    ANGER = "anger"
    FEAR = "fear"
    SADNESS = "sadness"
    DISGUST = "disgust"
    SURPRISE = "surprise"
    NEUTRAL = "neutral"


@dataclass
class SentimentResult:
    """Sentiment analysis result."""
    label: SentimentLabel
    confidence: float
    scores: Dict[str, float]
    processing_time_ms: float
    source: str  # "local", "azure", "cached"


@dataclass
class EmotionResult:
    """Emotion detection result."""
    primary_emotion: EmotionLabel
    confidence: float
    emotion_scores: Dict[str, float]
    processing_time_ms: float
    source: str  # "local", "azure", "cached"


@dataclass
class ConversationAnalysis:
    """Combined analysis of conversation message."""
    text: str
    sentiment: SentimentResult
    emotion: EmotionResult
    intent_signals: Dict[str, float]
    persistence_indicators: List[str]
    termination_signals: List[str]
    emotional_intensity: float
    conversation_stage_prediction: str


class SentimentAnalyzer:
    """Advanced sentiment analysis and emotion detection service."""
    
    def __init__(self):
        self.settings = get_settings()
        self.cache = None
        
        # Local model components
        self.sentiment_pipeline: Optional[Pipeline] = None
        self.emotion_pipeline: Optional[Pipeline] = None
        self.sentiment_tokenizer = None
        self.sentiment_model = None
        self.emotion_tokenizer = None
        self.emotion_model = None
        
        # Azure Text Analytics client
        self.azure_client: Optional[TextAnalyticsClient] = None
        
        # Performance settings
        self.cache_ttl = 3600  # 1 hour
        self.max_batch_size = 10
        self.model_warmup_done = False
        
        # Conversation-specific thresholds
        self.persistence_threshold = 0.7
        self.termination_threshold = 0.8
        self.emotional_intensity_threshold = 0.6
    
    async def initialize(self) -> None:
        """Initialize the sentiment analyzer with models."""
        try:
            self.cache = await get_cache()
            
            # Initialize Azure Text Analytics if configured
            if (self.settings.azure_text_analytics_endpoint and 
                self.settings.azure_text_analytics_key):
                self.azure_client = TextAnalyticsClient(
                    endpoint=self.settings.azure_text_analytics_endpoint,
                    credential=AzureKeyCredential(self.settings.azure_text_analytics_key)
                )
            
            # Load local models in background
            asyncio.create_task(self._load_local_models())
            
            logger.info("Sentiment analyzer initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize sentiment analyzer: {e}")
            raise
    
    async def _load_local_models(self) -> None:
        """Load local transformer models for sentiment and emotion analysis."""
        try:
            # Load sentiment analysis model
            logger.info("Loading sentiment analysis model...")
            self.sentiment_pipeline = pipeline(
                "sentiment-analysis",
                model=self.settings.sentiment_model_name,
                tokenizer=self.settings.sentiment_model_name,
                device=0 if torch.cuda.is_available() else -1,
                return_all_scores=True
            )
            
            # Load emotion detection model
            logger.info("Loading emotion detection model...")
            self.emotion_pipeline = pipeline(
                "text-classification",
                model=self.settings.emotion_model_name,
                tokenizer=self.settings.emotion_model_name,
                device=0 if torch.cuda.is_available() else -1,
                return_all_scores=True
            )
            
            # Warm up models with dummy input
            await self._warmup_models()
            
            self.model_warmup_done = True
            logger.info("Local models loaded and warmed up successfully")
            
        except Exception as e:
            logger.error(f"Error loading local models: {e}")
            # Continue without local models, rely on Azure
    
    async def _warmup_models(self) -> None:
        """Warm up models with dummy input to reduce first-call latency."""
        dummy_texts = [
            "Hello, how are you doing today?",
            "I'm not interested in your offer.",
            "Please remove me from your calling list."
        ]
        
        for text in dummy_texts:
            try:
                if self.sentiment_pipeline:
                    _ = self.sentiment_pipeline(text)
                if self.emotion_pipeline:
                    _ = self.emotion_pipeline(text)
            except Exception as e:
                logger.warning(f"Model warmup failed for text '{text}': {e}")
    
    async def analyze_message(
        self,
        text: str,
        use_cache: bool = True,
        prefer_local: bool = True
    ) -> ConversationAnalysis:
        """
        Perform comprehensive analysis of a conversation message.
        
        Args:
            text: Message text to analyze
            use_cache: Whether to use cached results
            prefer_local: Whether to prefer local models over Azure
            
        Returns:
            ConversationAnalysis with sentiment, emotion, and conversation insights
        """
        start_time = time.time()
        
        try:
            # Check cache first
            if use_cache:
                cached_result = await self._get_cached_analysis(text)
                if cached_result:
                    return cached_result
            
            # Perform sentiment analysis
            sentiment_task = self.analyze_sentiment(text, use_cache=False, prefer_local=prefer_local)
            
            # Perform emotion detection
            emotion_task = self.analyze_emotion(text, use_cache=False, prefer_local=prefer_local)
            
            # Run both analyses concurrently
            sentiment_result, emotion_result = await asyncio.gather(
                sentiment_task, emotion_task, return_exceptions=True
            )
            
            # Handle exceptions
            if isinstance(sentiment_result, Exception):
                logger.error(f"Sentiment analysis failed: {sentiment_result}")
                sentiment_result = self._get_fallback_sentiment()
            
            if isinstance(emotion_result, Exception):
                logger.error(f"Emotion analysis failed: {emotion_result}")
                emotion_result = self._get_fallback_emotion()
            
            # Extract conversation-specific insights
            intent_signals = await self._extract_intent_signals(text, sentiment_result, emotion_result)
            persistence_indicators = self._detect_persistence_indicators(text)
            termination_signals = self._detect_termination_signals(text)
            emotional_intensity = self._calculate_emotional_intensity(emotion_result)
            stage_prediction = self._predict_conversation_stage(text, sentiment_result, emotion_result)
            
            # Create comprehensive analysis
            analysis = ConversationAnalysis(
                text=text,
                sentiment=sentiment_result,
                emotion=emotion_result,
                intent_signals=intent_signals,
                persistence_indicators=persistence_indicators,
                termination_signals=termination_signals,
                emotional_intensity=emotional_intensity,
                conversation_stage_prediction=stage_prediction
            )
            
            # Cache the result
            if use_cache:
                await self._cache_analysis(text, analysis)
            
            processing_time = (time.time() - start_time) * 1000
            logger.debug(f"Message analysis completed in {processing_time:.2f}ms")
            
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing message: {e}")
            return self._get_fallback_analysis(text)
    
    async def analyze_sentiment(
        self,
        text: str,
        use_cache: bool = True,
        prefer_local: bool = True
    ) -> SentimentResult:
        """Analyze sentiment of text using local or Azure models."""
        start_time = time.time()
        
        try:
            # Check cache
            if use_cache:
                cache_key = f"sentiment:{hash(text) % 100000}"
                cached_result = await self._get_from_cache(cache_key)
                if cached_result:
                    return SentimentResult(**cached_result, source="cached")
            
            # Try local model first if preferred and available
            if prefer_local and self.sentiment_pipeline and self.model_warmup_done:
                try:
                    result = await self._analyze_sentiment_local(text)
                    result.processing_time_ms = (time.time() - start_time) * 1000
                    
                    if use_cache:
                        await self._cache_sentiment_result(text, result)
                    
                    return result
                    
                except Exception as e:
                    logger.warning(f"Local sentiment analysis failed: {e}")
            
            # Fallback to Azure
            if self.azure_client:
                try:
                    result = await self._analyze_sentiment_azure(text)
                    result.processing_time_ms = (time.time() - start_time) * 1000
                    
                    if use_cache:
                        await self._cache_sentiment_result(text, result)
                    
                    return result
                    
                except Exception as e:
                    logger.warning(f"Azure sentiment analysis failed: {e}")
            
            # Final fallback
            processing_time = (time.time() - start_time) * 1000
            return self._get_fallback_sentiment(processing_time)
            
        except Exception as e:
            logger.error(f"Sentiment analysis error: {e}")
            processing_time = (time.time() - start_time) * 1000
            return self._get_fallback_sentiment(processing_time)
    
    async def analyze_emotion(
        self,
        text: str,
        use_cache: bool = True,
        prefer_local: bool = True
    ) -> EmotionResult:
        """Analyze emotion of text using local or Azure models."""
        start_time = time.time()
        
        try:
            # Check cache
            if use_cache:
                cache_key = f"emotion:{hash(text) % 100000}"
                cached_result = await self._get_from_cache(cache_key)
                if cached_result:
                    return EmotionResult(**cached_result, source="cached")
            
            # Try local model first if preferred and available
            if prefer_local and self.emotion_pipeline and self.model_warmup_done:
                try:
                    result = await self._analyze_emotion_local(text)
                    result.processing_time_ms = (time.time() - start_time) * 1000
                    
                    if use_cache:
                        await self._cache_emotion_result(text, result)
                    
                    return result
                    
                except Exception as e:
                    logger.warning(f"Local emotion analysis failed: {e}")
            
            # Fallback to simple rule-based emotion detection
            result = await self._analyze_emotion_simple(text)
            result.processing_time_ms = (time.time() - start_time) * 1000
            
            if use_cache:
                await self._cache_emotion_result(text, result)
            
            return result
            
        except Exception as e:
            logger.error(f"Emotion analysis error: {e}")
            processing_time = (time.time() - start_time) * 1000
            return self._get_fallback_emotion(processing_time)
    
    async def _analyze_sentiment_local(self, text: str) -> SentimentResult:
        """Analyze sentiment using local transformer model."""
        
        # Run model inference in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, self.sentiment_pipeline, text)
        
        # Convert results to our format
        scores = {result["label"].lower(): result["score"] for result in results}
        
        # Map labels to our enum
        label_mapping = {
            "positive": SentimentLabel.POSITIVE,
            "negative": SentimentLabel.NEGATIVE,
            "neutral": SentimentLabel.NEUTRAL
        }
        
        # Find highest scoring label
        best_label = max(scores.keys(), key=lambda k: scores[k])
        sentiment_label = label_mapping.get(best_label, SentimentLabel.NEUTRAL)
        confidence = scores[best_label]
        
        return SentimentResult(
            label=sentiment_label,
            confidence=confidence,
            scores=scores,
            processing_time_ms=0,  # Will be set by caller
            source="local"
        )
    
    async def _analyze_sentiment_azure(self, text: str) -> SentimentResult:
        """Analyze sentiment using Azure Text Analytics."""
        
        try:
            documents = [{"id": "1", "text": text, "language": "en"}]
            
            # Run Azure API call in thread pool
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, 
                self.azure_client.analyze_sentiment,
                documents
            )
            
            result = response[0]
            
            # Map Azure sentiment to our format
            azure_to_local = {
                "positive": SentimentLabel.POSITIVE,
                "negative": SentimentLabel.NEGATIVE,
                "neutral": SentimentLabel.NEUTRAL,
                "mixed": SentimentLabel.NEUTRAL  # Treat mixed as neutral
            }
            
            sentiment_label = azure_to_local.get(result.sentiment, SentimentLabel.NEUTRAL)
            
            # Extract confidence scores
            scores = {
                "positive": result.confidence_scores.positive,
                "negative": result.confidence_scores.negative,
                "neutral": result.confidence_scores.neutral
            }
            
            confidence = max(scores.values())
            
            return SentimentResult(
                label=sentiment_label,
                confidence=confidence,
                scores=scores,
                processing_time_ms=0,  # Will be set by caller
                source="azure"
            )
            
        except HttpResponseError as e:
            logger.error(f"Azure Text Analytics error: {e}")
            raise
    
    async def _analyze_emotion_local(self, text: str) -> EmotionResult:
        """Analyze emotion using local transformer model."""
        
        # Run model inference in thread pool
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, self.emotion_pipeline, text)
        
        # Convert results to our format
        emotion_scores = {result["label"].lower(): result["score"] for result in results}
        
        # Map labels to our enum
        label_mapping = {
            "joy": EmotionLabel.JOY,
            "anger": EmotionLabel.ANGER,
            "fear": EmotionLabel.FEAR,
            "sadness": EmotionLabel.SADNESS,
            "disgust": EmotionLabel.DISGUST,
            "surprise": EmotionLabel.SURPRISE,
            "neutral": EmotionLabel.NEUTRAL
        }
        
        # Find highest scoring emotion
        best_emotion = max(emotion_scores.keys(), key=lambda k: emotion_scores[k])
        primary_emotion = label_mapping.get(best_emotion, EmotionLabel.NEUTRAL)
        confidence = emotion_scores[best_emotion]
        
        return EmotionResult(
            primary_emotion=primary_emotion,
            confidence=confidence,
            emotion_scores=emotion_scores,
            processing_time_ms=0,  # Will be set by caller
            source="local"
        )
    
    async def _analyze_emotion_simple(self, text: str) -> EmotionResult:
        """Simple rule-based emotion detection as fallback."""
        
        text_lower = text.lower()
        
        # Emotion keyword patterns
        emotion_patterns = {
            EmotionLabel.ANGER: ["angry", "mad", "furious", "annoyed", "irritated", "stop calling"],
            EmotionLabel.JOY: ["happy", "great", "wonderful", "excellent", "good", "thanks"],
            EmotionLabel.FEAR: ["worried", "scared", "afraid", "nervous", "concerned"],
            EmotionLabel.SADNESS: ["sad", "disappointed", "upset", "sorry", "down"],
            EmotionLabel.DISGUST: ["disgusting", "awful", "terrible", "horrible", "sick"],
            EmotionLabel.SURPRISE: ["wow", "amazing", "surprised", "incredible", "really"]
        }
        
        scores = {emotion.value: 0.0 for emotion in EmotionLabel}
        scores["neutral"] = 0.5  # Default neutral baseline
        
        # Check for emotion keywords
        for emotion, keywords in emotion_patterns.items():
            matches = sum(1 for keyword in keywords if keyword in text_lower)
            if matches > 0:
                scores[emotion.value] = min(1.0, 0.3 + (matches * 0.2))
        
        # Find primary emotion
        primary_emotion_str = max(scores.keys(), key=lambda k: scores[k])
        primary_emotion = EmotionLabel(primary_emotion_str)
        confidence = scores[primary_emotion_str]
        
        return EmotionResult(
            primary_emotion=primary_emotion,
            confidence=confidence,
            emotion_scores=scores,
            processing_time_ms=0,  # Will be set by caller
            source="simple"
        )
    
    async def _extract_intent_signals(
        self,
        text: str,
        sentiment: SentimentResult,
        emotion: EmotionResult
    ) -> Dict[str, float]:
        """Extract conversation intent signals from text and analysis."""
        
        text_lower = text.lower()
        signals = {}
        
        # Sales intent signals
        sales_keywords = ["offer", "deal", "discount", "promotion", "buy", "purchase", "save"]
        signals["sales_intent"] = sum(0.2 for keyword in sales_keywords if keyword in text_lower)
        
        # Loan/finance intent signals
        finance_keywords = ["loan", "credit", "mortgage", "refinance", "debt", "money"]
        signals["finance_intent"] = sum(0.2 for keyword in finance_keywords if keyword in text_lower)
        
        # Investment intent signals
        investment_keywords = ["investment", "portfolio", "stocks", "returns", "profit"]
        signals["investment_intent"] = sum(0.2 for keyword in investment_keywords if keyword in text_lower)
        
        # Rejection signals
        rejection_keywords = ["not interested", "no thanks", "don't want", "remove me"]
        signals["rejection_intent"] = sum(0.3 for keyword in rejection_keywords if keyword in text_lower)
        
        # Question/inquiry signals
        question_signals = ["?", "how", "what", "when", "where", "why", "tell me"]
        signals["inquiry_intent"] = sum(0.1 for signal in question_signals if signal in text_lower)
        
        # Normalize scores
        for key in signals:
            signals[key] = min(1.0, signals[key])
        
        return signals
    
    def _detect_persistence_indicators(self, text: str) -> List[str]:
        """Detect indicators of caller persistence."""
        
        text_lower = text.lower()
        indicators = []
        
        persistence_patterns = [
            "just listen", "hear me out", "one moment", "wait",
            "let me explain", "but", "however", "actually",
            "really quick", "won't take long", "just", "only"
        ]
        
        for pattern in persistence_patterns:
            if pattern in text_lower:
                indicators.append(pattern)
        
        return indicators
    
    def _detect_termination_signals(self, text: str) -> List[str]:
        """Detect signals that conversation should terminate."""
        
        text_lower = text.lower()
        signals = []
        
        termination_patterns = [
            "hang up", "goodbye", "bye", "don't call", "remove me",
            "stop calling", "not interested", "no thank you", "end"
        ]
        
        for pattern in termination_patterns:
            if pattern in text_lower:
                signals.append(pattern)
        
        return signals
    
    def _calculate_emotional_intensity(self, emotion_result: EmotionResult) -> float:
        """Calculate overall emotional intensity from emotion analysis."""
        
        # Weight different emotions by intensity
        intensity_weights = {
            EmotionLabel.ANGER: 1.0,
            EmotionLabel.FEAR: 0.8,
            EmotionLabel.DISGUST: 0.9,
            EmotionLabel.SADNESS: 0.7,
            EmotionLabel.JOY: 0.6,
            EmotionLabel.SURPRISE: 0.5,
            EmotionLabel.NEUTRAL: 0.0
        }
        
        total_intensity = 0.0
        for emotion_str, score in emotion_result.emotion_scores.items():
            emotion = EmotionLabel(emotion_str)
            weight = intensity_weights.get(emotion, 0.0)
            total_intensity += score * weight
        
        return min(1.0, total_intensity)
    
    def _predict_conversation_stage(
        self,
        text: str,
        sentiment: SentimentResult,
        emotion: EmotionResult
    ) -> str:
        """Predict conversation stage based on analysis."""
        
        text_lower = text.lower()
        
        # Opening stage indicators
        if any(word in text_lower for word in ["hello", "hi", "good morning", "calling about"]):
            return "opening"
        
        # Presentation stage indicators
        elif any(word in text_lower for word in ["offer", "deal", "product", "service"]):
            return "presentation"
        
        # Objection handling stage
        elif any(word in text_lower for word in ["but", "however", "wait", "listen"]):
            return "objection_handling"
        
        # Closing attempt stage
        elif any(word in text_lower for word in ["decide", "today", "now", "limited"]):
            return "closing_attempt"
        
        # Termination stage
        elif any(word in text_lower for word in ["goodbye", "hang up", "bye", "end"]):
            return "termination"
        
        else:
            return "unknown"
    
    # Caching and fallback methods
    async def _get_cached_analysis(self, text: str) -> Optional[ConversationAnalysis]:
        """Get cached conversation analysis."""
        if not self.cache:
            return None
        
        cache_key = f"analysis:{hash(text) % 100000}"
        try:
            cached_data = await self.cache.get(cache_key)
            if cached_data:
                return ConversationAnalysis(**cached_data)
        except Exception as e:
            logger.warning(f"Cache get error: {e}")
        
        return None
    
    async def _cache_analysis(self, text: str, analysis: ConversationAnalysis) -> None:
        """Cache conversation analysis."""
        if not self.cache:
            return
        
        cache_key = f"analysis:{hash(text) % 100000}"
        try:
            # Convert to dict for caching
            cache_data = {
                "text": analysis.text,
                "sentiment": analysis.sentiment.__dict__,
                "emotion": analysis.emotion.__dict__,
                "intent_signals": analysis.intent_signals,
                "persistence_indicators": analysis.persistence_indicators,
                "termination_signals": analysis.termination_signals,
                "emotional_intensity": analysis.emotional_intensity,
                "conversation_stage_prediction": analysis.conversation_stage_prediction
            }
            
            await self.cache.setex(cache_key, self.cache_ttl, cache_data)
        except Exception as e:
            logger.warning(f"Cache set error: {e}")
    
    async def _get_from_cache(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """Generic cache get method."""
        if not self.cache:
            return None
        
        try:
            return await self.cache.get(cache_key)
        except Exception as e:
            logger.warning(f"Cache error for key {cache_key}: {e}")
            return None
    
    def _get_fallback_sentiment(self, processing_time: float = 0.0) -> SentimentResult:
        """Get fallback sentiment result."""
        return SentimentResult(
            label=SentimentLabel.NEUTRAL,
            confidence=0.5,
            scores={"positive": 0.33, "negative": 0.33, "neutral": 0.34},
            processing_time_ms=processing_time,
            source="fallback"
        )
    
    def _get_fallback_emotion(self, processing_time: float = 0.0) -> EmotionResult:
        """Get fallback emotion result."""
        return EmotionResult(
            primary_emotion=EmotionLabel.NEUTRAL,
            confidence=0.5,
            emotion_scores={emotion.value: 0.14 for emotion in EmotionLabel},
            processing_time_ms=processing_time,
            source="fallback"
        )
    
    def _get_fallback_analysis(self, text: str) -> ConversationAnalysis:
        """Get fallback conversation analysis."""
        return ConversationAnalysis(
            text=text,
            sentiment=self._get_fallback_sentiment(),
            emotion=self._get_fallback_emotion(),
            intent_signals={},
            persistence_indicators=[],
            termination_signals=[],
            emotional_intensity=0.5,
            conversation_stage_prediction="unknown"
        )


# Global service instance
_sentiment_analyzer: Optional[SentimentAnalyzer] = None


async def get_sentiment_analyzer() -> SentimentAnalyzer:
    """Get or create sentiment analyzer instance."""
    global _sentiment_analyzer
    
    if _sentiment_analyzer is None:
        _sentiment_analyzer = SentimentAnalyzer()
        await _sentiment_analyzer.initialize()
    
    return _sentiment_analyzer