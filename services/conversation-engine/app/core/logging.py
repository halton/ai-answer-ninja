"""
Structured logging configuration for Conversation Engine service.
"""

import logging
import sys
from typing import Any, Dict

import structlog
from structlog.stdlib import LoggerFactory


def setup_logging(log_level: str = "INFO") -> None:
    """Setup structured logging with structlog."""
    
    # Configure structlog processors
    processors = [
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]
    
    # Add JSON formatter for production
    if log_level in ["WARNING", "ERROR", "CRITICAL"]:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))
    
    # Configure structlog
    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    
    # Configure standard logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )
    
    # Set third-party loggers to WARNING
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger(name)


class ConversationLogger:
    """Specialized logger for conversation events."""
    
    def __init__(self, name: str = "conversation"):
        self.logger = get_logger(name)
    
    def log_conversation_start(
        self,
        conversation_id: str,
        user_id: str,
        caller_phone: str,
        personality_type: str
    ) -> None:
        """Log conversation start event."""
        self.logger.info(
            "conversation_started",
            conversation_id=conversation_id,
            user_id=user_id,
            caller_phone=caller_phone,
            personality_type=personality_type
        )
    
    def log_message_processed(
        self,
        conversation_id: str,
        message_type: str,
        processing_time_ms: float,
        confidence_score: float,
        intent: str
    ) -> None:
        """Log message processing event."""
        self.logger.info(
            "message_processed",
            conversation_id=conversation_id,
            message_type=message_type,
            processing_time_ms=processing_time_ms,
            confidence_score=confidence_score,
            intent=intent
        )
    
    def log_response_generated(
        self,
        conversation_id: str,
        response_type: str,
        generation_time_ms: float,
        tokens_used: int,
        personality_applied: str
    ) -> None:
        """Log response generation event."""
        self.logger.info(
            "response_generated",
            conversation_id=conversation_id,
            response_type=response_type,
            generation_time_ms=generation_time_ms,
            tokens_used=tokens_used,
            personality_applied=personality_applied
        )
    
    def log_conversation_terminated(
        self,
        conversation_id: str,
        termination_reason: str,
        total_turns: int,
        duration_seconds: float,
        effectiveness_score: float
    ) -> None:
        """Log conversation termination event."""
        self.logger.info(
            "conversation_terminated",
            conversation_id=conversation_id,
            termination_reason=termination_reason,
            total_turns=total_turns,
            duration_seconds=duration_seconds,
            effectiveness_score=effectiveness_score
        )
    
    def log_error(
        self,
        conversation_id: str,
        error_type: str,
        error_message: str,
        context: Dict[str, Any]
    ) -> None:
        """Log conversation error."""
        self.logger.error(
            "conversation_error",
            conversation_id=conversation_id,
            error_type=error_type,
            error_message=error_message,
            context=context
        )
    
    def log_performance(
        self,
        operation: str,
        duration_ms: float,
        success: bool,
        metadata: Dict[str, Any] = None
    ) -> None:
        """Log performance metrics."""
        self.logger.info(
            "performance_metric",
            operation=operation,
            duration_ms=duration_ms,
            success=success,
            metadata=metadata or {}
        )