import { Router, Request, Response } from 'express';
import { dbPool } from '../utils/database';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';
import { asyncHandler } from '../middleware/error';
import config from '../config';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    azure: ServiceHealth;
  };
  metrics: {
    memory: MemoryUsage;
    connections: ConnectionMetrics;
    responseTime: number;
  };
}

interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  details?: any;
}

interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
  heapUsed: number;
  heapTotal: number;
}

interface ConnectionMetrics {
  database: {
    total: number;
    idle: number;
    waiting: number;
  };
  active: number;
}

// Basic health check endpoint
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const healthStatus = await performHealthCheck();
    const responseTime = Date.now() - startTime;
    
    healthStatus.metrics.responseTime = responseTime;
    
    const statusCode = getStatusCode(healthStatus.status);
    
    res.status(statusCode).json(healthStatus);
    
    logger.info({
      status: healthStatus.status,
      responseTime,
      statusCode,
    }, 'Health check completed');
    
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      uptime: process.uptime(),
    });
  }
}));

// Detailed health check endpoint
router.get('/detailed', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const healthStatus = await performDetailedHealthCheck();
    const responseTime = Date.now() - startTime;
    
    healthStatus.metrics.responseTime = responseTime;
    
    const statusCode = getStatusCode(healthStatus.status);
    
    res.status(statusCode).json(healthStatus);
    
  } catch (error) {
    logger.error({ error }, 'Detailed health check failed');
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Detailed health check failed',
    });
  }
}));

// Readiness probe endpoint (for Kubernetes)
router.get('/ready', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Check critical services required for the service to be ready
    const [databaseReady, redisReady] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);
    
    const isReady = databaseReady.status === 'healthy' && redisReady.status === 'healthy';
    
    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          database: databaseReady,
          redis: redisReady,
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        services: {
          database: databaseReady,
          redis: redisReady,
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Readiness check failed');
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed',
    });
  }
}));

// Liveness probe endpoint (for Kubernetes)
router.get('/live', asyncHandler(async (req: Request, res: Response) => {
  // Simple liveness check - just verify the process is running
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
  });
}));

// Service dependencies check
router.get('/dependencies', asyncHandler(async (req: Request, res: Response) => {
  try {
    const [databaseHealth, redisHealth, azureHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
      checkAzureServicesHealth(),
    ]);
    
    const dependencies = {
      database: databaseHealth,
      redis: redisHealth,
      azure: azureHealth,
    };
    
    const overallStatus = getOverallStatus([
      databaseHealth.status,
      redisHealth.status,
      azureHealth.status,
    ]);
    
    const statusCode = getStatusCode(overallStatus);
    
    res.status(statusCode).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      dependencies,
    });
    
  } catch (error) {
    logger.error({ error }, 'Dependencies check failed');
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Dependencies check failed',
    });
  }
}));

// Helper functions
async function performHealthCheck(): Promise<HealthStatus> {
  const [databaseHealth, redisHealth, azureHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkAzureServicesHealth(),
  ]);
  
  const services = {
    database: databaseHealth,
    redis: redisHealth,
    azure: azureHealth,
  };
  
  const overallStatus = getOverallStatus([
    databaseHealth.status,
    redisHealth.status,
    azureHealth.status,
  ]);
  
  const memoryUsage = getMemoryUsage();\n  const connectionMetrics = getConnectionMetrics();\n  \n  return {\n    status: overallStatus,\n    timestamp: new Date().toISOString(),\n    version: process.env.npm_package_version || '1.0.0',\n    environment: config.server.environment,\n    uptime: process.uptime(),\n    services,\n    metrics: {\n      memory: memoryUsage,\n      connections: connectionMetrics,\n      responseTime: 0, // Will be set by caller\n    },\n  };\n}\n\nasync function performDetailedHealthCheck(): Promise<HealthStatus> {\n  // Perform the same checks as basic health check but with more detailed information\n  const healthStatus = await performHealthCheck();\n  \n  // Add additional detailed metrics\n  const processMetrics = {\n    nodeVersion: process.version,\n    platform: process.platform,\n    arch: process.arch,\n    cpuUsage: process.cpuUsage(),\n    resourceUsage: process.resourceUsage ? process.resourceUsage() : undefined,\n  };\n  \n  return {\n    ...healthStatus,\n    metrics: {\n      ...healthStatus.metrics,\n      process: processMetrics,\n    },\n  };\n}\n\nasync function checkDatabaseHealth(): Promise<ServiceHealth> {\n  const startTime = Date.now();\n  \n  try {\n    const isHealthy = await dbPool.healthCheck();\n    const responseTime = Date.now() - startTime;\n    \n    if (isHealthy) {\n      return {\n        status: 'healthy',\n        responseTime,\n        details: {\n          connected: dbPool.connected,\n          totalConnections: dbPool.totalCount,\n          idleConnections: dbPool.idleCount,\n          waitingConnections: dbPool.waitingCount,\n        },\n      };\n    } else {\n      return {\n        status: 'unhealthy',\n        responseTime,\n        error: 'Database connection failed',\n      };\n    }\n  } catch (error: any) {\n    const responseTime = Date.now() - startTime;\n    return {\n      status: 'unhealthy',\n      responseTime,\n      error: error.message,\n    };\n  }\n}\n\nasync function checkRedisHealth(): Promise<ServiceHealth> {\n  const startTime = Date.now();\n  \n  try {\n    const result = await redisClient.ping();\n    const responseTime = Date.now() - startTime;\n    \n    if (result === 'PONG') {\n      return {\n        status: 'healthy',\n        responseTime,\n        details: {\n          connected: redisClient.status === 'ready',\n          mode: redisClient.mode,\n        },\n      };\n    } else {\n      return {\n        status: 'unhealthy',\n        responseTime,\n        error: 'Redis ping failed',\n      };\n    }\n  } catch (error: any) {\n    const responseTime = Date.now() - startTime;\n    return {\n      status: 'unhealthy',\n      responseTime,\n      error: error.message,\n    };\n  }\n}\n\nasync function checkAzureServicesHealth(): Promise<ServiceHealth> {\n  const startTime = Date.now();\n  \n  try {\n    // For now, we'll just check if the configuration is present\n    // In a real implementation, you might want to make actual API calls to Azure\n    const hasAzureConfig = !!\n      config.azure.communicationServices.connectionString &&\n      config.azure.communicationServices.endpoint;\n    \n    const responseTime = Date.now() - startTime;\n    \n    if (hasAzureConfig) {\n      return {\n        status: 'healthy',\n        responseTime,\n        details: {\n          configurationPresent: true,\n          endpoint: config.azure.communicationServices.endpoint,\n        },\n      };\n    } else {\n      return {\n        status: 'degraded',\n        responseTime,\n        error: 'Azure configuration incomplete',\n      };\n    }\n  } catch (error: any) {\n    const responseTime = Date.now() - startTime;\n    return {\n      status: 'unhealthy',\n      responseTime,\n      error: error.message,\n    };\n  }\n}\n\nfunction getMemoryUsage(): MemoryUsage {\n  const memUsage = process.memoryUsage();\n  const totalMemory = require('os').totalmem();\n  const freeMemory = require('os').freemem();\n  const usedMemory = totalMemory - freeMemory;\n  \n  return {\n    used: usedMemory,\n    total: totalMemory,\n    percentage: (usedMemory / totalMemory) * 100,\n    heapUsed: memUsage.heapUsed,\n    heapTotal: memUsage.heapTotal,\n  };\n}\n\nfunction getConnectionMetrics(): ConnectionMetrics {\n  return {\n    database: {\n      total: dbPool.totalCount,\n      idle: dbPool.idleCount,\n      waiting: dbPool.waitingCount,\n    },\n    active: 0, // This would need to be tracked separately\n  };\n}\n\nfunction getOverallStatus(statuses: string[]): 'healthy' | 'degraded' | 'unhealthy' {\n  if (statuses.every(status => status === 'healthy')) {\n    return 'healthy';\n  } else if (statuses.some(status => status === 'unhealthy')) {\n    return 'unhealthy';\n  } else {\n    return 'degraded';\n  }\n}\n\nfunction getStatusCode(status: string): number {\n  switch (status) {\n    case 'healthy':\n      return 200;\n    case 'degraded':\n      return 200; // Still operational\n    case 'unhealthy':\n      return 503;\n    default:\n      return 503;\n  }\n}\n\nexport { router as healthRoutes };