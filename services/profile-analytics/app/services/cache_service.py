"""
Advanced caching service with optimization strategies
"""

import asyncio
import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Union
from collections import defaultdict

from app.core.cache import cache_manager
from app.core.config import get_settings
from app.core.logging import LoggingMixin
from app.middleware.monitoring import PerformanceOptimizer


class CacheOptimizationService(LoggingMixin):
    """Advanced caching service with intelligent optimization"""
    
    def __init__(self):
        super().__init__()
        self.settings = get_settings()
        
        # Cache strategies
        self.cache_strategies = {
            'spam_profiles': {'ttl': 3600, 'strategy': 'lru'},  # 1 hour
            'user_profiles': {'ttl': 1800, 'strategy': 'lru'},  # 30 minutes  
            'ml_predictions': {'ttl': 300, 'strategy': 'lfu'},  # 5 minutes
            'analytics': {'ttl': 600, 'strategy': 'ttl'},      # 10 minutes
            'feature_importance': {'ttl': 7200, 'strategy': 'ttl'},  # 2 hours
            'trend_data': {'ttl': 1800, 'strategy': 'ttl'}     # 30 minutes
        }
        
        # Cache performance tracking
        self.cache_stats = defaultdict(lambda: {'hits': 0, 'misses': 0, 'errors': 0})
        self.cache_warmup_tasks = set()
        
        # Predictive caching
        self.access_patterns = defaultdict(list)
        self.preload_candidates = set()
    
    async def get_with_fallback(
        self,
        key: str,
        fallback_func,
        cache_type: str = 'default',
        force_refresh: bool = False,
        **fallback_kwargs
    ) -> Any:
        """Get data with cache fallback and optimization"""
        
        try:
            # Skip cache if force refresh
            if not force_refresh:
                cached_data = await self._smart_cache_get(key, cache_type)
                if cached_data is not None:
                    self._record_cache_hit(cache_type)
                    self._track_access_pattern(key)
                    return cached_data
            
            # Cache miss - get from fallback function
            self._record_cache_miss(cache_type)
            
            # Execute fallback with timeout protection
            try:
                data = await asyncio.wait_for(
                    fallback_func(**fallback_kwargs),
                    timeout=30.0  # 30 second timeout
                )
            except asyncio.TimeoutError:
                self.logger.error(f"Fallback function timeout for key {key}")
                return None
            
            # Cache the result with appropriate strategy
            if data is not None:
                await self._smart_cache_set(key, data, cache_type)
                self._track_access_pattern(key)
            
            return data
            
        except Exception as e:
            self.logger.error(f"Cache fallback error for key {key}: {e}")
            self._record_cache_error(cache_type)
            
            # Try to return stale data if available
            stale_data = await cache_manager.get(key, default=None)
            if stale_data is not None:
                self.logger.warning(f"Returning stale data for key {key}")
                return stale_data
            
            return None
    
    async def batch_get(
        self,
        keys: List[str],
        fallback_func,
        cache_type: str = 'default',
        **fallback_kwargs
    ) -> Dict[str, Any]:
        """Batch get with parallel fallback for missing keys"""
        
        try:
            results = {}
            missing_keys = []
            
            # Get cached data for all keys
            for key in keys:
                cached_data = await self._smart_cache_get(key, cache_type)
                if cached_data is not None:
                    results[key] = cached_data
                    self._record_cache_hit(cache_type)
                else:
                    missing_keys.append(key)
                    self._record_cache_miss(cache_type)
            
            # Fetch missing data in parallel
            if missing_keys:
                missing_tasks = []
                for key in missing_keys:
                    task = asyncio.create_task(
                        self._fetch_and_cache_single(key, fallback_func, cache_type, **fallback_kwargs)
                    )
                    missing_tasks.append((key, task))
                
                # Wait for all tasks to complete
                for key, task in missing_tasks:
                    try:
                        data = await task
                        if data is not None:
                            results[key] = data
                    except Exception as e:
                        self.logger.error(f"Error fetching data for key {key}: {e}")
            
            return results
            
        except Exception as e:
            self.logger.error(f"Batch get error: {e}")
            return {}
    
    async def invalidate_pattern(self, pattern: str, cache_type: str = 'default') -> int:
        """Invalidate all keys matching a pattern"""
        
        try:
            # This would require a more sophisticated Redis setup
            # For now, we'll track keys to invalidate manually
            
            invalidated = 0
            
            # In a real implementation, you'd scan Redis keys
            # and delete matching ones
            
            self.logger.info(f"Invalidated {invalidated} keys matching pattern {pattern}")
            return invalidated
            
        except Exception as e:
            self.logger.error(f"Error invalidating pattern {pattern}: {e}")
            return 0
    
    async def warm_cache(self, warmup_specs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Warm up cache with frequently accessed data"""
        
        try:
            warmup_results = {
                'successful': 0,
                'failed': 0,
                'skipped': 0,
                'total_time': 0
            }
            
            start_time = datetime.now()
            
            # Execute warmup tasks in parallel
            warmup_tasks = []
            for spec in warmup_specs:
                task = asyncio.create_task(
                    self._execute_warmup_task(spec)
                )
                warmup_tasks.append(task)
            
            # Wait for all warmup tasks
            results = await asyncio.gather(*warmup_tasks, return_exceptions=True)
            
            # Process results
            for result in results:
                if isinstance(result, Exception):
                    warmup_results['failed'] += 1
                elif result is True:
                    warmup_results['successful'] += 1
                else:
                    warmup_results['skipped'] += 1
            
            end_time = datetime.now()
            warmup_results['total_time'] = (end_time - start_time).total_seconds()
            
            self.logger.info(f"Cache warmup completed: {warmup_results}")
            
            return warmup_results
            
        except Exception as e:
            self.logger.error(f"Cache warmup error: {e}")
            return {'error': str(e)}
    
    async def optimize_cache_usage(self) -> Dict[str, Any]:
        """Analyze and optimize cache usage patterns"""
        
        try:
            optimization_results = {
                'cache_stats': dict(self.cache_stats),
                'hit_rates': {},
                'recommendations': [],
                'optimizations_applied': []
            }
            
            # Calculate hit rates
            for cache_type, stats in self.cache_stats.items():
                total_requests = stats['hits'] + stats['misses']
                if total_requests > 0:
                    hit_rate = stats['hits'] / total_requests
                    optimization_results['hit_rates'][cache_type] = hit_rate
                    
                    # Generate recommendations
                    if hit_rate < 0.5:
                        optimization_results['recommendations'].append(
                            f"Low hit rate for {cache_type} ({hit_rate:.2%}). Consider increasing TTL or pre-warming."
                        )
                    elif hit_rate > 0.9:
                        optimization_results['recommendations'].append(
                            f"High hit rate for {cache_type} ({hit_rate:.2%}). Consider decreasing TTL to save memory."
                        )
            
            # Apply automatic optimizations
            optimizations = await self._apply_automatic_optimizations()
            optimization_results['optimizations_applied'] = optimizations
            
            return optimization_results
            
        except Exception as e:
            self.logger.error(f"Cache optimization error: {e}")
            return {'error': str(e)}
    
    async def predictive_preload(self) -> Dict[str, Any]:
        """Preload cache based on predicted access patterns"""
        
        try:
            preload_results = {
                'candidates_identified': 0,
                'preloaded': 0,
                'failed': 0
            }
            
            # Analyze access patterns
            candidates = self._identify_preload_candidates()
            preload_results['candidates_identified'] = len(candidates)
            
            # Preload high-probability candidates
            for candidate in candidates[:10]:  # Limit to top 10
                try:
                    success = await self._preload_candidate(candidate)
                    if success:
                        preload_results['preloaded'] += 1
                    else:
                        preload_results['failed'] += 1
                except Exception as e:
                    self.logger.error(f"Error preloading candidate {candidate}: {e}")
                    preload_results['failed'] += 1
            
            return preload_results
            
        except Exception as e:
            self.logger.error(f"Predictive preload error: {e}")
            return {'error': str(e)}
    
    async def _smart_cache_get(self, key: str, cache_type: str) -> Any:
        """Smart cache get with strategy-aware retrieval"""
        
        try:
            strategy_config = self.cache_strategies.get(cache_type, self.cache_strategies['default'])
            
            # Get from cache
            data = await cache_manager.get(key)
            
            if data is not None:
                PerformanceOptimizer.record_cache_operation('get', True)
                return data
            
            PerformanceOptimizer.record_cache_operation('get', False)
            return None
            
        except Exception as e:
            self.logger.error(f"Smart cache get error for key {key}: {e}")
            PerformanceOptimizer.record_cache_operation('get', False)
            return None
    
    async def _smart_cache_set(self, key: str, data: Any, cache_type: str) -> bool:
        """Smart cache set with strategy-aware storage"""
        
        try:
            strategy_config = self.cache_strategies.get(cache_type, {'ttl': 3600, 'strategy': 'lru'})
            ttl = strategy_config['ttl']
            
            # Apply compression for large data
            if isinstance(data, (dict, list)) and len(str(data)) > 10000:
                # In practice, you might compress the data here
                pass
            
            success = await cache_manager.set(key, data, ttl=ttl)
            
            if success:
                PerformanceOptimizer.record_cache_operation('set', True)
            else:
                PerformanceOptimizer.record_cache_operation('set', False)
            
            return success
            
        except Exception as e:
            self.logger.error(f"Smart cache set error for key {key}: {e}")
            PerformanceOptimizer.record_cache_operation('set', False)
            return False
    
    async def _fetch_and_cache_single(
        self,
        key: str,
        fallback_func,
        cache_type: str,
        **kwargs
    ) -> Any:
        """Fetch single item and cache it"""
        
        try:
            # Extract identifier from key for fallback function
            # This is simplified - you'd need to parse the key appropriately
            data = await fallback_func(key=key, **kwargs)
            
            if data is not None:
                await self._smart_cache_set(key, data, cache_type)
            
            return data
            
        except Exception as e:
            self.logger.error(f"Error fetching and caching key {key}: {e}")
            return None
    
    async def _execute_warmup_task(self, spec: Dict[str, Any]) -> bool:
        """Execute a single warmup task"""
        
        try:
            key = spec['key']
            cache_type = spec.get('cache_type', 'default')
            fallback_func = spec['fallback_func']
            kwargs = spec.get('kwargs', {})
            
            # Check if already cached
            if await cache_manager.exists(key):
                return True  # Skip, already warm
            
            # Fetch and cache
            data = await fallback_func(**kwargs)
            if data is not None:
                await self._smart_cache_set(key, data, cache_type)
                return True
            
            return False
            
        except Exception as e:
            self.logger.error(f"Warmup task error: {e}")
            return False
    
    async def _apply_automatic_optimizations(self) -> List[str]:
        """Apply automatic cache optimizations"""
        
        optimizations = []
        
        try:
            # Adjust TTLs based on hit rates
            for cache_type, stats in self.cache_stats.items():
                total_requests = stats['hits'] + stats['misses']
                if total_requests > 100:  # Enough data to optimize
                    hit_rate = stats['hits'] / total_requests
                    
                    current_config = self.cache_strategies.get(cache_type)
                    if current_config:
                        current_ttl = current_config['ttl']
                        
                        if hit_rate < 0.3:
                            # Increase TTL for low hit rates
                            new_ttl = min(current_ttl * 1.5, 7200)  # Max 2 hours
                            current_config['ttl'] = int(new_ttl)
                            optimizations.append(f"Increased TTL for {cache_type} to {new_ttl}s")
                        elif hit_rate > 0.9:
                            # Decrease TTL for very high hit rates to save memory
                            new_ttl = max(current_ttl * 0.8, 300)  # Min 5 minutes
                            current_config['ttl'] = int(new_ttl)
                            optimizations.append(f"Decreased TTL for {cache_type} to {new_ttl}s")
            
            return optimizations
            
        except Exception as e:
            self.logger.error(f"Error applying automatic optimizations: {e}")
            return []
    
    def _identify_preload_candidates(self) -> List[str]:
        """Identify candidates for predictive preloading"""
        
        try:
            candidates = []
            
            # Analyze access patterns to find frequently accessed keys
            for key, accesses in self.access_patterns.items():
                if len(accesses) >= 3:  # Accessed at least 3 times
                    # Check if accesses follow a pattern
                    recent_accesses = [a for a in accesses if a > datetime.now() - timedelta(hours=1)]
                    if len(recent_accesses) >= 2:
                        candidates.append(key)
            
            # Sort by access frequency
            candidates.sort(key=lambda k: len(self.access_patterns[k]), reverse=True)
            
            return candidates
            
        except Exception as e:
            self.logger.error(f"Error identifying preload candidates: {e}")
            return []
    
    async def _preload_candidate(self, key: str) -> bool:
        """Preload a specific candidate"""
        
        try:
            # Check if already cached
            if await cache_manager.exists(key):
                return True
            
            # This would need to be implemented with specific logic
            # for reconstructing data based on key patterns
            
            return False
            
        except Exception as e:
            self.logger.error(f"Error preloading candidate {key}: {e}")
            return False
    
    def _record_cache_hit(self, cache_type: str):
        """Record cache hit for statistics"""
        self.cache_stats[cache_type]['hits'] += 1
    
    def _record_cache_miss(self, cache_type: str):
        """Record cache miss for statistics"""
        self.cache_stats[cache_type]['misses'] += 1
    
    def _record_cache_error(self, cache_type: str):
        """Record cache error for statistics"""
        self.cache_stats[cache_type]['errors'] += 1
    
    def _track_access_pattern(self, key: str):
        """Track access patterns for predictive caching"""
        current_time = datetime.now()
        self.access_patterns[key].append(current_time)
        
        # Keep only recent accesses (last 24 hours)
        cutoff_time = current_time - timedelta(hours=24)
        self.access_patterns[key] = [
            t for t in self.access_patterns[key] if t > cutoff_time
        ]
    
    def get_cache_statistics(self) -> Dict[str, Any]:
        """Get comprehensive cache statistics"""
        
        stats = {
            'cache_types': {},
            'overall': {'hits': 0, 'misses': 0, 'errors': 0},
            'hit_rates': {},
            'strategies': self.cache_strategies,
            'access_patterns_count': len(self.access_patterns)
        }
        
        # Calculate per-type statistics
        for cache_type, type_stats in self.cache_stats.items():
            total_requests = type_stats['hits'] + type_stats['misses']
            hit_rate = type_stats['hits'] / total_requests if total_requests > 0 else 0
            
            stats['cache_types'][cache_type] = {
                **type_stats,
                'total_requests': total_requests,
                'hit_rate': hit_rate
            }
            
            # Add to overall stats
            stats['overall']['hits'] += type_stats['hits']
            stats['overall']['misses'] += type_stats['misses']
            stats['overall']['errors'] += type_stats['errors']
            
            stats['hit_rates'][cache_type] = hit_rate
        
        # Calculate overall hit rate
        total_overall = stats['overall']['hits'] + stats['overall']['misses']
        stats['overall']['hit_rate'] = stats['overall']['hits'] / total_overall if total_overall > 0 else 0
        
        return stats