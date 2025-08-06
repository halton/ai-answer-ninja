"""
Monitoring and performance middleware
"""

import time
from typing import Callable
from datetime import datetime

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from prometheus_client import Counter, Histogram, Gauge

from app.core.logging import get_logger

# Prometheus metrics
REQUEST_COUNT = Counter(
    'profile_analytics_requests_total',
    'Total requests to profile analytics service',
    ['method', 'endpoint', 'status_code']
)

REQUEST_DURATION = Histogram(
    'profile_analytics_request_duration_seconds',
    'Request duration in seconds',
    ['method', 'endpoint']
)

ACTIVE_REQUESTS = Gauge(
    'profile_analytics_active_requests',
    'Number of active requests'
)

ML_PREDICTION_DURATION = Histogram(
    'profile_analytics_ml_prediction_duration_seconds',
    'ML prediction duration in seconds',
    ['model_type']
)

CACHE_OPERATIONS = Counter(
    'profile_analytics_cache_operations_total',
    'Cache operations',
    ['operation', 'status']
)

logger = get_logger(__name__)


class MonitoringMiddleware(BaseHTTPMiddleware):
    """Middleware for monitoring and metrics collection"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Start timing
        start_time = time.time()
        
        # Increment active requests
        ACTIVE_REQUESTS.inc()
        
        # Extract request info
        method = request.method
        path = request.url.path
        
        # Normalize endpoint for metrics (remove IDs)
        endpoint = self._normalize_endpoint(path)
        
        try:
            # Process request
            response = await call_next(request)
            
            # Record metrics
            duration = time.time() - start_time
            status_code = response.status_code
            
            REQUEST_COUNT.labels(
                method=method,
                endpoint=endpoint,
                status_code=status_code
            ).inc()
            
            REQUEST_DURATION.labels(
                method=method,
                endpoint=endpoint
            ).observe(duration)
            
            # Add timing header
            response.headers["X-Process-Time"] = str(duration)
            
            return response
            
        except Exception as e:
            # Record error metrics
            duration = time.time() - start_time
            
            REQUEST_COUNT.labels(
                method=method,
                endpoint=endpoint,
                status_code=500
            ).inc()
            
            REQUEST_DURATION.labels(
                method=method,
                endpoint=endpoint
            ).observe(duration)
            
            logger.error(f"Request error: {e}")
            raise
            
        finally:
            # Decrement active requests
            ACTIVE_REQUESTS.dec()
    
    def _normalize_endpoint(self, path: str) -> str:
        """Normalize endpoint path for metrics"""
        
        # Replace UUID patterns
        import re
        
        # Replace UUIDs with placeholder
        uuid_pattern = r'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        path = re.sub(uuid_pattern, '/{id}', path)
        
        # Replace phone hashes (64 char hex strings)
        hash_pattern = r'/[0-9a-f]{64}'
        path = re.sub(hash_pattern, '/{hash}', path)
        
        # Replace other numeric IDs
        numeric_pattern = r'/\d+'
        path = re.sub(numeric_pattern, '/{id}', path)
        
        return path


def add_monitoring_middleware(app):
    """Add monitoring middleware to FastAPI app"""
    app.add_middleware(MonitoringMiddleware)


class PerformanceOptimizer:
    """Performance optimization utilities"""
    
    @staticmethod
    def record_ml_prediction_time(model_type: str, duration: float):
        """Record ML prediction timing"""
        ML_PREDICTION_DURATION.labels(model_type=model_type).observe(duration)
    
    @staticmethod
    def record_cache_operation(operation: str, success: bool):
        """Record cache operation metrics"""
        status = 'hit' if success and operation == 'get' else 'miss' if not success and operation == 'get' else 'success' if success else 'error'
        CACHE_OPERATIONS.labels(operation=operation, status=status).inc()


class RequestLogger:
    """Request logging utilities"""
    
    @staticmethod
    def log_slow_request(request: Request, duration: float, threshold: float = 1.0):
        """Log slow requests"""
        if duration > threshold:
            logger.warning(
                f"Slow request: {request.method} {request.url.path} "
                f"took {duration:.2f}s (threshold: {threshold}s)"
            )
    
    @staticmethod
    def log_request_details(request: Request, response: Response, duration: float):
        """Log detailed request information"""
        
        logger.info(
            f"Request completed: {request.method} {request.url.path} "
            f"Status: {response.status_code} Duration: {duration:.3f}s"
        )