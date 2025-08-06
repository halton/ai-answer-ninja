import { EventEmitter } from 'events';
import {
  MonitoringConfig,
  LatencyMetrics,
  ThroughputMetrics,
  ResourceMetrics,
  ProcessingStage,
} from '../types';
import logger from '../utils/logger';

interface MetricEntry {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

interface MetricsConfig extends MonitoringConfig {
  prometheusEnabled?: boolean;
  customMetricsEnabled?: boolean;
  detailedMetrics?: boolean;
  retentionPeriod?: number;
}

export class MetricsService extends EventEmitter {
  private config: MetricsConfig;
  private isCollecting = false;
  private collectionInterval?: NodeJS.Timeout;
  
  // Basic metrics storage
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, MetricEntry[]> = new Map();
  private latencyMetrics: Map<string, MetricEntry[]> = new Map();
  
  // Performance tracking
  private startTime = Date.now();
  private latencyHistory: Array<{ timestamp: number; metrics: LatencyMetrics }> = [];
  private throughputHistory: Array<{ timestamp: number; metrics: ThroughputMetrics }> = [];
  private resourceHistory: Array<{ timestamp: number; metrics: ResourceMetrics }> = [];
  
  constructor(config: MonitoringConfig) {
    super();
    
    this.config = {
      ...config,
      prometheusEnabled: true,
      customMetricsEnabled: true,
      detailedMetrics: true,
      retentionPeriod: 3600000, // 1 hour
    };
    
    logger.info('Enhanced Metrics Service initialized', { config: this.config });
  }

  public async start(): Promise<void> {
    if (this.isCollecting) return;

    this.isCollecting = true;
    this.startTime = Date.now();

    if (this.config.enabled) {
      this.startMetricsCollection();
    }

    logger.info('Enhanced Metrics Service started');
  }

  public async stop(): Promise<void> {
    if (!this.isCollecting) return;

    this.isCollecting = false;

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
    }

    logger.info('Enhanced Metrics Service stopped');
  }

  private startMetricsCollection(): void {
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.cleanupOldMetrics();
      this.emitMetrics();
    }, this.config.metricsInterval);

    logger.debug('Metrics collection started');
  }

  // Counter methods
  public incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    
    this.emit('counter_increment', { name, value, labels, total: current + value });
  }

  public decrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, Math.max(0, current - value));
  }

  // Gauge methods
  public setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    this.gauges.set(key, value);
    
    this.emit('gauge_update', { name, value, labels });
  }

  public incrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    const current = this.gauges.get(key) || 0;
    this.gauges.set(key, current + value);
  }

  public decrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    const current = this.gauges.get(key) || 0;
    this.gauges.set(key, current - value);
  }

  // Histogram methods
  public recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    let entries = this.histograms.get(key);
    
    if (!entries) {
      entries = [];
      this.histograms.set(key, entries);
    }
    
    entries.push({
      timestamp: Date.now(),
      value,
      labels,
    });
    
    // Keep only recent entries
    if (entries.length > 1000) {
      entries.shift();
    }
    
    this.emit('histogram_record', { name, value, labels });
  }

  // Enhanced latency tracking
  public recordLatencyMetrics(metrics: LatencyMetrics): void {
    const timestamp = Date.now();
    
    // Store in history
    this.latencyHistory.push({ timestamp, metrics });
    this.cleanupHistory(this.latencyHistory);
    
    // Record individual stage latencies
    const stages = [
      { name: 'total_pipeline', value: metrics.totalPipeline },
      { name: 'audio_preprocessing', value: metrics.audioPreprocessing },
      { name: 'speech_to_text', value: metrics.speechToText },
      { name: 'intent_recognition', value: metrics.intentRecognition },
      { name: 'ai_generation', value: metrics.aiGeneration },
      { name: 'text_to_speech', value: metrics.textToSpeech },
      { name: 'network_transmission', value: metrics.networkTransmission },
    ];
    
    for (const stage of stages) {
      if (stage.value > 0) {
        this.recordHistogram(`latency_${stage.name}`, stage.value, { stage: stage.name });
      }
    }
    
    // Emit event for real-time monitoring
    this.emit('latency_metrics', { timestamp, metrics });
  }

  // Throughput tracking
  public recordThroughputMetrics(metrics: ThroughputMetrics): void {
    const timestamp = Date.now();
    
    this.throughputHistory.push({ timestamp, metrics });
    this.cleanupHistory(this.throughputHistory);
    
    // Update gauges
    this.setGauge('audio_chunks_per_second', metrics.audioChunksPerSecond);
    this.setGauge('messages_per_second', metrics.messagesPerSecond);
    this.setGauge('bytes_per_second', metrics.bytesPerSecond);
    this.setGauge('concurrent_connections', metrics.concurrentConnections);
    
    this.emit('throughput_metrics', { timestamp, metrics });
  }

  // Resource tracking
  public recordResourceMetrics(metrics: ResourceMetrics): void {
    const timestamp = Date.now();
    
    this.resourceHistory.push({ timestamp, metrics });
    this.cleanupHistory(this.resourceHistory);
    
    // Update gauges
    this.setGauge('cpu_usage_percent', metrics.cpuUsage);
    this.setGauge('memory_usage_percent', metrics.memoryUsage);
    this.setGauge('network_usage_percent', metrics.networkUsage);
    this.setGauge('redis_connections', metrics.redisConnections);
    
    this.emit('resource_metrics', { timestamp, metrics });
  }

  // Data retrieval methods
  public getLatencyStats(timeWindow: number = 300000): any {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.latencyHistory.filter(entry => entry.timestamp >= cutoff);
    
    if (recentMetrics.length === 0) {
      return {
        count: 0,
        average: {},
        p95: {},
        p99: {},
      };
    }
    
    const stages = ['totalPipeline', 'audioPreprocessing', 'speechToText', 'intentRecognition', 'aiGeneration', 'textToSpeech'];
    const stats: any = { count: recentMetrics.length, average: {}, p95: {}, p99: {} };
    
    for (const stage of stages) {
      const values = recentMetrics
        .map(entry => entry.metrics[stage as keyof LatencyMetrics])
        .filter(v => v > 0)
        .sort((a, b) => a - b);
      
      if (values.length > 0) {
        stats.average[stage] = values.reduce((sum, val) => sum + val, 0) / values.length;
        stats.p95[stage] = this.calculatePercentile(values, 0.95);
        stats.p99[stage] = this.calculatePercentile(values, 0.99);
      }
    }
    
    return stats;
  }

  public getThroughputStats(timeWindow: number = 300000): any {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.throughputHistory.filter(entry => entry.timestamp >= cutoff);
    
    if (recentMetrics.length === 0) {
      return { count: 0, average: {}, peak: {} };
    }
    
    const metrics = ['audioChunksPerSecond', 'messagesPerSecond', 'bytesPerSecond', 'concurrentConnections'];
    const stats: any = { count: recentMetrics.length, average: {}, peak: {} };
    
    for (const metric of metrics) {
      const values = recentMetrics.map(entry => entry.metrics[metric as keyof ThroughputMetrics]);
      
      stats.average[metric] = values.reduce((sum, val) => sum + val, 0) / values.length;
      stats.peak[metric] = Math.max(...values);
    }
    
    return stats;
  }

  public getResourceStats(timeWindow: number = 300000): any {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.resourceHistory.filter(entry => entry.timestamp >= cutoff);
    
    if (recentMetrics.length === 0) {
      return { count: 0, current: {}, average: {}, peak: {} };
    }
    
    const latest = recentMetrics[recentMetrics.length - 1].metrics;
    const metrics = ['cpuUsage', 'memoryUsage', 'networkUsage', 'redisConnections'];
    const stats: any = { count: recentMetrics.length, current: latest, average: {}, peak: {} };
    
    for (const metric of metrics) {
      const values = recentMetrics.map(entry => entry.metrics[metric as keyof ResourceMetrics]);
      
      stats.average[metric] = values.reduce((sum, val) => sum + val, 0) / values.length;
      stats.peak[metric] = Math.max(...values);
    }
    
    return stats;
  }

  public getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  public getGauges(): Record<string, number> {
    return Object.fromEntries(this.gauges);
  }

  public getHistograms(): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const [key, entries] of this.histograms) {
      if (entries.length > 0) {
        const values = entries.map(e => e.value).sort((a, b) => a - b);
        
        result[key] = {
          count: values.length,
          average: values.reduce((sum, val) => sum + val, 0) / values.length,
          p50: this.calculatePercentile(values, 0.5),
          p95: this.calculatePercentile(values, 0.95),
          p99: this.calculatePercentile(values, 0.99),
          min: values[0],
          max: values[values.length - 1],
        };
      }
    }
    
    return result;
  }

  // Legacy compatibility methods
  public async getMetrics(): Promise<any> {
    return {
      counters: this.getCounters(),
      gauges: this.getGauges(),
      histograms: this.getHistograms(),
      latency: this.getLatencyStats(),
      throughput: this.getThroughputStats(),
      resources: this.getResourceStats(),
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };
  }

  // Health status
  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    metricsCount: number;
    details: any;
  } {
    const uptime = Date.now() - this.startTime;
    const metricsCount = this.latencyHistory.length + this.throughputHistory.length + this.resourceHistory.length;
    
    // Assess health based on recent metrics
    const recentLatency = this.getLatencyStats(60000); // Last minute
    const recentResources = this.getResourceStats(60000);
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Check for performance degradation
    if (recentLatency.average?.totalPipeline > 1000) {
      status = 'degraded';
    }
    
    if (recentLatency.average?.totalPipeline > 2000 || recentResources.current?.cpuUsage > 90) {
      status = 'unhealthy';
    }
    
    return {
      status,
      uptime,
      metricsCount,
      details: {
        collecting: this.isCollecting,
        config: this.config,
        latencyStats: recentLatency,
        resourceStats: recentResources,
        customMetricsCount: this.counters.size + this.gauges.size + this.histograms.size,
      },
    };
  }

  private collectSystemMetrics(): void {
    // Collect basic system metrics
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Record system resource metrics
    this.recordResourceMetrics({
      cpuUsage: this.calculateCPUPercentage(cpuUsage),
      memoryUsage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      networkUsage: 0, // Would need external monitoring
      redisConnections: 0, // Would be provided by Redis service
    });
    
    // Emit collection event
    this.emit('metrics_collection', {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    });
  }

  private cleanupOldMetrics(): void {
    const retentionPeriod = this.config.retentionPeriod || 3600000;
    const cutoff = Date.now() - retentionPeriod;
    
    // Cleanup history arrays
    this.latencyHistory = this.latencyHistory.filter(entry => entry.timestamp >= cutoff);
    this.throughputHistory = this.throughputHistory.filter(entry => entry.timestamp >= cutoff);
    this.resourceHistory = this.resourceHistory.filter(entry => entry.timestamp >= cutoff);
    
    // Cleanup histograms
    for (const [key, entries] of this.histograms) {
      const filtered = entries.filter(entry => entry.timestamp >= cutoff);
      if (filtered.length > 0) {
        this.histograms.set(key, filtered);
      } else {
        this.histograms.delete(key);
      }
    }
  }

  private cleanupHistory<T>(history: Array<{ timestamp: number; metrics: T }>): void {
    const retentionPeriod = this.config.retentionPeriod || 3600000;
    const cutoff = Date.now() - retentionPeriod;
    
    // Remove old entries
    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
    }
    
    // Also limit by count
    if (history.length > 10000) {
      history.splice(0, history.length - 5000);
    }
  }

  private emitMetrics(): void {
    this.emit('metrics_update', {
      timestamp: Date.now(),
      counters: this.getCounters(),
      gauges: this.getGauges(),
      latency: this.getLatencyStats(60000), // Last minute
      throughput: this.getThroughputStats(60000),
      resources: this.getResourceStats(60000),
    });
  }

  private buildMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    
    const labelString = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    
    return `${name}{${labelString}}`;
  }

  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  private calculateCPUPercentage(cpuUsage: NodeJS.CpuUsage): number {
    // This is a simplified calculation - in production, you'd want more sophisticated CPU monitoring
    return ((cpuUsage.user + cpuUsage.system) / 1000000) * 100;
  }

  // Export methods
  public exportMetrics(): {
    latency: any;
    throughput: any;
    resources: any;
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, any>;
    timestamp: number;
  } {
    return {
      latency: this.getLatencyStats(),
      throughput: this.getThroughputStats(),
      resources: this.getResourceStats(),
      counters: this.getCounters(),
      gauges: this.getGauges(),
      histograms: this.getHistograms(),
      timestamp: Date.now(),
    };
  }

  // Reset methods (for testing)
  public reset(): void {
    this.latencyHistory = [];
    this.throughputHistory = [];
    this.resourceHistory = [];
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    
    this.startTime = Date.now();
    logger.info('Metrics service reset');
  }
}