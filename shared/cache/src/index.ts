/**
 * AI Answer Ninja - Shared Cache System
 * 多级缓存系统主入口文件
 */

// Core classes
export { MultiLevelCache } from './core/MultiLevelCache';

// Redis management
export { RedisClusterManager } from './redis/RedisClusterManager';

// Caching strategies
export { CachingStrategyManager } from './strategies/CachingStrategies';

// Predictive caching
export { PredictiveCachingSystem } from './preload/PredictiveCaching';

// Monitoring
export { CacheMonitor } from './monitoring/CacheMonitor';

// Consistency management
export { ConsistencyManager } from './consistency/ConsistencyManager';

// Types
export * from './types';

// Utilities
export { Logger } from './utils/Logger';

/**
 * 缓存系统工厂类 - 简化初始化过程
 */
import { EventEmitter } from 'events';
import { MultiLevelCache } from './core/MultiLevelCache';
import { RedisClusterManager } from './redis/RedisClusterManager';
import { CachingStrategyManager } from './strategies/CachingStrategies';
import { PredictiveCachingSystem } from './preload/PredictiveCaching';
import { CacheMonitor } from './monitoring/CacheMonitor';
import { ConsistencyManager } from './consistency/ConsistencyManager';
import { CacheConfig, WarmupConfig } from './types';
import { Logger } from './utils/Logger';

export interface CacheSystemConfig extends CacheConfig {
  predictiveCaching?: {
    enabled: boolean;
    warmupConfig: WarmupConfig;
  };
  consistency?: {
    enabled: boolean;
    nodeId?: string;
    policy: any;
    syncBatchSize?: number;
    syncInterval?: number;
    conflictRetryAttempts?: number;
    enableVersioning?: boolean;
    enableEventualConsistency?: boolean;
  };
}

export class CacheSystemFactory extends EventEmitter {
  private logger: Logger;
  private config: CacheSystemConfig;
  
  // Core components
  private cache?: MultiLevelCache;
  private strategyManager?: CachingStrategyManager;
  private predictiveSystem?: PredictiveCachingSystem;
  private monitor?: CacheMonitor;
  private consistencyManager?: ConsistencyManager;
  
  private isInitialized = false;

  constructor(config: CacheSystemConfig) {
    super();
    this.config = config;
    this.logger = new Logger('CacheSystemFactory');
  }

  /**
   * 初始化完整的缓存系统
   */
  async initialize(): Promise<{
    cache: MultiLevelCache;
    strategyManager: CachingStrategyManager;
    predictiveSystem?: PredictiveCachingSystem;
    monitor?: CacheMonitor;
    consistencyManager?: ConsistencyManager;
  }> {
    if (this.isInitialized) {
      throw new Error('Cache system already initialized');
    }

    try {
      this.logger.info('Initializing cache system...');

      // 1. 初始化核心缓存
      this.cache = new MultiLevelCache(this.config);
      await this.cache.initialize();

      // 2. 初始化缓存策略管理器
      this.strategyManager = new CachingStrategyManager();

      // 3. 初始化监控系统
      if (this.config.monitoring.enabled) {
        this.monitor = new CacheMonitor({
          enabled: this.config.monitoring.enabled,
          interval: this.config.monitoring.metricsInterval || 60000,
          thresholds: this.config.monitoring.alertThresholds,
          retention: {
            shortTerm: 3600,
            longTerm: 86400
          }
        });
        await this.monitor.start();
      }

      // 4. 初始化预测式缓存
      if (this.config.predictiveCaching?.enabled) {
        this.predictiveSystem = new PredictiveCachingSystem(
          this.cache,
          this.config.predictiveCaching.warmupConfig
        );
        await this.predictiveSystem.start();
      }

      // 5. 初始化一致性管理器
      if (this.config.consistency?.enabled) {
        const redisManager = (this.cache as any).l2Manager as RedisClusterManager;
        this.consistencyManager = new ConsistencyManager(
          redisManager,
          {
            policy: this.config.consistency.policy,
            syncBatchSize: this.config.consistency.syncBatchSize || 10,
            syncInterval: this.config.consistency.syncInterval || 30000,
            conflictRetryAttempts: this.config.consistency.conflictRetryAttempts || 3,
            enableVersioning: this.config.consistency.enableVersioning || true,
            enableEventualConsistency: this.config.consistency.enableEventualConsistency || true
          },
          this.config.consistency.nodeId
        );
        await this.consistencyManager.start();
      }

      // 6. 设置组件间的事件连接
      this.setupEventConnections();

      this.isInitialized = true;
      this.logger.info('Cache system initialized successfully');

      const result = {
        cache: this.cache,
        strategyManager: this.strategyManager,
        predictiveSystem: this.predictiveSystem,
        monitor: this.monitor,
        consistencyManager: this.consistencyManager
      };

      this.emit('initialized', result);
      return result;

    } catch (error) {
      this.logger.error('Failed to initialize cache system:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * 关闭缓存系统
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    try {
      this.logger.info('Shutting down cache system...');

      // 按相反顺序关闭组件
      if (this.consistencyManager) {
        await this.consistencyManager.stop();
      }

      if (this.predictiveSystem) {
        await this.predictiveSystem.stop();
      }

      if (this.monitor) {
        await this.monitor.stop();
      }

      if (this.cache) {
        await this.cache.close();
      }

      await this.cleanup();

      this.isInitialized = false;
      this.logger.info('Cache system shutdown complete');
      this.emit('shutdown');

    } catch (error) {
      this.logger.error('Error during cache system shutdown:', error);
      throw error;
    }
  }

  /**
   * 获取缓存实例（便捷方法）
   */
  getCache(): MultiLevelCache {
    if (!this.cache) {
      throw new Error('Cache system not initialized');
    }
    return this.cache;
  }

  /**
   * 获取系统状态
   */
  async getSystemStatus(): Promise<{
    initialized: boolean;
    components: {
      cache: boolean;
      strategyManager: boolean;
      predictiveSystem: boolean;
      monitor: boolean;
      consistencyManager: boolean;
    };
    health: any;
    metrics: any;
  }> {
    const components = {
      cache: !!this.cache,
      strategyManager: !!this.strategyManager,
      predictiveSystem: !!this.predictiveSystem,
      monitor: !!this.monitor,
      consistencyManager: !!this.consistencyManager
    };

    let health = null;
    let metrics = null;

    if (this.cache) {
      health = await this.cache.getHealthStatus();
    }

    if (this.monitor) {
      metrics = await this.monitor.getMetrics();
    }

    return {
      initialized: this.isInitialized,
      components,
      health,
      metrics
    };
  }

  // Private methods

  private setupEventConnections(): void {
    if (!this.cache) return;

    // 连接缓存事件到监控系统
    if (this.monitor) {
      this.cache.on('set', (event) => {
        this.monitor!.recordOperation({
          type: 'set',
          key: event.key,
          level: 'L1',
          timestamp: Date.now(),
          success: event.success
        });
      });

      this.cache.on('get', (event) => {
        this.monitor!.recordOperation({
          type: 'get',
          key: event.key,
          level: 'L1',
          timestamp: Date.now(),
          success: event.success
        });
      });
    }

    // 连接缓存事件到预测系统
    if (this.predictiveSystem) {
      this.cache.on('get', (event) => {
        if (event.context) {
          this.predictiveSystem!.recordAccess(event.key, event.context);
        }
      });
    }

    // 连接缓存事件到一致性管理器
    if (this.consistencyManager) {
      this.cache.on('set', (event) => {
        this.consistencyManager!.emit('cacheOperation', {
          type: 'set',
          key: event.key,
          level: 'L1',
          timestamp: Date.now()
        });
      });

      this.cache.on('delete', (event) => {
        this.consistencyManager!.emit('cacheOperation', {
          type: 'delete',
          key: event.key,
          level: 'L1',
          timestamp: Date.now()
        });
      });
    }

    // 转发重要事件
    this.cache.on('error', (error) => this.emit('cacheError', error));
    
    if (this.monitor) {
      this.monitor.on('alert', (alert) => this.emit('alert', alert));
    }

    if (this.predictiveSystem) {
      this.predictiveSystem.on('warmupCompleted', (data) => this.emit('warmupCompleted', data));
    }

    if (this.consistencyManager) {
      this.consistencyManager.on('conflictResolved', (data) => this.emit('conflictResolved', data));
    }
  }

  private async cleanup(): void {
    this.cache = undefined;
    this.strategyManager = undefined;
    this.predictiveSystem = undefined;
    this.monitor = undefined;
    this.consistencyManager = undefined;
    this.removeAllListeners();
  }
}

/**
 * 创建默认配置的缓存系统
 */
export function createDefaultCacheSystem(overrides?: Partial<CacheSystemConfig>): CacheSystemFactory {
  const defaultConfig: CacheSystemConfig = {
    l1: {
      maxSize: 1000,
      ttl: 1800000, // 30分钟
      checkPeriod: 120
    },
    l2: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      ttl: 3600, // 1小时
      maxRetries: 3,
      retryDelayOnFailover: 100
    },
    l3: {
      enabled: false
    },
    compression: {
      enabled: true,
      threshold: 1024, // 1KB
      algorithm: 'gzip'
    },
    monitoring: {
      enabled: true,
      metricsInterval: 60000,
      alertThresholds: {
        hitRatio: 0.7,
        errorRate: 0.05,
        latency: 1000
      }
    },
    predictiveCaching: {
      enabled: true,
      warmupConfig: {
        enabled: true,
        strategies: [
          {
            name: 'user-activity',
            priority: 1,
            schedule: '*/5 * * * *',
            batchSize: 10,
            concurrency: 3
          }
        ],
        triggers: [
          {
            event: 'user-login',
            handler: 'preload-user-data'
          }
        ]
      }
    },
    consistency: {
      enabled: true,
      policy: {
        type: 'eventual',
        conflictResolution: 'last-write-wins'
      },
      syncInterval: 30000,
      syncBatchSize: 10
    },
    ...overrides
  };

  return new CacheSystemFactory(defaultConfig);
}