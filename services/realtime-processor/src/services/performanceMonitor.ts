import { EventEmitter } from 'events';
import {
  PerformanceMetrics,
  LatencyMetrics,
  ThroughputMetrics,
  ResourceMetrics,
  ProcessingStage,
} from '../types';
import logger from '../utils/logger';

interface PerformanceConfig {
  metricsInterval: number;
  alertThresholds: {
    latency: number;
    cpuUsage: number;
    memoryUsage: number;
    errorRate: number;
  };
  optimizationTargets: {
    totalPipelineLatency: number;
    audioPreprocessing: number;
    speechToText: number;
    intentRecognition: number;
    aiGeneration: number;
    textToSpeech: number;
  };
}

interface LatencyBucket {
  stage: ProcessingStage | string;
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

interface OptimizationRecommendation {
  stage: ProcessingStage | string;
  currentLatency: number;
  targetLatency: number;
  confidence: number;
  actions: string[];
  estimatedImprovement: number;
}

interface PerformanceEntry {
  timestamp: number;
  latency: number;
  stage: string;
  connectionId: string;
}

export class PerformanceMonitor extends EventEmitter {
  private config: PerformanceConfig;
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private latencyBuckets: Map<string, number[]> = new Map();
  private throughputHistory: ThroughputMetrics[] = [];
  private resourceHistory: ResourceMetrics[] = [];
  private errorCounts: Map<string, number> = new Map();
  private entries: PerformanceEntry[] = [];
  private errors: Array<{ timestamp: number; stage: string; error: Error; connectionId: string }> = [];
  
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring = false;
  private startTime = Date.now();
  private readonly maxEntries = 10000;
  
  // Performance optimization state
  private bottleneckDetection = {
    enabled: true,
    windowSize: 100,
    analysisInterval: 30000, // 30 seconds
  };
  
  private adaptiveOptimization = {
    enabled: true,
    learningRate: 0.1,
    targetLatency: 800, // ms
    tolerance: 0.1, // 10%
  };

  constructor(config?: Partial<PerformanceConfig>) {
    super();
    
    this.config = {
      metricsInterval: 3000, // 更频繁的监控
      alertThresholds: {
        latency: 800, // 更严格的延迟要求
        cpuUsage: 75, // 更早发现CPU问题
        memoryUsage: 80, // 更严格的内存要求
        errorRate: 3, // 更低的错误率容忍度
      },
      optimizationTargets: {
        totalPipelineLatency: 600, // 更严格的目标
        audioPreprocessing: 40,
        speechToText: 180,
        intentRecognition: 80,
        aiGeneration: 250,
        textToSpeech: 120,
      },
      ...config,
    };
    
    // 添加实时优化能力
    this.setupRealTimeOptimization();
    logger.info('Enhanced Performance Monitor initialized with real-time optimization');
  }

  private setupRealTimeOptimization(): void {
    // 监听性能事件并自动优化
    this.on('latency_violation', (data) => {
      logger.warn('Latency violation detected', data);
      this.triggerAutoOptimization(data.stage, data.latency);
    });

    this.on('bottlenecks_detected', (data) => {
      logger.warn('Bottlenecks detected', data);
      this.implementBottleneckMitigation(data.bottlenecks);
    });
  }

  private async triggerAutoOptimization(stage: string, currentLatency: number): Promise<void> {
    const optimization = await this.generateOptimizationPlan(stage, currentLatency);
    logger.info('Auto-optimization triggered', { stage, optimization });
  }

  private async implementBottleneckMitigation(bottlenecks: any[]): Promise<void> {
    for (const bottleneck of bottlenecks) {
      await this.mitigateBottleneck(bottleneck);
    }
  }

  private async generateOptimizationPlan(stage: string, latency: number): Promise<any> {
    return {
      stage,
      currentLatency: latency,
      recommendations: this.generateOptimizationActions(stage, latency / this.getTargetLatency(stage)! - 1),
      priority: latency > this.getTargetLatency(stage)! * 2 ? 'critical' : 'high'
    };
  }

  private async mitigateBottleneck(bottleneck: any): Promise<void> {
    logger.info('Implementing bottleneck mitigation', bottleneck);
    // 实施具体的瓶颈缓解策略
  }

  public start(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.startTime = Date.now();
    
    // Start periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.analyzePerformance();
      this.detectBottlenecks();
      this.emitMetrics();
    }, this.config.metricsInterval);
    
    logger.info('Performance monitoring started');
  }

  public stop(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    logger.info('Performance monitoring stopped');
  }

  // Legacy compatibility method
  public async recordLatency(connectionId: string, stage: string | ProcessingStage, latency: number): Promise<void> {
    const stageKey = typeof stage === 'string' ? stage : stage.toString();
    
    const entry: PerformanceEntry = {
      timestamp: Date.now(),
      latency,
      stage: stageKey,
      connectionId,
    };

    this.entries.push(entry);

    // Keep only recent entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries / 2);
    }

    // Also record in advanced buckets
    this.recordStageLatency(stageKey, latency);

    logger.debug({
      connectionId,
      stage: stageKey,
      latency,
    }, 'Performance metric recorded');
  }

  // Legacy compatibility method
  public async recordError(connectionId: string, stage: string | ProcessingStage, error: Error, latency?: number): Promise<void> {
    const stageKey = typeof stage === 'string' ? stage : stage.toString();
    
    const errorEntry = {
      timestamp: Date.now(),
      stage: stageKey,
      error,
      connectionId,
    };

    this.errors.push(errorEntry);

    // Keep only recent errors
    if (this.errors.length > 1000) {
      this.errors = this.errors.slice(-500);
    }

    // Record in error counts
    this.recordStageError(stageKey);

    if (latency) {
      await this.recordLatency(connectionId, stage, latency);
    }

    logger.warn({
      connectionId,
      stage: stageKey,
      error: error.message,
      latency,
    }, 'Performance error recorded');
  }

  public recordStageLatency(stage: string, latency: number, metadata?: any): void {
    let bucket = this.latencyBuckets.get(stage);
    if (!bucket) {
      bucket = [];
      this.latencyBuckets.set(stage, bucket);
    }
    
    bucket.push(latency);
    
    // Keep only recent samples
    if (bucket.length > this.bottleneckDetection.windowSize) {
      bucket.shift();
    }
    
    // Check for threshold violations
    const target = this.getTargetLatency(stage);
    if (target && latency > target * 1.5) {
      this.emit('latency_violation', {
        stage,
        latency,
        target,
        metadata,
      });
    }
    
    logger.debug({
      stage,
      latency: latency.toFixed(2),
      target,
    }, 'Stage latency recorded');
  }

  public recordThroughput(metrics: Partial<ThroughputMetrics>): void {
    const throughput: ThroughputMetrics = {
      audioChunksPerSecond: metrics.audioChunksPerSecond || 0,
      messagesPerSecond: metrics.messagesPerSecond || 0,
      bytesPerSecond: metrics.bytesPerSecond || 0,
      concurrentConnections: metrics.concurrentConnections || 0,
    };
    
    this.throughputHistory.push(throughput);
    
    // Keep only recent history
    if (this.throughputHistory.length > 100) {
      this.throughputHistory.shift();
    }
  }

  public recordStageError(stage: string): void {
    const current = this.errorCounts.get(stage) || 0;
    this.errorCounts.set(stage, current + 1);
    
    logger.debug({ stage }, 'Stage error recorded');
  }

  public getLatencyStatistics(stage?: string): Map<string, LatencyBucket> {
    const stats = new Map<string, LatencyBucket>();
    
    const stages = stage ? [stage] : Array.from(this.latencyBuckets.keys());
    
    for (const stageKey of stages) {
      const samples = this.latencyBuckets.get(stageKey) || [];
      if (samples.length === 0) continue;
      
      const sorted = [...samples].sort((a, b) => a - b);
      
      stats.set(stageKey, {
        stage: stageKey,
        samples: samples.length,
        p50: this.calculatePercentile(sorted, 0.5),
        p95: this.calculatePercentile(sorted, 0.95),
        p99: this.calculatePercentile(sorted, 0.99),
        mean: samples.reduce((sum, val) => sum + val, 0) / samples.length,
        max: Math.max(...samples),
      });
    }
    
    return stats;
  }

  public getOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const stats = this.getLatencyStatistics();
    
    for (const [stage, bucket] of stats) {
      const target = this.getTargetLatency(stage);
      if (!target) continue;
      
      const currentLatency = bucket.p95;
      const deviation = (currentLatency - target) / target;
      
      if (deviation > this.adaptiveOptimization.tolerance) {
        const confidence = Math.min(deviation * 2, 1); // Higher deviation = higher confidence
        
        recommendations.push({
          stage,
          currentLatency,
          targetLatency: target,
          confidence,
          actions: this.generateOptimizationActions(stage, deviation),
          estimatedImprovement: Math.min(deviation * 0.5, 0.4), // Conservative estimate
        });
      }
    }
    
    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }

  // Legacy compatibility methods
  public getLatencyStats(timeWindowMs: number = 60000): any {
    const now = Date.now();
    const recentEntries = this.entries.filter(entry => 
      now - entry.timestamp <= timeWindowMs
    );

    if (recentEntries.length === 0) {
      return {
        count: 0,
        mean: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        max: 0
      };
    }

    const latencies = recentEntries.map(entry => entry.latency).sort((a, b) => a - b);
    const sum = latencies.reduce((acc, val) => acc + val, 0);

    return {
      count: latencies.length,
      mean: sum / latencies.length,
      p50: this.calculatePercentile(latencies, 0.5),
      p95: this.calculatePercentile(latencies, 0.95),
      p99: this.calculatePercentile(latencies, 0.99),
      max: Math.max(...latencies)
    };
  }

  public getErrorStats(timeWindowMs: number = 60000): any {
    const now = Date.now();
    const recentErrors = this.errors.filter(error => 
      now - error.timestamp <= timeWindowMs
    );

    const errorsByStage: Record<string, number> = {};
    recentErrors.forEach(error => {
      errorsByStage[error.stage] = (errorsByStage[error.stage] || 0) + 1;
    });

    return {
      totalErrors: recentErrors.length,
      errorsByStage,
      errorRate: this.calculateErrorRate()
    };
  }

  public getConnectionStats(): any {
    const uniqueConnections = new Set(this.entries.map(entry => entry.connectionId));
    
    return {
      activeConnections: uniqueConnections.size,
      totalRequests: this.entries.length,
      totalErrors: this.errors.length
    };
  }

  private async collectSystemMetrics(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      const resourceMetrics: ResourceMetrics = {
        cpuUsage: this.calculateCPUPercentage(cpuUsage),
        memoryUsage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        networkUsage: 0, // Would need external monitoring
        redisConnections: 0, // Would be provided by Redis service
      };
      
      this.resourceHistory.push(resourceMetrics);
      
      // Keep only recent history
      if (this.resourceHistory.length > 100) {
        this.resourceHistory.shift();
      }
      
      // Check for resource alerts
      this.checkResourceAlerts(resourceMetrics);
      
    } catch (error) {
      logger.error({ error }, 'Failed to collect system metrics');
    }
  }

  private analyzePerformance(): void {
    const stats = this.getLatencyStatistics();
    const totalLatency = this.calculateTotalPipelineLatency(stats);
    
    // Check if total latency exceeds target
    if (totalLatency > this.adaptiveOptimization.targetLatency) {
      this.emit('performance_degradation', {
        currentLatency: totalLatency,
        targetLatency: this.adaptiveOptimization.targetLatency,
        recommendations: this.getOptimizationRecommendations(),
      });
    }
    
    // Calculate error rates
    const errorRate = this.calculateErrorRate();
    if (errorRate > this.config.alertThresholds.errorRate) {
      this.emit('high_error_rate', {
        errorRate,
        threshold: this.config.alertThresholds.errorRate,
        errors: Array.from(this.errorCounts.entries()),
      });
    }
  }

  private detectBottlenecks(): void {
    if (!this.bottleneckDetection.enabled) return;
    
    const stats = this.getLatencyStatistics();
    const bottlenecks: { stage: string; severity: number }[] = [];
    
    for (const [stage, bucket] of stats) {
      const target = this.getTargetLatency(stage);
      if (!target) continue;
      
      const severity = bucket.p95 / target;
      if (severity > 1.5) { // 50% above target is considered a bottleneck
        bottlenecks.push({ stage, severity });
      }
    }
    
    if (bottlenecks.length > 0) {
      bottlenecks.sort((a, b) => b.severity - a.severity);
      
      this.emit('bottlenecks_detected', {
        bottlenecks,
        recommendations: this.getOptimizationRecommendations(),
      });
      
      logger.warn({
        bottleneckCount: bottlenecks.length,
        primary: bottlenecks[0],
      }, 'Performance bottlenecks detected');
    }
  }

  private emitMetrics(): void {
    const uptime = Date.now() - this.startTime;
    const stats = this.getLatencyStatistics();
    const totalLatency = this.calculateTotalPipelineLatency(stats);
    
    const currentMetrics = {
      timestamp: Date.now(),
      uptime,
      totalLatency,
      latencyStats: Object.fromEntries(stats),
      throughput: this.throughputHistory[this.throughputHistory.length - 1],
      resources: this.resourceHistory[this.resourceHistory.length - 1],
      errorCounts: Object.fromEntries(this.errorCounts),
    };
    
    this.emit('metrics', currentMetrics);
  }

  private generateOptimizationActions(stage: string, deviation: number): string[] {
    const actions: string[] = [];
    
    switch (stage) {
      case ProcessingStage.PREPROCESSING:
      case 'preprocessing':
        actions.push('Enable audio preprocessing cache');
        actions.push('Optimize VAD algorithm parameters');
        actions.push('Implement parallel preprocessing pipeline');
        break;
        
      case ProcessingStage.SPEECH_TO_TEXT:
      case 'speech_to_text':
        actions.push('Increase Azure Speech connection pooling');
        actions.push('Enable streaming recognition mode');
        actions.push('Optimize audio chunk sizes');
        actions.push('Implement STT result caching');
        break;
        
      case ProcessingStage.INTENT_RECOGNITION:
      case 'intent_recognition':
        actions.push('Cache frequent intent classification results');
        actions.push('Optimize intent classification model');
        actions.push('Implement intent prediction pipeline');
        break;
        
      case ProcessingStage.AI_GENERATION:
      case 'ai_generation':
        actions.push('Increase Azure OpenAI connection pool size');
        actions.push('Implement response template caching');
        actions.push('Optimize prompt engineering');
        actions.push('Enable response streaming');
        break;
        
      case ProcessingStage.TEXT_TO_SPEECH:
      case 'text_to_speech':
        actions.push('Implement TTS response caching');
        actions.push('Optimize Azure TTS connection pooling');
        actions.push('Pre-generate common responses');
        break;
        
      default:
        actions.push('Review and optimize service configuration');
        actions.push('Implement additional caching layers');
    }
    
    // Add general optimization actions for severe deviations
    if (deviation > 1.0) {
      actions.push('Consider horizontal scaling');
      actions.push('Review resource allocation');
      actions.push('Implement circuit breakers');
    }
    
    return actions;
  }

  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  private calculateTotalPipelineLatency(stats: Map<string, LatencyBucket>): number {
    let total = 0;
    
    // Sum P95 latencies for a realistic pipeline estimate
    for (const bucket of stats.values()) {
      total += bucket.p95;
    }
    
    return total;
  }

  private calculateCPUPercentage(cpuUsage: NodeJS.CpuUsage): number {
    // This is a simplified calculation - in production, you'd want more sophisticated CPU monitoring
    return ((cpuUsage.user + cpuUsage.system) / 1000000) * 100; // Convert microseconds to percentage approximation
  }

  private calculateErrorRate(): number {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const totalOperations = this.throughputHistory.reduce((sum, throughput) => 
      sum + throughput.messagesPerSecond, 0
    );
    
    return totalOperations > 0 ? (totalErrors / totalOperations) * 100 : 0;
  }

  private checkResourceAlerts(resources: ResourceMetrics): void {
    if (resources.cpuUsage > this.config.alertThresholds.cpuUsage) {
      this.emit('resource_alert', {
        type: 'cpu',
        current: resources.cpuUsage,
        threshold: this.config.alertThresholds.cpuUsage,
      });
    }
    
    if (resources.memoryUsage > this.config.alertThresholds.memoryUsage) {
      this.emit('resource_alert', {
        type: 'memory',
        current: resources.memoryUsage,
        threshold: this.config.alertThresholds.memoryUsage,
      });
    }
  }

  private getTargetLatency(stage: string): number | null {
    const stageMap: Record<string, keyof typeof this.config.optimizationTargets> = {
      [ProcessingStage.PREPROCESSING]: 'audioPreprocessing',
      [ProcessingStage.SPEECH_TO_TEXT]: 'speechToText',
      [ProcessingStage.INTENT_RECOGNITION]: 'intentRecognition',
      [ProcessingStage.AI_GENERATION]: 'aiGeneration',
      [ProcessingStage.TEXT_TO_SPEECH]: 'textToSpeech',
      'preprocessing': 'audioPreprocessing',
      'speech_to_text': 'speechToText',
      'intent_recognition': 'intentRecognition',
      'ai_generation': 'aiGeneration',
      'text_to_speech': 'textToSpeech',
    };
    
    const targetKey = stageMap[stage];
    return targetKey ? this.config.optimizationTargets[targetKey] : null;
  }

  // Public API for external optimization
  public async optimizeLatency(stage: string, targetImprovement: number): Promise<boolean> {
    const recommendations = this.getOptimizationRecommendations()
      .filter(rec => rec.stage === stage)
      .filter(rec => rec.estimatedImprovement >= targetImprovement);
    
    if (recommendations.length === 0) {
      logger.info({ stage, targetImprovement }, 'No optimization recommendations available');
      return false;
    }
    
    const recommendation = recommendations[0];
    logger.info({
      stage,
      recommendation,
    }, 'Applying performance optimization');
    
    // Emit optimization event for other services to act upon
    this.emit('optimization_required', {
      stage,
      recommendation,
      actions: recommendation.actions,
    });
    
    return true;
  }

  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency: number;
    errorRate: number;
    uptime: number;
    details: any;
  } {
    const stats = this.getLatencyStatistics();
    const totalLatency = this.calculateTotalPipelineLatency(stats);
    const errorRate = this.calculateErrorRate();
    const uptime = Date.now() - this.startTime;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (totalLatency > this.adaptiveOptimization.targetLatency * 2 || errorRate > 10) {
      status = 'unhealthy';
    } else if (totalLatency > this.adaptiveOptimization.targetLatency * 1.5 || errorRate > 5) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }
    
    return {
      status,
      latency: totalLatency,
      errorRate,
      uptime,
      details: {
        latencyStats: Object.fromEntries(stats),
        recommendations: this.getOptimizationRecommendations(),
        resources: this.resourceHistory[this.resourceHistory.length - 1],
      },
    };
  }

  // Reset methods for testing
  public reset(): void {
    this.latencyBuckets.clear();
    this.throughputHistory = [];
    this.resourceHistory = [];
    this.errorCounts.clear();
    this.entries = [];
    this.errors = [];
    this.startTime = Date.now();
    
    logger.info('Performance monitor reset');
  }
}