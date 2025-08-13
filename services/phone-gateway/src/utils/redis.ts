import Redis, { Redis as RedisClient } from 'ioredis';
import logger from './logger';
import config from '../config';

export class RedisManager {
  private client: RedisClient | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize Redis client
   */
  private initialize(): void {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryStrategy: (times: number) => {
          if (times > this.maxReconnectAttempts) {
            logger.error('Max reconnection attempts reached for Redis');
            return null;
          }
          const delay = Math.min(times * 100, 3000);
          logger.info({ attempt: times, delay }, 'Reconnecting to Redis');
          return delay;
        },
        enableOfflineQueue: true,
        maxRetriesPerRequest: 3
      });

      this.setupEventHandlers();
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis client');
      throw error;
    }
  }

  /**
   * Set up Redis event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      logger.error({ error }, 'Redis client error');
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      this.reconnectAttempts++;
      logger.info({ attempt: this.reconnectAttempts }, 'Redis client reconnecting');
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (!this.client) {
      this.initialize();
    }

    try {
      await this.client!.connect();
      this.isConnected = true;
    } catch (error) {
      logger.error({ error }, 'Failed to connect to Redis');
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis client disconnected');
    } catch (error) {
      logger.error({ error }, 'Failed to disconnect from Redis');
      throw error;
    }
  }

  /**
   * Get value by key
   */
  async get(key: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error({ error, key }, 'Failed to get value from Redis');
      throw error;
    }
  }

  /**
   * Set value with optional TTL
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error({ error, key }, 'Failed to set value in Redis');
      throw error;
    }
  }

  /**
   * Delete key
   */
  async delete(key: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      await this.client.del(key);
    } catch (error) {
      logger.error({ error, key }, 'Failed to delete key from Redis');
      throw error;
    }
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error({ error, pattern }, 'Failed to get keys from Redis');
      throw error;
    }
  }

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      await this.client.hset(key, field, value);
    } catch (error) {
      logger.error({ error, key, field }, 'Failed to set hash field in Redis');
      throw error;
    }
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      return await this.client.hget(key, field);
    } catch (error) {
      logger.error({ error, key, field }, 'Failed to get hash field from Redis');
      throw error;
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      return await this.client.hgetall(key);
    } catch (error) {
      logger.error({ error, key }, 'Failed to get hash from Redis');
      throw error;
    }
  }

  /**
   * Add to list
   */
  async lpush(key: string, value: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      await this.client.lpush(key, value);
    } catch (error) {
      logger.error({ error, key }, 'Failed to push to list in Redis');
      throw error;
    }
  }

  /**
   * Get list range
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      return await this.client.lrange(key, start, stop);
    } catch (error) {
      logger.error({ error, key }, 'Failed to get list range from Redis');
      throw error;
    }
  }

  /**
   * Add to sorted set
   */
  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      await this.client.zadd(key, score, member);
    } catch (error) {
      logger.error({ error, key }, 'Failed to add to sorted set in Redis');
      throw error;
    }
  }

  /**
   * Get sorted set range by score
   */
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    limit?: { offset: number; count: number }
  ): Promise<string[]> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      if (limit) {
        return await this.client.zrangebyscore(
          key,
          min,
          max,
          'LIMIT',
          limit.offset,
          limit.count
        );
      }
      return await this.client.zrangebyscore(key, min, max);
    } catch (error) {
      logger.error({ error, key }, 'Failed to get sorted set range from Redis');
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Execute transaction
   */
  async transaction(operations: Array<[string, ...any[]]>): Promise<any[]> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      const pipeline = this.client.pipeline();
      
      for (const [command, ...args] of operations) {
        (pipeline as any)[command](...args);
      }

      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Transaction failed');
      }

      return results.map(([err, result]) => {
        if (err) throw err;
        return result;
      });
    } catch (error) {
      logger.error({ error }, 'Failed to execute Redis transaction');
      throw error;
    }
  }

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      await this.client.publish(channel, message);
    } catch (error) {
      logger.error({ error, channel }, 'Failed to publish message to Redis channel');
      throw error;
    }
  }

  /**
   * Subscribe to channel
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      await this.client.subscribe(channel);
      
      this.client.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          callback(message);
        }
      });
    } catch (error) {
      logger.error({ error, channel }, 'Failed to subscribe to Redis channel');
      throw error;
    }
  }
}

// Export singleton instance
export const RedisClient = RedisManager;