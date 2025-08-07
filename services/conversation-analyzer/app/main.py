"""Main application module for Conversation Analyzer Service."""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.core.database import db_manager
from app.core.cache import cache_manager
from app.api.v1 import analysis
from app.pipelines.realtime_processor import realtime_pipeline

# Setup logging
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager."""
    # Startup
    logger.info("starting_conversation_analyzer_service", version="1.0.0")
    
    try:
        # Initialize database
        await db_manager.initialize()
        logger.info("database_initialized")
        
        # Initialize cache
        await cache_manager.initialize()
        logger.info("cache_initialized")
        
        # Initialize realtime pipeline
        await realtime_pipeline.initialize()
        logger.info("realtime_pipeline_initialized")
        
        # Start background task processor
        asyncio.create_task(realtime_pipeline.process_queued_tasks())
        logger.info("background_task_processor_started")
        
        logger.info("conversation_analyzer_service_ready", port=settings.service_port)
        
    except Exception as e:
        logger.error("service_startup_failed", error=str(e))
        raise
    
    yield
    
    # Shutdown
    logger.info("shutting_down_conversation_analyzer_service")
    
    try:
        await realtime_pipeline.close()
        await cache_manager.close()
        await db_manager.close()
        logger.info("conversation_analyzer_service_shutdown_complete")
        
    except Exception as e:
        logger.error("service_shutdown_error", error=str(e))


# Create FastAPI application
app = FastAPI(
    title="Conversation Analyzer Service",
    description="通话内容分析和总结服务，提供实时和批量的通话分析功能",
    version="1.0.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


# Include API routers
app.include_router(
    analysis.router,
    prefix="/api/v1/analysis",
    tags=["analysis"]
)


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "conversation-analyzer",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs" if settings.debug else None
    }


# Health check endpoint
@app.get("/health")
async def health():
    """Health check endpoint."""
    return await analysis.health_check()


# Metrics endpoint
@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    # This would typically return Prometheus format metrics
    # For now, return basic pipeline metrics
    try:
        pipeline_metrics = await realtime_pipeline.get_pipeline_metrics()
        return pipeline_metrics
    except Exception as e:
        logger.error("metrics_endpoint_error", error=str(e))
        return {"error": str(e)}


# Error handlers
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler."""
    logger.error(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        error=str(exc)
    )
    
    return {
        "error": "Internal server error",
        "message": str(exc) if settings.debug else "An error occurred"
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.service_host,
        port=settings.service_port,
        log_level=settings.log_level.lower(),
        reload=settings.debug
    )