"""
Intent Classification Service
Multi-layer intent recognition with keyword, semantic, and contextual analysis
"""

import asyncio
import hashlib
import json
import re
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from dataclasses import dataclass
import numpy as np
import structlog

from ..core.config import settings
from ..core.cache import conversation_cache
from ..models.conversation import IntentCategory, ConversationContext

logger = structlog.get_logger(__name__)


@dataclass
class IntentResult:
    """Intent classification result"""
    intent: IntentCategory
    confidence: float
    sub_category: Optional[str] = None
    emotional_tone: Optional[str] = None
    keywords_matched: List[str] = None
    context_influenced: bool = False


class IntentClassifier:
    """
    Multi-layer intent classification engine
    Combines keyword matching, semantic analysis, and contextual understanding
    """
    
    def __init__(self):
        self.confidence_threshold = 0.7
        self.keyword_patterns = self._initialize_keyword_patterns()
        self.semantic_embeddings = self._initialize_semantic_embeddings()
        self.context_analyzer = ContextAnalyzer()
        
        # Performance tracking
        self.total_classifications = 0
        self.correct_classifications = 0
        self.avg_processing_time = 0.0
    
    def _initialize_keyword_patterns(self) -> Dict[str, Dict[str, Any]]:
        """Initialize keyword patterns for intent detection"""
        return {
            IntentCategory.SALES_CALL: {
                "keywords": [
                    "产品", "促销", "优惠", "活动", "了解一下", 
                    "介绍", "推荐", "特价", "折扣", "新品",
                    "试用", "体验", "购买", "订购", "下单"
                ],
                "patterns": [
                    r"有.*产品.*推荐",
                    r"了解.*我们的.*服务",
                    r"给您介绍.*优惠",
                    r"最新.*活动"
                ],
                "weight": 0.35,
                "sub_categories": ["product_sales", "service_promotion", "discount_offer"]
            },
            IntentCategory.LOAN_OFFER: {
                "keywords": [
                    "贷款", "借钱", "利息", "额度", "征信", 
                    "放款", "审批", "利率", "还款", "信用",
                    "资金", "融资", "借贷", "分期", "授信"
                ],
                "patterns": [
                    r"贷款.*额度",
                    r"利息.*优惠",
                    r"无需.*抵押",
                    r"快速.*放款",
                    r"征信.*要求"
                ],
                "weight": 0.4,
                "sub_categories": ["personal_loan", "business_loan", "credit_card"]
            },
            IntentCategory.INVESTMENT_PITCH: {
                "keywords": [
                    "投资", "理财", "收益", "股票", "基金",
                    "赚钱", "回报", "盈利", "分红", "资产",
                    "配置", "财富", "增值", "风险", "机会"
                ],
                "patterns": [
                    r"投资.*机会",
                    r"高.*收益",
                    r"理财.*产品",
                    r"财富.*增值",
                    r"资产.*配置"
                ],
                "weight": 0.35,
                "sub_categories": ["stock_investment", "fund_investment", "wealth_management"]
            },
            IntentCategory.INSURANCE_SALES: {
                "keywords": [
                    "保险", "保障", "理赔", "保费", "受益人",
                    "保单", "投保", "承保", "赔付", "险种",
                    "意外", "医疗", "养老", "重疾", "寿险"
                ],
                "patterns": [
                    r"保险.*保障",
                    r"意外.*理赔",
                    r"医疗.*保险",
                    r"养老.*规划"
                ],
                "weight": 0.3,
                "sub_categories": ["life_insurance", "health_insurance", "property_insurance"]
            },
            IntentCategory.TELECOM_OFFER: {
                "keywords": [
                    "套餐", "流量", "话费", "宽带", "5G",
                    "升级", "优惠", "充值", "办理", "运营商",
                    "电话卡", "手机号", "网络", "提速", "资费"
                ],
                "patterns": [
                    r"套餐.*升级",
                    r"流量.*优惠",
                    r"宽带.*提速",
                    r"话费.*充值"
                ],
                "weight": 0.25,
                "sub_categories": ["mobile_plan", "broadband", "value_added_service"]
            }
        }
    
    def _initialize_semantic_embeddings(self) -> Dict[str, np.ndarray]:
        """Initialize semantic embeddings for intent categories"""
        # Simplified embeddings - in production, use real embeddings from a model
        return {
            IntentCategory.SALES_CALL: np.array([0.8, 0.2, 0.1, 0.3, 0.5]),
            IntentCategory.LOAN_OFFER: np.array([0.2, 0.9, 0.3, 0.1, 0.4]),
            IntentCategory.INVESTMENT_PITCH: np.array([0.3, 0.4, 0.8, 0.2, 0.6]),
            IntentCategory.INSURANCE_SALES: np.array([0.1, 0.3, 0.2, 0.9, 0.5]),
            IntentCategory.TELECOM_OFFER: np.array([0.4, 0.1, 0.3, 0.2, 0.8])
        }
    
    async def classify_intent(
        self,
        transcript: str,
        context: Optional[ConversationContext] = None
    ) -> IntentResult:
        """
        Multi-layer intent classification
        Combines keyword, semantic, and contextual analysis
        """
        start_time = datetime.utcnow()
        
        try:
            # Check cache first
            cached_result = await self._get_cached_classification(transcript)
            if cached_result:
                return cached_result
            
            # Parallel multi-layer classification
            results = await asyncio.gather(
                self._keyword_based_classification(transcript),
                self._semantic_classification(transcript),
                self._contextual_classification(transcript, context),
                return_exceptions=True
            )
            
            # Handle any exceptions in parallel tasks
            valid_results = []
            for result in results:
                if isinstance(result, Exception):
                    logger.warning("Classification layer failed", error=str(result))
                    continue
                valid_results.append(result)
            
            # Fuse classification results
            fused_result = await self._fuse_classification_results(valid_results, transcript)
            
            # Cache the result
            await self._cache_classification(transcript, fused_result)
            
            # Update metrics
            self.total_classifications += 1
            processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000
            self.avg_processing_time = (
                (self.avg_processing_time * (self.total_classifications - 1) + processing_time) / 
                self.total_classifications
            )
            
            logger.info(
                "Intent classified",
                intent=fused_result.intent.value,
                confidence=fused_result.confidence,
                processing_time_ms=processing_time
            )
            
            return fused_result
            
        except Exception as e:
            logger.error("Intent classification failed", error=str(e))
            # Return default intent with low confidence
            return IntentResult(
                intent=IntentCategory.UNKNOWN,
                confidence=0.0,
                emotional_tone="neutral"
            )
    
    async def _keyword_based_classification(self, text: str) -> IntentResult:
        """Keyword-based intent classification"""
        text_lower = text.lower()
        max_score = 0.0
        predicted_intent = IntentCategory.UNKNOWN
        matched_keywords = []
        sub_category = None
        
        for intent, config in self.keyword_patterns.items():
            # Count keyword matches
            keyword_matches = []
            for keyword in config["keywords"]:
                if keyword in text_lower:
                    keyword_matches.append(keyword)
            
            # Check pattern matches
            pattern_matches = 0
            for pattern in config["patterns"]:
                if re.search(pattern, text_lower):
                    pattern_matches += 1
            
            # Calculate weighted score
            keyword_score = len(keyword_matches) / max(len(config["keywords"]), 1)
            pattern_score = pattern_matches / max(len(config["patterns"]), 1)
            
            # Combined score with pattern bonus
            combined_score = (keyword_score * 0.6 + pattern_score * 0.4) * config["weight"]
            
            if combined_score > max_score:
                max_score = combined_score
                predicted_intent = intent
                matched_keywords = keyword_matches
                
                # Determine sub-category if score is high enough
                if combined_score > 0.3 and config.get("sub_categories"):
                    sub_category = self._determine_sub_category(
                        text_lower, 
                        config["sub_categories"]
                    )
        
        return IntentResult(
            intent=predicted_intent,
            confidence=min(max_score * 1.5, 1.0),  # Scale up confidence
            sub_category=sub_category,
            keywords_matched=matched_keywords
        )
    
    async def _semantic_classification(self, text: str) -> IntentResult:
        """Semantic-based intent classification using embeddings"""
        # Generate text embedding (simplified - use real model in production)
        text_embedding = await self._get_text_embedding(text)
        
        # Compare with intent embeddings
        max_similarity = 0.0
        predicted_intent = IntentCategory.UNKNOWN
        
        for intent, intent_embedding in self.semantic_embeddings.items():
            similarity = self._cosine_similarity(text_embedding, intent_embedding)
            
            if similarity > max_similarity:
                max_similarity = similarity
                predicted_intent = intent
        
        return IntentResult(
            intent=predicted_intent,
            confidence=max_similarity,
            emotional_tone=self._analyze_emotional_tone(text)
        )
    
    async def _contextual_classification(
        self, 
        text: str, 
        context: Optional[ConversationContext]
    ) -> IntentResult:
        """Context-aware intent classification"""
        if not context or not context.conversation_history:
            return IntentResult(
                intent=IntentCategory.UNKNOWN,
                confidence=0.0
            )
        
        # Analyze conversation context
        context_result = await self.context_analyzer.analyze(context)
        
        # If recent intents are consistent, boost confidence
        if context_result.consistent_intent:
            return IntentResult(
                intent=context_result.dominant_intent,
                confidence=min(context_result.confidence * 1.2, 1.0),
                context_influenced=True,
                emotional_tone=context_result.emotional_progression
            )
        
        # Otherwise, use context as a hint
        return IntentResult(
            intent=context_result.likely_intent,
            confidence=context_result.confidence * 0.8,
            context_influenced=True
        )
    
    async def _fuse_classification_results(
        self,
        results: List[IntentResult],
        original_text: str
    ) -> IntentResult:
        """Fuse multiple classification results with weighted voting"""
        if not results:
            return IntentResult(
                intent=IntentCategory.UNKNOWN,
                confidence=0.0
            )
        
        # Weight configuration for each classification method
        weights = {
            0: 0.3,  # Keyword-based
            1: 0.4,  # Semantic
            2: 0.3   # Contextual
        }
        
        # Collect weighted votes
        intent_scores = {}
        total_confidence = 0.0
        merged_keywords = []
        sub_category = None
        emotional_tone = None
        
        for idx, result in enumerate(results):
            weight = weights.get(idx, 0.33)
            
            if result.intent != IntentCategory.UNKNOWN:
                if result.intent not in intent_scores:
                    intent_scores[result.intent] = 0.0
                intent_scores[result.intent] += result.confidence * weight
                total_confidence += result.confidence * weight
                
                # Merge additional data
                if result.keywords_matched:
                    merged_keywords.extend(result.keywords_matched)
                if result.sub_category:
                    sub_category = result.sub_category
                if result.emotional_tone:
                    emotional_tone = result.emotional_tone
        
        # Select intent with highest score
        if intent_scores:
            best_intent = max(intent_scores.items(), key=lambda x: x[1])
            
            # Normalize confidence
            normalized_confidence = best_intent[1] / max(sum(weights.values()), 1)
            
            return IntentResult(
                intent=best_intent[0],
                confidence=min(normalized_confidence, 1.0),
                sub_category=sub_category,
                emotional_tone=emotional_tone or self._analyze_emotional_tone(original_text),
                keywords_matched=list(set(merged_keywords)),
                context_influenced=any(r.context_influenced for r in results)
            )
        
        return IntentResult(
            intent=IntentCategory.UNKNOWN,
            confidence=0.0,
            emotional_tone="neutral"
        )
    
    def _determine_sub_category(self, text: str, sub_categories: List[str]) -> Optional[str]:
        """Determine sub-category based on text content"""
        # Simple heuristic - can be enhanced with ML
        sub_category_keywords = {
            "product_sales": ["产品", "商品", "货物"],
            "service_promotion": ["服务", "体验", "试用"],
            "discount_offer": ["折扣", "优惠", "特价"],
            "personal_loan": ["个人", "消费", "生活"],
            "business_loan": ["企业", "经营", "生意"],
            "credit_card": ["信用卡", "额度", "分期"],
            "stock_investment": ["股票", "股市", "炒股"],
            "fund_investment": ["基金", "定投", "净值"],
            "wealth_management": ["理财", "财富", "资产"]
        }
        
        for sub_cat in sub_categories:
            if sub_cat in sub_category_keywords:
                keywords = sub_category_keywords[sub_cat]
                if any(kw in text for kw in keywords):
                    return sub_cat
        
        return sub_categories[0] if sub_categories else None
    
    def _analyze_emotional_tone(self, text: str) -> str:
        """Analyze emotional tone of the text"""
        # Emotional indicators
        aggressive_words = ["必须", "马上", "立即", "错过", "最后", "仅限"]
        friendly_words = ["您好", "请问", "方便", "打扰", "谢谢", "麻烦"]
        persistent_words = ["再", "还是", "真的", "确实", "一定", "肯定"]
        
        aggressive_score = sum(1 for word in aggressive_words if word in text)
        friendly_score = sum(1 for word in friendly_words if word in text)
        persistent_score = sum(1 for word in persistent_words if word in text)
        
        if aggressive_score > 2:
            return "aggressive"
        elif persistent_score > 2:
            return "persistent"
        elif friendly_score > 2:
            return "friendly"
        else:
            return "neutral"
    
    async def _get_text_embedding(self, text: str) -> np.ndarray:
        """Generate text embedding (simplified version)"""
        # In production, use a real embedding model
        # This is a simplified feature extraction
        features = []
        
        # Length feature
        features.append(min(len(text) / 100, 1.0))
        
        # Keyword density features
        for intent, config in self.keyword_patterns.items():
            keyword_count = sum(1 for kw in config["keywords"] if kw in text.lower())
            features.append(keyword_count / max(len(config["keywords"]), 1))
        
        # Pad or truncate to fixed size
        while len(features) < 5:
            features.append(0.0)
        
        return np.array(features[:5])
    
    def _cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors"""
        dot_product = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return dot_product / (norm1 * norm2)
    
    async def _get_cached_classification(self, text: str) -> Optional[IntentResult]:
        """Get cached classification result"""
        try:
            cache_key = f"intent:{hashlib.md5(text.encode()).hexdigest()}"
            cached = await conversation_cache.get(cache_key)
            
            if cached:
                return IntentResult(**json.loads(cached))
        except Exception as e:
            logger.warning("Cache retrieval failed", error=str(e))
        
        return None
    
    async def _cache_classification(self, text: str, result: IntentResult) -> None:
        """Cache classification result"""
        try:
            cache_key = f"intent:{hashlib.md5(text.encode()).hexdigest()}"
            result_dict = {
                "intent": result.intent.value,
                "confidence": result.confidence,
                "sub_category": result.sub_category,
                "emotional_tone": result.emotional_tone,
                "keywords_matched": result.keywords_matched,
                "context_influenced": result.context_influenced
            }
            
            await conversation_cache.set(
                cache_key,
                json.dumps(result_dict),
                ttl=3600  # 1 hour cache
            )
        except Exception as e:
            logger.warning("Cache storage failed", error=str(e))
    
    async def learn_from_feedback(
        self,
        text: str,
        predicted_intent: IntentCategory,
        correct_intent: IntentCategory,
        confidence: float
    ) -> None:
        """Learn from classification feedback to improve accuracy"""
        try:
            # Update accuracy metrics
            if predicted_intent == correct_intent:
                self.correct_classifications += 1
            
            accuracy = self.correct_classifications / max(self.total_classifications, 1)
            
            # Log learning event
            logger.info(
                "Learning from feedback",
                predicted=predicted_intent.value,
                correct=correct_intent.value,
                confidence=confidence,
                accuracy=accuracy
            )
            
            # Adjust weights if prediction was wrong with high confidence
            if predicted_intent != correct_intent and confidence > 0.8:
                # This would trigger retraining or weight adjustment in production
                logger.warning(
                    "High confidence misclassification",
                    text_sample=text[:50],
                    predicted=predicted_intent.value,
                    correct=correct_intent.value
                )
            
        except Exception as e:
            logger.error("Failed to learn from feedback", error=str(e))


class ContextAnalyzer:
    """Analyze conversation context for intent classification"""
    
    async def analyze(self, context: ConversationContext) -> Dict[str, Any]:
        """Analyze conversation context"""
        if not context.conversation_history:
            return {
                "consistent_intent": False,
                "dominant_intent": IntentCategory.UNKNOWN,
                "likely_intent": IntentCategory.UNKNOWN,
                "confidence": 0.0,
                "emotional_progression": "neutral"
            }
        
        # Analyze intent history
        recent_intents = []
        for msg in context.conversation_history[-5:]:  # Last 5 messages
            if hasattr(msg, 'intent') and msg.intent:
                recent_intents.append(msg.intent)
        
        if not recent_intents:
            return {
                "consistent_intent": False,
                "dominant_intent": IntentCategory.UNKNOWN,
                "likely_intent": IntentCategory.UNKNOWN,
                "confidence": 0.0,
                "emotional_progression": "neutral"
            }
        
        # Find dominant intent
        intent_counts = {}
        for intent in recent_intents:
            intent_counts[intent] = intent_counts.get(intent, 0) + 1
        
        dominant_intent = max(intent_counts.items(), key=lambda x: x[1])[0]
        consistency_ratio = intent_counts[dominant_intent] / len(recent_intents)
        
        # Analyze emotional progression
        emotional_progression = self._analyze_emotional_progression(context)
        
        return {
            "consistent_intent": consistency_ratio > 0.7,
            "dominant_intent": dominant_intent,
            "likely_intent": dominant_intent,
            "confidence": consistency_ratio,
            "emotional_progression": emotional_progression
        }
    
    def _analyze_emotional_progression(self, context: ConversationContext) -> str:
        """Analyze how emotional tone has progressed"""
        if context.turn_count < 3:
            return "neutral"
        elif context.turn_count < 6:
            return "escalating"
        elif context.turn_count < 9:
            return "persistent"
        else:
            return "frustrated"


# Global classifier instance
intent_classifier = IntentClassifier()