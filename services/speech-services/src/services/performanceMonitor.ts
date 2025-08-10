import { EventEmitter } from 'events';
import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import logger from '../utils/logger';
import { config } from '../config';
import {
  PerformanceMetrics,
  LatencyTarget,
  SpeechServiceError,
  ErrorCode,
} from '../types';

export class PerformanceMonitor extends EventEmitter {
  // Prometheus metrics
  private sttLatencyHistogram: Histogram<string>;
  private ttsLatencyHistogram: Histogram<string>;
  private totalLatencyHistogram: Histogram<string>;
  private requestCounter: Counter<string>;
  private errorCounter: Counter<string>;
  private cacheHitRateGauge: Gauge<string>;
  private activeConnectionsGauge: Gauge<string>;
  private audioBufferSizeGauge: Gauge<string>;

  // Internal metrics storage
  private latencyHistory: Map<string, number[]>;
  private errorHistory: Map<string, Error[]>;
  private startTimes: Map<string, number>;
  private latencyTargets: Map<string, LatencyTarget>;

  // Alert thresholds
  private alertThresholds: Map<string, number>;
  private alertCooldown: Map<string, number>;

  constructor() {
    super();
    
    // Initialize Prometheus metrics
    this.initializePrometheusMetrics();
    
    // Initialize internal storage
    this.latencyHistory = new Map();
    this.errorHistory = new Map();
    this.startTimes = new Map();
    this.latencyTargets = new Map();
    this.alertThresholds = new Map();
    this.alertCooldown = new Map();
    
    // Set up default latency targets
    this.setupLatencyTargets();
    
    // Start metrics collection
    if (config.monitoring.metricsEnabled) {
      collectDefaultMetrics({ register });
      this.startMetricsServer();
    }
    
    // Start monitoring loop
    this.startMonitoringLoop();
  }

  /**
   * Initialize Prometheus metrics
   */
  private initializePrometheusMetrics(): void {
    this.sttLatencyHistogram = new Histogram({
      name: 'speech_stt_latency_ms',
      help: 'Speech-to-Text latency in milliseconds',
      labelNames: ['language', 'status'],
      buckets: [50, 100, 200, 350, 500, 750, 1000, 2000],
    });

    this.ttsLatencyHistogram = new Histogram({
      name: 'speech_tts_latency_ms',
      help: 'Text-to-Speech latency in milliseconds',
      labelNames: ['voice', 'status'],
      buckets: [50, 100, 200, 300, 500, 750, 1000, 2000],
    });

    this.totalLatencyHistogram = new Histogram({
      name: 'speech_total_latency_ms',
      help: 'Total processing latency in milliseconds',
      labelNames: ['operation', 'status'],
      buckets: [100, 250, 500, 750, 1000, 1500, 2000, 3000],
    });

    this.requestCounter = new Counter({
      name: 'speech_requests_total',
      help: 'Total number of speech processing requests',
      labelNames: ['operation', 'status'],
    });

    this.errorCounter = new Counter({
      name: 'speech_errors_total',
      help: 'Total number of speech processing errors',
      labelNames: ['operation', 'error_code'],
    });

    this.cacheHitRateGauge = new Gauge({
      name: 'speech_cache_hit_rate',
      help: 'Cache hit rate percentage',
      labelNames: ['cache_type'],
    });

    this.activeConnectionsGauge = new Gauge({
      name: 'speech_active_connections',
      help: 'Number of active WebSocket connections',
    });

    this.audioBufferSizeGauge = new Gauge({
      name: 'speech_audio_buffer_size_bytes',
      help: 'Current audio buffer size in bytes',
      labelNames: ['call_id'],
    });
  }

  /**
   * Set up latency targets
   */
  private setupLatencyTargets(): void {
    this.latencyTargets.set('stt', {
      operation: 'stt',
      target: config.latencyTargets.stt,
      p50: 0,
      p95: 0,
      p99: 0,
      average: 0,
    });

    this.latencyTargets.set('tts', {
      operation: 'tts',
      target: config.latencyTargets.tts,
      p50: 0,
      p95: 0,
      p99: 0,
      average: 0,
    });

    this.latencyTargets.set('total', {
      operation: 'total',
      target: config.latencyTargets.total,
      p50: 0,
      p95: 0,
      p99: 0,
      average: 0,
    });

    // Set alert thresholds (120% of target)
    this.alertThresholds.set('stt', config.latencyTargets.stt * 1.2);
    this.alertThresholds.set('tts', config.latencyTargets.tts * 1.2);
    this.alertThresholds.set('total', config.latencyTargets.total * 1.2);
  }

  /**
   * Start operation timing
   */
  public startOperation(operationId: string): void {
    this.startTimes.set(operationId, Date.now());
  }

  /**
   * End operation timing and record metrics
   */
  public endOperation(
    operationId: string,
    operation: 'stt' | 'tts' | 'total',
    success: boolean = true,
    metadata?: Record<string, any>
  ): void {
    const startTime = this.startTimes.get(operationId);
    if (!startTime) {
      logger.warn(`No start time found for operation ${operationId}`);
      return;
    }

    const latency = Date.now() - startTime;
    this.startTimes.delete(operationId);

    // Record in Prometheus
    this.recordPrometheusMetrics(operation, latency, success, metadata);

    // Record in internal storage
    this.recordInternalMetrics(operation, latency);

    // Check for alerts
    this.checkLatencyAlert(operation, latency);

    // Emit metrics event
    this.emit('metrics', {
      operationId,
      operation,
      latency,
      success,
      metadata,
    });
  }

  /**
   * Record Prometheus metrics
   */
  private recordPrometheusMetrics(
    operation: string,
    latency: number,
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    const status = success ? 'success' : 'failure';

    switch (operation) {
      case 'stt':
        this.sttLatencyHistogram.observe(
          { language: metadata?.language || 'zh-CN', status },
          latency
        );
        break;
      case 'tts':
        this.ttsLatencyHistogram.observe(
          { voice: metadata?.voice || 'default', status },
          latency
        );
        break;
      case 'total':
        this.totalLatencyHistogram.observe(
          { operation: metadata?.operation || 'unknown', status },
          latency
        );
        break;
    }

    this.requestCounter.inc({ operation, status });
  }

  /**
   * Record internal metrics
   */
  private recordInternalMetrics(operation: string, latency: number): void {
    if (!this.latencyHistory.has(operation)) {
      this.latencyHistory.set(operation, []);
    }

    const history = this.latencyHistory.get(operation)!;
    history.push(latency);

    // Keep only last 1000 measurements
    if (history.length > 1000) {
      history.shift();
    }

    // Update latency targets
    this.updateLatencyTargets(operation);
  }

  /**
   * Update latency targets with current statistics
   */
  private updateLatencyTargets(operation: string): void {
    const history = this.latencyHistory.get(operation);
    if (!history || history.length === 0) return;

    const sorted = [...history].sort((a, b) => a - b);
    const target = this.latencyTargets.get(operation);
    
    if (target) {
      target.average = history.reduce((a, b) => a + b, 0) / history.length;
      target.p50 = sorted[Math.floor(sorted.length * 0.5)];
      target.p95 = sorted[Math.floor(sorted.length * 0.95)];
      target.p99 = sorted[Math.floor(sorted.length * 0.99)];
    }
  }

  /**
   * Record error
   */
  public recordError(operation: string, error: Error): void {
    // Record in Prometheus
    const errorCode = (error as SpeechServiceError).code || 'UNKNOWN';
    this.errorCounter.inc({ operation, error_code: errorCode });

    // Record in internal storage
    if (!this.errorHistory.has(operation)) {
      this.errorHistory.set(operation, []);
    }

    const history = this.errorHistory.get(operation)!;
    history.push(error);

    // Keep only last 100 errors
    if (history.length > 100) {
      history.shift();
    }

    // Emit error event
    this.emit('error', { operation, error });
  }

  /**
   * Update cache metrics
   */
  public updateCacheMetrics(cacheType: string, hitRate: number): void {
    this.cacheHitRateGauge.set({ cache_type: cacheType }, hitRate * 100);
  }

  /**
   * Update connection metrics
   */
  public updateConnectionMetrics(activeConnections: number): void {
    this.activeConnectionsGauge.set(activeConnections);
  }

  /**
   * Update audio buffer metrics
   */
  public updateAudioBufferMetrics(callId: string, bufferSize: number): void {
    this.audioBufferSizeGauge.set({ call_id: callId }, bufferSize);
  }

  /**
   * Check latency alert
   */
  private checkLatencyAlert(operation: string, latency: number): void {
    const threshold = this.alertThresholds.get(operation);
    if (!threshold) return;

    const cooldown = this.alertCooldown.get(operation) || 0;
    const now = Date.now();

    if (latency > threshold && now > cooldown) {
      // Set cooldown for 5 minutes
      this.alertCooldown.set(operation, now + 5 * 60 * 1000);

      // Emit alert
      this.emit('latency_alert', {
        operation,
        latency,
        threshold,
        target: this.latencyTargets.get(operation)?.target,
      });

      logger.warn(`Latency alert for ${operation}: ${latency}ms (threshold: ${threshold}ms)`);
    }
  }

  /**
   * Get current metrics
   */
  public getMetrics(): Map<string, any> {
    const metrics = new Map();

    // Add latency targets with current stats
    for (const [operation, target] of this.latencyTargets) {
      metrics.set(`${operation}_latency`, target);
    }

    // Add error counts
    for (const [operation, errors] of this.errorHistory) {
      metrics.set(`${operation}_errors`, errors.length);
    }

    // Add current queue sizes
    metrics.set('active_operations', this.startTimes.size);

    return metrics;
  }

  /**
   * Get latency report
   */
  public getLatencyReport(): Map<string, LatencyTarget> {
    return new Map(this.latencyTargets);
  }

  /**
   * Start metrics server
   */
  private startMetricsServer(): void {
    const express = require('express');
    const app = express();

    app.get('/metrics', async (req: any, res: any) => {
      try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
      } catch (error) {
        res.status(500).end(error);
      }
    });

    app.listen(config.monitoring.metricsPort, () => {
      logger.info(`Metrics server listening on port ${config.monitoring.metricsPort}`);
    });
  }

  /**
   * Start monitoring loop
   */
  private startMonitoringLoop(): void {
    setInterval(() => {
      // Check for performance degradation
      for (const [operation, target] of this.latencyTargets) {
        if (target.p95 > target.target * 1.5) {
          logger.warn(`Performance degradation detected for ${operation}: P95=${target.p95}ms`);
        }
      }

      // Emit periodic metrics
      this.emit('periodic_metrics', this.getMetrics());
    }, 60000); // Every minute
  }

  /**
   * Reset metrics
   */
  public resetMetrics(): void {
    this.latencyHistory.clear();
    this.errorHistory.clear();
    this.startTimes.clear();
    this.alertCooldown.clear();
    
    // Reset Prometheus metrics
    register.clear();
    this.initializePrometheusMetrics();
    
    logger.info('Performance metrics reset');
  }

  /**
   * Destroy monitor
   */
  public destroy(): void {
    this.removeAllListeners();
    this.resetMetrics();
    logger.info('Performance monitor destroyed');
  }
}

// Export singleton instance
export default new PerformanceMonitor();