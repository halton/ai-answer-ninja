/**
 * AI Answer Ninja - Multi-Level Cache Implementation
 * Provides L1 (Memory), L2 (Redis), and L3 (Database) caching layers
 * Based on CLAUDE.md architecture specifications
 */

import { createClient, RedisClientType } from 'redis';
import { CacheConfig, CacheEntry, CacheMetrics, CacheError } from '../types';
import { createLogger } from '../utils/Logger';

export class MultiLevelCache {
  private l1Cache = new Map<string, CacheEntry>(); // Memory cache
  private l2Client: RedisClientType; // Redis cache
  private config: CacheConfig;
  private logger = createLogger('MultiLevelCache');
  
  private metrics: CacheMetrics = {
    hitRate: 0,
    missRate: 0,
    averageResponseTime: 0,
    totalOperations: 0
  };
  
  private cleanupInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor(config: CacheConfig) {
    this.config = config;
    this.initializeL2Cache();
    this.startCleanupProcess();
    this.startMetricsCollection();
  }

  private async initializeL2Cache(): Promise<void> {
    if (!this.config.levels.l2.enabled) {
      return;
    }

    try {
      this.l2Client = createClient({
        socket: {
          host: this.config.levels.l2.host,
          port: this.config.levels.l2.port
        },
        password: this.config.levels.l2.password,
        database: this.config.levels.l2.db,
        retryStrategy: (times: number) => Math.min(times * 100, 3000)
      });

      this.l2Client.on('error', (err) => {
        this.logger.error('Redis L2 cache error:', err);
      });

      await this.l2Client.connect();
      this.logger.info('L2 Redis cache initialized');
    } catch (error) {
      this.logger.error('Failed to initialize L2 cache:', error);
      throw new CacheError('L2 cache initialization failed', 'initialize', undefined, error as Error);
    }
  }

  /**
   * Get value from cache with fallback through all levels
   */
  async get<T = any>(key: string): Promise<T | null> {
    const startTime = Date.now();
    this.metrics.totalOperations++;

    try {
      // L1 Memory cache
      if (this.config.levels.l1.enabled) {
        const l1Result = this.getFromL1<T>(key);
        if (l1Result !== null) {
          this.updateMetrics(Date.now() - startTime, true);
          this.logger.debug(`Cache hit (L1): ${key}`);
          return l1Result;
        }
      }

      // L2 Redis cache
      if (this.config.levels.l2.enabled && this.l2Client) {
        const l2Result = await this.getFromL2<T>(key);
        if (l2Result !== null) {
          // Backfill L1 cache
          if (this.config.levels.l1.enabled) {
            this.setInL1(key, l2Result, this.config.levels.l1.ttl);
          }
          
          this.updateMetrics(Date.now() - startTime, true);
          this.logger.debug(`Cache hit (L2): ${key}`);
          return l2Result;
        }
      }

      // Cache miss
      this.updateMetrics(Date.now() - startTime, false);
      this.logger.debug(`Cache miss: ${key}`);
      return null;

    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      this.updateMetrics(Date.now() - startTime, false);
      return null;
    }
  }

  /**
   * Set value in cache across all enabled levels
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const finalTTL = ttl || this.config.levels.l1.ttl;

      // Set in L1 cache
      if (this.config.levels.l1.enabled) {
        this.setInL1(key, value, finalTTL);
      }

      // Set in L2 cache
      if (this.config.levels.l2.enabled && this.l2Client) {
        await this.setInL2(key, value, finalTTL);
      }

      this.logger.debug(`Cache set: ${key} (TTL: ${finalTTL}s)`);

    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
      throw new CacheError('Cache set failed', 'set', key, error as Error);
    }
  }

  /**
   * Delete from all cache levels
   */
  async delete(key: string): Promise<void> {
    try {
      // Delete from L1
      if (this.config.levels.l1.enabled) {
        this.l1Cache.delete(key);
      }

      // Delete from L2
      if (this.config.levels.l2.enabled && this.l2Client) {
        await this.l2Client.del(key);
      }

      this.logger.debug(`Cache delete: ${key}`);

    } catch (error) {
      this.logger.error(`Cache delete error for key ${key}:`, error);
      throw new CacheError('Cache delete failed', 'delete', key, error as Error);
    }
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;

    try {
      // Invalidate L1 cache
      if (this.config.levels.l1.enabled) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        for (const key of this.l1Cache.keys()) {
          if (regex.test(key)) {
            this.l1Cache.delete(key);
            invalidatedCount++;
          }
        }
      }

      // Invalidate L2 cache
      if (this.config.levels.l2.enabled && this.l2Client) {
        const keys = await this.l2Client.keys(pattern);
        if (keys.length > 0) {
          await this.l2Client.del(keys);
          invalidatedCount += keys.length;
        }
      }

      this.logger.info(`Invalidated ${invalidatedCount} cache entries matching pattern: ${pattern}`);
      return invalidatedCount;

    } catch (error) {
      this.logger.error(`Cache pattern invalidation error for pattern ${pattern}:`, error);
      throw new CacheError('Cache pattern invalidation failed', 'invalidatePattern', pattern, error as Error);
    }
  }

  /**
   * Get or set with automatic fallback
   */
  async getOrSet<T = any>(
    key: string, 
    valueProvider: () => Promise<T>, 
    ttl?: number
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Generate value and cache it
    try {
      const value = await valueProvider();
      await this.set(key, value, ttl);
      return value;
    } catch (error) {
      this.logger.error(`Value provider error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Warm up cache with predefined patterns
   */
  async warmUp(warmupData: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    if (!this.config.warmup.enabled) {
      return;
    }

    try {
      const promises = warmupData.map(async ({ key, value, ttl }) => {
        try {
          await this.set(key, value, ttl);
        } catch (error) {
          this.logger.warn(`Failed to warm up cache for key ${key}:`, error);
        }
      });

      await Promise.allSettled(promises);
      this.logger.info(`Cache warmup completed for ${warmupData.length} entries`);

    } catch (error) {
      this.logger.error('Cache warmup error:', error);
    }
  }

  // ===========================================
  // L1 Cache Operations (Memory)
  // ===========================================

  private getFromL1<T>(key: string): T | null {
    const entry = this.l1Cache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now > entry.timestamp + (entry.ttl * 1000)) {
      this.l1Cache.delete(key);
      return null;
    }

    // Update hit count
    entry.hits++;
    return entry.data as T;
  }

  private setInL1<T>(key: string, value: T, ttl: number): void {
    // Check memory limits
    if (this.l1Cache.size >= this.config.levels.l1.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      source: 'memory'
    };

    this.l1Cache.set(key, entry);
  }

  private evictLRU(): void {
    // Find least recently used entry (lowest hits, oldest timestamp)
    let lruKey: string | null = null;
    let lruScore = Infinity;

    for (const [key, entry] of this.l1Cache.entries()) {
      const score = entry.hits + (Date.now() - entry.timestamp) / 1000;
      if (score < lruScore) {
        lruScore = score;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.l1Cache.delete(lruKey);
      this.logger.debug(`Evicted LRU cache entry: ${lruKey}`);
    }
  }

  // ===========================================
  // L2 Cache Operations (Redis)
  // ===========================================

  private async getFromL2<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.l2Client.get(key);
      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.error('L2 cache get error:', error);
      return null;
    }
  }

  private async setInL2<T>(key: string, value: T, ttl: number): Promise<void> {
    try {
      await this.l2Client.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      this.logger.error('L2 cache set error:', error);
      throw error;
    }
  }

  // ===========================================
  // Cache Metrics and Monitoring
  // ===========================================

  private updateMetrics(responseTime: number, hit: boolean): void {
    if (hit) {
      this.metrics.hitRate = (this.metrics.hitRate * (this.metrics.totalOperations - 1) + 1) / this.metrics.totalOperations;
    } else {
      this.metrics.missRate = (this.metrics.missRate * (this.metrics.totalOperations - 1) + 1) / this.metrics.totalOperations;
    }

    this.metrics.averageResponseTime = (
      this.metrics.averageResponseTime * (this.metrics.totalOperations - 1) + responseTime
    ) / this.metrics.totalOperations;
  }

  /**
   * Get current cache metrics
   */
  getMetrics(): CacheMetrics {
    return {
      ...this.metrics,
      memoryUsage: this.getMemoryUsage()
    };
  }

  private getMemoryUsage(): number {
    let totalSize = 0;
    for (const entry of this.l1Cache.values()) {
      // Rough estimation of memory usage
      totalSize += JSON.stringify(entry.data).length;
    }
    return totalSize;
  }

  /**
   * Get cache statistics by level
   */
  async getCacheStats() {
    const stats = {
      l1: {
        enabled: this.config.levels.l1.enabled,
        size: this.l1Cache.size,
        maxSize: this.config.levels.l1.maxSize,
        memoryUsage: this.getMemoryUsage()
      },
      l2: {
        enabled: this.config.levels.l2.enabled,
        connected: this.l2Client?.isReady || false,
        info: null as any
      },
      overall: this.getMetrics()
    };

    // Get Redis info if available
    if (this.config.levels.l2.enabled && this.l2Client?.isReady) {
      try {
        const info = await this.l2Client.info('memory');
        stats.l2.info = this.parseRedisInfo(info);
      } catch (error) {
        this.logger.warn('Failed to get Redis info:', error);
      }
    }

    return stats;
  }

  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    info.split('\r\n').forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    });
    return result;
  }

  // ===========================================
  // Cleanup and Maintenance
  // ===========================================

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000); // Every minute
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.l1Cache.entries()) {
      if (now > entry.timestamp + (entry.ttl * 1000)) {
        this.l1Cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired L1 cache entries`);
    }
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        const stats = await this.getCacheStats();
        this.logger.debug('Cache stats:', stats);
        
        // Reset metrics periodically to prevent overflow
        if (this.metrics.totalOperations > 1000000) {
          this.resetMetrics();
        }
      } catch (error) {
        this.logger.error('Metrics collection error:', error);
      }
    }, 300000); // Every 5 minutes
  }

  private resetMetrics(): void {
    this.metrics = {
      hitRate: 0,
      missRate: 0,
      averageResponseTime: 0,
      totalOperations: 0
    };
    this.logger.info('Cache metrics reset');
  }

  /**
   * Clear all cache levels
   */
  async clear(): Promise<void> {
    try {
      // Clear L1
      if (this.config.levels.l1.enabled) {
        this.l1Cache.clear();
      }

      // Clear L2
      if (this.config.levels.l2.enabled && this.l2Client) {
        await this.l2Client.flushDb();
      }

      this.logger.info('All cache levels cleared');
    } catch (error) {
      this.logger.error('Cache clear error:', error);
      throw new CacheError('Cache clear failed', 'clear', undefined, error as Error);
    }
  }

  /**
   * Shutdown cache system
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    if (this.l2Client) {
      await this.l2Client.quit();
    }

    this.l1Cache.clear();
    this.logger.info('Cache system shutdown completed');
  }
}