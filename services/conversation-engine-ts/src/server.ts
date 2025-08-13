import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { Routes } from '@/routes';
import { Logger } from '@/utils/logger';
import config from '@/config';

/**
 * 对话引擎服务器
 */
export class ConversationEngineServer {
  private app: Application;
  private logger: Logger;
  private routes: Routes;
  private server?: any;

  constructor() {
    this.app = express();
    this.logger = new Logger('ConversationEngineServer');
    this.routes = new Routes();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 安全中间件
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS 配置
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
      maxAge: 86400 // 24 hours
    }));

    // 压缩响应
    this.app.use(compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      }
    }));

    // 请求解析
    this.app.use(express.json({ 
      limit: '10mb',
      strict: true
    }));
    
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));

    // 请求日志
    if (config.logging.enableRequestLogging) {
      this.app.use(morgan('combined', {
        stream: {
          write: (message: string) => {
            this.logger.info(message.trim(), { type: 'request_log' });
          }
        },
        skip: (req: Request) => {
          // 跳过健康检查请求的日志
          return req.path.startsWith('/health');
        }
      }));
    }

    // 请求 ID 和时间戳
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const startTime = Date.now();
      
      // 添加到请求对象
      (req as any).requestId = requestId;
      (req as any).startTime = startTime;
      
      // 添加响应头
      res.setHeader('X-Request-ID', requestId);
      res.setHeader('X-Service-Name', config.serviceName);
      res.setHeader('X-Service-Version', '1.0.0');
      
      next();
    });

    // 速率限制（简单实现）
    this.app.use(this.rateLimitMiddleware());

    this.logger.info('Middleware configured successfully');
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 根路径响应
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        message: 'AI Answer Ninja - Conversation Engine Service',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date(),
        documentation: '/api/v1/info',
        health: '/health'
      });
    });

    // 挂载主路由
    this.app.use('/', this.routes.getRouter());

    this.logger.info('Routes configured successfully');
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    // 全局错误处理中间件
    this.app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId || 'unknown';
      const startTime = (req as any).startTime || Date.now();

      this.logger.error('Unhandled error', error, {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // 确保不会重复发送响应
      if (res.headersSent) {
        return next(error);
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: config.environment === 'development' ? error.message : undefined
        },
        metadata: {
          requestId,
          timestamp: new Date(),
          processingTime: Date.now() - startTime
        }
      });
    });

    // 处理 404 错误
    this.app.use('*', (req: Request, res: Response) => {
      const requestId = (req as any).requestId || 'unknown';
      
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
          path: req.originalUrl
        },
        metadata: {
          requestId,
          timestamp: new Date()
        }
      });
    });

    this.logger.info('Error handling configured successfully');
  }

  /**
   * 简单的速率限制中间件
   */
  private rateLimitMiddleware() {
    const requestCounts = new Map<string, { count: number; resetTime: number }>();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 100; // 每分钟最多100个请求

    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const key = `${ip}:${Math.floor(now / windowMs)}`;

      const current = requestCounts.get(key) || { count: 0, resetTime: now + windowMs };
      current.count++;

      if (current.count > maxRequests) {
        res.status(429).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Rate limit exceeded',
            retryAfter: Math.ceil((current.resetTime - now) / 1000)
          }
        });
        return;
      }

      requestCounts.set(key, current);

      // 清理过期的记录
      if (requestCounts.size > 1000) {
        for (const [k, v] of requestCounts.entries()) {
          if (v.resetTime < now) {
            requestCounts.delete(k);
          }
        }
      }

      next();
    };
  }

  /**
   * 启动服务器
   */
  public async start(): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.server = this.app.listen(config.port, () => {
          this.logger.info(`Conversation Engine Server started`, {
            port: config.port,
            environment: config.environment,
            serviceName: config.serviceName,
            nodeVersion: process.version,
            processId: process.pid
          });
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('Server startup error', error);
          reject(error);
        });
      });

      // 打印路由列表（开发环境）
      if (config.environment === 'development') {
        const routes = this.routes.getRoutesList();
        this.logger.info('Available routes:', { routes });
      }

    } catch (error) {
      this.logger.error('Failed to start server', error);
      throw error;
    }
  }

  /**
   * 停止服务器
   */
  public async stop(): Promise<void> {
    try {
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          this.server.close((error: Error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }

      // 清理资源
      await this.routes.cleanup();

      this.logger.info('Conversation Engine Server stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping server', error);
      throw error;
    }
  }

  /**
   * 获取 Express 应用实例
   */
  public getApp(): Application {
    return this.app;
  }

  /**
   * 优雅关闭处理
   */
  public setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, starting graceful shutdown`);
      
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during graceful shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection', reason, { promise });
      process.exit(1);
    });
  }
}

// 启动服务器（如果直接运行此文件）
if (require.main === module) {
  const server = new ConversationEngineServer();
  
  server.setupGracefulShutdown();
  
  server.start().catch((error) => {
    console.error('Failed to start Conversation Engine Server:', error);
    process.exit(1);
  });
}

export default ConversationEngineServer;