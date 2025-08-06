"""
Redis cache configuration and management
"""

import json
import logging
import pickle
from typing import Any, Optional, Union

import redis.asyncio as redis
from redis.asyncio import ConnectionPool

from .config import get_settings

logger = logging.getLogger(__name__)

# Global Redis client
redis_client: Optional[redis.Redis] = None


async def init_cache() -> None:
    """Initialize Redis cache connection"""
    global redis_client
    
    settings = get_settings()
    
    try:
        # Create connection pool
        pool = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=20,
            retry_on_timeout=True,
            socket_keepalive=True,
            socket_keepalive_options={},
            health_check_interval=30
        )
        
        redis_client = redis.Redis(
            connection_pool=pool,
            decode_responses=False  # We'll handle encoding/decoding manually
        )
        
        # Test connection
        await redis_client.ping()
        logger.info("Redis cache initialized successfully")
        
    except Exception as e:
        logger.error(f"Failed to initialize Redis cache: {e}")
        raise


async def close_cache() -> None:
    """Close Redis cache connection"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
        logger.info("Redis cache connection closed")


class CacheManager:
    """Redis cache manager with advanced features"""
    
    def __init__(self):
        self.settings = get_settings()
        self.prefix = self.settings.redis_prefix
        self.default_ttl = self.settings.cache_ttl
    
    def _make_key(self, key: str) -> str:
        """Create prefixed cache key"""
        return f"{self.prefix}{key}"
    
    async def get(
        self,
        key: str,
        default: Any = None,
        use_json: bool = True
    ) -> Any:
        """Get value from cache"""
        try:
            if not redis_client:
                return default
            
            cache_key = self._make_key(key)
            value = await redis_client.get(cache_key)
            
            if value is None:
                return default
            
            if use_json:
                try:
                    return json.loads(value.decode('utf-8'))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    return pickle.loads(value)
            else:
                return pickle.loads(value)
                
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
            return default
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
        use_json: bool = True
    ) -> bool:
        """Set value in cache"""
        try:
            if not redis_client:
                return False
            
            cache_key = self._make_key(key)
            ttl = ttl or self.default_ttl
            
            if use_json:
                try:
                    serialized_value = json.dumps(value, default=str)
                except (TypeError, ValueError):
                    serialized_value = pickle.dumps(value)
                    use_json = False
            else:
                serialized_value = pickle.dumps(value)
            
            await redis_client.setex(cache_key, ttl, serialized_value)
            return True
            
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete value from cache"""
        try:
            if not redis_client:
                return False
            
            cache_key = self._make_key(key)
            await redis_client.delete(cache_key)
            return True
            
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {e}")
            return False
    
    async def exists(self, key: str) -> bool:
        """Check if key exists in cache"""
        try:
            if not redis_client:
                return False
            
            cache_key = self._make_key(key)
            return bool(await redis_client.exists(cache_key))
            
        except Exception as e:
            logger.error(f"Cache exists error for key {key}: {e}")
            return False
    
    async def expire(self, key: str, ttl: int) -> bool:
        """Set expiration for key"""
        try:
            if not redis_client:
                return False
            
            cache_key = self._make_key(key)
            await redis_client.expire(cache_key, ttl)
            return True
            
        except Exception as e:
            logger.error(f"Cache expire error for key {key}: {e}")
            return False
    
    async def get_ttl(self, key: str) -> int:
        """Get TTL for key"""
        try:
            if not redis_client:
                return -1
            
            cache_key = self._make_key(key)
            return await redis_client.ttl(cache_key)
            
        except Exception as e:
            logger.error(f"Cache TTL error for key {key}: {e}")
            return -1
    
    async def increment(self, key: str, amount: int = 1) -> Optional[int]:
        """Increment counter"""
        try:
            if not redis_client:
                return None
            
            cache_key = self._make_key(key)
            return await redis_client.incrby(cache_key, amount)
            
        except Exception as e:
            logger.error(f"Cache increment error for key {key}: {e}")
            return None
    
    async def set_hash(self, key: str, mapping: dict, ttl: Optional[int] = None) -> bool:
        """Set hash value"""
        try:
            if not redis_client:
                return False
            
            cache_key = self._make_key(key)
            
            # Convert values to JSON strings
            json_mapping = {}
            for k, v in mapping.items():
                try:
                    json_mapping[k] = json.dumps(v, default=str)
                except (TypeError, ValueError):
                    json_mapping[k] = pickle.dumps(v).decode('latin-1')
            
            await redis_client.hset(cache_key, mapping=json_mapping)
            
            if ttl:
                await redis_client.expire(cache_key, ttl)
            
            return True
            
        except Exception as e:
            logger.error(f"Cache set_hash error for key {key}: {e}")
            return False
    
    async def get_hash(self, key: str, field: Optional[str] = None) -> Any:
        """Get hash value"""
        try:
            if not redis_client:
                return None
            
            cache_key = self._make_key(key)
            
            if field:
                value = await redis_client.hget(cache_key, field)
                if value is None:
                    return None
                
                try:
                    return json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    return pickle.loads(value.encode('latin-1'))
            else:
                hash_data = await redis_client.hgetall(cache_key)
                result = {}
                
                for k, v in hash_data.items():
                    key_str = k.decode('utf-8') if isinstance(k, bytes) else k
                    value_str = v.decode('utf-8') if isinstance(v, bytes) else v
                    
                    try:
                        result[key_str] = json.loads(value_str)
                    except (json.JSONDecodeError, ValueError):
                        result[key_str] = pickle.loads(value_str.encode('latin-1'))
                
                return result
                
        except Exception as e:
            logger.error(f"Cache get_hash error for key {key}: {e}")
            return None
    
    async def health_check(self) -> dict:
        """Check cache health"""
        try:
            if not redis_client:
                return {"status": "not_initialized"}
            
            # Test basic operations
            test_key = "health_check_test"
            await redis_client.set(test_key, "test", ex=10)
            value = await redis_client.get(test_key)
            await redis_client.delete(test_key)
            
            if value != b"test":
                return {"status": "error", "message": "Basic operations failed"}
            
            # Get Redis info
            info = await redis_client.info()
            
            return {
                "status": "healthy",
                "redis_version": info.get("redis_version"),
                "connected_clients": info.get("connected_clients"),
                "used_memory_human": info.get("used_memory_human"),
                "keyspace_hits": info.get("keyspace_hits"),
                "keyspace_misses": info.get("keyspace_misses"),
            }
            
        except Exception as e:
            logger.error(f"Cache health check failed: {e}")
            return {"status": "error", "message": str(e)}


# Global cache manager instance
cache_manager = CacheManager()