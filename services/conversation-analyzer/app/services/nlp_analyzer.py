"""NLP analysis pipeline for conversation content."""

import asyncio
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import spacy
import torch
from transformers import (
    AutoTokenizer, 
    AutoModelForSequenceClassification,
    pipeline,
    AutoModel
)
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.core.config import settings, MLModelConfig
from app.core.logging import get_logger, analysis_logger
from app.models.analysis import (
    SentimentAnalysis,
    IntentRecognition,
    EntityExtraction,
    KeywordAnalysis,
    ContentAnalysisResponse
)

logger = get_logger(__name__)


class NLPAnalyzer:
    """Comprehensive NLP analyzer for conversation content."""
    
    def __init__(self):
        self.nlp = None
        self.sentiment_pipeline = None
        self.intent_model = None
        self.intent_tokenizer = None
        self.tfidf_vectorizer = None
        self.spam_patterns = None
        self.device = settings.torch_device
        self._initialize_models()
    
    def _initialize_models(self) -> None:
        """Initialize NLP models and pipelines."""
        try:
            logger.info("initializing_nlp_models", device=self.device)
            
            # Load spaCy model for Chinese NLP
            try:
                self.nlp = spacy.load(settings.spacy_model)
            except OSError:
                logger.warning("chinese_spacy_model_not_found", model=settings.spacy_model)
                # Fallback to English model
                try:
                    self.nlp = spacy.load("en_core_web_sm")
                except OSError:
                    logger.error("no_spacy_model_available")
                    self.nlp = None
            
            # Initialize sentiment analysis pipeline
            self.sentiment_pipeline = pipeline(
                "sentiment-analysis",
                model=settings.sentiment_model,
                device=0 if self.device == "cuda" else -1,
                framework="pt"
            )
            
            # Initialize intent classification components
            self._initialize_intent_classifier()
            
            # Initialize keyword extraction
            self._initialize_keyword_extractor()
            
            # Load spam detection patterns
            self._initialize_spam_patterns()
            
            logger.info("nlp_models_initialized")
            
        except Exception as e:
            logger.error("nlp_initialization_failed", error=str(e))
            raise
    
    def _initialize_intent_classifier(self) -> None:
        """Initialize intent classification models."""
        try:
            # For now, we'll use a rule-based approach with some ML components
            # In production, you'd want to fine-tune a model on conversation data
            self.intent_patterns = {
                "sales_call": {
                    "keywords": [
                        "产品", "促销", "优惠", "活动", "了解一下", "试用", "购买",
                        "销售", "推广", "特价", "折扣", "限时", "机会"
                    ],
                    "phrases": [
                        "我们有一个产品", "特别优惠", "限时活动", "了解一下我们的",
                        "您有兴趣吗", "可以为您介绍"
                    ]
                },
                "loan_offer": {
                    "keywords": [
                        "贷款", "借钱", "利息", "额度", "征信", "放款", "信贷",
                        "资金", "融资", "周转", "应急", "快速", "审核"
                    ],
                    "phrases": [
                        "需要资金吗", "贷款服务", "快速放款", "低利息",
                        "征信良好", "额度申请", "资金周转"
                    ]
                },
                "investment_pitch": {
                    "keywords": [
                        "投资", "理财", "收益", "股票", "基金", "赚钱", "财富",
                        "回报", "增值", "资产", "配置", "风险", "稳健"
                    ],
                    "phrases": [
                        "投资机会", "理财产品", "高收益", "稳定回报",
                        "财富增值", "资产配置", "投资建议"
                    ]
                },
                "insurance_sales": {
                    "keywords": [
                        "保险", "保障", "理赔", "保费", "受益人", "意外", "健康",
                        "医疗", "养老", "教育", "储蓄", "分红"
                    ],
                    "phrases": [
                        "保险产品", "保障计划", "意外保障", "健康保险",
                        "养老规划", "教育基金", "保费优惠"
                    ]
                },
                "debt_collection": {
                    "keywords": [
                        "欠款", "还款", "逾期", "催收", "债务", "违约", "法律",
                        "起诉", "征信记录", "黑名单", "执行"
                    ],
                    "phrases": [
                        "您的欠款", "逾期还款", "立即还款", "法律后果",
                        "征信影响", "催收通知", "债务处理"
                    ]
                },
                "survey_request": {
                    "keywords": [
                        "调查", "问卷", "访问", "统计", "研究", "数据", "意见",
                        "反馈", "评价", "满意度", "市场"
                    ],
                    "phrases": [
                        "市场调查", "问卷调查", "意见反馈", "满意度调查",
                        "参与调查", "数据统计", "研究项目"
                    ]
                }
            }
            
            logger.info("intent_classifier_initialized", patterns=len(self.intent_patterns))
            
        except Exception as e:
            logger.error("intent_classifier_initialization_failed", error=str(e))
            raise
    
    def _initialize_keyword_extractor(self) -> None:
        """Initialize keyword extraction components."""
        try:
            self.tfidf_vectorizer = TfidfVectorizer(
                max_features=1000,
                ngram_range=(1, 2),
                stop_words=None,  # We'll handle Chinese stop words separately
                analyzer='word'
            )
            
            # Chinese stop words
            self.chinese_stop_words = {
                '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
                '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
                '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '现在',
                '然后', '因为', '所以', '但是', '如果', '还是', '可以', '应该'
            }
            
            logger.info("keyword_extractor_initialized")
            
        except Exception as e:
            logger.error("keyword_extractor_initialization_failed", error=str(e))
            raise
    
    def _initialize_spam_patterns(self) -> None:
        """Initialize spam detection patterns."""
        self.spam_patterns = {
            "urgency_indicators": [
                "立即", "马上", "紧急", "抓紧", "快速", "限时", "截止",
                "最后", "机会", "错过", "赶快", "趁早"
            ],
            "pressure_tactics": [
                "仅限今天", "最后一次", "名额有限", "先到先得", "错过没有",
                "特殊优惠", "内部价格", "朋友价", "成本价"
            ],
            "financial_terms": [
                "免费", "零利息", "无抵押", "秒放款", "必过", "包通过",
                "高收益", "稳赚", "保本", "无风险", "日入", "月入"
            ],
            "suspicious_claims": [
                "百分百", "绝对", "保证", "承诺", "包赚", "稳赚不赔",
                "内幕消息", "独家", "秘密", "神秘", "特殊渠道"
            ]
        }
    
    async def analyze_content(
        self, 
        text: str, 
        call_id: str, 
        analysis_types: List[str],
        user_context: Optional[Dict[str, Any]] = None
    ) -> ContentAnalysisResponse:
        """Perform comprehensive content analysis."""
        analysis_logger.log_analysis_start(call_id, "content_analysis")
        start_time = time.time()
        
        try:
            # Initialize result structure
            result = ContentAnalysisResponse(
                call_id=call_id,
                processing_time_ms=0,
                confidence_score=0.0
            )
            
            # Preprocess text
            cleaned_text = self._preprocess_text(text)
            
            # Perform requested analyses
            tasks = []
            if "sentiment" in analysis_types:
                tasks.append(self._analyze_sentiment(cleaned_text))
            if "intent" in analysis_types:
                tasks.append(self._analyze_intent(cleaned_text, user_context))
            if "entities" in analysis_types:
                tasks.append(self._extract_entities(cleaned_text))
            if "keywords" in analysis_types:
                tasks.append(self._extract_keywords(cleaned_text))
            
            # Execute analyses in parallel
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for i, analysis_type in enumerate(["sentiment", "intent", "entities", "keywords"]):
                if analysis_type in analysis_types:
                    idx = [t for t in analysis_types if t in ["sentiment", "intent", "entities", "keywords"]].index(analysis_type)
                    if idx < len(results) and not isinstance(results[idx], Exception):
                        setattr(result, analysis_type, results[idx])
            
            # Calculate overall confidence
            result.confidence_score = self._calculate_overall_confidence(result)
            
            processing_time = int((time.time() - start_time) * 1000)
            result.processing_time_ms = processing_time
            
            analysis_logger.log_analysis_complete(
                call_id, 
                "content_analysis", 
                processing_time, 
                self._serialize_analysis_results(result)
            )
            
            return result
            
        except Exception as e:
            analysis_logger.log_error("content_analysis", call_id, e)
            raise
    
    def _preprocess_text(self, text: str) -> str:
        """Preprocess text for analysis."""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        
        # Remove special characters but keep punctuation
        text = re.sub(r'[^\w\s\u4e00-\u9fff.,!?;:()"-]', '', text)
        
        # Normalize punctuation
        text = re.sub(r'[。！？；：，]', '.', text)
        
        return text
    
    async def _analyze_sentiment(self, text: str) -> SentimentAnalysis:
        """Analyze sentiment of the text."""
        try:
            # Use Hugging Face sentiment pipeline
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None, 
                self.sentiment_pipeline, 
                text[:512]  # Truncate for model limits
            )
            
            if results and len(results) > 0:
                result = results[0]
                label = result['label'].lower()
                confidence = result['score']
                
                # Map labels to our format
                label_mapping = {
                    'positive': 'positive',
                    'negative': 'negative', 
                    'neutral': 'neutral',
                    'label_0': 'negative',  # RoBERTa sometimes uses numeric labels
                    'label_1': 'neutral',
                    'label_2': 'positive'
                }
                
                mapped_label = label_mapping.get(label, 'neutral')
                
                # Detect emotion based on text patterns and sentiment
                emotion, emotion_confidence = self._detect_emotion(text, mapped_label, confidence)
                
                return SentimentAnalysis(
                    label=mapped_label,
                    confidence=confidence,
                    scores={mapped_label: confidence},
                    emotion=emotion,
                    emotion_confidence=emotion_confidence
                )
            else:
                return SentimentAnalysis(
                    label="neutral",
                    confidence=0.5,
                    scores={"neutral": 0.5},
                    emotion="neutral",
                    emotion_confidence=0.5
                )
                
        except Exception as e:
            logger.error("sentiment_analysis_failed", error=str(e))
            return SentimentAnalysis(
                label="neutral",
                confidence=0.0,
                scores={"neutral": 1.0},
                emotion="neutral",
                emotion_confidence=0.0
            )
    
    def _detect_emotion(self, text: str, sentiment: str, confidence: float) -> Tuple[str, float]:
        """Detect specific emotions from text patterns."""
        emotion_patterns = {
            "frustrated": [
                "烦", "烦人", "麻烦", "打扰", "不耐烦", "够了", "别", "停",
                "不想听", "没时间", "很忙"
            ],
            "aggressive": [
                "滚", "死", "烦死了", "神经病", "有病", "脑子", "白痴",
                "找死", "去死", "滚开", "闭嘴"
            ],
            "confused": [
                "什么", "不懂", "不明白", "不知道", "怎么", "为什么",
                "听不懂", "搞不清楚", "糊涂"
            ],
            "polite": [
                "谢谢", "不好意思", "抱歉", "请", "麻烦", "打扰了",
                "不用了", "谢谢您", "客气"
            ]
        }
        
        text_lower = text.lower()
        emotion_scores = {}
        
        for emotion, patterns in emotion_patterns.items():
            score = 0
            for pattern in patterns:
                if pattern in text_lower:
                    score += 1
            
            if score > 0:
                emotion_scores[emotion] = score / len(patterns)
        
        if emotion_scores:
            # Get emotion with highest score
            best_emotion = max(emotion_scores, key=emotion_scores.get)
            emotion_confidence = emotion_scores[best_emotion]
            return best_emotion, min(emotion_confidence * 2, 1.0)  # Scale up confidence
        else:
            # Default based on sentiment
            if sentiment == "negative" and confidence > 0.7:
                return "frustrated", confidence * 0.8
            else:
                return "neutral", confidence * 0.6
    
    async def _analyze_intent(
        self, 
        text: str, 
        user_context: Optional[Dict[str, Any]] = None
    ) -> IntentRecognition:
        """Analyze intent of the conversation."""
        try:
            intent_scores = {}
            matched_keywords = []
            context_indicators = []
            
            text_lower = text.lower()
            
            # Score each intent category
            for intent, patterns in self.intent_patterns.items():
                score = 0.0
                category_keywords = []
                
                # Check keywords
                for keyword in patterns["keywords"]:
                    if keyword in text_lower:
                        score += 1.0
                        category_keywords.append(keyword)
                
                # Check phrases (higher weight)
                for phrase in patterns["phrases"]:
                    if phrase in text_lower:
                        score += 2.0
                        category_keywords.append(phrase)
                
                # Normalize score
                max_possible = len(patterns["keywords"]) + (len(patterns["phrases"]) * 2)
                normalized_score = score / max_possible if max_possible > 0 else 0.0
                
                intent_scores[intent] = normalized_score
                if normalized_score > 0:
                    matched_keywords.extend(category_keywords)
            
            # Apply user context if available
            if user_context:
                intent_scores = self._apply_context_to_intent(intent_scores, user_context)
            
            # Get best intent
            if intent_scores:
                best_intent = max(intent_scores, key=intent_scores.get)
                confidence = intent_scores[best_intent]
                
                # If confidence is too low, mark as unknown
                if confidence < MLModelConfig.INTENT_CONFIDENCE_MIN:
                    best_intent = "unknown"
                    confidence = 1.0 - max(intent_scores.values())
            else:
                best_intent = "unknown"
                confidence = 0.5
            
            # Determine subcategory
            subcategory = self._determine_intent_subcategory(best_intent, text_lower)
            
            return IntentRecognition(
                category=best_intent,
                confidence=min(confidence, 1.0),
                subcategory=subcategory,
                keywords=matched_keywords[:10],  # Limit to top 10
                context_indicators=context_indicators
            )
            
        except Exception as e:
            logger.error("intent_analysis_failed", error=str(e))
            return IntentRecognition(
                category="unknown",
                confidence=0.0,
                keywords=[],
                context_indicators=[]
            )
    
    def _apply_context_to_intent(
        self, 
        intent_scores: Dict[str, float], 
        user_context: Dict[str, Any]
    ) -> Dict[str, float]:
        """Apply user context to adjust intent scores."""
        # Get user's historical intent patterns
        if "recent_intents" in user_context:
            recent_intents = user_context["recent_intents"]
            for intent in recent_intents:
                if intent in intent_scores:
                    intent_scores[intent] *= 1.2  # Boost recurring intents
        
        # Apply user preferences
        if "spam_categories" in user_context:
            for category in user_context["spam_categories"]:
                if category in intent_scores:
                    intent_scores[category] *= 1.1  # Slight boost for known patterns
        
        return intent_scores
    
    def _determine_intent_subcategory(self, intent: str, text: str) -> Optional[str]:
        """Determine intent subcategory based on specific patterns."""
        subcategory_patterns = {
            "sales_call": {
                "cold_call": ["第一次", "初次", "了解一下", "介绍"],
                "follow_up": ["之前", "上次", "联系过", "回访"],
                "promotion": ["优惠", "活动", "促销", "特价"]
            },
            "loan_offer": {
                "personal_loan": ["个人", "消费", "信用"],
                "business_loan": ["企业", "公司", "经营"],
                "mortgage": ["房贷", "按揭", "房屋"]
            },
            "investment_pitch": {
                "stocks": ["股票", "股市", "个股"],
                "funds": ["基金", "理财", "定投"],
                "insurance_investment": ["保险", "储蓄", "分红"]
            }
        }
        
        if intent in subcategory_patterns:
            for subcategory, patterns in subcategory_patterns[intent].items():
                for pattern in patterns:
                    if pattern in text:
                        return subcategory
        
        return None
    
    async def _extract_entities(self, text: str) -> EntityExtraction:
        """Extract named entities from text."""
        try:
            entities = []
            person_names = []
            organizations = []
            locations = []
            phone_numbers = []
            amounts = []
            
            if self.nlp:
                # Use spaCy for entity extraction
                loop = asyncio.get_event_loop()
                doc = await loop.run_in_executor(None, self.nlp, text)
                
                for ent in doc.ents:
                    entity_info = {
                        "text": ent.text,
                        "label": ent.label_,
                        "start": ent.start_char,
                        "end": ent.end_char,
                        "confidence": 0.8  # spaCy doesn't provide confidence scores
                    }
                    entities.append(entity_info)
                    
                    # Categorize entities
                    if ent.label_ in ["PERSON", "PER"]:
                        person_names.append(ent.text)
                    elif ent.label_ in ["ORG", "ORGANIZATION"]:
                        organizations.append(ent.text)
                    elif ent.label_ in ["GPE", "LOC", "LOCATION"]:
                        locations.append(ent.text)
            
            # Extract phone numbers with regex
            phone_patterns = [
                r'1[3-9]\d{9}',  # Chinese mobile numbers
                r'\d{3}-\d{4}-\d{4}',  # International format
                r'\d{3}\s\d{4}\s\d{4}',  # Space separated
            ]
            
            for pattern in phone_patterns:
                matches = re.findall(pattern, text)
                phone_numbers.extend(matches)
            
            # Extract amounts/numbers
            amount_patterns = [
                r'(\d+(?:\.\d{2})?)[元块钱万]',
                r'(\d+(?:,\d{3})*(?:\.\d{2})?)',
            ]
            
            for pattern in amount_patterns:
                matches = re.findall(pattern, text)
                for match in matches:
                    amounts.append({
                        "value": match,
                        "currency": "CNY",
                        "confidence": 0.7
                    })
            
            return EntityExtraction(
                entities=entities,
                person_names=list(set(person_names)),
                organizations=list(set(organizations)),
                locations=list(set(locations)),
                phone_numbers=list(set(phone_numbers)),
                amounts=amounts
            )
            
        except Exception as e:
            logger.error("entity_extraction_failed", error=str(e))
            return EntityExtraction()
    
    async def _extract_keywords(self, text: str) -> KeywordAnalysis:
        """Extract keywords and key phrases."""
        try:
            keywords = []
            phrases = []
            topic_categories = []
            spam_indicators = []
            urgency_indicators = []
            
            # Basic keyword extraction using frequency
            words = text.lower().split()
            word_freq = {}
            
            for word in words:
                if (len(word) > 2 and 
                    word not in self.chinese_stop_words and
                    not word.isdigit()):
                    word_freq[word] = word_freq.get(word, 0) + 1
            
            # Get top keywords by frequency
            sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
            keywords = [word for word, freq in sorted_words[:20] if freq > 1]
            
            # Extract phrases (2-3 word combinations)
            sentences = re.split(r'[.!?。！？]', text)
            for sentence in sentences:
                sentence = sentence.strip()
                if len(sentence) > 10:
                    # Simple phrase extraction - could be improved with more sophisticated methods
                    words = sentence.split()
                    for i in range(len(words) - 1):
                        phrase = ' '.join(words[i:i+2])
                        if len(phrase) > 4:
                            phrases.append(phrase)
            
            # Detect spam indicators
            text_lower = text.lower()
            for category, patterns in self.spam_patterns.items():
                for pattern in patterns:
                    if pattern in text_lower:
                        if category == "urgency_indicators":
                            urgency_indicators.append(pattern)
                        else:
                            spam_indicators.append(pattern)
            
            # Determine topic categories based on keywords
            topic_mapping = {
                "financial": ["钱", "贷款", "投资", "理财", "保险", "基金"],
                "sales": ["产品", "服务", "优惠", "活动", "促销"],
                "survey": ["调查", "问卷", "统计", "研究"],
                "support": ["帮助", "解决", "问题", "服务", "客服"]
            }
            
            for topic, topic_words in topic_mapping.items():
                if any(word in keywords for word in topic_words):
                    topic_categories.append(topic)
            
            return KeywordAnalysis(
                keywords=keywords[:15],  # Top 15 keywords
                phrases=list(set(phrases))[:10],  # Top 10 unique phrases
                topic_categories=topic_categories,
                spam_indicators=spam_indicators,
                urgency_indicators=urgency_indicators
            )
            
        except Exception as e:
            logger.error("keyword_extraction_failed", error=str(e))
            return KeywordAnalysis()
    
    def _calculate_overall_confidence(self, result: ContentAnalysisResponse) -> float:
        """Calculate overall confidence score for the analysis."""
        confidences = []
        
        if result.sentiment:
            confidences.append(result.sentiment.confidence)
        if result.intent:
            confidences.append(result.intent.confidence)
        if result.entities:
            # Entity confidence is harder to calculate, use fixed value
            confidences.append(0.8)
        if result.keywords:
            # Keywords confidence based on number of keywords found
            keyword_count = len(result.keywords.keywords)
            confidences.append(min(keyword_count / 10.0, 1.0))
        
        return sum(confidences) / len(confidences) if confidences else 0.0
    
    def _serialize_analysis_results(self, result: ContentAnalysisResponse) -> Dict[str, Any]:
        """Serialize analysis results for logging."""
        summary = {}
        
        if result.sentiment:
            summary["sentiment"] = {
                "label": result.sentiment.label,
                "confidence": result.sentiment.confidence
            }
        
        if result.intent:
            summary["intent"] = {
                "category": result.intent.category,
                "confidence": result.intent.confidence
            }
        
        if result.entities:
            summary["entities"] = {
                "count": len(result.entities.entities),
                "person_names": len(result.entities.person_names),
                "organizations": len(result.entities.organizations)
            }
        
        if result.keywords:
            summary["keywords"] = {
                "count": len(result.keywords.keywords),
                "spam_indicators": len(result.keywords.spam_indicators)
            }
        
        return summary


# Singleton instance
nlp_analyzer = NLPAnalyzer()