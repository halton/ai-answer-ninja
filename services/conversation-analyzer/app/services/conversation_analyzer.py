import asyncio
import json
from typing import Dict, List, Optional

import spacy
import nltk
from nltk.corpus import stopwords
from textblob import TextBlob
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

from app.models.analysis import ConversationAnalysis, RiskAssessment
from app.services.summary_generator import SummaryGenerator
from app.services.nlp_analyzer import NLPAnalyzer
from app.core.database import PostgresClient
from app.core.cache import RedisCache

class ConversationAnalyzer:
    def __init__(
        self, 
        postgres_client: PostgresClient, 
        redis_cache: RedisCache, 
        azure_text_analytics_endpoint: str, 
        azure_text_analytics_key: str
    ):
        self.postgres_client = postgres_client
        self.redis_cache = redis_cache
        
        # NLP 模型加载
        self.nlp = spacy.load("zh_core_web_sm")
        nltk.download('stopwords')
        self.stop_words = set(stopwords.words('chinese'))
        
        # Azure 文本分析客户端
        credential = AzureKeyCredential(azure_text_analytics_key)
        self.text_analytics_client = TextAnalyticsClient(
            endpoint=azure_text_analytics_endpoint, 
            credential=credential
        )
        
        # 服务初始化
        self.summary_generator = SummaryGenerator()
        self.nlp_analyzer = NLPAnalyzer()

    async def analyze_conversation(
        self, 
        call_record_id: str, 
        conversation_data: List[Dict[str, str]]
    ) -> ConversationAnalysis:
        """
        分析通话内容并生成全面报告
        
        Args:
            call_record_id (str): 通话记录ID
            conversation_data (List[Dict]): 对话内容列表
        
        Returns:
            ConversationAnalysis: 通话分析结果
        """
        # 文本处理
        processed_text = self._preprocess_conversation(conversation_data)
        
        # 并行执行多个分析任务
        async_tasks = [
            self._analyze_sentiment(processed_text),
            self._extract_key_entities(processed_text),
            self._perform_intent_recognition(processed_text),
            self._risk_assessment(processed_text),
            self._generate_summary(processed_text)
        ]
        
        results = await asyncio.gather(*async_tasks)
        
        # 组装分析结果
        analysis = ConversationAnalysis(
            call_record_id=call_record_id,
            sentiment=results[0],
            entities=results[1],
            intent=results[2],
            risk_assessment=results[3],
            summary=results[4]
        )
        
        # 存储分析结果到数据库
        await self._save_analysis_result(analysis)
        
        return analysis

    def _preprocess_conversation(
        self, 
        conversation_data: List[Dict[str, str]]
    ) -> str:
        """文本预处理"""
        texts = [entry['message_text'] for entry in conversation_data]
        processed_text = ' '.join(texts)
        
        doc = self.nlp(processed_text)
        cleaned_text = ' '.join([
            token.text 
            for token in doc 
            if token.text.lower() not in self.stop_words
        ])
        
        return cleaned_text

    async def _analyze_sentiment(self, text: str) -> Dict:
        """情感分析"""
        sentiment_result = self.text_analytics_client.analyze_sentiment([text])[0]
        return {
            "sentiment": sentiment_result.sentiment,
            "confidence": sentiment_result.confidence_scores
        }

    async def _extract_key_entities(self, text: str) -> List[Dict]:
        """关键实体提取"""
        entities_result = self.text_analytics_client.recognize_entities([text])[0]
        return [
            {
                "text": entity.text,
                "category": entity.category,
                "confidence": entity.confidence_score
            } 
            for entity in entities_result
        ]

    async def _perform_intent_recognition(self, text: str) -> Dict:
        """意图识别"""
        return await self.nlp_analyzer.classify_intent(text)

    async def _risk_assessment(self, text: str) -> RiskAssessment:
        """风险评估"""
        spam_probability = await self.nlp_analyzer.estimate_spam_risk(text)
        return RiskAssessment(
            spam_risk=spam_probability,
            threat_level=self._calculate_threat_level(spam_probability)
        )

    def _calculate_threat_level(self, spam_risk: float) -> str:
        """根据风险概率计算威胁等级"""
        if spam_risk < 0.3:
            return "Low"
        elif spam_risk < 0.7:
            return "Medium"
        else:
            return "High"

    async def _generate_summary(self, text: str) -> str:
        """生成通话摘要"""
        return await self.summary_generator.generate_summary(text)

    async def _save_analysis_result(self, analysis: ConversationAnalysis):
        """保存分析结果到数据库"""
        # 使用PostgreSQL分区表存储分析结果
        query = """
        INSERT INTO conversation_analyses 
        (call_record_id, sentiment, entities, intent, risk_assessment, summary, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
        """
        params = (
            analysis.call_record_id,
            json.dumps(analysis.sentiment),
            json.dumps(analysis.entities),
            json.dumps(analysis.intent),
            json.dumps(analysis.risk_assessment.dict()),
            analysis.summary
        )
        
        await self.postgres_client.execute(query, params)
        
        # 缓存分析结果
        await self.redis_cache.set(
            f"conversation_analysis:{analysis.call_record_id}",
            json.dumps(analysis.dict()),
            ex=86400  # 缓存24小时
        )