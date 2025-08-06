"""
Logging configuration for Profile Analytics Service
"""

import logging
import logging.config
import sys
from typing import Dict, Any

import structlog


def setup_logging(log_level: str = "INFO") -> None:
    """Setup structured logging configuration"""
    
    # Configure standard logging
    logging_config: Dict[str, Any] = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
            },
            "detailed": {
                "format": "%(asctime)s [%(levelname)s] %(name)s:%(lineno)d - %(funcName)s(): %(message)s"
            }
        },
        "handlers": {
            "default": {
                "level": log_level,
                "formatter": "standard",
                "class": "logging.StreamHandler",
                "stream": sys.stdout
            },
            "detailed": {
                "level": log_level,
                "formatter": "detailed",
                "class": "logging.StreamHandler",
                "stream": sys.stdout
            }
        },
        "loggers": {
            "": {
                "handlers": ["default"],
                "level": log_level,
                "propagate": False
            },
            "app": {
                "handlers": ["detailed"],
                "level": log_level,
                "propagate": False
            },
            "uvicorn": {
                "handlers": ["default"],
                "level": "INFO",
                "propagate": False
            },
            "uvicorn.access": {
                "handlers": ["default"],
                "level": "INFO",
                "propagate": False
            },
            "sqlalchemy": {
                "handlers": ["default"],
                "level": "WARNING",
                "propagate": False
            }
        }
    }
    
    logging.config.dictConfig(logging_config)
    
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="ISO"),
            structlog.dev.ConsoleRenderer()
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(log_level)
        ),
        context_class=dict,
        logger_factory=structlog.WriteLoggerFactory(),
        cache_logger_on_first_use=False,
    )


def get_logger(name: str = None) -> structlog.BoundLogger:
    """Get structured logger instance"""
    return structlog.get_logger(name or __name__)


class LoggingMixin:
    """Mixin class to add logging capabilities"""
    
    @property
    def logger(self) -> structlog.BoundLogger:
        """Get logger for this class"""
        return get_logger(self.__class__.__name__)