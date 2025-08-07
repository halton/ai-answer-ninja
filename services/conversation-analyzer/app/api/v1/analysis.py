"""Analysis API endpoints."""

import time
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.core.logging import get_logger, analysis_logger, performance_logger
from app.core.cache import analysis_cache
from app.services.azure_speech import azure_speech_service
from app.services.nlp_analyzer import nlp_analyzer
from app.services.effectiveness_evaluator import effectiveness_evaluator
from app.services.summary_generator import summary_generator
from app.pipelines.realtime_processor import realtime_pipeline
from app.models.analysis import (
    TranscriptionRequest,
    TranscriptionResponse,
    ContentAnalysisRequest,
    ContentAnalysisResponse,
    SummaryGenerationRequest,
    CallSummary,
    BatchAnalysisRequest,
    BatchAnalysisResponse,
    BatchTaskStatus,
    PerformanceMetrics,
    AnalysisError,
    CallEffectivenessMetrics
)

logger = get_logger(__name__)
router = APIRouter()


# Transcription Endpoints
@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    request: TranscriptionRequest,
    background_tasks: BackgroundTasks
) -> TranscriptionResponse:
    """Transcribe audio to text."""
    start_time = time.time()
    
    try:
        # Check cache first
        cached_transcription = await analysis_cache.get_transcription(str(request.call_id))
        if cached_transcription:
            logger.info("using_cached_transcription", call_id=str(request.call_id))
            return TranscriptionResponse(**cached_transcription)
        
        # Perform transcription
        if request.audio_url:
            result = await azure_speech_service.transcribe_from_url(
                request.audio_url, 
                str(request.call_id)
            )
        elif request.audio_data:
            result = await azure_speech_service.transcribe_from_data(
                request.audio_data,
                str(request.call_id),
                request.language
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either audio_url or audio_data must be provided"
            )
        
        # Cache result in background
        background_tasks.add_task(
            analysis_cache.cache_transcription,
            str(request.call_id),
            result.dict()
        )
        
        # Log performance
        processing_time = int((time.time() - start_time) * 1000)
        performance_logger.log_latency("transcription", processing_time, call_id=str(request.call_id))
        
        return result
        
    except Exception as e:
        logger.error("transcription_api_error", call_id=str(request.call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription failed: {str(e)}"
        )


# Content Analysis Endpoints
@router.post("/content", response_model=ContentAnalysisResponse)
async def analyze_content(
    request: ContentAnalysisRequest,
    background_tasks: BackgroundTasks
) -> ContentAnalysisResponse:
    """Analyze conversation content."""
    start_time = time.time()
    
    try:
        # Check cache for content analysis
        cache_key = f"content_{hash(request.text)}"
        cached_analysis = await analysis_cache.get_analysis(str(request.call_id), cache_key)
        if cached_analysis:
            logger.info("using_cached_content_analysis", call_id=str(request.call_id))
            return ContentAnalysisResponse(**cached_analysis)
        
        # Perform analysis
        result = await nlp_analyzer.analyze_content(
            request.text,
            str(request.call_id),
            request.analysis_types,
            request.user_context
        )
        
        # Cache result in background
        background_tasks.add_task(
            analysis_cache.cache_analysis,
            str(request.call_id),
            cache_key,
            result.dict()
        )
        
        # Log performance
        processing_time = int((time.time() - start_time) * 1000)
        performance_logger.log_latency("content_analysis", processing_time, call_id=str(request.call_id))
        
        return result
        
    except Exception as e:
        logger.error("content_analysis_api_error", call_id=str(request.call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Content analysis failed: {str(e)}"
        )


@router.post("/effectiveness/{call_id}", response_model=CallEffectivenessMetrics)
async def evaluate_call_effectiveness(
    call_id: UUID,
    user_id: str,
    background_tasks: BackgroundTasks
) -> CallEffectivenessMetrics:
    """Evaluate call effectiveness."""
    start_time = time.time()
    
    try:
        # Check cache
        cached_effectiveness = await analysis_cache.get_analysis(
            str(call_id), 
            "effectiveness"
        )
        if cached_effectiveness:
            logger.info("using_cached_effectiveness", call_id=str(call_id))
            return CallEffectivenessMetrics(**cached_effectiveness)
        
        # Perform evaluation
        result = await effectiveness_evaluator.evaluate_call_effectiveness(
            str(call_id), 
            user_id
        )
        
        # Cache result in background
        background_tasks.add_task(
            analysis_cache.cache_analysis,
            str(call_id),
            "effectiveness",
            result.dict()
        )
        
        # Log performance
        processing_time = int((time.time() - start_time) * 1000)
        performance_logger.log_latency("effectiveness_evaluation", processing_time, call_id=str(call_id))
        
        return result
        
    except Exception as e:
        logger.error("effectiveness_api_error", call_id=str(call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Effectiveness evaluation failed: {str(e)}"
        )


@router.post("/summary", response_model=CallSummary)
async def generate_summary(
    request: SummaryGenerationRequest,
    user_id: str,
    background_tasks: BackgroundTasks
) -> CallSummary:
    """Generate call summary."""
    start_time = time.time()
    
    try:
        # Check cache
        cached_summary = await analysis_cache.get_summary(str(request.call_id))
        if cached_summary:
            logger.info("using_cached_summary", call_id=str(request.call_id))
            return CallSummary(**cached_summary)
        
        # Get conversations and analysis results
        from app.core.database import conversation_queries
        conversations = await conversation_queries.get_call_conversations(str(request.call_id))
        conversations_list = [dict(conv) for conv in conversations]
        
        # Get cached analysis results
        cached_analyses = await analysis_cache.get_all_analyses(str(request.call_id))
        
        # Generate summary
        result = await summary_generator.generate_call_summary(
            str(request.call_id),
            user_id,
            conversations_list,
            cached_analyses,
            request.summary_style,
            request.include_recommendations,
            request.include_metrics
        )
        
        # Cache result in background
        background_tasks.add_task(
            analysis_cache.cache_summary,
            str(request.call_id),
            result.dict()
        )
        
        # Log performance
        processing_time = int((time.time() - start_time) * 1000)
        performance_logger.log_latency("summary_generation", processing_time, call_id=str(request.call_id))
        
        return result
        
    except Exception as e:
        logger.error("summary_api_error", call_id=str(request.call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Summary generation failed: {str(e)}"
        )


# Complete Analysis Pipeline
@router.post("/analyze/{call_id}")
async def analyze_call_complete(
    call_id: UUID,
    user_id: str,
    analysis_types: Optional[List[str]] = None,
    priority: str = "normal",
    background_tasks: BackgroundTasks = None
) -> JSONResponse:
    """Perform complete call analysis."""
    start_time = time.time()
    
    try:
        if analysis_types is None:
            analysis_types = ["transcription", "content", "effectiveness", "summary"]
        
        # Process analysis
        results = await realtime_pipeline.process_call_analysis(
            str(call_id),
            user_id,
            analysis_types,
            priority
        )
        
        # Log performance
        processing_time = int((time.time() - start_time) * 1000)
        performance_logger.log_latency("complete_analysis", processing_time, call_id=str(call_id))
        
        return JSONResponse({
            "call_id": str(call_id),
            "analysis_types": analysis_types,
            "results": results,
            "processing_time_ms": processing_time,
            "status": "completed"
        })
        
    except Exception as e:
        logger.error("complete_analysis_api_error", call_id=str(call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Complete analysis failed: {str(e)}"
        )


# Streaming Analysis (Real-time)
@router.post("/stream/{call_id}")
async def stream_audio_analysis(
    call_id: UUID,
    audio_chunk: bytes,
    is_final: bool = False
) -> JSONResponse:
    """Process streaming audio for real-time analysis."""
    try:
        results = await realtime_pipeline.process_streaming_analysis(
            str(call_id),
            audio_chunk,
            is_final
        )
        
        return JSONResponse({
            "call_id": str(call_id),
            "chunk_processed": True,
            "is_final": is_final,
            "results": results
        })
        
    except Exception as e:
        logger.error("streaming_analysis_api_error", call_id=str(call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Streaming analysis failed: {str(e)}"
        )


# Batch Processing
@router.post("/batch", response_model=BatchAnalysisResponse)
async def batch_analyze(
    request: BatchAnalysisRequest,
    user_id: str
) -> BatchAnalysisResponse:
    """Start batch analysis of multiple calls."""
    try:
        task_id = await realtime_pipeline.process_batch_analysis(request, user_id)
        
        # Estimate completion time (rough calculation)
        estimated_time_per_call = 30  # seconds
        estimated_total_time = len(request.call_ids) * estimated_time_per_call
        
        return BatchAnalysisResponse(
            task_id=task_id,
            call_count=len(request.call_ids),
            estimated_completion_time=estimated_total_time,
            status="queued"
        )
        
    except Exception as e:
        logger.error("batch_analysis_api_error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch analysis failed: {str(e)}"
        )


@router.get("/batch/{task_id}/status", response_model=BatchTaskStatus)
async def get_batch_status(task_id: UUID) -> BatchTaskStatus:
    """Get status of batch analysis."""
    try:
        status = await realtime_pipeline.get_batch_status(str(task_id))
        
        if not status:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch task not found"
            )
        
        return status
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("batch_status_api_error", task_id=str(task_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get batch status: {str(e)}"
        )


# Results Retrieval
@router.get("/results/{call_id}")
async def get_analysis_results(
    call_id: UUID,
    analysis_type: Optional[str] = None
) -> JSONResponse:
    """Get analysis results for a call."""
    try:
        if analysis_type:
            # Get specific analysis type
            result = await analysis_cache.get_analysis(str(call_id), analysis_type)
            if not result:
                # Try database
                from app.core.database import conversation_queries
                db_results = await conversation_queries.get_analysis_results(
                    str(call_id), analysis_type
                )
                if db_results:
                    result = db_results[0].get("results", {})
            
            if not result:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Analysis results not found for {analysis_type}"
                )
            
            return JSONResponse({
                "call_id": str(call_id),
                "analysis_type": analysis_type,
                "results": result
            })
        else:
            # Get all analysis results
            cached_results = await analysis_cache.get_all_analyses(str(call_id))
            
            if not cached_results:
                # Try database
                from app.core.database import conversation_queries
                db_results = await conversation_queries.get_analysis_results(str(call_id))
                cached_results = {}
                for db_result in db_results:
                    analysis_type = db_result.get("analysis_type", "")
                    results = db_result.get("results", {})
                    if analysis_type and results:
                        cached_results[analysis_type] = results
            
            return JSONResponse({
                "call_id": str(call_id),
                "results": cached_results
            })
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error("results_retrieval_api_error", call_id=str(call_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve results: {str(e)}"
        )


# User Reports
@router.get("/reports/summary/{user_id}")
async def get_user_summary_report(
    user_id: str,
    days: int = 30,
    limit: int = 100
) -> JSONResponse:
    """Get summary report for user."""
    try:
        from app.core.database import conversation_queries
        
        # Get conversation statistics
        stats = await conversation_queries.get_conversation_statistics(user_id, days)
        
        # Get recent conversations
        recent_conversations = await conversation_queries.get_recent_user_conversations(
            user_id, limit
        )
        
        # Calculate summary metrics
        total_calls = len(recent_conversations)
        unique_callers = len(set(conv.get("caller_phone", "") for conv in recent_conversations))
        
        # Analyze intent distribution
        intent_distribution = {}
        for conv in recent_conversations:
            intent = conv.get("intent_category", "unknown")
            intent_distribution[intent] = intent_distribution.get(intent, 0) + 1
        
        report = {
            "user_id": user_id,
            "report_period_days": days,
            "summary_stats": {
                "total_calls": total_calls,
                "unique_callers": unique_callers,
                "avg_processing_latency": stats.get("avg_processing_latency", 0),
                "intent_distribution": intent_distribution
            },
            "detailed_stats": stats,
            "generated_at": time.time()
        }
        
        return JSONResponse(report)
        
    except Exception as e:
        logger.error("user_report_api_error", user_id=user_id, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate user report: {str(e)}"
        )


# Performance Metrics
@router.get("/metrics/performance", response_model=PerformanceMetrics)
async def get_performance_metrics(
    operation: Optional[str] = None,
    time_period: str = "1h"
) -> PerformanceMetrics:
    """Get performance metrics."""
    try:
        # This would typically pull from a metrics database or monitoring system
        # For now, we'll return pipeline metrics
        pipeline_metrics = await realtime_pipeline.get_pipeline_metrics()
        
        return PerformanceMetrics(
            operation=operation or "overall",
            average_latency_ms=1200.0,  # Would be calculated from actual data
            min_latency_ms=300.0,
            max_latency_ms=5000.0,
            p95_latency_ms=2500.0,
            throughput_per_second=2.5,
            error_rate=0.02,
            cache_hit_rate=0.75,
            total_requests=pipeline_metrics["processing_stats"]["completed_tasks"],
            time_period=time_period
        )
        
    except Exception as e:
        logger.error("performance_metrics_api_error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get performance metrics: {str(e)}"
        )


# Health and Status
@router.get("/health")
async def health_check() -> JSONResponse:
    """Health check endpoint."""
    try:
        # Check core services
        health_status = {
            "status": "healthy",
            "timestamp": time.time(),
            "version": "1.0.0"
        }
        
        # Check Azure Speech Service
        try:
            speech_healthy = await azure_speech_service.health_check()
            health_status["azure_speech"] = "healthy" if speech_healthy else "unhealthy"
        except Exception:
            health_status["azure_speech"] = "unhealthy"
        
        # Check Redis cache
        try:
            cache_healthy = await analysis_cache.cache.health_check()
            health_status["redis_cache"] = "healthy" if cache_healthy else "unhealthy"
        except Exception:
            health_status["redis_cache"] = "unhealthy"
        
        # Check database
        try:
            from app.core.database import db_manager
            db_healthy = await db_manager.health_check()
            health_status["database"] = "healthy" if db_healthy else "unhealthy"
        except Exception:
            health_status["database"] = "unhealthy"
        
        # Overall status
        unhealthy_components = [
            k for k, v in health_status.items() 
            if k != "status" and k != "timestamp" and k != "version" and v == "unhealthy"
        ]
        
        if unhealthy_components:
            health_status["status"] = "degraded"
            health_status["unhealthy_components"] = unhealthy_components
        
        status_code = status.HTTP_200_OK if health_status["status"] != "unhealthy" else status.HTTP_503_SERVICE_UNAVAILABLE
        
        return JSONResponse(health_status, status_code=status_code)
        
    except Exception as e:
        logger.error("health_check_api_error", error=str(e))
        return JSONResponse(
            {
                "status": "unhealthy",
                "error": str(e),
                "timestamp": time.time()
            },
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE
        )