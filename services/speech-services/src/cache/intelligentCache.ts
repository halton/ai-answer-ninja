import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { config } from '../config';
import logger from '../utils/logger';
import {
  CacheEntry,
  CacheStats,
  TTSResult,
  STTResult,
  PreGeneratedResponse,
} from '../types';

export class IntelligentCacheService {
  private redis: Redis;
  private memoryCache: LRUCache<string, any>;
  private stats: CacheStats;
  private preGeneratedResponses: Map<string, PreGeneratedResponse>;

  constructor() {
    // Initialize Redis connection
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    // Initialize LRU memory cache
    this.memoryCache = new LRUCache({
      max: config.cache.maxSize,
      ttl: config.cache.ttl * 1000, // Convert to milliseconds
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    // Initialize stats
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      maxSize: config.cache.maxSize,
      evictions: 0,
    };

    // Initialize pre-generated responses
    this.preGeneratedResponses = new Map();
    
    // Set up Redis event handlers
    this.setupRedisHandlers();
    
    // Load pre-generated responses if enabled
    if (config.cache.pregeneratedResponsesEnabled) {
      this.loadPreGeneratedResponses();
    }
  }

  /**
   * Set up Redis event handlers
   */
  private setupRedisHandlers(): void {
    this.redis.on('connect', () => {
      logger.info('Redis connected for cache service');
    });

    this.redis.on('error', (error) => {
      logger.error('Redis error in cache service:', error);
    });

    this.redis.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  /**
   * Load pre-generated responses
   */
  private async loadPreGeneratedResponses(): Promise<void> {
    try {
      const responses = await this.redis.hgetall('pregenerated_responses');
      
      for (const [key, value] of Object.entries(responses)) {
        const response = JSON.parse(value) as PreGeneratedResponse;
        // Convert base64 back to Buffer
        response.audioData = Buffer.from(response.audioData.toString(), 'base64');
        this.preGeneratedResponses.set(key, response);
      }
      
      logger.info(`Loaded ${this.preGeneratedResponses.size} pre-generated responses`);
    } catch (error) {
      logger.error('Error loading pre-generated responses:', error);
    }
  }

  /**
   * Generate cache key
   */
  private generateKey(prefix: string, data: any): string {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .substring(0, 16);
    return `${prefix}:${hash}`;
  }

  /**
   * Get TTS result from cache
   */
  public async getTTSCache(text: string, voiceName: string): Promise<TTSResult | null> {
    const key = this.generateKey('tts', { text, voiceName });

    try {
      // Check memory cache first
      const memoryResult = this.memoryCache.get(key) as TTSResult;
      if (memoryResult) {
        this.stats.hits++;
        this.updateHitRate();
        logger.debug(`TTS cache hit (memory): ${key}`);
        return { ...memoryResult, cached: true };
      }

      // Check Redis cache
      const redisResult = await this.redis.get(key);
      if (redisResult) {
        const result = JSON.parse(redisResult) as TTSResult;
        // Convert base64 back to Buffer
        result.audioData = Buffer.from(result.audioData.toString(), 'base64');
        result.cached = true;
        
        // Store in memory cache for faster access
        this.memoryCache.set(key, result);
        
        this.stats.hits++;
        this.updateHitRate();
        logger.debug(`TTS cache hit (Redis): ${key}`);
        return result;
      }

      this.stats.misses++;
      this.updateHitRate();
      return null;
    } catch (error) {
      logger.error('Error getting TTS cache:', error);
      return null;
    }
  }

  /**
   * Set TTS result in cache
   */
  public async setTTSCache(
    text: string,
    voiceName: string,
    result: TTSResult
  ): Promise<void> {
    const key = this.generateKey('tts', { text, voiceName });

    try {
      // Store in memory cache
      this.memoryCache.set(key, result);

      // Prepare for Redis storage (convert Buffer to base64)
      const redisData = {
        ...result,
        audioData: result.audioData.toString('base64'),
      };

      // Store in Redis with TTL
      await this.redis.setex(
        key,
        config.cache.ttl,
        JSON.stringify(redisData)
      );

      logger.debug(`TTS result cached: ${key}`);
    } catch (error) {
      logger.error('Error setting TTS cache:', error);
    }
  }

  /**
   * Get STT result from cache
   */
  public async getSTTCache(audioHash: string): Promise<STTResult | null> {
    const key = `stt:${audioHash}`;

    try {
      // Check memory cache
      const memoryResult = this.memoryCache.get(key) as STTResult;
      if (memoryResult) {
        this.stats.hits++;
        this.updateHitRate();
        return memoryResult;
      }

      // Check Redis
      const redisResult = await this.redis.get(key);
      if (redisResult) {
        const result = JSON.parse(redisResult) as STTResult;
        this.memoryCache.set(key, result);
        this.stats.hits++;
        this.updateHitRate();
        return result;
      }

      this.stats.misses++;
      this.updateHitRate();
      return null;
    } catch (error) {
      logger.error('Error getting STT cache:', error);
      return null;
    }
  }

  /**
   * Set STT result in cache
   */
  public async setSTTCache(audioHash: string, result: STTResult): Promise<void> {
    const key = `stt:${audioHash}`;

    try {
      // Store in memory cache
      this.memoryCache.set(key, result);

      // Store in Redis
      await this.redis.setex(key, config.cache.ttl, JSON.stringify(result));
      
      logger.debug(`STT result cached: ${key}`);
    } catch (error) {
      logger.error('Error setting STT cache:', error);
    }
  }

  /**
   * Get pre-generated response
   */
  public getPreGeneratedResponse(intent: string): PreGeneratedResponse | null {
    const response = this.preGeneratedResponses.get(intent);
    if (response) {
      response.usage++;
      return response;
    }
    return null;
  }

  /**
   * Add pre-generated response
   */
  public async addPreGeneratedResponse(
    intent: string,
    response: PreGeneratedResponse
  ): Promise<void> {
    try {
      this.preGeneratedResponses.set(intent, response);
      
      // Store in Redis for persistence
      const redisData = {
        ...response,
        audioData: response.audioData.toString('base64'),
      };
      
      await this.redis.hset(
        'pregenerated_responses',
        intent,
        JSON.stringify(redisData)
      );
      
      logger.info(`Added pre-generated response for intent: ${intent}`);
    } catch (error) {
      logger.error('Error adding pre-generated response:', error);
    }
  }

  /**
   * Warm up cache with predicted responses
   */
  public async warmupCache(predictions: string[], voiceName: string): Promise<void> {
    try {
      const warmupPromises = predictions.map(async (text) => {
        const key = this.generateKey('tts', { text, voiceName });
        
        // Check if already cached
        const exists = await this.redis.exists(key);
        if (!exists) {
          // Mark for pre-generation
          await this.redis.sadd('warmup_queue', JSON.stringify({ text, voiceName }));
        }
      });

      await Promise.all(warmupPromises);
      logger.info(`Warmed up cache with ${predictions.length} predictions`);
    } catch (error) {
      logger.error('Error warming up cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.memoryCache.size,
    };
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Clear cache
   */
  public async clearCache(pattern?: string): Promise<void> {
    try {
      if (pattern) {
        // Clear specific pattern from Redis
        const keys = await this.redis.keys(`${pattern}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        
        // Clear from memory cache
        for (const key of this.memoryCache.keys()) {
          if (key.startsWith(pattern)) {
            this.memoryCache.delete(key);
          }
        }
      } else {
        // Clear all caches
        await this.redis.flushdb();
        this.memoryCache.clear();
      }
      
      // Reset stats
      this.stats.hits = 0;
      this.stats.misses = 0;
      this.stats.hitRate = 0;
      this.stats.evictions = 0;
      
      logger.info('Cache cleared');
    } catch (error) {
      logger.error('Error clearing cache:', error);
    }
  }

  /**
   * Optimize cache based on usage patterns
   */
  public async optimizeCache(): Promise<void> {
    try {
      // Get cache usage statistics
      const keys = await this.redis.keys('*');
      const usageStats = new Map<string, number>();

      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        const accessCount = await this.redis.get(`${key}:access_count`);
        usageStats.set(key, parseInt(accessCount || '0', 10));
      }

      // Sort by usage
      const sortedKeys = Array.from(usageStats.entries()).sort((a, b) => b[1] - a[1]);

      // Keep top N most used items
      const keepCount = Math.floor(config.cache.maxSize * 0.8);
      const keysToEvict = sortedKeys.slice(keepCount).map(([key]) => key);

      if (keysToEvict.length > 0) {
        await this.redis.del(...keysToEvict);
        this.stats.evictions += keysToEvict.length;
        logger.info(`Evicted ${keysToEvict.length} least used cache entries`);
      }
    } catch (error) {
      logger.error('Error optimizing cache:', error);
    }
  }

  /**
   * Calculate audio hash for caching
   */
  public calculateAudioHash(audioBuffer: Buffer): string {
    return crypto
      .createHash('sha256')
      .update(audioBuffer)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Close connections
   */
  public async destroy(): Promise<void> {
    await this.redis.quit();
    this.memoryCache.clear();
    logger.info('Cache service destroyed');
  }
}

// Export singleton instance
export default new IntelligentCacheService();