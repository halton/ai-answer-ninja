/**
 * AI Answer Ninja - Database Performance Monitor
 * Comprehensive database performance monitoring and alerting system
 * Based on CLAUDE.md architecture specifications
 */

import { EventEmitter } from 'events';
import { DatabaseConnectionManager } from '../../shared/database/src/core/DatabaseConnectionManager';
import { 
  PerformanceSnapshot, 
  DatabaseMetrics, 
  AlertThreshold, 
  DatabaseAlert,
  TrendData 
} from '../../shared/database/src/types';
import { createLogger } from '../../shared/database/src/utils/Logger';

export class DatabasePerformanceMonitor extends EventEmitter {
  private dbManager: DatabaseConnectionManager;
  private logger = createLogger('DatabasePerformanceMonitor');
  
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertingInterval: NodeJS.Timeout | null = null;
  private metricsHistory: PerformanceSnapshot[] = [];
  private activeAlerts = new Map<string, DatabaseAlert>();
  
  private alertThresholds: AlertThreshold[] = [
    {
      metric: 'connection_utilization',
      operator: 'gt',
      value: 0.8,
      severity: 'warning',
      description: 'Connection pool utilization above 80%'
    },
    {
      metric: 'connection_utilization',
      operator: 'gt',
      value: 0.95,
      severity: 'critical',
      description: 'Connection pool utilization above 95%'
    },
    {
      metric: 'average_query_time',
      operator: 'gt',
      value: 1000,
      severity: 'warning',
      description: 'Average query time above 1 second'
    },
    {
      metric: 'slow_query_rate',
      operator: 'gt',
      value: 0.1,
      severity: 'warning',
      description: 'Slow query rate above 10%'
    },
    {
      metric: 'cache_hit_rate',
      operator: 'lt',
      value: 0.7,
      severity: 'warning',
      description: 'Cache hit rate below 70%'
    },
    {
      metric: 'database_size_growth',
      operator: 'gt',
      value: 0.2,
      severity: 'warning',
      description: 'Database size growth above 20% per day'
    }
  ];

  constructor(dbManager: DatabaseConnectionManager) {
    super();
    this.dbManager = dbManager;
  }

  /**
   * Start performance monitoring
   */
  public start(options: {
    monitoringIntervalMs?: number;
    alertingIntervalMs?: number;
    retentionHours?: number;
  } = {}): void {
    const {
      monitoringIntervalMs = 30000, // 30 seconds
      alertingIntervalMs = 60000,   // 1 minute
      retentionHours = 24           // 24 hours
    } = options;

    this.logger.info('Starting database performance monitoring');

    // Start performance data collection
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectPerformanceData();
        this.cleanupOldMetrics(retentionHours);
      } catch (error) {
        this.logger.error('Error collecting performance data:', error);
      }
    }, monitoringIntervalMs);

    // Start alerting system
    this.alertingInterval = setInterval(async () => {
      try {
        await this.checkAlertConditions();
      } catch (error) {
        this.logger.error('Error checking alert conditions:', error);
      }
    }, alertingIntervalMs);

    this.logger.info('Database performance monitoring started');
  }

  /**
   * Stop performance monitoring
   */
  public stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.alertingInterval) {
      clearInterval(this.alertingInterval);
      this.alertingInterval = null;
    }

    this.logger.info('Database performance monitoring stopped');
  }

  /**
   * Collect comprehensive performance data
   */
  private async collectPerformanceData(): Promise<void> {
    try {
      const snapshot: PerformanceSnapshot = {
        timestamp: new Date(),
        connections: this.dbManager.getConnectionStats(),
        cache: await this.getCacheMetrics(),
        queries: await this.getQueryMetrics(),
        database: await this.getDatabaseMetrics()
      };

      this.metricsHistory.push(snapshot);
      
      // Emit performance data for other systems to use
      this.emit('performanceSnapshot', snapshot);

      // Log performance data to database
      await this.logPerformanceData(snapshot);

    } catch (error) {
      this.logger.error('Failed to collect performance data:', error);
    }
  }

  private async getCacheMetrics() {
    // This would integrate with the MultiLevelCache
    try {
      const result = await this.dbManager.queryWithCache(
        'SELECT cache_type, hit_miss, COUNT(*) as count FROM cache_performance_log WHERE created_at >= NOW() - INTERVAL \'5 minutes\' GROUP BY cache_type, hit_miss',
        [],
        'cache_metrics_5min',
        300 // 5 minutes cache
      );

      let totalHits = 0;
      let totalMisses = 0;

      result.rows.forEach(row => {
        if (row.hit_miss === 'hit') {
          totalHits += parseInt(row.count);
        } else {
          totalMisses += parseInt(row.count);
        }
      });

      const totalOperations = totalHits + totalMisses;
      const hitRate = totalOperations > 0 ? totalHits / totalOperations : 0;

      return {
        hitRate,
        missRate: 1 - hitRate,
        averageResponseTime: 0, // Would be calculated from response times
        totalOperations
      };
    } catch (error) {
      this.logger.error('Failed to get cache metrics:', error);
      return {
        hitRate: 0,
        missRate: 0,
        averageResponseTime: 0,
        totalOperations: 0
      };
    }
  }

  private async getQueryMetrics() {
    try {
      const result = await this.dbManager.query(
        `SELECT 
          COUNT(*) as total_queries,
          COUNT(*) FILTER (WHERE execution_time_ms > 1000) as slow_queries,
          AVG(execution_time_ms) as avg_execution_time,
          COUNT(*) FILTER (WHERE query_type = 'ERROR') as error_count
        FROM query_performance_log 
        WHERE created_at >= NOW() - INTERVAL '5 minutes'`,
        []
      );

      const row = result.rows[0];
      const totalQueries = parseInt(row.total_queries) || 0;
      const slowQueries = parseInt(row.slow_queries) || 0;
      const avgExecutionTime = parseFloat(row.avg_execution_time) || 0;
      const errorCount = parseInt(row.error_count) || 0;

      return {
        totalQueries,
        slowQueries,
        averageExecutionTime: avgExecutionTime,
        errorRate: totalQueries > 0 ? errorCount / totalQueries : 0
      };
    } catch (error) {
      this.logger.error('Failed to get query metrics:', error);
      return {
        totalQueries: 0,
        slowQueries: 0,
        averageExecutionTime: 0,
        errorRate: 0
      };
    }
  }

  private async getDatabaseMetrics() {
    try {
      const [sizeResult, connectionsResult, locksResult] = await Promise.all([
        this.dbManager.query('SELECT pg_database_size(current_database()) as size'),
        this.dbManager.query('SELECT COUNT(*) as active_connections FROM pg_stat_activity WHERE state = \'active\''),
        this.dbManager.query('SELECT COUNT(*) as lock_waits FROM pg_stat_activity WHERE wait_event_type = \'Lock\'')
      ]);

      return {
        size: parseInt(sizeResult.rows[0].size) || 0,
        activeConnections: parseInt(connectionsResult.rows[0].active_connections) || 0,
        lockWaits: parseInt(locksResult.rows[0].lock_waits) || 0,
        checkpointWrites: 0 // Would be extracted from pg_stat_bgwriter
      };
    } catch (error) {
      this.logger.error('Failed to get database metrics:', error);
      return {
        size: 0,
        activeConnections: 0,
        lockWaits: 0,
        checkpointWrites: 0
      };
    }
  }

  /**
   * Log performance data to database
   */
  private async logPerformanceData(snapshot: PerformanceSnapshot): Promise<void> {
    try {
      await this.dbManager.query(
        `INSERT INTO system_logs (level, message, metadata, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          'INFO',
          'Performance snapshot',
          JSON.stringify({
            connections: snapshot.connections,
            cache_hit_rate: snapshot.cache.hitRate,
            avg_query_time: snapshot.queries.averageExecutionTime,
            total_queries: snapshot.queries.totalQueries,
            database_size: snapshot.database.size,
            active_connections: snapshot.database.activeConnections
          }),
          snapshot.timestamp
        ]
      );
    } catch (error) {
      this.logger.error('Failed to log performance data:', error);
    }
  }

  /**
   * Check alert conditions and trigger alerts
   */
  private async checkAlertConditions(): Promise<void> {
    if (this.metricsHistory.length === 0) {
      return;
    }

    const latestSnapshot = this.metricsHistory[this.metricsHistory.length - 1];
    const metrics = this.calculateDerivedMetrics(latestSnapshot);

    for (const threshold of this.alertThresholds) {
      const metricValue = this.extractMetricValue(metrics, threshold.metric);
      const conditionMet = this.evaluateCondition(metricValue, threshold.operator, threshold.value);

      if (conditionMet) {
        await this.triggerAlert(threshold, metricValue);
      } else {
        await this.resolveAlert(threshold.metric);
      }
    }
  }

  private calculateDerivedMetrics(snapshot: PerformanceSnapshot): Record<string, number> {
    const connectionStats = snapshot.connections;
    const primaryStats = connectionStats.primary;
    
    const totalConnections = primaryStats.total;
    const activeConnections = primaryStats.active;
    const connectionUtilization = totalConnections > 0 ? activeConnections / totalConnections : 0;

    const slowQueryRate = snapshot.queries.totalQueries > 0 ? 
      snapshot.queries.slowQueries / snapshot.queries.totalQueries : 0;

    // Calculate database size growth (if we have historical data)
    let databaseSizeGrowth = 0;
    if (this.metricsHistory.length > 1) {
      const previousSnapshot = this.metricsHistory[this.metricsHistory.length - 2];
      const timeDiff = snapshot.timestamp.getTime() - previousSnapshot.timestamp.getTime();
      const sizeDiff = snapshot.database.size - previousSnapshot.database.size;
      
      // Calculate daily growth rate
      if (timeDiff > 0) {
        const dailyGrowthRate = (sizeDiff / previousSnapshot.database.size) * (24 * 60 * 60 * 1000 / timeDiff);
        databaseSizeGrowth = dailyGrowthRate;
      }
    }

    return {
      connection_utilization: connectionUtilization,
      average_query_time: snapshot.queries.averageExecutionTime,
      slow_query_rate: slowQueryRate,
      cache_hit_rate: snapshot.cache.hitRate,
      database_size_growth: databaseSizeGrowth,
      active_connections: snapshot.database.activeConnections,
      lock_waits: snapshot.database.lockWaits
    };
  }

  private extractMetricValue(metrics: Record<string, number>, metricName: string): number {
    return metrics[metricName] || 0;
  }

  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private async triggerAlert(threshold: AlertThreshold, actualValue: number): Promise<void> {
    const alertId = `${threshold.metric}_${threshold.operator}_${threshold.value}`;
    
    // Check if alert is already active
    if (this.activeAlerts.has(alertId)) {
      return;
    }

    const alert: DatabaseAlert = {
      id: alertId,
      type: threshold.metric,
      severity: threshold.severity,
      message: `${threshold.description}. Current value: ${actualValue.toFixed(4)}`,
      timestamp: new Date(),
      metadata: {
        threshold: threshold.value,
        actualValue,
        operator: threshold.operator
      }
    };

    this.activeAlerts.set(alertId, alert);
    
    // Emit alert event
    this.emit('alert', alert);
    
    // Log alert to database
    try {
      await this.dbManager.query(
        `INSERT INTO system_logs (level, message, metadata, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          alert.severity.toUpperCase(),
          `Database Alert: ${alert.message}`,
          JSON.stringify(alert.metadata),
          alert.timestamp
        ]
      );
    } catch (error) {
      this.logger.error('Failed to log alert:', error);
    }

    this.logger.warn(`Database alert triggered: ${alert.message}`);
  }

  private async resolveAlert(metricName: string): Promise<void> {
    const alertsToResolve = Array.from(this.activeAlerts.keys())
      .filter(alertId => alertId.startsWith(metricName));

    for (const alertId of alertsToResolve) {
      const alert = this.activeAlerts.get(alertId);
      if (alert) {
        alert.resolvedAt = new Date();
        this.activeAlerts.delete(alertId);
        
        this.emit('alertResolved', alert);
        this.logger.info(`Database alert resolved: ${alert.message}`);
      }
    }
  }

  /**
   * Get current performance metrics
   */
  public getCurrentMetrics(): DatabaseMetrics | null {
    if (this.metricsHistory.length === 0) {
      return null;
    }

    const latest = this.metricsHistory[this.metricsHistory.length - 1];
    const derived = this.calculateDerivedMetrics(latest);

    return {
      performance: {
        queryThroughput: latest.queries.totalQueries,
        averageLatency: latest.queries.averageExecutionTime,
        errorRate: latest.queries.errorRate,
        cacheHitRate: latest.cache.hitRate
      },
      resources: {
        connectionUtilization: derived.connection_utilization,
        memoryUsage: 0, // Would need additional monitoring
        diskUsage: latest.database.size,
        cpuUsage: 0     // Would need additional monitoring
      },
      operations: {
        reads: 0,  // Would be calculated from query logs
        writes: 0, // Would be calculated from query logs
        transactions: 0, // Would be calculated from pg_stat_database
        rollbacks: 0     // Would be calculated from pg_stat_database
      }
    };
  }

  /**
   * Get performance trends over time
   */
  public getPerformanceTrends(
    metric: string,
    timeWindowHours: number = 1
  ): TrendData | null {
    const cutoffTime = new Date(Date.now() - (timeWindowHours * 60 * 60 * 1000));
    const relevantSnapshots = this.metricsHistory.filter(
      snapshot => snapshot.timestamp >= cutoffTime
    );

    if (relevantSnapshots.length < 2) {
      return null;
    }

    const dataPoints = relevantSnapshots.map(snapshot => {
      const derived = this.calculateDerivedMetrics(snapshot);
      return {
        timestamp: snapshot.timestamp,
        value: this.extractMetricValue(derived, metric)
      };
    });

    // Calculate trend
    const firstValue = dataPoints[0].value;
    const lastValue = dataPoints[dataPoints.length - 1].value;
    const changePercentage = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(changePercentage) < 5) {
      trend = 'stable';
    } else if (changePercentage > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    return {
      metric,
      timeWindow: `${timeWindowHours}h`,
      dataPoints,
      trend,
      changePercentage
    };
  }

  /**
   * Generate performance report
   */
  public async generatePerformanceReport(): Promise<{
    summary: DatabaseMetrics;
    trends: TrendData[];
    alerts: DatabaseAlert[];
    recommendations: string[];
  }> {
    const summary = this.getCurrentMetrics();
    const trends = [
      'connection_utilization',
      'average_query_time',
      'cache_hit_rate',
      'slow_query_rate'
    ].map(metric => this.getPerformanceTrends(metric, 1)).filter(Boolean) as TrendData[];

    const alerts = Array.from(this.activeAlerts.values());
    const recommendations = this.generateRecommendations(summary, trends, alerts);

    return {
      summary: summary || {} as DatabaseMetrics,
      trends,
      alerts,
      recommendations
    };
  }

  private generateRecommendations(
    summary: DatabaseMetrics | null,
    trends: TrendData[],
    alerts: DatabaseAlert[]
  ): string[] {
    const recommendations: string[] = [];

    if (!summary) {
      return ['Insufficient data for recommendations'];
    }

    // Connection utilization recommendations
    if (summary.resources.connectionUtilization > 0.8) {
      recommendations.push('Consider increasing connection pool size or optimizing query performance');
    }

    // Cache hit rate recommendations
    if (summary.performance.cacheHitRate < 0.7) {
      recommendations.push('Improve cache hit rate by optimizing cache keys and TTL settings');
    }

    // Query performance recommendations
    if (summary.performance.averageLatency > 1000) {
      recommendations.push('Investigate slow queries and consider adding database indexes');
    }

    // Trend-based recommendations
    for (const trend of trends) {
      if (trend.trend === 'increasing' && trend.changePercentage > 20) {
        switch (trend.metric) {
          case 'average_query_time':
            recommendations.push('Query performance is degrading - investigate recent changes');
            break;
          case 'connection_utilization':
            recommendations.push('Connection usage is increasing - monitor for capacity limits');
            break;
          case 'slow_query_rate':
            recommendations.push('Slow query rate is increasing - optimize database queries');
            break;
        }
      }
    }

    // Alert-based recommendations
    if (alerts.length > 0) {
      recommendations.push(`${alerts.length} active alerts require attention`);
    }

    return recommendations.length > 0 ? recommendations : ['System performance is within normal parameters'];
  }

  /**
   * Cleanup old metrics data
   */
  private cleanupOldMetrics(retentionHours: number): void {
    const cutoffTime = new Date(Date.now() - (retentionHours * 60 * 60 * 1000));
    const initialLength = this.metricsHistory.length;
    
    this.metricsHistory = this.metricsHistory.filter(
      snapshot => snapshot.timestamp >= cutoffTime
    );

    const removed = initialLength - this.metricsHistory.length;
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} old performance metrics`);
    }
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): DatabaseAlert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Acknowledge alert
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.emit('alertAcknowledged', alert);
      return true;
    }
    return false;
  }
}

export default DatabasePerformanceMonitor;