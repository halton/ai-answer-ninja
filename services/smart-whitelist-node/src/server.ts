import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

import { config } from '@/config';
import { logger } from '@/utils/logger';
import { db } from '@/utils/database';
import { redis } from '@/cache/redis-client';

// Middleware
import { 
  errorHandler, 
  notFoundHandler, 
  asyncHandler, 
  timeoutHandler,
  addRequestTime,
  responseTimer,
} from '@/middleware/error-handler';
import { 
  authenticate, 
  optionalAuthenticate,
  validateUserOwnership,
  userRateLimit,
} from '@/middleware/auth';
import { validate } from '@/middleware/validation';

// Controllers
import { whitelistController } from '@/controllers/whitelist-controller';
import { healthController } from '@/controllers/health-controller';

// Validation schemas
import { 
  whitelistSchemas,
  batchSchemas,
  importExportSchemas,
} from '@/middleware/validation';

class SmartWhitelistServer {
  private app: express.Application;
  private server?: any;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Basic middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Allow API usage
    }));

    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    }));

    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request ID middleware
    this.app.use((req, res, next) => {
      req.headers['x-request-id'] = req.headers['x-request-id'] || uuidv4();
      res.setHeader('X-Request-ID', req.headers['x-request-id']);
      next();
    });

    // Timing middleware
    this.app.use(addRequestTime);
    this.app.use(responseTimer);

    // Global rate limiting
    this.app.use(rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW,
      max: config.RATE_LIMIT_MAX,
      message: {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests from this IP, please try again later.',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      standardHeaders: true,
      legacyHeaders: false,
    }));

    // Request timeout
    this.app.use(timeoutHandler(config.REQUEST_TIMEOUT));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        requestId: req.headers['x-request-id'],
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check routes (no authentication required)
    this.app.get('/health', asyncHandler(healthController.basicHealth.bind(healthController)));
    this.app.get('/health/live', asyncHandler(healthController.liveness.bind(healthController)));
    this.app.get('/health/ready', asyncHandler(healthController.readiness.bind(healthController)));
    this.app.get('/health/deep', asyncHandler(healthController.deepHealth.bind(healthController)));
    this.app.get('/health/performance', asyncHandler(healthController.performance.bind(healthController)));
    this.app.get('/metrics', asyncHandler(healthController.metrics.bind(healthController)));

    // API routes with authentication
    const apiRouter = express.Router();

    // Core whitelist operations
    apiRouter.get('/whitelist/:userId',
      authenticate,
      validateUserOwnership('userId'),
      userRateLimit(200, 15), // Higher limit for read operations
      validate(whitelistSchemas.getUserWhitelist),
      asyncHandler(whitelistController.getUserWhitelist.bind(whitelistController))
    );

    apiRouter.post('/whitelist',
      authenticate,
      userRateLimit(50, 15), // Lower limit for write operations
      validate(whitelistSchemas.createWhitelist),
      asyncHandler(whitelistController.createWhitelistEntry.bind(whitelistController))
    );

    apiRouter.put('/whitelist/:id',
      authenticate,
      userRateLimit(50, 15),
      validate(whitelistSchemas.updateWhitelist),
      asyncHandler(whitelistController.updateWhitelistEntry.bind(whitelistController))
    );

    apiRouter.delete('/whitelist/:id',
      authenticate,
      userRateLimit(50, 15),
      validate(whitelistSchemas.deleteWhitelist),
      asyncHandler(whitelistController.deleteWhitelistEntry.bind(whitelistController))
    );

    // Smart operations
    apiRouter.post('/whitelist/smart-add',
      authenticate,
      userRateLimit(20, 15), // More restrictive for AI operations
      validate(whitelistSchemas.smartAdd),
      asyncHandler(whitelistController.smartAdd.bind(whitelistController))
    );

    apiRouter.post('/whitelist/evaluate',
      optionalAuthenticate, // Allow unauthenticated evaluation
      userRateLimit(100, 15),
      validate(whitelistSchemas.evaluatePhone),
      asyncHandler(whitelistController.evaluatePhone.bind(whitelistController))
    );

    apiRouter.post('/whitelist/learning',
      authenticate,
      userRateLimit(100, 15),
      validate(whitelistSchemas.recordLearning),
      asyncHandler(whitelistController.recordLearning.bind(whitelistController))
    );

    // Rules management
    apiRouter.get('/whitelist/rules/:userId',
      authenticate,
      validateUserOwnership('userId'),
      userRateLimit(50, 15),
      validate(whitelistSchemas.getUserRules),
      asyncHandler(whitelistController.getUserRules.bind(whitelistController))
    );

    apiRouter.put('/whitelist/rules/:userId',
      authenticate,
      validateUserOwnership('userId'),
      userRateLimit(10, 15), // Very restrictive for rule changes
      validate(whitelistSchemas.updateUserRules),
      asyncHandler(whitelistController.updateUserRules.bind(whitelistController))
    );

    // Batch operations
    apiRouter.post('/whitelist/batch',
      authenticate,
      userRateLimit(5, 60), // Very restrictive for batch operations
      validate(batchSchemas.batchCreate),
      asyncHandler(whitelistController.batchCreate.bind(whitelistController))
    );

    apiRouter.put('/whitelist/batch',
      authenticate,
      userRateLimit(5, 60),
      validate(batchSchemas.batchUpdate),
      asyncHandler(whitelistController.batchUpdate.bind(whitelistController))
    );

    apiRouter.delete('/whitelist/batch',
      authenticate,
      userRateLimit(5, 60),
      validate(batchSchemas.batchDelete),
      asyncHandler(whitelistController.batchDelete.bind(whitelistController))
    );

    // Import/Export
    apiRouter.post('/whitelist/import',
      authenticate,
      userRateLimit(2, 60), // Very restrictive for imports
      validate(importExportSchemas.importWhitelist),
      asyncHandler(whitelistController.importWhitelist.bind(whitelistController))
    );

    apiRouter.get('/whitelist/export/:userId',
      authenticate,
      validateUserOwnership('userId'),
      userRateLimit(5, 60), // Restrictive for exports
      validate(importExportSchemas.exportWhitelist),
      asyncHandler(whitelistController.exportWhitelist.bind(whitelistController))
    );

    // Statistics
    apiRouter.get('/whitelist/stats/:userId',
      authenticate,
      validateUserOwnership('userId'),
      userRateLimit(20, 15),
      validate({ params: whitelistSchemas.getUserRules.params }),
      asyncHandler(whitelistController.getUserStats.bind(whitelistController))
    );

    // Mount API router
    this.app.use('/api/v1', apiRouter);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        service: 'Smart Whitelist Service',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          api: '/api/v1',
          documentation: '/api/v1/docs',
        },
      });
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);
  }

  async start(): Promise<void> {
    try {
      // Initialize database connection
      await db.connect();
      logger.info('Database connected successfully');

      // Initialize Redis connection
      await redis.connect();
      logger.info('Redis connected successfully');

      // Start HTTP server
      this.server = this.app.listen(config.PORT, config.HOST, () => {
        logger.info('Smart Whitelist Service started', {
          host: config.HOST,
          port: config.PORT,
          environment: config.NODE_ENV,
          timestamp: new Date().toISOString(),
        });

        // Log service configuration
        logger.info('Service configuration', {
          database: {
            host: config.DB_HOST,
            port: config.DB_PORT,
            database: config.DB_NAME,
          },
          redis: {
            host: config.REDIS_HOST,
            port: config.REDIS_PORT,
          },
          features: {
            mlEnabled: config.ML_ENABLED,
            metricsEnabled: config.METRICS_ENABLED,
          },
          performance: {
            requestTimeout: config.REQUEST_TIMEOUT,
            rateLimitWindow: config.RATE_LIMIT_WINDOW,
            rateLimitMax: config.RATE_LIMIT_MAX,
          },
        });
      });

      // Handle server errors
      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${config.PORT} is already in use`);
        } else {
          logger.error('Server error', { error: error.message, stack: error.stack });
        }
        process.exit(1);
      });

    } catch (error) {
      logger.error('Failed to start server', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    logger.info('Shutting down Smart Whitelist Service...');

    const gracefulShutdown = async () => {
      try {
        // Close HTTP server
        if (this.server) {
          await new Promise<void>((resolve) => {
            this.server.close(() => {
              logger.info('HTTP server closed');
              resolve();
            });
          });
        }

        // Close database connections
        await db.disconnect();
        logger.info('Database disconnected');

        // Close Redis connections
        await redis.disconnect();
        logger.info('Redis disconnected');

        logger.info('Smart Whitelist Service shut down gracefully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    };

    // Set a timeout for forced shutdown
    const forceShutdown = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT);

    await gracefulShutdown();
    clearTimeout(forceShutdown);
  }
}

// Create and start server
const server = new SmartWhitelistServer();

// Handle process signals
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  server.stop();
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  server.stop();
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  server.stop();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString(),
  });
  server.stop();
});

// Start the server
if (require.main === module) {
  server.start();
}

export default server;