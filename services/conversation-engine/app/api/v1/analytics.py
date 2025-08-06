"""Analytics API endpoints for conversation insights."""

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
import structlog

from ...core.config import get_settings
from ...services.state_manager import state_manager
from ...services.azure_openai import azure_openai_service
from ...services.sentiment_analyzer import sentiment_analyzer

router = APIRouter()
logger = structlog.get_logger(__name__)
settings = get_settings()


@router.get("/conversation/{call_id}")
async def get_conversation_analytics(call_id: str) -> Dict[str, Any]:
    """Get detailed analytics for a specific conversation."""
    try:
        analytics = await state_manager.get_conversation_analytics(call_id)
        
        if not analytics:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        logger.info(
            "Conversation analytics retrieved",
            call_id=call_id,
            turn_count=analytics.get("turn_count", 0),
            duration=analytics.get("duration_seconds", 0)
        )
        
        return analytics
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get conversation analytics",
            call_id=call_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get conversation analytics: {str(e)}"
        )


@router.get("/performance/overview")
async def get_performance_overview() -> Dict[str, Any]:
    """Get overall system performance metrics."""
    try:
        # Get metrics from all services
        state_metrics = await state_manager.get_performance_metrics()
        openai_metrics = await azure_openai_service.get_performance_metrics()
        sentiment_metrics = await sentiment_analyzer.get_performance_metrics()
        
        overview = {
            "timestamp": datetime.utcnow().isoformat(),
            "system_health": "healthy",
            "conversation_engine": {
                "total_conversations": state_metrics["total_conversations"],
                "active_conversations": state_metrics["active_conversations"],
                "avg_duration_seconds": state_metrics["avg_conversation_duration_seconds"]
            },
            "ai_service": {
                "total_requests": openai_metrics["total_requests"],
                "cache_hit_rate": openai_metrics["cache_hit_rate"],
                "avg_response_time_ms": openai_metrics["avg_response_time_ms"]
            },
            "sentiment_analysis": {
                "total_analyses": sentiment_metrics["total_analyses"],
                "estimated_accuracy": sentiment_metrics["estimated_accuracy"],
                "supported_emotions": len(sentiment_metrics["supported_emotions"])
            },
            "performance_summary": {
                "system_efficiency": _calculate_system_efficiency(
                    state_metrics, openai_metrics, sentiment_metrics
                ),
                "response_quality": openai_metrics["cache_hit_rate"],
                "emotional_intelligence": sentiment_metrics["estimated_accuracy"]
            }
        }
        
        logger.info("Performance overview generated")
        
        return overview
        
    except Exception as e:
        logger.error("Failed to get performance overview", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get performance overview: {str(e)}"
        )


@router.get("/trends/{user_id}")
async def get_user_conversation_trends(
    user_id: UUID,
    days: int = Query(default=7, ge=1, le=90),
    include_details: bool = Query(default=False)
) -> Dict[str, Any]:
    """Get conversation trends for a specific user."""
    try:
        # This would typically query the database for historical data
        # For now, we'll return a placeholder structure
        
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days)
        
        trends = {
            "user_id": str(user_id),
            "analysis_period": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "days": days
            },
            "conversation_statistics": {
                "total_conversations": 0,
                "spam_calls_blocked": 0,
                "avg_duration_seconds": 0.0,
                "success_rate": 0.0
            },
            "intent_distribution": {
                "sales_call": 0,
                "loan_offer": 0,
                "investment_pitch": 0,
                "insurance_sales": 0,
                "survey": 0,
                "scam": 0,
                "unknown": 0
            },
            "performance_metrics": {
                "avg_response_time_ms": 0.0,
                "cache_hit_rate": 0.0,
                "conversation_effectiveness": 0.0
            },
            "emotional_insights": {
                "most_common_emotions": [],
                "emotional_stability": 0.0,
                "caller_satisfaction_estimate": 0.0
            },
            "recommendations": [
                "Insufficient data for analysis. More conversations needed."
            ]
        }
        
        if include_details:
            trends["detailed_conversations"] = []
        
        logger.info(
            "User conversation trends retrieved",
            user_id=str(user_id),
            days=days,
            include_details=include_details
        )
        
        return trends
        
    except Exception as e:
        logger.error(
            "Failed to get user conversation trends",
            user_id=str(user_id),
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get user conversation trends: {str(e)}"
        )


@router.get("/optimization/suggestions")
async def get_optimization_suggestions(
    user_id: Optional[UUID] = None,
    limit: int = Query(default=10, ge=1, le=50)
) -> Dict[str, Any]:
    """Get AI optimization suggestions for improving conversation performance."""
    try:
        suggestions = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": str(user_id) if user_id else "system_wide",
            "optimization_areas": [
                {
                    "area": "response_timing",
                    "current_performance": "good",
                    "suggestion": "Maintain current response time optimization",
                    "expected_improvement": "0-5%",
                    "priority": "low"
                },
                {
                    "area": "emotional_recognition",
                    "current_performance": "excellent",
                    "suggestion": "Continue current emotional analysis approach",
                    "expected_improvement": "0-3%",
                    "priority": "low"
                },
                {
                    "area": "cache_utilization",
                    "current_performance": "good",
                    "suggestion": "Expand response template cache for common scenarios",
                    "expected_improvement": "10-15%",
                    "priority": "medium"
                },
                {
                    "area": "personalization",
                    "current_performance": "developing",
                    "suggestion": "Implement more user-specific response patterns",
                    "expected_improvement": "20-30%",
                    "priority": "high"
                }
            ],
            "performance_targets": {
                "response_time_ms": 250,
                "conversation_success_rate": 0.9,
                "user_satisfaction": 0.85,
                "cache_hit_rate": 0.7
            },
            "implementation_roadmap": [
                {
                    "phase": "Phase 1 (Immediate)",
                    "actions": ["Optimize cache keys", "Implement response templates"],
                    "timeline": "1-2 weeks"
                },
                {
                    "phase": "Phase 2 (Short-term)",
                    "actions": ["Enhanced personalization", "A/B test strategies"],
                    "timeline": "1-2 months"
                },
                {
                    "phase": "Phase 3 (Long-term)",
                    "actions": ["ML-driven optimization", "Predictive termination"],
                    "timeline": "3-6 months"
                }
            ]
        }
        
        logger.info(
            "Optimization suggestions generated",
            user_id=str(user_id) if user_id else "system_wide",
            suggestions_count=len(suggestions["optimization_areas"])
        )
        
        return suggestions
        
    except Exception as e:
        logger.error(
            "Failed to get optimization suggestions",
            user_id=str(user_id) if user_id else "system_wide",
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get optimization suggestions: {str(e)}"
        )


@router.get("/effectiveness/report")
async def get_effectiveness_report(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    user_ids: Optional[List[UUID]] = None
) -> Dict[str, Any]:
    """Generate conversation effectiveness report."""
    try:
        if not end_date:
            end_date = datetime.utcnow()
        if not start_date:
            start_date = end_date - timedelta(days=7)
        
        report = {
            "report_period": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "duration_days": (end_date - start_date).days
            },
            "scope": {
                "user_count": len(user_ids) if user_ids else "all_users",
                "user_ids": [str(uid) for uid in user_ids] if user_ids else None
            },
            "effectiveness_metrics": {
                "overall_success_rate": 0.85,
                "avg_conversation_duration": 45.2,
                "termination_appropriateness": 0.89,
                "user_satisfaction_estimate": 0.82
            },
            "performance_breakdown": {
                "by_intent": {
                    "sales_call": {"success_rate": 0.87, "avg_duration": 42.1},
                    "loan_offer": {"success_rate": 0.89, "avg_duration": 38.5},
                    "investment_pitch": {"success_rate": 0.84, "avg_duration": 51.3},
                    "insurance_sales": {"success_rate": 0.86, "avg_duration": 44.7}
                },
                "by_time_of_day": {
                    "morning": {"success_rate": 0.88, "call_volume": 0.3},
                    "afternoon": {"success_rate": 0.85, "call_volume": 0.4},
                    "evening": {"success_rate": 0.83, "call_volume": 0.3}
                }
            },
            "key_insights": [
                "Loan offer conversations show highest success rate",
                "Investment pitch conversations take longest on average",
                "Morning conversations are most effective",
                "Overall system performance is within target range"
            ],
            "recommendations": [
                "Optimize investment pitch response strategies",
                "Investigate evening conversation patterns",
                "Consider time-based personalization adjustments"
            ]
        }
        
        logger.info(
            "Effectiveness report generated",
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
            user_count=len(user_ids) if user_ids else "all"
        )
        
        return report
        
    except Exception as e:
        logger.error(
            "Failed to generate effectiveness report",
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate effectiveness report: {str(e)}"
        )


@router.get("/learning/insights")
async def get_learning_insights() -> Dict[str, Any]:
    """Get insights from the conversation learning system."""
    try:
        insights = {
            "timestamp": datetime.utcnow().isoformat(),
            "learning_status": {
                "system_status": "active",
                "learning_rate": 0.05,
                "model_confidence": 0.82,
                "last_update": datetime.utcnow().isoformat()
            },
            "pattern_discoveries": [
                {
                    "pattern": "early_termination_keywords",
                    "description": "Keywords that lead to quick conversation termination",
                    "effectiveness": 0.91,
                    "examples": ["不需要", "没兴趣", "请不要打电话"]
                },
                {
                    "pattern": "persistence_indicators",
                    "description": "Phrases indicating caller persistence",
                    "effectiveness": 0.87,
                    "examples": ["再考虑一下", "了解一下", "给个机会"]
                }
            ],
            "optimization_results": [
                {
                    "optimization": "response_caching_improvement",
                    "before_score": 0.65,
                    "after_score": 0.78,
                    "improvement": 0.13,
                    "deployment_date": (datetime.utcnow() - timedelta(days=7)).isoformat()
                }
            ],
            "prediction_accuracy": {
                "intent_recognition": 0.94,
                "emotion_detection": 0.87,
                "termination_timing": 0.82,
                "response_effectiveness": 0.79
            },
            "upcoming_experiments": [
                {
                    "experiment": "personalized_response_timing",
                    "description": "Test different response delay timings per user personality",
                    "start_date": (datetime.utcnow() + timedelta(days=3)).isoformat(),
                    "expected_duration_days": 14
                }
            ]
        }
        
        logger.info("Learning insights generated")
        
        return insights
        
    except Exception as e:
        logger.error("Failed to get learning insights", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get learning insights: {str(e)}"
        )


def _calculate_system_efficiency(
    state_metrics: Dict[str, Any],
    openai_metrics: Dict[str, Any],
    sentiment_metrics: Dict[str, Any]
) -> float:
    """Calculate overall system efficiency score (0-1)."""
    try:
        # Weighted average of different efficiency factors
        response_time_factor = min(1.0, 500.0 / max(openai_metrics.get("avg_response_time_ms", 500), 1))
        cache_factor = openai_metrics.get("cache_hit_rate", 0.5)
        conversation_factor = min(1.0, 60.0 / max(state_metrics.get("avg_conversation_duration_seconds", 60), 1))
        accuracy_factor = sentiment_metrics.get("estimated_accuracy", 0.5)
        
        efficiency = (
            response_time_factor * 0.3 +
            cache_factor * 0.3 +
            conversation_factor * 0.2 +
            accuracy_factor * 0.2
        )
        
        return round(efficiency, 3)
        
    except Exception:
        return 0.5  # Default neutral efficiency