import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { RedisClient } from '../utils/redis';
import { DatabaseClient } from '../utils/database';

export interface PerformanceBaseline {
  metric: string;
  baseline: number;
  confidence: number;
  thresholds: {
    warning: number;
    critical: number;
  };
  seasonality?: {
    hourly: number[];
    daily: number[];
    weekly: number[];
  };
  lastUpdated: Date;
  sampleSize: number;
}

export interface PerformanceTrend {
  metric: string;
  direction: 'improving' | 'degrading' | 'stable';
  confidence: number;
  rate: number; // rate of change per hour/day
  significance: number; // statistical significance
}

export interface BaselineViolation {
  metric: string;
  currentValue: number;
  baselineValue: number;
  deviationPercent: number;
  severity: 'warning' | 'critical';
  context: {
    timeOfDay: number;
    dayOfWeek: number;
    trend: PerformanceTrend;
  };
}

export class PerformanceBaselineService extends EventEmitter {
  private logger: Logger;
  private redis: RedisClient;
  private database: DatabaseClient;
  private baselines: Map<string, PerformanceBaseline> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  
  // Statistical parameters
  private readonly MIN_SAMPLES = 100;
  private readonly CONFIDENCE_THRESHOLD = 0.8;
  private readonly WARNING_DEVIATION = 1.5; // 1.5 standard deviations
  private readonly CRITICAL_DEVIATION = 2.5; // 2.5 standard deviations
  
  constructor() {
    super();
    this.logger = new Logger('PerformanceBaselineService');
    this.redis = new RedisClient();
    this.database = new DatabaseClient();
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing Performance Baseline Service');
    
    try {
      // Load existing baselines from database
      await this.loadBaselines();
      
      // Start periodic baseline updates
      this.startBaselineUpdates();
      
      this.logger.info('Performance Baseline Service initialized successfully', {
        baselinesLoaded: this.baselines.size
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize Performance Baseline Service', { error });
      throw error;
    }
  }
  
  private async loadBaselines(): Promise<void> {
    try {
      const result = await this.database.query(`
        SELECT * FROM performance_baselines 
        WHERE last_updated >= NOW() - INTERVAL '30 days'
        ORDER BY last_updated DESC
      `);
      
      for (const row of result.rows) {
        const baseline: PerformanceBaseline = {
          metric: row.metric_name,
          baseline: parseFloat(row.baseline_value),
          confidence: parseFloat(row.confidence),
          thresholds: {
            warning: parseFloat(row.warning_threshold),
            critical: parseFloat(row.critical_threshold)
          },
          seasonality: row.seasonality ? JSON.parse(row.seasonality) : undefined,
          lastUpdated: new Date(row.last_updated),
          sampleSize: parseInt(row.sample_size)
        };
        
        this.baselines.set(baseline.metric, baseline);
      }
      
      this.logger.info('Baselines loaded from database', { count: this.baselines.size });
      
    } catch (error) {
      this.logger.error('Error loading baselines from database', { error });
      // Continue without baselines - they will be calculated from scratch
    }
  }
  
  private startBaselineUpdates(): void {
    // Update baselines every hour
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateAllBaselines();
      } catch (error) {
        this.logger.error('Error in baseline update cycle', { error });
      }
    }, 3600000); // 1 hour
    
    // Initial update after 5 minutes
    setTimeout(async () => {
      try {
        await this.updateAllBaselines();
      } catch (error) {
        this.logger.error('Error in initial baseline update', { error });
      }
    }, 300000); // 5 minutes
  }
  
  async updateAllBaselines(): Promise<void> {
    this.logger.info('Starting baseline update cycle');
    
    const metricsToUpdate = [
      'ai_ninja_system_health_score',
      'ai_response_latency_avg',
      'ai_ninja_calls_total',
      'ai_ninja_calls_successful',
      'ai_ninja_caller_satisfaction_score',
      'ai_ninja_conversation_turns',
      'ai_ninja_stt_accuracy_rate',
      'ai_ninja_spam_detection_accuracy',
      'ai_ninja_cost_per_call'
    ];
    
    const updatePromises = metricsToUpdate.map(metric => 
      this.updateBaseline(metric).catch(error => 
        this.logger.error(`Failed to update baseline for ${metric}`, { error, metric })
      )
    );
    
    await Promise.allSettled(updatePromises);
    
    this.logger.info('Baseline update cycle completed', {
      totalBaselines: this.baselines.size
    });
  }
  
  async updateBaseline(metric: string): Promise<void> {
    try {
      // Get historical data for the metric
      const historicalData = await this.getHistoricalData(metric);
      
      if (historicalData.length < this.MIN_SAMPLES) {
        this.logger.debug(`Insufficient data for baseline calculation: ${metric}`, {
          samples: historicalData.length,
          required: this.MIN_SAMPLES
        });
        return;
      }
      
      // Calculate statistical baseline
      const baseline = this.calculateStatisticalBaseline(historicalData);
      
      // Detect seasonality patterns
      const seasonality = await this.detectSeasonality(metric, historicalData);
      
      // Create or update baseline
      const performanceBaseline: PerformanceBaseline = {
        metric,
        baseline: baseline.mean,
        confidence: baseline.confidence,
        thresholds: {
          warning: baseline.mean + (baseline.stdDev * this.WARNING_DEVIATION),
          critical: baseline.mean + (baseline.stdDev * this.CRITICAL_DEVIATION)
        },
        seasonality,
        lastUpdated: new Date(),
        sampleSize: historicalData.length
      };
      
      // Store in memory and database
      this.baselines.set(metric, performanceBaseline);
      await this.saveBaseline(performanceBaseline);
      
      this.logger.debug('Baseline updated', {
        metric,
        baseline: baseline.mean,
        confidence: baseline.confidence,
        samples: historicalData.length
      });
      
      this.emit('baselineUpdated', performanceBaseline);
      
    } catch (error) {
      this.logger.error(`Error updating baseline for ${metric}`, { error, metric });
      throw error;
    }
  }
  
  private async getHistoricalData(metric: string): Promise<number[]> {
    try {
      // Get data from the last 30 days
      const result = await this.database.query(`
        SELECT 
          CASE 
            WHEN $1 = 'ai_ninja_system_health_score' THEN system_health_score
            WHEN $1 = 'ai_response_latency_avg' THEN avg_response_time
            WHEN $1 = 'ai_ninja_calls_total' THEN active_calls
            WHEN $1 = 'ai_ninja_calls_successful' THEN active_calls * success_rate
            WHEN $1 = 'ai_ninja_cost_per_call' THEN cost_per_call
            ELSE NULL
          END as value
        FROM metrics_history 
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        AND CASE 
          WHEN $1 = 'ai_ninja_system_health_score' THEN system_health_score IS NOT NULL
          WHEN $1 = 'ai_response_latency_avg' THEN avg_response_time IS NOT NULL
          WHEN $1 = 'ai_ninja_calls_total' THEN active_calls IS NOT NULL
          WHEN $1 = 'ai_ninja_calls_successful' THEN (active_calls IS NOT NULL AND success_rate IS NOT NULL)
          WHEN $1 = 'ai_ninja_cost_per_call' THEN cost_per_call IS NOT NULL
          ELSE FALSE
        END
        ORDER BY timestamp DESC
        LIMIT 5000
      `, [metric]);
      
      return result.rows
        .map(row => parseFloat(row.value))
        .filter(value => !isNaN(value) && isFinite(value));
        
    } catch (error) {
      this.logger.error(`Error fetching historical data for ${metric}`, { error });
      return [];
    }
  }
  
  private calculateStatisticalBaseline(data: number[]): {
    mean: number;
    stdDev: number;
    confidence: number;
  } {
    if (data.length === 0) {
      throw new Error('Cannot calculate baseline with empty data');
    }
    
    // Remove outliers using IQR method
    const sortedData = [...data].sort((a, b) => a - b);
    const q1 = this.percentile(sortedData, 25);
    const q3 = this.percentile(sortedData, 75);
    const iqr = q3 - q1;
    const lowerBound = q1 - (1.5 * iqr);
    const upperBound = q3 + (1.5 * iqr);
    
    const filteredData = sortedData.filter(value => 
      value >= lowerBound && value <= upperBound
    );
    
    // Calculate mean and standard deviation
    const mean = filteredData.reduce((sum, value) => sum + value, 0) / filteredData.length;
    
    const variance = filteredData.reduce((sum, value) => {
      const diff = value - mean;
      return sum + (diff * diff);
    }, 0) / filteredData.length;
    
    const stdDev = Math.sqrt(variance);
    
    // Calculate confidence based on sample size and variance
    const confidence = Math.min(
      0.99,
      Math.max(
        0.5,
        (filteredData.length / this.MIN_SAMPLES) * (1 - (stdDev / mean))
      )
    );
    
    return {
      mean: Math.round(mean * 10000) / 10000,
      stdDev: Math.round(stdDev * 10000) / 10000,
      confidence: Math.round(confidence * 100) / 100
    };
  }
  
  private async detectSeasonality(metric: string, data: number[]): Promise<any> {
    try {
      // Get timestamped data for seasonality analysis
      const timestampedData = await this.database.query(`
        SELECT 
          timestamp,
          CASE 
            WHEN $1 = 'ai_ninja_system_health_score' THEN system_health_score
            WHEN $1 = 'ai_response_latency_avg' THEN avg_response_time
            WHEN $1 = 'ai_ninja_calls_total' THEN active_calls
            WHEN $1 = 'ai_ninja_calls_successful' THEN active_calls * success_rate
            WHEN $1 = 'ai_ninja_cost_per_call' THEN cost_per_call
            ELSE NULL
          END as value,
          EXTRACT(HOUR FROM timestamp) as hour,
          EXTRACT(DOW FROM timestamp) as dow
        FROM metrics_history 
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        AND CASE 
          WHEN $1 = 'ai_ninja_system_health_score' THEN system_health_score IS NOT NULL
          WHEN $1 = 'ai_response_latency_avg' THEN avg_response_time IS NOT NULL
          WHEN $1 = 'ai_ninja_calls_total' THEN active_calls IS NOT NULL
          WHEN $1 = 'ai_ninja_calls_successful' THEN (active_calls IS NOT NULL AND success_rate IS NOT NULL)
          WHEN $1 = 'ai_ninja_cost_per_call' THEN cost_per_call IS NOT NULL
          ELSE FALSE
        END
        ORDER BY timestamp
      `, [metric]);
      
      if (timestampedData.rows.length < 168) { // Less than a week of hourly data
        return undefined;
      }
      
      // Calculate hourly patterns
      const hourlyPatterns = new Array(24).fill(0);
      const hourlyCounts = new Array(24).fill(0);
      
      // Calculate daily patterns (day of week)
      const dailyPatterns = new Array(7).fill(0);
      const dailyCounts = new Array(7).fill(0);
      
      for (const row of timestampedData.rows) {
        const hour = parseInt(row.hour);
        const dow = parseInt(row.dow);
        const value = parseFloat(row.value);
        
        if (!isNaN(value) && isFinite(value)) {
          hourlyPatterns[hour] += value;
          hourlyCounts[hour]++;
          
          dailyPatterns[dow] += value;
          dailyCounts[dow]++;
        }
      }
      
      // Calculate averages
      const hourlyAvg = hourlyPatterns.map((sum, idx) => 
        hourlyCounts[idx] > 0 ? Math.round((sum / hourlyCounts[idx]) * 10000) / 10000 : 0
      );
      
      const dailyAvg = dailyPatterns.map((sum, idx) => 
        dailyCounts[idx] > 0 ? Math.round((sum / dailyCounts[idx]) * 10000) / 10000 : 0
      );
      
      return {
        hourly: hourlyAvg,
        daily: dailyAvg,
        weekly: [] // Could add weekly patterns if needed
      };
      
    } catch (error) {
      this.logger.error(`Error detecting seasonality for ${metric}`, { error });
      return undefined;
    }
  }
  
  private percentile(sortedArray: number[], percentile: number): number {
    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    
    if (lower === upper) {
      return sortedArray[lower];
    }
    
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }
  
  private async saveBaseline(baseline: PerformanceBaseline): Promise<void> {
    try {
      await this.database.query(`
        INSERT INTO performance_baselines 
        (metric_name, baseline_value, confidence, warning_threshold, critical_threshold, seasonality, last_updated, sample_size)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (metric_name) DO UPDATE SET
          baseline_value = EXCLUDED.baseline_value,
          confidence = EXCLUDED.confidence,
          warning_threshold = EXCLUDED.warning_threshold,
          critical_threshold = EXCLUDED.critical_threshold,
          seasonality = EXCLUDED.seasonality,
          last_updated = EXCLUDED.last_updated,
          sample_size = EXCLUDED.sample_size
      `, [
        baseline.metric,
        baseline.baseline,
        baseline.confidence,
        baseline.thresholds.warning,
        baseline.thresholds.critical,
        baseline.seasonality ? JSON.stringify(baseline.seasonality) : null,
        baseline.lastUpdated,
        baseline.sampleSize
      ]);
      
    } catch (error) {
      this.logger.error('Error saving baseline to database', { error, metric: baseline.metric });
      throw error;
    }
  }
  
  async checkForViolations(metric: string, currentValue: number): Promise<BaselineViolation | null> {
    const baseline = this.baselines.get(metric);
    
    if (!baseline || baseline.confidence < this.CONFIDENCE_THRESHOLD) {
      return null; // No reliable baseline available
    }
    
    // Adjust baseline for seasonality if available
    const adjustedBaseline = this.adjustForSeasonality(baseline, new Date());
    
    // Calculate deviation
    const deviationPercent = Math.abs((currentValue - adjustedBaseline) / adjustedBaseline) * 100;
    
    let severity: 'warning' | 'critical' | null = null;
    
    if (Math.abs(currentValue - adjustedBaseline) > (baseline.thresholds.critical - baseline.baseline)) {
      severity = 'critical';
    } else if (Math.abs(currentValue - adjustedBaseline) > (baseline.thresholds.warning - baseline.baseline)) {
      severity = 'warning';
    }
    
    if (severity) {
      // Calculate trend
      const trend = await this.calculateTrend(metric);
      
      const violation: BaselineViolation = {
        metric,
        currentValue,
        baselineValue: adjustedBaseline,
        deviationPercent: Math.round(deviationPercent * 100) / 100,
        severity,
        context: {
          timeOfDay: new Date().getHours(),
          dayOfWeek: new Date().getDay(),
          trend
        }
      };
      
      this.emit('baselineViolation', violation);
      
      return violation;
    }
    
    return null;
  }
  
  private adjustForSeasonality(baseline: PerformanceBaseline, timestamp: Date): number {
    if (!baseline.seasonality) {
      return baseline.baseline;
    }
    
    const hour = timestamp.getHours();
    const dayOfWeek = timestamp.getDay();
    
    let adjustment = 0;
    let adjustmentCount = 0;
    
    // Apply hourly adjustment
    if (baseline.seasonality.hourly && baseline.seasonality.hourly[hour] !== 0) {
      adjustment += (baseline.seasonality.hourly[hour] - baseline.baseline);
      adjustmentCount++;
    }
    
    // Apply daily adjustment
    if (baseline.seasonality.daily && baseline.seasonality.daily[dayOfWeek] !== 0) {
      adjustment += (baseline.seasonality.daily[dayOfWeek] - baseline.baseline);
      adjustmentCount++;
    }
    
    if (adjustmentCount > 0) {
      return baseline.baseline + (adjustment / adjustmentCount);
    }
    
    return baseline.baseline;
  }
  
  private async calculateTrend(metric: string): Promise<PerformanceTrend> {
    try {
      // Get recent data points for trend analysis
      const recentData = await this.database.query(`
        SELECT 
          timestamp,
          CASE 
            WHEN $1 = 'ai_ninja_system_health_score' THEN system_health_score
            WHEN $1 = 'ai_response_latency_avg' THEN avg_response_time
            WHEN $1 = 'ai_ninja_calls_total' THEN active_calls
            WHEN $1 = 'ai_ninja_calls_successful' THEN active_calls * success_rate
            WHEN $1 = 'ai_ninja_cost_per_call' THEN cost_per_call
            ELSE NULL
          END as value
        FROM metrics_history 
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        AND CASE 
          WHEN $1 = 'ai_ninja_system_health_score' THEN system_health_score IS NOT NULL
          WHEN $1 = 'ai_response_latency_avg' THEN avg_response_time IS NOT NULL
          WHEN $1 = 'ai_ninja_calls_total' THEN active_calls IS NOT NULL
          WHEN $1 = 'ai_ninja_calls_successful' THEN (active_calls IS NOT NULL AND success_rate IS NOT NULL)
          WHEN $1 = 'ai_ninja_cost_per_call' THEN cost_per_call IS NOT NULL
          ELSE FALSE
        END
        ORDER BY timestamp
      `, [metric]);
      
      if (recentData.rows.length < 10) {
        return {
          metric,
          direction: 'stable',
          confidence: 0,
          rate: 0,
          significance: 0
        };
      }
      
      const values = recentData.rows.map(row => parseFloat(row.value));
      const n = values.length;
      
      // Simple linear regression for trend detection
      const xSum = n * (n - 1) / 2;
      const ySum = values.reduce((sum, val) => sum + val, 0);
      const xySum = values.reduce((sum, val, idx) => sum + (val * idx), 0);
      const xxSum = n * (n - 1) * (2 * n - 1) / 6;
      
      const slope = (n * xySum - xSum * ySum) / (n * xxSum - xSum * xSum);
      
      // Determine trend direction and significance
      let direction: 'improving' | 'degrading' | 'stable' = 'stable';
      let significance = Math.abs(slope) / (ySum / n); // relative to mean
      
      if (Math.abs(slope) > 0.01 * (ySum / n)) { // 1% of mean per time unit
        direction = slope > 0 ? 'improving' : 'degrading';
        
        // For latency metrics, lower is better
        if (metric.includes('latency') || metric.includes('response_time')) {
          direction = slope > 0 ? 'degrading' : 'improving';
        }
      }
      
      const confidence = Math.min(0.95, Math.max(0.1, significance));
      
      return {
        metric,
        direction,
        confidence: Math.round(confidence * 100) / 100,
        rate: Math.round(slope * 3600 * 10000) / 10000, // per hour
        significance: Math.round(significance * 10000) / 10000
      };
      
    } catch (error) {
      this.logger.error(`Error calculating trend for ${metric}`, { error });
      return {
        metric,
        direction: 'stable',
        confidence: 0,
        rate: 0,
        significance: 0
      };
    }
  }
  
  getBaseline(metric: string): PerformanceBaseline | undefined {
    return this.baselines.get(metric);
  }
  
  getAllBaselines(): PerformanceBaseline[] {
    return Array.from(this.baselines.values());
  }
  
  async getBaselineReport(): Promise<{
    totalBaselines: number;
    reliableBaselines: number;
    recentViolations: number;
    averageConfidence: number;
  }> {
    const totalBaselines = this.baselines.size;
    const reliableBaselines = Array.from(this.baselines.values())
      .filter(baseline => baseline.confidence >= this.CONFIDENCE_THRESHOLD).length;
    
    // Get recent violations count
    const violationsResult = await this.database.query(`
      SELECT COUNT(*) as violation_count
      FROM baseline_violations 
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);
    
    const recentViolations = violationsResult.rows.length > 0 ? 
      parseInt(violationsResult.rows[0].violation_count) : 0;
    
    const averageConfidence = Array.from(this.baselines.values())
      .reduce((sum, baseline) => sum + baseline.confidence, 0) / totalBaselines || 0;
    
    return {
      totalBaselines,
      reliableBaselines,
      recentViolations,
      averageConfidence: Math.round(averageConfidence * 100) / 100
    };
  }
  
  async shutdown(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    await this.redis.disconnect();
    await this.database.disconnect();
    
    this.logger.info('Performance Baseline Service shut down successfully');
  }
}