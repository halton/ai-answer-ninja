import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

from app.core.database import SessionLocal
from app.models.profile import (
    UserProfile, SpamProfile, UserSpamInteraction,
    SpamCategory, RiskLevel
)
from app.services.ml_service import MachineLearningService
from app.services.cache_service import CacheService

class ProfileAnalyticsService:
    """用户画像分析服务"""
    
    def __init__(self, ml_service: MachineLearningService, cache_service: CacheService):
        self.ml_service = ml_service
        self.cache_service = cache_service
    
    def create_or_update_user_profile(
        self, 
        user_id: uuid.UUID, 
        profile_data: Dict[str, Any]
    ) -> UserProfile:
        """创建或更新用户画像"""
        with SessionLocal() as session:
            existing_profile = session.query(UserProfile).filter_by(user_id=user_id).first()
            
            if existing_profile:
                # 更新现有画像
                for key, value in profile_data.items():
                    setattr(existing_profile, key, value)
                existing_profile.updated_at = datetime.utcnow()
            else:
                # 创建新画像
                existing_profile = UserProfile(user_id=user_id, **profile_data)
                session.add(existing_profile)
            
            session.commit()
            session.refresh(existing_profile)
            return existing_profile
    
    def analyze_spam_interactions(
        self, 
        user_id: uuid.UUID, 
        time_range_days: int = 30
    ) -> Dict[str, Any]:
        """分析用户的骚扰电话交互"""
        cutoff_date = datetime.utcnow() - timedelta(days=time_range_days)
        
        with SessionLocal() as session:
            # 获取指定时间范围内的骚扰电话交互
            interactions = (
                session.query(UserSpamInteraction)
                .filter(
                    UserSpamInteraction.user_id == user_id,
                    UserSpamInteraction.last_interaction >= cutoff_date
                )
                .all()
            )
            
            # 聚合分析
            analytics = {
                "total_interactions": len(interactions),
                "spam_categories": {},
                "effectiveness_score": 0.0
            }
            
            for interaction in interactions:
                spam_profile = interaction.spam_profile
                category = spam_profile.spam_category
                
                analytics["spam_categories"][category] = (
                    analytics["spam_categories"].get(category, 0) + 1
                )
                analytics["effectiveness_score"] += interaction.effectiveness_score or 0.0
            
            # 计算平均有效性分数
            if interactions:
                analytics["effectiveness_score"] /= len(interactions)
            
            return analytics
    
    def predict_spam_risk(
        self, 
        phone_number: str, 
        time_range_days: int = 30
    ) -> Dict[str, Any]:
        """预测给定电话号码的骚扰风险"""
        phone_hash = self._hash_phone(phone_number)
        
        # 优先使用缓存
        cached_prediction = self.cache_service.get(f"spam_risk_{phone_hash}")
        if cached_prediction:
            return cached_prediction
        
        with SessionLocal() as session:
            spam_profile = (
                session.query(SpamProfile)
                .filter_by(phone_hash=phone_hash)
                .first()
            )
            
            if not spam_profile:
                # 如果没有历史记录，使用ML模型预测
                prediction = self.ml_service.predict_spam_risk(phone_number)
                spam_profile = SpamProfile(
                    phone_hash=phone_hash,
                    spam_category=prediction['category'],
                    risk_score=prediction['risk_score'],
                    feature_vector=prediction['feature_vector']
                )
                session.add(spam_profile)
                session.commit()
            
            # 确定风险等级
            risk_level = self._get_risk_level(spam_profile.risk_score)
            
            result = {
                "phone_hash": phone_hash,
                "spam_category": spam_profile.spam_category,
                "risk_score": spam_profile.risk_score,
                "risk_level": risk_level,
                "total_reports": spam_profile.total_reports,
                "last_activity": spam_profile.last_activity
            }
            
            # 缓存结果
            self.cache_service.set(
                f"spam_risk_{phone_hash}", 
                result, 
                expire_seconds=3600  # 1小时
            )
            
            return result
    
    def _get_risk_level(self, risk_score: float) -> RiskLevel:
        """根据风险分数确定风险等级"""
        if risk_score < 0.2:
            return RiskLevel.LOW
        elif risk_score < 0.5:
            return RiskLevel.MEDIUM
        elif risk_score < 0.8:
            return RiskLevel.HIGH
        else:
            return RiskLevel.CRITICAL
    
    def _hash_phone(self, phone: str) -> str:
        """安全哈希电话号码"""
        import hashlib
        return hashlib.sha256(phone.encode()).hexdigest()[:64]
    
    def generate_user_recommendations(
        self, 
        user_id: uuid.UUID
    ) -> List[Dict[str, Any]]:
        """基于用户画像生成个性化推荐"""
        with SessionLocal() as session:
            user_profile = session.query(UserProfile).filter_by(id=user_id).first()
            
            if not user_profile:
                return []
            
            recommendations = []
            
            # 根据个性化类型推荐应对策略
            if user_profile.personality_type == "polite":
                recommendations.append({
                    "type": "response_strategy",
                    "description": "使用礼貌但坚定的语气拒绝骚扰电话",
                    "confidence": 0.8
                })
            elif user_profile.personality_type == "direct":
                recommendations.append({
                    "type": "response_strategy", 
                    "description": "直接明确地表达不感兴趣，迅速结束通话",
                    "confidence": 0.9
                })
            
            # 根据白名单和通话模式推荐
            recommendations.append({
                "type": "whitelist_suggestion",
                "description": "建议根据通话历史优化白名单策略",
                "confidence": 0.7
            })
            
            return recommendations