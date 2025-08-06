import json
import pickle
from typing import Any, Optional, Dict, List
from datetime import datetime, timedelta
import redis.asyncio as redis
from redis.asyncio import Redis
import structlog

from .config import settings

logger = structlog.get_logger(__name__)


class CacheManager:
    """Async Redis cache manager with advanced features."""
    
    def __init__(self):
        self.redis: Optional[Redis] = None
        self._connection_pool = None
        
    async def connect(self) -> None:
        """Connect to Redis."""
        try:
            self._connection_pool = redis.ConnectionPool.from_url(
                settings.redis_url,
                max_connections=settings.redis_max_connections,
                decode_responses=False
            )
            self.redis = Redis(connection_pool=self._connection_pool)
            
            # Test connection
            await self.redis.ping()
            logger.info("Redis cache connected successfully")
        except Exception as e:
            logger.error("Failed to connect to Redis", error=str(e))
            raise
    
    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self.redis:
            await self.redis.close()
            logger.info("Redis cache disconnected")
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        try:
            if not self.redis:
                return None
            
            value = await self.redis.get(key)
            if value is None:
                return None
            
            # Try JSON first, fallback to pickle
            try:
                return json.loads(value.decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return pickle.loads(value)
        except Exception as e:
            logger.warning("Cache get failed", key=key, error=str(e))
            return None
    
    async def set(
        self, 
        key: str, 
        value: Any, 
        ttl: Optional[int] = None
    ) -> bool:
        """Set value in cache with optional TTL."""
        try:
            if not self.redis:
                return False
            
            # Try JSON first, fallback to pickle
            try:
                serialized_value = json.dumps(value).encode('utf-8')
            except (TypeError, ValueError):
                serialized_value = pickle.dumps(value)
            
            if ttl:
                await self.redis.setex(key, ttl, serialized_value)
            else:
                await self.redis.set(key, serialized_value)
            
            return True
        except Exception as e:
            logger.warning("Cache set failed", key=key, error=str(e))
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete key from cache."""
        try:
            if not self.redis:
                return False
            
            result = await self.redis.delete(key)
            return result > 0
        except Exception as e:
            logger.warning("Cache delete failed", key=key, error=str(e))
            return False
    
    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        try:
            if not self.redis:
                return False
            
            return await self.redis.exists(key) > 0
        except Exception as e:
            logger.warning("Cache exists check failed", key=key, error=str(e))
            return False
    
    async def get_many(self, keys: List[str]) -> Dict[str, Any]:
        """Get multiple values from cache."""
        result = {}
        try:
            if not self.redis or not keys:
                return result
            
            values = await self.redis.mget(keys)
            for key, value in zip(keys, values):
                if value is not None:
                    try:
                        result[key] = json.loads(value.decode('utf-8'))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        result[key] = pickle.loads(value)
        except Exception as e:
            logger.warning("Cache get_many failed", keys=keys, error=str(e))
        
        return result
    
    async def set_many(
        self, 
        mapping: Dict[str, Any], 
        ttl: Optional[int] = None
    ) -> bool:
        """Set multiple values in cache."""
        try:
            if not self.redis or not mapping:
                return False
            
            pipeline = self.redis.pipeline()
            
            for key, value in mapping.items():
                try:
                    serialized_value = json.dumps(value).encode('utf-8')
                except (TypeError, ValueError):
                    serialized_value = pickle.dumps(value)
                
                if ttl:
                    pipeline.setex(key, ttl, serialized_value)
                else:
                    pipeline.set(key, serialized_value)
            
            await pipeline.execute()
            return True
        except Exception as e:
            logger.warning("Cache set_many failed", mapping_keys=list(mapping.keys()), error=str(e))
            return False
    
    async def increment(self, key: str, amount: int = 1) -> Optional[int]:
        """Increment numeric value in cache."""
        try:
            if not self.redis:
                return None
            
            return await self.redis.incrby(key, amount)
        except Exception as e:
            logger.warning("Cache increment failed", key=key, error=str(e))
            return None
    
    async def expire(self, key: str, ttl: int) -> bool:
        """Set expiration time for key."""
        try:
            if not self.redis:
                return False
            
            return await self.redis.expire(key, ttl)
        except Exception as e:
            logger.warning("Cache expire failed", key=key, error=str(e))
            return False
    
    async def get_ttl(self, key: str) -> Optional[int]:
        """Get TTL for key."""
        try:
            if not self.redis:
                return None
            
            ttl = await self.redis.ttl(key)
            return ttl if ttl >= 0 else None
        except Exception as e:
            logger.warning("Cache get_ttl failed", key=key, error=str(e))
            return None
    
    async def clear_pattern(self, pattern: str) -> int:
        """Clear all keys matching pattern."""
        try:
            if not self.redis:
                return 0
            
            keys = await self.redis.keys(pattern)
            if keys:
                return await self.redis.delete(*keys)
            return 0
        except Exception as e:
            logger.warning("Cache clear_pattern failed", pattern=pattern, error=str(e))
            return 0


# Global cache manager instance
cache_manager = CacheManager()


class ConversationCache:
    """Specialized cache for conversation data."""
    
    def __init__(self, cache: CacheManager):
        self.cache = cache
        self.default_ttl = settings.cache_ttl_seconds
    
    def _conversation_key(self, call_id: str) -> str:
        return f"conversation:{call_id}"
    
    def _user_profile_key(self, user_id: str) -> str:
        return f"user_profile:{user_id}"
    
    def _response_cache_key(self, intent: str, context_hash: str) -> str:
        return f"response:{intent}:{context_hash}"
    
    def _conversation_state_key(self, call_id: str) -> str:
        return f"state:{call_id}"
    
    async def get_conversation_history(self, call_id: str) -> Optional[List[Dict]]:
        """Get conversation history from cache."""
        return await self.cache.get(self._conversation_key(call_id))
    
    async def set_conversation_history(
        self, 
        call_id: str, 
        history: List[Dict], 
        ttl: Optional[int] = None
    ) -> bool:
        """Set conversation history in cache."""
        return await self.cache.set(
            self._conversation_key(call_id), 
            history, 
            ttl or self.default_ttl
        )
    
    async def get_user_profile(self, user_id: str) -> Optional[Dict]:
        """Get user profile from cache."""
        return await self.cache.get(self._user_profile_key(user_id))
    
    async def set_user_profile(
        self, 
        user_id: str, 
        profile: Dict, 
        ttl: Optional[int] = None
    ) -> bool:
        """Set user profile in cache."""
        return await self.cache.set(
            self._user_profile_key(user_id), 
            profile, 
            ttl or self.default_ttl
        )
    
    async def get_cached_response(
        self, 
        intent: str, 
        context_hash: str
    ) -> Optional[Dict]:
        """Get cached response for intent and context."""
        return await self.cache.get(self._response_cache_key(intent, context_hash))
    
    async def set_cached_response(
        self, 
        intent: str, 
        context_hash: str, 
        response: Dict, 
        ttl: Optional[int] = None
    ) -> bool:
        """Cache response for intent and context."""
        return await self.cache.set(
            self._response_cache_key(intent, context_hash), 
            response, 
            ttl or self.default_ttl
        )
    
    async def get_conversation_state(self, call_id: str) -> Optional[Dict]:
        """Get conversation state from cache."""
        return await self.cache.get(self._conversation_state_key(call_id))
    
    async def set_conversation_state(
        self, 
        call_id: str, 
        state: Dict, 
        ttl: Optional[int] = None
    ) -> bool:
        """Set conversation state in cache."""
        return await self.cache.set(
            self._conversation_state_key(call_id), 
            state, 
            ttl or self.default_ttl
        )
    
    async def clear_conversation_data(self, call_id: str) -> None:
        """Clear all conversation-related data."""
        await self.cache.delete(self._conversation_key(call_id))
        await self.cache.delete(self._conversation_state_key(call_id))


# Global conversation cache instance
conversation_cache = ConversationCache(cache_manager)
