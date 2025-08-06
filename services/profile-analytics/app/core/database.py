"""
Database configuration and management
"""

import logging
from typing import AsyncGenerator, Optional

from sqlalchemy import event, pool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from .config import get_settings

logger = logging.getLogger(__name__)

Base = declarative_base()

# Global variables for database connections
engine: Optional[object] = None
async_session_maker: Optional[async_sessionmaker] = None


async def init_db() -> None:
    """Initialize database connection"""
    global engine, async_session_maker
    
    settings = get_settings()
    
    # Create async engine
    engine = create_async_engine(
        str(settings.database_url),
        poolclass=pool.QueuePool,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_pool_overflow,
        pool_pre_ping=True,
        pool_recycle=3600,  # Recycle connections after 1 hour
        echo=settings.environment == "development",
    )
    
    # Create session maker
    async_session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    logger.info("Database initialized successfully")


async def close_db() -> None:
    """Close database connections"""
    global engine
    
    if engine:
        await engine.dispose()
        logger.info("Database connections closed")


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Get database session"""
    if not async_session_maker:
        raise RuntimeError("Database not initialized")
    
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Database event listeners for optimization
@event.listens_for(engine, "connect", once=True)
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Set SQLite pragma for better performance (if using SQLite)"""
    if "sqlite" in str(engine.url):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=10000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()


class DatabaseHealthCheck:
    """Database health check utility"""
    
    @staticmethod
    async def check_connection() -> bool:
        """Check if database connection is healthy"""
        try:
            if not engine:
                return False
            
            async with engine.begin() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return False
    
    @staticmethod
    async def get_connection_info() -> dict:
        """Get database connection information"""
        if not engine:
            return {"status": "not_initialized"}
        
        pool_status = engine.pool.status() if hasattr(engine, 'pool') else "unknown"
        
        return {
            "status": "initialized",
            "url": str(engine.url).replace(engine.url.password or '', '***'),
            "pool_status": pool_status,
            "dialect": engine.dialect.name,
        }