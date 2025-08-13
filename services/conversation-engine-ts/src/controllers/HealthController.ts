import { Request, Response } from 'express';
import { HealthStatus, HealthCheck, ApiResponse } from '@/types';
import { Logger } from '@/utils/logger';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import { createClient } from 'redis';
import { Pool } from 'pg';
import config from '@/config';

/**
 * 健康检查控制器
 */
export class HealthController {
  private logger: Logger;
  private startTime: Date;
  private openaiClient?: OpenAIClient;
  private redisClient?: any;
  private dbPool?: Pool;

  constructor() {
    this.logger = new Logger('HealthController');
    this.startTime = new Date();
    this.initializeClients();
  }

  private async initializeClients() {
    try {
      // 初始化 OpenAI 客户端
      this.openaiClient = new OpenAIClient(
        config.azure.endpoint,
        new AzureKeyCredential(config.azure.apiKey)
      );

      // 初始化 Redis 客户端
      this.redisClient = createClient({ url: config.redis.url });
      await this.redisClient.connect();

      // 初始化数据库连接池
      this.dbPool = new Pool({
        connectionString: config.database.url,
        max: 2, // 健康检查只需要少量连接
        connectionTimeoutMillis: 5000
      });

    } catch (error) {
      this.logger.error('Failed to initialize health check clients', error);
    }
  }

  /**
   * 基础健康检查
   * GET /health
   */
  public basicHealth = async (req: Request, res: Response): Promise<void> => {
    const health: HealthStatus = {
      status: 'healthy',
      checks: {
        service: {
          status: 'pass',
          message: 'Conversation Engine is running'
        }
      },
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime()
    };

    res.status(200).json(health);
  };

  /**
   * 详细健康检查
   * GET /health/detailed
   */
  public detailedHealth = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      this.logger.info('Performing detailed health check');

      // 并行执行所有健康检查
      const [
        serviceCheck,
        azureOpenAICheck,
        redisCheck,
        databaseCheck,
        memoryCheck,
        diskCheck
      ] = await Promise.allSettled([
        this.checkService(),
        this.checkAzureOpenAI(),
        this.checkRedis(),
        this.checkDatabase(),
        this.checkMemory(),
        this.checkDisk()
      ]);

      const checks: Record<string, HealthCheck> = {
        service: this.getCheckResult(serviceCheck),
        azure_openai: this.getCheckResult(azureOpenAICheck),
        redis: this.getCheckResult(redisCheck),
        database: this.getCheckResult(databaseCheck),
        memory: this.getCheckResult(memoryCheck),
        disk: this.getCheckResult(diskCheck)
      };

      // 确定整体健康状态
      const overallStatus = this.determineOverallStatus(checks);

      const health: HealthStatus = {
        status: overallStatus,
        checks,
        timestamp: new Date(),
        uptime: Date.now() - this.startTime.getTime()
      };

      const statusCode = overallStatus === 'healthy' ? 200 : 
                        overallStatus === 'degraded' ? 200 : 503;

      const response: ApiResponse<HealthStatus> = {
        success: overallStatus !== 'unhealthy',
        data: health,
        metadata: {
          requestId: this.generateRequestId(),
          timestamp: new Date(),
          processingTime: Date.now() - startTime
        }
      };

      res.status(statusCode).json(response);

    } catch (error) {
      this.logger.error('Health check failed', error);

      const health: HealthStatus = {
        status: 'unhealthy',
        checks: {
          service: {
            status: 'fail',
            message: 'Health check system failure',
            metadata: { error: error instanceof Error ? error.message : String(error) }
          }
        },
        timestamp: new Date(),
        uptime: Date.now() - this.startTime.getTime()
      };

      res.status(503).json({
        success: false,
        data: health,
        error: {
          code: 'HEALTH_CHECK_ERROR',
          message: 'Health check system failure'
        }
      });
    }
  };

  /**
   * 存活检查（简单的服务存活确认）
   * GET /health/liveness
   */
  public livenessCheck = async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime()
    });
  };

  /**
   * 就绪检查（确认服务可以处理请求）
   * GET /health/readiness
   */
  public readinessCheck = async (req: Request, res: Response): Promise<void> => {
    try {
      // 检查关键依赖是否就绪
      const [azureCheck, redisCheck, dbCheck] = await Promise.allSettled([
        this.checkAzureOpenAI(),
        this.checkRedis(),
        this.checkDatabase()
      ]);

      const isReady = [azureCheck, redisCheck, dbCheck].every(
        result => result.status === 'fulfilled' && result.value.status === 'pass'
      );

      if (isReady) {
        res.status(200).json({
          status: 'ready',
          timestamp: new Date(),
          checks: {
            azure_openai: 'ready',
            redis: 'ready',
            database: 'ready'
          }
        });
      } else {
        res.status(503).json({
          status: 'not_ready',
          timestamp: new Date(),
          checks: {
            azure_openai: azureCheck.status === 'fulfilled' ? azureCheck.value.status : 'fail',
            redis: redisCheck.status === 'fulfilled' ? redisCheck.value.status : 'fail',
            database: dbCheck.status === 'fulfilled' ? dbCheck.value.status : 'fail'
          }
        });
      }

    } catch (error) {
      this.logger.error('Readiness check failed', error);
      res.status(503).json({
        status: 'not_ready',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  /**
   * 检查服务自身状态
   */
  private async checkService(): Promise<HealthCheck> {
    const checkStart = Date.now();

    try {
      // 检查服务核心功能
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();

      return {
        status: 'pass',
        message: 'Service is operational',
        responseTime: Date.now() - checkStart,
        metadata: {
          uptime: uptime,
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
          },
          nodeVersion: process.version,
          environment: config.environment
        }
      };

    } catch (error) {
      return {
        status: 'fail',
        message: 'Service check failed',
        responseTime: Date.now() - checkStart,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * 检查 Azure OpenAI 连接
   */
  private async checkAzureOpenAI(): Promise<HealthCheck> {
    const checkStart = Date.now();

    try {
      if (!this.openaiClient) {
        throw new Error('OpenAI client not initialized');
      }

      // 执行一个简单的测试请求
      const response = await this.openaiClient.getChatCompletions(
        config.azure.deploymentName,
        [{ role: 'user', content: 'test' }],
        { maxTokens: 5 }
      );

      if (response.choices && response.choices.length > 0) {
        return {
          status: 'pass',
          message: 'Azure OpenAI is responsive',
          responseTime: Date.now() - checkStart,
          metadata: {
            endpoint: config.azure.endpoint,
            deployment: config.azure.deploymentName,
            model: response.model
          }
        };
      } else {
        throw new Error('Invalid response from Azure OpenAI');
      }

    } catch (error) {
      return {
        status: 'fail',
        message: 'Azure OpenAI check failed',
        responseTime: Date.now() - checkStart,
        metadata: { 
          error: error instanceof Error ? error.message : String(error),
          endpoint: config.azure.endpoint
        }
      };
    }
  }

  /**
   * 检查 Redis 连接
   */
  private async checkRedis(): Promise<HealthCheck> {
    const checkStart = Date.now();

    try {
      if (!this.redisClient) {
        throw new Error('Redis client not initialized');
      }

      // 执行 ping 命令
      const result = await this.redisClient.ping();
      
      if (result === 'PONG') {
        // 测试读写操作
        const testKey = 'health_check_test';
        const testValue = Date.now().toString();
        
        await this.redisClient.set(testKey, testValue, { EX: 60 });
        const retrievedValue = await this.redisClient.get(testKey);
        
        if (retrievedValue === testValue) {
          await this.redisClient.del(testKey);
          
          return {
            status: 'pass',
            message: 'Redis is responsive',
            responseTime: Date.now() - checkStart,
            metadata: {
              url: config.redis.url,
              ping: result
            }
          };
        } else {
          throw new Error('Redis read/write test failed');
        }
      } else {
        throw new Error(`Unexpected ping response: ${result}`);
      }

    } catch (error) {
      return {
        status: 'fail',
        message: 'Redis check failed',
        responseTime: Date.now() - checkStart,
        metadata: { 
          error: error instanceof Error ? error.message : String(error),
          url: config.redis.url
        }
      };
    }
  }

  /**
   * 检查数据库连接
   */
  private async checkDatabase(): Promise<HealthCheck> {
    const checkStart = Date.now();

    try {
      if (!this.dbPool) {
        throw new Error('Database pool not initialized');
      }

      // 执行简单查询
      const client = await this.dbPool.connect();
      
      try {
        const result = await client.query('SELECT 1 as test, NOW() as timestamp');
        
        if (result.rows.length > 0 && result.rows[0].test === 1) {
          return {
            status: 'pass',
            message: 'Database is responsive',
            responseTime: Date.now() - checkStart,
            metadata: {
              totalCount: this.dbPool.totalCount,
              idleCount: this.dbPool.idleCount,
              waitingCount: this.dbPool.waitingCount,
              timestamp: result.rows[0].timestamp
            }
          };
        } else {
          throw new Error('Invalid database response');
        }
      } finally {
        client.release();
      }

    } catch (error) {
      return {
        status: 'fail',
        message: 'Database check failed',
        responseTime: Date.now() - checkStart,
        metadata: { 
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * 检查内存使用情况
   */
  private async checkMemory(): Promise<HealthCheck> {
    const checkStart = Date.now();

    try {
      const memUsage = process.memoryUsage();
      const totalMB = Math.round(memUsage.rss / 1024 / 1024);
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      
      // 假设内存使用超过 500MB 时发出警告，超过 1GB 时标记为失败
      let status: 'pass' | 'warn' | 'fail' = 'pass';
      let message = 'Memory usage is normal';
      
      if (totalMB > 1024) {
        status = 'fail';
        message = 'Memory usage is critical';
      } else if (totalMB > 512) {
        status = 'warn';
        message = 'Memory usage is elevated';
      }

      return {
        status,
        message,
        responseTime: Date.now() - checkStart,
        metadata: {
          rss: totalMB,
          heapUsed: heapUsedMB,
          heapTotal: heapTotalMB,
          external: Math.round(memUsage.external / 1024 / 1024),
          usage_percent: Math.round((heapUsedMB / heapTotalMB) * 100)
        }
      };

    } catch (error) {
      return {
        status: 'fail',
        message: 'Memory check failed',
        responseTime: Date.now() - checkStart,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * 检查磁盘使用情况
   */
  private async checkDisk(): Promise<HealthCheck> {
    const checkStart = Date.now();

    try {
      // 这里简化处理，实际生产环境可能需要更详细的磁盘检查
      const stats = await import('fs').then(fs => 
        fs.promises.stat('./').catch(() => null)
      );

      if (stats) {
        return {
          status: 'pass',
          message: 'Disk access is normal',
          responseTime: Date.now() - checkStart,
          metadata: {
            accessible: true,
            size: stats.size,
            modified: stats.mtime
          }
        };
      } else {
        throw new Error('Unable to access disk');
      }

    } catch (error) {
      return {
        status: 'fail',
        message: 'Disk check failed',
        responseTime: Date.now() - checkStart,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * 从 Promise 结果中提取健康检查结果
   */
  private getCheckResult(result: PromiseSettledResult<HealthCheck>): HealthCheck {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        status: 'fail',
        message: 'Check failed with exception',
        metadata: { error: result.reason }
      };
    }
  }

  /**
   * 确定整体健康状态
   */
  private determineOverallStatus(checks: Record<string, HealthCheck>): 'healthy' | 'degraded' | 'unhealthy' {
    const checkValues = Object.values(checks);
    const failedChecks = checkValues.filter(check => check.status === 'fail');
    const warnChecks = checkValues.filter(check => check.status === 'warn');

    if (failedChecks.length > 0) {
      // 如果关键服务失败，则整体不健康
      const criticalFailed = failedChecks.some(check => 
        checks.service === check || 
        checks.azure_openai === check
      );
      
      return criticalFailed ? 'unhealthy' : 'degraded';
    } else if (warnChecks.length > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      if (this.dbPool) {
        await this.dbPool.end();
      }
      this.logger.info('Health controller cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup health controller', error);
    }
  }
}