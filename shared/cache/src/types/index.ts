/**
 * 多级缓存系统类型定义
 */

export interface CacheConfig {
  l1: {
    maxSize: number;
    ttl: number; // milliseconds
    checkPeriod?: number;
  };
  l2: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    cluster?: RedisClusterConfig;
    ttl: number; // seconds
    maxRetries?: number;
    retryDelayOnFailover?: number;
  };
  l3: {
    enabled: boolean;
    connectionString?: string;
    timeout?: number;
  };
  compression: {
    enabled: boolean;
    threshold: number; // bytes
    algorithm: 'gzip' | 'deflate';
  };
  monitoring: {
    enabled: boolean;
    metricsInterval?: number;
    alertThresholds: {
      hitRatio: number;
      errorRate: number;
      latency: number;
    };
  };
}

export interface RedisClusterConfig {
  nodes: Array<{
    host: string;
    port: number;
  }>;
  options?: {
    enableReadyCheck?: boolean;
    redisOptions?: any;
    maxRetriesPerRequest?: number;
  };
}

export interface CacheKey {
  namespace: string;
  key: string;
  version?: string;
}

export interface CacheValue<T = any> {
  data: T;
  metadata: {
    createdAt: number;
    expiresAt: number;
    accessCount: number;
    lastAccessed: number;
    version: string;
    compressed: boolean;
    size: number;
  };
}

export interface CacheMetrics {
  l1: LevelMetrics;
  l2: LevelMetrics;
  l3: LevelMetrics;
  overall: {
    hitRatio: number;
    missRatio: number;
    totalRequests: number;
    errorRate: number;
    avgLatency: number;
  };
  timestamp: number;
}

export interface LevelMetrics {
  hits: number;
  misses: number;
  hitRatio: number;
  avgLatency: number;
  errorCount: number;
  size: number;
  evictions: number;
}

export interface CacheOperation {
  type: 'get' | 'set' | 'delete' | 'clear';
  key: CacheKey;
  level: 'L1' | 'L2' | 'L3';
  timestamp: number;
  latency?: number;
  success: boolean;
  error?: string;
}

export interface PredictionContext {
  userId?: string;
  sessionId?: string;
  userAgent?: string;
  ipAddress?: string;
  timestamp: number;
  patterns: Array<{
    key: string;
    frequency: number;
    lastAccessed: number;
  }>;
}

export interface CachingStrategy {
  name: string;
  description: string;
  evaluate(key: CacheKey, context?: PredictionContext): Promise<number>;
  getTTL(key: CacheKey, context?: PredictionContext): Promise<number>;
  shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean>;
}

export interface ConsistencyPolicy {
  type: 'eventual' | 'strong' | 'weak';
  syncTimeout?: number;
  conflictResolution: 'last-write-wins' | 'timestamp' | 'version';
  replicationFactor?: number;
}

export interface CacheEvent {
  type: 'set' | 'get' | 'delete' | 'evict' | 'expire' | 'error';
  key: CacheKey;
  level: 'L1' | 'L2' | 'L3';
  timestamp: number;
  metadata?: any;
}

export interface WarmupConfig {
  enabled: boolean;
  strategies: Array<{
    name: string;
    priority: number;
    schedule?: string; // cron expression
    batchSize: number;
    concurrency: number;
  }>;
  triggers: Array<{
    event: string;
    handler: string;
    delay?: number;
  }>;
}

export interface CacheHealthStatus {
  healthy: boolean;
  levels: {
    l1: { status: 'healthy' | 'degraded' | 'down'; message?: string };
    l2: { status: 'healthy' | 'degraded' | 'down'; message?: string };
    l3: { status: 'healthy' | 'degraded' | 'down'; message?: string };
  };
  lastCheck: number;
  metrics: CacheMetrics;
}

// 特定业务类型
export interface UserProfileCache extends CacheValue {
  data: {
    id: string;
    phone: string;
    personality: string;
    preferences: Record<string, any>;
  };
}

export interface SpamProfileCache extends CacheValue {
  data: {
    phoneHash: string;
    category: string;
    riskScore: number;
    features: Record<string, any>;
    lastActivity: number;
  };
}

export interface WhitelistCache extends CacheValue {
  data: {
    userId: string;
    contacts: Array<{
      phone: string;
      name?: string;
      type: string;
      confidence: number;
    }>;
  };
}

export interface ConversationCache extends CacheValue {
  data: {
    callId: string;
    history: Array<{
      speaker: string;
      message: string;
      timestamp: number;
      intent?: string;
      sentiment?: number;
    }>;
    context: Record<string, any>;
  };
}

// Error types
export class CacheError extends Error {
  constructor(
    message: string,
    public level: 'L1' | 'L2' | 'L3',
    public operation: string,
    public key?: CacheKey
  ) {
    super(message);
    this.name = 'CacheError';
  }
}

export class CacheTimeoutError extends CacheError {
  constructor(level: 'L1' | 'L2' | 'L3', operation: string, key?: CacheKey) {
    super(`Cache operation timeout at ${level}`, level, operation, key);
    this.name = 'CacheTimeoutError';
  }
}

export class CacheConnectionError extends CacheError {
  constructor(level: 'L1' | 'L2' | 'L3', message: string) {
    super(`Cache connection error at ${level}: ${message}`, level, 'connection');
    this.name = 'CacheConnectionError';
  }
}

// Utility types
export type CacheKeyGenerator<T = any> = (data: T) => CacheKey;
export type CacheValueSerializer<T = any> = {
  serialize: (value: T) => string;
  deserialize: (data: string) => T;
};
export type CacheEventHandler = (event: CacheEvent) => void | Promise<void>;