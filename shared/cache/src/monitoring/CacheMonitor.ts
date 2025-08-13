/**
 * 缓存性能监控和分析系统
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { register, Histogram, Counter, Gauge } from 'prom-client';
import { 
  CacheMetrics, 
  CacheOperation, 
  LevelMetrics, 
  CacheEvent,
  CacheHealthStatus 
} from '../types';
import { Logger } from '../utils/Logger';

interface MonitoringConfig {
  enabled: boolean;
  interval: number;
  thresholds: {
    hitRatio: number;
    errorRate: number;
    latency: number;
  };
  retention: {
    shortTerm: number; // 短期指标保留时间(秒)
    longTerm: number;  // 长期指标保留时间(秒)
  };
}

interface Alert {
  id: string;
  type: 'performance' | 'error' | 'capacity' | 'availability';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  metadata: any;
  resolved: boolean;
  resolvedAt?: number;
}

interface PerformanceBaseline {
  hitRatio: { min: number; avg: number; max: number };
  latency: { p50: number; p95: number; p99: number };
  errorRate: number;
  throughput: number;
  lastUpdated: number;
}

/**
 * 缓存监控系统
 */
export class CacheMonitor extends EventEmitter {
  private config: MonitoringConfig;
  private logger: Logger;
  private isRunning = false;
  private metricsInterval?: NodeJS.Timeout;
  
  // 实时指标
  private l1Metrics: LevelMetrics = this.createEmptyLevelMetrics();
  private l2Metrics: LevelMetrics = this.createEmptyLevelMetrics();
  private l3Metrics: LevelMetrics = this.createEmptyLevelMetrics();
  
  // 历史数据
  private operationHistory: CacheOperation[] = [];
  private alertHistory: Alert[] = [];
  private performanceBaseline?: PerformanceBaseline;
  
  // Prometheus指标
  private prometheusMetrics = {
    cacheHits: new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['level', 'namespace']
    }),
    cacheMisses: new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['level', 'namespace']
    }),
    cacheLatency: new Histogram({
      name: 'cache_operation_duration_seconds',
      help: 'Cache operation duration in seconds',
      labelNames: ['operation', 'level', 'namespace'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0]
    }),
    cacheSize: new Gauge({
      name: 'cache_size_bytes',
      help: 'Current cache size in bytes',
      labelNames: ['level']
    }),
    cacheErrors: new Counter({
      name: 'cache_errors_total',
      help: 'Total number of cache errors',
      labelNames: ['level', 'operation', 'error_type']
    })
  };

  constructor(config: MonitoringConfig) {
    super();
    this.config = {
      ...config,
      retention: {
        shortTerm: config.retention?.shortTerm || 3600, // 1小时
        longTerm: config.retention?.longTerm || 86400   // 24小时
      }
    };
    this.logger = new Logger('CacheMonitor');
  }

  /**
   * 启动监控系统
   */
  async start(): Promise<void> {
    if (this.isRunning || !this.config.enabled) return;

    try {
      this.logger.info('Starting cache monitoring system...');
      
      // 启动指标收集
      this.startMetricsCollection();
      
      // 启动性能基线计算
      this.startBaselineCalculation();
      
      // 启动告警检查
      this.startAlertChecking();
      
      this.isRunning = true;
      this.logger.info('Cache monitoring system started');
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start monitoring system:', error);
      throw error;
    }
  }

  /**
   * 停止监控系统
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.logger.info('Stopping cache monitoring system...');
      
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }
      
      this.isRunning = false;
      this.logger.info('Cache monitoring system stopped');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error('Error stopping monitoring system:', error);
      throw error;
    }
  }

  /**
   * 记录缓存操作
   */
  recordOperation(operation: CacheOperation): void {
    try {
      // 更新实时指标
      this.updateLevelMetrics(operation);
      
      // 记录Prometheus指标
      this.recordPrometheusMetrics(operation);
      
      // 保存操作历史
      this.operationHistory.push(operation);
      this.cleanupHistory();
      
      // 检查阈值告警
      this.checkThresholds(operation);
      
      this.emit('operation', operation);
      
    } catch (error) {
      this.logger.error('Failed to record operation:', error);
    }
  }

  /**
   * 记录L1缓存操作
   */
  recordL1Operation(type: string, success: boolean): void {
    const operation: CacheOperation = {
      type: 'get',
      key: { namespace: 'l1', key: 'operation' },
      level: 'L1',
      timestamp: Date.now(),
      success
    };
    
    if (type === 'set' && success) {
      this.l1Metrics.hits++;
    } else if (type === 'get' && success) {
      this.l1Metrics.hits++;
    } else {
      this.l1Metrics.misses++;
    }
    
    this.recordOperation(operation);
  }

  /**
   * 记录L1命中
   */
  recordL1Hit(): void {
    this.l1Metrics.hits++;
    this.prometheusMetrics.cacheHits.inc({ level: 'L1', namespace: 'all' });
  }

  /**
   * 记录L1未命中
   */
  recordL1Miss(): void {
    this.l1Metrics.misses++;
    this.prometheusMetrics.cacheMisses.inc({ level: 'L1', namespace: 'all' });
  }

  /**
   * 记录L2命中
   */
  recordL2Hit(): void {
    this.l2Metrics.hits++;
    this.prometheusMetrics.cacheHits.inc({ level: 'L2', namespace: 'all' });
  }

  /**
   * 记录L2未命中
   */
  recordL2Miss(): void {
    this.l2Metrics.misses++;
    this.prometheusMetrics.cacheMisses.inc({ level: 'L2', namespace: 'all' });
  }

  /**
   * 记录错误
   */
  recordError(error: any): void {
    this.l1Metrics.errorCount++;
    this.prometheusMetrics.cacheErrors.inc({ 
      level: 'L1', 
      operation: 'unknown',
      error_type: error.name || 'UnknownError'
    });
    
    // 生成错误告警
    this.generateAlert({
      type: 'error',
      severity: 'medium',
      message: `Cache error: ${error.message}`,
      metadata: { error: error.stack }
    });
  }

  /**
   * 获取当前指标
   */
  async getMetrics(): Promise<CacheMetrics> {
    const now = Date.now();
    
    // 计算总体指标
    const totalHits = this.l1Metrics.hits + this.l2Metrics.hits + this.l3Metrics.hits;
    const totalMisses = this.l1Metrics.misses + this.l2Metrics.misses + this.l3Metrics.misses;
    const totalRequests = totalHits + totalMisses;
    const totalErrors = this.l1Metrics.errorCount + this.l2Metrics.errorCount + this.l3Metrics.errorCount;
    
    return {
      l1: { ...this.l1Metrics, hitRatio: this.calculateHitRatio(this.l1Metrics) },
      l2: { ...this.l2Metrics, hitRatio: this.calculateHitRatio(this.l2Metrics) },
      l3: { ...this.l3Metrics, hitRatio: this.calculateHitRatio(this.l3Metrics) },
      overall: {
        hitRatio: totalRequests > 0 ? totalHits / totalRequests : 0,
        missRatio: totalRequests > 0 ? totalMisses / totalRequests : 0,
        totalRequests,
        errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
        avgLatency: this.calculateAverageLatency()
      },
      timestamp: now
    };
  }

  /**
   * 获取性能报告
   */
  async getPerformanceReport(): Promise<{
    summary: any;
    trends: any;
    alerts: Alert[];
    recommendations: string[];
  }> {
    const metrics = await this.getMetrics();
    const trends = this.calculateTrends();
    const activeAlerts = this.alertHistory.filter(a => !a.resolved);
    const recommendations = this.generateRecommendations(metrics);
    
    return {
      summary: {
        overallHealth: this.calculateHealthScore(metrics),
        performance: {
          hitRatio: metrics.overall.hitRatio,
          avgLatency: metrics.overall.avgLatency,
          errorRate: metrics.overall.errorRate,
          throughput: this.calculateThroughput()
        },
        capacity: {
          l1Usage: this.l1Metrics.size,
          l2Usage: this.l2Metrics.size,
          totalEvictions: this.l1Metrics.evictions + this.l2Metrics.evictions
        }
      },
      trends,
      alerts: activeAlerts,
      recommendations
    };
  }

  /**
   * 获取热点数据分析
   */
  getHotspotAnalysis(): Array<{
    key: string;
    namespace: string;
    accessCount: number;
    hitRatio: number;
    avgLatency: number;
  }> {
    const keyStats = new Map<string, {
      accessCount: number;
      hits: number;
      totalLatency: number;
    }>();

    // 分析最近的操作历史
    const recentOperations = this.operationHistory.filter(op => 
      Date.now() - op.timestamp < 3600000 // 最近1小时
    );

    for (const op of recentOperations) {
      const keyStr = `${op.key.namespace}:${op.key.key}`;
      
      if (!keyStats.has(keyStr)) {
        keyStats.set(keyStr, { accessCount: 0, hits: 0, totalLatency: 0 });
      }
      
      const stats = keyStats.get(keyStr)!;
      stats.accessCount++;
      
      if (op.success) {
        stats.hits++;
      }
      
      if (op.latency) {
        stats.totalLatency += op.latency;
      }
    }

    // 生成热点分析
    return Array.from(keyStats.entries())
      .map(([key, stats]) => {
        const [namespace, ...keyParts] = key.split(':');
        return {
          key: keyParts.join(':'),
          namespace,
          accessCount: stats.accessCount,
          hitRatio: stats.hits / stats.accessCount,
          avgLatency: stats.totalLatency / stats.accessCount
        };
      })
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 20); // 返回前20个热点
  }

  /**
   * 重置指标
   */
  resetMetrics(): void {
    this.l1Metrics = this.createEmptyLevelMetrics();
    this.l2Metrics = this.createEmptyLevelMetrics();
    this.l3Metrics = this.createEmptyLevelMetrics();
    this.operationHistory = [];
    
    this.logger.info('Cache metrics reset');
    this.emit('metricsReset');
  }

  // Private methods

  private createEmptyLevelMetrics(): LevelMetrics {
    return {
      hits: 0,
      misses: 0,
      hitRatio: 0,
      avgLatency: 0,
      errorCount: 0,
      size: 0,
      evictions: 0
    };
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.getMetrics();
        this.emit('metricsCollected', metrics);
        
        // 更新性能基线
        this.updatePerformanceBaseline(metrics);
        
      } catch (error) {
        this.logger.error('Metrics collection failed:', error);
      }
    }, this.config.interval);
  }

  private startBaselineCalculation(): void {
    // 每小时更新一次性能基线
    setInterval(() => {
      this.calculatePerformanceBaseline();
    }, 3600000);
  }

  private startAlertChecking(): void {
    // 每分钟检查一次告警
    setInterval(() => {
      this.checkActiveAlerts();
    }, 60000);
  }

  private updateLevelMetrics(operation: CacheOperation): void {
    let metrics: LevelMetrics;
    
    switch (operation.level) {
      case 'L1':
        metrics = this.l1Metrics;
        break;
      case 'L2':
        metrics = this.l2Metrics;
        break;
      case 'L3':
        metrics = this.l3Metrics;
        break;
      default:
        return;
    }
    
    if (operation.success) {
      metrics.hits++;
    } else {
      metrics.misses++;
      if (operation.error) {
        metrics.errorCount++;
      }
    }
    
    if (operation.latency) {
      // 使用移动平均计算延迟
      const totalOperations = metrics.hits + metrics.misses;
      metrics.avgLatency = (metrics.avgLatency * (totalOperations - 1) + operation.latency) / totalOperations;
    }
    
    metrics.hitRatio = this.calculateHitRatio(metrics);
  }

  private recordPrometheusMetrics(operation: CacheOperation): void {
    const labels = {
      level: operation.level,
      namespace: operation.key.namespace,
      operation: operation.type
    };
    
    if (operation.success) {
      this.prometheusMetrics.cacheHits.inc({
        level: operation.level,
        namespace: operation.key.namespace
      });
    } else {
      this.prometheusMetrics.cacheMisses.inc({
        level: operation.level,
        namespace: operation.key.namespace
      });
    }
    
    if (operation.latency) {
      this.prometheusMetrics.cacheLatency.observe(labels, operation.latency / 1000);
    }
    
    if (operation.error) {
      this.prometheusMetrics.cacheErrors.inc({
        level: operation.level,
        operation: operation.type,
        error_type: operation.error
      });
    }
  }

  private calculateHitRatio(metrics: LevelMetrics): number {
    const total = metrics.hits + metrics.misses;
    return total > 0 ? metrics.hits / total : 0;
  }

  private calculateAverageLatency(): number {
    if (this.operationHistory.length === 0) return 0;
    
    const recentOps = this.operationHistory.slice(-100); // 最近100次操作
    const latencies = recentOps
      .filter(op => op.latency !== undefined)
      .map(op => op.latency!);
    
    if (latencies.length === 0) return 0;
    
    return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
  }

  private calculateThroughput(): number {
    const oneMinuteAgo = Date.now() - 60000;
    const recentOps = this.operationHistory.filter(op => op.timestamp > oneMinuteAgo);
    return recentOps.length; // 每分钟操作数
  }

  private calculateHealthScore(metrics: CacheMetrics): number {
    const hitRatioScore = Math.min(metrics.overall.hitRatio * 100, 100);
    const latencyScore = Math.max(100 - metrics.overall.avgLatency / 10, 0);
    const errorScore = Math.max(100 - metrics.overall.errorRate * 1000, 0);
    
    return (hitRatioScore + latencyScore + errorScore) / 3;
  }

  private calculateTrends(): any {
    // 计算过去1小时的趋势
    const oneHourAgo = Date.now() - 3600000;
    const recentOps = this.operationHistory.filter(op => op.timestamp > oneHourAgo);
    
    // 按15分钟分组
    const timeWindows = [];
    for (let i = 0; i < 4; i++) {
      const windowStart = oneHourAgo + i * 900000;
      const windowEnd = windowStart + 900000;
      const windowOps = recentOps.filter(op => 
        op.timestamp >= windowStart && op.timestamp < windowEnd
      );
      
      const hits = windowOps.filter(op => op.success).length;
      const total = windowOps.length;
      
      timeWindows.push({
        timestamp: windowStart,
        hitRatio: total > 0 ? hits / total : 0,
        throughput: total,
        avgLatency: this.calculateWindowLatency(windowOps)
      });
    }
    
    return {
      hitRatio: this.calculateTrend(timeWindows.map(w => w.hitRatio)),
      throughput: this.calculateTrend(timeWindows.map(w => w.throughput)),
      latency: this.calculateTrend(timeWindows.map(w => w.avgLatency))
    };
  }

  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';
    
    const first = values[0];
    const last = values[values.length - 1];
    const change = (last - first) / Math.max(first, 0.001);
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private calculateWindowLatency(operations: CacheOperation[]): number {
    const latencies = operations
      .filter(op => op.latency !== undefined)
      .map(op => op.latency!);
    
    if (latencies.length === 0) return 0;
    return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
  }

  private generateRecommendations(metrics: CacheMetrics): string[] {
    const recommendations: string[] = [];
    
    // 命中率建议
    if (metrics.overall.hitRatio < 0.7) {
      recommendations.push('考虑增加缓存TTL时间或调整缓存策略以提高命中率');
    }
    
    // 延迟建议
    if (metrics.overall.avgLatency > 100) {
      recommendations.push('平均延迟较高，考虑优化网络连接或使用本地缓存');
    }
    
    // 错误率建议
    if (metrics.overall.errorRate > 0.01) {
      recommendations.push('错误率偏高，检查Redis连接稳定性和配置');
    }
    
    // L1/L2平衡建议
    const l1HitRatio = metrics.l1.hitRatio;
    const l2HitRatio = metrics.l2.hitRatio;
    
    if (l1HitRatio < 0.3 && l2HitRatio > 0.8) {
      recommendations.push('L1缓存命中率低，考虑增加内存缓存大小');
    }
    
    return recommendations;
  }

  private checkThresholds(operation: CacheOperation): void {
    // 检查延迟阈值
    if (operation.latency && operation.latency > this.config.thresholds.latency) {
      this.generateAlert({
        type: 'performance',
        severity: 'medium',
        message: `High latency detected: ${operation.latency}ms for ${operation.key.namespace}:${operation.key.key}`,
        metadata: { operation }
      });
    }
  }

  private checkActiveAlerts(): void {
    const metrics = this.getMetrics();
    
    Promise.resolve(metrics).then(m => {
      // 检查命中率阈值
      if (m.overall.hitRatio < this.config.thresholds.hitRatio) {
        this.generateAlert({
          type: 'performance',
          severity: 'high',
          message: `Low hit ratio: ${(m.overall.hitRatio * 100).toFixed(1)}%`,
          metadata: { hitRatio: m.overall.hitRatio }
        });
      }
      
      // 检查错误率阈值
      if (m.overall.errorRate > this.config.thresholds.errorRate) {
        this.generateAlert({
          type: 'error',
          severity: 'high',
          message: `High error rate: ${(m.overall.errorRate * 100).toFixed(1)}%`,
          metadata: { errorRate: m.overall.errorRate }
        });
      }
    });
  }

  private generateAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'resolved'>): void {
    const fullAlert: Alert = {
      ...alert,
      id: this.generateAlertId(),
      timestamp: Date.now(),
      resolved: false
    };
    
    this.alertHistory.push(fullAlert);
    this.emit('alert', fullAlert);
    
    this.logger.warn(`Alert generated: ${fullAlert.type} - ${fullAlert.message}`);
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updatePerformanceBaseline(metrics: CacheMetrics): void {
    if (!this.performanceBaseline) {
      this.performanceBaseline = {
        hitRatio: {
          min: metrics.overall.hitRatio,
          avg: metrics.overall.hitRatio,
          max: metrics.overall.hitRatio
        },
        latency: {
          p50: metrics.overall.avgLatency,
          p95: metrics.overall.avgLatency,
          p99: metrics.overall.avgLatency
        },
        errorRate: metrics.overall.errorRate,
        throughput: this.calculateThroughput(),
        lastUpdated: Date.now()
      };
    } else {
      // 更新基线（使用指数移动平均）
      const alpha = 0.1;
      this.performanceBaseline.hitRatio.avg = 
        (1 - alpha) * this.performanceBaseline.hitRatio.avg + alpha * metrics.overall.hitRatio;
      this.performanceBaseline.latency.p50 = 
        (1 - alpha) * this.performanceBaseline.latency.p50 + alpha * metrics.overall.avgLatency;
      this.performanceBaseline.lastUpdated = Date.now();
    }
  }

  private calculatePerformanceBaseline(): void {
    // 计算更精确的性能基线
    const recentOps = this.operationHistory.filter(op => 
      Date.now() - op.timestamp < 3600000 // 最近1小时
    );
    
    if (recentOps.length === 0) return;
    
    const latencies = recentOps
      .filter(op => op.latency !== undefined)
      .map(op => op.latency!)
      .sort((a, b) => a - b);
    
    if (latencies.length > 0) {
      const p50Index = Math.floor(latencies.length * 0.5);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p99Index = Math.floor(latencies.length * 0.99);
      
      if (this.performanceBaseline) {
        this.performanceBaseline.latency = {
          p50: latencies[p50Index],
          p95: latencies[p95Index],
          p99: latencies[p99Index]
        };
      }
    }
  }

  private cleanupHistory(): void {
    const cutoff = Date.now() - this.config.retention.longTerm * 1000;
    
    // 清理操作历史
    this.operationHistory = this.operationHistory.filter(op => op.timestamp > cutoff);
    
    // 清理告警历史
    this.alertHistory = this.alertHistory.filter(alert => 
      alert.timestamp > cutoff || !alert.resolved
    );
  }
}