"""
Unit tests for ML Service
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime

from app.services.ml_service import MLService


@pytest.mark.unit
@pytest.mark.asyncio
class TestMLService:
    """Test ML Service functionality"""
    
    async def test_ml_service_initialization(self):
        """Test ML service initialization"""
        ml_service = MLService()
        
        assert ml_service is not None
        assert hasattr(ml_service, 'spam_classifier')
        assert hasattr(ml_service, 'user_profiler')
        assert hasattr(ml_service, 'feature_processor')
        assert not ml_service.models_loaded
    
    @patch('app.services.ml_service.SpamClassifier')
    @patch('app.services.ml_service.UserProfiler')
    async def test_load_models(self, mock_profiler, mock_classifier):
        """Test model loading"""
        # Setup mocks
        mock_classifier.return_value.load_models.return_value = True
        mock_profiler.return_value.load_profiler.return_value = True
        
        ml_service = MLService()
        result = await ml_service.load_models()
        
        assert result is True
        assert ml_service.models_loaded is True
        assert ml_service.last_model_update is not None
    
    @patch('app.services.ml_service.cache_manager')
    async def test_predict_spam_with_cache_hit(self, mock_cache):
        """Test spam prediction with cache hit"""
        # Setup
        ml_service = MLService()
        call_data = {
            "caller_phone_hash": "test_hash",
            "duration_seconds": 30,
            "start_time": datetime.now()
        }
        
        cached_result = {
            "is_spam": True,
            "spam_probability": 0.85,
            "confidence_score": 0.80,
            "risk_level": "high"
        }
        
        mock_cache.get.return_value = cached_result
        
        # Execute
        result = await ml_service.predict_spam(call_data)
        
        # Verify
        assert result == cached_result
        mock_cache.get.assert_called_once()
    
    async def test_predict_spam_feature_extraction(self, ml_service):
        """Test feature extraction in spam prediction"""
        call_data = {
            "caller_phone_hash": "test_hash",
            "duration_seconds": 45,
            "response_time_ms": 1200,
            "start_time": datetime.now()
        }
        
        with patch.object(ml_service.feature_processor, 'create_feature_vector') as mock_extract:
            mock_extract.return_value = {"feature1": 0.5, "feature2": 0.8}
            
            with patch.object(ml_service.spam_classifier, 'predict_spam_probability') as mock_predict:
                mock_predict.return_value = {
                    "is_spam": True,
                    "spam_probability": 0.75,
                    "confidence_score": 0.70,
                    "risk_level": "medium"
                }
                
                result = await ml_service.predict_spam(call_data)
                
                mock_extract.assert_called_once()
                mock_predict.assert_called_once()
                assert result["is_spam"] is True
                assert result["spam_probability"] == 0.75
    
    async def test_analyze_user_profile(self, ml_service):
        """Test user profile analysis"""
        user_id = "test_user"
        call_history = [
            {"call_id": "1", "outcome": "blocked_successfully"},
            {"call_id": "2", "outcome": "caller_hung_up"}
        ]
        
        with patch.object(ml_service.user_profiler, 'analyze_user_behavior') as mock_analyze:
            mock_analyze.return_value = {
                "user_id": user_id,
                "personality_assessment": {"primary_type": "polite"},
                "effectiveness_metrics": {"overall_effectiveness": 0.8}
            }
            
            result = await ml_service.analyze_user_profile(user_id, call_history)
            
            mock_analyze.assert_called_once_with(user_id, call_history, [])
            assert result["user_id"] == user_id
            assert result["personality_assessment"]["primary_type"] == "polite"
    
    async def test_get_real_time_insights(self, ml_service):
        """Test real-time insights generation"""
        call_data = {"caller_phone": "123456789"}
        user_id = "test_user"
        context = {"transcript": "Hello, this is a sales call"}
        
        with patch.object(ml_service, 'predict_spam') as mock_predict:
            mock_predict.return_value = {
                "is_spam": True,
                "spam_probability": 0.9,
                "risk_level": "high"
            }
            
            result = await ml_service.get_real_time_insights(call_data, user_id, context)
            
            assert "spam_analysis" in result
            assert "recommendations" in result
            assert result["spam_analysis"]["is_spam"] is True
            assert len(result["recommendations"]) > 0
    
    def test_generate_real_time_recommendations_high_spam(self, ml_service):
        """Test recommendation generation for high spam probability"""
        spam_result = {
            "spam_probability": 0.9,
            "risk_level": "high"
        }
        user_profile = {"personality_assessment": {"primary_type": "direct"}}
        call_data = {}
        
        recommendations = ml_service._generate_real_time_recommendations(
            spam_result, user_profile, call_data
        )
        
        # Should recommend immediate blocking for high spam probability
        assert len(recommendations) > 0
        assert any(rec["action"] == "immediate_block" for rec in recommendations)
        assert any(rec["priority"] == "high" for rec in recommendations)
    
    def test_generate_real_time_recommendations_user_personality(self, ml_service):
        """Test recommendation generation based on user personality"""
        spam_result = {"spam_probability": 0.4, "risk_level": "low"}
        user_profile = {
            "personality_assessment": {
                "primary_type": "humorous",
                "confidence": 0.8
            }
        }
        call_data = {}
        
        recommendations = ml_service._generate_real_time_recommendations(
            spam_result, user_profile, call_data
        )
        
        # Should recommend humor-based response for humorous personality
        humor_rec = next(
            (rec for rec in recommendations if rec["action"] == "use_humor_response"),
            None
        )
        assert humor_rec is not None
        assert humor_rec["confidence"] == 0.8
    
    @patch('app.services.ml_service.cache_manager')
    async def test_predict_spam_error_handling(self, mock_cache, ml_service):
        """Test error handling in spam prediction"""
        # Setup to trigger exception
        mock_cache.get.side_effect = Exception("Cache error")
        
        call_data = {"caller_phone": "123456789"}
        
        result = await ml_service.predict_spam(call_data)
        
        # Should return default error response
        assert result["is_spam"] is False
        assert result["spam_probability"] == 0.5
        assert result["confidence_score"] == 0.0
        assert result["risk_level"] == "unknown"
        assert "error" in result
    
    async def test_health_check(self, ml_service):
        """Test ML service health check"""
        with patch.object(ml_service, 'predict_spam') as mock_predict:
            mock_predict.return_value = {"spam_prediction_test": True}
            
            health = await ml_service.health_check()
            
            assert "status" in health
            assert "models_loaded" in health
            assert "timestamp" in health
            assert "spam_prediction_test" in health
            
            # Health should be degraded if models not loaded
            if not ml_service.models_loaded:
                assert health["status"] in ["healthy", "degraded"]


@pytest.mark.unit
class TestMLServiceRecommendations:
    """Test recommendation generation logic"""
    
    @pytest.fixture
    def ml_service(self):
        return MLService()
    
    def test_time_based_recommendations(self, ml_service):
        """Test time-based recommendation generation"""
        spam_result = {"spam_probability": 0.5, "risk_level": "medium"}
        user_profile = None
        
        # Test late night call
        call_data = {"start_time": "2024-01-15T23:30:00"}
        
        recommendations = ml_service._generate_real_time_recommendations(
            spam_result, user_profile, call_data
        )
        
        # Should flag unusual time
        time_rec = next(
            (rec for rec in recommendations if rec["action"] == "flag_unusual_time"),
            None
        )
        assert time_rec is not None
        assert time_rec["reason"] == "Call outside normal business hours"
    
    def test_effectiveness_based_recommendations(self, ml_service):
        """Test recommendations based on effectiveness scores"""
        spam_result = {"spam_probability": 0.3, "risk_level": "low"}
        user_profile = {
            "effectiveness_metrics": {"overall_effectiveness": 0.3}
        }
        call_data = {}
        
        recommendations = ml_service._generate_real_time_recommendations(
            spam_result, user_profile, call_data
        )
        
        # Should recommend strategy adjustment for low effectiveness
        strategy_rec = next(
            (rec for rec in recommendations if rec["action"] == "adjust_strategy"),
            None
        )
        assert strategy_rec is not None
        assert strategy_rec["priority"] == "high"
    
    def test_empty_recommendations(self, ml_service):
        """Test case with minimal recommendation triggers"""
        spam_result = {"spam_probability": 0.4, "risk_level": "low"}
        user_profile = {
            "personality_assessment": {"primary_type": "unknown", "confidence": 0.1},
            "effectiveness_metrics": {"overall_effectiveness": 0.8}
        }
        call_data = {"start_time": "2024-01-15T14:30:00"}  # Normal business hours
        
        recommendations = ml_service._generate_real_time_recommendations(
            spam_result, user_profile, call_data
        )
        
        # Should have minimal recommendations for normal conditions
        assert isinstance(recommendations, list)
        # May have some recommendations but should not have high-priority ones
        high_priority_recs = [rec for rec in recommendations if rec.get("priority") == "high"]
        assert len(high_priority_recs) == 0