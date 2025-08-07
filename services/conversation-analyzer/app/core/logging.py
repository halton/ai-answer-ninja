"""Structured logging configuration for Conversation Analyzer."""

import logging
import sys
from typing import Any, Dict

import structlog
from rich.console import Console
from rich.logging import RichHandler

from app.core.config import settings


def setup_logging() -> None:
    """Setup structured logging with rich console output."""
    
    # Configure standard logging
    logging.basicConfig(
        level=getattr(logging, settings.log_level),
        format="%(message)s",
        datefmt="[%X]",
        handlers=[
            RichHandler(
                console=Console(stderr=True),
                show_time=True,
                show_path=True,
                markup=True,
                rich_tracebacks=True,
            )
        ],
    )
    
    # Configure structlog
    structlog.configure(
        processors=[
            # Add timestamp
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            # Add context processors
            structlog.processors.CallsiteParameterAdder(
                parameters=[
                    structlog.processors.CallsiteParameter.FUNC_NAME,
                    structlog.processors.CallsiteParameter.LINENO,
                ]
            ),
            # Output processor
            structlog.dev.ConsoleRenderer(colors=True) if settings.debug
            else structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = None) -> structlog.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger(name)


class LoggerMixin:
    """Mixin class to add logging capability to other classes."""
    
    @property
    def logger(self) -> structlog.BoundLogger:
        """Get logger instance for this class."""
        return get_logger(self.__class__.__name__)


class AnalysisLogger:
    """Specialized logger for conversation analysis operations."""
    
    def __init__(self):
        self.logger = get_logger("analysis")
    
    def log_transcription_start(self, call_id: str, audio_duration: float) -> None:
        """Log transcription start."""
        self.logger.info(
            "transcription_started",
            call_id=call_id,
            audio_duration=audio_duration,
            operation="transcription"
        )
    
    def log_transcription_complete(
        self, 
        call_id: str, 
        duration_ms: int, 
        confidence: float, 
        text_length: int
    ) -> None:
        """Log transcription completion."""
        self.logger.info(
            "transcription_completed",
            call_id=call_id,
            duration_ms=duration_ms,
            confidence=confidence,
            text_length=text_length,
            operation="transcription"
        )
    
    def log_analysis_start(self, call_id: str, analysis_type: str) -> None:
        """Log analysis start."""
        self.logger.info(
            "analysis_started",
            call_id=call_id,
            analysis_type=analysis_type,
            operation="analysis"
        )
    
    def log_analysis_complete(
        self, 
        call_id: str, 
        analysis_type: str, 
        duration_ms: int, 
        results: Dict[str, Any]
    ) -> None:
        """Log analysis completion."""
        self.logger.info(
            "analysis_completed",
            call_id=call_id,
            analysis_type=analysis_type,
            duration_ms=duration_ms,
            results_summary=self._summarize_results(results),
            operation="analysis"
        )
    
    def log_summary_generated(
        self, 
        call_id: str, 
        summary_length: int, 
        generation_time_ms: int
    ) -> None:
        """Log summary generation."""
        self.logger.info(
            "summary_generated",
            call_id=call_id,
            summary_length=summary_length,
            generation_time_ms=generation_time_ms,
            operation="summary"
        )
    
    def log_error(
        self, 
        operation: str, 
        call_id: str, 
        error: Exception, 
        context: Dict[str, Any] = None
    ) -> None:
        """Log analysis error."""
        self.logger.error(
            "analysis_error",
            operation=operation,
            call_id=call_id,
            error_type=type(error).__name__,
            error_message=str(error),
            context=context or {},
        )
    
    def log_performance_metrics(
        self, 
        operation: str, 
        metrics: Dict[str, Any]
    ) -> None:
        """Log performance metrics."""
        self.logger.info(
            "performance_metrics",
            operation=operation,
            **metrics
        )
    
    def _summarize_results(self, results: Dict[str, Any]) -> Dict[str, Any]:
        """Summarize analysis results for logging."""
        summary = {}
        
        if "sentiment" in results:
            summary["sentiment"] = results["sentiment"].get("label", "unknown")
            summary["sentiment_confidence"] = results["sentiment"].get("confidence", 0.0)
        
        if "intent" in results:
            summary["intent"] = results["intent"].get("category", "unknown")
            summary["intent_confidence"] = results["intent"].get("confidence", 0.0)
        
        if "keywords" in results:
            summary["keyword_count"] = len(results["keywords"])
        
        if "entities" in results:
            summary["entity_count"] = len(results["entities"])
        
        return summary


class PerformanceLogger:
    """Performance and metrics logger."""
    
    def __init__(self):
        self.logger = get_logger("performance")
    
    def log_latency(self, operation: str, latency_ms: int, **context) -> None:
        """Log operation latency."""
        self.logger.info(
            "operation_latency",
            operation=operation,
            latency_ms=latency_ms,
            **context
        )
    
    def log_throughput(self, operation: str, count: int, duration_ms: int) -> None:
        """Log operation throughput."""
        throughput = (count * 1000) / duration_ms if duration_ms > 0 else 0
        self.logger.info(
            "operation_throughput",
            operation=operation,
            count=count,
            duration_ms=duration_ms,
            throughput_per_second=round(throughput, 2)
        )
    
    def log_resource_usage(self, **metrics) -> None:
        """Log resource usage metrics."""
        self.logger.info("resource_usage", **metrics)


# Global logger instances
analysis_logger = AnalysisLogger()
performance_logger = PerformanceLogger()