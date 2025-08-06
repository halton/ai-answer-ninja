"""
Analytics API endpoints
"""

import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_

from app.core.database import get_db_session
from app.core.cache import cache_manager
from app.core.logging import get_logger
from app.models.analytics import (
    AnalyticsRequest, AnalyticsResponse, AnalysisJobCreate, AnalysisJobResponse,
    UserAnalyticsResponse, RealTimeAnalyticsRequest, RealTimeAnalyticsResponse
)
from app.models.profile import ProfileAnalyticsRequest, ProfileAnalyticsResponse
from app.models.call_data import CallAnalysisRequest, CallAnalysisResponse
from app.services.ml_service import MLService

router = APIRouter()
logger = get_logger(__name__)


@router.post("/comprehensive", response_model=AnalyticsResponse)
async def get_comprehensive_analytics(
    request: AnalyticsRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Get comprehensive analytics for users and spam patterns"""
    
    try:
        # Check cache first
        cache_key = f"analytics:comprehensive:{hash(str(request.dict()))}"
        cached_result = await cache_manager.get(cache_key)
        
        if cached_result:
            logger.info("Returning cached comprehensive analytics")
            return cached_result
        
        analytics_data = {
            'user_analytics': [],
            'spam_analytics': {},
            'trend_analysis': {},
            'predictions': {},
            'recommendations': [],
            'insights': {},
            'generated_at': datetime.now()
        }
        
        # Get user analytics if user_id provided
        if request.user_id:
            user_analytics = await _get_user_analytics(
                request.user_id, 
                request.date_from, 
                request.date_to,
                db, 
                ml_service
            )
            analytics_data['user_analytics'] = [user_analytics] if user_analytics else []
        
        # Get spam analytics if phone numbers provided
        if request.phone_numbers:
            spam_analytics = await _get_spam_analytics(
                request.phone_numbers,
                request.date_from,
                request.date_to,
                db,
                ml_service
            )
            analytics_data['spam_analytics'] = spam_analytics
        
        # Generate trends and predictions if requested
        if request.include_predictions:
            predictions = await _generate_predictions(
                request.user_id,
                request.phone_numbers,
                ml_service
            )
            analytics_data['predictions'] = predictions
        
        if request.include_recommendations:
            recommendations = await _generate_recommendations(
                analytics_data['user_analytics'],
                analytics_data['spam_analytics'],
                ml_service
            )
            analytics_data['recommendations'] = recommendations
        
        # Generate insights summary
        analytics_data['insights'] = _generate_insights_summary(analytics_data)
        
        # Cache result for 10 minutes
        await cache_manager.set(cache_key, analytics_data, ttl=600)
        
        # Schedule background analysis update if needed
        if request.user_id:
            background_tasks.add_task(
                _update_user_analytics_background,
                request.user_id,
                db,
                ml_service
            )
        
        return AnalyticsResponse(**analytics_data)
        
    except Exception as e:
        logger.error(f"Error getting comprehensive analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/real-time", response_model=RealTimeAnalyticsResponse)
async def get_real_time_analytics(
    request: RealTimeAnalyticsRequest,
    ml_service: MLService = Depends(lambda: MLService())
):
    """Get real-time analytics for active call"""
    
    try:
        start_time = datetime.now()
        
        # Get real-time insights
        insights = await ml_service.get_real_time_insights(
            request.call_data,
            request.user_id,
            {
                'analysis_depth': request.analysis_depth,
                'return_predictions': request.return_predictions
            }
        )
        
        processing_time = (datetime.now() - start_time).total_seconds() * 1000
        
        spam_analysis = insights.get('spam_analysis', {})
        recommendations = insights.get('recommendations', [])
        
        response = RealTimeAnalyticsResponse(
            spam_probability=spam_analysis.get('spam_probability', 0.5),
            spam_category=spam_analysis.get('spam_category'),
            risk_level=spam_analysis.get('risk_level', 'unknown'),
            confidence_score=spam_analysis.get('confidence_score', 0.0),
            behavioral_insights=insights.get('user_context', {}),
            recommended_actions=recommendations,
            processing_time_ms=processing_time
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error getting real-time analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trends/{trend_type}")
async def get_trend_analysis(
    trend_type: str,
    period: str = Query("daily", regex="^(hourly|daily|weekly|monthly)$"),
    days_back: int = Query(30, ge=1, le=365),
    user_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """Get trend analysis for specific metrics"""
    
    try:
        cache_key = f"trends:{trend_type}:{period}:{days_back}:{user_id or 'all'}"
        cached_result = await cache_manager.get(cache_key)
        
        if cached_result:
            return cached_result
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        trends = await _calculate_trends(
            trend_type, period, start_date, end_date, user_id, db
        )
        
        # Cache for 1 hour
        await cache_manager.set(cache_key, trends, ttl=3600)
        
        return trends
        
    except Exception as e:
        logger.error(f"Error getting trend analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profile", response_model=ProfileAnalyticsResponse)
async def analyze_profile(
    request: ProfileAnalyticsRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Analyze user or spam profiles"""
    
    try:
        cache_key = f"profile_analysis:{hash(str(request.dict()))}"
        cached_result = await cache_manager.get(cache_key)
        
        if cached_result:
            return cached_result
        
        response_data = {
            'user_profile': None,
            'spam_profiles': [],
            'analytics': {},
            'predictions': None,
            'recommendations': None,
            'generated_at': datetime.now()
        }
        
        # Analyze user profile
        if request.user_id:
            user_profile = await _analyze_user_profile(
                request.user_id,
                request.time_range_days,
                db,
                ml_service
            )
            response_data['user_profile'] = user_profile
        
        # Analyze spam profiles
        if request.phone_numbers:
            spam_profiles = await _analyze_spam_profiles(
                request.phone_numbers,
                request.time_range_days,
                db,
                ml_service
            )
            response_data['spam_profiles'] = spam_profiles
        
        # Generate analytics summary
        response_data['analytics'] = await _generate_profile_analytics(
            response_data['user_profile'],
            response_data['spam_profiles']
        )
        
        # Generate predictions if requested
        if request.include_predictions:
            predictions = await _generate_profile_predictions(
                response_data['user_profile'],
                response_data['spam_profiles'],
                ml_service
            )
            response_data['predictions'] = predictions
        
        # Generate recommendations if requested
        if request.include_recommendations:
            recommendations = await _generate_profile_recommendations(
                response_data['user_profile'],
                response_data['spam_profiles']
            )
            response_data['recommendations'] = recommendations
        
        # Cache for 15 minutes
        await cache_manager.set(cache_key, response_data, ttl=900)
        
        # Background task to update profile if needed
        if request.user_id:
            background_tasks.add_task(
                _update_profile_background,
                request.user_id,
                db,
                ml_service
            )
        
        return ProfileAnalyticsResponse(**response_data)
        
    except Exception as e:
        logger.error(f"Error analyzing profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/call-analysis", response_model=CallAnalysisResponse)
async def analyze_call(
    request: CallAnalysisRequest,
    ml_service: MLService = Depends(lambda: MLService())
):
    """Analyze individual call data"""
    
    try:
        # This would involve detailed call analysis
        # For now, return a basic structure
        
        analysis_summary = {
            'call_id': request.call_id,
            'analysis_types_performed': request.analysis_types,
            'spam_likelihood': 0.5,  # Placeholder
            'conversation_quality': 0.7,  # Placeholder
            'recommendations_count': 0
        }
        
        response = CallAnalysisResponse(
            call_data=None,  # Would be populated with actual call data
            conversation_analysis=None,
            patterns=[],
            ml_insights={},
            recommendations=[],
            analysis_summary=analysis_summary
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error analyzing call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/feature-importance")
async def get_feature_importance(
    model_type: str = Query("spam_classifier"),
    top_k: int = Query(20, ge=5, le=100),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Get feature importance from ML models"""
    
    try:
        if model_type == "spam_classifier":
            importance = await ml_service.get_feature_importance(top_k)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown model type: {model_type}")
        
        return {
            'model_type': model_type,
            'feature_importance': importance,
            'top_k': top_k,
            'generated_at': datetime.now()
        }
        
    except Exception as e:
        logger.error(f"Error getting feature importance: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/performance-metrics")
async def get_performance_metrics(
    ml_service: MLService = Depends(lambda: MLService())
):
    """Get ML model performance metrics"""
    
    try:
        performance = await ml_service.get_model_performance()
        return performance
        
    except Exception as e:
        logger.error(f"Error getting performance metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Helper functions

async def _get_user_analytics(
    user_id: uuid.UUID,
    date_from: Optional[datetime],
    date_to: datetime,
    db: AsyncSession,
    ml_service: MLService
) -> Optional[UserAnalyticsResponse]:
    """Get analytics for a specific user"""
    
    # This would query the database for user analytics
    # Placeholder implementation
    return None


async def _get_spam_analytics(
    phone_numbers: List[str],
    date_from: Optional[datetime],
    date_to: datetime,
    db: AsyncSession,
    ml_service: MLService
) -> Dict[str, Any]:
    """Get spam analytics for phone numbers"""
    
    # Placeholder implementation
    return {}


async def _generate_predictions(
    user_id: Optional[uuid.UUID],
    phone_numbers: Optional[List[str]],
    ml_service: MLService
) -> Dict[str, Any]:
    """Generate predictions"""
    
    # Placeholder implementation
    return {}


async def _generate_recommendations(
    user_analytics: List[UserAnalyticsResponse],
    spam_analytics: Dict[str, Any],
    ml_service: MLService
) -> List[Dict[str, Any]]:
    """Generate recommendations"""
    
    # Placeholder implementation
    return []


def _generate_insights_summary(analytics_data: Dict[str, Any]) -> Dict[str, Any]:
    """Generate insights summary"""
    
    return {
        'data_points_analyzed': len(analytics_data.get('user_analytics', [])),
        'spam_patterns_detected': len(analytics_data.get('spam_analytics', {})),
        'key_findings': ['Placeholder finding 1', 'Placeholder finding 2'],
        'confidence_score': 0.75
    }


async def _calculate_trends(
    trend_type: str,
    period: str,
    start_date: datetime,
    end_date: datetime,
    user_id: Optional[uuid.UUID],
    db: AsyncSession
) -> Dict[str, Any]:
    """Calculate trends for specified parameters"""
    
    # Placeholder implementation
    return {
        'trend_type': trend_type,
        'period': period,
        'data_points': [],
        'trend_direction': 'stable',
        'change_percentage': 0.0,
        'calculated_at': datetime.now()
    }


async def _analyze_user_profile(
    user_id: uuid.UUID,
    time_range_days: int,
    db: AsyncSession,
    ml_service: MLService
) -> Optional[Dict[str, Any]]:
    """Analyze user profile"""
    
    # Placeholder implementation
    return None


async def _analyze_spam_profiles(
    phone_numbers: List[str],
    time_range_days: int,
    db: AsyncSession,
    ml_service: MLService
) -> List[Dict[str, Any]]:
    """Analyze spam profiles"""
    
    # Placeholder implementation
    return []


async def _generate_profile_analytics(
    user_profile: Optional[Dict[str, Any]],
    spam_profiles: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Generate profile analytics"""
    
    return {
        'profiles_analyzed': (1 if user_profile else 0) + len(spam_profiles),
        'analysis_completeness': 0.8,
        'data_quality_score': 0.85
    }


async def _generate_profile_predictions(
    user_profile: Optional[Dict[str, Any]],
    spam_profiles: List[Dict[str, Any]],
    ml_service: MLService
) -> Dict[str, Any]:
    """Generate profile predictions"""
    
    return {
        'future_spam_likelihood': 0.3,
        'behavior_change_probability': 0.1,
        'prediction_confidence': 0.7
    }


async def _generate_profile_recommendations(
    user_profile: Optional[Dict[str, Any]],
    spam_profiles: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Generate profile recommendations"""
    
    return [
        {
            'type': 'strategy_adjustment',
            'description': 'Consider adjusting response strategy based on user profile',
            'priority': 'medium',
            'confidence': 0.75
        }
    ]


async def _update_user_analytics_background(
    user_id: uuid.UUID,
    db: AsyncSession,
    ml_service: MLService
):
    """Background task to update user analytics"""
    
    try:
        logger.info(f"Updating analytics for user {user_id}")
        # Implementation would update user analytics in the background
        
    except Exception as e:
        logger.error(f"Error updating user analytics: {e}")


async def _update_profile_background(
    user_id: uuid.UUID,
    db: AsyncSession,
    ml_service: MLService
):
    """Background task to update profile"""
    
    try:
        logger.info(f"Updating profile for user {user_id}")
        # Implementation would update user profile in the background
        
    except Exception as e:
        logger.error(f"Error updating profile: {e}")