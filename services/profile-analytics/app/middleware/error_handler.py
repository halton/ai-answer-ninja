"""
Error handling middleware
"""

import traceback
from typing import Dict, Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import get_logger

logger = get_logger(__name__)


class ErrorHandlerMiddleware(BaseHTTPMiddleware):
    """Middleware for centralized error handling"""
    
    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response
            
        except HTTPException as http_exc:
            # Let FastAPI handle HTTP exceptions normally
            raise http_exc
            
        except Exception as exc:
            # Handle unexpected exceptions
            error_id = self._generate_error_id()
            
            logger.error(
                f"Unhandled exception [{error_id}]: {str(exc)}",
                extra={
                    "error_id": error_id,
                    "path": request.url.path,
                    "method": request.method,
                    "traceback": traceback.format_exc()
                }
            )
            
            # Return standardized error response
            error_response = {
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "An internal server error occurred",
                    "error_id": error_id,
                    "timestamp": self._get_timestamp()
                }
            }
            
            return JSONResponse(
                status_code=500,
                content=error_response
            )
    
    def _generate_error_id(self) -> str:
        """Generate unique error ID"""
        import uuid
        return str(uuid.uuid4())[:8]
    
    def _get_timestamp(self) -> str:
        """Get current timestamp"""
        from datetime import datetime
        return datetime.utcnow().isoformat()


def add_error_handlers(app):
    """Add error handlers to FastAPI app"""
    
    app.add_middleware(ErrorHandlerMiddleware)
    
    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "code": "INVALID_INPUT",
                    "message": str(exc),
                    "timestamp": datetime.utcnow().isoformat()
                }
            }
        )
    
    @app.exception_handler(ConnectionError)
    async def connection_error_handler(request: Request, exc: ConnectionError):
        logger.error(f"Connection error: {exc}")
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "SERVICE_UNAVAILABLE",
                    "message": "External service temporarily unavailable",
                    "timestamp": datetime.utcnow().isoformat()
                }
            }
        )
    
    @app.exception_handler(TimeoutError)
    async def timeout_error_handler(request: Request, exc: TimeoutError):
        logger.error(f"Timeout error: {exc}")
        return JSONResponse(
            status_code=504,
            content={
                "error": {
                    "code": "TIMEOUT",
                    "message": "Request timeout",
                    "timestamp": datetime.utcnow().isoformat()
                }
            }
        )