import { createClient, RedisClientType } from 'redis';
import { config } from '@/config';
import { logger } from '@/utils/logger';

class RedisManager {
  private client: RedisClientType;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    this.client = createClient({
      socket: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        connectTimeout: 5000,
        lazyConnect: true,
      },
      password: config.REDIS_PASSWORD,
      database: config.REDIS_DB,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.on('connect', () => {
      logger.info('Redis client connecting...');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('Redis client connected successfully', {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        database: config.REDIS_DB,
      });
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error', { 
        error: error.message,
        stack: error.stack 
      });
    });

    this.client.on('end', () => {
      this.isConnected = false;
      logger.warn('Redis client connection ended');
    });

    this.client.on('reconnecting', () => {
      this.reconnectAttempts++;
      logger.info(`Redis client reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error('Max Redis reconnection attempts reached');
      }
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Redis connection failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis client disconnected successfully');
    } catch (error) {
      logger.error('Redis disconnection failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Basic Redis operations with error handling and logging
  async get(key: string): Promise<string | null> {
    try {
      const start = Date.now();
      const value = await this.client.get(key);
      const duration = Date.now() - start;
      
      logger.debug('Redis GET operation', { key, found: !!value, duration: `${duration}ms` });
      return value;
    } catch (error) {
      logger.error('Redis GET failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      const start = Date.now();
      
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      
      const duration = Date.now() - start;
      logger.debug('Redis SET operation', { key, ttl, duration: `${duration}ms` });
    } catch (error) {
      logger.error('Redis SET failed', { 
        key, 
        ttl,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async del(key: string | string[]): Promise<number> {
    try {
      const start = Date.now();
      const deletedCount = await this.client.del(key);
      const duration = Date.now() - start;
      
      logger.debug('Redis DEL operation', { 
        key: Array.isArray(key) ? key.length : 1, 
        deleted: deletedCount, 
        duration: `${duration}ms` 
      });
      
      return deletedCount;
    } catch (error) {
      logger.error('Redis DEL failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async exists(key: string | string[]): Promise<number> {
    try {
      const count = await this.client.exists(key);
      return count;
    } catch (error) {
      logger.error('Redis EXISTS failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, seconds);
      return result;
    } catch (error) {
      logger.error('Redis EXPIRE failed', { 
        key, 
        seconds,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis TTL failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // JSON operations for complex data structures
  async getJson<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis JSON GET failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  async setJson<T = any>(key: string, data: T, ttl?: number): Promise<void> {
    try {
      const value = JSON.stringify(data);
      await this.set(key, value, ttl);
    } catch (error) {
      logger.error('Redis JSON SET failed', { 
        key, 
        ttl,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    try {
      const value = await this.client.hGet(key, field);
      return value || null;
    } catch (error) {
      logger.error('Redis HGET failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      await this.client.hSet(key, field, value);
    } catch (error) {
      logger.error('Redis HSET failed', { 
        key, 
        field,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      logger.error('Redis HGETALL failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async hdel(key: string, fields: string | string[]): Promise<number> {
    try {
      return await this.client.hDel(key, fields);
    } catch (error) {
      logger.error('Redis HDEL failed', { 
        key, 
        fields,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Set operations for pattern matching
  async sadd(key: string, members: string | string[]): Promise<number> {
    try {
      return await this.client.sAdd(key, members);
    } catch (error) {
      logger.error('Redis SADD failed', { 
        key, 
        members,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      return await this.client.sIsMember(key, member);
    } catch (error) {
      logger.error('Redis SISMEMBER failed', { 
        key, 
        member,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.sMembers(key);
    } catch (error) {
      logger.error('Redis SMEMBERS failed', { 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Batch operations
  async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      const start = Date.now();
      const values = await this.client.mGet(keys);
      const duration = Date.now() - start;
      
      logger.debug('Redis MGET operation', { 
        keys: keys.length, 
        found: values.filter(v => v !== null).length,
        duration: `${duration}ms` 
      });
      
      return values;
    } catch (error) {
      logger.error('Redis MGET failed', { 
        keys: keys.length,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async mset(keyValues: Record<string, string>): Promise<void> {
    try {
      const start = Date.now();
      await this.client.mSet(keyValues);
      const duration = Date.now() - start;
      
      logger.debug('Redis MSET operation', { 
        keys: Object.keys(keyValues).length, 
        duration: `${duration}ms` 
      });
    } catch (error) {
      logger.error('Redis MSET failed', { 
        keys: Object.keys(keyValues).length,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Pattern matching
  async keys(pattern: string): Promise<string[]> {
    try {
      const keys = await this.client.keys(pattern);
      logger.debug('Redis KEYS operation', { pattern, count: keys.length });
      return keys;
    } catch (error) {
      logger.error('Redis KEYS failed', { 
        pattern,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    
    try {
      await this.client.ping();
      const latency = Date.now() - start;
      
      return {
        healthy: true,
        latency,
      };
    } catch (error) {
      logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        healthy: false,
        latency: Date.now() - start,
      };
    }
  }

  // Statistics
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
    };
  }

  // Graceful cleanup
  async flushPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      if (keys.length === 0) return 0;
      
      return await this.del(keys);
    } catch (error) {
      logger.error('Redis pattern flush failed', { 
        pattern,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }
}

export const redis = new RedisManager();
export default redis;