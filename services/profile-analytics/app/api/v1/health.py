"""
Health check API endpoints
"""

from datetime import datetime
from typing import Dict, Any

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session, DatabaseHealthCheck
from app.core.cache import cache_manager
from app.core.config import get_settings
from app.services.ml_service import MLService

router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
async def health_check():
    """Basic health check"""
    return {
        "status": "healthy",
        "service": "profile-analytics",
        "version": "1.0.0",
        "timestamp": datetime.now()
    }


@router.get("/detailed")
async def detailed_health_check(
    db: AsyncSession = Depends(get_db_session),
    ml_service: MLService = Depends(lambda: MLService())
):
    """Detailed health check with dependency status"""
    
    settings = get_settings()
    
    # Check database health
    db_health = await DatabaseHealthCheck.check_connection()
    db_info = await DatabaseHealthCheck.get_connection_info()
    
    # Check cache health
    cache_health = await cache_manager.health_check()
    
    # Check ML service health
    ml_health = await ml_service.health_check()
    
    health_status = {
        "service": "profile-analytics",
        "version": "1.0.0",
        "timestamp": datetime.now(),
        "status": "healthy",
        "dependencies": {
            "database": {
                "status": "healthy" if db_health else "unhealthy",
                "details": db_info
            },
            "cache": {
                "status": cache_health.get("status", "unknown"),
                "details": cache_health
            },
            "ml_service": {
                "status": ml_health.get("status", "unknown"),
                "details": ml_health
            }
        },
        "configuration": {
            "environment": settings.environment,
            "debug": settings.debug,
            "ml_models_path": settings.ml_model_path,
            "feature_flags": {
                "real_time_profiling": settings.enable_real_time_profiling,
                "batch_learning": settings.enable_batch_learning,
                "advanced_analytics": settings.enable_advanced_analytics,
                "nlp_features": settings.enable_nlp_features
            }
        }
    }
    
    # Determine overall health status
    dependency_statuses = [
        health_status["dependencies"]["database"]["status"] == "healthy",
        health_status["dependencies"]["cache"]["status"] == "healthy",
        health_status["dependencies"]["ml_service"]["status"] in ["healthy", "degraded"]
    ]
    
    if not all(dependency_statuses):
        health_status["status"] = "unhealthy"
    elif health_status["dependencies"]["ml_service"]["status"] == "degraded":
        health_status["status"] = "degraded"
    
    return health_status


@router.get("/readiness")
async def readiness_check(
    ml_service: MLService = Depends(lambda: MLService())
):
    """Check if service is ready to handle requests"""
    
    try:
        # Check critical components
        ml_health = await ml_service.health_check()
        
        ready = {
            "ready": True,
            "timestamp": datetime.now(),
            "components": {
                "ml_models": ml_health.get("models_loaded", False),
                "feature_processor": ml_health.get("feature_processor_ready", False),
                "spam_classifier": ml_health.get("spam_classifier_ready", False),
                "user_profiler": ml_health.get("user_profiler_ready", False)
            }
        }
        
        # Service is ready if critical components are working
        critical_ready = [
            ready["components"]["feature_processor"],
            ready["components"]["spam_classifier"] or ready["components"]["user_profiler"]
        ]
        
        ready["ready"] = all(critical_ready)
        
        return ready
        
    except Exception as e:
        return {
            "ready": False,
            "error": str(e),
            "timestamp": datetime.now()
        }


@router.get("/liveness")
async def liveness_check():
    """Check if service is alive"""
    
    return {
        "alive": True,
        "service": "profile-analytics",
        "timestamp": datetime.now()
    }


@router.get("/metrics")
async def get_health_metrics(
    ml_service: MLService = Depends(lambda: MLService())
):
    """Get health and performance metrics"""
    
    try:
        # Get ML service performance
        ml_performance = await ml_service.get_model_performance()
        
        # Get cache metrics
        cache_health = await cache_manager.health_check()
        
        metrics = {
            "timestamp": datetime.now(),
            "uptime_info": {
                "service_start": datetime.now(),  # This would be stored when service starts
                "current_time": datetime.now()
            },
            "ml_metrics": {
                "models_loaded": ml_performance.get("models_loaded", False),
                "last_model_update": ml_performance.get("last_update"),
                "training_history_count": ml_performance.get("training_history_count", 0),
                "spam_classifier_performance": ml_performance.get("spam_classifier", {})
            },
            "cache_metrics": {
                "status": cache_health.get("status"),
                "redis_version": cache_health.get("redis_version"),
                "connected_clients": cache_health.get("connected_clients"),
                "used_memory": cache_health.get("used_memory_human"),
                "keyspace_hits": cache_health.get("keyspace_hits", 0),
                "keyspace_misses": cache_health.get("keyspace_misses", 0)
            }
        }
        
        # Calculate cache hit rate
        hits = cache_health.get("keyspace_hits", 0)
        misses = cache_health.get("keyspace_misses", 0)
        total_requests = hits + misses
        
        if total_requests > 0:
            metrics["cache_metrics"]["hit_rate"] = hits / total_requests
        else:
            metrics["cache_metrics"]["hit_rate"] = 0.0
        
        return metrics
        
    except Exception as e:
        return {
            "error": str(e),
            "timestamp": datetime.now()
        }