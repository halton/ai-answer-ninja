/**
 * AI Answer Ninja - Shared Database Types
 * Type definitions for database operations, caching, and monitoring
 */

import { PoolConfig } from 'pg';

// ===========================================
// Core Database Configuration
// ===========================================

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

// ===========================================
// Query and Result Types
// ===========================================

export interface QueryOptions {
  preferReplica?: boolean;
  timeout?: number;
  optimize?: boolean;
  cacheKey?: string;
  cacheTTL?: number;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  fields?: any[];
  executionTime?: number;
  fromCache?: boolean;
}

export interface QueryPerformanceMetrics {
  sql: string;
  executionTime: number;
  rowCount: number;
  usedReplica: boolean;
  cacheHit: boolean;
  timestamp?: Date;
}

// ===========================================
// Connection Statistics
// ===========================================

export interface ConnectionPoolStats {
  active: number;
  idle: number;
  waiting: number;
  total: number;
}

export interface ConnectionStats {
  primary: ConnectionPoolStats;
  replicas: ConnectionPoolStats[];
}

export interface HealthStatus {
  primary: boolean;
  replicas: boolean[];
  redis: boolean;
}

// ===========================================
// Caching Types
// ===========================================

export interface CacheConfig {
  levels: {
    l1: {
      enabled: boolean;
      maxSize: number;
      ttl: number; // in seconds
    };
    l2: {
      enabled: boolean;
      host: string;
      port: number;
      password?: string;
      db: number;
    };
    l3: {
      enabled: boolean;
      // Database caching configuration
    };
  };
  
  warmup: {
    enabled: boolean;
    patterns: string[];
    priority: number;
  };
  
  invalidation: {
    strategy: 'ttl' | 'manual' | 'smart';
    patterns: string[];
  };
}

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  source: 'memory' | 'redis' | 'database';
}

export interface CacheMetrics {
  hitRate: number;
  missRate: number;
  averageResponseTime: number;
  totalOperations: number;
  memoryUsage?: number;
}

// ===========================================
// Partition Management Types
// ===========================================

export interface PartitionConfig {
  tableName: string;
  partitionColumn: string;
  partitionType: 'range' | 'hash' | 'list';
  partitionStrategy: 'monthly' | 'weekly' | 'daily';
  retentionPeriod: string; // e.g., '6 months'
  autoCreate: boolean;
  autoCleanup: boolean;
}

export interface PartitionInfo {
  tableName: string;
  partitionName: string;
  partitionBounds: string;
  sizeBytes: number;
  rowCount: number;
  lastVacuum?: Date;
  lastAnalyze?: Date;
}

export interface PartitionHealthIssue {
  tableName: string;
  partitionName?: string;
  issueType: 'missing_partition' | 'oversized_partition' | 'maintenance_needed' | 'performance_degraded';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendedAction: string;
}

// ===========================================
// Query Optimization Types
// ===========================================

export interface QueryAnalysis {
  queryHash: string;
  queryType: string;
  estimatedCost: number;
  actualCost?: number;
  indexUsage: IndexUsage[];
  suggestions: OptimizationSuggestion[];
}

export interface IndexUsage {
  indexName: string;
  tableName: string;
  scanType: 'seq_scan' | 'index_scan' | 'bitmap_scan';
  rowsEstimated: number;
  rowsActual?: number;
  efficiency: number; // 0-1 scale
}

export interface OptimizationSuggestion {
  type: 'index' | 'query_rewrite' | 'partition' | 'statistics';
  priority: 'low' | 'medium' | 'high';
  description: string;
  estimatedImprovement: string;
  implementation: string;
}

// ===========================================
// Performance Monitoring Types
// ===========================================

export interface PerformanceSnapshot {
  timestamp: Date;
  connections: ConnectionStats;
  cache: CacheMetrics;
  queries: {
    totalQueries: number;
    slowQueries: number;
    averageExecutionTime: number;
    errorRate: number;
  };
  database: {
    size: number;
    activeConnections: number;
    lockWaits: number;
    checkpointWrites: number;
  };
}

export interface AlertThreshold {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: number;
  severity: 'warning' | 'critical';
  description: string;
}

export interface DatabaseAlert {
  id: string;
  type: string;
  severity: 'warning' | 'critical';
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  acknowledged?: boolean;
  resolvedAt?: Date;
}

// ===========================================
// Analytics and Reporting Types
// ===========================================

export interface DatabaseMetrics {
  performance: {
    queryThroughput: number;
    averageLatency: number;
    errorRate: number;
    cacheHitRate: number;
  };
  
  resources: {
    connectionUtilization: number;
    memoryUsage: number;
    diskUsage: number;
    cpuUsage: number;
  };
  
  operations: {
    reads: number;
    writes: number;
    transactions: number;
    rollbacks: number;
  };
}

export interface TrendData {
  metric: string;
  timeWindow: string;
  dataPoints: Array<{
    timestamp: Date;
    value: number;
  }>;
  trend: 'increasing' | 'decreasing' | 'stable';
  changePercentage: number;
}

// ===========================================
// Migration and Backup Types
// ===========================================

export interface MigrationScript {
  version: string;
  name: string;
  description: string;
  sql: string;
  rollbackSql?: string;
  dependencies?: string[];
  checksum: string;
}

export interface MigrationStatus {
  version: string;
  appliedAt: Date;
  executionTime: number;
  success: boolean;
  errorMessage?: string;
}

export interface BackupConfig {
  strategy: 'full' | 'incremental' | 'differential';
  schedule: string; // cron expression
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  compression: boolean;
  encryption: boolean;
  destination: {
    type: 'local' | 's3' | 'azure' | 'gcp';
    path: string;
    credentials?: Record<string, string>;
  };
}

export interface BackupMetadata {
  id: string;
  type: 'full' | 'incremental' | 'differential';
  startTime: Date;
  endTime: Date;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  checksum: string;
  path: string;
  verified?: boolean;
  verifiedAt?: Date;
}

// ===========================================
// Error Types
// ===========================================

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public query?: string,
    public parameters?: any[],
    public originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ConnectionError extends DatabaseError {
  constructor(message: string, public poolName: string, originalError?: Error) {
    super(message, 'CONNECTION_ERROR', undefined, undefined, originalError);
    this.name = 'ConnectionError';
  }
}

export class QueryTimeoutError extends DatabaseError {
  constructor(message: string, query: string, timeout: number) {
    super(message, 'QUERY_TIMEOUT', query);
    this.name = 'QueryTimeoutError';
  }
}

export class CacheError extends Error {
  constructor(
    message: string,
    public operation: string,
    public key?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'CacheError';
  }
}

// ===========================================
// Utility Types
// ===========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DatabaseLogger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ===========================================
// Service Integration Types
// ===========================================

export interface ServiceDatabaseConfig {
  serviceName: string;
  readPreference: 'primary' | 'replica' | 'auto';
  transactionIsolation: 'read_uncommitted' | 'read_committed' | 'repeatable_read' | 'serializable';
  queryTimeout: number;
  cacheEnabled: boolean;
  cacheTTL: number;
  metricsEnabled: boolean;
}

export interface DatabaseMiddleware {
  name: string;
  priority: number;
  beforeQuery?: (sql: string, params: any[], options: QueryOptions) => Promise<void>;
  afterQuery?: (result: QueryResult, executionTime: number) => Promise<void>;
  onError?: (error: Error, sql: string, params: any[]) => Promise<void>;
}