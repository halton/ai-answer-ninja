/**
 * 多级缓存管理器 - L1(内存) + L2(Redis) + L3(数据库)架构
 */

import NodeCache from 'node-cache';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import {
  CacheConfig,
  CacheKey,
  CacheValue,
  CacheMetrics,
  CacheOperation,
  CacheEvent,
  CacheError,
  CacheTimeoutError,
  LevelMetrics,
  CacheHealthStatus,
  CacheEventHandler
} from '../types';
import { RedisClusterManager } from '../redis/RedisClusterManager';
import { CacheMonitor } from '../monitoring/CacheMonitor';
import { Logger } from '../utils/Logger';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class MultiLevelCache extends EventEmitter {
  private l1Cache: NodeCache;
  private l2Manager: RedisClusterManager;
  private monitor: CacheMonitor;
  private logger: Logger;
  private config: CacheConfig;
  private isInitialized = false;
  private operationQueue: Map<string, Promise<any>> = new Map();

  constructor(config: CacheConfig) {
    super();
    this.config = config;
    this.logger = new Logger('MultiLevelCache');
    this.initializeL1Cache();
    this.initializeL2Manager();
    this.initializeMonitoring();
    this.setupEventHandlers();
  }

  /**
   * 初始化缓存系统
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing multi-level cache system...');
      
      // 初始化L2 Redis连接
      await this.l2Manager.connect();
      
      // 启动监控
      if (this.config.monitoring.enabled) {
        await this.monitor.start();
      }
      
      this.isInitialized = true;
      this.logger.info('Multi-level cache system initialized successfully');
      
      this.emit('initialized');
    } catch (error) {
      this.logger.error('Failed to initialize cache system:', error);
      throw new CacheError('Initialization failed', 'L1', 'init');
    }
  }

  /**
   * 获取缓存值 - 实现缓存穿透保护
   */
  async get<T>(key: CacheKey, fallback?: () => Promise<T>): Promise<T | null> {
    const startTime = performance.now();
    const keyStr = this.serializeKey(key);
    
    try {
      // 检查是否有相同的操作正在进行（缓存击穿保护）
      if (this.operationQueue.has(keyStr)) {
        this.logger.debug(`Waiting for ongoing operation for key: ${keyStr}`);
        return await this.operationQueue.get(keyStr);
      }

      const operation = this.performGet<T>(key, fallback);
      this.operationQueue.set(keyStr, operation);
      
      const result = await operation;
      this.operationQueue.delete(keyStr);
      
      // 记录操作指标
      const latency = performance.now() - startTime;
      this.recordOperation({
        type: 'get',
        key,
        level: result ? (await this.determineResultLevel(key)) : 'L3',
        timestamp: Date.now(),
        latency,
        success: true
      });
      
      return result;
    } catch (error) {
      this.operationQueue.delete(keyStr);
      this.recordError('get', key, error);
      throw error;
    }
  }

  /**
   * 设置缓存值
   */
  async set<T>(
    key: CacheKey, 
    value: T, 
    options?: { 
      ttl?: number; 
      l1Only?: boolean; 
      l2Only?: boolean;
      skipCompression?: boolean;
    }
  ): Promise<boolean> {
    const startTime = performance.now();
    
    try {
      const cacheValue = await this.createCacheValue(value, options);
      const serialized = JSON.stringify(cacheValue);
      
      // 压缩大数据
      let finalData = serialized;
      if (!options?.skipCompression && this.shouldCompress(serialized)) {
        finalData = (await gzipAsync(Buffer.from(serialized))).toString('base64');
        cacheValue.metadata.compressed = true;
      }

      const keyStr = this.serializeKey(key);
      let success = true;

      // L1缓存设置
      if (!options?.l2Only) {
        const l1TTL = options?.ttl ? Math.floor(options.ttl / 1000) : this.config.l1.ttl;
        this.l1Cache.set(keyStr, finalData, l1TTL);
        this.logger.debug(`Set L1 cache for key: ${keyStr}`);
      }

      // L2缓存设置
      if (!options?.l1Only) {
        const l2TTL = options?.ttl || this.config.l2.ttl;
        const setResult = await this.l2Manager.set(keyStr, finalData, l2TTL);
        success = success && setResult;
        this.logger.debug(`Set L2 cache for key: ${keyStr}, success: ${setResult}`);
      }

      // 记录操作指标
      const latency = performance.now() - startTime;
      this.recordOperation({
        type: 'set',
        key,
        level: options?.l1Only ? 'L1' : (options?.l2Only ? 'L2' : 'L1'),
        timestamp: Date.now(),
        latency,
        success
      });

      this.emit('set', { key, value: cacheValue, success });
      return success;
      
    } catch (error) {
      this.recordError('set', key, error);
      throw error;
    }
  }

  /**
   * 删除缓存
   */
  async delete(key: CacheKey): Promise<boolean> {
    const keyStr = this.serializeKey(key);
    let success = true;
    
    try {
      // L1删除
      this.l1Cache.del(keyStr);
      
      // L2删除
      const l2Result = await this.l2Manager.delete(keyStr);
      success = success && l2Result;
      
      this.recordOperation({
        type: 'delete',
        key,
        level: 'L1',
        timestamp: Date.now(),
        success
      });
      
      this.emit('delete', { key, success });
      return success;
      
    } catch (error) {
      this.recordError('delete', key, error);
      throw error;
    }
  }

  /**
   * 批量获取
   */
  async mget<T>(keys: CacheKey[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();
    const keyStrs = keys.map(k => this.serializeKey(k));
    
    try {
      // L1批量获取
      const l1Results = new Map<string, string>();
      keyStrs.forEach(keyStr => {
        const value = this.l1Cache.get<string>(keyStr);
        if (value) {
          l1Results.set(keyStr, value);
        }
      });

      // 找出L1未命中的keys
      const l1Misses = keyStrs.filter(k => !l1Results.has(k));
      
      // L2批量获取
      let l2Results = new Map<string, string>();
      if (l1Misses.length > 0) {
        l2Results = await this.l2Manager.mget(l1Misses);
      }

      // 处理结果
      for (let i = 0; i < keys.length; i++) {
        const keyStr = keyStrs[i];
        let rawValue = l1Results.get(keyStr) || l2Results.get(keyStr);
        
        if (rawValue) {
          try {
            const value = await this.deserializeCacheValue<T>(rawValue);
            results.set(keyStr, value);
            
            // L1回填
            if (!l1Results.has(keyStr) && l2Results.has(keyStr)) {
              this.l1Cache.set(keyStr, rawValue, this.config.l1.ttl);
            }
          } catch (error) {
            this.logger.warn(`Failed to deserialize value for key ${keyStr}:`, error);
            results.set(keyStr, null);
          }
        } else {
          results.set(keyStr, null);
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Batch get operation failed:', error);
      throw new CacheError('Batch get failed', 'L1', 'mget');
    }
  }

  /**
   * 批量设置
   */
  async mset<T>(entries: Array<{key: CacheKey, value: T, ttl?: number}>): Promise<boolean> {
    try {
      const l1Operations: Array<{key: string, value: string, ttl: number}> = [];
      const l2Operations: Array<{key: string, value: string, ttl: number}> = [];
      
      for (const entry of entries) {
        const cacheValue = await this.createCacheValue(entry.value, { ttl: entry.ttl });
        const serialized = JSON.stringify(cacheValue);
        
        let finalData = serialized;
        if (this.shouldCompress(serialized)) {
          finalData = (await gzipAsync(Buffer.from(serialized))).toString('base64');
          cacheValue.metadata.compressed = true;
        }
        
        const keyStr = this.serializeKey(entry.key);
        const ttl = entry.ttl || this.config.l1.ttl;
        
        l1Operations.push({ key: keyStr, value: finalData, ttl });
        l2Operations.push({ key: keyStr, value: finalData, ttl: entry.ttl || this.config.l2.ttl });
      }

      // L1批量设置
      l1Operations.forEach(op => {
        this.l1Cache.set(op.key, op.value, Math.floor(op.ttl / 1000));
      });

      // L2批量设置
      const l2Success = await this.l2Manager.mset(l2Operations);
      
      return l2Success;
    } catch (error) {
      this.logger.error('Batch set operation failed:', error);
      throw new CacheError('Batch set failed', 'L1', 'mset');
    }
  }

  /**
   * 清除指定模式的缓存
   */
  async clear(pattern?: string): Promise<number> {
    let clearedCount = 0;
    
    try {
      if (pattern) {
        // 模式匹配清除
        const l1Keys = this.l1Cache.keys().filter(key => 
          key.includes(pattern) || new RegExp(pattern).test(key)
        );
        
        l1Keys.forEach(key => {
          this.l1Cache.del(key);
          clearedCount++;
        });
        
        const l2Count = await this.l2Manager.deletePattern(pattern);
        clearedCount += l2Count;
      } else {
        // 全部清除
        this.l1Cache.flushAll();
        const l2Count = await this.l2Manager.flushAll();
        clearedCount = this.l1Cache.getStats().keys + l2Count;
      }
      
      this.emit('clear', { pattern, count: clearedCount });
      return clearedCount;
    } catch (error) {
      this.logger.error('Clear operation failed:', error);
      throw new CacheError('Clear failed', 'L1', 'clear');
    }
  }

  /**
   * 获取缓存健康状态
   */
  async getHealthStatus(): Promise<CacheHealthStatus> {
    try {
      const l1Stats = this.l1Cache.getStats();
      const l2Health = await this.l2Manager.healthCheck();
      const metrics = await this.getMetrics();
      
      return {
        healthy: l2Health.healthy,
        levels: {
          l1: {
            status: 'healthy',
            message: `Keys: ${l1Stats.keys}, Hits: ${l1Stats.hits}, Misses: ${l1Stats.misses}`
          },
          l2: {
            status: l2Health.healthy ? 'healthy' : 'down',
            message: l2Health.message
          },
          l3: {
            status: this.config.l3.enabled ? 'healthy' : 'disabled'
          }
        },
        lastCheck: Date.now(),
        metrics
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        healthy: false,
        levels: {
          l1: { status: 'down', message: 'Health check failed' },
          l2: { status: 'down', message: 'Health check failed' },
          l3: { status: 'down', message: 'Health check failed' }
        },
        lastCheck: Date.now(),
        metrics: await this.getMetrics()
      };
    }
  }

  /**
   * 获取缓存指标
   */
  async getMetrics(): Promise<CacheMetrics> {
    return this.monitor.getMetrics();
  }

  /**
   * 关闭缓存系统
   */
  async close(): Promise<void> {
    try {
      this.logger.info('Shutting down cache system...');
      
      if (this.monitor) {
        await this.monitor.stop();
      }
      
      await this.l2Manager.disconnect();
      
      this.l1Cache.close();
      this.removeAllListeners();
      
      this.logger.info('Cache system shutdown complete');
    } catch (error) {
      this.logger.error('Error during cache shutdown:', error);
      throw error;
    }
  }

  // Private methods

  private initializeL1Cache(): void {
    this.l1Cache = new NodeCache({
      stdTTL: this.config.l1.ttl,
      checkperiod: this.config.l1.checkPeriod || 120,
      maxKeys: this.config.l1.maxSize,
      useClones: false,
      deleteOnExpire: true
    });

    // L1事件处理
    this.l1Cache.on('set', (key, value) => {
      this.emit('l1:set', { key, value });
    });

    this.l1Cache.on('del', (key, value) => {
      this.emit('l1:delete', { key, value });
    });

    this.l1Cache.on('expired', (key, value) => {
      this.emit('l1:expire', { key, value });
    });
  }

  private initializeL2Manager(): void {
    this.l2Manager = new RedisClusterManager(this.config.l2);
    
    // L2事件转发
    this.l2Manager.on('connected', () => this.emit('l2:connected'));
    this.l2Manager.on('disconnected', () => this.emit('l2:disconnected'));
    this.l2Manager.on('error', (error) => this.emit('l2:error', error));
  }

  private initializeMonitoring(): void {
    this.monitor = new CacheMonitor({
      enabled: this.config.monitoring.enabled,
      interval: this.config.monitoring.metricsInterval || 60000,
      thresholds: this.config.monitoring.alertThresholds
    });

    this.monitor.on('alert', (alert) => this.emit('alert', alert));
  }

  private setupEventHandlers(): void {
    // 处理各种缓存事件
    this.on('l1:set', (data) => this.monitor.recordL1Operation('set', true));
    this.on('l1:delete', (data) => this.monitor.recordL1Operation('delete', true));
    this.on('l1:expire', (data) => this.monitor.recordL1Operation('expire', true));
    
    // 错误处理
    this.on('error', (error) => {
      this.logger.error('Cache error:', error);
      this.monitor.recordError(error);
    });
  }

  private async performGet<T>(key: CacheKey, fallback?: () => Promise<T>): Promise<T | null> {
    const keyStr = this.serializeKey(key);
    
    // L1查找
    let rawValue = this.l1Cache.get<string>(keyStr);
    if (rawValue) {
      this.monitor.recordL1Hit();
      this.logger.debug(`L1 cache hit for key: ${keyStr}`);
      return await this.deserializeCacheValue<T>(rawValue);
    }
    
    this.monitor.recordL1Miss();
    
    // L2查找
    rawValue = await this.l2Manager.get(keyStr);
    if (rawValue) {
      this.monitor.recordL2Hit();
      this.logger.debug(`L2 cache hit for key: ${keyStr}`);
      
      // L1回填
      this.l1Cache.set(keyStr, rawValue, this.config.l1.ttl);
      return await this.deserializeCacheValue<T>(rawValue);
    }
    
    this.monitor.recordL2Miss();
    
    // L3查找（数据库回调）
    if (fallback) {
      try {
        const value = await fallback();
        if (value !== null) {
          // 异步回填缓存
          this.set(key, value).catch(error => {
            this.logger.warn(`Failed to backfill cache for key ${keyStr}:`, error);
          });
        }
        return value;
      } catch (error) {
        this.logger.error(`Fallback failed for key ${keyStr}:`, error);
        throw error;
      }
    }
    
    return null;
  }

  private async createCacheValue<T>(value: T, options?: { ttl?: number }): Promise<CacheValue<T>> {
    const now = Date.now();
    const ttl = options?.ttl || this.config.l2.ttl * 1000;
    
    return {
      data: value,
      metadata: {
        createdAt: now,
        expiresAt: now + ttl,
        accessCount: 0,
        lastAccessed: now,
        version: '1.0.0',
        compressed: false,
        size: JSON.stringify(value).length
      }
    };
  }

  private async deserializeCacheValue<T>(rawValue: string): Promise<T> {
    try {
      // 检查是否压缩
      let jsonStr = rawValue;
      if (rawValue.startsWith('{') === false) {
        // 可能是压缩数据
        try {
          const buffer = Buffer.from(rawValue, 'base64');
          jsonStr = (await gunzipAsync(buffer)).toString();
        } catch {
          // 不是压缩数据，直接使用原值
          jsonStr = rawValue;
        }
      }
      
      const cacheValue: CacheValue<T> = JSON.parse(jsonStr);
      
      // 更新访问信息
      cacheValue.metadata.accessCount++;
      cacheValue.metadata.lastAccessed = Date.now();
      
      return cacheValue.data;
    } catch (error) {
      this.logger.error('Failed to deserialize cache value:', error);
      throw new CacheError('Deserialization failed', 'L1', 'deserialize');
    }
  }

  private shouldCompress(data: string): boolean {
    return this.config.compression.enabled && 
           data.length > this.config.compression.threshold;
  }

  private serializeKey(key: CacheKey): string {
    return `${key.namespace}:${key.key}${key.version ? `:v${key.version}` : ''}`;
  }

  private async determineResultLevel(key: CacheKey): Promise<'L1' | 'L2' | 'L3'> {
    const keyStr = this.serializeKey(key);
    
    if (this.l1Cache.has(keyStr)) return 'L1';
    if (await this.l2Manager.exists(keyStr)) return 'L2';
    return 'L3';
  }

  private recordOperation(operation: CacheOperation): void {
    this.monitor.recordOperation(operation);
  }

  private recordError(operation: string, key: CacheKey, error: any): void {
    const latency = 0; // Error occurred, no meaningful latency
    this.recordOperation({
      type: operation as any,
      key,
      level: 'L1', // Default level for errors
      timestamp: Date.now(),
      latency,
      success: false,
      error: error.message
    });
  }
}