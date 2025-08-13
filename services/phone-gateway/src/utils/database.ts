import { Pool, PoolConfig, Client } from 'pg';
import config from '../config';
import { logger } from './logger';

class DatabaseManager {
  private pool: Pool | null = null;
  private isConnected = false;

  constructor() {
    this.initializePool();
  }

  private initializePool(): void {
    const poolConfig: PoolConfig = {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.username,
      password: config.database.password,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      max: config.database.maxConnections,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      allowExitOnIdle: false,
    };

    this.pool = new Pool(poolConfig);

    // Handle pool errors
    this.pool.on('error', (err) => {
      logger.error({ error: err }, 'Database pool error');
    });

    // Handle pool connection
    this.pool.on('connect', (client) => {
      logger.debug('New database client connected');
    });

    // Handle pool removal
    this.pool.on('remove', (client) => {
      logger.debug('Database client removed');
    });
  }

  async connect(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.isConnected = true;
      logger.info('Database connection established');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to database');
      throw error;
    }
  }

  async query(text: string, params?: any[]): Promise<any> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug({
        query: text,
        duration,
        rows: result.rowCount
      }, 'Database query executed');
      
      return result;
    } catch (error) {
      logger.error({
        error,
        query: text,
        params
      }, 'Database query failed');
      throw error;
    }
  }

  async getClient(): Promise<Client> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    return this.pool.connect();
  }

  async transaction<T>(callback: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.pool) return false;
      
      const result = await this.pool.query('SELECT 1');
      return result.rows.length > 0;
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get totalCount(): number {
    return this.pool?.totalCount || 0;
  }

  get idleCount(): number {
    return this.pool?.idleCount || 0;
  }

  get waitingCount(): number {
    return this.pool?.waitingCount || 0;
  }
}

// Export singleton instance
export const dbPool = new DatabaseManager();
export default dbPool;