import { RedisService } from './redis';
import { MetricsService } from './metrics';
import logger from '../utils/logger';

interface HealthCheckDependency {
  redis: RedisService;
  metrics: MetricsService;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    [key: string]: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      responseTime?: number;
      details?: any;
      error?: string;
    };
  };
}

export class HealthCheckService {
  private dependencies: HealthCheckDependency;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly startTime = Date.now();

  constructor(dependencies: HealthCheckDependency) {
    this.dependencies = dependencies;
  }

  public start(): void {
    // Start periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error({ error }, 'Health check failed');
      });
    }, 30000); // Check every 30 seconds

    logger.info('Health Check Service started');
  }

  public stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('Health Check Service stopped');
  }

  public async getHealthStatus(): Promise<HealthStatus> {
    const startTime = Date.now();
    const checks: HealthStatus['checks'] = {};

    // Check Redis connection
    try {
      const redisStart = Date.now();
      const redisHealth = await this.dependencies.redis.healthCheck();
      checks.redis = {
        status: redisHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - redisStart,
        details: redisHealth,
      };
    } catch (error) {
      checks.redis = {
        status: 'unhealthy',
        error: error.message,
      };
    }

    // Check metrics service
    try {
      const metricsHealth = this.dependencies.metrics.getHealthMetrics();
      checks.metrics = {
        status: metricsHealth.status,
        details: metricsHealth.checks,
      };
    } catch (error) {
      checks.metrics = {
        status: 'unhealthy',
        error: error.message,
      };
    }

    // Check system resources
    checks.system = this.checkSystemHealth();

    // Check application health
    checks.application = this.checkApplicationHealth();

    // Determine overall status
    const overallStatus = this.determineOverallStatus(checks);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      checks,
    };
  }

  private async performHealthCheck(): Promise<void> {
    const health = await this.getHealthStatus();
    
    if (health.status === 'unhealthy') {
      logger.warn({ health }, 'System health is unhealthy');
    } else if (health.status === 'degraded') {
      logger.info({ health }, 'System health is degraded');
    } else {
      logger.debug({ health }, 'System health is healthy');
    }
  }

  private checkSystemHealth(): HealthStatus['checks'][string] {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Memory check (warn if > 80% of heap limit)
      const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      // CPU check (simplified)
      const totalCpuTime = cpuUsage.user + cpuUsage.system;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      const details: any = {
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          usagePercent: heapUsagePercent,
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
          total: totalCpuTime,
        },
      };

      if (heapUsagePercent > 90) {
        status = 'unhealthy';
        details.issues = ['High memory usage'];
      } else if (heapUsagePercent > 80) {
        status = 'degraded';
        details.warnings = ['Elevated memory usage'];
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  private checkApplicationHealth(): HealthStatus['checks'][string] {
    try {
      // Check if the event loop is responsive
      const eventLoopStart = Date.now();
      const eventLoopCheck = new Promise((resolve) => {
        setImmediate(() => {
          resolve(Date.now() - eventLoopStart);
        });
      });

      const details: any = {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      };

      // Simple responsiveness check
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      // Check if we have any unhandled promise rejections or exceptions
      const unhandledRejections = process.listenerCount('unhandledRejection');
      const uncaughtExceptions = process.listenerCount('uncaughtException');

      if (unhandledRejections > 1 || uncaughtExceptions > 1) {
        status = 'degraded';
        details.warnings = ['Multiple error handlers detected'];
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  private determineOverallStatus(checks: HealthStatus['checks']): 'healthy' | 'degraded' | 'unhealthy' {
    const statuses = Object.values(checks).map(check => check.status);
    
    if (statuses.some(status => status === 'unhealthy')) {
      return 'unhealthy';
    }
    
    if (statuses.some(status => status === 'degraded')) {
      return 'degraded';
    }
    
    return 'healthy';
  }

  // Readiness check (for Kubernetes)
  public async getReadinessStatus(): Promise<{ ready: boolean; details: any }> {
    try {
      const health = await this.getHealthStatus();
      
      // Service is ready if it's not unhealthy and critical dependencies are available
      const ready = health.status !== 'unhealthy' && 
                   health.checks.redis?.status !== 'unhealthy';

      return {
        ready,
        details: {
          status: health.status,
          criticalChecks: {
            redis: health.checks.redis?.status,
          },
        },
      };
    } catch (error) {
      return {
        ready: false,
        details: { error: error.message },
      };
    }
  }

  // Liveness check (for Kubernetes)
  public async getLivenessStatus(): Promise<{ alive: boolean; details: any }> {
    try {
      // Simple check to see if the service is responsive
      const start = Date.now();
      await new Promise(resolve => setImmediate(resolve));
      const eventLoopLag = Date.now() - start;

      const alive = eventLoopLag < 1000; // Consider alive if event loop lag < 1s

      return {
        alive,
        details: {
          eventLoopLag,
          uptime: Date.now() - this.startTime,
          pid: process.pid,
        },
      };
    } catch (error) {
      return {
        alive: false,
        details: { error: error.message },
      };
    }
  }
}