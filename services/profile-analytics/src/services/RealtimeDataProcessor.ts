import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { CacheManager } from '../utils/CacheManager';
import AdvancedProfileService from './AdvancedProfileService';
import { RealtimeEvent, StreamProcessor, ProcessingMetadata } from '../types';

export interface StreamConfig {
  batchSize: number;
  flushInterval: number;
  maxRetries: number;
  enableCompression: boolean;
  bufferSize: number;
  parallelProcessors: number;
}

export interface DataPoint {
  id: string;
  timestamp: Date;
  type: 'call_event' | 'behavior_update' | 'security_event' | 'performance_metric';
  userId?: string;
  data: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

export interface ProcessingResult {
  processed: boolean;
  latency: number;
  errors: string[];
  enrichedData?: Record<string, any>;
  insights?: string[];
  actions?: string[];
}

export interface StreamMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  averageLatency: number;
  throughput: number;
  bufferUtilization: number;
  errorRate: number;
  lastProcessedAt: Date;
}

export class RealtimeDataProcessor extends EventEmitter {
  private logger: Logger;
  private cache: CacheManager;
  private profileService: AdvancedProfileService;
  private config: StreamConfig;
  private dataBuffer: Map<string, DataPoint[]>;
  private processors: Map<string, StreamProcessor>;
  private metrics: StreamMetrics;
  private isProcessing: boolean;
  private flushTimer: NodeJS.Timeout | null;
  private processingQueue: DataPoint[];
  private workerPool: Promise<void>[];

  constructor(
    profileService: AdvancedProfileService,
    config?: Partial<StreamConfig>
  ) {
    super();
    
    this.logger = new Logger('RealtimeDataProcessor');
    this.cache = new CacheManager();
    this.profileService = profileService;
    
    this.config = {
      batchSize: 100,
      flushInterval: 5000, // 5 seconds
      maxRetries: 3,
      enableCompression: true,
      bufferSize: 10000,
      parallelProcessors: 4,
      ...config
    };

    this.dataBuffer = new Map();
    this.processors = new Map();
    this.processingQueue = [];
    this.workerPool = [];
    this.isProcessing = false;
    this.flushTimer = null;

    this.metrics = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      averageLatency: 0,
      throughput: 0,
      bufferUtilization: 0,
      errorRate: 0,
      lastProcessedAt: new Date()
    };

    this.initializeProcessors();
    this.startProcessing();
  }

  /**
   * 初始化处理器
   */
  private initializeProcessors(): void {
    // 通话事件处理器
    this.registerProcessor('call_event', {
      id: 'call_event_processor',
      name: 'Call Event Processor',
      type: 'behavior',
      status: 'running',
      throughput: 0,
      latency: 0,
      errorRate: 0,
      lastHeartbeat: new Date()
    });

    // 行为更新处理器
    this.registerProcessor('behavior_update', {
      id: 'behavior_update_processor',
      name: 'Behavior Update Processor',
      type: 'behavior',
      status: 'running',
      throughput: 0,
      latency: 0,
      errorRate: 0,
      lastHeartbeat: new Date()
    });

    // 安全事件处理器
    this.registerProcessor('security_event', {
      id: 'security_event_processor',
      name: 'Security Event Processor',
      type: 'security',
      status: 'running',
      throughput: 0,
      latency: 0,
      errorRate: 0,
      lastHeartbeat: new Date()
    });

    // 性能指标处理器
    this.registerProcessor('performance_metric', {
      id: 'performance_metric_processor',
      name: 'Performance Metric Processor',
      type: 'performance',
      status: 'running',
      throughput: 0,
      latency: 0,
      errorRate: 0,
      lastHeartbeat: new Date()
    });
  }

  /**
   * 注册处理器
   */
  registerProcessor(eventType: string, processor: StreamProcessor): void {
    this.processors.set(eventType, processor);
    this.logger.info('Processor registered', { eventType, processorId: processor.id });
  }

  /**
   * 添加数据点到流处理
   */
  async addDataPoint(dataPoint: DataPoint): Promise<void> {
    try {
      // 验证数据点
      this.validateDataPoint(dataPoint);

      // 检查缓冲区容量
      if (this.processingQueue.length >= this.config.bufferSize) {
        this.logger.warn('Buffer full, dropping oldest data point');
        this.processingQueue.shift();
      }

      // 添加到处理队列
      this.processingQueue.push(dataPoint);
      this.metrics.totalEvents++;

      // 根据优先级调整处理顺序
      if (dataPoint.priority === 'critical' || dataPoint.priority === 'high') {
        this.processingQueue.sort((a, b) => this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority));
        
        // 立即处理高优先级事件
        await this.processImmediately(dataPoint);
      }

      // 更新缓冲区利用率
      this.updateBufferUtilization();

      this.emit('dataPointAdded', { dataPoint, queueSize: this.processingQueue.length });
    } catch (error) {
      this.logger.error('Failed to add data point', { error, dataPoint });
      this.metrics.failedEvents++;
      throw error;
    }
  }

  /**
   * 验证数据点
   */
  private validateDataPoint(dataPoint: DataPoint): void {
    if (!dataPoint.id || !dataPoint.timestamp || !dataPoint.type) {
      throw new Error('Invalid data point: missing required fields');
    }

    if (!['call_event', 'behavior_update', 'security_event', 'performance_metric'].includes(dataPoint.type)) {
      throw new Error(`Invalid data point type: ${dataPoint.type}`);
    }

    if (!['low', 'medium', 'high', 'critical'].includes(dataPoint.priority)) {
      throw new Error(`Invalid priority: ${dataPoint.priority}`);
    }
  }

  /**
   * 获取优先级权重
   */
  private getPriorityWeight(priority: string): number {
    const weights = { low: 1, medium: 2, high: 3, critical: 4 };
    return weights[priority as keyof typeof weights] || 1;
  }

  /**
   * 立即处理高优先级数据点
   */
  private async processImmediately(dataPoint: DataPoint): Promise<void> {
    const startTime = Date.now();
    
    try {
      const result = await this.processDataPoint(dataPoint);
      const latency = Date.now() - startTime;
      
      this.updateProcessorMetrics(dataPoint.type, latency, true);
      this.emit('immediateProcessingCompleted', { dataPoint, result, latency });
    } catch (error) {
      this.logger.error('Immediate processing failed', { error, dataPoint });
      this.updateProcessorMetrics(dataPoint.type, Date.now() - startTime, false);
    }
  }

  /**
   * 启动处理循环
   */
  private startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    
    // 启动工作进程池
    for (let i = 0; i < this.config.parallelProcessors; i++) {
      const worker = this.createWorker(i);
      this.workerPool.push(worker);
    }

    // 启动定时刷新
    this.startFlushTimer();

    this.logger.info('Real-time data processing started', { 
      parallelProcessors: this.config.parallelProcessors,
      batchSize: this.config.batchSize 
    });
  }

  /**
   * 创建工作进程
   */
  private async createWorker(workerId: number): Promise<void> {
    this.logger.info('Worker started', { workerId });

    while (this.isProcessing) {
      try {
        const batch = this.getNextBatch();
        
        if (batch.length > 0) {
          await this.processBatch(batch, workerId);
        } else {
          // 没有数据时短暂休眠
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        this.logger.error('Worker error', { error, workerId });
        await new Promise(resolve => setTimeout(resolve, 1000)); // 错误后等待1秒
      }
    }

    this.logger.info('Worker stopped', { workerId });
  }

  /**
   * 获取下一批数据
   */
  private getNextBatch(): DataPoint[] {
    const batchSize = Math.min(this.config.batchSize, this.processingQueue.length);
    return this.processingQueue.splice(0, batchSize);
  }

  /**
   * 处理批次数据
   */
  private async processBatch(batch: DataPoint[], workerId: number): Promise<void> {
    const batchStartTime = Date.now();
    const batchId = `batch_${workerId}_${Date.now()}`;
    
    this.logger.debug('Processing batch', { batchId, size: batch.length, workerId });

    const results = await Promise.allSettled(
      batch.map(dataPoint => this.processDataPoint(dataPoint))
    );

    // 分析批次结果
    let successCount = 0;
    let failureCount = 0;
    let totalLatency = 0;

    results.forEach((result, index) => {
      const dataPoint = batch[index];
      const processingTime = Date.now() - batchStartTime;
      
      if (result.status === 'fulfilled') {
        successCount++;
        this.metrics.processedEvents++;
        this.updateProcessorMetrics(dataPoint.type, processingTime, true);
      } else {
        failureCount++;
        this.metrics.failedEvents++;
        this.updateProcessorMetrics(dataPoint.type, processingTime, false);
        this.logger.error('Data point processing failed', {
          error: result.reason,
          dataPoint
        });
      }
      
      totalLatency += processingTime;
    });

    // 更新指标
    const avgLatency = totalLatency / batch.length;
    this.updateGlobalMetrics(avgLatency, batch.length);

    this.emit('batchProcessed', {
      batchId,
      workerId,
      size: batch.length,
      successCount,
      failureCount,
      avgLatency,
      processingTime: Date.now() - batchStartTime
    });
  }

  /**
   * 处理单个数据点
   */
  private async processDataPoint(dataPoint: DataPoint): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    try {
      let result: ProcessingResult = {
        processed: false,
        latency: 0,
        errors: []
      };

      switch (dataPoint.type) {
        case 'call_event':
          result = await this.processCallEvent(dataPoint);
          break;
        case 'behavior_update':
          result = await this.processBehaviorUpdate(dataPoint);
          break;
        case 'security_event':
          result = await this.processSecurityEvent(dataPoint);
          break;
        case 'performance_metric':
          result = await this.processPerformanceMetric(dataPoint);
          break;
        default:
          throw new Error(`Unknown data point type: ${dataPoint.type}`);
      }

      result.latency = Date.now() - startTime;
      result.processed = true;

      // 缓存处理结果
      await this.cacheProcessingResult(dataPoint.id, result);

      return result;
    } catch (error) {
      const result: ProcessingResult = {
        processed: false,
        latency: Date.now() - startTime,
        errors: [error.message]
      };

      this.logger.error('Data point processing failed', { error, dataPoint });
      return result;
    }
  }

  /**
   * 处理通话事件
   */
  private async processCallEvent(dataPoint: DataPoint): Promise<ProcessingResult> {
    const { userId, data } = dataPoint;
    const insights: string[] = [];
    const actions: string[] = [];

    if (!userId) {
      throw new Error('User ID required for call event processing');
    }

    // 获取用户画像
    const userProfile = await this.profileService.getUserProfile(userId);
    
    // 分析通话模式
    if (data.callType === 'incoming' && data.callerType === 'spam') {
      // 垃圾电话事件
      insights.push('Spam call detected');
      
      // 检查是否需要更新防护策略
      if (userProfile.riskMetrics.spamExposureLevel > 0.7) {
        actions.push('Consider upgrading whitelist strategy');
        insights.push('High spam exposure detected');
      }
    }

    // 更新用户行为指标
    if (data.callOutcome && data.callDuration) {
      await this.updateUserBehaviorMetrics(userId, {
        outcome: data.callOutcome,
        duration: data.callDuration,
        timestamp: dataPoint.timestamp
      });
    }

    // 实时异常检测
    const anomalies = await this.profileService.detectAnomalies(userId);
    if (anomalies.length > 0) {
      insights.push(`${anomalies.length} anomalies detected`);
      actions.push('Review user activity patterns');
    }

    return {
      processed: true,
      latency: 0,
      errors: [],
      enrichedData: {
        userProfile: {
          riskLevel: userProfile.riskMetrics.spamExposureLevel,
          interactionStyle: userProfile.behaviorMetrics.interactionStyle
        }
      },
      insights,
      actions
    };
  }

  /**
   * 处理行为更新事件
   */
  private async processBehaviorUpdate(dataPoint: DataPoint): Promise<ProcessingResult> {
    const { userId, data } = dataPoint;
    const insights: string[] = [];
    const actions: string[] = [];

    if (!userId) {
      throw new Error('User ID required for behavior update processing');
    }

    // 分析行为模式变化
    const patterns = await this.profileService.analyzeUserBehaviorPatterns(userId);
    
    // 检测新模式
    const newPatterns = patterns.filter(p => p.confidence > 0.8);
    if (newPatterns.length > 0) {
      insights.push(`${newPatterns.length} new behavior patterns identified`);
      actions.push('Update user profile with new patterns');
    }

    // 检测模式偏移
    if (data.behaviorChange && data.behaviorChange.significance > 0.5) {
      insights.push('Significant behavior change detected');
      actions.push('Analyze change drivers');
    }

    return {
      processed: true,
      latency: 0,
      errors: [],
      enrichedData: {
        patterns: newPatterns.map(p => ({
          type: p.type,
          confidence: p.confidence,
          description: p.description
        }))
      },
      insights,
      actions
    };
  }

  /**
   * 处理安全事件
   */
  private async processSecurityEvent(dataPoint: DataPoint): Promise<ProcessingResult> {
    const { userId, data } = dataPoint;
    const insights: string[] = [];
    const actions: string[] = [];

    // 安全威胁分析
    const threatLevel = this.assessThreatLevel(data);
    insights.push(`Threat level: ${threatLevel}`);

    if (threatLevel === 'high' || threatLevel === 'critical') {
      actions.push('Immediate security response required');
      
      if (userId) {
        actions.push('Lock user account temporarily');
        actions.push('Notify user of security event');
      }
    }

    // 更新安全指标
    if (userId) {
      await this.updateSecurityMetrics(userId, data);
    }

    return {
      processed: true,
      latency: 0,
      errors: [],
      enrichedData: {
        threatAssessment: {
          level: threatLevel,
          indicators: data.indicators || [],
          confidence: data.confidence || 0.5
        }
      },
      insights,
      actions
    };
  }

  /**
   * 处理性能指标事件
   */
  private async processPerformanceMetric(dataPoint: DataPoint): Promise<ProcessingResult> {
    const { data } = dataPoint;
    const insights: string[] = [];
    const actions: string[] = [];

    // 性能分析
    if (data.latency && data.latency > 1000) {
      insights.push('High latency detected');
      actions.push('Investigate performance bottlenecks');
    }

    if (data.errorRate && data.errorRate > 0.05) {
      insights.push('Elevated error rate detected');
      actions.push('Review system health');
    }

    // 更新系统性能指标
    await this.updateSystemMetrics(data);

    return {
      processed: true,
      latency: 0,
      errors: [],
      enrichedData: {
        systemHealth: {
          latency: data.latency,
          errorRate: data.errorRate,
          throughput: data.throughput
        }
      },
      insights,
      actions
    };
  }

  /**
   * 评估威胁等级
   */
  private assessThreatLevel(securityData: any): string {
    let score = 0;

    if (securityData.failedLoginAttempts > 5) score += 2;
    if (securityData.suspiciousIP) score += 3;
    if (securityData.dataAccessAnomaly) score += 4;
    if (securityData.unauthorizedAccess) score += 5;

    if (score >= 5) return 'critical';
    if (score >= 3) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
  }

  /**
   * 更新用户行为指标
   */
  private async updateUserBehaviorMetrics(userId: string, callData: any): Promise<void> {
    const cacheKey = `behavior_metrics_${userId}`;
    let metrics = await this.cache.get(cacheKey) || {
      totalCalls: 0,
      avgDuration: 0,
      lastCallTime: null,
      callOutcomes: {}
    };

    metrics.totalCalls++;
    metrics.avgDuration = (metrics.avgDuration * (metrics.totalCalls - 1) + callData.duration) / metrics.totalCalls;
    metrics.lastCallTime = callData.timestamp;
    
    if (!metrics.callOutcomes[callData.outcome]) {
      metrics.callOutcomes[callData.outcome] = 0;
    }
    metrics.callOutcomes[callData.outcome]++;

    await this.cache.set(cacheKey, metrics, 3600);
  }

  /**
   * 更新安全指标
   */
  private async updateSecurityMetrics(userId: string, securityData: any): Promise<void> {
    const cacheKey = `security_metrics_${userId}`;
    let metrics = await this.cache.get(cacheKey) || {
      securityEvents: 0,
      lastEventTime: null,
      threatLevel: 'low',
      eventTypes: {}
    };

    metrics.securityEvents++;
    metrics.lastEventTime = new Date();
    
    if (securityData.type) {
      if (!metrics.eventTypes[securityData.type]) {
        metrics.eventTypes[securityData.type] = 0;
      }
      metrics.eventTypes[securityData.type]++;
    }

    await this.cache.set(cacheKey, metrics, 3600);
  }

  /**
   * 更新系统指标
   */
  private async updateSystemMetrics(performanceData: any): Promise<void> {
    const cacheKey = 'system_metrics';
    let metrics = await this.cache.get(cacheKey) || {
      avgLatency: 0,
      avgErrorRate: 0,
      avgThroughput: 0,
      sampleCount: 0
    };

    metrics.sampleCount++;
    
    if (performanceData.latency) {
      metrics.avgLatency = (metrics.avgLatency * (metrics.sampleCount - 1) + performanceData.latency) / metrics.sampleCount;
    }
    
    if (performanceData.errorRate) {
      metrics.avgErrorRate = (metrics.avgErrorRate * (metrics.sampleCount - 1) + performanceData.errorRate) / metrics.sampleCount;
    }
    
    if (performanceData.throughput) {
      metrics.avgThroughput = (metrics.avgThroughput * (metrics.sampleCount - 1) + performanceData.throughput) / metrics.sampleCount;
    }

    await this.cache.set(cacheKey, metrics, 3600);
  }

  /**
   * 缓存处理结果
   */
  private async cacheProcessingResult(dataPointId: string, result: ProcessingResult): Promise<void> {
    const cacheKey = `processing_result_${dataPointId}`;
    await this.cache.set(cacheKey, result, 300); // 缓存5分钟
  }

  /**
   * 更新处理器指标
   */
  private updateProcessorMetrics(eventType: string, latency: number, success: boolean): void {
    const processor = this.processors.get(eventType);
    if (!processor) return;

    processor.latency = (processor.latency + latency) / 2; // 简单移动平均
    processor.throughput++;
    
    if (!success) {
      processor.errorRate = (processor.errorRate + 1) / 2;
    }
    
    processor.lastHeartbeat = new Date();
  }

  /**
   * 更新全局指标
   */
  private updateGlobalMetrics(avgLatency: number, batchSize: number): void {
    this.metrics.averageLatency = (this.metrics.averageLatency + avgLatency) / 2;
    this.metrics.throughput = batchSize / (avgLatency / 1000); // 每秒处理数量
    this.metrics.errorRate = this.metrics.failedEvents / this.metrics.totalEvents;
    this.metrics.lastProcessedAt = new Date();
  }

  /**
   * 更新缓冲区利用率
   */
  private updateBufferUtilization(): void {
    this.metrics.bufferUtilization = this.processingQueue.length / this.config.bufferSize;
  }

  /**
   * 启动定时刷新
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushMetrics();
    }, this.config.flushInterval);
  }

  /**
   * 刷新指标
   */
  private async flushMetrics(): Promise<void> {
    try {
      // 将指标保存到缓存
      await this.cache.set('realtime_processor_metrics', this.metrics, 60);
      
      // 发出指标事件
      this.emit('metricsUpdated', this.metrics);
      
      this.logger.debug('Metrics flushed', this.metrics);
    } catch (error) {
      this.logger.error('Failed to flush metrics', { error });
    }
  }

  /**
   * 获取实时指标
   */
  getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取处理器状态
   */
  getProcessorStatus(): Map<string, StreamProcessor> {
    return new Map(this.processors);
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    queueLength: number;
    bufferUtilization: number;
    oldestItemAge: number;
  } {
    const oldestItem = this.processingQueue[0];
    const oldestItemAge = oldestItem ? Date.now() - oldestItem.timestamp.getTime() : 0;

    return {
      queueLength: this.processingQueue.length,
      bufferUtilization: this.metrics.bufferUtilization,
      oldestItemAge
    };
  }

  /**
   * 暂停处理
   */
  pause(): void {
    this.isProcessing = false;
    this.logger.info('Real-time data processing paused');
  }

  /**
   * 恢复处理
   */
  resume(): void {
    if (!this.isProcessing) {
      this.startProcessing();
      this.logger.info('Real-time data processing resumed');
    }
  }

  /**
   * 停止处理
   */
  async stop(): Promise<void> {
    this.isProcessing = false;
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 等待所有工作进程完成
    await Promise.allSettled(this.workerPool);
    
    // 最后一次刷新指标
    await this.flushMetrics();
    
    this.logger.info('Real-time data processing stopped');
  }
}

export default RealtimeDataProcessor;