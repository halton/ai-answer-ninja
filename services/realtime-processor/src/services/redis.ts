import { createClient, RedisClientType } from 'redis';
import { RedisConfig, RealtimeProcessorError } from '../types';
import logger from '../utils/logger';

export class RedisService {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private publisher: RedisClientType;
  private isConnected = false;
  private subscriptions: Map<string, (message: any) => void> = new Map();
  private readonly config: RedisConfig;

  constructor(config: RedisConfig) {
    this.config = config;
    
    // Create Redis clients
    const clientConfig = {
      url: config.url,
      password: config.password,
      database: config.database,
      socket: {
        connectTimeout: config.connectTimeout,
        lazyConnect: true,
      },
      retry: {
        retries: config.maxRetries,
        delay: (attempt: number) => Math.min(attempt * config.retryDelay, 10000),
      },
    };

    this.client = createClient(clientConfig);
    this.subscriber = createClient(clientConfig);
    this.publisher = createClient(clientConfig);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Main client events
    this.client.on('error', (error) => {
      logger.error({ error }, 'Redis client error');
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('disconnect', () => {
      logger.warn('Redis client disconnected');
      this.isConnected = false;
    });

    // Subscriber events
    this.subscriber.on('error', (error) => {
      logger.error({ error }, 'Redis subscriber error');
    });

    // Publisher events
    this.publisher.on('error', (error) => {
      logger.error({ error }, 'Redis publisher error');
    });
  }

  public async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);

      this.isConnected = true;
      logger.info('Redis service connected successfully');

      // Test connection
      await this.client.ping();
      logger.debug('Redis ping successful');

    } catch (error) {
      logger.error({ error }, 'Failed to connect to Redis');
      throw new RealtimeProcessorError(`Redis connection failed: ${error.message}`, 'REDIS_CONNECTION_ERROR', 500);
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await Promise.all([
        this.client.disconnect(),
        this.subscriber.disconnect(),
        this.publisher.disconnect(),
      ]);

      this.isConnected = false;
      logger.info('Redis service disconnected');

    } catch (error) {
      logger.error({ error }, 'Error disconnecting from Redis');
      throw error;
    }
  }

  // Basic Redis operations
  public async get<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error({ error, key }, 'Redis GET error');
      return null;
    }
  }

  public async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      
      if (ttl) {
        await this.client.setEx(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      logger.error({ error, key }, 'Redis SET error');
      throw new RealtimeProcessorError(`Redis SET failed: ${error.message}`, 'REDIS_SET_ERROR', 500);
    }
  }

  public async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error({ error, key }, 'Redis DEL error');
      throw new RealtimeProcessorError(`Redis DEL failed: ${error.message}`, 'REDIS_DEL_ERROR', 500);
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error({ error, key }, 'Redis EXISTS error');
      return false;
    }
  }

  public async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      logger.error({ error, key, seconds }, 'Redis EXPIRE error');
      throw new RealtimeProcessorError(`Redis EXPIRE failed: ${error.message}`, 'REDIS_EXPIRE_ERROR', 500);
    }
  }

  // Hash operations
  public async hget(key: string, field: string): Promise<any> {
    try {
      const value = await this.client.hGet(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error({ error, key, field }, 'Redis HGET error');
      return null;
    }
  }

  public async hset(key: string, field: string, value: any): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.client.hSet(key, field, serialized);
    } catch (error) {
      logger.error({ error, key, field }, 'Redis HSET error');
      throw new RealtimeProcessorError(`Redis HSET failed: ${error.message}`, 'REDIS_HSET_ERROR', 500);
    }
  }

  public async hdel(key: string, field: string): Promise<void> {
    try {
      await this.client.hDel(key, field);
    } catch (error) {
      logger.error({ error, key, field }, 'Redis HDEL error');
      throw new RealtimeProcessorError(`Redis HDEL failed: ${error.message}`, 'REDIS_HDEL_ERROR', 500);
    }
  }

  public async hgetall(key: string): Promise<Record<string, any>> {
    try {
      const hash = await this.client.hGetAll(key);
      const parsed: Record<string, any> = {};
      
      for (const [field, value] of Object.entries(hash)) {
        try {
          parsed[field] = JSON.parse(value);
        } catch {
          parsed[field] = value; // Keep as string if not valid JSON
        }
      }
      
      return parsed;
    } catch (error) {
      logger.error({ error, key }, 'Redis HGETALL error');
      return {};
    }
  }

  // List operations
  public async lpush(key: string, value: any): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.client.lPush(key, serialized);
    } catch (error) {
      logger.error({ error, key }, 'Redis LPUSH error');
      throw new RealtimeProcessorError(`Redis LPUSH failed: ${error.message}`, 'REDIS_LPUSH_ERROR', 500);
    }
  }

  public async rpop(key: string): Promise<any> {
    try {
      const value = await this.client.rPop(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error({ error, key }, 'Redis RPOP error');
      return null;
    }
  }

  public async llen(key: string): Promise<number> {
    try {
      return await this.client.lLen(key);
    } catch (error) {
      logger.error({ error, key }, 'Redis LLEN error');
      return 0;
    }
  }

  // Set operations
  public async sadd(key: string, member: any): Promise<void> {
    try {
      const serialized = JSON.stringify(member);
      await this.client.sAdd(key, serialized);
    } catch (error) {
      logger.error({ error, key }, 'Redis SADD error');
      throw new RealtimeProcessorError(`Redis SADD failed: ${error.message}`, 'REDIS_SADD_ERROR', 500);
    }
  }

  public async srem(key: string, member: any): Promise<void> {
    try {
      const serialized = JSON.stringify(member);
      await this.client.sRem(key, serialized);
    } catch (error) {
      logger.error({ error, key }, 'Redis SREM error');
      throw new RealtimeProcessorError(`Redis SREM failed: ${error.message}`, 'REDIS_SREM_ERROR', 500);
    }
  }

  public async smembers(key: string): Promise<any[]> {
    try {
      const members = await this.client.sMembers(key);
      return members.map(member => {
        try {
          return JSON.parse(member);
        } catch {
          return member;
        }
      });
    } catch (error) {
      logger.error({ error, key }, 'Redis SMEMBERS error');
      return [];
    }
  }

  // Pub/Sub operations
  public async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    try {
      this.subscriptions.set(channel, callback);

      // Set up message handler for this channel
      this.subscriber.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          try {
            const parsed = JSON.parse(message);
            callback(parsed);
          } catch {
            callback(message); // Send as string if not valid JSON
          }
        }
      });

      await this.subscriber.subscribe(channel);
      logger.debug({ channel }, 'Subscribed to Redis channel');

    } catch (error) {
      logger.error({ error, channel }, 'Redis SUBSCRIBE error');
      throw new RealtimeProcessorError(`Redis SUBSCRIBE failed: ${error.message}`, 'REDIS_SUBSCRIBE_ERROR', 500);
    }
  }

  public async unsubscribe(channel: string): Promise<void> {
    try {
      await this.subscriber.unsubscribe(channel);
      this.subscriptions.delete(channel);
      logger.debug({ channel }, 'Unsubscribed from Redis channel');
    } catch (error) {
      logger.error({ error, channel }, 'Redis UNSUBSCRIBE error');
      throw new RealtimeProcessorError(`Redis UNSUBSCRIBE failed: ${error.message}`, 'REDIS_UNSUBSCRIBE_ERROR', 500);
    }
  }

  public async publish(channel: string, message: any): Promise<void> {
    try {
      const serialized = JSON.stringify(message);
      await this.publisher.publish(channel, serialized);
      logger.debug({ channel }, 'Published message to Redis channel');
    } catch (error) {
      logger.error({ error, channel }, 'Redis PUBLISH error');
      throw new RealtimeProcessorError(`Redis PUBLISH failed: ${error.message}`, 'REDIS_PUBLISH_ERROR', 500);
    }
  }

  // Utility methods
  public async flushdb(): Promise<void> {
    try {
      await this.client.flushDb();
      logger.info('Redis database flushed');
    } catch (error) {
      logger.error({ error }, 'Redis FLUSHDB error');
      throw new RealtimeProcessorError(`Redis FLUSHDB failed: ${error.message}`, 'REDIS_FLUSHDB_ERROR', 500);
    }
  }

  public async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error({ error }, 'Redis PING error');
      return false;
    }
  }

  public async info(): Promise<string> {
    try {
      return await this.client.info();
    } catch (error) {
      logger.error({ error }, 'Redis INFO error');
      return '';
    }
  }

  // Advanced operations
  public async increment(key: string, amount: number = 1): Promise<number> {
    try {
      return await this.client.incrBy(key, amount);
    } catch (error) {
      logger.error({ error, key, amount }, 'Redis INCREMENT error');
      throw new RealtimeProcessorError(`Redis INCREMENT failed: ${error.message}`, 'REDIS_INCREMENT_ERROR', 500);
    }
  }

  public async setWithExpiry(key: string, value: any, seconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, seconds, serialized);
    } catch (error) {
      logger.error({ error, key, seconds }, 'Redis SET with expiry error');
      throw new RealtimeProcessorError(`Redis SET with expiry failed: ${error.message}`, 'REDIS_SET_EXPIRY_ERROR', 500);
    }
  }

  public async getMultiple(keys: string[]): Promise<Array<any | null>> {
    try {
      const values = await this.client.mGet(keys);
      return values.map(value => {
        if (value === null) return null;
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      });
    } catch (error) {
      logger.error({ error, keys }, 'Redis MGET error');
      return keys.map(() => null);
    }
  }

  public async setMultiple(keyValuePairs: Array<{ key: string; value: any }>): Promise<void> {
    try {
      const pipeline = this.client.multi();
      
      for (const { key, value } of keyValuePairs) {
        const serialized = JSON.stringify(value);
        pipeline.set(key, serialized);
      }
      
      await pipeline.exec();
    } catch (error) {
      logger.error({ error, count: keyValuePairs.length }, 'Redis MSET error');
      throw new RealtimeProcessorError(`Redis MSET failed: ${error.message}`, 'REDIS_MSET_ERROR', 500);
    }
  }

  // Transaction support
  public multi(): any {
    return this.client.multi();
  }

  // Health check
  public async healthCheck(): Promise<{ status: string; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();
      const result = await this.ping();
      const latency = Date.now() - startTime;

      return {
        status: result ? 'healthy' : 'unhealthy',
        latency,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  // Getters
  public get connected(): boolean {
    return this.isConnected;
  }

  public getClient(): RedisClientType {
    return this.client;
  }

  public getSubscriber(): RedisClientType {
    return this.subscriber;
  }

  public getPublisher(): RedisClientType {
    return this.publisher;
  }
}