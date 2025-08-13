/**
 * 智能缓存策略 - 根据访问模式和业务场景优化缓存决策
 */

import { EventEmitter } from 'events';
import { CacheKey, CachingStrategy, PredictionContext } from '../types';
import { Logger } from '../utils/Logger';

/**
 * 缓存策略管理器
 */
export class CachingStrategyManager extends EventEmitter {
  private strategies: Map<string, CachingStrategy> = new Map();
  private activeStrategies: Map<string, CachingStrategy> = new Map();
  private logger: Logger;
  private accessPatterns: Map<string, AccessPattern> = new Map();

  constructor() {
    super();
    this.logger = new Logger('CachingStrategyManager');
    this.initializeDefaultStrategies();
  }

  /**
   * 注册缓存策略
   */
  registerStrategy(strategy: CachingStrategy): void {
    this.strategies.set(strategy.name, strategy);
    this.logger.info(`Registered caching strategy: ${strategy.name}`);
  }

  /**
   * 激活策略
   */
  activateStrategy(name: string, condition?: (key: CacheKey) => boolean): void {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`Strategy ${name} not found`);
    }

    this.activeStrategies.set(name, strategy);
    this.logger.info(`Activated caching strategy: ${name}`);
    this.emit('strategyActivated', { name, strategy });
  }

  /**
   * 停用策略
   */
  deactivateStrategy(name: string): void {
    this.activeStrategies.delete(name);
    this.logger.info(`Deactivated caching strategy: ${name}`);
    this.emit('strategyDeactivated', { name });
  }

  /**
   * 评估是否应该缓存
   */
  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    const keyStr = this.serializeKey(key);
    this.updateAccessPattern(keyStr, context);

    for (const [name, strategy] of this.activeStrategies) {
      try {
        const shouldCache = await strategy.shouldCache(key, data, context);
        if (!shouldCache) {
          this.logger.debug(`Strategy ${name} decided not to cache key: ${keyStr}`);
          return false;
        }
      } catch (error) {
        this.logger.error(`Strategy ${name} evaluation failed:`, error);
      }
    }

    return true;
  }

  /**
   * 获取最优TTL
   */
  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    const keyStr = this.serializeKey(key);
    let optimalTTL = 3600; // 默认1小时

    const ttlScores: number[] = [];
    
    for (const [name, strategy] of this.activeStrategies) {
      try {
        const ttl = await strategy.getTTL(key, context);
        ttlScores.push(ttl);
      } catch (error) {
        this.logger.error(`Strategy ${name} TTL calculation failed:`, error);
      }
    }

    if (ttlScores.length > 0) {
      // 使用加权平均或取最小值（保守策略）
      optimalTTL = Math.min(...ttlScores);
    }

    // 应用访问模式调整
    const pattern = this.accessPatterns.get(keyStr);
    if (pattern) {
      optimalTTL = this.adjustTTLByPattern(optimalTTL, pattern);
    }

    return optimalTTL;
  }

  /**
   * 获取缓存优先级评分
   */
  async evaluatePriority(key: CacheKey, context?: PredictionContext): Promise<number> {
    let totalScore = 0;
    let strategyCount = 0;

    for (const [name, strategy] of this.activeStrategies) {
      try {
        const score = await strategy.evaluate(key, context);
        totalScore += score;
        strategyCount++;
      } catch (error) {
        this.logger.error(`Strategy ${name} priority evaluation failed:`, error);
      }
    }

    return strategyCount > 0 ? totalScore / strategyCount : 0.5;
  }

  private initializeDefaultStrategies(): void {
    // 频率策略
    this.registerStrategy(new FrequencyBasedStrategy());
    
    // LRU策略
    this.registerStrategy(new LRUStrategy());
    
    // 时间策略
    this.registerStrategy(new TimeBasedStrategy());
    
    // 大小策略
    this.registerStrategy(new SizeBasedStrategy());
    
    // 业务策略
    this.registerStrategy(new BusinessContextStrategy());
    
    // 预测策略
    this.registerStrategy(new PredictiveStrategy());

    // 默认激活所有策略
    for (const [name] of this.strategies) {
      this.activateStrategy(name);
    }
  }

  private updateAccessPattern(key: string, context?: PredictionContext): void {
    const now = Date.now();
    
    if (!this.accessPatterns.has(key)) {
      this.accessPatterns.set(key, {
        key,
        accessCount: 0,
        firstAccess: now,
        lastAccess: now,
        accessTimes: [],
        contexts: []
      });
    }

    const pattern = this.accessPatterns.get(key)!;
    pattern.accessCount++;
    pattern.lastAccess = now;
    pattern.accessTimes.push(now);
    
    if (context) {
      pattern.contexts.push(context);
    }

    // 保持最近100次访问记录
    if (pattern.accessTimes.length > 100) {
      pattern.accessTimes = pattern.accessTimes.slice(-100);
    }
    
    if (pattern.contexts.length > 100) {
      pattern.contexts = pattern.contexts.slice(-100);
    }
  }

  private adjustTTLByPattern(baseTTL: number, pattern: AccessPattern): number {
    const now = Date.now();
    const timeSinceLastAccess = now - pattern.lastAccess;
    const accessFrequency = this.calculateAccessFrequency(pattern);

    // 根据访问频率调整TTL
    if (accessFrequency > 10) { // 高频访问
      return baseTTL * 2; // 延长TTL
    } else if (accessFrequency < 1) { // 低频访问
      return baseTTL * 0.5; // 缩短TTL
    }

    return baseTTL;
  }

  private calculateAccessFrequency(pattern: AccessPattern): number {
    if (pattern.accessTimes.length < 2) return 0;

    const timeSpan = pattern.lastAccess - pattern.firstAccess;
    if (timeSpan === 0) return pattern.accessCount;

    return (pattern.accessCount * 3600000) / timeSpan; // 每小时访问次数
  }

  private serializeKey(key: CacheKey): string {
    return `${key.namespace}:${key.key}${key.version ? `:v${key.version}` : ''}`;
  }
}

/**
 * 访问模式记录
 */
interface AccessPattern {
  key: string;
  accessCount: number;
  firstAccess: number;
  lastAccess: number;
  accessTimes: number[];
  contexts: PredictionContext[];
}

/**
 * 基于访问频率的缓存策略
 */
class FrequencyBasedStrategy implements CachingStrategy {
  name = 'frequency-based';
  description = 'Cache items based on access frequency';

  async evaluate(key: CacheKey, context?: PredictionContext): Promise<number> {
    if (!context?.patterns) return 0.5;

    const pattern = context.patterns.find(p => p.key === this.serializeKey(key));
    if (!pattern) return 0.3;

    // 频率越高，优先级越高
    if (pattern.frequency > 10) return 0.9;
    if (pattern.frequency > 5) return 0.7;
    if (pattern.frequency > 1) return 0.6;
    return 0.4;
  }

  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    if (!context?.patterns) return 3600;

    const pattern = context.patterns.find(p => p.key === this.serializeKey(key));
    if (!pattern) return 1800; // 30分钟

    // 高频访问延长TTL
    if (pattern.frequency > 10) return 7200; // 2小时
    if (pattern.frequency > 5) return 5400;  // 1.5小时
    return 3600; // 1小时
  }

  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    // 基于频率决定是否缓存
    const score = await this.evaluate(key, context);
    return score > 0.4;
  }

  private serializeKey(key: CacheKey): string {
    return `${key.namespace}:${key.key}${key.version ? `:v${key.version}` : ''}`;
  }
}

/**
 * LRU策略
 */
class LRUStrategy implements CachingStrategy {
  name = 'lru';
  description = 'Least Recently Used caching strategy';

  async evaluate(key: CacheKey, context?: PredictionContext): Promise<number> {
    if (!context?.patterns) return 0.5;

    const pattern = context.patterns.find(p => p.key === this.serializeKey(key));
    if (!pattern) return 0.5;

    const timeSinceLastAccess = Date.now() - pattern.lastAccessed;
    const hoursSinceAccess = timeSinceLastAccess / (1000 * 60 * 60);

    // 最近访问过的优先级更高
    if (hoursSinceAccess < 1) return 0.9;
    if (hoursSinceAccess < 6) return 0.7;
    if (hoursSinceAccess < 24) return 0.5;
    return 0.2;
  }

  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    if (!context?.patterns) return 3600;

    const pattern = context.patterns.find(p => p.key === this.serializeKey(key));
    if (!pattern) return 1800;

    const timeSinceLastAccess = Date.now() - pattern.lastAccessed;
    const hoursSinceAccess = timeSinceLastAccess / (1000 * 60 * 60);

    // 最近访问的延长TTL
    if (hoursSinceAccess < 1) return 7200;
    if (hoursSinceAccess < 6) return 5400;
    return 3600;
  }

  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    return true; // LRU总是缓存
  }

  private serializeKey(key: CacheKey): string {
    return `${key.namespace}:${key.key}${key.version ? `:v${key.version}` : ''}`;
  }
}

/**
 * 基于时间的缓存策略
 */
class TimeBasedStrategy implements CachingStrategy {
  name = 'time-based';
  description = 'Cache items based on time patterns';

  async evaluate(key: CacheKey, context?: PredictionContext): Promise<number> {
    const hour = new Date().getHours();
    
    // 工作时间(9-18)高优先级
    if (hour >= 9 && hour <= 18) return 0.8;
    
    // 晚上时间适中优先级
    if (hour >= 19 && hour <= 23) return 0.6;
    
    // 深夜和早晨低优先级
    return 0.4;
  }

  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    const hour = new Date().getHours();
    
    // 工作时间缓存时间长一些
    if (hour >= 9 && hour <= 18) return 7200; // 2小时
    
    // 其他时间缓存时间短一些
    return 3600; // 1小时
  }

  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    return true; // 总是缓存，只调整TTL
  }
}

/**
 * 基于数据大小的缓存策略
 */
class SizeBasedStrategy implements CachingStrategy {
  name = 'size-based';
  description = 'Cache items based on data size';

  async evaluate(key: CacheKey, context?: PredictionContext): Promise<number> {
    return 0.5; // 大小策略主要影响是否缓存的决定
  }

  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    return 3600; // 1小时默认
  }

  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    const dataSize = JSON.stringify(data).length;
    
    // 不缓存过大的数据（超过1MB）
    if (dataSize > 1024 * 1024) {
      return false;
    }
    
    // 不缓存过小的数据（小于100字节）
    if (dataSize < 100) {
      return false;
    }
    
    return true;
  }
}

/**
 * 业务上下文策略
 */
class BusinessContextStrategy implements CachingStrategy {
  name = 'business-context';
  description = 'Cache items based on business context and importance';

  async evaluate(key: CacheKey, context?: PredictionContext): Promise<number> {
    // 根据业务重要性评分
    if (key.namespace === 'user-profiles') return 0.9;
    if (key.namespace === 'spam-profiles') return 0.8;
    if (key.namespace === 'whitelist') return 0.8;
    if (key.namespace === 'conversations') return 0.6;
    if (key.namespace === 'system-configs') return 0.9;
    
    return 0.5;
  }

  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    // 根据业务数据特点设置TTL
    switch (key.namespace) {
      case 'user-profiles':
        return 1800; // 30分钟 - 用户资料变化不频繁
      case 'spam-profiles':
        return 7200; // 2小时 - 垃圾号码特征相对稳定
      case 'whitelist':
        return 600; // 10分钟 - 白名单可能经常更新
      case 'conversations':
        return 1800; // 30分钟 - 对话上下文需要及时性
      case 'system-configs':
        return 3600; // 1小时 - 系统配置变化不频繁
      default:
        return 3600;
    }
  }

  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    // 某些敏感数据不缓存
    if (key.namespace === 'sensitive-data') {
      return false;
    }
    
    // 临时数据不缓存
    if (key.key.startsWith('temp-')) {
      return false;
    }
    
    return true;
  }
}

/**
 * 预测式缓存策略
 */
class PredictiveStrategy implements CachingStrategy {
  name = 'predictive';
  description = 'Cache items based on predicted future access patterns';

  async evaluate(key: CacheKey, context?: PredictionContext): Promise<number> {
    if (!context) return 0.5;

    // 根据用户行为模式预测
    const userActivity = this.analyzeUserActivity(context);
    const timePattern = this.analyzeTimePattern(context);
    
    return (userActivity + timePattern) / 2;
  }

  async getTTL(key: CacheKey, context?: PredictionContext): Promise<number> {
    if (!context) return 3600;

    const predictedAccess = await this.predictNextAccess(key, context);
    
    if (predictedAccess < 300) return 7200; // 预计5分钟内访问，缓存2小时
    if (predictedAccess < 1800) return 5400; // 预计30分钟内访问，缓存1.5小时
    if (predictedAccess < 3600) return 3600; // 预计1小时内访问，缓存1小时
    
    return 1800; // 其他情况缓存30分钟
  }

  async shouldCache(key: CacheKey, data: any, context?: PredictionContext): Promise<boolean> {
    if (!context) return true;

    const score = await this.evaluate(key, context);
    return score > 0.4;
  }

  private analyzeUserActivity(context: PredictionContext): number {
    // 分析用户活跃度
    const recentPatterns = context.patterns.filter(p => 
      Date.now() - p.lastAccessed < 3600000 // 最近1小时
    );
    
    if (recentPatterns.length > 10) return 0.9; // 高活跃
    if (recentPatterns.length > 5) return 0.7;  // 中活跃
    if (recentPatterns.length > 0) return 0.5;  // 低活跃
    
    return 0.2; // 无活跃
  }

  private analyzeTimePattern(context: PredictionContext): number {
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    // 工作日工作时间
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && currentHour >= 9 && currentHour <= 18) {
      return 0.8;
    }
    
    // 周末或非工作时间
    return 0.4;
  }

  private async predictNextAccess(key: CacheKey, context: PredictionContext): Promise<number> {
    const keyStr = `${key.namespace}:${key.key}`;
    const pattern = context.patterns.find(p => p.key === keyStr);
    
    if (!pattern || pattern.frequency === 0) {
      return 3600; // 1小时默认预测
    }
    
    // 基于历史频率预测下次访问时间
    const avgInterval = 3600 / pattern.frequency; // 平均访问间隔（秒）
    return avgInterval;
  }
}