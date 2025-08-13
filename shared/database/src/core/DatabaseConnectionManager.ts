/**
 * AI Answer Ninja - Enhanced Database Connection Manager
 * Provides intelligent connection pooling, read-write separation, and caching
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { EventEmitter } from 'events';
import { DatabaseConfig, QueryOptions, QueryResult, ConnectionStats } from '../types';
import { createLogger } from '../utils/Logger';
import { QueryOptimizer } from '../optimization/QueryOptimizer';
import { PerformanceMonitor } from '../optimization/PerformanceMonitor';

export class DatabaseConnectionManager extends EventEmitter {
  private primaryPool: Pool;
  private replicaPools: Pool[] = [];
  private redisClient: RedisClientType;
  private config: DatabaseConfig;
  private logger = createLogger('DatabaseConnectionManager');
  private queryOptimizer: QueryOptimizer;
  private performanceMonitor: PerformanceMonitor;
  
  private replicaWeights: number[] = [];
  private replicaHealthStatus: boolean[] = [];
  private connectionStats: ConnectionStats = {
    primary: { active: 0, idle: 0, waiting: 0, total: 0 },
    replicas: []
  };
  
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private statsUpdateInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(config: DatabaseConfig) {
    super();
    this.config = config;
    this.queryOptimizer = new QueryOptimizer();
    this.performanceMonitor = new PerformanceMonitor();
    
    this.initializePools();
    this.initializeRedis();
    this.startMonitoring();
  }

  private initializePools(): void {
    try {
      // Initialize primary pool with write optimization
      this.primaryPool = new Pool({
        ...this.config.primary,
        ...this.config.poolConfig.primary,
        application_name: 'ai-ninja-primary',
        statement_timeout: 30000,
        query_timeout: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
      });

      this.setupPoolEventHandlers(this.primaryPool, 'primary');

      // Initialize replica pools
      this.config.replicas.forEach((replica, index) => {
        const replicaPool = new Pool({
          ...replica,
          ...this.config.poolConfig.replica,
          application_name: `ai-ninja-replica-${index}`,
          statement_timeout: 15000,
          query_timeout: 15000,
          keepAlive: true,
          options: '--default_transaction_read_only=on'
        });

        this.replicaPools.push(replicaPool);
        this.replicaWeights.push(replica.weight || 1);
        this.replicaHealthStatus.push(true);
        this.connectionStats.replicas.push({ active: 0, idle: 0, waiting: 0, total: 0 });

        this.setupPoolEventHandlers(replicaPool, `replica-${index}`);
      });

      this.logger.info(`Initialized database pools: 1 primary, ${this.replicaPools.length} replicas`);
    } catch (error) {
      this.logger.error('Failed to initialize database pools:', error);
      throw error;
    }
  }

  private setupPoolEventHandlers(pool: Pool, poolName: string): void {
    pool.on('connect', (client: PoolClient) => {
      this.logger.debug(`${poolName} pool: new connection established`);
      
      client.on('error', (err) => {
        this.logger.error(`${poolName} pool client error:`, err);
        this.emit('clientError', { poolName, error: err });
      });
    });

    pool.on('error', (err) => {
      this.logger.error(`${poolName} pool error:`, err);
      this.emit('poolError', { poolName, error: err });
    });

    pool.on('acquire', () => {
      this.updateConnectionStats();
    });

    pool.on('release', () => {
      this.updateConnectionStats();
    });
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        socket: {
          host: this.config.redis.host,
          port: this.config.redis.port,
          connectTimeout: 10000,
          commandTimeout: 5000
        },
        password: this.config.redis.password,
        database: this.config.redis.db,
        retryStrategy: (times: number) => Math.min(times * 50, 2000)
      });

      this.redisClient.on('error', (err) => {
        this.logger.error('Redis client error:', err);
        this.emit('redisError', err);
      });

      this.redisClient.on('connect', () => {
        this.logger.info('Redis client connected');
        this.emit('redisConnected');
      });

      this.redisClient.on('ready', () => {
        this.logger.info('Redis client ready');
        this.emit('redisReady');
      });

      await this.redisClient.connect();
    } catch (error) {
      this.logger.error('Failed to initialize Redis:', error);
      throw error;
    }
  }

  /**
   * Get connection for write operations (always uses primary)
   */
  public async getWriteConnection(): Promise<PoolClient> {
    try {
      return await this.primaryPool.connect();
    } catch (error) {
      this.logger.error('Failed to get write connection:', error);
      throw error;
    }
  }

  /**
   * Get connection for read operations (uses replicas with intelligent load balancing)
   */
  public async getReadConnection(): Promise<PoolClient> {
    try {
      const healthyReplicas = this.getHealthyReplicas();
      
      if (healthyReplicas.length === 0) {
        this.logger.warn('No healthy replicas available, falling back to primary');
        return await this.primaryPool.connect();
      }

      const selectedIndex = this.selectOptimalReplica(healthyReplicas);
      return await this.replicaPools[selectedIndex].connect();
    } catch (error) {
      this.logger.error('Failed to get read connection:', error);
      // Fallback to primary
      return await this.primaryPool.connect();
    }
  }

  private getHealthyReplicas(): number[] {
    return this.replicaHealthStatus
      .map((healthy, index) => healthy ? index : -1)
      .filter(index => index !== -1);
  }

  private selectOptimalReplica(healthyReplicas: number[]): number {
    // Weighted selection with connection load balancing
    const replicaScores = healthyReplicas.map(index => {
      const stats = this.connectionStats.replicas[index];
      const weight = this.replicaWeights[index];
      const loadRatio = stats.active / Math.max(stats.total, 1);
      
      // Higher score is better (higher weight, lower load)
      return weight * (1 - loadRatio);
    });

    const totalScore = replicaScores.reduce((sum, score) => sum + score, 0);
    let random = Math.random() * totalScore;

    for (let i = 0; i < healthyReplicas.length; i++) {
      random -= replicaScores[i];
      if (random <= 0) {
        return healthyReplicas[i];
      }
    }

    return healthyReplicas[0];
  }

  /**
   * Execute query with intelligent routing and optimization
   */
  public async query<T = any>(
    sql: string,
    params: any[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const startTime = Date.now();
    const isReadQuery = this.isReadOnlyQuery(sql);
    const useReplica = options.preferReplica !== false && isReadQuery;
    
    try {
      // Optimize query if enabled
      if (options.optimize !== false) {
        const optimizedSql = await this.queryOptimizer.optimizeQuery(sql, params);
        sql = optimizedSql;
      }

      // Get appropriate connection
      const client = useReplica ? 
        await this.getReadConnection() : 
        await this.getWriteConnection();

      try {
        // Execute query with timeout
        const result = await this.executeWithTimeout(client, sql, params, options.timeout);
        const executionTime = Date.now() - startTime;

        // Monitor performance
        await this.performanceMonitor.recordQuery({
          sql: sql.substring(0, 100),
          executionTime,
          rowCount: result.rowCount || 0,
          usedReplica: useReplica,
          cacheHit: false
        });

        // Log slow queries
        if (executionTime > 1000) {
          this.logger.warn(`Slow query detected (${executionTime}ms):`, {
            sql: sql.substring(0, 200),
            executionTime,
            rowCount: result.rowCount
          });
        }

        return {
          rows: result.rows,
          rowCount: result.rowCount || 0,
          fields: result.fields,
          executionTime,
          fromCache: false
        };

      } finally {
        client.release();
      }

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Query execution failed:', {
        error: error instanceof Error ? error.message : error,
        sql: sql.substring(0, 200),
        executionTime
      });
      throw error;
    }
  }

  private async executeWithTimeout(
    client: PoolClient,
    sql: string,
    params: any[],
    timeout?: number
  ): Promise<any> {
    if (!timeout) {
      return await client.query(sql, params);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Query timeout after ${timeout}ms`));
      }, timeout);

      client.query(sql, params)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Execute query with caching support
   */
  public async queryWithCache<T = any>(
    sql: string,
    params: any[] = [],
    cacheKey?: string,
    ttlSeconds: number = 3600,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const finalCacheKey = cacheKey || this.generateCacheKey(sql, params);
    
    // Try cache first for read queries
    if (this.isReadOnlyQuery(sql)) {
      try {
        const cached = await this.redisClient.get(finalCacheKey);
        if (cached) {
          const result = JSON.parse(cached);
          
          await this.performanceMonitor.recordQuery({
            sql: sql.substring(0, 100),
            executionTime: 0,
            rowCount: result.rowCount || 0,
            usedReplica: false,
            cacheHit: true
          });

          return {
            ...result,
            fromCache: true
          };
        }
      } catch (cacheError) {
        this.logger.warn('Cache get failed:', cacheError);
      }
    }

    // Execute query
    const result = await this.query<T>(sql, params, { ...options, preferReplica: true });

    // Cache read query results
    if (this.isReadOnlyQuery(sql) && result.rows && result.rows.length > 0) {
      try {
        await this.redisClient.setEx(
          finalCacheKey,
          ttlSeconds,
          JSON.stringify({
            rows: result.rows,
            rowCount: result.rowCount,
            fields: result.fields
          })
        );
      } catch (cacheError) {
        this.logger.warn('Cache set failed:', cacheError);
      }
    }

    return result;
  }

  private generateCacheKey(sql: string, params: any[]): string {
    const crypto = require('crypto');
    const hash = crypto
      .createHash('md5')
      .update(sql + JSON.stringify(params))
      .digest('hex');
    return `query:${hash}`;
  }

  private isReadOnlyQuery(sql: string): boolean {
    const readOnlyPrefixes = ['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'DESCRIBE'];
    const normalizedSql = sql.trim().toUpperCase();
    return readOnlyPrefixes.some(prefix => normalizedSql.startsWith(prefix));
  }

  /**
   * Transaction support with read-write separation
   */
  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
    options: { useReplica?: boolean; timeout?: number } = {}
  ): Promise<T> {
    const client = options.useReplica ? 
      await this.getReadConnection() : 
      await this.getWriteConnection();

    try {
      await client.query('BEGIN');
      
      const result = options.timeout ?
        await this.executeWithTimeout(client, 'BEGIN', [], options.timeout) :
        await callback(client);
        
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cache operations
   */
  public async getCached(key: string): Promise<any> {
    try {
      const cached = await this.redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.error('Cache get error:', error);
      return null;
    }
  }

  public async setCached(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    try {
      await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      this.logger.error('Cache set error:', error);
    }
  }

  public async deleteCached(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
    } catch (error) {
      this.logger.error('Cache delete error:', error);
    }
  }

  public async invalidateCachePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(keys);
        this.logger.info(`Invalidated ${keys.length} cache keys matching pattern: ${pattern}`);
      }
    } catch (error) {
      this.logger.error('Cache pattern invalidation error:', error);
    }
  }

  /**
   * Health checking and monitoring
   */
  private startMonitoring(): void {
    // Health check interval
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 30000); // Every 30 seconds

    // Stats update interval
    this.statsUpdateInterval = setInterval(() => {
      this.updateConnectionStats();
    }, 5000); // Every 5 seconds
  }

  private async performHealthChecks(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      // Check primary health
      await this.primaryPool.query('SELECT 1');
      
      // Check replica health
      for (let i = 0; i < this.replicaPools.length; i++) {
        try {
          await this.replicaPools[i].query('SELECT 1');
          this.replicaHealthStatus[i] = true;
        } catch (error) {
          this.logger.warn(`Replica ${i} health check failed:`, error);
          this.replicaHealthStatus[i] = false;
        }
      }

      // Check Redis health
      await this.redisClient.ping();

    } catch (error) {
      this.logger.error('Primary database health check failed:', error);
      this.emit('primaryHealthCheckFailed', error);
    }
  }

  private updateConnectionStats(): void {
    try {
      // Update primary stats
      this.connectionStats.primary = {
        active: this.primaryPool.totalCount - this.primaryPool.idleCount,
        idle: this.primaryPool.idleCount,
        waiting: this.primaryPool.waitingCount,
        total: this.primaryPool.totalCount
      };

      // Update replica stats
      this.replicaPools.forEach((pool, index) => {
        this.connectionStats.replicas[index] = {
          active: pool.totalCount - pool.idleCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
          total: pool.totalCount
        };
      });

    } catch (error) {
      this.logger.error('Error updating connection stats:', error);
    }
  }

  /**
   * Get current connection statistics
   */
  public getConnectionStats(): ConnectionStats {
    return {
      primary: { ...this.connectionStats.primary },
      replicas: this.connectionStats.replicas.map(stats => ({ ...stats }))
    };
  }

  /**
   * Get health status
   */
  public getHealthStatus() {
    return {
      primary: true, // Assume healthy if we can update stats
      replicas: [...this.replicaHealthStatus],
      redis: this.redisClient?.isReady || false
    };
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
    }

    // Close all pools
    try {
      await this.primaryPool.end();
      
      for (const pool of this.replicaPools) {
        await pool.end();
      }

      // Close Redis connection
      if (this.redisClient) {
        await this.redisClient.quit();
      }

      this.logger.info('Database connections closed gracefully');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      throw error;
    }
  }
}

// Factory function
export function createDatabaseManager(config: DatabaseConfig): DatabaseConnectionManager {
  return new DatabaseConnectionManager(config);
}