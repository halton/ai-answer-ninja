import { Request, Response, NextFunction } from 'express';
import { db } from '@/utils/database';
import { redis } from '@/cache/redis-client';
import { cacheService } from '@/cache/cache-service';
import { whitelistService } from '@/services/whitelist-service';
import { rulesEngine } from '@/ml/rules-engine';
import { mlClassifier } from '@/ml/feature-extractor';
import { logger } from '@/utils/logger';
import { HealthStatus, ApiResponse } from '@/types';

export class HealthController {

  /**
   * GET /health
   * Basic health check
   */
  async basicHealth(req: Request, res: Response<ApiResponse<{ status: string }>>, next: NextFunction): Promise<void> {
    try {
      const response: ApiResponse<{ status: string }> = {
        success: true,
        data: { status: 'healthy' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /health/live
   * Kubernetes liveness probe
   */
  async liveness(req: Request, res: Response<ApiResponse<{ alive: boolean }>>, next: NextFunction): Promise<void> {
    try {
      // Basic application liveness check
      const alive = true; // Service is running if it can respond

      const response: ApiResponse<{ alive: boolean }> = {
        success: true,
        data: { alive },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(alive ? 200 : 503).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /health/ready
   * Kubernetes readiness probe
   */
  async readiness(req: Request, res: Response<ApiResponse<HealthStatus>>, next: NextFunction): Promise<void> {
    try {
      const start = Date.now();
      const uptime = process.uptime();

      // Check all critical dependencies
      const [dbHealth, redisHealth, cacheHealth] = await Promise.allSettled([
        db.healthCheck(),
        redis.healthCheck(),
        cacheService.healthCheck(),
      ]);

      const database = dbHealth.status === 'fulfilled' && dbHealth.value.healthy;
      const redisHealthy = redisHealth.status === 'fulfilled' && redisHealth.value.healthy;
      const cache = cacheHealth.status === 'fulfilled' && cacheHealth.value.healthy;
      
      // ML service is not critical for readiness
      const mlService = true; // ML classifier is always available (offline model)

      const allHealthy = database && redisHealthy && cache && mlService;
      
      const status: HealthStatus = {
        status: allHealthy ? 'healthy' : 'degraded',
        database,
        redis: redisHealthy,
        mlService,
        timestamp: new Date(),
        uptime,
      };

      const response: ApiResponse<HealthStatus> = {
        success: true,
        data: status,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
          processingTime: Date.now() - start,
        },
      };

      res.status(allHealthy ? 200 : 503).json(response);
    } catch (error) {
      logger.error('Readiness check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      const response: ApiResponse<HealthStatus> = {
        success: false,
        data: {
          status: 'unhealthy',
          database: false,
          redis: false,
          mlService: false,
          timestamp: new Date(),
          uptime: process.uptime(),
        },
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: 'Health check failed',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(503).json(response);
    }
  }

  /**
   * GET /health/deep
   * Comprehensive health check with detailed metrics
   */
  async deepHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const start = Date.now();

      // Collect detailed health information
      const [
        dbHealth,
        redisHealth,
        cacheHealth,
        serviceHealth,
        systemMetrics
      ] = await Promise.allSettled([
        this.checkDatabaseHealth(),
        this.checkRedisHealth(),
        this.checkCacheHealth(),
        this.checkServiceHealth(),
        this.collectSystemMetrics(),
      ]);

      const healthData = {
        overall: {
          status: this.determineOverallStatus([dbHealth, redisHealth, cacheHealth, serviceHealth]),
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - start,
        },
        dependencies: {
          database: dbHealth.status === 'fulfilled' ? dbHealth.value : { healthy: false, error: dbHealth.reason },
          redis: redisHealth.status === 'fulfilled' ? redisHealth.value : { healthy: false, error: redisHealth.reason },
          cache: cacheHealth.status === 'fulfilled' ? cacheHealth.value : { healthy: false, error: cacheHealth.reason },
        },
        services: serviceHealth.status === 'fulfilled' ? serviceHealth.value : { error: serviceHealth.reason },
        system: systemMetrics.status === 'fulfilled' ? systemMetrics.value : { error: systemMetrics.reason },
      };

      const isHealthy = healthData.overall.status === 'healthy';

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: healthData,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
          processingTime: Date.now() - start,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /metrics
   * Prometheus metrics endpoint
   */
  async metrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = await this.collectPrometheusMetrics();
      
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(metrics);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /health/performance
   * Performance metrics and statistics
   */
  async performance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [
        serviceStats,
        cacheStats,
        rulesStats,
        dbStats
      ] = await Promise.allSettled([
        whitelistService.getServiceStats(),
        cacheService.getCacheStatistics(),
        rulesEngine.getRuleStats(),
        db.getPoolStats(),
      ]);

      const performanceData = {
        service: serviceStats.status === 'fulfilled' ? serviceStats.value : null,
        cache: cacheStats.status === 'fulfilled' ? cacheStats.value : null,
        rules: rulesStats.status === 'fulfilled' ? rulesStats.value : null,
        database: dbStats.status === 'fulfilled' ? dbStats.value : null,
        ml: {
          modelVersion: '1.0.0',
          weights: mlClassifier.getModelStats(),
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json({
        success: true,
        data: performanceData,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Private helper methods

  private async checkDatabaseHealth(): Promise<any> {
    const health = await db.healthCheck();
    const poolStats = db.getPoolStats();
    
    return {
      healthy: health.healthy,
      latency: health.latency,
      connections: poolStats,
      lastCheck: new Date().toISOString(),
    };
  }

  private async checkRedisHealth(): Promise<any> {
    const health = await redis.healthCheck();
    const connectionStatus = redis.getConnectionStatus();
    
    return {
      healthy: health.healthy,
      latency: health.latency,
      connection: connectionStatus,
      lastCheck: new Date().toISOString(),
    };
  }

  private async checkCacheHealth(): Promise<any> {
    const health = await cacheService.healthCheck();
    
    return {
      healthy: health.healthy,
      latency: health.latency,
      hitRate: health.hitRate,
      lastCheck: new Date().toISOString(),
    };
  }

  private async checkServiceHealth(): Promise<any> {
    const whitelistHealth = await whitelistService.healthCheck();
    
    return {
      whitelist: {
        healthy: whitelistHealth.healthy,
        queueSize: whitelistHealth.queueSize,
        processingEvents: whitelistHealth.processingEvents,
      },
      rulesEngine: {
        healthy: true,
        ruleStats: rulesEngine.getRuleStats(),
      },
      mlClassifier: {
        healthy: true,
        modelVersion: '1.0.0',
      },
    };
  }

  private collectSystemMetrics(): Promise<any> {
    return Promise.resolve({
      memory: {
        used: process.memoryUsage(),
        available: this.getAvailableMemory(),
      },
      cpu: {
        usage: process.cpuUsage(),
        loadAverage: require('os').loadavg(),
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      node: {
        version: process.versions.node,
        v8: process.versions.v8,
      },
    });
  }

  private getAvailableMemory(): number {
    const os = require('os');
    return os.totalmem() - (os.totalmem() - os.freemem());
  }

  private determineOverallStatus(checks: PromiseSettledResult<any>[]): 'healthy' | 'degraded' | 'unhealthy' {
    const fulfilled = checks.filter(check => check.status === 'fulfilled').length;
    const total = checks.length;
    
    if (fulfilled === total) {
      return 'healthy';
    } else if (fulfilled >= total * 0.5) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  private async collectPrometheusMetrics(): Promise<string> {
    // Basic Prometheus metrics format
    // In production, use the prom-client library for proper metrics
    const metrics: string[] = [];
    
    try {
      // Service metrics
      const serviceStats = await whitelistService.getServiceStats();
      metrics.push(`# HELP smart_whitelist_total_entries Total whitelist entries`);
      metrics.push(`# TYPE smart_whitelist_total_entries gauge`);
      metrics.push(`smart_whitelist_total_entries ${serviceStats.totalEntries}`);
      
      metrics.push(`# HELP smart_whitelist_active_entries Active whitelist entries`);
      metrics.push(`# TYPE smart_whitelist_active_entries gauge`);
      metrics.push(`smart_whitelist_active_entries ${serviceStats.activeEntries}`);
      
      metrics.push(`# HELP smart_whitelist_learning_queue_size Learning queue size`);
      metrics.push(`# TYPE smart_whitelist_learning_queue_size gauge`);
      metrics.push(`smart_whitelist_learning_queue_size ${serviceStats.learningQueueSize}`);

      // Cache metrics
      const cacheHealth = await cacheService.healthCheck();
      metrics.push(`# HELP smart_whitelist_cache_hit_rate Cache hit rate`);
      metrics.push(`# TYPE smart_whitelist_cache_hit_rate gauge`);
      metrics.push(`smart_whitelist_cache_hit_rate ${cacheHealth.hitRate}`);

      // Database metrics
      const dbHealth = await db.healthCheck();
      const dbStats = db.getPoolStats();
      metrics.push(`# HELP smart_whitelist_db_latency_ms Database latency in milliseconds`);
      metrics.push(`# TYPE smart_whitelist_db_latency_ms gauge`);
      metrics.push(`smart_whitelist_db_latency_ms ${dbHealth.latency}`);
      
      metrics.push(`# HELP smart_whitelist_db_connections_total Database connection pool total`);
      metrics.push(`# TYPE smart_whitelist_db_connections_total gauge`);
      metrics.push(`smart_whitelist_db_connections_total ${dbStats.totalCount}`);
      
      metrics.push(`# HELP smart_whitelist_db_connections_idle Database connection pool idle`);
      metrics.push(`# TYPE smart_whitelist_db_connections_idle gauge`);
      metrics.push(`smart_whitelist_db_connections_idle ${dbStats.idleCount}`);

      // System metrics
      const memUsage = process.memoryUsage();
      metrics.push(`# HELP smart_whitelist_memory_usage_bytes Memory usage in bytes`);
      metrics.push(`# TYPE smart_whitelist_memory_usage_bytes gauge`);
      metrics.push(`smart_whitelist_memory_usage_bytes{type="rss"} ${memUsage.rss}`);
      metrics.push(`smart_whitelist_memory_usage_bytes{type="heapUsed"} ${memUsage.heapUsed}`);
      metrics.push(`smart_whitelist_memory_usage_bytes{type="heapTotal"} ${memUsage.heapTotal}`);

      metrics.push(`# HELP smart_whitelist_uptime_seconds Service uptime in seconds`);
      metrics.push(`# TYPE smart_whitelist_uptime_seconds counter`);
      metrics.push(`smart_whitelist_uptime_seconds ${process.uptime()}`);

    } catch (error) {
      logger.error('Failed to collect metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      metrics.push(`# HELP smart_whitelist_metrics_error Metrics collection error`);
      metrics.push(`# TYPE smart_whitelist_metrics_error gauge`);
      metrics.push(`smart_whitelist_metrics_error 1`);
    }

    return metrics.join('\n');
  }
}

export const healthController = new HealthController();
export default healthController;