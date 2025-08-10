import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '@/config';
import { logger } from '@/utils/logger';

class DatabaseManager {
  private pool: Pool;
  private isConnected = false;

  constructor() {
    this.pool = new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
      min: config.DB_POOL_MIN,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.pool.on('connect', (client) => {
      logger.debug('Database client connected', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount,
      });
    });

    this.pool.on('error', (err, client) => {
      logger.error('Database pool error', { error: err.message, stack: err.stack });
    });

    this.pool.on('acquire', (client) => {
      logger.debug('Database client acquired');
    });

    this.pool.on('release', (client) => {
      logger.debug('Database client released');
    });
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.isConnected = true;
      logger.info('Database connected successfully', {
        host: config.DB_HOST,
        port: config.DB_PORT,
        database: config.DB_NAME,
        poolSize: config.DB_POOL_MAX,
      });
    } catch (error) {
      logger.error('Database connection failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database disconnected successfully');
    } catch (error) {
      logger.error('Database disconnection failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Database query executed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        params: params ? params.length : 0,
        rows: result.rowCount,
        duration: `${duration}ms`,
      });

      // Log slow queries
      if (duration > 1000) {
        logger.warn('Slow query detected', {
          query: text,
          params,
          duration: `${duration}ms`,
          rows: result.rowCount,
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Database query failed', {
        query: text,
        params,
        error: error instanceof Error ? error.message : String(error),
        duration: `${duration}ms`,
      });
      throw error;
    }
  }

  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async queryMany<T = any>(text: string, params?: any[]): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      logger.debug('Database transaction started');
      
      const result = await callback(client);
      
      await client.query('COMMIT');
      logger.debug('Database transaction committed');
      
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.warn('Database transaction rolled back', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    
    try {
      await this.query('SELECT 1 as health_check');
      const latency = Date.now() - start;
      
      return {
        healthy: true,
        latency,
      };
    } catch (error) {
      logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        healthy: false,
        latency: Date.now() - start,
      };
    }
  }

  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      connected: this.isConnected,
    };
  }

  // Utility methods for common queries
  async exists(table: string, conditions: Record<string, any>): Promise<boolean> {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    const whereClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(' AND ');
    
    const query = `SELECT EXISTS(SELECT 1 FROM ${table} WHERE ${whereClause})`;
    const result = await this.queryOne<{ exists: boolean }>(query, values);
    
    return result?.exists ?? false;
  }

  async count(table: string, conditions?: Record<string, any>): Promise<number> {
    let query = `SELECT COUNT(*) as count FROM ${table}`;
    let values: any[] = [];
    
    if (conditions && Object.keys(conditions).length > 0) {
      const keys = Object.keys(conditions);
      values = Object.values(conditions);
      const whereClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(' AND ');
      query += ` WHERE ${whereClause}`;
    }
    
    const result = await this.queryOne<{ count: string }>(query, values);
    return parseInt(result?.count ?? '0', 10);
  }
}

export const db = new DatabaseManager();
export default db;