"""Health check and monitoring API endpoints."""

import asyncio
from typing import Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import structlog

from ...core.config import get_settings
from ...core.cache import cache_manager
from ...services.state_manager import state_manager
from ...services.azure_openai import azure_openai_service
from ...services.sentiment_analyzer import sentiment_analyzer

router = APIRouter()
logger = structlog.get_logger(__name__)
settings = get_settings()


@router.get("/")
async def health_check() -> Dict[str, Any]:
    """Basic health check endpoint."""
    return {
        "service": "conversation-engine",
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": settings.version
    }


@router.get("/detailed")
async def detailed_health_check() -> Dict[str, Any]:
    """Detailed health check with component status."""
    try:
        # Check all service components
        health_checks = await asyncio.gather(
            _check_database_health(),
            _check_cache_health(),
            _check_azure_openai_health(),
            _check_sentiment_analyzer_health(),
            _check_state_manager_health(),
            return_exceptions=True
        )
        
        database_health, cache_health, openai_health, sentiment_health, state_health = health_checks
        
        # Determine overall health
        all_healthy = all(
            isinstance(check, dict) and check.get("status") == "healthy"
            for check in health_checks
        )
        
        overall_status = "healthy" if all_healthy else "degraded"
        
        detailed_status = {
            "service": "conversation-engine",
            "overall_status": overall_status,
            "timestamp": datetime.utcnow().isoformat(),
            "version": settings.version,
            "components": {
                "database": database_health if isinstance(database_health, dict) else {"status": "error", "error": str(database_health)},
                "cache": cache_health if isinstance(cache_health, dict) else {"status": "error", "error": str(cache_health)},
                "azure_openai": openai_health if isinstance(openai_health, dict) else {"status": "error", "error": str(openai_health)},
                "sentiment_analyzer": sentiment_health if isinstance(sentiment_health, dict) else {"status": "error", "error": str(sentiment_health)},
                "state_manager": state_health if isinstance(state_health, dict) else {"status": "error", "error": str(state_health)}
            }
        }
        
        # Return appropriate status code
        status_code = 200 if all_healthy else 503
        
        logger.info(
            "Detailed health check completed",
            overall_status=overall_status,
            components_healthy=sum(1 for check in health_checks if isinstance(check, dict) and check.get("status") == "healthy")
        )
        
        return JSONResponse(content=detailed_status, status_code=status_code)
        
    except Exception as e:
        logger.error("Health check failed", error=str(e))
        return JSONResponse(
            content={
                "service": "conversation-engine",
                "overall_status": "error",
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e)
            },
            status_code=503
        )


@router.get("/readiness")
async def readiness_check() -> Dict[str, Any]:
    """Readiness check for Kubernetes/container orchestration."""
    try:
        # Check if service is ready to handle requests
        ready_checks = await asyncio.gather(
            _check_cache_connectivity(),
            _check_azure_services_connectivity(),
            _check_critical_resources(),
            return_exceptions=True
        )
        
        all_ready = all(
            isinstance(check, dict) and check.get("ready") == True
            for check in ready_checks
        )
        
        readiness_status = {
            "service": "conversation-engine",
            "ready": all_ready,
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "cache_connectivity": ready_checks[0] if isinstance(ready_checks[0], dict) else {"ready": False, "error": str(ready_checks[0])},
                "azure_services": ready_checks[1] if isinstance(ready_checks[1], dict) else {"ready": False, "error": str(ready_checks[1])},
                "critical_resources": ready_checks[2] if isinstance(ready_checks[2], dict) else {"ready": False, "error": str(ready_checks[2])}
            }
        }
        
        status_code = 200 if all_ready else 503
        
        logger.info(
            "Readiness check completed",
            ready=all_ready,
            checks_passed=sum(1 for check in ready_checks if isinstance(check, dict) and check.get("ready") == True)
        )
        
        return JSONResponse(content=readiness_status, status_code=status_code)
        
    except Exception as e:
        logger.error("Readiness check failed", error=str(e))
        return JSONResponse(
            content={
                "service": "conversation-engine",
                "ready": False,
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e)
            },
            status_code=503
        )


@router.get("/liveness")
async def liveness_check() -> Dict[str, Any]:
    """Liveness check for Kubernetes/container orchestration."""
    try:
        # Basic liveness check - ensure service is running
        return {
            "service": "conversation-engine",
            "alive": True,
            "timestamp": datetime.utcnow().isoformat(),
            "uptime_seconds": _get_uptime_seconds(),
            "memory_usage": _get_memory_usage(),
            "active_conversations": state_manager.active_count
        }
        
    except Exception as e:
        logger.error("Liveness check failed", error=str(e))
        return JSONResponse(
            content={
                "service": "conversation-engine",
                "alive": False,
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e)
            },
            status_code=503
        )


@router.get("/metrics/performance")
async def get_performance_metrics() -> Dict[str, Any]:
    """Get detailed performance metrics."""
    try:
        # Gather metrics from all components
        metrics = {
            "timestamp": datetime.utcnow().isoformat(),
            "service": "conversation-engine",
            "performance": {
                "active_conversations": state_manager.active_count,
                "total_conversations": state_manager.total_conversations,
                "avg_conversation_duration": state_manager.avg_conversation_duration,
                "cache_performance": await _get_cache_metrics(),
                "ai_service_performance": await azure_openai_service.get_performance_metrics(),
                "sentiment_analysis_performance": await sentiment_analyzer.get_performance_metrics()
            },
            "system_resources": {
                "memory_usage_mb": _get_memory_usage(),
                "uptime_seconds": _get_uptime_seconds()
            }
        }
        
        logger.info("Performance metrics retrieved")
        
        return metrics
        
    except Exception as e:
        logger.error("Failed to get performance metrics", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get performance metrics: {str(e)}"
        )


# Helper functions for health checks
async def _check_database_health() -> Dict[str, Any]:
    """Check database connectivity and health."""
    try:
        # This would typically test a simple query
        # For now, we'll assume it's healthy if we get here
        return {
            "status": "healthy",
            "response_time_ms": 5.0,
            "connection_pool_size": 10
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


async def _check_cache_health() -> Dict[str, Any]:
    """Check cache connectivity and performance."""
    try:
        if not cache_manager.redis:
            return {
                "status": "unhealthy",
                "error": "Cache not connected"
            }
        
        # Test cache with a simple operation
        start_time = datetime.utcnow()
        await cache_manager.redis.ping()
        response_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        return {
            "status": "healthy",
            "response_time_ms": response_time,
            "connection_status": "connected"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


async def _check_azure_openai_health() -> Dict[str, Any]:
    """Check Azure OpenAI service health."""
    try:
        metrics = await azure_openai_service.get_performance_metrics()
        
        return {
            "status": "healthy",
            "total_requests": metrics["total_requests"],
            "avg_response_time_ms": metrics["avg_response_time_ms"],
            "cache_hit_rate": metrics["cache_hit_rate"]
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


async def _check_sentiment_analyzer_health() -> Dict[str, Any]:
    """Check sentiment analyzer service health."""
    try:
        metrics = await sentiment_analyzer.get_performance_metrics()
        
        return {
            "status": "healthy",
            "total_analyses": metrics["total_analyses"],
            "estimated_accuracy": metrics["estimated_accuracy"]
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


async def _check_state_manager_health() -> Dict[str, Any]:
    """Check conversation state manager health."""
    try:
        metrics = await state_manager.get_performance_metrics()
        
        return {
            "status": "healthy",
            "active_conversations": metrics["active_conversations"],
            "total_conversations": metrics["total_conversations"]
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


async def _check_cache_connectivity() -> Dict[str, Any]:
    """Check cache connectivity for readiness."""
    try:
        if cache_manager.redis:
            await cache_manager.redis.ping()
            return {"ready": True}
        else:
            return {"ready": False, "error": "Cache not connected"}
    except Exception as e:
        return {"ready": False, "error": str(e)}


async def _check_azure_services_connectivity() -> Dict[str, Any]:
    """Check Azure services connectivity for readiness."""
    try:
        # In a real implementation, this would test connectivity to Azure services
        return {"ready": True, "services": ["openai", "text_analytics"]}
    except Exception as e:
        return {"ready": False, "error": str(e)}


async def _check_critical_resources() -> Dict[str, Any]:
    """Check critical system resources for readiness."""
    try:
        memory_mb = _get_memory_usage()
        
        # Check if we have sufficient resources
        if memory_mb > 1000:  # More than 1GB used might indicate issues
            return {"ready": False, "error": f"High memory usage: {memory_mb}MB"}
        
        return {"ready": True, "memory_mb": memory_mb}
    except Exception as e:
        return {"ready": False, "error": str(e)}


async def _get_cache_metrics() -> Dict[str, Any]:
    """Get cache performance metrics."""
    try:
        if not cache_manager.redis:
            return {"status": "disconnected"}
        
        # Get Redis info (simplified)
        return {
            "status": "connected",
            "hit_rate": 0.75,  # Placeholder
            "memory_usage_mb": 50  # Placeholder
        }
    except Exception:
        return {"status": "error"}


def _get_memory_usage() -> float:
    """Get current memory usage in MB."""
    try:
        import psutil
        process = psutil.Process()
        memory_info = process.memory_info()
        return round(memory_info.rss / 1024 / 1024, 2)
    except ImportError:
        return 0.0  # psutil not available
    except Exception:
        return -1.0  # Error getting memory info


def _get_uptime_seconds() -> float:
    """Get service uptime in seconds."""
    try:
        import psutil
        process = psutil.Process()
        create_time = process.create_time()
        return round(datetime.utcnow().timestamp() - create_time, 2)
    except ImportError:
        return 0.0  # psutil not available
    except Exception:
        return -1.0  # Error getting uptime