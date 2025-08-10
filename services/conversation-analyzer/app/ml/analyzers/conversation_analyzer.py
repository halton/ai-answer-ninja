import asyncio
import re
from typing import Dict, List, Optional

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.models.analysis import (
    ConversationAnalysis, 
    SpamRiskAssessment, 
    EmotionalTrend, 
    TopicDistribution
)
from app.services.nlp_analyzer import nlp_analyzer

class ConversationMLAnalyzer:
    def __init__(self):
        # 加载预训练模型和分词器
        self.spam_model_path = "/path/to/spam_classification_model"
        self.spam_tokenizer = AutoTokenizer.from_pretrained(self.spam_model_path)
        self.spam_model = AutoModelForSequenceClassification.from_pretrained(self.spam_model_path)
        
        # 特征提取器
        self.tfidf_vectorizer = TfidfVectorizer(
            max_features=5000,
            stop_words='chinese',
            ngram_range=(1, 2)
        )
        
        # 中文停用词
        self.stop_words = {
            '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
            '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去'
        }

    async def analyze_conversation_ml(
        self, 
        conversations: List[Dict],
        conversation_id: str
    ) -> ConversationAnalysis:
        """
        通过机器学习进行深度对话分析
        
        Args:
            conversations (List[Dict]): 对话记录列表
            conversation_id (str): 对话唯一标识
        
        Returns:
            ConversationAnalysis: 深度分析结果
        """
        # 提取对话文本
        texts = [conv['message_text'] for conv in conversations]
        
        # 并行执行多个分析任务
        async_tasks = [
            self._assess_spam_risk(texts),
            self._analyze_emotional_trend(texts),
            self._extract_topic_distribution(texts),
            self._perform_semantic_similarity_analysis(texts)
        ]
        
        results = await asyncio.gather(*async_tasks)
        
        return ConversationAnalysis(
            conversation_id=conversation_id,
            spam_risk=results[0],
            emotional_trend=results[1],
            topic_distribution=results[2],
            semantic_similarity=results[3]
        )

    async def _assess_spam_risk(self, texts: List[str]) -> SpamRiskAssessment:
        """评估垃圾电话风险"""
        spam_features = []
        
        for text in texts:
            # 特征提取
            inputs = self.spam_tokenizer(
                text, 
                return_tensors="pt", 
                truncation=True, 
                max_length=512
            )
            
            with torch.no_grad():
                outputs = self.spam_model(**inputs)
                spam_score = torch.softmax(outputs.logits, dim=1)[0][1].item()
            
            spam_features.append(spam_score)
        
        # 计算风险指标
        return SpamRiskAssessment(
            average_risk=np.mean(spam_features),
            max_risk=max(spam_features),
            risk_distribution=spam_features
        )

    async def _analyze_emotional_trend(self, texts: List[str]) -> EmotionalTrend:
        """分析对话的情感趋势"""
        emotional_scores = []
        
        for text in texts:
            sentiment = await nlp_analyzer._analyze_sentiment(text)
            emotion_score = 1 if sentiment.label == 'positive' else -1 if sentiment.label == 'negative' else 0
            emotional_scores.append({
                'text': text,
                'emotion_score': emotion_score,
                'confidence': sentiment.confidence
            })
        
        # 计算情感变化趋势
        trend_scores = [item['emotion_score'] for item in emotional_scores]
        
        return EmotionalTrend(
            trend_scores=trend_scores,
            trend_direction=np.mean(trend_scores),
            most_emotional_text=max(emotional_scores, key=lambda x: x['confidence'])['text']
        )

    async def _extract_topic_distribution(self, texts: List[str]) -> TopicDistribution:
        """提取对话主题分布"""
        # 预处理文本
        cleaned_texts = [self._preprocess_text(text) for text in texts]
        
        # TF-IDF特征提取
        tfidf_matrix = self.tfidf_vectorizer.fit_transform(cleaned_texts)
        
        # 主题类别映射
        topic_categories = {
            "financial": ["钱", "贷款", "投资", "理财", "保险"],
            "sales": ["产品", "服务", "优惠", "活动", "促销"],
            "survey": ["调查", "问卷", "统计", "研究"],
            "support": ["帮助", "解决", "问题", "服务", "客服"]
        }
        
        # 计算主题分布
        topic_distribution = {}
        for category, keywords in topic_categories.items():
            category_vector = self.tfidf_vectorizer.transform(keywords)
            similarities = cosine_similarity(tfidf_matrix, category_vector)
            topic_distribution[category] = np.mean(similarities, axis=1).tolist()
        
        return TopicDistribution(
            topic_distribution=topic_distribution,
            dominant_topic=max(topic_distribution, key=lambda k: np.mean(topic_distribution[k]))
        )

    async def _perform_semantic_similarity_analysis(self, texts: List[str]) -> float:
        """
        分析对话的语义一致性
        
        Returns:
            float: 语义相似度分数
        """
        # 预处理文本
        cleaned_texts = [self._preprocess_text(text) for text in texts]
        
        # TF-IDF特征提取
        tfidf_matrix = self.tfidf_vectorizer.fit_transform(cleaned_texts)
        
        # 计算语义相似度
        similarity_matrix = cosine_similarity(tfidf_matrix)
        
        # 去除对角线（每个文本与自身的相似度）
        np.fill_diagonal(similarity_matrix, 0)
        
        # 平均语义相似度
        avg_semantic_similarity = np.mean(similarity_matrix)
        
        return avg_semantic_similarity

    def _preprocess_text(self, text: str) -> str:
        """文本预处理"""
        # 删除特殊字符和数字
        text = re.sub(r'[^\u4e00-\u9fff\w\s]', '', text)
        
        # 删除停用词
        words = text.split()
        cleaned_words = [word for word in words if word not in self.stop_words]
        
        return ' '.join(cleaned_words)

    def train_models(self, training_data: Dict):
        """
        持续学习和模型更新
        
        Args:
            training_data (Dict): 包含训练数据
                {
                    'spam_texts': List[str],
                    'non_spam_texts': List[str],
                    'conversation_samples': List[Dict]
                }
        """
        # TODO: 实现模型增量学习机制
        pass

    async def detect_conversation_anomalies(
        self, 
        conversations: List[Dict]
    ) -> Dict:
        """
        检测对话异常模式
        
        Args:
            conversations (List[Dict]): 对话记录
        
        Returns:
            Dict: 异常检测结果
        """
        # 异常检测算法
        anomaly_scores = []
        
        for conversation in conversations:
            # 结合多个特征进行异常评分
            spam_risk = await self._assess_spam_risk([conversation['message_text']])
            emotional_analysis = await self._analyze_emotional_trend([conversation['message_text']])
            
            # 计算异常分数
            anomaly_score = (
                spam_risk.average_risk * 0.5 + 
                abs(emotional_analysis.trend_direction) * 0.3 +
                (1 - await self._perform_semantic_similarity_analysis([conversation['message_text']])) * 0.2
            )
            
            anomaly_scores.append({
                'conversation_id': conversation.get('id'),
                'anomaly_score': anomaly_score,
                'details': {
                    'spam_risk': spam_risk.average_risk,
                    'emotional_volatility': abs(emotional_analysis.trend_direction),
                    'semantic_consistency': 1 - anomaly_score
                }
            })
        
        return {
            'anomalies': anomaly_scores,
            'total_anomaly_score': np.mean([score['anomaly_score'] for score in anomaly_scores])
        }