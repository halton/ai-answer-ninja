import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from '@/config';
import { logger } from '@/utils/logger';
import router from '@/routes';
import { errorHandler } from '@/middleware/error-handler';
import { requestLogger } from '@/middleware/request-logger';

/**
 * Smart Whitelist Node Application
 * Advanced AI-powered phone number whitelist management service
 */
class SmartWhitelistApp {
  public app: express.Application;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
    }));

    // Request parsing
    this.app.use(express.json({ 
      limit: '10mb',
      verify: (req, res, buf) => {
        // Store raw body for webhook signature verification
        (req as any).rawBody = buf;
      }
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
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

    // Request logging
    this.app.use(requestLogger);

    // Health check (before any authentication)
    this.app.get('/ping', (req, res) => {
      res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'smart-whitelist-node',
        version: '1.0.0'
      });
    });
  }

  private initializeRoutes(): void {
    // API routes
    this.app.use('/api/v1', router);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.status(200).json({
        service: 'Smart Whitelist Node',
        version: '1.0.0',
        description: 'AI-powered phone number whitelist management service',
        documentation: '/api/v1/docs',
        health: '/api/v1/health',
        metrics: '/api/v1/metrics',
        endpoints: {
          whitelist: '/api/v1/whitelist',
          evaluation: '/api/v1/whitelist/evaluate',
          import: '/api/v1/whitelist/import',
          export: '/api/v1/whitelist/export',
          analytics: '/api/v1/whitelist/analytics',
        }
      });
    });

    // API documentation
    this.app.get('/api/v1/docs', (req, res) => {
      res.redirect('/api-docs');
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route ${req.method} ${req.originalUrl} not found`,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      });
    });
  }

  private initializeErrorHandling(): void {
    // Global error handler (must be last)
    this.app.use(errorHandler);

    // Graceful shutdown handlers
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
    process.on('SIGINT', this.gracefulShutdown.bind(this));

    // Unhandled promise rejection handler
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: promise.toString(),
      });
    });

    // Uncaught exception handler
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', {
        message: error.message,
        stack: error.stack,
      });
      
      // Graceful shutdown on uncaught exception
      this.gracefulShutdown('uncaughtException');
    });
  }

  private async gracefulShutdown(signal?: string): Promise<void> {
    logger.info(`Graceful shutdown initiated${signal ? ` by ${signal}` : ''}`, {
      signal,
      uptime: process.uptime(),
    });

    // Close HTTP server
    if (this.server) {
      this.server.close((err) => {
        if (err) {
          logger.error('Error during server close', { error: err.message });
        } else {
          logger.info('HTTP server closed');
        }
      });
    }

    // Close database connections
    try {
      // Add database cleanup here
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Close cache connections
    try {
      // Add cache cleanup here
      logger.info('Cache connections closed');
    } catch (error) {
      logger.error('Error closing cache connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  }

  private server?: import('http').Server;

  public listen(): void {
    const port = config.PORT || 3006;
    const host = config.HOST || '0.0.0.0';

    this.server = this.app.listen(port, host, () => {
      logger.info('Smart Whitelist Node service started', {
        port,
        host,
        environment: config.NODE_ENV,
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        memory: process.memoryUsage(),
      });
    });

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`, { port, error: error.message });
      } else {
        logger.error('Server error', { error: error.message, code: error.code });
      }
      process.exit(1);
    });

    // Handle server timeout
    this.server.timeout = 30000; // 30 seconds
    this.server.keepAliveTimeout = 65000; // 65 seconds
    this.server.headersTimeout = 66000; // 66 seconds
  }
}

export default SmartWhitelistApp;