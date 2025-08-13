/**
 * AI Answer Ninja - Database Connection Pool Configuration
 * Implements read-write separation with intelligent connection pooling
 * Based on CLAUDE.md architecture specifications
 */

import { Pool, PoolConfig } from 'pg';
import { createClient } from 'redis';

export interface DatabaseConfig {
  // Primary database (read-write)
  primary: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: any;
  };
  
  // Read replicas
  replicas: Array<{
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: any;
    weight?: number; // Load balancing weight
  }>;
  
  // Connection pool settings
  poolConfig: {
    primary: PoolConfig;
    replica: PoolConfig;
  };
  
  // Redis configuration for caching
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
}

export class DatabaseConnectionManager {
  private primaryPool: Pool;
  private replicaPools: Pool[] = [];
  private redisClient: any;
  private config: DatabaseConfig;
  private replicaWeights: number[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private connectionStats = {
    primary: { active: 0, idle: 0, waiting: 0 },
    replicas: [] as Array<{ active: number; idle: number; waiting: number }>
  };

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.initializePools();
    this.initializeRedis();
    this.startHealthChecks();
  }

  private initializePools(): void {
    // Initialize primary pool with write optimization
    const primaryConfig: PoolConfig = {
      host: this.config.primary.host,
      port: this.config.primary.port,
      database: this.config.primary.database,
      user: this.config.primary.username,
      password: this.config.primary.password,
      ssl: this.config.primary.ssl,
      
      // Primary pool configuration (optimized for writes)
      min: this.config.poolConfig.primary.min || 2,
      max: this.config.poolConfig.primary.max || 20,
      idleTimeoutMillis: this.config.poolConfig.primary.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.poolConfig.primary.connectionTimeoutMillis || 2000,
      
      // Write optimization settings
      statement_timeout: 30000, // 30 seconds for write operations
      query_timeout: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      
      // Advanced settings for write performance
      application_name: 'ai-ninja-primary',
      options: '--search_path=public'
    };

    this.primaryPool = new Pool(primaryConfig);

    // Initialize replica pools with read optimization
    this.config.replicas.forEach((replica, index) => {
      const replicaConfig: PoolConfig = {
        host: replica.host,
        port: replica.port,
        database: replica.database,
        user: replica.username,
        password: replica.password,
        ssl: replica.ssl,
        
        // Replica pool configuration (optimized for reads)
        min: this.config.poolConfig.replica.min || 1,
        max: this.config.poolConfig.replica.max || 15,
        idleTimeoutMillis: this.config.poolConfig.replica.idleTimeoutMillis || 60000,
        connectionTimeoutMillis: this.config.poolConfig.replica.connectionTimeoutMillis || 1000,
        
        // Read optimization settings
        statement_timeout: 15000, // 15 seconds for read operations
        query_timeout: 15000,
        keepAlive: true,
        
        // Read-only connection settings
        application_name: `ai-ninja-replica-${index}`,
        options: '--search_path=public --default_transaction_read_only=on'
      };

      const replicaPool = new Pool(replicaConfig);
      this.replicaPools.push(replicaPool);
      this.replicaWeights.push(replica.weight || 1);
      this.connectionStats.replicas.push({ active: 0, idle: 0, waiting: 0 });
    });

    // Setup connection event handlers
    this.setupConnectionEventHandlers();
  }

  private setupConnectionEventHandlers(): void {
    // Primary pool events
    this.primaryPool.on('connect', (client) => {
      console.log('Primary database connection established');
      client.on('error', (err) => {
        console.error('Primary database client error:', err);
      });
    });

    this.primaryPool.on('error', (err) => {
      console.error('Primary database pool error:', err);
    });

    // Replica pool events
    this.replicaPools.forEach((pool, index) => {
      pool.on('connect', (client) => {
        console.log(`Replica ${index} database connection established`);
        client.on('error', (err) => {
          console.error(`Replica ${index} database client error:`, err);
        });
      });

      pool.on('error', (err) => {
        console.error(`Replica ${index} database pool error:`, err);
      });
    });
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db,
        
        // Redis connection optimization
        connectTimeout: 10000,
        commandTimeout: 5000,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      await this.redisClient.connect();
      console.log('Redis connection established');

      this.redisClient.on('error', (err: Error) => {
        console.error('Redis connection error:', err);
      });

      this.redisClient.on('ready', () => {
        console.log('Redis client ready');
      });

    } catch (error) {
      console.error('Failed to initialize Redis:', error);
      throw error;
    }
  }

  /**
   * Get connection for write operations (always uses primary)
   */
  public async getWriteConnection() {
    return this.primaryPool.connect();
  }

  /**
   * Get connection for read operations (uses replicas with load balancing)
   */
  public async getReadConnection() {
    if (this.replicaPools.length === 0) {
      // Fallback to primary if no replicas available
      return this.primaryPool.connect();
    }

    // Select replica using weighted round-robin
    const selectedIndex = this.selectReplica();
    return this.replicaPools[selectedIndex].connect();
  }

  /**
   * Intelligent replica selection with health checking
   */
  private selectReplica(): number {
    const healthyReplicas = this.replicaPools
      .map((_, index) => index)
      .filter(index => this.isReplicaHealthy(index));

    if (healthyReplicas.length === 0) {
      // All replicas unhealthy, return first one (will handle error)
      return 0;
    }

    // Weighted selection among healthy replicas
    const totalWeight = healthyReplicas.reduce((sum, index) => sum + this.replicaWeights[index], 0);
    let random = Math.random() * totalWeight;
    
    for (const index of healthyReplicas) {
      random -= this.replicaWeights[index];
      if (random <= 0) {
        return index;
      }
    }
    
    return healthyReplicas[0];
  }

  /**
   * Check if replica is healthy based on connection stats
   */
  private isReplicaHealthy(index: number): boolean {
    const stats = this.connectionStats.replicas[index];
    if (!stats) return false;
    
    // Consider unhealthy if too many waiting connections
    const waitingRatio = stats.waiting / (stats.active + stats.idle + stats.waiting + 1);
    return waitingRatio < 0.5; // Less than 50% waiting
  }

  /**
   * Execute query with automatic read/write routing
   */
  public async query(sql: string, params?: any[], options: { preferReplica?: boolean; timeout?: number } = {}) {
    const isReadQuery = this.isReadOnlyQuery(sql);
    const useReplica = options.preferReplica !== false && isReadQuery;
    
    const pool = useReplica ? await this.getReadConnection() : await this.getWriteConnection();
    
    try {
      const startTime = Date.now();
      const result = await pool.query(sql, params);
      const executionTime = Date.now() - startTime;
      
      // Log slow queries
      if (executionTime > 1000) {
        console.warn(`Slow query detected (${executionTime}ms):`, sql.substring(0, 100));
      }
      
      // Log query performance
      await this.logQueryPerformance(sql, executionTime, useReplica, result.rowCount || 0);
      
      return result;
    } finally {
      pool.release();
    }
  }

  /**
   * Determine if query is read-only
   */
  private isReadOnlyQuery(sql: string): boolean {
    const readOnlyPrefixes = ['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'DESCRIBE'];
    const normalizedSql = sql.trim().toUpperCase();
    
    return readOnlyPrefixes.some(prefix => normalizedSql.startsWith(prefix));
  }

  /**
   * Transaction support with read-write separation
   */
  public async transaction(callback: (client: any) => Promise<any>, useReplica: boolean = false) {
    const pool = useReplica ? await this.getReadConnection() : await this.getWriteConnection();
    
    try {
      await pool.query('BEGIN');
      const result = await callback(pool);
      await pool.query('COMMIT');
      return result;
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    } finally {
      pool.release();
    }
  }

  /**
   * Cache layer methods
   */
  public async getCached(key: string): Promise<any> {
    try {
      const cached = await this.redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  public async setCached(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    try {
      await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  public async deleteCached(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Intelligent query with caching
   */
  public async queryWithCache(
    sql: string, 
    params: any[] = [], 
    cacheKey?: string, 
    ttlSeconds: number = 3600
  ) {
    const finalCacheKey = cacheKey || this.generateCacheKey(sql, params);
    
    // Try cache first for read queries
    if (this.isReadOnlyQuery(sql)) {
      const cached = await this.getCached(finalCacheKey);
      if (cached) {
        await this.logQueryPerformance(sql, 0, false, cached.rowCount || 0, true);
        return cached;
      }
    }
    
    // Execute query
    const result = await this.query(sql, params, { preferReplica: true });
    
    // Cache read query results
    if (this.isReadOnlyQuery(sql) && result.rows.length > 0) {
      await this.setCached(finalCacheKey, result, ttlSeconds);
    }
    
    return result;
  }

  private generateCacheKey(sql: string, params: any[]): string {
    const hash = require('crypto')
      .createHash('md5')
      .update(sql + JSON.stringify(params))
      .digest('hex');
    return `query:${hash}`;
  }

  /**
   * Log query performance for monitoring
   */
  private async logQueryPerformance(
    sql: string, 
    executionTime: number, 
    usedReplica: boolean, 
    rowCount: number,
    cacheHit: boolean = false
  ): Promise<void> {
    try {
      const queryHash = require('crypto')
        .createHash('md5')
        .update(sql)
        .digest('hex');
      
      const queryType = this.extractQueryType(sql);
      
      // Log to database (async, don't block)
      setImmediate(async () => {
        try {
          await this.query(
            `INSERT INTO query_performance_log 
             (query_hash, query_type, execution_time_ms, rows_processed, cache_hit, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [queryHash, queryType, executionTime, rowCount, cacheHit, new Date()],
            { preferReplica: false }
          );
        } catch (logError) {
          console.error('Failed to log query performance:', logError);
        }
      });
    } catch (error) {
      console.error('Error in performance logging:', error);
    }
  }

  private extractQueryType(sql: string): string {
    const match = sql.trim().match(/^(\w+)/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }

  /**
   * Health check and monitoring
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.updateConnectionStats();
      await this.checkConnectionHealth();
    }, 30000); // Every 30 seconds
  }

  private async updateConnectionStats(): Promise<void> {
    try {
      // Update primary stats
      this.connectionStats.primary = {
        active: this.primaryPool.totalCount - this.primaryPool.idleCount,
        idle: this.primaryPool.idleCount,
        waiting: this.primaryPool.waitingCount
      };

      // Update replica stats
      this.replicaPools.forEach((pool, index) => {
        this.connectionStats.replicas[index] = {
          active: pool.totalCount - pool.idleCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount
        };
      });

      // Log stats to database periodically (every 5 minutes)
      if (Date.now() % 300000 < 30000) {
        await this.logConnectionStats();
      }
    } catch (error) {
      console.error('Error updating connection stats:', error);
    }
  }

  private async logConnectionStats(): Promise<void> {
    try {
      // Log primary pool stats
      await this.query(
        `INSERT INTO connection_pool_stats 
         (pool_name, active_connections, idle_connections, waiting_connections, max_connections, pool_efficiency)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          'primary',
          this.connectionStats.primary.active,
          this.connectionStats.primary.idle,
          this.connectionStats.primary.waiting,
          this.config.poolConfig.primary.max,
          this.connectionStats.primary.active / (this.config.poolConfig.primary.max || 20)
        ],
        { preferReplica: false }
      );

      // Log replica pool stats
      for (let i = 0; i < this.replicaPools.length; i++) {
        const stats = this.connectionStats.replicas[i];
        await this.query(
          `INSERT INTO connection_pool_stats 
           (pool_name, active_connections, idle_connections, waiting_connections, max_connections, pool_efficiency)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            `replica-${i}`,
            stats.active,
            stats.idle,
            stats.waiting,
            this.config.poolConfig.replica.max,
            stats.active / (this.config.poolConfig.replica.max || 15)
          ],
          { preferReplica: false }
        );
      }
    } catch (error) {
      console.error('Error logging connection stats:', error);
    }
  }

  private async checkConnectionHealth(): Promise<void> {
    try {
      // Check primary health
      await this.primaryPool.query('SELECT 1');
      
      // Check replica health
      for (let i = 0; i < this.replicaPools.length; i++) {
        try {
          await this.replicaPools[i].query('SELECT 1');
        } catch (error) {
          console.error(`Replica ${i} health check failed:`, error);
        }
      }
    } catch (error) {
      console.error('Primary database health check failed:', error);
    }
  }

  /**
   * Get connection statistics
   */
  public getConnectionStats() {
    return {
      primary: { ...this.connectionStats.primary },
      replicas: [...this.connectionStats.replicas],
      redis: {
        connected: this.redisClient?.status === 'ready'
      }
    };
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close all pools
    await this.primaryPool.end();
    
    for (const pool of this.replicaPools) {
      await pool.end();
    }

    // Close Redis connection
    if (this.redisClient) {
      await this.redisClient.quit();
    }

    console.log('Database connections closed gracefully');
  }
}

// Factory function for creating configured connection manager
export function createDatabaseManager(config: DatabaseConfig): DatabaseConnectionManager {
  return new DatabaseConnectionManager(config);
}

// Default configuration for development
export const defaultDatabaseConfig: DatabaseConfig = {
  primary: {
    host: process.env.DB_PRIMARY_HOST || 'localhost',
    port: parseInt(process.env.DB_PRIMARY_PORT || '5432'),
    database: process.env.DB_NAME || 'ai_ninja',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password'
  },
  
  replicas: [
    {
      host: process.env.DB_REPLICA1_HOST || 'localhost',
      port: parseInt(process.env.DB_REPLICA1_PORT || '5433'),
      database: process.env.DB_NAME || 'ai_ninja',
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      weight: 1
    }
  ],
  
  poolConfig: {
    primary: {
      min: 2,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    },
    replica: {
      min: 1,
      max: 15,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 1000
    }
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0')
  }
};