"""
Machine learning service integration
"""

import asyncio
from datetime import datetime
from typing import Dict, List, Any, Optional
from pathlib import Path

from app.core.logging import LoggingMixin
from app.core.cache import cache_manager
from app.core.config import get_settings
from ml.models.spam_classifier import SpamClassifier
from ml.models.user_profiler import UserProfiler
from ml.features.feature_extractor import FeatureProcessor
from ml.features.data_preprocessor import DataPipeline


class MLService(LoggingMixin):
    """Central ML service for spam detection and user profiling"""
    
    def __init__(self):
        super().__init__()
        self.settings = get_settings()
        
        # Initialize ML models
        self.spam_classifier = SpamClassifier(self.settings.ml_model_path)
        self.user_profiler = UserProfiler(self.settings.ml_model_path)
        self.feature_processor = FeatureProcessor()
        self.data_pipeline = DataPipeline()
        
        # Model status
        self.models_loaded = False
        self.last_model_update = None
        
        # Feature importance cache
        self._feature_importance_cache = {}
        
    async def load_models(self) -> bool:
        """Load all ML models"""
        
        try:
            # Load spam classifier
            spam_loaded = await asyncio.get_event_loop().run_in_executor(
                None, self.spam_classifier.load_models
            )
            
            # Load user profiler
            profiler_loaded = await asyncio.get_event_loop().run_in_executor(
                None, self.user_profiler.load_profiler
            )
            
            self.models_loaded = spam_loaded or profiler_loaded
            
            if self.models_loaded:
                self.last_model_update = datetime.now()
                self.logger.info("ML models loaded successfully")
            else:
                self.logger.warning("No pre-trained models found - models will be trained on first use")
            
            return self.models_loaded
            
        except Exception as e:
            self.logger.error(f"Error loading ML models: {e}")
            return False
    
    async def predict_spam(
        self,
        call_data: Dict[str, Any],
        call_history: List[Dict[str, Any]] = None,
        transcript: str = None
    ) -> Dict[str, Any]:
        """Predict if a call is spam"""
        
        try:
            # Check cache first
            cache_key = f"spam_prediction:{hash(str(call_data))}"
            cached_result = await cache_manager.get(cache_key)
            
            if cached_result:
                self.logger.debug("Returning cached spam prediction")
                return cached_result
            
            # Extract features
            features = self.feature_processor.create_feature_vector(
                call_data, call_history, transcript
            )
            
            # Get feature names (this should match training feature order)
            feature_names = list(features.keys())
            
            # Make prediction
            prediction_result = await asyncio.get_event_loop().run_in_executor(
                None,
                self.spam_classifier.predict_spam_probability,
                features,
                feature_names
            )
            
            # Enhance with additional context
            prediction_result.update({
                'feature_count': len(features),
                'has_transcript': bool(transcript),
                'has_history': bool(call_history),
                'processing_version': '1.0'
            })
            
            # Cache result
            await cache_manager.set(cache_key, prediction_result, ttl=300)  # 5 minutes
            
            return prediction_result
            
        except Exception as e:
            self.logger.error(f"Error predicting spam: {e}")
            return {
                'is_spam': False,
                'spam_probability': 0.5,
                'confidence_score': 0.0,
                'risk_level': 'unknown',
                'error': str(e),
                'timestamp': datetime.now()
            }
    
    async def analyze_user_profile(
        self,
        user_id: str,
        call_history: List[Dict[str, Any]],
        response_history: List[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze user behavior and create profile"""
        
        try:
            # Check cache
            cache_key = f"user_profile:{user_id}:{len(call_history)}"
            cached_result = await cache_manager.get(cache_key)
            
            if cached_result:
                self.logger.debug(f"Returning cached user profile for {user_id}")
                return cached_result
            
            # Analyze user behavior
            analysis_result = await asyncio.get_event_loop().run_in_executor(
                None,
                self.user_profiler.analyze_user_behavior,
                user_id,
                call_history,
                response_history or []
            )
            
            # Cache result
            await cache_manager.set(cache_key, analysis_result, ttl=1800)  # 30 minutes
            
            return analysis_result
            
        except Exception as e:
            self.logger.error(f"Error analyzing user profile: {e}")
            return {
                'user_id': user_id,
                'error': str(e),
                'analysis_date': datetime.now()
            }
    
    async def get_real_time_insights(
        self,
        call_data: Dict[str, Any],
        user_id: str,
        context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Get real-time insights for ongoing call"""
        
        try:
            # Run spam prediction and user context in parallel
            spam_prediction_task = self.predict_spam(
                call_data,
                context.get('call_history', []) if context else [],
                context.get('transcript') if context else None
            )
            
            # Get user profile context
            profile_cache_key = f"user_profile:{user_id}"
            user_profile = await cache_manager.get(profile_cache_key)
            
            # Wait for spam prediction
            spam_result = await spam_prediction_task
            
            # Generate recommendations based on spam probability and user profile
            recommendations = self._generate_real_time_recommendations(
                spam_result, user_profile, call_data
            )
            
            return {
                'spam_analysis': spam_result,
                'user_context': user_profile or {},
                'recommendations': recommendations,
                'processing_time_ms': (datetime.now() - datetime.now()).total_seconds() * 1000,
                'generated_at': datetime.now()
            }
            
        except Exception as e:
            self.logger.error(f"Error generating real-time insights: {e}")
            return {
                'error': str(e),
                'generated_at': datetime.now()
            }
    
    def _generate_real_time_recommendations(
        self,
        spam_result: Dict[str, Any],
        user_profile: Optional[Dict[str, Any]],
        call_data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Generate real-time recommendations for call handling"""
        
        recommendations = []
        
        spam_probability = spam_result.get('spam_probability', 0.5)
        risk_level = spam_result.get('risk_level', 'unknown')
        
        # High spam probability recommendations
        if spam_probability > 0.8:
            recommendations.append({
                'action': 'immediate_block',
                'confidence': spam_probability,
                'reason': 'High spam probability detected',
                'priority': 'high'
            })
        elif spam_probability > 0.6:
            recommendations.append({
                'action': 'enhanced_screening',
                'confidence': spam_probability,
                'reason': 'Moderate spam probability - additional screening recommended',
                'priority': 'medium'
            })
        
        # User profile based recommendations
        if user_profile:
            personality = user_profile.get('personality_assessment', {})
            primary_type = personality.get('primary_type', 'polite')
            
            if primary_type == 'direct':
                recommendations.append({
                    'action': 'use_direct_response',
                    'confidence': personality.get('confidence', 0.5),
                    'reason': 'User prefers direct communication style',
                    'priority': 'medium'
                })
            elif primary_type == 'humorous':
                recommendations.append({
                    'action': 'use_humor_response',
                    'confidence': personality.get('confidence', 0.5),
                    'reason': 'User responds well to humorous approaches',
                    'priority': 'low'
                })
            
            # Effectiveness-based recommendations
            effectiveness = user_profile.get('effectiveness_metrics', {})
            if effectiveness.get('overall_effectiveness', 0.5) < 0.4:
                recommendations.append({
                    'action': 'adjust_strategy',
                    'confidence': 0.7,
                    'reason': 'Current strategy showing low effectiveness',
                    'priority': 'high'
                })
        
        # Time-based recommendations
        call_time = call_data.get('start_time')
        if call_time:
            try:
                if isinstance(call_time, str):
                    call_time = datetime.fromisoformat(call_time.replace('Z', '+00:00'))
                
                if call_time.hour < 8 or call_time.hour > 20:
                    recommendations.append({
                        'action': 'flag_unusual_time',
                        'confidence': 0.8,
                        'reason': 'Call outside normal business hours',
                        'priority': 'medium'
                    })
            except (ValueError, AttributeError):
                pass
        
        return recommendations
    
    async def train_models(
        self,
        training_data: List[Dict[str, Any]],
        validation_split: float = 0.2
    ) -> Dict[str, Any]:
        """Train or retrain ML models"""
        
        try:
            self.logger.info("Starting model training")
            
            # Prepare data for spam classification
            spam_training_data = [
                record for record in training_data
                if 'is_spam' in record or 'call_type' in record
            ]
            
            training_results = {}
            
            if spam_training_data:
                # Preprocess data
                preprocessing_result = await asyncio.get_event_loop().run_in_executor(
                    None,
                    self.data_pipeline.preprocess_for_training,
                    spam_training_data,
                    'is_spam',  # target column
                    ['call_outcome', 'termination_reason'],  # categorical columns
                    ['duration_seconds', 'response_time_ms', 'spam_probability'],  # numeric columns
                    'start_time',  # timestamp column
                    validation_split
                )
                
                if 'error' not in preprocessing_result:
                    # Train spam classifier
                    spam_results = await asyncio.get_event_loop().run_in_executor(
                        None,
                        self.spam_classifier.train,
                        preprocessing_result['X_train'],
                        preprocessing_result['y_train'],
                        preprocessing_result['X_val'],
                        preprocessing_result['y_val']
                    )
                    
                    training_results['spam_classifier'] = spam_results
                    
                    # Evaluate model
                    evaluation = await asyncio.get_event_loop().run_in_executor(
                        None,
                        self.spam_classifier.evaluate,
                        preprocessing_result['X_test'],
                        preprocessing_result['y_test']
                    )
                    
                    training_results['spam_classifier']['evaluation'] = evaluation
            
            # Save models if training was successful
            if training_results:
                save_path = await asyncio.get_event_loop().run_in_executor(
                    None, self.spam_classifier.save_models
                )
                training_results['model_save_path'] = save_path
                self.last_model_update = datetime.now()
            
            self.logger.info("Model training completed")
            return training_results
            
        except Exception as e:
            self.logger.error(f"Error training models: {e}")
            return {'error': str(e)}
    
    async def get_model_performance(self) -> Dict[str, Any]:
        """Get current model performance metrics"""
        
        try:
            performance = {
                'spam_classifier': self.spam_classifier.model_performance,
                'feature_importance': await self.get_feature_importance(),
                'last_update': self.last_model_update,
                'models_loaded': self.models_loaded,
                'training_history_count': len(self.spam_classifier.training_history)
            }
            
            return performance
            
        except Exception as e:
            self.logger.error(f"Error getting model performance: {e}")
            return {'error': str(e)}
    
    async def get_feature_importance(self, top_k: int = 20) -> Dict[str, float]:
        """Get feature importance scores"""
        
        cache_key = f"feature_importance:{top_k}"
        cached_importance = await cache_manager.get(cache_key)
        
        if cached_importance:
            return cached_importance
        
        try:
            importance = await asyncio.get_event_loop().run_in_executor(
                None,
                self.spam_classifier.get_feature_importance,
                'ensemble',
                top_k
            )
            
            # Cache for 1 hour
            await cache_manager.set(cache_key, importance, ttl=3600)
            
            return importance
            
        except Exception as e:
            self.logger.error(f"Error getting feature importance: {e}")
            return {}
    
    async def update_models_if_needed(self) -> bool:
        """Check if models need updating and update if necessary"""
        
        try:
            # Check if enough time has passed since last update
            if (
                self.last_model_update and
                (datetime.now() - self.last_model_update).total_seconds() < 
                self.settings.ml_model_update_interval
            ):
                return False
            
            # Check model performance degradation
            # This is a simplified check - in practice, you'd compare against validation data
            current_performance = await self.get_model_performance()
            
            if 'error' in current_performance:
                return False
            
            # For now, return False unless explicitly triggered
            # In production, you'd implement more sophisticated update logic
            return False
            
        except Exception as e:
            self.logger.error(f"Error checking model update: {e}")
            return False
    
    async def cleanup_cache(self) -> None:
        """Clean up ML-related cache entries"""
        
        try:
            # This would typically involve more sophisticated cache cleanup
            # For now, we'll rely on TTL expiration
            self.logger.info("ML cache cleanup completed")
            
        except Exception as e:
            self.logger.error(f"Error cleaning up ML cache: {e}")
    
    async def health_check(self) -> Dict[str, Any]:
        """Check health of ML service"""
        
        health_status = {
            'status': 'healthy',
            'models_loaded': self.models_loaded,
            'last_model_update': self.last_model_update,
            'spam_classifier_ready': hasattr(self.spam_classifier, 'models') and bool(self.spam_classifier.models),
            'user_profiler_ready': hasattr(self.user_profiler, 'personality_profiles'),
            'feature_processor_ready': True,
            'timestamp': datetime.now()
        }
        
        # Check if critical components are working
        try:
            # Test spam prediction with dummy data
            test_call_data = {
                'duration_seconds': 30,
                'response_time_ms': 1000,
                'start_time': datetime.now(),
                'caller_phone_hash': 'test_hash'
            }
            
            test_result = await self.predict_spam(test_call_data)
            health_status['spam_prediction_test'] = 'error' not in test_result
            
        except Exception as e:
            health_status['spam_prediction_test'] = False
            health_status['test_error'] = str(e)
        
        # Overall health
        critical_checks = [
            health_status['spam_prediction_test'],
            health_status['feature_processor_ready']
        ]
        
        if not all(critical_checks):
            health_status['status'] = 'degraded'
        
        return health_status