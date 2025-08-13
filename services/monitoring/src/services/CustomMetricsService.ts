import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';
import { PrometheusExporter } from '../exporters/PrometheusExporter';
import { logger } from '@shared/utils/logger';
import { performance } from 'perf_hooks';

export interface MetricDefinition {
  id: string;
  name: string;
  type: 'gauge' | 'counter' | 'histogram' | 'summary';
  description: string;
  unit?: string;
  labels?: string[];
  aggregationRules?: AggregationRule[];
  retentionPeriod?: string; // e.g., "7d", "30d", "1y"
  sampleInterval?: number; // seconds
}

export interface AggregationRule {
  id: string;
  name: string;
  sourceMetric: string;
  aggregationType: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'rate' | 'increase' | 'percentile';
  timeWindow: string; // e.g., "5m", "1h", "1d"
  groupBy?: string[]; // label names to group by
  percentile?: number; // for percentile aggregation (0-100)
  filters?: MetricFilter[];
  schedule?: string; // cron expression for periodic aggregation
}

export interface MetricFilter {
  label: string;
  operator: 'eq' | 'ne' | 'regex' | 'not_regex';
  value: string;
}

export interface CustomMetricValue {
  metricId: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: Date;
}

export interface AggregatedMetric {
  ruleId: string;
  metricName: string;
  value: number;
  labels: Record<string, string>;
  aggregationType: string;
  timeWindow: string;
  timestamp: Date;
  sampleCount: number;
}

export class CustomMetricsService extends EventEmitter {
  private metricDefinitions = new Map<string, MetricDefinition>();
  private aggregationRules = new Map<string, AggregationRule>();
  private aggregatedMetrics = new Map<string, AggregatedMetric[]>();
  private metricsBuffer = new Map<string, CustomMetricValue[]>();
  private aggregationJobs = new Map<string, NodeJS.Timeout>();
  
  constructor(
    private metricsCollector: MetricsCollector,
    private prometheusExporter: PrometheusExporter
  ) {
    super();
    this.initializeBuiltInMetrics();
    this.startPeriodicAggregation();
  }

  private initializeBuiltInMetrics() {
    // Define built-in business metrics
    const builtInMetrics: MetricDefinition[] = [
      {
        id: 'call-success-rate',
        name: 'call_success_rate',
        type: 'gauge',
        description: '通话成功率百分比',
        unit: 'percent',
        labels: ['service', 'call_type'],
        aggregationRules: [{
          id: 'hourly-success-rate',
          name: 'hourly_call_success_rate',
          sourceMetric: 'ai_phone_calls_total',
          aggregationType: 'sum',
          timeWindow: '1h',
          groupBy: ['service', 'call_type', 'status'],
          schedule: '0 * * * *' // every hour
        }],
        retentionPeriod: '30d',
        sampleInterval: 300 // 5 minutes
      },

      {
        id: 'ai-response-quality',
        name: 'ai_response_quality_score',
        type: 'gauge',
        description: 'AI响应质量评分',
        unit: 'score',
        labels: ['service', 'intent', 'model_version'],
        aggregationRules: [{
          id: 'daily-quality-avg',
          name: 'daily_ai_quality_average',
          sourceMetric: 'ai_response_quality_score',
          aggregationType: 'avg',
          timeWindow: '1d',
          groupBy: ['service', 'intent'],
          schedule: '0 0 * * *' // daily at midnight
        }],
        retentionPeriod: '90d',
        sampleInterval: 60 // 1 minute
      },

      {
        id: 'user-satisfaction',
        name: 'user_satisfaction_score',
        type: 'histogram',
        description: '用户满意度评分分布',
        unit: 'score',
        labels: ['service', 'interaction_type'],
        aggregationRules: [{
          id: 'satisfaction-percentiles',
          name: 'user_satisfaction_percentiles',
          sourceMetric: 'user_satisfaction_score',
          aggregationType: 'percentile',
          percentile: 95,
          timeWindow: '1h',
          groupBy: ['service'],
          schedule: '*/15 * * * *' // every 15 minutes
        }],
        retentionPeriod: '180d'
      },

      {
        id: 'cost-per-call',
        name: 'cost_per_call',
        type: 'gauge',
        description: '每通电话成本',
        unit: 'currency',
        labels: ['service', 'region', 'call_type'],
        aggregationRules: [{
          id: 'monthly-cost-sum',
          name: 'monthly_total_cost',
          sourceMetric: 'cost_per_call',
          aggregationType: 'sum',
          timeWindow: '30d',
          groupBy: ['service', 'region'],
          schedule: '0 0 1 * *' // monthly on 1st day
        }],
        retentionPeriod: '1y'
      },

      {
        id: 'spam-confidence',
        name: 'spam_detection_confidence',
        type: 'histogram',
        description: '骚扰电话检测置信度分布',
        unit: 'confidence',
        labels: ['service', 'spam_category', 'detection_method'],
        aggregationRules: [{
          id: 'confidence-distribution',
          name: 'spam_confidence_buckets',
          sourceMetric: 'spam_detection_confidence',
          aggregationType: 'count',
          timeWindow: '6h',
          groupBy: ['spam_category'],
          schedule: '0 */6 * * *' // every 6 hours
        }],
        retentionPeriod: '60d'
      },

      {
        id: 'system-efficiency',
        name: 'system_efficiency_ratio',
        type: 'gauge',
        description: '系统效率比（处理量/资源消耗）',
        unit: 'ratio',
        labels: ['service', 'instance'],
        aggregationRules: [{
          id: 'efficiency-trend',
          name: 'efficiency_daily_trend',
          sourceMetric: 'system_efficiency_ratio',
          aggregationType: 'avg',
          timeWindow: '1d',
          groupBy: ['service'],
          schedule: '0 1 * * *' // daily at 1 AM
        }],
        retentionPeriod: '365d'
      }
    ];

    builtInMetrics.forEach(metric => {
      this.registerMetric(metric);
    });

    logger.info(`Initialized ${builtInMetrics.length} built-in custom metrics`);
  }

  public registerMetric(definition: MetricDefinition): void {
    // Validate metric definition
    this.validateMetricDefinition(definition);

    // Register with Prometheus exporter
    this.prometheusExporter.createCustomMetric({
      name: definition.name,
      help: definition.description,
      type: definition.type,
      labelNames: definition.labels
    });

    // Store definition
    this.metricDefinitions.set(definition.id, definition);

    // Register aggregation rules
    if (definition.aggregationRules) {
      definition.aggregationRules.forEach(rule => {
        this.registerAggregationRule(rule);
      });
    }

    // Initialize buffer
    this.metricsBuffer.set(definition.id, []);

    logger.info(`Registered custom metric: ${definition.name}`);
    this.emit('metric-registered', definition);
  }

  private validateMetricDefinition(definition: MetricDefinition): void {
    if (!definition.id || !definition.name) {
      throw new Error('Metric ID and name are required');
    }

    if (!['gauge', 'counter', 'histogram', 'summary'].includes(definition.type)) {
      throw new Error(`Invalid metric type: ${definition.type}`);
    }

    if (this.metricDefinitions.has(definition.id)) {
      throw new Error(`Metric with ID ${definition.id} already exists`);
    }
  }

  public registerAggregationRule(rule: AggregationRule): void {
    this.validateAggregationRule(rule);
    this.aggregationRules.set(rule.id, rule);

    // Schedule periodic aggregation if specified
    if (rule.schedule) {
      this.scheduleAggregation(rule);
    }

    logger.info(`Registered aggregation rule: ${rule.name}`);
    this.emit('aggregation-rule-registered', rule);
  }

  private validateAggregationRule(rule: AggregationRule): void {
    if (!rule.id || !rule.name || !rule.sourceMetric) {
      throw new Error('Rule ID, name, and source metric are required');
    }

    const validAggregations = ['sum', 'avg', 'min', 'max', 'count', 'rate', 'increase', 'percentile'];
    if (!validAggregations.includes(rule.aggregationType)) {
      throw new Error(`Invalid aggregation type: ${rule.aggregationType}`);
    }

    if (rule.aggregationType === 'percentile' && (rule.percentile === undefined || rule.percentile < 0 || rule.percentile > 100)) {
      throw new Error('Percentile aggregation requires a valid percentile value (0-100)');
    }
  }

  private scheduleAggregation(rule: AggregationRule): void {
    // This is a simplified scheduler - in production, use node-cron
    const interval = this.parseTimeWindow(rule.timeWindow) * 1000;
    
    const job = setInterval(async () => {
      try {
        await this.executeAggregation(rule);
      } catch (error) {
        logger.error(`Error executing aggregation rule ${rule.id}:`, error);
      }
    }, interval);

    this.aggregationJobs.set(rule.id, job);
    logger.info(`Scheduled aggregation rule: ${rule.name} (${rule.timeWindow})`);
  }

  private parseTimeWindow(timeWindow: string): number {
    const match = timeWindow.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid time window format: ${timeWindow}`);

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: throw new Error(`Unknown time unit: ${unit}`);
    }
  }

  public async recordMetric(metricValue: CustomMetricValue): Promise<void> {
    const definition = this.metricDefinitions.get(metricValue.metricId);
    if (!definition) {
      throw new Error(`Unknown metric ID: ${metricValue.metricId}`);
    }

    // Add timestamp if not provided
    if (!metricValue.timestamp) {
      metricValue.timestamp = new Date();
    }

    // Buffer the metric value
    const buffer = this.metricsBuffer.get(metricValue.metricId) || [];
    buffer.push(metricValue);
    this.metricsBuffer.set(metricValue.metricId, buffer);

    // Record to main metrics collector
    await this.metricsCollector.recordMetric({
      service: 'custom-metrics',
      metric: definition.name,
      value: metricValue.value,
      tags: metricValue.labels,
      timestamp: metricValue.timestamp
    });

    // Update Prometheus metric
    const prometheusMetric = this.prometheusExporter.getCustomMetric(definition.name);
    if (prometheusMetric) {
      switch (definition.type) {
        case 'gauge':
          prometheusMetric.set(metricValue.labels || {}, metricValue.value);
          break;
        case 'counter':
          prometheusMetric.inc(metricValue.labels || {}, metricValue.value);
          break;
        case 'histogram':
        case 'summary':
          prometheusMetric.observe(metricValue.labels || {}, metricValue.value);
          break;
      }
    }

    this.emit('metric-recorded', metricValue, definition);
  }

  private startPeriodicAggregation(): void {
    // Execute immediate aggregations every 5 minutes
    setInterval(async () => {
      await this.executeImmediateAggregations();
    }, 5 * 60 * 1000);

    logger.info('Started periodic aggregation process');
  }

  private async executeImmediateAggregations(): Promise<void> {
    const rules = Array.from(this.aggregationRules.values())
      .filter(rule => !rule.schedule); // Only immediate rules

    for (const rule of rules) {
      try {
        await this.executeAggregation(rule);
      } catch (error) {
        logger.error(`Error in immediate aggregation for rule ${rule.id}:`, error);
      }
    }
  }

  private async executeAggregation(rule: AggregationRule): Promise<void> {
    const startTime = performance.now();
    
    try {
      // Get source metric data
      const sourceData = await this.getSourceMetricData(rule);
      if (sourceData.length === 0) {
        logger.debug(`No data available for aggregation rule: ${rule.name}`);
        return;
      }

      // Apply filters
      const filteredData = this.applyFilters(sourceData, rule.filters || []);

      // Group data if required
      const groupedData = this.groupData(filteredData, rule.groupBy || []);

      // Execute aggregation
      const aggregatedResults: AggregatedMetric[] = [];
      
      for (const [groupKey, groupData] of Object.entries(groupedData)) {
        const aggregatedValue = this.calculateAggregation(groupData, rule.aggregationType, rule.percentile);
        const labels = this.parseGroupKey(groupKey, rule.groupBy || []);

        aggregatedResults.push({
          ruleId: rule.id,
          metricName: rule.name,
          value: aggregatedValue,
          labels,
          aggregationType: rule.aggregationType,
          timeWindow: rule.timeWindow,
          timestamp: new Date(),
          sampleCount: groupData.length
        });
      }

      // Store aggregated results
      this.aggregatedMetrics.set(rule.id, aggregatedResults);

      // Record aggregation metrics
      await this.recordAggregationMetrics(rule, aggregatedResults);

      const duration = performance.now() - startTime;
      logger.debug(`Completed aggregation rule ${rule.name} in ${duration.toFixed(2)}ms`);
      
      this.emit('aggregation-completed', rule, aggregatedResults);
    } catch (error) {
      logger.error(`Error executing aggregation rule ${rule.name}:`, error);
      this.emit('aggregation-error', rule, error);
    }
  }

  private async getSourceMetricData(rule: AggregationRule): Promise<any[]> {
    // Get data from metrics collector based on time window
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - this.parseTimeWindow(rule.timeWindow) * 1000);

    return await this.metricsCollector.getMetrics({
      metric: rule.sourceMetric,
      startTime,
      endTime
    });
  }

  private applyFilters(data: any[], filters: MetricFilter[]): any[] {
    return data.filter(item => {
      return filters.every(filter => {
        const labelValue = item.tags?.[filter.label];
        if (labelValue === undefined) return false;

        switch (filter.operator) {
          case 'eq':
            return labelValue === filter.value;
          case 'ne':
            return labelValue !== filter.value;
          case 'regex':
            return new RegExp(filter.value).test(labelValue);
          case 'not_regex':
            return !new RegExp(filter.value).test(labelValue);
          default:
            return false;
        }
      });
    });
  }

  private groupData(data: any[], groupBy: string[]): Record<string, any[]> {
    if (groupBy.length === 0) {
      return { 'all': data };
    }

    return data.reduce((groups, item) => {
      const groupKey = groupBy.map(label => `${label}:${item.tags?.[label] || 'unknown'}`).join('|');
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(item);
      return groups;
    }, {} as Record<string, any[]>);
  }

  private parseGroupKey(groupKey: string, groupBy: string[]): Record<string, string> {
    if (groupKey === 'all') return {};

    const labels: Record<string, string> = {};
    const pairs = groupKey.split('|');
    
    pairs.forEach((pair, index) => {
      const [, value] = pair.split(':');
      if (groupBy[index]) {
        labels[groupBy[index]] = value;
      }
    });

    return labels;
  }

  private calculateAggregation(data: any[], type: string, percentile?: number): number {
    const values = data.map(item => item.value).filter(v => typeof v === 'number');
    if (values.length === 0) return 0;

    switch (type) {
      case 'sum':
        return values.reduce((sum, val) => sum + val, 0);
      case 'avg':
        return values.reduce((sum, val) => sum + val, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      case 'rate':
        // Calculate rate per second
        const timeSpan = data.length > 1 
          ? (data[data.length - 1].timestamp.getTime() - data[0].timestamp.getTime()) / 1000 
          : 1;
        return values.reduce((sum, val) => sum + val, 0) / timeSpan;
      case 'increase':
        return values.reduce((sum, val) => sum + val, 0);
      case 'percentile':
        if (percentile === undefined) return 0;
        const sorted = values.sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
      default:
        return 0;
    }
  }

  private async recordAggregationMetrics(rule: AggregationRule, results: AggregatedMetric[]): Promise<void> {
    for (const result of results) {
      // Record aggregated metric value
      await this.metricsCollector.recordMetric({
        service: 'aggregation',
        metric: result.metricName,
        value: result.value,
        tags: {
          ...result.labels,
          aggregation_type: result.aggregationType,
          time_window: result.timeWindow,
          rule_id: result.ruleId
        },
        timestamp: result.timestamp
      });

      // Update Prometheus if the aggregated metric is registered
      const prometheusMetric = this.prometheusExporter.getCustomMetric(result.metricName);
      if (prometheusMetric) {
        prometheusMetric.set(result.labels, result.value);
      }
    }
  }

  // Public API methods
  public getMetricDefinitions(): MetricDefinition[] {
    return Array.from(this.metricDefinitions.values());
  }

  public getAggregationRules(): AggregationRule[] {
    return Array.from(this.aggregationRules.values());
  }

  public getAggregatedMetrics(ruleId?: string): AggregatedMetric[] {
    if (ruleId) {
      return this.aggregatedMetrics.get(ruleId) || [];
    }

    const allMetrics: AggregatedMetric[] = [];
    this.aggregatedMetrics.forEach(metrics => allMetrics.push(...metrics));
    return allMetrics;
  }

  public async deleteMetric(metricId: string): Promise<boolean> {
    const definition = this.metricDefinitions.get(metricId);
    if (!definition) return false;

    // Stop aggregation jobs for this metric
    if (definition.aggregationRules) {
      definition.aggregationRules.forEach(rule => {
        const job = this.aggregationJobs.get(rule.id);
        if (job) {
          clearInterval(job);
          this.aggregationJobs.delete(rule.id);
        }
      });
    }

    // Clean up
    this.metricDefinitions.delete(metricId);
    this.metricsBuffer.delete(metricId);

    logger.info(`Deleted custom metric: ${definition.name}`);
    this.emit('metric-deleted', definition);
    return true;
  }

  public async deleteAggregationRule(ruleId: string): Promise<boolean> {
    const rule = this.aggregationRules.get(ruleId);
    if (!rule) return false;

    // Stop scheduled job
    const job = this.aggregationJobs.get(ruleId);
    if (job) {
      clearInterval(job);
      this.aggregationJobs.delete(ruleId);
    }

    // Clean up
    this.aggregationRules.delete(ruleId);
    this.aggregatedMetrics.delete(ruleId);

    logger.info(`Deleted aggregation rule: ${rule.name}`);
    this.emit('aggregation-rule-deleted', rule);
    return true;
  }

  public getMetricsBuffer(metricId?: string): Map<string, CustomMetricValue[]> | CustomMetricValue[] | undefined {
    if (metricId) {
      return this.metricsBuffer.get(metricId);
    }
    return this.metricsBuffer;
  }

  public clearMetricsBuffer(metricId?: string): void {
    if (metricId) {
      this.metricsBuffer.set(metricId, []);
    } else {
      this.metricsBuffer.clear();
    }
  }

  // Health and status
  public getStatus() {
    return {
      registeredMetrics: this.metricDefinitions.size,
      aggregationRules: this.aggregationRules.size,
      activeJobs: this.aggregationJobs.size,
      bufferedMetrics: Array.from(this.metricsBuffer.values()).reduce((sum, buffer) => sum + buffer.length, 0),
      aggregatedResults: Array.from(this.aggregatedMetrics.values()).reduce((sum, results) => sum + results.length, 0)
    };
  }

  // Cleanup
  public destroy(): void {
    // Clear all scheduled jobs
    this.aggregationJobs.forEach(job => clearInterval(job));
    this.aggregationJobs.clear();

    // Clear all data
    this.metricDefinitions.clear();
    this.aggregationRules.clear();
    this.aggregatedMetrics.clear();
    this.metricsBuffer.clear();

    // Remove all listeners
    this.removeAllListeners();

    logger.info('CustomMetricsService destroyed');
  }
}