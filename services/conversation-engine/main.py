"""
Conversation Engine Service
Advanced conversation management for AI Answer Ninja
"""

import os
import sys
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from prometheus_client import make_asgi_app

# Add app directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.core.config import get_settings
from app.core.database import init_db, close_db
from app.core.cache import init_cache, close_cache
from app.core.logging import setup_logging
from app.api.v1 import conversation, health, metrics
from app.middleware.monitoring import add_monitoring_middleware
from app.middleware.error_handler import add_error_handlers


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager."""
    settings = get_settings()
    
    # Startup
    await init_db()
    await init_cache()
    logging.info("Conversation Engine service started")
    
    yield
    
    # Shutdown
    await close_cache()
    await close_db()
    logging.info("Conversation Engine service stopped")


def create_app() -> FastAPI:
    """Create and configure FastAPI application."""
    settings = get_settings()
    
    # Setup logging
    setup_logging(settings.log_level)
    
    app = FastAPI(
        title="Conversation Engine Service",
        description="Advanced conversation management for AI Answer Ninja",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.environment == "development" else None,
        redoc_url="/redoc" if settings.environment == "development" else None,
    )
    
    # Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    
    # Custom middleware
    add_monitoring_middleware(app)
    add_error_handlers(app)
    
    # API Routes
    app.include_router(
        conversation.router,
        prefix="/api/v1/conversation",
        tags=["conversation"]
    )
    app.include_router(
        health.router,
        prefix="/api/v1/health",
        tags=["health"]
    )
    app.include_router(
        metrics.router,
        prefix="/api/v1/metrics",
        tags=["metrics"]
    )
    
    # Prometheus metrics endpoint
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)
    
    return app


app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
        log_level=settings.log_level.lower(),
        access_log=True,
    )