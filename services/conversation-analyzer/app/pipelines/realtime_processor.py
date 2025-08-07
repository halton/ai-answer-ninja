"""Real-time analysis pipeline for conversation processing."""

import asyncio
import json
import time
from typing import Any, Dict, List, Optional
from datetime import datetime
from uuid import UUID, uuid4

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.cache import analysis_cache, cache_manager
from app.core.logging import get_logger, analysis_logger, performance_logger
from app.services.azure_speech import azure_speech_service
from app.services.nlp_analyzer import nlp_analyzer
from app.services.effectiveness_evaluator import effectiveness_evaluator
from app.services.summary_generator import summary_generator
from app.services.service_client import service_client
from app.models.analysis import (
    TranscriptionRequest,
    ContentAnalysisRequest,
    BatchAnalysisRequest,
    BatchTaskStatus
)

logger = get_logger(__name__)


class RealtimeAnalysisPipeline:
    """Real-time pipeline for processing conversation analysis."""
    
    def __init__(self):
        self.redis_client = None
        self.task_queue = "analysis_tasks"
        self.result_queue = "analysis_results"
        self.processing_tasks = {}
        self.max_concurrent = settings.max_concurrent_analyses
        self.semaphore = asyncio.Semaphore(self.max_concurrent)
        
    async def initialize(self) -> None:
        """Initialize the pipeline."""
        try:
            # Initialize Redis for queue management
            self.redis_client = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            
            # Test Redis connection
            await self.redis_client.ping()
            
            logger.info("realtime_pipeline_initialized", max_concurrent=self.max_concurrent)
            
        except Exception as e:
            logger.error("realtime_pipeline_initialization_failed", error=str(e))
            raise
    
    async def close(self) -> None:
        """Close pipeline resources."""
        if self.redis_client:
            await self.redis_client.close()
    
    # Main Processing Methods
    async def process_call_analysis(
        self, 
        call_id: str, 
        user_id: str,
        analysis_types: List[str] = None,
        priority: str = "normal"
    ) -> Dict[str, Any]:
        """Process complete call analysis pipeline."""
        if analysis_types is None:
            analysis_types = ["transcription", "content", "effectiveness", "summary"]
        
        analysis_logger.log_analysis_start(call_id, "full_pipeline")
        pipeline_start = time.time()
        
        try:
            # Check for cached results first
            cached_results = await self._check_cached_results(call_id, analysis_types)
            if cached_results:
                logger.info("using_cached_analysis_results", call_id=call_id)
                return cached_results
            
            # Collect call data
            call_data = await service_client.collect_call_analysis_data(call_id, user_id)
            conversations = await self._get_conversations(call_id)
            
            if not conversations:
                logger.warning("no_conversations_found", call_id=call_id)
                return {"error": "No conversation data found"}
            
            # Execute analysis pipeline
            results = await self._execute_analysis_pipeline(
                call_id, user_id, conversations, call_data, analysis_types
            )
            
            # Store results
            await self._store_analysis_results(call_id, results)
            
            # Notify other services
            await self._notify_analysis_complete(call_id, results)
            
            pipeline_time = int((time.time() - pipeline_start) * 1000)
            analysis_logger.log_analysis_complete(
                call_id, 
                "full_pipeline", 
                pipeline_time,
                {"analysis_types": analysis_types, "results_count": len(results)}
            )
            
            performance_logger.log_latency("full_analysis_pipeline", pipeline_time, call_id=call_id)
            
            return results
            
        except Exception as e:
            analysis_logger.log_error("full_pipeline", call_id, e)
            raise
    
    async def process_streaming_analysis(
        self, 
        call_id: str,
        audio_chunk: bytes,
        is_final: bool = False
    ) -> Dict[str, Any]:
        """Process streaming audio analysis."""
        try:
            results = {}
            
            # For MVP, we'll process audio chunks as they come
            # In production, you'd want more sophisticated streaming
            if len(audio_chunk) > 0:
                # Quick transcription of chunk
                # Note: This is simplified - real streaming would use Azure's streaming API
                chunk_id = f"{call_id}_{int(time.time())}"
                
                # Store chunk for later processing
                await self._store_audio_chunk(call_id, chunk_id, audio_chunk)
                
                results["chunk_id"] = chunk_id
                results["processed"] = True
                
                # If this is the final chunk, trigger full analysis
                if is_final:
                    await self.queue_analysis_task(call_id, "full_analysis", "high")
                    results["full_analysis_queued"] = True
            
            return results
            
        except Exception as e:
            logger.error("streaming_analysis_failed", call_id=call_id, error=str(e))
            raise
    
    # Queue Management
    async def queue_analysis_task(
        self, 
        call_id: str, 
        task_type: str,
        priority: str = "normal",
        **kwargs
    ) -> str:
        """Queue an analysis task for background processing."""
        task_id = str(uuid4())
        
        task_data = {
            "task_id": task_id,
            "call_id": call_id,
            "task_type": task_type,
            "priority": priority,
            "created_at": datetime.now().isoformat(),
            "kwargs": kwargs
        }
        
        # Determine queue based on priority
        queue_name = f"{self.task_queue}:{priority}"
        
        await self.redis_client.lpush(queue_name, json.dumps(task_data))
        
        logger.info("analysis_task_queued", 
                   task_id=task_id, call_id=call_id, task_type=task_type)
        
        return task_id
    
    async def process_queued_tasks(self) -> None:
        """Process tasks from the queue (background worker)."""
        priority_queues = [
            f"{self.task_queue}:high",
            f"{self.task_queue}:normal",
            f"{self.task_queue}:low"
        ]
        
        while True:
            try:
                # Check queues in priority order
                for queue in priority_queues:
                    task_data = await self.redis_client.brpop(queue, timeout=1)
                    if task_data:
                        task_json = task_data[1]
                        await self._process_background_task(json.loads(task_json))
                        break
                else:
                    # No tasks found, short sleep
                    await asyncio.sleep(0.1)
                    
            except Exception as e:
                logger.error("queue_processing_error", error=str(e))
                await asyncio.sleep(1)
    
    async def _process_background_task(self, task_data: Dict[str, Any]) -> None:
        """Process a single background task."""
        task_id = task_data["task_id"]
        call_id = task_data["call_id"]
        task_type = task_data["task_type"]
        
        async with self.semaphore:  # Limit concurrent processing
            try:
                self.processing_tasks[task_id] = {
                    "status": "processing",
                    "started_at": datetime.now().isoformat()
                }
                
                # Route to appropriate handler
                if task_type == "transcription":
                    result = await self._process_transcription_task(call_id, task_data["kwargs"])
                elif task_type == "content_analysis":
                    result = await self._process_content_analysis_task(call_id, task_data["kwargs"])
                elif task_type == "effectiveness":
                    result = await self._process_effectiveness_task(call_id, task_data["kwargs"])
                elif task_type == "summary":
                    result = await self._process_summary_task(call_id, task_data["kwargs"])
                elif task_type == "full_analysis":
                    result = await self._process_full_analysis_task(call_id, task_data["kwargs"])
                else:
                    raise ValueError(f"Unknown task type: {task_type}")
                
                # Store result
                self.processing_tasks[task_id] = {
                    "status": "completed",
                    "completed_at": datetime.now().isoformat(),
                    "result": result
                }
                
                # Publish result
                await self._publish_task_result(task_id, call_id, result)
                
                logger.info("background_task_completed", task_id=task_id, call_id=call_id)
                
            except Exception as e:
                self.processing_tasks[task_id] = {
                    "status": "failed",
                    "failed_at": datetime.now().isoformat(),
                    "error": str(e)
                }
                logger.error("background_task_failed", task_id=task_id, call_id=call_id, error=str(e))
    
    # Task Handlers
    async def _process_transcription_task(self, call_id: str, kwargs: Dict) -> Dict[str, Any]:
        """Process transcription task."""
        audio_url = kwargs.get("audio_url")
        if not audio_url:
            raise ValueError("audio_url required for transcription")
        
        transcription = await azure_speech_service.transcribe_from_url(audio_url, call_id)
        
        # Cache result
        await analysis_cache.cache_transcription(call_id, transcription.dict())
        
        return {"transcription": transcription.dict()}
    
    async def _process_content_analysis_task(self, call_id: str, kwargs: Dict) -> Dict[str, Any]:
        """Process content analysis task."""
        text = kwargs.get("text")
        if not text:
            # Try to get from cached transcription
            cached_transcription = await analysis_cache.get_transcription(call_id)
            if cached_transcription:
                text = cached_transcription.get("full_transcript", "")
            
            if not text:
                raise ValueError("text or transcription required for content analysis")
        
        analysis_types = kwargs.get("analysis_types", ["sentiment", "intent", "entities", "keywords"])
        user_context = kwargs.get("user_context")
        
        analysis = await nlp_analyzer.analyze_content(
            text, call_id, analysis_types, user_context
        )
        
        # Cache results
        await analysis_cache.cache_multiple_analyses(call_id, {
            "content": analysis.dict()
        })
        
        return {"content_analysis": analysis.dict()}
    
    async def _process_effectiveness_task(self, call_id: str, kwargs: Dict) -> Dict[str, Any]:
        """Process effectiveness evaluation task."""
        user_id = kwargs.get("user_id")
        if not user_id:
            raise ValueError("user_id required for effectiveness evaluation")
        
        effectiveness = await effectiveness_evaluator.evaluate_call_effectiveness(call_id, user_id)
        
        return {"effectiveness": effectiveness.dict()}
    
    async def _process_summary_task(self, call_id: str, kwargs: Dict) -> Dict[str, Any]:
        """Process summary generation task."""
        user_id = kwargs.get("user_id")
        if not user_id:
            raise ValueError("user_id required for summary generation")
        
        conversations = await self._get_conversations(call_id)
        
        # Get all analysis results
        cached_analyses = await analysis_cache.get_all_analyses(call_id)
        
        summary = await summary_generator.generate_call_summary(
            call_id, 
            user_id, 
            conversations, 
            cached_analyses,
            kwargs.get("style", "comprehensive")
        )
        
        # Cache summary
        await analysis_cache.cache_summary(call_id, summary.dict())
        
        return {"summary": summary.dict()}
    
    async def _process_full_analysis_task(self, call_id: str, kwargs: Dict) -> Dict[str, Any]:
        """Process full analysis pipeline task."""
        user_id = kwargs.get("user_id")
        analysis_types = kwargs.get("analysis_types", ["transcription", "content", "effectiveness", "summary"])
        
        return await self.process_call_analysis(call_id, user_id, analysis_types)
    
    # Batch Processing
    async def process_batch_analysis(
        self,
        batch_request: BatchAnalysisRequest,
        user_id: str
    ) -> str:
        """Process batch analysis request."""
        batch_id = str(uuid4())
        
        # Create batch task record
        batch_info = {
            "batch_id": batch_id,
            "user_id": user_id,
            "call_ids": [str(cid) for cid in batch_request.call_ids],
            "analysis_types": batch_request.analysis_types,
            "priority": batch_request.priority,
            "total_calls": len(batch_request.call_ids),
            "completed_calls": 0,
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "callback_url": batch_request.callback_url
        }
        
        # Store batch info
        await self.redis_client.set(
            f"batch:{batch_id}",
            json.dumps(batch_info),
            ex=86400  # 24 hours
        )
        
        # Queue individual tasks
        for call_id in batch_request.call_ids:
            await self.queue_analysis_task(
                call_id,
                "full_analysis",
                batch_request.priority,
                user_id=user_id,
                analysis_types=batch_request.analysis_types,
                batch_id=batch_id
            )
        
        logger.info("batch_analysis_queued", 
                   batch_id=batch_id, call_count=len(batch_request.call_ids))
        
        return batch_id
    
    async def get_batch_status(self, batch_id: str) -> Optional[BatchTaskStatus]:
        """Get status of batch analysis."""
        batch_info_json = await self.redis_client.get(f"batch:{batch_id}")
        if not batch_info_json:
            return None
        
        batch_info = json.loads(batch_info_json)
        
        # Calculate progress
        total_calls = batch_info["total_calls"]
        completed_calls = batch_info["completed_calls"]
        progress = completed_calls / total_calls if total_calls > 0 else 0.0
        
        status = BatchTaskStatus(
            task_id=batch_id,
            status=batch_info["status"],
            progress=progress,
            completed_calls=completed_calls,
            total_calls=total_calls,
            started_at=datetime.fromisoformat(batch_info["created_at"]),
            completed_at=datetime.fromisoformat(batch_info["completed_at"]) if batch_info.get("completed_at") else None
        )
        
        return status
    
    # Helper Methods
    async def _execute_analysis_pipeline(
        self,
        call_id: str,
        user_id: str,
        conversations: List[Dict],
        call_data: Dict,
        analysis_types: List[str]
    ) -> Dict[str, Any]:
        """Execute the complete analysis pipeline."""
        results = {}
        
        # Prepare conversation text for analysis
        conversation_text = self._extract_conversation_text(conversations)
        if not conversation_text.strip():
            logger.warning("no_conversation_text", call_id=call_id)
            return {"error": "No conversation text available"}
        
        # Execute analyses in parallel where possible
        tasks = []
        
        if "content" in analysis_types:
            tasks.append(
                ("content", nlp_analyzer.analyze_content(
                    conversation_text, 
                    call_id, 
                    ["sentiment", "intent", "entities", "keywords"],
                    call_data.get("user_profile")
                ))
            )
        
        if "effectiveness" in analysis_types:
            tasks.append(
                ("effectiveness", effectiveness_evaluator.evaluate_call_effectiveness(
                    call_id, user_id
                ))
            )
        
        # Execute parallel tasks
        if tasks:
            task_results = await asyncio.gather(
                *[task[1] for task in tasks],
                return_exceptions=True
            )
            
            for i, (task_name, result) in enumerate(zip([t[0] for t in tasks], task_results)):
                if isinstance(result, Exception):
                    logger.error("analysis_task_failed", 
                                task=task_name, call_id=call_id, error=str(result))
                    results[task_name] = {"error": str(result)}
                else:
                    results[task_name] = result.dict() if hasattr(result, 'dict') else result
        
        # Summary generation (depends on other analyses)
        if "summary" in analysis_types:
            try:
                summary = await summary_generator.generate_call_summary(
                    call_id, user_id, conversations, results
                )
                results["summary"] = summary.dict()
            except Exception as e:
                logger.error("summary_generation_failed", call_id=call_id, error=str(e))
                results["summary"] = {"error": str(e)}
        
        return results
    
    async def _get_conversations(self, call_id: str) -> List[Dict[str, Any]]:
        """Get conversation records for a call."""
        from app.core.database import conversation_queries
        
        conversations = await conversation_queries.get_call_conversations(call_id)
        return [dict(conv) for conv in conversations]
    
    def _extract_conversation_text(self, conversations: List[Dict]) -> str:
        """Extract text from conversation records."""
        texts = []
        for conv in conversations:
            message = conv.get("message_text", "")
            speaker = conv.get("speaker", "")
            if message.strip():
                speaker_label = "来电者" if speaker == "caller" else "AI助手"
                texts.append(f"{speaker_label}: {message}")
        
        return "\n".join(texts)
    
    async def _check_cached_results(
        self, 
        call_id: str, 
        analysis_types: List[str]
    ) -> Optional[Dict[str, Any]]:
        """Check for cached analysis results."""
        cached_results = {}
        
        for analysis_type in analysis_types:
            cached = await analysis_cache.get_analysis(call_id, analysis_type)
            if cached:
                cached_results[analysis_type] = cached
        
        # Return cached results only if we have all requested types
        if len(cached_results) == len(analysis_types):
            return cached_results
        
        return None
    
    async def _store_analysis_results(self, call_id: str, results: Dict[str, Any]) -> None:
        """Store analysis results in database and cache."""
        from app.core.database import conversation_queries
        
        # Store in database
        for analysis_type, result in results.items():
            if "error" not in result:
                await conversation_queries.insert_analysis_result(
                    call_id, analysis_type, result
                )
        
        # Cache results
        await analysis_cache.cache_multiple_analyses(call_id, results)
    
    async def _notify_analysis_complete(self, call_id: str, results: Dict[str, Any]) -> None:
        """Notify other services that analysis is complete."""
        try:
            # Prepare notification data
            notification_data = {
                "call_id": call_id,
                "analysis_complete": True,
                "analysis_types": list(results.keys()),
                "completed_at": datetime.now().isoformat()
            }
            
            # Notify services
            await service_client.notify_analysis_complete(call_id, notification_data)
            
        except Exception as e:
            logger.error("analysis_notification_failed", call_id=call_id, error=str(e))
    
    async def _store_audio_chunk(self, call_id: str, chunk_id: str, audio_data: bytes) -> None:
        """Store audio chunk for later processing."""
        # For MVP, we'll store in Redis with short TTL
        await self.redis_client.setex(
            f"audio_chunk:{call_id}:{chunk_id}",
            300,  # 5 minutes
            audio_data
        )
    
    async def _publish_task_result(
        self, 
        task_id: str, 
        call_id: str, 
        result: Dict[str, Any]
    ) -> None:
        """Publish task result to result queue."""
        result_data = {
            "task_id": task_id,
            "call_id": call_id,
            "result": result,
            "timestamp": datetime.now().isoformat()
        }
        
        await self.redis_client.lpush(
            self.result_queue,
            json.dumps(result_data)
        )
    
    # Performance Monitoring
    async def get_pipeline_metrics(self) -> Dict[str, Any]:
        """Get pipeline performance metrics."""
        # Get queue lengths
        high_queue_len = await self.redis_client.llen(f"{self.task_queue}:high")
        normal_queue_len = await self.redis_client.llen(f"{self.task_queue}:normal")
        low_queue_len = await self.redis_client.llen(f"{self.task_queue}:low")
        
        # Get processing stats
        processing_count = len(self.processing_tasks)
        completed_count = sum(
            1 for task in self.processing_tasks.values() 
            if task.get("status") == "completed"
        )
        failed_count = sum(
            1 for task in self.processing_tasks.values() 
            if task.get("status") == "failed"
        )
        
        return {
            "queue_lengths": {
                "high": high_queue_len,
                "normal": normal_queue_len,
                "low": low_queue_len,
                "total": high_queue_len + normal_queue_len + low_queue_len
            },
            "processing_stats": {
                "active_tasks": processing_count,
                "completed_tasks": completed_count,
                "failed_tasks": failed_count,
                "max_concurrent": self.max_concurrent
            },
            "timestamp": datetime.now().isoformat()
        }


# Singleton instance
realtime_pipeline = RealtimeAnalysisPipeline()