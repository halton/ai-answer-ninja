/**
 * Redis集群管理器 - 支持单实例和集群模式
 */

import Redis, { Cluster, RedisOptions } from 'ioredis';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { RedisClusterConfig, CacheError, CacheConnectionError } from '../types';
import { Logger } from '../utils/Logger';

interface RedisHealthStatus {
  healthy: boolean;
  message?: string;
  nodes?: Array<{
    host: string;
    port: number;
    status: 'connected' | 'disconnected' | 'connecting';
  }>;
}

interface ConnectionConfig extends RedisOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  cluster?: RedisClusterConfig;
  ttl: number;
  maxRetries?: number;
  retryDelayOnFailover?: number;
}

export class RedisClusterManager extends EventEmitter {
  private client: Redis | Cluster | null = null;
  private config: ConnectionConfig;
  private logger: Logger;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: ConnectionConfig) {
    super();
    this.config = config;
    this.logger = new Logger('RedisClusterManager');
    this.setupEventHandlers();
  }

  /**
   * 连接到Redis
   */
  async connect(): Promise<void> {
    try {
      this.logger.info('Connecting to Redis...');
      
      if (this.config.cluster) {
        await this.connectToCluster();
      } else {
        await this.connectToSingleNode();
      }
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHealthCheck();
      
      this.logger.info('Redis connection established');
      this.emit('connected');
      
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
      this.emit('error', error);
      throw new CacheConnectionError('L2', `Connection failed: ${error.message}`);
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    try {
      this.logger.info('Disconnecting from Redis...');
      
      this.stopHealthCheck();
      
      if (this.client) {
        await this.client.quit();
        this.client = null;
      }
      
      this.isConnected = false;
      this.logger.info('Redis disconnected');
      this.emit('disconnected');
      
    } catch (error) {
      this.logger.error('Error during Redis disconnection:', error);
      throw error;
    }
  }

  /**
   * 获取值
   */
  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    
    try {
      const value = await this.client!.get(key);
      return value;
    } catch (error) {
      this.logger.error(`Failed to get key ${key}:`, error);
      this.handleConnectionError(error);
      return null;
    }
  }

  /**
   * 设置值
   */
  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    this.ensureConnected();
    
    try {
      const expireTime = ttl || this.config.ttl;
      const result = await this.client!.setex(key, expireTime, value);
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to set key ${key}:`, error);
      this.handleConnectionError(error);
      return false;
    }
  }

  /**
   * 批量获取
   */
  async mget(keys: string[]): Promise<Map<string, string>> {
    this.ensureConnected();
    const results = new Map<string, string>();
    
    if (keys.length === 0) return results;
    
    try {
      const values = await this.client!.mget(...keys);
      
      keys.forEach((key, index) => {
        if (values[index] !== null) {
          results.set(key, values[index]!);
        }
      });
      
      return results;
    } catch (error) {
      this.logger.error('Failed to execute mget:', error);
      this.handleConnectionError(error);
      return results;
    }
  }

  /**
   * 批量设置
   */
  async mset(entries: Array<{key: string, value: string, ttl: number}>): Promise<boolean> {
    this.ensureConnected();
    
    try {
      // Redis MSET不支持TTL，使用pipeline批量执行
      const pipeline = this.client!.pipeline();
      
      entries.forEach(entry => {
        pipeline.setex(entry.key, entry.ttl, entry.value);
      });
      
      const results = await pipeline.exec();
      
      if (!results) return false;
      
      // 检查所有操作是否成功
      return results.every(([error, result]) => error === null && result === 'OK');
      
    } catch (error) {
      this.logger.error('Failed to execute mset:', error);
      this.handleConnectionError(error);
      return false;
    }
  }

  /**
   * 删除键
   */
  async delete(key: string): Promise<boolean> {
    this.ensureConnected();
    
    try {
      const result = await this.client!.del(key);
      return result > 0;
    } catch (error) {
      this.logger.error(`Failed to delete key ${key}:`, error);
      this.handleConnectionError(error);
      return false;
    }
  }

  /**
   * 检查键是否存在
   */
  async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    
    try {
      const result = await this.client!.exists(key);
      return result > 0;
    } catch (error) {
      this.logger.error(`Failed to check existence of key ${key}:`, error);
      this.handleConnectionError(error);
      return false;
    }
  }

  /**
   * 模式匹配删除
   */
  async deletePattern(pattern: string): Promise<number> {
    this.ensureConnected();
    
    try {
      let cursor = '0';
      let deletedCount = 0;
      
      do {
        const [nextCursor, keys] = await this.client!.scan(
          cursor, 
          'MATCH', 
          pattern, 
          'COUNT', 
          100
        );
        
        cursor = nextCursor;
        
        if (keys.length > 0) {
          const deleted = await this.client!.del(...keys);
          deletedCount += deleted;
        }
        
      } while (cursor !== '0');
      
      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete pattern ${pattern}:`, error);
      this.handleConnectionError(error);
      return 0;
    }
  }

  /**
   * 清空所有数据
   */
  async flushAll(): Promise<number> {
    this.ensureConnected();
    
    try {
      if (this.client instanceof Cluster) {
        // 集群模式下需要对每个节点执行FLUSHDB
        const nodes = this.client.nodes('master');
        let totalCleared = 0;
        
        for (const node of nodes) {
          await node.flushdb();
          totalCleared += 1; // 无法准确统计，返回节点数
        }
        
        return totalCleared;
      } else {
        // 单节点模式
        const info = await this.client.info('keyspace');
        const dbMatch = info.match(/db0:keys=(\d+)/);
        const keyCount = dbMatch ? parseInt(dbMatch[1]) : 0;
        
        await this.client.flushdb();
        return keyCount;
      }
    } catch (error) {
      this.logger.error('Failed to flush all data:', error);
      this.handleConnectionError(error);
      return 0;
    }
  }

  /**
   * 设置键过期时间
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    this.ensureConnected();
    
    try {
      const result = await this.client!.expire(key, seconds);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to set expiration for key ${key}:`, error);
      this.handleConnectionError(error);
      return false;
    }
  }

  /**
   * 获取键的TTL
   */
  async ttl(key: string): Promise<number> {
    this.ensureConnected();
    
    try {
      return await this.client!.ttl(key);
    } catch (error) {
      this.logger.error(`Failed to get TTL for key ${key}:`, error);
      this.handleConnectionError(error);
      return -1;
    }
  }

  /**
   * 获取Redis信息
   */
  async info(section?: string): Promise<string> {
    this.ensureConnected();
    
    try {
      return await this.client!.info(section);
    } catch (error) {
      this.logger.error('Failed to get Redis info:', error);
      this.handleConnectionError(error);
      return '';
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<RedisHealthStatus> {
    try {
      if (!this.isConnected || !this.client) {
        return {
          healthy: false,
          message: 'Not connected to Redis'
        };
      }

      // Ping测试
      const pong = await this.client.ping();
      if (pong !== 'PONG') {
        return {
          healthy: false,
          message: 'Ping test failed'
        };
      }

      // 获取节点状态（如果是集群）
      if (this.client instanceof Cluster) {
        const nodes = this.client.nodes();
        const nodeStatuses = nodes.map(node => ({
          host: node.options.host,
          port: node.options.port,
          status: node.status as 'connected' | 'disconnected' | 'connecting'
        }));

        const unhealthyNodes = nodeStatuses.filter(n => n.status !== 'connected');
        
        return {
          healthy: unhealthyNodes.length === 0,
          message: unhealthyNodes.length > 0 ? 
            `${unhealthyNodes.length} nodes unhealthy` : 
            'All nodes healthy',
          nodes: nodeStatuses
        };
      }

      return {
        healthy: true,
        message: 'Redis is healthy'
      };
      
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        healthy: false,
        message: `Health check error: ${error.message}`
      };
    }
  }

  /**
   * 获取连接状态
   */
  isHealthy(): boolean {
    return this.isConnected && this.client !== null;
  }

  // Private methods

  private async connectToSingleNode(): Promise<void> {
    const options: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db || 0,
      maxRetriesPerRequest: this.config.maxRetries || 3,
      retryDelayOnFailover: this.config.retryDelayOnFailover || 100,
      lazyConnect: false,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      enableReadyCheck: true,
      maxLoadingTimeout: 20000
    };

    this.client = new Redis(options);
    await this.waitForConnection();
  }

  private async connectToCluster(): Promise<void> {
    const clusterConfig = this.config.cluster!;
    
    const options = {
      enableReadyCheck: clusterConfig.options?.enableReadyCheck ?? true,
      redisOptions: {
        password: this.config.password,
        db: this.config.db || 0,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
        ...clusterConfig.options?.redisOptions
      },
      maxRetriesPerRequest: clusterConfig.options?.maxRetriesPerRequest ?? 3
    };

    this.client = new Redis.Cluster(clusterConfig.nodes, options);
    await this.waitForConnection();
  }

  private async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 20000);

      this.client.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private setupEventHandlers(): void {
    // 连接事件处理将在client创建后设置
  }

  private setupClientEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      this.logger.info('Redis client connected');
      this.isConnected = true;
      this.emit('connected');
    });

    this.client.on('ready', () => {
      this.logger.info('Redis client ready');
      this.emit('ready');
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis client error:', error);
      this.isConnected = false;
      this.emit('error', error);
      
      // 自动重连
      this.handleReconnection(error);
    });

    this.client.on('close', () => {
      this.logger.warn('Redis client connection closed');
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.client.on('reconnecting', () => {
      this.logger.info('Redis client reconnecting...');
      this.emit('reconnecting');
    });

    // 集群特定事件
    if (this.client instanceof Cluster) {
      this.client.on('node error', (error, node) => {
        this.logger.error(`Redis cluster node error (${node.options.host}:${node.options.port}):`, error);
        this.emit('nodeError', { error, node: node.options });
      });
    }
  }

  private ensureConnected(): void {
    if (!this.isConnected || !this.client) {
      throw new CacheConnectionError('L2', 'Redis not connected');
    }
  }

  private handleConnectionError(error: any): void {
    if (error.message.includes('Connection is closed') || 
        error.message.includes('Connection refused')) {
      this.isConnected = false;
      this.emit('error', error);
    }
  }

  private async handleReconnection(error: any): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached', error);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    this.logger.info(`Attempting to reconnect to Redis (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (reconnectError) {
        this.logger.error('Reconnection failed:', reconnectError);
      }
    }, delay);
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const health = await this.healthCheck();
      if (!health.healthy) {
        this.logger.warn('Redis health check failed:', health.message);
        this.emit('unhealthy', health);
      }
    }, 30000); // 30秒检查一次
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}