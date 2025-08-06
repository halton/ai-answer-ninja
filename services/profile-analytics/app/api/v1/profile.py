"""
User Profile API endpoints
"""

import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.core.database import get_db_session
from app.core.cache import cache_manager
from app.core.logging import get_logger
from app.models.profile import (
    UserProfileCreate, UserProfileUpdate, UserProfileResponse,
    SpamProfileCreate, SpamProfileUpdate, SpamProfileResponse,
    UserProfile, SpamProfile, UserSpamInteraction
)
from app.services.ml_service import MLService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/{phone_hash}", response_model=SpamProfileResponse)
async def get_spam_profile(
    phone_hash: str,
    db: AsyncSession = Depends(get_db_session)
):
    """Get spam profile by phone hash"""
    
    try:
        # Check cache first
        cache_key = f"spam_profile:{phone_hash}"
        cached_profile = await cache_manager.get(cache_key)
        
        if cached_profile:
            return SpamProfileResponse(**cached_profile)
        
        # Query database
        query = select(SpamProfile).where(SpamProfile.phone_hash == phone_hash)
        result = await db.execute(query)
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="Spam profile not found")
        
        # Convert to response model
        profile_data = {
            'id': profile.id,
            'phone_hash': profile.phone_hash,
            'spam_category': profile.spam_category,
            'risk_score': profile.risk_score,
            'confidence_level': profile.confidence_level,
            'feature_vector': profile.feature_vector or {},
            'behavioral_patterns': profile.behavioral_patterns or {},
            'total_reports': profile.total_reports,
            'successful_blocks': profile.successful_blocks,
            'bypass_attempts': profile.bypass_attempts,
            'last_activity': profile.last_activity,
            'created_at': profile.created_at,
            'updated_at': profile.updated_at
        }
        
        # Cache for 30 minutes
        await cache_manager.set(cache_key, profile_data, ttl=1800)
        
        return SpamProfileResponse(**profile_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting spam profile {phone_hash}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spam", response_model=SpamProfileResponse)
async def create_spam_profile(
    profile_data: SpamProfileCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Create new spam profile"""
    
    try:
        # Check if profile already exists
        existing_query = select(SpamProfile).where(SpamProfile.phone_hash == profile_data.phone_hash)
        existing_result = await db.execute(existing_query)
        existing_profile = existing_result.scalar_one_or_none()
        
        if existing_profile:
            raise HTTPException(status_code=409, detail="Spam profile already exists")
        
        # Create new profile
        new_profile = SpamProfile(
            phone_hash=profile_data.phone_hash,
            spam_category=profile_data.spam_category,
            risk_score=profile_data.risk_score,
            confidence_level=profile_data.confidence_level,
            feature_vector=profile_data.feature_vector,
            behavioral_patterns=profile_data.behavioral_patterns,
            last_activity=datetime.now()
        )
        
        db.add(new_profile)
        await db.commit()
        await db.refresh(new_profile)
        
        # Create response
        response_data = {
            'id': new_profile.id,
            'phone_hash': new_profile.phone_hash,
            'spam_category': new_profile.spam_category,
            'risk_score': new_profile.risk_score,
            'confidence_level': new_profile.confidence_level,
            'feature_vector': new_profile.feature_vector or {},
            'behavioral_patterns': new_profile.behavioral_patterns or {},
            'total_reports': new_profile.total_reports,
            'successful_blocks': new_profile.successful_blocks,
            'bypass_attempts': new_profile.bypass_attempts,
            'last_activity': new_profile.last_activity,
            'created_at': new_profile.created_at,
            'updated_at': new_profile.updated_at
        }
        
        # Clear cache
        cache_key = f"spam_profile:{profile_data.phone_hash}"
        await cache_manager.delete(cache_key)
        
        # Background task to update ML models
        background_tasks.add_task(
            _update_spam_detection_model,
            new_profile.phone_hash,
            profile_data.dict(),
            ml_service
        )
        
        return SpamProfileResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating spam profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/spam/{phone_hash}", response_model=SpamProfileResponse)
async def update_spam_profile(
    phone_hash: str,
    update_data: SpamProfileUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Update existing spam profile"""
    
    try:
        # Get existing profile
        query = select(SpamProfile).where(SpamProfile.phone_hash == phone_hash)
        result = await db.execute(query)
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="Spam profile not found")
        
        # Update fields
        update_dict = update_data.dict(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(profile, field, value)
        
        profile.updated_at = datetime.now()
        profile.last_activity = datetime.now()
        
        await db.commit()
        await db.refresh(profile)
        
        # Create response
        response_data = {
            'id': profile.id,
            'phone_hash': profile.phone_hash,
            'spam_category': profile.spam_category,
            'risk_score': profile.risk_score,
            'confidence_level': profile.confidence_level,
            'feature_vector': profile.feature_vector or {},
            'behavioral_patterns': profile.behavioral_patterns or {},
            'total_reports': profile.total_reports,
            'successful_blocks': profile.successful_blocks,
            'bypass_attempts': profile.bypass_attempts,
            'last_activity': profile.last_activity,
            'created_at': profile.created_at,
            'updated_at': profile.updated_at
        }
        
        # Clear cache
        cache_key = f"spam_profile:{phone_hash}"
        await cache_manager.delete(cache_key)
        
        # Background task to update ML models
        background_tasks.add_task(
            _update_spam_detection_model,
            phone_hash,
            response_data,
            ml_service
        )
        
        return SpamProfileResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating spam profile {phone_hash}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/{user_id}", response_model=UserProfileResponse)
async def get_user_profile(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """Get user profile by ID"""
    
    try:
        # Check cache first
        cache_key = f"user_profile:{user_id}"
        cached_profile = await cache_manager.get(cache_key)
        
        if cached_profile:
            return UserProfileResponse(**cached_profile)
        
        # Query database
        query = select(UserProfile).where(UserProfile.user_id == user_id)
        result = await db.execute(query)
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="User profile not found")
        
        # Convert to response model
        profile_data = {
            'id': profile.id,
            'user_id': profile.user_id,
            'personality_type': profile.personality_type,
            'communication_style': profile.communication_style,
            'response_preferences': profile.response_preferences or {},
            'spam_tolerance': profile.spam_tolerance,
            'call_patterns': profile.call_patterns or {},
            'response_effectiveness': profile.response_effectiveness or {},
            'preferred_strategies': profile.preferred_strategies or [],
            'avoided_strategies': profile.avoided_strategies or [],
            'success_metrics': profile.success_metrics or {},
            'active_hours': profile.active_hours or {},
            'timezone': profile.timezone,
            'created_at': profile.created_at,
            'updated_at': profile.updated_at
        }
        
        # Cache for 30 minutes
        await cache_manager.set(cache_key, profile_data, ttl=1800)
        
        return UserProfileResponse(**profile_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user profile {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/user", response_model=UserProfileResponse)
async def create_user_profile(
    profile_data: UserProfileCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Create new user profile"""
    
    try:
        # Check if profile already exists
        existing_query = select(UserProfile).where(UserProfile.user_id == profile_data.user_id)
        existing_result = await db.execute(existing_query)
        existing_profile = existing_result.scalar_one_or_none()
        
        if existing_profile:
            raise HTTPException(status_code=409, detail="User profile already exists")
        
        # Create new profile
        new_profile = UserProfile(
            user_id=profile_data.user_id,
            personality_type=profile_data.personality_type,
            communication_style=profile_data.communication_style,
            response_preferences=profile_data.response_preferences,
            spam_tolerance=profile_data.spam_tolerance
        )
        
        db.add(new_profile)
        await db.commit()
        await db.refresh(new_profile)
        
        # Create response
        response_data = {
            'id': new_profile.id,
            'user_id': new_profile.user_id,
            'personality_type': new_profile.personality_type,
            'communication_style': new_profile.communication_style,
            'response_preferences': new_profile.response_preferences or {},
            'spam_tolerance': new_profile.spam_tolerance,
            'call_patterns': new_profile.call_patterns or {},
            'response_effectiveness': new_profile.response_effectiveness or {},
            'preferred_strategies': new_profile.preferred_strategies or [],
            'avoided_strategies': new_profile.avoided_strategies or [],
            'success_metrics': new_profile.success_metrics or {},
            'active_hours': new_profile.active_hours or {},
            'timezone': new_profile.timezone,
            'created_at': new_profile.created_at,
            'updated_at': new_profile.updated_at
        }
        
        # Clear cache
        cache_key = f"user_profile:{profile_data.user_id}"
        await cache_manager.delete(cache_key)
        
        # Background task to initialize user profiling
        background_tasks.add_task(
            _initialize_user_profiling,
            profile_data.user_id,
            ml_service
        )
        
        return UserProfileResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating user profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/user/{user_id}", response_model=UserProfileResponse)
async def update_user_profile(
    user_id: uuid.UUID,
    update_data: UserProfileUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Update existing user profile"""
    
    try:
        # Get existing profile
        query = select(UserProfile).where(UserProfile.user_id == user_id)
        result = await db.execute(query)
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="User profile not found")
        
        # Update fields
        update_dict = update_data.dict(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(profile, field, value)
        
        profile.updated_at = datetime.now()
        
        await db.commit()
        await db.refresh(profile)
        
        # Create response
        response_data = {
            'id': profile.id,
            'user_id': profile.user_id,
            'personality_type': profile.personality_type,
            'communication_style': profile.communication_style,
            'response_preferences': profile.response_preferences or {},
            'spam_tolerance': profile.spam_tolerance,
            'call_patterns': profile.call_patterns or {},
            'response_effectiveness': profile.response_effectiveness or {},
            'preferred_strategies': profile.preferred_strategies or [],
            'avoided_strategies': profile.avoided_strategies or [],
            'success_metrics': profile.success_metrics or {},
            'active_hours': profile.active_hours or {},
            'timezone': profile.timezone,
            'created_at': profile.created_at,
            'updated_at': profile.updated_at
        }
        
        # Clear cache
        cache_key = f"user_profile:{user_id}"
        await cache_manager.delete(cache_key)
        
        # Background task to update user profiling
        background_tasks.add_task(
            _update_user_profiling,
            user_id,
            response_data,
            ml_service
        )
        
        return UserProfileResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user profile {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/evaluate/{phone_hash}")
async def evaluate_spam_number(
    phone_hash: str,
    context: Optional[Dict[str, Any]] = None,
    ml_service: MLService = Depends(lambda: MLService()),
    db: AsyncSession = Depends(get_db_session)
):
    """Evaluate spam likelihood for a phone number"""
    
    try:
        # Check if we have existing profile
        profile_query = select(SpamProfile).where(SpamProfile.phone_hash == phone_hash)
        profile_result = await db.execute(profile_query)
        existing_profile = profile_result.scalar_one_or_none()
        
        if existing_profile:
            # Use existing profile data
            evaluation = {
                'phone_hash': phone_hash,
                'is_spam': existing_profile.risk_score > 0.7,
                'spam_probability': existing_profile.risk_score,
                'confidence_score': existing_profile.confidence_level,
                'spam_category': existing_profile.spam_category,
                'risk_level': _determine_risk_level(existing_profile.risk_score),
                'total_reports': existing_profile.total_reports,
                'last_activity': existing_profile.last_activity,
                'data_source': 'existing_profile'
            }
        else:
            # Use ML model for prediction
            call_data = context or {'phone_hash': phone_hash}
            prediction = await ml_service.predict_spam(call_data)
            
            evaluation = {
                'phone_hash': phone_hash,
                'is_spam': prediction.get('is_spam', False),
                'spam_probability': prediction.get('spam_probability', 0.5),
                'confidence_score': prediction.get('confidence_score', 0.0),
                'spam_category': prediction.get('spam_category'),
                'risk_level': prediction.get('risk_level', 'unknown'),
                'data_source': 'ml_prediction'
            }
        
        return evaluation
        
    except Exception as e:
        logger.error(f"Error evaluating spam number {phone_hash}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/learning")
async def update_profile_learning(
    learning_data: Dict[str, Any],
    background_tasks: BackgroundTasks,
    ml_service: MLService = Depends(lambda: MLService())
):
    """Update profile learning based on user feedback"""
    
    try:
        # Validate learning data
        required_fields = ['user_id', 'phone_hash', 'interaction_outcome', 'effectiveness_score']
        missing_fields = [field for field in required_fields if field not in learning_data]
        
        if missing_fields:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required fields: {missing_fields}"
            )
        
        # Schedule background learning update
        background_tasks.add_task(
            _process_learning_update,
            learning_data,
            ml_service
        )
        
        return {
            'status': 'learning_update_scheduled',
            'user_id': learning_data['user_id'],
            'phone_hash': learning_data['phone_hash'],
            'timestamp': datetime.now()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating profile learning: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clusters")
async def get_user_clusters(
    include_characteristics: bool = Query(True),
    min_cluster_size: int = Query(5, ge=1),
    ml_service: MLService = Depends(lambda: MLService()),
    db: AsyncSession = Depends(get_db_session)
):
    """Get user behavioral clusters"""
    
    try:
        # This would involve clustering users based on behavior
        # For now, return a placeholder response
        
        clusters = {
            'total_clusters': 5,
            'cluster_analysis': {
                'cluster_0': {
                    'size': 25,
                    'dominant_personality': 'polite',
                    'avg_effectiveness': 0.75,
                    'characteristics': ['patient', 'formal'] if include_characteristics else []
                },
                'cluster_1': {
                    'size': 18,
                    'dominant_personality': 'direct',
                    'avg_effectiveness': 0.82,
                    'characteristics': ['concise', 'decisive'] if include_characteristics else []
                }
            },
            'clustering_date': datetime.now(),
            'silhouette_score': 0.65
        }
        
        return clusters
        
    except Exception as e:
        logger.error(f"Error getting user clusters: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Helper functions

def _determine_risk_level(risk_score: float) -> str:
    """Determine risk level from risk score"""
    if risk_score < 0.3:
        return "low"
    elif risk_score < 0.7:
        return "medium"
    elif risk_score < 0.9:
        return "high"
    else:
        return "critical"


async def _update_spam_detection_model(
    phone_hash: str,
    profile_data: Dict[str, Any],
    ml_service: MLService
):
    """Background task to update spam detection model"""
    
    try:
        logger.info(f"Updating spam detection model with profile {phone_hash}")
        # Implementation would update ML model with new spam profile data
        
    except Exception as e:
        logger.error(f"Error updating spam detection model: {e}")


async def _initialize_user_profiling(
    user_id: uuid.UUID,
    ml_service: MLService
):
    """Background task to initialize user profiling"""
    
    try:
        logger.info(f"Initializing user profiling for {user_id}")
        # Implementation would set up initial profiling for new user
        
    except Exception as e:
        logger.error(f"Error initializing user profiling: {e}")


async def _update_user_profiling(
    user_id: uuid.UUID,
    profile_data: Dict[str, Any],
    ml_service: MLService
):
    """Background task to update user profiling"""
    
    try:
        logger.info(f"Updating user profiling for {user_id}")
        # Implementation would update user profiling models
        
    except Exception as e:
        logger.error(f"Error updating user profiling: {e}")


async def _process_learning_update(
    learning_data: Dict[str, Any],
    ml_service: MLService
):
    """Background task to process learning update"""
    
    try:
        user_id = learning_data['user_id']
        phone_hash = learning_data['phone_hash']
        
        logger.info(f"Processing learning update for user {user_id}, phone {phone_hash}")
        
        # Implementation would:
        # 1. Update user profile based on interaction outcome
        # 2. Update spam profile based on effectiveness
        # 3. Retrain models if necessary
        
    except Exception as e:
        logger.error(f"Error processing learning update: {e}")