"""Redis cache implementation for conversation analyzer."""

import json
import pickle
from typing import Any, Dict, List, Optional, Union
from datetime import timedelta

import redis.asyncio as redis
from redis.asyncio import Redis

from app.core.config import settings, CacheConfig
from app.core.logging import get_logger

logger = get_logger(__name__)


class CacheManager:
    """Redis cache manager with typed operations."""
    
    def __init__(self):
        self.redis: Optional[Redis] = None
        self.config = CacheConfig()
    
    async def initialize(self) -> None:
        """Initialize Redis connection."""
        try:
            self.redis = redis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=False,  # We handle encoding manually
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
                health_check_interval=30,
            )
            
            # Test connection
            await self.redis.ping()
            logger.info("redis_cache_initialized", url=settings.redis_url)
            
        except Exception as e:
            logger.error("redis_cache_initialization_failed", error=str(e))
            raise
    
    async def close(self) -> None:
        """Close Redis connection."""
        if self.redis:
            await self.redis.close()
            logger.info("redis_cache_closed")
    
    async def get(self, key: str, default: Any = None) -> Any:
        """Get value from cache with automatic deserialization."""
        try:
            if not self.redis:
                return default
            
            value = await self.redis.get(key)
            if value is None:
                return default
            
            # Try JSON first, then pickle for complex objects
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return pickle.loads(value)
                
        except Exception as e:
            logger.error("cache_get_error", key=key, error=str(e))
            return default
    
    async def set(
        self, 
        key: str, 
        value: Any, 
        ttl: Optional[int] = None
    ) -> bool:
        """Set value in cache with automatic serialization."""
        try:
            if not self.redis:
                return False
            
            # Try JSON first, then pickle for complex objects
            try:
                serialized_value = json.dumps(value, ensure_ascii=False)
            except (TypeError, ValueError):
                serialized_value = pickle.dumps(value)
            
            if ttl:
                result = await self.redis.setex(key, ttl, serialized_value)
            else:
                result = await self.redis.set(key, serialized_value)
            
            return bool(result)
            
        except Exception as e:
            logger.error("cache_set_error", key=key, error=str(e))
            return False
    
    async def delete(self, *keys: str) -> int:
        """Delete keys from cache."""
        try:
            if not self.redis:
                return 0
            return await self.redis.delete(*keys)
        except Exception as e:
            logger.error("cache_delete_error", keys=keys, error=str(e))
            return 0
    
    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        try:
            if not self.redis:
                return False
            return bool(await self.redis.exists(key))
        except Exception as e:
            logger.error("cache_exists_error", key=key, error=str(e))
            return False
    
    async def increment(self, key: str, amount: int = 1) -> int:
        """Increment numeric value in cache."""
        try:
            if not self.redis:
                return 0
            return await self.redis.incrby(key, amount)
        except Exception as e:
            logger.error("cache_increment_error", key=key, error=str(e))
            return 0
    
    async def set_hash(self, name: str, mapping: Dict[str, Any], ttl: Optional[int] = None) -> bool:
        """Set hash in cache."""
        try:
            if not self.redis:
                return False
            
            # Serialize values
            serialized_mapping = {}
            for k, v in mapping.items():
                try:
                    serialized_mapping[k] = json.dumps(v, ensure_ascii=False)
                except (TypeError, ValueError):
                    serialized_mapping[k] = pickle.dumps(v)
            
            await self.redis.hmset(name, serialized_mapping)
            
            if ttl:
                await self.redis.expire(name, ttl)
            
            return True
            
        except Exception as e:
            logger.error("cache_set_hash_error", name=name, error=str(e))
            return False
    
    async def get_hash(self, name: str, key: str = None) -> Any:
        """Get hash or hash field from cache."""
        try:
            if not self.redis:
                return None
            
            if key:
                # Get specific field
                value = await self.redis.hget(name, key)
                if value is None:
                    return None
                
                try:
                    return json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    return pickle.loads(value)
            else:
                # Get entire hash
                hash_data = await self.redis.hgetall(name)
                result = {}
                for k, v in hash_data.items():
                    try:
                        result[k.decode() if isinstance(k, bytes) else k] = json.loads(v)
                    except (json.JSONDecodeError, TypeError):
                        result[k.decode() if isinstance(k, bytes) else k] = pickle.loads(v)
                return result
                
        except Exception as e:
            logger.error("cache_get_hash_error", name=name, key=key, error=str(e))
            return None
    
    async def push_to_list(self, key: str, *values: Any, ttl: Optional[int] = None) -> int:
        """Push values to list in cache."""
        try:
            if not self.redis:
                return 0
            
            serialized_values = []
            for value in values:
                try:
                    serialized_values.append(json.dumps(value, ensure_ascii=False))
                except (TypeError, ValueError):
                    serialized_values.append(pickle.dumps(value))
            
            result = await self.redis.lpush(key, *serialized_values)
            
            if ttl:
                await self.redis.expire(key, ttl)
            
            return result
            
        except Exception as e:
            logger.error("cache_push_to_list_error", key=key, error=str(e))
            return 0
    
    async def get_list(self, key: str, start: int = 0, end: int = -1) -> List[Any]:
        """Get list from cache."""
        try:
            if not self.redis:
                return []
            
            values = await self.redis.lrange(key, start, end)
            result = []
            
            for value in values:
                try:
                    result.append(json.loads(value))
                except (json.JSONDecodeError, TypeError):
                    result.append(pickle.loads(value))
            
            return result
            
        except Exception as e:
            logger.error("cache_get_list_error", key=key, error=str(e))
            return []
    
    async def health_check(self) -> bool:
        """Check Redis health."""
        try:
            if not self.redis:
                return False
            await self.redis.ping()
            return True
        except Exception as e:
            logger.error("redis_health_check_failed", error=str(e))
            return False


class AnalysisCacheManager:
    """Specialized cache manager for conversation analysis."""
    
    def __init__(self, cache: CacheManager):
        self.cache = cache
        self.config = CacheConfig()
    
    # Transcription Cache
    async def cache_transcription(
        self, 
        call_id: str, 
        transcription: Dict[str, Any]
    ) -> bool:
        """Cache transcription result."""
        key = f"{self.config.TRANSCRIPTION_PREFIX}{call_id}"
        return await self.cache.set(key, transcription, self.config.TRANSCRIPTION_TTL)
    
    async def get_transcription(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get cached transcription."""
        key = f"{self.config.TRANSCRIPTION_PREFIX}{call_id}"
        return await self.cache.get(key)
    
    # Analysis Results Cache
    async def cache_analysis(
        self, 
        call_id: str, 
        analysis_type: str, 
        results: Dict[str, Any]
    ) -> bool:
        """Cache analysis results."""
        key = f"{self.config.ANALYSIS_PREFIX}{call_id}:{analysis_type}"
        return await self.cache.set(key, results, self.config.ANALYSIS_TTL)
    
    async def get_analysis(
        self, 
        call_id: str, 
        analysis_type: str
    ) -> Optional[Dict[str, Any]]:
        """Get cached analysis results."""
        key = f"{self.config.ANALYSIS_PREFIX}{call_id}:{analysis_type}"
        return await self.cache.get(key)
    
    # Summary Cache
    async def cache_summary(
        self, 
        call_id: str, 
        summary: Dict[str, Any]
    ) -> bool:
        """Cache call summary."""
        key = f"{self.config.SUMMARY_PREFIX}{call_id}"
        return await self.cache.set(key, summary, self.config.SUMMARY_TTL)
    
    async def get_summary(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get cached summary."""
        key = f"{self.config.SUMMARY_PREFIX}{call_id}"
        return await self.cache.get(key)
    
    # User Profile Cache
    async def cache_user_profile(
        self, 
        user_id: str, 
        profile: Dict[str, Any]
    ) -> bool:
        """Cache user profile."""
        key = f"{self.config.USER_PROFILE_PREFIX}{user_id}"
        return await self.cache.set(key, profile, self.config.USER_PROFILE_TTL)
    
    async def get_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get cached user profile."""
        key = f"{self.config.USER_PROFILE_PREFIX}{user_id}"
        return await self.cache.get(key)
    
    # Call Context Cache
    async def cache_call_context(
        self, 
        call_id: str, 
        context: Dict[str, Any]
    ) -> bool:
        """Cache call context."""
        key = f"{self.config.CALL_CONTEXT_PREFIX}{call_id}"
        return await self.cache.set(key, context, self.config.CALL_CONTEXT_TTL)
    
    async def get_call_context(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get cached call context."""
        key = f"{self.config.CALL_CONTEXT_PREFIX}{call_id}"
        return await self.cache.get(key)
    
    # Batch Operations
    async def cache_multiple_analyses(
        self, 
        call_id: str, 
        analyses: Dict[str, Dict[str, Any]]
    ) -> bool:
        """Cache multiple analysis results for a call."""
        success_count = 0
        for analysis_type, results in analyses.items():
            if await self.cache_analysis(call_id, analysis_type, results):
                success_count += 1
        
        return success_count == len(analyses)
    
    async def get_all_analyses(self, call_id: str) -> Dict[str, Dict[str, Any]]:
        """Get all cached analyses for a call."""
        analysis_types = ['sentiment', 'intent', 'keywords', 'entities', 'summary']
        results = {}
        
        for analysis_type in analysis_types:
            analysis = await self.get_analysis(call_id, analysis_type)
            if analysis:
                results[analysis_type] = analysis
        
        return results
    
    async def invalidate_call_cache(self, call_id: str) -> int:
        """Invalidate all cache entries for a call."""
        keys_to_delete = [
            f"{self.config.TRANSCRIPTION_PREFIX}{call_id}",
            f"{self.config.SUMMARY_PREFIX}{call_id}",
            f"{self.config.CALL_CONTEXT_PREFIX}{call_id}",
        ]
        
        # Add analysis cache keys
        analysis_types = ['sentiment', 'intent', 'keywords', 'entities', 'summary']
        for analysis_type in analysis_types:
            keys_to_delete.append(f"{self.config.ANALYSIS_PREFIX}{call_id}:{analysis_type}")
        
        return await self.cache.delete(*keys_to_delete)


# Global cache manager instances
cache_manager = CacheManager()
analysis_cache = AnalysisCacheManager(cache_manager)