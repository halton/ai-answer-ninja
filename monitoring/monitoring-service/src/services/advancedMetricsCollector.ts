import { EventEmitter } from 'events';
import * as client from 'prom-client';
import { Logger } from '../utils/logger';
import { RedisClient } from '../utils/redis';
import { DatabaseClient } from '../utils/database';
import { AnomalyDetectionService } from './anomalyDetectionService';
import { PerformanceBaselineService } from './performanceBaselineService';

interface MetricCollection {
  timestamp: number;
  metrics: {
    [key: string]: {
      value: number;
      labels?: Record<string, string>;
      metadata?: Record<string, any>;
    };
  };
}

interface AlertContext {
  metric: string;
  value: number;
  threshold: number;
  severity: 'info' | 'warning' | 'critical';
  anomalyScore?: number;
  trend?: 'increasing' | 'decreasing' | 'stable';
}

export class AdvancedMetricsCollector extends EventEmitter {
  private logger: Logger;
  private redis: RedisClient;
  private database: DatabaseClient;
  private anomalyDetector: AnomalyDetectionService;
  private baselineService: PerformanceBaselineService;
  private collectInterval: NodeJS.Timeout | null = null;
  private metricHistory: Map<string, number[]> = new Map();
  private registry: client.Registry;
  
  // Prometheus metrics
  private customMetrics: Map<string, client.Gauge | client.Counter | client.Histogram> = new Map();
  
  constructor() {
    super();
    this.logger = new Logger('AdvancedMetricsCollector');
    this.redis = new RedisClient();
    this.database = new DatabaseClient();
    this.anomalyDetector = new AnomalyDetectionService();
    this.baselineService = new PerformanceBaselineService();
    this.registry = new client.Registry();
    
    this.initializeCustomMetrics();
  }
  
  private initializeCustomMetrics(): void {
    // Business metrics
    this.registerGauge('ai_ninja_calls_active', 'Number of active calls');
    this.registerGauge('ai_ninja_calls_total', 'Total number of calls');
    this.registerGauge('ai_ninja_calls_successful', 'Number of successful calls');
    this.registerGauge('ai_ninja_spam_blocked_total', 'Number of spam calls blocked');
    this.registerGauge('ai_ninja_caller_satisfaction_score', 'Average caller satisfaction score');
    this.registerGauge('ai_ninja_queue_length', 'Current call queue length');
    
    // AI performance metrics
    this.registerHistogram('ai_response_latency_seconds', 'AI response latency in seconds');
    this.registerHistogram('ai_component_latency_seconds', 'AI component latency breakdown', ['component']);
    this.registerGauge('ai_ninja_stt_accuracy_rate', 'Speech-to-text accuracy rate');
    this.registerGauge('ai_ninja_tts_quality_score', 'Text-to-speech quality score');
    this.registerGauge('ai_ninja_spam_detection_accuracy', 'Spam detection accuracy');
    this.registerGauge('ai_ninja_false_positive_rate', 'False positive rate for spam detection');
    this.registerGauge('ai_ninja_conversation_turns', 'Average conversation turns');
    
    // System health metrics
    this.registerGauge('ai_ninja_system_health_score', 'Overall system health score');
    this.registerGauge('ai_ninja_azure_service_health', 'Azure services health status');
    this.registerGauge('ai_ninja_maintenance_mode', 'Maintenance mode indicator');
    this.registerGauge('ai_ninja_load_test_active', 'Load test active indicator');
    
    // Resource efficiency metrics
    this.registerGauge('ai_ninja_monthly_cost_dollars', 'Monthly operational cost in dollars');
    this.registerGauge('ai_ninja_cost_per_call', 'Cost per successful call');
    this.registerGauge('ai_ninja_resource_efficiency_score', 'Resource utilization efficiency score');
    
    // User metrics
    this.registerCounter('ai_ninja_new_users_total', 'Total new user registrations');
    this.registerGauge('ai_ninja_user_retention_7day', '7-day user retention rate');
    this.registerCounter('ai_ninja_support_tickets_total', 'Total support tickets');
  }
  
  private registerGauge(name: string, help: string, labelNames?: string[]): void {
    const gauge = new client.Gauge({
      name,
      help,
      labelNames,
      registers: [this.registry]
    });
    this.customMetrics.set(name, gauge);
  }
  
  private registerCounter(name: string, help: string, labelNames?: string[]): void {
    const counter = new client.Counter({
      name,
      help,
      labelNames,
      registers: [this.registry]
    });
    this.customMetrics.set(name, counter);
  }
  
  private registerHistogram(name: string, help: string, labelNames?: string[]): void {
    const histogram = new client.Histogram({
      name,
      help,
      labelNames,
      buckets: [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10],
      registers: [this.registry]
    });
    this.customMetrics.set(name, histogram);
  }
  
  async startCollection(intervalMs: number = 15000): Promise<void> {
    this.logger.info('Starting advanced metrics collection', { intervalMs });
    
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
    }
    
    // Initial collection
    await this.collectMetrics();
    
    // Set up regular collection
    this.collectInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        this.logger.error('Error in metrics collection cycle', { error });
      }
    }, intervalMs);
    
    this.logger.info('Advanced metrics collection started successfully');
  }
  
  async stopCollection(): Promise<void> {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }
    
    await this.redis.disconnect();
    await this.database.disconnect();
    
    this.logger.info('Advanced metrics collection stopped');
  }
  
  private async collectMetrics(): Promise<void> {
    const startTime = Date.now();
    const collection: MetricCollection = {
      timestamp: startTime,
      metrics: {}
    };
    
    try {
      // Collect business metrics
      await this.collectBusinessMetrics(collection);
      
      // Collect AI performance metrics
      await this.collectAIPerformanceMetrics(collection);
      
      // Collect system health metrics
      await this.collectSystemHealthMetrics(collection);
      
      // Collect resource efficiency metrics
      await this.collectResourceEfficiencyMetrics(collection);
      
      // Collect user metrics
      await this.collectUserMetrics(collection);
      
      // Update Prometheus metrics
      await this.updatePrometheusMetrics(collection);
      
      // Perform anomaly detection
      await this.performAnomalyDetection(collection);
      
      // Store historical data
      await this.storeHistoricalData(collection);
      
      // Emit collection event
      this.emit('metricsCollected', collection);
      
      const duration = Date.now() - startTime;
      this.logger.debug('Metrics collection completed', { 
        duration: `${duration}ms`,
        metricCount: Object.keys(collection.metrics).length
      });
      
    } catch (error) {
      this.logger.error('Error collecting metrics', { error });
      throw error;
    }
  }
  
  private async collectBusinessMetrics(collection: MetricCollection): Promise<void> {
    try {
      // Active calls from Redis
      const activeCalls = await this.redis.get('ai_ninja:active_calls') || '0';
      collection.metrics['ai_ninja_calls_active'] = { value: parseInt(activeCalls) };
      
      // Call statistics from database
      const callStats = await this.database.query(`
        SELECT 
          COUNT(*) as total_calls,
          COUNT(CASE WHEN call_status = 'successful' THEN 1 END) as successful_calls,
          COUNT(CASE WHEN call_type = 'spam_blocked' THEN 1 END) as spam_blocked,
          AVG(CASE WHEN caller_satisfaction_score IS NOT NULL THEN caller_satisfaction_score END) as avg_satisfaction,
          AVG(duration_seconds) as avg_duration
        FROM call_records 
        WHERE start_time >= NOW() - INTERVAL '1 hour'
      `);
      
      if (callStats.rows.length > 0) {
        const stats = callStats.rows[0];
        collection.metrics['ai_ninja_calls_total'] = { value: parseInt(stats.total_calls) || 0 };
        collection.metrics['ai_ninja_calls_successful'] = { value: parseInt(stats.successful_calls) || 0 };
        collection.metrics['ai_ninja_spam_blocked_total'] = { value: parseInt(stats.spam_blocked) || 0 };
        collection.metrics['ai_ninja_caller_satisfaction_score'] = { value: parseFloat(stats.avg_satisfaction) || 0 };
      }
      
      // Queue length from Redis
      const queueLength = await this.redis.llen('ai_ninja:call_queue') || 0;
      collection.metrics['ai_ninja_queue_length'] = { value: queueLength };
      
    } catch (error) {
      this.logger.error('Error collecting business metrics', { error });
      throw error;
    }
  }
  
  private async collectAIPerformanceMetrics(collection: MetricCollection): Promise<void> {
    try {
      // AI performance data from Redis cache
      const aiMetrics = await this.redis.hgetall('ai_ninja:ai_performance');
      
      if (aiMetrics) {
        collection.metrics['ai_ninja_stt_accuracy_rate'] = { 
          value: parseFloat(aiMetrics.stt_accuracy || '0.95') 
        };
        collection.metrics['ai_ninja_tts_quality_score'] = { 
          value: parseFloat(aiMetrics.tts_quality || '0.90') 
        };
        collection.metrics['ai_ninja_spam_detection_accuracy'] = { 
          value: parseFloat(aiMetrics.spam_accuracy || '0.88') 
        };
        collection.metrics['ai_ninja_false_positive_rate'] = { 
          value: parseFloat(aiMetrics.false_positive_rate || '0.02') 
        };
      }
      
      // Recent AI latency from database
      const latencyStats = await this.database.query(`
        SELECT 
          AVG(EXTRACT(EPOCH FROM (end_time - start_time))) as avg_response_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (end_time - start_time))) as p95_response_time
        FROM call_records 
        WHERE start_time >= NOW() - INTERVAL '5 minutes'
        AND end_time IS NOT NULL
      `);
      
      if (latencyStats.rows.length > 0 && latencyStats.rows[0].avg_response_time) {
        const responseTime = parseFloat(latencyStats.rows[0].avg_response_time);
        collection.metrics['ai_response_latency_avg'] = { value: responseTime };
      }
      
      // Conversation analysis
      const conversationStats = await this.database.query(`
        SELECT AVG(turn_count) as avg_turns
        FROM (
          SELECT call_record_id, COUNT(*) as turn_count
          FROM conversations
          WHERE timestamp >= NOW() - INTERVAL '30 minutes'
          GROUP BY call_record_id
        ) subq
      `);
      
      if (conversationStats.rows.length > 0 && conversationStats.rows[0].avg_turns) {
        collection.metrics['ai_ninja_conversation_turns'] = { 
          value: parseFloat(conversationStats.rows[0].avg_turns) 
        };
      }
      
    } catch (error) {
      this.logger.error('Error collecting AI performance metrics', { error });
      throw error;
    }
  }
  
  private async collectSystemHealthMetrics(collection: MetricCollection): Promise<void> {
    try {
      // Calculate overall system health score
      const healthFactors = {
        serviceAvailability: await this.calculateServiceAvailability(),
        responsePerformance: await this.calculateResponsePerformance(), 
        callSuccessRate: await this.calculateCallSuccessRate(),
        errorRate: await this.calculateErrorRate()
      };
      
      // Weighted health score calculation
      const healthScore = (
        healthFactors.serviceAvailability * 0.4 +
        healthFactors.responsePerformance * 0.3 +
        healthFactors.callSuccessRate * 0.2 +
        healthFactors.errorRate * 0.1
      ) * 100;
      
      collection.metrics['ai_ninja_system_health_score'] = { 
        value: Math.round(healthScore * 100) / 100,
        metadata: healthFactors
      };
      
      // Azure services health (simulated check)
      const azureHealth = await this.checkAzureServicesHealth();
      collection.metrics['ai_ninja_azure_service_health'] = { value: azureHealth ? 1 : 0 };
      
      // Maintenance mode and load testing flags
      const maintenanceMode = await this.redis.get('ai_ninja:maintenance_mode') === '1';
      const loadTestActive = await this.redis.get('ai_ninja:load_test_active') === '1';
      
      collection.metrics['ai_ninja_maintenance_mode'] = { value: maintenanceMode ? 1 : 0 };
      collection.metrics['ai_ninja_load_test_active'] = { value: loadTestActive ? 1 : 0 };
      
    } catch (error) {
      this.logger.error('Error collecting system health metrics', { error });
      throw error;
    }
  }
  
  private async collectResourceEfficiencyMetrics(collection: MetricCollection): Promise<void> {
    try {
      // Monthly cost estimation (from configuration or external system)
      const monthlyCost = parseFloat(process.env.AI_NINJA_MONTHLY_COST || '150');
      collection.metrics['ai_ninja_monthly_cost_dollars'] = { value: monthlyCost };
      
      // Calculate cost per call
      const callsThisMonth = await this.database.query(`
        SELECT COUNT(*) as call_count
        FROM call_records 
        WHERE start_time >= DATE_TRUNC('month', NOW())
        AND call_status = 'successful'
      `);
      
      if (callsThisMonth.rows.length > 0) {
        const callCount = parseInt(callsThisMonth.rows[0].call_count) || 1;
        const costPerCall = monthlyCost / callCount;
        collection.metrics['ai_ninja_cost_per_call'] = { value: Math.round(costPerCall * 10000) / 10000 };
      }
      
      // Resource efficiency score (placeholder calculation)
      const efficiency = await this.calculateResourceEfficiency();
      collection.metrics['ai_ninja_resource_efficiency_score'] = { value: efficiency };
      
    } catch (error) {
      this.logger.error('Error collecting resource efficiency metrics', { error });
      throw error;
    }
  }
  
  private async collectUserMetrics(collection: MetricCollection): Promise<void> {
    try {
      // New users today
      const newUsers = await this.database.query(`
        SELECT COUNT(*) as new_user_count
        FROM users 
        WHERE created_at >= CURRENT_DATE
      `);
      
      if (newUsers.rows.length > 0) {
        collection.metrics['ai_ninja_new_users_today'] = { 
          value: parseInt(newUsers.rows[0].new_user_count) || 0 
        };
      }
      
      // 7-day retention rate
      const retentionStats = await this.database.query(`
        SELECT 
          (COUNT(DISTINCT active_users.user_id)::float / 
           COUNT(DISTINCT new_users.id)::float) as retention_rate
        FROM users new_users
        LEFT JOIN call_records active_users ON new_users.id = active_users.user_id
          AND active_users.start_time >= new_users.created_at + INTERVAL '7 days'
          AND active_users.start_time < new_users.created_at + INTERVAL '14 days'
        WHERE new_users.created_at >= NOW() - INTERVAL '21 days'
        AND new_users.created_at <= NOW() - INTERVAL '14 days'
      `);
      
      if (retentionStats.rows.length > 0 && retentionStats.rows[0].retention_rate !== null) {
        collection.metrics['ai_ninja_user_retention_7day'] = { 
          value: parseFloat(retentionStats.rows[0].retention_rate) 
        };
      }
      
    } catch (error) {
      this.logger.error('Error collecting user metrics', { error });
      throw error;
    }
  }
  
  private async updatePrometheusMetrics(collection: MetricCollection): Promise<void> {
    try {
      for (const [metricName, metricData] of Object.entries(collection.metrics)) {
        const prometheusMetric = this.customMetrics.get(metricName);
        
        if (prometheusMetric) {
          if (prometheusMetric instanceof client.Gauge) {
            if (metricData.labels) {
              prometheusMetric.set(metricData.labels, metricData.value);
            } else {
              prometheusMetric.set(metricData.value);
            }
          } else if (prometheusMetric instanceof client.Counter) {
            // For counters, we need to track the delta
            const previousValue = await this.getPreviousMetricValue(metricName);
            const delta = metricData.value - (previousValue || 0);
            
            if (delta > 0) {
              if (metricData.labels) {
                prometheusMetric.inc(metricData.labels, delta);
              } else {
                prometheusMetric.inc(delta);
              }
            }
          } else if (prometheusMetric instanceof client.Histogram) {
            if (metricData.labels) {
              prometheusMetric.observe(metricData.labels, metricData.value);
            } else {
              prometheusMetric.observe(metricData.value);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error updating Prometheus metrics', { error });
      throw error;
    }
  }
  
  private async performAnomalyDetection(collection: MetricCollection): Promise<void> {
    try {
      const anomalies: Array<{
        metric: string;
        anomalyScore: number;
        currentValue: number;
        expectedRange: [number, number];
      }> = [];
      
      for (const [metricName, metricData] of Object.entries(collection.metrics)) {
        // Skip non-numeric or metadata metrics
        if (typeof metricData.value !== 'number') continue;
        
        // Get historical data for this metric
        const history = this.metricHistory.get(metricName) || [];
        history.push(metricData.value);
        
        // Keep only last 100 data points
        if (history.length > 100) {
          history.shift();
        }
        
        this.metricHistory.set(metricName, history);
        
        // Perform anomaly detection if we have enough history
        if (history.length >= 10) {
          const anomalyResult = await this.anomalyDetector.detectAnomaly(metricName, metricData.value, history);
          
          if (anomalyResult.isAnomaly) {
            anomalies.push({
              metric: metricName,
              anomalyScore: anomalyResult.score,
              currentValue: metricData.value,
              expectedRange: anomalyResult.expectedRange
            });
            
            // Emit anomaly event
            this.emit('anomalyDetected', {
              metric: metricName,
              anomalyScore: anomalyResult.score,
              currentValue: metricData.value,
              expectedRange: anomalyResult.expectedRange,
              timestamp: collection.timestamp
            });
          }
        }
      }
      
      if (anomalies.length > 0) {
        this.logger.warn('Anomalies detected in metrics', { 
          anomalies: anomalies.map(a => ({
            metric: a.metric,
            score: a.anomalyScore,
            value: a.currentValue
          }))
        });
      }
      
    } catch (error) {
      this.logger.error('Error in anomaly detection', { error });
      throw error;
    }
  }
  
  private async storeHistoricalData(collection: MetricCollection): Promise<void> {
    try {
      // Store in Redis for short-term access
      const key = `ai_ninja:metrics:${collection.timestamp}`;
      await this.redis.setex(key, 7200, JSON.stringify(collection)); // 2 hours TTL
      
      // Store aggregated data in database for long-term analysis
      const aggregatedData = {
        timestamp: new Date(collection.timestamp),
        system_health_score: collection.metrics['ai_ninja_system_health_score']?.value || null,
        active_calls: collection.metrics['ai_ninja_calls_active']?.value || null,
        success_rate: this.calculateSuccessRate(collection),
        avg_response_time: collection.metrics['ai_response_latency_avg']?.value || null,
        cost_per_call: collection.metrics['ai_ninja_cost_per_call']?.value || null
      };
      
      await this.database.query(`
        INSERT INTO metrics_history (timestamp, system_health_score, active_calls, success_rate, avg_response_time, cost_per_call)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        aggregatedData.timestamp,
        aggregatedData.system_health_score,
        aggregatedData.active_calls,
        aggregatedData.success_rate,
        aggregatedData.avg_response_time,
        aggregatedData.cost_per_call
      ]);
      
    } catch (error) {
      this.logger.error('Error storing historical data', { error });
      throw error;
    }
  }
  
  // Helper methods
  private async calculateServiceAvailability(): Promise<number> {
    // Implementation would check service health endpoints
    return 0.99; // Placeholder
  }
  
  private async calculateResponsePerformance(): Promise<number> {
    // Implementation would analyze recent response times
    return 0.85; // Placeholder
  }
  
  private async calculateCallSuccessRate(): Promise<number> {
    try {
      const result = await this.database.query(`
        SELECT 
          COUNT(CASE WHEN call_status = 'successful' THEN 1 END)::float / 
          COUNT(*)::float as success_rate
        FROM call_records 
        WHERE start_time >= NOW() - INTERVAL '1 hour'
      `);
      
      return result.rows.length > 0 ? (result.rows[0].success_rate || 0) : 0;
    } catch (error) {
      this.logger.error('Error calculating call success rate', { error });
      return 0;
    }
  }
  
  private async calculateErrorRate(): Promise<number> {
    // Implementation would check error rates across services
    return 0.95; // Placeholder (inverted - 0.05 error rate = 0.95 score)
  }
  
  private async checkAzureServicesHealth(): Promise<boolean> {
    // Implementation would check Azure service endpoints
    return true; // Placeholder
  }
  
  private async calculateResourceEfficiency(): Promise<number> {
    // Implementation would analyze resource utilization vs. output
    return 0.78; // Placeholder
  }
  
  private calculateSuccessRate(collection: MetricCollection): number | null {
    const total = collection.metrics['ai_ninja_calls_total']?.value || 0;
    const successful = collection.metrics['ai_ninja_calls_successful']?.value || 0;
    
    return total > 0 ? successful / total : null;
  }
  
  private async getPreviousMetricValue(metricName: string): Promise<number | null> {
    try {
      const result = await this.redis.get(`ai_ninja:metric_prev:${metricName}`);
      return result ? parseFloat(result) : null;
    } catch {
      return null;
    }
  }
  
  getMetricsRegistry(): client.Registry {
    return this.registry;
  }
}