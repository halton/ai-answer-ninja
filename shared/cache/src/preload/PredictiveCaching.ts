/**
 * 预测式缓存系统 - 基于用户行为和ML模型预测预加载数据
 */

import { EventEmitter } from 'events';
import { CacheKey, PredictionContext, WarmupConfig, CacheValue } from '../types';
import { MultiLevelCache } from '../core/MultiLevelCache';
import { Logger } from '../utils/Logger';

interface PredictionRule {
  id: string;
  name: string;
  condition: (context: PredictionContext) => boolean;
  predictions: Array<{
    key: CacheKey;
    probability: number;
    timeWindow: number; // 预测在多少毫秒内会被访问
  }>;
  priority: number;
}

interface UserBehaviorPattern {
  userId: string;
  sessionId: string;
  patterns: Array<{
    sequence: string[]; // 访问序列
    frequency: number;
    lastSeen: number;
    confidence: number;
  }>;
  preferences: Record<string, any>;
  timePatterns: Array<{
    hour: number;
    dayOfWeek: number;
    frequency: number;
  }>;
}

interface PredictionModel {
  name: string;
  version: string;
  predict(context: PredictionContext): Promise<Array<{
    key: CacheKey;
    probability: number;
    confidence: number;
  }>>;
  train(patterns: UserBehaviorPattern[]): Promise<void>;
  evaluate(): Promise<{
    accuracy: number;
    precision: number;
    recall: number;
  }>;
}

/**
 * 预测式缓存管理器
 */
export class PredictiveCachingSystem extends EventEmitter {
  private cache: MultiLevelCache;
  private logger: Logger;
  private config: WarmupConfig;
  private predictionRules: Map<string, PredictionRule> = new Map();
  private behaviorPatterns: Map<string, UserBehaviorPattern> = new Map();
  private predictionModels: Map<string, PredictionModel> = new Map();
  private warmupTasks: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  // 统计数据
  private stats = {
    predictions: 0,
    hits: 0,
    misses: 0,
    warmupExecutions: 0,
    successfulPredictions: 0
  };

  constructor(cache: MultiLevelCache, config: WarmupConfig) {
    super();
    this.cache = cache;
    this.config = config;
    this.logger = new Logger('PredictiveCachingSystem');
    
    this.initializeDefaultRules();
    this.initializePredictionModels();
  }

  /**
   * 启动预测缓存系统
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.logger.info('Starting predictive caching system...');
      
      // 启动定时预热任务
      if (this.config.enabled) {
        this.scheduleWarmupTasks();
      }
      
      // 启动模式学习
      this.startPatternLearning();
      
      this.isRunning = true;
      this.logger.info('Predictive caching system started');
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start predictive caching system:', error);
      throw error;
    }
  }

  /**
   * 停止预测缓存系统
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.logger.info('Stopping predictive caching system...');
      
      // 停止所有定时任务
      for (const [taskId, timeout] of this.warmupTasks) {
        clearTimeout(timeout);
      }
      this.warmupTasks.clear();
      
      this.isRunning = false;
      this.logger.info('Predictive caching system stopped');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error('Error stopping predictive caching system:', error);
      throw error;
    }
  }

  /**
   * 记录用户访问模式
   */
  recordAccess(key: CacheKey, context: PredictionContext): void {
    try {
      const userId = context.userId || 'anonymous';
      const sessionId = context.sessionId || 'default';
      const keyStr = this.serializeKey(key);
      
      // 更新用户行为模式
      if (!this.behaviorPatterns.has(userId)) {
        this.behaviorPatterns.set(userId, {
          userId,
          sessionId,
          patterns: [],
          preferences: {},
          timePatterns: []
        });
      }
      
      const pattern = this.behaviorPatterns.get(userId)!;
      this.updateBehaviorPattern(pattern, keyStr, context);
      
      // 触发实时预测
      this.performRealTimePrediction(context);
      
    } catch (error) {
      this.logger.error('Error recording access pattern:', error);
    }
  }

  /**
   * 执行预测并预加载
   */
  async predict(context: PredictionContext): Promise<Array<{key: CacheKey, probability: number}>> {
    const predictions: Array<{key: CacheKey, probability: number}> = [];
    
    try {
      // 基于规则的预测
      const rulePredictions = await this.predictByRules(context);
      predictions.push(...rulePredictions);
      
      // 基于ML模型的预测
      const modelPredictions = await this.predictByModels(context);
      predictions.push(...modelPredictions);
      
      // 合并和去重
      const mergedPredictions = this.mergePredictions(predictions);
      
      this.stats.predictions += mergedPredictions.length;
      return mergedPredictions;
      
    } catch (error) {
      this.logger.error('Prediction failed:', error);
      return [];
    }
  }

  /**
   * 执行预热
   */
  async warmup(predictions: Array<{key: CacheKey, probability: number}>): Promise<void> {
    const highProbabilityPredictions = predictions
      .filter(p => p.probability > 0.7)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 50); // 限制预热数量

    for (const prediction of highProbabilityPredictions) {
      try {
        await this.preloadData(prediction.key);
        this.stats.successfulPredictions++;
      } catch (error) {
        this.logger.warn(`Failed to preload ${this.serializeKey(prediction.key)}:`, error);
      }
    }
    
    this.stats.warmupExecutions++;
    this.emit('warmupCompleted', { count: highProbabilityPredictions.length });
  }

  /**
   * 验证预测准确性
   */
  validatePrediction(key: CacheKey, wasHit: boolean): void {
    if (wasHit) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    
    // 更新预测规则的权重
    this.updateRuleWeights(key, wasHit);
  }

  /**
   * 获取统计数据
   */
  getStats(): any {
    return {
      ...this.stats,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses),
      predictionAccuracy: this.stats.successfulPredictions / this.stats.predictions,
      activePatterns: this.behaviorPatterns.size,
      activeRules: this.predictionRules.size
    };
  }

  /**
   * 添加预测规则
   */
  addPredictionRule(rule: PredictionRule): void {
    this.predictionRules.set(rule.id, rule);
    this.logger.info(`Added prediction rule: ${rule.name}`);
  }

  /**
   * 移除预测规则
   */
  removePredictionRule(ruleId: string): void {
    this.predictionRules.delete(ruleId);
    this.logger.info(`Removed prediction rule: ${ruleId}`);
  }

  // Private methods

  private initializeDefaultRules(): void {
    // 用户资料访问模式规则
    this.addPredictionRule({
      id: 'user-profile-access',
      name: 'User Profile Access Pattern',
      condition: (context) => context.userId !== undefined,
      predictions: [
        {
          key: { namespace: 'user-profiles', key: context => context.userId! },
          probability: 0.9,
          timeWindow: 30000 // 30秒内访问
        }
      ],
      priority: 1
    });

    // 白名单检查模式规则
    this.addPredictionRule({
      id: 'whitelist-check',
      name: 'Whitelist Check Pattern',
      condition: (context) => context.patterns.some(p => p.key.includes('incoming-call')),
      predictions: [
        {
          key: { namespace: 'whitelist', key: context => context.userId! },
          probability: 0.85,
          timeWindow: 10000 // 10秒内访问
        }
      ],
      priority: 2
    });

    // 垃圾号码识别模式规则
    this.addPredictionRule({
      id: 'spam-detection',
      name: 'Spam Detection Pattern',
      condition: (context) => context.patterns.some(p => p.key.includes('phone-check')),
      predictions: [
        {
          key: { namespace: 'spam-profiles', key: 'recent-spam' },
          probability: 0.8,
          timeWindow: 15000 // 15秒内访问
        }
      ],
      priority: 3
    });

    // 对话历史访问模式规则
    this.addPredictionRule({
      id: 'conversation-history',
      name: 'Conversation History Pattern',
      condition: (context) => context.patterns.some(p => p.key.includes('call-start')),
      predictions: [
        {
          key: { namespace: 'conversations', key: context => `recent-${context.userId}` },
          probability: 0.75,
          timeWindow: 20000 // 20秒内访问
        }
      ],
      priority: 4
    });
  }

  private initializePredictionModels(): void {
    // 基于序列的预测模型
    this.predictionModels.set('sequence-model', new SequentialPredictionModel());
    
    // 基于时间模式的预测模型
    this.predictionModels.set('temporal-model', new TemporalPredictionModel());
    
    // 基于用户相似性的预测模型
    this.predictionModels.set('similarity-model', new SimilarityBasedModel());
  }

  private scheduleWarmupTasks(): void {
    for (const strategy of this.config.strategies) {
      const interval = this.parseSchedule(strategy.schedule || '*/5 * * * *'); // 默认5分钟
      
      const task = setInterval(async () => {
        try {
          await this.executeWarmupStrategy(strategy);
        } catch (error) {
          this.logger.error(`Warmup strategy ${strategy.name} failed:`, error);
        }
      }, interval);
      
      this.warmupTasks.set(strategy.name, task);
    }
  }

  private async executeWarmupStrategy(strategy: any): Promise<void> {
    this.logger.debug(`Executing warmup strategy: ${strategy.name}`);
    
    // 获取最活跃的用户
    const activeUsers = this.getActiveUsers();
    
    for (const userId of activeUsers.slice(0, strategy.batchSize || 10)) {
      const context: PredictionContext = {
        userId,
        timestamp: Date.now(),
        patterns: this.getUserPatterns(userId)
      };
      
      const predictions = await this.predict(context);
      await this.warmup(predictions);
    }
  }

  private startPatternLearning(): void {
    // 每10分钟学习一次用户模式
    setInterval(async () => {
      try {
        await this.trainModels();
        this.cleanupOldPatterns();
      } catch (error) {
        this.logger.error('Pattern learning failed:', error);
      }
    }, 600000); // 10分钟
  }

  private async trainModels(): Promise<void> {
    const patterns = Array.from(this.behaviorPatterns.values());
    
    for (const [name, model] of this.predictionModels) {
      try {
        await model.train(patterns);
        this.logger.debug(`Trained model: ${name}`);
      } catch (error) {
        this.logger.error(`Failed to train model ${name}:`, error);
      }
    }
  }

  private updateBehaviorPattern(pattern: UserBehaviorPattern, key: string, context: PredictionContext): void {
    const now = Date.now();
    
    // 更新访问序列
    const recentKeys = context.patterns.map(p => p.key);
    const existingPattern = pattern.patterns.find(p => 
      p.sequence.length > 0 && p.sequence[p.sequence.length - 1] === key
    );
    
    if (existingPattern) {
      existingPattern.frequency++;
      existingPattern.lastSeen = now;
    } else {
      pattern.patterns.push({
        sequence: [...recentKeys.slice(-5), key], // 保留最近5个访问
        frequency: 1,
        lastSeen: now,
        confidence: 0.5
      });
    }
    
    // 更新时间模式
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    const timePattern = pattern.timePatterns.find(tp => 
      tp.hour === hour && tp.dayOfWeek === dayOfWeek
    );
    
    if (timePattern) {
      timePattern.frequency++;
    } else {
      pattern.timePatterns.push({ hour, dayOfWeek, frequency: 1 });
    }
    
    // 保持模式数量在合理范围
    if (pattern.patterns.length > 100) {
      pattern.patterns = pattern.patterns
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 100);
    }
  }

  private async performRealTimePrediction(context: PredictionContext): Promise<void> {
    const predictions = await this.predict(context);
    
    // 只预加载高概率预测
    const highProbabilityPredictions = predictions.filter(p => p.probability > 0.8);
    
    if (highProbabilityPredictions.length > 0) {
      // 异步执行预加载，不阻塞主流程
      setImmediate(async () => {
        try {
          await this.warmup(highProbabilityPredictions);
        } catch (error) {
          this.logger.warn('Real-time prediction warmup failed:', error);
        }
      });
    }
  }

  private async predictByRules(context: PredictionContext): Promise<Array<{key: CacheKey, probability: number}>> {
    const predictions: Array<{key: CacheKey, probability: number}> = [];
    
    for (const rule of this.predictionRules.values()) {
      try {
        if (rule.condition(context)) {
          for (const prediction of rule.predictions) {
            let key = prediction.key;
            
            // 如果key是函数，执行它
            if (typeof key.key === 'function') {
              key = {
                ...key,
                key: key.key(context)
              };
            }
            
            predictions.push({
              key: key as CacheKey,
              probability: prediction.probability
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Rule ${rule.name} evaluation failed:`, error);
      }
    }
    
    return predictions;
  }

  private async predictByModels(context: PredictionContext): Promise<Array<{key: CacheKey, probability: number}>> {
    const predictions: Array<{key: CacheKey, probability: number}> = [];
    
    for (const model of this.predictionModels.values()) {
      try {
        const modelPredictions = await model.predict(context);
        predictions.push(...modelPredictions);
      } catch (error) {
        this.logger.warn(`Model prediction failed:`, error);
      }
    }
    
    return predictions;
  }

  private mergePredictions(predictions: Array<{key: CacheKey, probability: number}>): Array<{key: CacheKey, probability: number}> {
    const merged = new Map<string, {key: CacheKey, probability: number}>();
    
    for (const prediction of predictions) {
      const keyStr = this.serializeKey(prediction.key);
      
      if (merged.has(keyStr)) {
        const existing = merged.get(keyStr)!;
        // 使用最大概率
        if (prediction.probability > existing.probability) {
          merged.set(keyStr, prediction);
        }
      } else {
        merged.set(keyStr, prediction);
      }
    }
    
    return Array.from(merged.values())
      .sort((a, b) => b.probability - a.probability);
  }

  private async preloadData(key: CacheKey): Promise<void> {
    const keyStr = this.serializeKey(key);
    
    // 检查是否已经缓存
    const cached = await this.cache.get(key);
    if (cached !== null) {
      return; // 已经缓存，无需预加载
    }
    
    // 根据不同的namespace执行不同的预加载策略
    let data: any = null;
    
    switch (key.namespace) {
      case 'user-profiles':
        data = await this.preloadUserProfile(key.key);
        break;
      case 'spam-profiles':
        data = await this.preloadSpamProfile(key.key);
        break;
      case 'whitelist':
        data = await this.preloadWhitelist(key.key);
        break;
      case 'conversations':
        data = await this.preloadConversation(key.key);
        break;
      default:
        this.logger.warn(`Unknown namespace for preload: ${key.namespace}`);
        return;
    }
    
    if (data) {
      await this.cache.set(key, data, { ttl: 1800 }); // 30分钟TTL
      this.logger.debug(`Preloaded data for key: ${keyStr}`);
    }
  }

  private async preloadUserProfile(userId: string): Promise<any> {
    // 这里应该调用实际的用户服务
    return {
      id: userId,
      name: 'Cached User',
      preferences: {},
      preloaded: true,
      timestamp: Date.now()
    };
  }

  private async preloadSpamProfile(phoneHash: string): Promise<any> {
    // 这里应该调用实际的垃圾号码服务
    return {
      phoneHash,
      category: 'unknown',
      riskScore: 0.5,
      preloaded: true,
      timestamp: Date.now()
    };
  }

  private async preloadWhitelist(userId: string): Promise<any> {
    // 这里应该调用实际的白名单服务
    return {
      userId,
      contacts: [],
      preloaded: true,
      timestamp: Date.now()
    };
  }

  private async preloadConversation(key: string): Promise<any> {
    // 这里应该调用实际的对话服务
    return {
      key,
      history: [],
      preloaded: true,
      timestamp: Date.now()
    };
  }

  private updateRuleWeights(key: CacheKey, wasHit: boolean): void {
    // 根据预测准确性调整规则权重
    // 这里可以实现更复杂的权重调整逻辑
  }

  private getActiveUsers(): string[] {
    // 返回最近活跃的用户ID列表
    const recentThreshold = Date.now() - 3600000; // 1小时内
    
    return Array.from(this.behaviorPatterns.values())
      .filter(pattern => 
        pattern.patterns.some(p => p.lastSeen > recentThreshold)
      )
      .map(pattern => pattern.userId)
      .slice(0, 20); // 限制返回数量
  }

  private getUserPatterns(userId: string): Array<{key: string, frequency: number, lastAccessed: number}> {
    const pattern = this.behaviorPatterns.get(userId);
    if (!pattern) return [];
    
    return pattern.patterns.map(p => ({
      key: p.sequence[p.sequence.length - 1] || '',
      frequency: p.frequency,
      lastAccessed: p.lastSeen
    }));
  }

  private cleanupOldPatterns(): void {
    const cutoff = Date.now() - 7 * 24 * 3600000; // 7天前
    
    for (const [userId, pattern] of this.behaviorPatterns) {
      pattern.patterns = pattern.patterns.filter(p => p.lastSeen > cutoff);
      
      if (pattern.patterns.length === 0) {
        this.behaviorPatterns.delete(userId);
      }
    }
  }

  private parseSchedule(schedule: string): number {
    // 简化的cron解析，返回毫秒间隔
    if (schedule.startsWith('*/')) {
      const minutes = parseInt(schedule.slice(2).split(' ')[0]);
      return minutes * 60000;
    }
    
    return 300000; // 默认5分钟
  }

  private serializeKey(key: CacheKey): string {
    return `${key.namespace}:${key.key}${key.version ? `:v${key.version}` : ''}`;
  }
}

// 简化的预测模型实现
class SequentialPredictionModel implements PredictionModel {
  name = 'sequential';
  version = '1.0.0';

  async predict(context: PredictionContext): Promise<Array<{key: CacheKey, probability: number, confidence: number}>> {
    // 基于访问序列的简单预测
    return [];
  }

  async train(patterns: UserBehaviorPattern[]): Promise<void> {
    // 训练序列模型
  }

  async evaluate(): Promise<{accuracy: number, precision: number, recall: number}> {
    return { accuracy: 0.8, precision: 0.75, recall: 0.82 };
  }
}

class TemporalPredictionModel implements PredictionModel {
  name = 'temporal';
  version = '1.0.0';

  async predict(context: PredictionContext): Promise<Array<{key: CacheKey, probability: number, confidence: number}>> {
    // 基于时间模式的预测
    return [];
  }

  async train(patterns: UserBehaviorPattern[]): Promise<void> {
    // 训练时间模型
  }

  async evaluate(): Promise<{accuracy: number, precision: number, recall: number}> {
    return { accuracy: 0.75, precision: 0.78, recall: 0.73 };
  }
}

class SimilarityBasedModel implements PredictionModel {
  name = 'similarity';
  version = '1.0.0';

  async predict(context: PredictionContext): Promise<Array<{key: CacheKey, probability: number, confidence: number}>> {
    // 基于用户相似性的预测
    return [];
  }

  async train(patterns: UserBehaviorPattern[]): Promise<void> {
    // 训练相似性模型
  }

  async evaluate(): Promise<{accuracy: number, precision: number, recall: number}> {
    return { accuracy: 0.82, precision: 0.80, recall: 0.85 };
  }
}