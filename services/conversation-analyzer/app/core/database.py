"""Database connection and session management."""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import asyncpg
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


class DatabaseManager:
    """Database connection and session manager."""
    
    def __init__(self):
        self.engine = None
        self.session_factory = None
        self._pool: Optional[asyncpg.Pool] = None
    
    async def initialize(self) -> None:
        """Initialize database connections."""
        try:
            # Create SQLAlchemy async engine
            self.engine = create_async_engine(
                settings.database_url,
                echo=settings.debug,
                pool_size=10,
                max_overflow=20,
                pool_pre_ping=True,
                pool_recycle=3600,
            )
            
            # Create session factory
            self.session_factory = async_sessionmaker(
                self.engine,
                class_=AsyncSession,
                expire_on_commit=False
            )
            
            # Create asyncpg connection pool for raw SQL queries
            self._pool = await asyncpg.create_pool(
                settings.database_url,
                min_size=5,
                max_size=20,
                command_timeout=60,
            )
            
            logger.info("database_initialized", pool_size=20)
            
        except Exception as e:
            logger.error("database_initialization_failed", error=str(e))
            raise
    
    async def close(self) -> None:
        """Close database connections."""
        try:
            if self.engine:
                await self.engine.dispose()
            
            if self._pool:
                await self._pool.close()
            
            logger.info("database_connections_closed")
            
        except Exception as e:
            logger.error("database_close_error", error=str(e))
    
    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """Get database session with automatic cleanup."""
        if not self.session_factory:
            raise RuntimeError("Database not initialized")
        
        async with self.session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
    
    @asynccontextmanager
    async def get_connection(self) -> AsyncGenerator[asyncpg.Connection, None]:
        """Get raw database connection for optimized queries."""
        if not self._pool:
            raise RuntimeError("Database pool not initialized")
        
        async with self._pool.acquire() as connection:
            yield connection
    
    async def execute_raw_query(self, query: str, *args) -> list:
        """Execute raw SQL query with parameters."""
        async with self.get_connection() as conn:
            return await conn.fetch(query, *args)
    
    async def execute_raw_command(self, command: str, *args) -> str:
        """Execute raw SQL command with parameters."""
        async with self.get_connection() as conn:
            return await conn.execute(command, *args)
    
    async def health_check(self) -> bool:
        """Check database health."""
        try:
            async with self.get_connection() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception as e:
            logger.error("database_health_check_failed", error=str(e))
            return False


# Global database manager instance
db_manager = DatabaseManager()


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency to get database session."""
    async with db_manager.get_session() as session:
        yield session


async def get_db_connection() -> AsyncGenerator[asyncpg.Connection, None]:
    """Dependency to get raw database connection."""
    async with db_manager.get_connection() as connection:
        yield connection


class ConversationQueries:
    """Optimized queries for conversation analysis."""
    
    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
    
    async def get_call_conversations(self, call_id: str) -> list:
        """Get all conversations for a specific call."""
        query = """
        SELECT 
            id,
            sequence_number,
            speaker,
            message_text,
            timestamp,
            confidence_score,
            intent_category,
            emotion,
            processing_latency,
            message_length
        FROM conversations 
        WHERE call_record_id = $1 
        ORDER BY sequence_number ASC
        """
        return await self.db.execute_raw_query(query, call_id)
    
    async def get_recent_user_conversations(self, user_id: str, limit: int = 100) -> list:
        """Get recent conversations for a user."""
        query = """
        SELECT 
            c.id,
            c.call_record_id,
            c.speaker,
            c.message_text,
            c.timestamp,
            c.intent_category,
            c.emotion,
            cr.caller_phone,
            cr.call_type
        FROM conversations c
        JOIN call_records cr ON c.call_record_id = cr.id
        WHERE cr.user_id = $1
          AND c.timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days'
        ORDER BY c.timestamp DESC
        LIMIT $2
        """
        return await self.db.execute_raw_query(query, user_id, limit)
    
    async def get_caller_conversation_history(self, caller_phone: str, limit: int = 50) -> list:
        """Get conversation history for a specific caller."""
        query = """
        SELECT 
            c.message_text,
            c.intent_category,
            c.emotion,
            c.timestamp,
            cr.call_status,
            cr.duration_seconds
        FROM conversations c
        JOIN call_records cr ON c.call_record_id = cr.id
        WHERE cr.caller_phone = $1
          AND c.timestamp > CURRENT_TIMESTAMP - INTERVAL '90 days'
        ORDER BY c.timestamp DESC
        LIMIT $2
        """
        return await self.db.execute_raw_query(query, caller_phone, limit)
    
    async def insert_analysis_result(
        self, 
        call_id: str, 
        analysis_type: str, 
        results: dict
    ) -> str:
        """Insert analysis results into database."""
        query = """
        INSERT INTO analysis_results (
            call_record_id,
            analysis_type,
            results,
            created_at
        ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING id
        """
        result = await self.db.execute_raw_query(
            query, 
            call_id, 
            analysis_type, 
            results
        )
        return result[0]['id']
    
    async def get_analysis_results(self, call_id: str, analysis_type: str = None) -> list:
        """Get analysis results for a call."""
        if analysis_type:
            query = """
            SELECT * FROM analysis_results 
            WHERE call_record_id = $1 AND analysis_type = $2
            ORDER BY created_at DESC
            """
            return await self.db.execute_raw_query(query, call_id, analysis_type)
        else:
            query = """
            SELECT * FROM analysis_results 
            WHERE call_record_id = $1
            ORDER BY created_at DESC
            """
            return await self.db.execute_raw_query(query, call_id)
    
    async def update_call_analysis_metadata(
        self, 
        call_id: str, 
        metadata: dict
    ) -> None:
        """Update call record with analysis metadata."""
        query = """
        UPDATE call_records 
        SET processing_metadata = COALESCE(processing_metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        """
        await self.db.execute_raw_command(query, call_id, metadata)
    
    async def get_conversation_statistics(self, user_id: str, days: int = 30) -> dict:
        """Get conversation statistics for a user."""
        query = """
        SELECT 
            COUNT(*) as total_conversations,
            COUNT(DISTINCT cr.caller_phone) as unique_callers,
            AVG(c.processing_latency) as avg_processing_latency,
            COUNT(*) FILTER (WHERE c.intent_category = 'sales_call') as sales_calls,
            COUNT(*) FILTER (WHERE c.intent_category = 'loan_offer') as loan_calls,
            COUNT(*) FILTER (WHERE c.intent_category = 'investment_pitch') as investment_calls,
            COUNT(*) FILTER (WHERE c.emotion = 'frustrated') as frustrated_calls,
            COUNT(*) FILTER (WHERE c.emotion = 'aggressive') as aggressive_calls
        FROM conversations c
        JOIN call_records cr ON c.call_record_id = cr.id
        WHERE cr.user_id = $1
          AND c.timestamp > CURRENT_TIMESTAMP - INTERVAL '%s days'
        """ % days
        
        result = await self.db.execute_raw_query(query, user_id)
        return dict(result[0]) if result else {}


# Global queries instance
conversation_queries = ConversationQueries(db_manager)