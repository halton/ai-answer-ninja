"""
Redis cache connection and management.
"""

import json
from typing import Any, Optional, Union

import redis.asyncio as redis
from redis.asyncio import ConnectionPool

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Global Redis connection
redis_client: Optional[redis.Redis] = None


async def init_cache() -> None:
    """Initialize Redis cache connection."""
    global redis_client
    
    settings = get_settings()
    
    try:
        # Create connection pool
        pool = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=settings.redis_pool_size,
            socket_timeout=settings.redis_timeout,
            socket_connect_timeout=settings.redis_timeout,
            decode_responses=True,
        )
        
        # Create Redis client
        redis_client = redis.Redis(connection_pool=pool)
        
        # Test connection
        await redis_client.ping()
        
        logger.info("Redis cache connection initialized")
        
    except Exception as e:
        logger.error("Failed to initialize Redis cache", error=str(e))
        raise


async def close_cache() -> None:
    """Close Redis cache connection."""
    global redis_client
    
    if redis_client:
        await redis_client.close()
        logger.info("Redis cache connection closed")


def get_cache() -> redis.Redis:
    """Get Redis cache client."""
    if not redis_client:
        raise RuntimeError("Cache not initialized")
    return redis_client


class CacheManager:
    """Cache management utilities."""
    
    def __init__(self):
        self.client = get_cache()
    
    async def get(
        self,
        key: str,
        default: Any = None
    ) -> Any:
        """Get value from cache."""
        try:
            value = await self.client.get(key)
            if value is None:
                return default
            return json.loads(value)
        except Exception as e:
            logger.error(f"Cache get error for key {key}", error=str(e))
            return default
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None
    ) -> bool:
        """Set value in cache."""
        try:
            serialized = json.dumps(value, default=str)
            if ttl:
                return await self.client.setex(key, ttl, serialized)
            else:
                return await self.client.set(key, serialized)
        except Exception as e:
            logger.error(f"Cache set error for key {key}", error=str(e))
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete key from cache."""
        try:
            return await self.client.delete(key) > 0
        except Exception as e:
            logger.error(f"Cache delete error for key {key}", error=str(e))
            return False
    
    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        try:
            return await self.client.exists(key) > 0
        except Exception as e:
            logger.error(f"Cache exists error for key {key}", error=str(e))
            return False
    
    async def get_or_set(
        self,
        key: str,
        factory,
        ttl: Optional[int] = None
    ) -> Any:
        """Get value from cache or set it using factory function."""
        value = await self.get(key)
        if value is not None:
            return value
        
        # Generate value using factory
        if callable(factory):
            value = await factory() if hasattr(factory, '__call__') else factory
        else:
            value = factory
        
        await self.set(key, value, ttl)
        return value
    
    async def increment(
        self,
        key: str,
        amount: int = 1
    ) -> int:
        """Increment counter in cache."""
        try:
            return await self.client.incrby(key, amount)
        except Exception as e:
            logger.error(f"Cache increment error for key {key}", error=str(e))
            return 0
    
    async def expire(
        self,
        key: str,
        ttl: int
    ) -> bool:
        """Set expiration for key."""
        try:
            return await self.client.expire(key, ttl)
        except Exception as e:
            logger.error(f"Cache expire error for key {key}", error=str(e))
            return False
    
    def get_key(self, *parts: str) -> str:
        """Generate cache key from parts."""
        return ":".join(str(part) for part in parts)


# Cache key patterns
class CacheKeys:
    """Standard cache key patterns."""
    
    @staticmethod
    def user_profile(user_id: str) -> str:
        return f"user:profile:{user_id}"
    
    @staticmethod
    def conversation_state(conversation_id: str) -> str:
        return f"conversation:state:{conversation_id}"
    
    @staticmethod
    def conversation_history(conversation_id: str) -> str:
        return f"conversation:history:{conversation_id}"
    
    @staticmethod
    def personality_cache(user_id: str) -> str:
        return f"personality:{user_id}"
    
    @staticmethod
    def response_template(intent: str, personality: str) -> str:
        return f"template:{intent}:{personality}"
    
    @staticmethod
    def sentiment_cache(text_hash: str) -> str:
        return f"sentiment:{text_hash}"
    
    @staticmethod
    def emotion_cache(text_hash: str) -> str:
        return f"emotion:{text_hash}"
    
    @staticmethod
    def spam_profile(phone_hash: str) -> str:
        return f"spam:profile:{phone_hash}"
    
    @staticmethod
    def conversation_metrics(conversation_id: str) -> str:
        return f"metrics:conversation:{conversation_id}"