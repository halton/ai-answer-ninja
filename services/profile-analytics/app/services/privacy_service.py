import uuid
import hashlib
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

from app.core.database import SessionLocal
from app.models.profile import UserProfile, SpamProfile

class PrivacyProtectionService:
    """隐私保护和数据管理服务"""
    
    @staticmethod
    def hash_sensitive_data(data: str, salt: str = 'ai-answer-ninja') -> str:
        """安全哈希敏感数据"""
        return hashlib.sha256(f"{data}{salt}".encode()).hexdigest()
    
    @classmethod
    def anonymize_profile(cls, profile: Dict[str, Any]) -> Dict[str, Any]:
        """匿名化用户画像数据"""
        anonymized = profile.copy()
        
        # 移除直接个人标识信息
        anonymized['user_id'] = cls.hash_sensitive_data(str(profile.get('user_id', '')))
        
        # 处理通信偏好
        anonymized['communication_preferences'] = cls._anonymize_preferences(
            profile.get('communication_preferences', {})
        )
        
        # 处理通话历史
        anonymized['spam_interaction_history'] = cls._anonymize_interactions(
            profile.get('spam_interaction_history', [])
        )
        
        return anonymized
    
    @staticmethod
    def _anonymize_preferences(preferences: Dict[str, Any]) -> Dict[str, Any]:
        """匿名化通信偏好"""
        safe_preferences = preferences.copy()
        
        # 模糊处理具体偏好
        for key in ['name', 'contact_info', 'email']:
            safe_preferences.pop(key, None)
        
        return safe_preferences
    
    @staticmethod
    def _anonymize_interactions(interactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """匿名化交互历史"""
        anonymized_interactions = []
        
        for interaction in interactions:
            safe_interaction = interaction.copy()
            
            # 移除个人识别信息
            safe_interaction.pop('caller_phone', None)
            safe_interaction.pop('caller_name', None)
            
            # 时间模糊处理
            if 'timestamp' in safe_interaction:
                safe_interaction['timestamp'] = (
                    safe_interaction['timestamp'].replace(day=1, hour=0, minute=0)
                )
            
            anonymized_interactions.append(safe_interaction)
        
        return anonymized_interactions
    
    def enforce_retention_policy(self, user_id: uuid.UUID, retention_days: int = 90):
        """执行数据保留策略"""
        cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
        
        with SessionLocal() as session:
            # 获取用户偏好的保留天数
            user_profile = session.query(UserProfile).filter_by(id=user_id).first()
            if user_profile and user_profile.retention_preference:
                retention_days = user_profile.retention_preference
            
            # 删除过期的通话记录和交互
            delete_result = {
                'spam_profiles_deleted': 0,
                'user_interactions_deleted': 0
            }
            
            # 删除过期的骚扰配置文件
            del_spam_profiles = (
                session.query(SpamProfile)
                .filter(SpamProfile.last_activity < cutoff_date)
                .delete(synchronize_session=False)
            )
            delete_result['spam_profiles_deleted'] = del_spam_profiles
            
            session.commit()
            return delete_result
    
    def user_data_export(self, user_id: uuid.UUID) -> Dict[str, Any]:
        """导出用户数据，遵循GDPR要求"""
        with SessionLocal() as session:
            user_profile = session.query(UserProfile).filter_by(id=user_id).first()
            
            if not user_profile:
                return {
                    'user_id': str(user_id),
                    'error': 'User not found',
                    'exported_at': datetime.utcnow()
                }
            
            # 构建导出数据
            export_data = {
                'user_id': str(user_id),
                'profile': self.anonymize_profile(user_profile.to_dict()),
                'spam_interactions': (
                    session.query(SpamProfile)
                    .join(UserSpamInteraction, SpamProfile.id == UserSpamInteraction.spam_profile_id)
                    .filter(UserSpamInteraction.user_id == user_id)
                    .all()
                ),
                'exported_at': datetime.utcnow(),
                'export_version': '1.0'
            }
            
            return export_data
    
    def request_data_deletion(self, user_id: uuid.UUID):
        """处理用户数据删除请求"""
        with SessionLocal() as session:
            try:
                # 查找并删除与用户相关的所有记录
                delete_result = {
                    'user_profiles_deleted': 0,
                    'spam_interactions_deleted': 0,
                    'feature_store_deleted': 0
                }
                
                # 删除用户配置文件
                del_profiles = (
                    session.query(UserProfile)
                    .filter_by(id=user_id)
                    .delete(synchronize_session=False)
                )
                delete_result['user_profiles_deleted'] = del_profiles
                
                # 删除相关交互数据
                del_interactions = (
                    session.query(UserSpamInteraction)
                    .filter_by(user_id=user_id)
                    .delete(synchronize_session=False)
                )
                delete_result['spam_interactions_deleted'] = del_interactions
                
                # 删除特征存储
                del_features = (
                    session.query(FeatureStore)
                    .filter_by(entity_id=str(user_id))
                    .delete(synchronize_session=False)
                )
                delete_result['feature_store_deleted'] = del_features
                
                session.commit()
                
                return {
                    'status': 'success',
                    'delete_result': delete_result,
                    'deleted_at': datetime.utcnow()
                }
                
            except Exception as e:
                session.rollback()
                return {
                    'status': 'error',
                    'error': str(e),
                    'deleted_at': datetime.utcnow()
                }