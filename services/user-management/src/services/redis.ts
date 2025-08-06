import { Redis } from 'ioredis';
import { config } from '@/config';
import { logger } from '@/utils/logger';

/**
 * Redis Service for caching and session management
 */
export class RedisService {
  private client: Redis;
  private isConnected = false;

  constructor() {
    this.client = new Redis(config.redis.url, {
      keyPrefix: config.redis.keyPrefix,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      onConnect: () => {
        this.isConnected = true;
        logger.info('Redis connected successfully');
      },
      onError: (error) => {
        this.isConnected = false;
        logger.error('Redis connection error', { error: error.message });
      },
      onClose: () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      }
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      this.isConnected = false;
    } catch (error) {
      logger.error('Error disconnecting from Redis', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Check if Redis is connected
   */
  isHealthy(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  // ==========================================
  // Basic Operations
  // ==========================================

  /**
   * Set a key-value pair
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttl) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      logger.error('Redis SET operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Set a key-value pair with expiration
   */
  async setex(key: string, ttl: number, value: any): Promise<void> {
    return this.set(key, value, ttl);
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis GET operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get and parse JSON value
   */
  async getJSON<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis GET JSON operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error('Redis DELETE operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Delete multiple keys
   */
  async deleteMultiple(keys: string[]): Promise<number> {
    try {
      if (keys.length === 0) return 0;
      return await this.client.del(...keys);
    } catch (error) {
      logger.error('Redis DELETE MULTIPLE operation failed', { 
        keys, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Set expiration for a key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, seconds);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXPIRE operation failed', { 
        key, 
        seconds,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get TTL of a key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis TTL operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ==========================================
  // Counter Operations
  // ==========================================

  /**
   * Increment a counter
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error('Redis INCR operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Increment by specific amount
   */
  async incrby(key: string, increment: number): Promise<number> {
    try {
      return await this.client.incrby(key, increment);
    } catch (error) {
      logger.error('Redis INCRBY operation failed', { 
        key, 
        increment,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Decrement a counter
   */
  async decr(key: string): Promise<number> {
    try {
      return await this.client.decr(key);
    } catch (error) {
      logger.error('Redis DECR operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ==========================================
  // Hash Operations
  // ==========================================

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: any): Promise<number> {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      return await this.client.hset(key, field, serialized);
    } catch (error) {
      logger.error('Redis HSET operation failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hget(key, field);
    } catch (error) {
      logger.error('Redis HGET operation failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hgetall(key);
    } catch (error) {
      logger.error('Redis HGETALL operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Delete hash field
   */
  async hdel(key: string, field: string): Promise<number> {
    try {
      return await this.client.hdel(key, field);
    } catch (error) {
      logger.error('Redis HDEL operation failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ==========================================
  // Set Operations
  // ==========================================

  /**
   * Add member to set
   */
  async sadd(key: string, member: string): Promise<number> {
    try {
      return await this.client.sadd(key, member);
    } catch (error) {
      logger.error('Redis SADD operation failed', { 
        key, 
        member,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Check if member exists in set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.client.sismember(key, member);
      return result === 1;
    } catch (error) {
      logger.error('Redis SISMEMBER operation failed', { 
        key, 
        member,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Remove member from set
   */
  async srem(key: string, member: string): Promise<number> {
    try {
      return await this.client.srem(key, member);
    } catch (error) {
      logger.error('Redis SREM operation failed', { 
        key, 
        member,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get all members of set
   */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.smembers(key);
    } catch (error) {
      logger.error('Redis SMEMBERS operation failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ==========================================
  // Pattern Operations
  // ==========================================

  /**
   * Find keys by pattern
   */
  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis KEYS operation failed', { 
        pattern, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Scan keys by pattern (more efficient than KEYS)
   */
  async scanKeys(pattern: string, count = 100): Promise<string[]> {
    try {
      const keys: string[] = [];
      let cursor = 0;

      do {
        const result = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
        cursor = parseInt(result[0]);
        keys.push(...result[1]);
      } while (cursor !== 0);

      return keys;
    } catch (error) {
      logger.error('Redis SCAN operation failed', { 
        pattern, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ==========================================
  // Batch Operations
  // ==========================================

  /**
   * Execute multiple operations in a pipeline
   */
  async pipeline(operations: Array<{ command: string; args: any[] }>): Promise<any[]> {
    try {
      const pipeline = this.client.pipeline();
      
      operations.forEach(({ command, args }) => {
        (pipeline as any)[command](...args);
      });
      
      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Pipeline execution failed');
      }
      
      // Check for errors in pipeline results
      const errors = results.filter(([error]) => error !== null);
      if (errors.length > 0) {
        logger.error('Pipeline operations had errors', { errors });
        throw new Error(`Pipeline had ${errors.length} failed operations`);
      }
      
      return results.map(([, result]) => result);
    } catch (error) {
      logger.error('Redis PIPELINE operation failed', { 
        operations: operations.length,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  // ==========================================
  // Session Management Helpers
  // ==========================================

  /**
   * Store user session
   */
  async storeSession(sessionId: string, sessionData: any, ttl = 3600): Promise<void> {
    await this.setex(`session:${sessionId}`, ttl, sessionData);
  }

  /**
   * Get user session
   */
  async getSession<T = any>(sessionId: string): Promise<T | null> {
    return await this.getJSON<T>(`session:${sessionId}`);
  }

  /**
   * Delete user session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.delete(`session:${sessionId}`);
  }

  /**
   * Store user data cache
   */
  async cacheUser(userId: string, userData: any, ttl = 1800): Promise<void> {
    await this.setex(`user:${userId}`, ttl, userData);
  }

  /**
   * Get cached user data
   */
  async getCachedUser<T = any>(userId: string): Promise<T | null> {
    return await this.getJSON<T>(`user:${userId}`);
  }

  /**
   * Clear user cache
   */
  async clearUserCache(userId: string): Promise<void> {
    const patterns = [
      `user:${userId}`,
      `session:*:${userId}`,
      `rate_limit:*:${userId}`,
      `mfa:*:${userId}`
    ];

    for (const pattern of patterns) {
      const keys = await this.scanKeys(pattern);
      if (keys.length > 0) {
        await this.deleteMultiple(keys);
      }
    }
  }

  // ==========================================
  // Rate Limiting Helpers
  // ==========================================

  /**
   * Check and increment rate limit counter
   */
  async checkRateLimit(
    key: string, 
    limit: number, 
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: Date }> {
    try {
      const fullKey = `rate_limit:${key}`;
      const current = await this.incr(fullKey);
      
      if (current === 1) {
        await this.expire(fullKey, windowSeconds);
      }
      
      const ttl = await this.ttl(fullKey);
      const resetTime = new Date(Date.now() + (ttl * 1000));
      
      return {
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
        resetTime
      };
    } catch (error) {
      logger.error('Rate limit check failed', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      // On error, allow the request but log it
      return {
        allowed: true,
        remaining: limit,
        resetTime: new Date(Date.now() + (windowSeconds * 1000))
      };
    }
  }

  // ==========================================
  // Lock Management
  // ==========================================

  /**
   * Acquire distributed lock
   */
  async acquireLock(
    lockKey: string, 
    ttl = 30, 
    timeout = 5000
  ): Promise<{ acquired: boolean; releaseKey?: string }> {
    const releaseKey = `${Date.now()}-${Math.random()}`;
    const key = `lock:${lockKey}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const result = await this.client.set(key, releaseKey, 'EX', ttl, 'NX');
        if (result === 'OK') {
          return { acquired: true, releaseKey };
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) {
        logger.error('Lock acquisition failed', { 
          lockKey, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        break;
      }
    }

    return { acquired: false };
  }

  /**
   * Release distributed lock
   */
  async releaseLock(lockKey: string, releaseKey: string): Promise<boolean> {
    try {
      const key = `lock:${lockKey}`;
      
      // Lua script to ensure we only delete the lock if we own it
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.client.eval(luaScript, 1, key, releaseKey);
      return result === 1;
    } catch (error) {
      logger.error('Lock release failed', { 
        lockKey, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  // ==========================================
  // Health Check
  // ==========================================

  /**
   * Ping Redis server
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis ping failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  /**
   * Get Redis info
   */
  async info(): Promise<string> {
    try {
      return await this.client.info();
    } catch (error) {
      logger.error('Redis info failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();