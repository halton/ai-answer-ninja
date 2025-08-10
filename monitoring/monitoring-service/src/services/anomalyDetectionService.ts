import { EventEmitter } from 'events';
import { PerformanceBaseline, AnomalyDetection, MetricPoint } from '../types';
import logger from '../utils/logger';
import { MetricsService } from './metricsService';
import { RedisService } from './redisService';
import config from '../config';

interface StatisticalModel {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
  };
  count: number;
  lastUpdated: Date;
}

interface TimeSeriesData {
  timestamp: number;
  value: number;
}

interface SeasonalPattern {
  hourly: number[];
  daily: number[];
  weekly: number[];
}

interface AnomalyThreshold {
  warningMultiplier: number;
  criticalMultiplier: number;
  minSamplesRequired: number;
  confidenceInterval: number;
}

export class AnomalyDetectionService extends EventEmitter {
  private baselines: Map<string, PerformanceBaseline> = new Map();
  private models: Map<string, StatisticalModel> = new Map();
  private seasonalPatterns: Map<string, SeasonalPattern> = new Map();
  private anomalyHistory: Map<string, AnomalyDetection[]> = new Map();
  private learningBuffer: Map<string, TimeSeriesData[]> = new Map();
  
  private readonly defaultThresholds: AnomalyThreshold = {
    warningMultiplier: 2.0,
    criticalMultiplier: 3.0,
    minSamplesRequired: 100,
    confidenceInterval: 0.95
  };

  constructor(
    private metrics: MetricsService,
    private redis: RedisService
  ) {
    super();
    this.setupEventHandlers();
    this.loadBaselinesFromStorage();
    this.startPeriodicTasks();
  }

  private setupEventHandlers(): void {
    this.on('metric-received', this.processMetric.bind(this));
    this.on('baseline-updated', this.handleBaselineUpdate.bind(this));
    this.on('anomaly-detected', this.handleAnomalyDetection.bind(this));
  }

  private async loadBaselinesFromStorage(): Promise<void> {
    try {
      const baselinesData = await this.redis.get('anomaly:baselines') || '[]';
      const baselines: PerformanceBaseline[] = JSON.parse(baselinesData);

      baselines.forEach(baseline => {
        this.baselines.set(this.getBaselineKey(baseline), baseline);
      });

      // Load statistical models
      const modelsData = await this.redis.get('anomaly:models') || '{}';
      const models = JSON.parse(modelsData);
      
      Object.entries(models).forEach(([key, model]: [string, any]) => {
        this.models.set(key, {
          ...model,
          lastUpdated: new Date(model.lastUpdated)
        });
      });

      // Load seasonal patterns
      const patternsData = await this.redis.get('anomaly:patterns') || '{}';
      const patterns = JSON.parse(patternsData);
      
      Object.entries(patterns).forEach(([key, pattern]) => {
        this.seasonalPatterns.set(key, pattern as SeasonalPattern);
      });

      logger.info(`Loaded ${baselines.length} baselines, ${Object.keys(models).length} models, ${Object.keys(patterns).length} patterns`, {
        service: 'AnomalyDetectionService'
      });
    } catch (error) {
      logger.error('Failed to load baselines from storage', { error });
    }
  }

  public processMetric(metric: MetricPoint & { name: string; service?: string }): void {
    try {
      const metricKey = this.getMetricKey(metric.name, metric.service, metric.labels);
      
      // Add to learning buffer
      this.addToLearningBuffer(metricKey, metric);
      
      // Check for anomalies
      this.detectAnomalies(metricKey, metric);
      
      // Update statistical model
      this.updateStatisticalModel(metricKey, metric.value);
      
    } catch (error) {
      logger.error('Failed to process metric for anomaly detection', { 
        error, 
        metric: metric.name 
      });
    }
  }

  private addToLearningBuffer(key: string, metric: MetricPoint & { name: string }): void {
    if (!this.learningBuffer.has(key)) {
      this.learningBuffer.set(key, []);
    }

    const buffer = this.learningBuffer.get(key)!;
    buffer.push({
      timestamp: metric.timestamp,
      value: metric.value
    });

    // Keep only recent data for learning (last 7 days)
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const filteredBuffer = buffer.filter(point => point.timestamp >= cutoffTime);
    
    // Limit buffer size
    if (filteredBuffer.length > 10080) { // 7 days * 24 hours * 60 minutes
      filteredBuffer.splice(0, filteredBuffer.length - 10080);
    }
    
    this.learningBuffer.set(key, filteredBuffer);
  }

  private detectAnomalies(key: string, metric: MetricPoint & { name: string; service?: string }): void {
    const model = this.models.get(key);
    const baseline = this.getBaseline(metric.name, metric.service);
    
    if (!model || model.count < this.defaultThresholds.minSamplesRequired) {
      return; // Not enough data for reliable detection
    }

    // Calculate z-score
    const zScore = Math.abs((metric.value - model.mean) / model.stdDev);
    
    // Calculate seasonal adjustment
    const seasonalExpected = this.getSeasonalExpectation(key, new Date(metric.timestamp));
    const seasonalAdjustedValue = metric.value - seasonalExpected;
    const seasonalZScore = Math.abs((seasonalAdjustedValue - model.mean) / model.stdDev);

    // Use the more conservative (lower) z-score
    const finalZScore = Math.min(zScore, seasonalZScore);

    // Determine anomaly severity
    let anomaly: AnomalyDetection | null = null;

    if (finalZScore >= this.defaultThresholds.criticalMultiplier) {
      anomaly = this.createAnomaly(metric, model, 'high', finalZScore, seasonalExpected);
    } else if (finalZScore >= this.defaultThresholds.warningMultiplier) {
      anomaly = this.createAnomaly(metric, model, 'medium', finalZScore, seasonalExpected);
    }

    // Additional checks for specific metric types
    if (!anomaly) {
      anomaly = this.checkBusinessRuleAnomalies(metric, model, baseline);
    }

    if (anomaly) {
      this.recordAnomaly(key, anomaly);
      this.emit('anomaly-detected', { key, anomaly, metric });
    }
  }

  private createAnomaly(
    metric: MetricPoint & { name: string; service?: string },
    model: StatisticalModel,
    severity: 'low' | 'medium' | 'high',
    anomalyScore: number,
    expectedValue: number
  ): AnomalyDetection {
    return {
      id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metric: metric.name,
      service: metric.service,
      detected: true,
      severity,
      confidence: Math.min(anomalyScore / this.defaultThresholds.criticalMultiplier, 1.0),
      anomalyScore,
      expectedValue,
      actualValue: metric.value,
      timestamp: new Date(metric.timestamp),
      context: {
        zScore: anomalyScore,
        modelMean: model.mean,
        modelStdDev: model.stdDev,
        sampleCount: model.count,
        labels: metric.labels
      }
    };
  }

  private checkBusinessRuleAnomalies(
    metric: MetricPoint & { name: string; service?: string },
    model: StatisticalModel,
    baseline?: PerformanceBaseline
  ): AnomalyDetection | null {
    // Business-specific anomaly rules
    switch (metric.name) {
      case 'ai_response_latency_seconds':
        if (metric.value > 2.0) { // More than 2 seconds
          return this.createAnomaly(metric, model, 'high', 3.0, model.mean);
        }
        break;

      case 'call_success_rate':
        if (metric.value < 0.95) { // Less than 95% success rate
          return this.createAnomaly(metric, model, 'high', 2.5, 0.98);
        }
        break;

      case 'cpu_usage_percent':
        if (metric.value > 90) { // CPU usage over 90%
          return this.createAnomaly(metric, model, 'medium', 2.0, 70);
        }
        break;

      case 'memory_usage_percent':
        if (metric.value > 85) { // Memory usage over 85%
          return this.createAnomaly(metric, model, 'medium', 2.0, 65);
        }
        break;

      case 'error_rate':
        if (metric.value > 0.05) { // Error rate over 5%
          return this.createAnomaly(metric, model, 'high', 3.0, 0.01);
        }
        break;
    }

    return null;
  }

  private updateStatisticalModel(key: string, value: number): void {
    const existingModel = this.models.get(key);
    
    if (!existingModel) {
      // Create new model
      this.models.set(key, {
        mean: value,
        stdDev: 0,
        min: value,
        max: value,
        percentiles: {
          p50: value,
          p95: value,
          p99: value
        },
        count: 1,
        lastUpdated: new Date()
      });
      return;
    }

    // Update existing model using exponential moving average
    const alpha = Math.min(1.0 / existingModel.count, 0.1); // Decay factor
    const newCount = existingModel.count + 1;
    const newMean = existingModel.mean + alpha * (value - existingModel.mean);
    
    // Update variance using Welford's online algorithm
    const delta = value - existingModel.mean;
    const delta2 = value - newMean;
    const newVariance = ((existingModel.count - 1) * Math.pow(existingModel.stdDev, 2) + delta * delta2) / (newCount - 1);
    const newStdDev = Math.sqrt(Math.max(newVariance, 0));

    this.models.set(key, {
      mean: newMean,
      stdDev: newStdDev,
      min: Math.min(existingModel.min, value),
      max: Math.max(existingModel.max, value),
      percentiles: this.updatePercentiles(existingModel, value),
      count: newCount,
      lastUpdated: new Date()
    });

    // Update seasonal patterns periodically
    if (newCount % 100 === 0) {
      this.updateSeasonalPatterns(key);
    }
  }

  private updatePercentiles(model: StatisticalModel, newValue: number): {
    p50: number;
    p95: number;
    p99: number;
  } {
    // Simplified percentile update using exponential decay
    const alpha = 0.05;
    
    return {
      p50: model.percentiles.p50 + alpha * (newValue - model.percentiles.p50) * (newValue > model.percentiles.p50 ? 1 : -1),
      p95: model.percentiles.p95 + alpha * (newValue - model.percentiles.p95) * (newValue > model.percentiles.p95 ? 0.05 : -0.95),
      p99: model.percentiles.p99 + alpha * (newValue - model.percentiles.p99) * (newValue > model.percentiles.p99 ? 0.01 : -0.99)
    };
  }

  private updateSeasonalPatterns(key: string): void {
    const buffer = this.learningBuffer.get(key);
    if (!buffer || buffer.length < 168) { // Need at least a week of hourly data
      return;
    }

    // Calculate hourly patterns (24 hours)
    const hourlyBuckets = new Array(24).fill(0).map(() => ({ sum: 0, count: 0 }));
    // Calculate daily patterns (7 days)
    const dailyBuckets = new Array(7).fill(0).map(() => ({ sum: 0, count: 0 }));
    // Calculate weekly patterns (52 weeks)
    const weeklyBuckets = new Array(52).fill(0).map(() => ({ sum: 0, count: 0 }));

    buffer.forEach(point => {
      const date = new Date(point.timestamp);
      
      // Hourly pattern
      const hour = date.getHours();
      hourlyBuckets[hour].sum += point.value;
      hourlyBuckets[hour].count += 1;
      
      // Daily pattern
      const dayOfWeek = date.getDay();
      dailyBuckets[dayOfWeek].sum += point.value;
      dailyBuckets[dayOfWeek].count += 1;
      
      // Weekly pattern
      const weekOfYear = this.getWeekOfYear(date);
      if (weekOfYear < 52) {
        weeklyBuckets[weekOfYear].sum += point.value;
        weeklyBuckets[weekOfYear].count += 1;
      }
    });

    const pattern: SeasonalPattern = {
      hourly: hourlyBuckets.map(bucket => bucket.count > 0 ? bucket.sum / bucket.count : 0),
      daily: dailyBuckets.map(bucket => bucket.count > 0 ? bucket.sum / bucket.count : 0),
      weekly: weeklyBuckets.map(bucket => bucket.count > 0 ? bucket.sum / bucket.count : 0)
    };

    this.seasonalPatterns.set(key, pattern);
  }

  private getSeasonalExpectation(key: string, timestamp: Date): number {
    const pattern = this.seasonalPatterns.get(key);
    if (!pattern) return 0;

    const hour = timestamp.getHours();
    const dayOfWeek = timestamp.getDay();
    const weekOfYear = this.getWeekOfYear(timestamp);

    // Weighted combination of seasonal patterns
    let expectation = 0;
    let weight = 0;

    if (pattern.hourly[hour] > 0) {
      expectation += pattern.hourly[hour] * 0.4;
      weight += 0.4;
    }

    if (pattern.daily[dayOfWeek] > 0) {
      expectation += pattern.daily[dayOfWeek] * 0.4;
      weight += 0.4;
    }

    if (weekOfYear < pattern.weekly.length && pattern.weekly[weekOfYear] > 0) {
      expectation += pattern.weekly[weekOfYear] * 0.2;
      weight += 0.2;
    }

    return weight > 0 ? expectation / weight : 0;
  }

  private getWeekOfYear(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  private recordAnomaly(key: string, anomaly: AnomalyDetection): void {
    if (!this.anomalyHistory.has(key)) {
      this.anomalyHistory.set(key, []);
    }

    const history = this.anomalyHistory.get(key)!;
    history.unshift(anomaly);

    // Keep only recent anomalies (last 1000)
    if (history.length > 1000) {
      history.splice(1000);
    }

    logger.info('Anomaly detected', {
      metric: anomaly.metric,
      service: anomaly.service,
      severity: anomaly.severity,
      confidence: anomaly.confidence,
      actualValue: anomaly.actualValue,
      expectedValue: anomaly.expectedValue,
      anomalyScore: anomaly.anomalyScore
    });
  }

  private handleAnomalyDetection(event: {
    key: string;
    anomaly: AnomalyDetection;
    metric: MetricPoint & { name: string; service?: string };
  }): void {
    // Emit alerts for high-severity anomalies
    if (event.anomaly.severity === 'high') {
      this.emit('create-alert', {
        name: `AnomalyDetection_${event.anomaly.metric}`,
        severity: 'warning',
        description: `Anomaly detected in ${event.anomaly.metric}: actual=${event.anomaly.actualValue}, expected=${event.anomaly.expectedValue}`,
        service: event.anomaly.service,
        details: {
          anomalyId: event.anomaly.id,
          confidence: event.anomaly.confidence,
          anomalyScore: event.anomaly.anomalyScore,
          context: event.anomaly.context
        }
      });
    }
  }

  // Public API methods
  public createBaseline(
    metric: string,
    service?: string,
    threshold?: { warning: number; critical: number }
  ): PerformanceBaseline {
    const model = this.models.get(this.getMetricKey(metric, service));
    
    const baseline: PerformanceBaseline = {
      metric,
      service,
      baseline: model?.mean || 0,
      threshold: threshold || {
        warning: (model?.mean || 0) + 2 * (model?.stdDev || 1),
        critical: (model?.mean || 0) + 3 * (model?.stdDev || 1)
      },
      timeWindow: '1h',
      lastUpdated: new Date(),
      confidence: model && model.count >= this.defaultThresholds.minSamplesRequired ? 
        Math.min(model.count / (this.defaultThresholds.minSamplesRequired * 2), 1.0) : 0.0
    };

    const key = this.getBaselineKey(baseline);
    this.baselines.set(key, baseline);
    
    this.emit('baseline-updated', baseline);
    return baseline;
  }

  public getBaseline(metric: string, service?: string): PerformanceBaseline | undefined {
    const key = this.getBaselineKey({ metric, service } as PerformanceBaseline);
    return this.baselines.get(key);
  }

  public updateBaseline(
    metric: string,
    service: string | undefined,
    newThresholds: { warning: number; critical: number }
  ): boolean {
    const baseline = this.getBaseline(metric, service);
    if (!baseline) return false;

    baseline.threshold = newThresholds;
    baseline.lastUpdated = new Date();

    this.emit('baseline-updated', baseline);
    return true;
  }

  public getRecentAnomalies(
    metric?: string,
    service?: string,
    limit = 50
  ): AnomalyDetection[] {
    const allAnomalies: AnomalyDetection[] = [];
    
    for (const [key, history] of this.anomalyHistory) {
      if (metric && !key.includes(metric)) continue;
      if (service && !key.includes(service)) continue;
      
      allAnomalies.push(...history);
    }

    return allAnomalies
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public getAnomalyById(id: string): AnomalyDetection | null {
    for (const history of this.anomalyHistory.values()) {
      const anomaly = history.find(a => a.id === id);
      if (anomaly) return anomaly;
    }
    return null;
  }

  public getMetricStatistics(metric: string, service?: string): StatisticalModel | null {
    const key = this.getMetricKey(metric, service);
    return this.models.get(key) || null;
  }

  public getSeasonalPattern(metric: string, service?: string): SeasonalPattern | null {
    const key = this.getMetricKey(metric, service);
    return this.seasonalPatterns.get(key) || null;
  }

  // Predict expected value for a given time
  public predictValue(metric: string, service: string | undefined, timestamp: Date): {
    expected: number;
    confidence: number;
    range: { min: number; max: number };
  } {
    const model = this.getMetricStatistics(metric, service);
    if (!model) {
      return { expected: 0, confidence: 0, range: { min: 0, max: 0 } };
    }

    const seasonal = this.getSeasonalExpectation(
      this.getMetricKey(metric, service), 
      timestamp
    );
    
    const expected = model.mean + seasonal;
    const confidence = Math.min(model.count / (this.defaultThresholds.minSamplesRequired * 2), 1.0);
    
    return {
      expected,
      confidence,
      range: {
        min: expected - 2 * model.stdDev,
        max: expected + 2 * model.stdDev
      }
    };
  }

  // Utility methods
  private getMetricKey(metric: string, service?: string, labels?: Record<string, string>): string {
    const serviceStr = service ? `:${service}` : '';
    const labelsStr = labels ? `:${JSON.stringify(labels)}` : '';
    return `${metric}${serviceStr}${labelsStr}`;
  }

  private getBaselineKey(baseline: PerformanceBaseline): string {
    return this.getMetricKey(baseline.metric, baseline.service);
  }

  private startPeriodicTasks(): void {
    // Update baselines every hour
    setInterval(() => {
      this.updateAllBaselines();
    }, 60 * 60 * 1000);

    // Persist models and patterns every 10 minutes
    setInterval(() => {
      this.persistModelsAndPatterns();
    }, 10 * 60 * 1000);

    // Clean up old anomalies every day
    setInterval(() => {
      this.cleanupOldAnomalies();
    }, 24 * 60 * 60 * 1000);
  }

  private async updateAllBaselines(): Promise<void> {
    try {
      for (const [key, baseline] of this.baselines) {
        const model = this.models.get(key);
        if (model && model.count >= this.defaultThresholds.minSamplesRequired) {
          baseline.baseline = model.mean;
          baseline.threshold = {
            warning: model.mean + 2 * model.stdDev,
            critical: model.mean + 3 * model.stdDev
          };
          baseline.lastUpdated = new Date();
          baseline.confidence = Math.min(model.count / (this.defaultThresholds.minSamplesRequired * 2), 1.0);
          
          this.emit('baseline-updated', baseline);
        }
      }

      logger.debug('Updated all baselines', {
        count: this.baselines.size
      });
    } catch (error) {
      logger.error('Failed to update baselines', { error });
    }
  }

  private async persistModelsAndPatterns(): Promise<void> {
    try {
      // Persist baselines
      const baselineArray = Array.from(this.baselines.values());
      await this.redis.setex('anomaly:baselines', 3600, JSON.stringify(baselineArray));

      // Persist models
      const modelsObj: Record<string, any> = {};
      for (const [key, model] of this.models) {
        modelsObj[key] = {
          ...model,
          lastUpdated: model.lastUpdated.toISOString()
        };
      }
      await this.redis.setex('anomaly:models', 3600, JSON.stringify(modelsObj));

      // Persist seasonal patterns
      const patternsObj: Record<string, SeasonalPattern> = {};
      for (const [key, pattern] of this.seasonalPatterns) {
        patternsObj[key] = pattern;
      }
      await this.redis.setex('anomaly:patterns', 3600, JSON.stringify(patternsObj));

      logger.debug('Persisted anomaly detection data', {
        baselines: baselineArray.length,
        models: Object.keys(modelsObj).length,
        patterns: Object.keys(patternsObj).length
      });
    } catch (error) {
      logger.error('Failed to persist anomaly detection data', { error });
    }
  }

  private cleanupOldAnomalies(): void {
    try {
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      for (const [key, history] of this.anomalyHistory) {
        const filteredHistory = history.filter(anomaly => anomaly.timestamp >= cutoffDate);
        this.anomalyHistory.set(key, filteredHistory);
      }

      logger.debug('Cleaned up old anomalies');
    } catch (error) {
      logger.error('Failed to cleanup old anomalies', { error });
    }
  }

  public getAnomalyStatistics(): {
    totalAnomalies: number;
    severityBreakdown: Record<string, number>;
    recentTrend: number;
    topMetrics: Array<{ metric: string; count: number }>;
  } {
    const allAnomalies = this.getRecentAnomalies(undefined, undefined, 10000);
    const recentAnomalies = allAnomalies.filter(a => 
      a.timestamp >= new Date(Date.now() - 24 * 60 * 60 * 1000)
    );

    const severityBreakdown = allAnomalies.reduce((acc, anomaly) => {
      acc[anomaly.severity] = (acc[anomaly.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const metricCounts = allAnomalies.reduce((acc, anomaly) => {
      const key = anomaly.service ? `${anomaly.metric}:${anomaly.service}` : anomaly.metric;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topMetrics = Object.entries(metricCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([metric, count]) => ({ metric, count }));

    const previousDayAnomalies = allAnomalies.filter(a =>
      a.timestamp >= new Date(Date.now() - 48 * 60 * 60 * 1000) &&
      a.timestamp < new Date(Date.now() - 24 * 60 * 60 * 1000)
    ).length;

    const trend = previousDayAnomalies > 0 ? 
      (recentAnomalies.length - previousDayAnomalies) / previousDayAnomalies : 0;

    return {
      totalAnomalies: allAnomalies.length,
      severityBreakdown,
      recentTrend: trend,
      topMetrics
    };
  }
}