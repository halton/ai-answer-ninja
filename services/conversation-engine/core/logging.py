import sys
import logging
from typing import Any, Dict
import structlog
from structlog.typing import Processor
from prometheus_client import Counter, Histogram, Gauge

from .config import settings


# Prometheus metrics for logging
log_counter = Counter('conversation_engine_logs_total', 'Total log messages', ['level'])
request_duration = Histogram('conversation_engine_request_duration_seconds', 'Request duration')
active_conversations = Gauge('conversation_engine_active_conversations', 'Active conversations')


class PrometheusProcessor:
    """Structlog processor that updates Prometheus metrics."""
    
    def __call__(self, logger: logging.Logger, method_name: str, event_dict: Dict[str, Any]) -> Dict[str, Any]:
        # Update log counter
        level = event_dict.get('level', 'info')
        log_counter.labels(level=level).inc()
        
        # Track request durations if present
        if 'duration' in event_dict:
            request_duration.observe(event_dict['duration'])
        
        # Track active conversations
        if 'active_conversations' in event_dict:
            active_conversations.set(event_dict['active_conversations'])
        
        return event_dict


def setup_logging() -> None:
    """Configure structured logging with Prometheus metrics."""
    
    # Configure log level
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)
    
    # Processors for structlog
    processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.add_logger_name,
        structlog.processors.TimeStamper(fmt="ISO"),
        structlog.processors.CallsiteParameterAdder(
            parameters=[structlog.processors.CallsiteParameter.FILENAME,
                       structlog.processors.CallsiteParameter.LINENO]
        ),
    ]
    
    # Add Prometheus processor if enabled
    if settings.enable_prometheus:
        processors.append(PrometheusProcessor())
    
    if settings.debug:
        # Development logging - pretty console output
        processors.extend([
            structlog.dev.set_exc_info,
            structlog.dev.ConsoleRenderer(colors=True)
        ])
    else:
        # Production logging - JSON output
        processors.extend([
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer()
        ])
    
    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.WriteLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    
    # Configure standard logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )
    
    # Suppress noisy loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)


class ConversationLogger:
    """Specialized logger for conversation events."""
    
    def __init__(self, call_id: str, user_id: str):
        self.logger = structlog.get_logger(__name__)
        self.call_id = call_id
        self.user_id = user_id
    
    def _bind_context(self, **kwargs) -> structlog.BoundLogger:
        """Bind conversation context to logger."""
        return self.logger.bind(
            call_id=self.call_id,
            user_id=self.user_id,
            **kwargs
        )
    
    def conversation_started(self, intent: str, caller_phone: str) -> None:
        """Log conversation start."""
        self._bind_context(
            event="conversation_started",
            intent=intent,
            caller_phone=caller_phone[:6] + "****"  # Mask phone number
        ).info("Conversation started")
    
    def response_generated(
        self, 
        intent: str, 
        response_text: str, 
        duration_ms: float,
        cached: bool = False
    ) -> None:
        """Log AI response generation."""
        self._bind_context(
            event="response_generated",
            intent=intent,
            response_length=len(response_text),
            duration_ms=duration_ms,
            cached=cached
        ).info("AI response generated")
    
    def emotion_detected(self, emotion: str, confidence: float) -> None:
        """Log emotion detection."""
        self._bind_context(
            event="emotion_detected",
            emotion=emotion,
            confidence=confidence
        ).info("Emotion detected")
    
    def conversation_ended(
        self, 
        reason: str, 
        total_duration_ms: float, 
        turn_count: int
    ) -> None:
        """Log conversation end."""
        self._bind_context(
            event="conversation_ended",
            reason=reason,
            total_duration_ms=total_duration_ms,
            turn_count=turn_count
        ).info("Conversation ended")
    
    def error_occurred(self, error: Exception, context: str) -> None:
        """Log conversation error."""
        self._bind_context(
            event="conversation_error",
            error_type=type(error).__name__,
            error_message=str(error),
            context=context
        ).error("Conversation error occurred")
    
    def performance_warning(
        self, 
        operation: str, 
        duration_ms: float, 
        threshold_ms: float
    ) -> None:
        """Log performance warning."""
        self._bind_context(
            event="performance_warning",
            operation=operation,
            duration_ms=duration_ms,
            threshold_ms=threshold_ms,
            exceeded_by_ms=duration_ms - threshold_ms
        ).warning("Performance threshold exceeded")


# Initialize logging on module import
setup_logging()
