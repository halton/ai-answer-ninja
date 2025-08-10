import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { config, isDevelopment, isProduction } from '@/config';
import { logger } from '@/utils/logger';
import { database } from '@/services/database';
import { redisService } from '@/services/redis';

// Import middleware
import {
  errorHandler,
  notFoundHandler,
  uncaughtExceptionHandler,
  unhandledRejectionHandler,
  securityHeaders,
  requestTimeout,
  bodySizeLimitErrorHandler,
  gracefulShutdown,
  healthCheck,
  deepHealthCheck,
  requestId,
  corsHandler
} from '@/middleware/error';

import {
  generalRateLimit,
  authRateLimit,
  passwordResetRateLimit,
  securityHeaders as additionalSecurityHeaders,
  preventNoSQLInjection,
  preventParameterPollution,
  validateUserAgent,
  bruteForcePrevention,
  cleanupBruteForceTracking,
  validateContentType
} from '@/middleware/security';

import {
  authenticate,
  optionalAuthenticate,
  requireValidSession,
  requireEmailVerification,
  extractRequestContext,
  authCors,
  logApiAccess
} from '@/middleware/auth';

import { sanitizeRequestBody } from '@/middleware/validation';

// Import routes (we'll create these)
// import authRoutes from '@/routes/auth';
// import userRoutes from '@/routes/user';
// import adminRoutes from '@/routes/admin';
// import mfaRoutes from '@/routes/mfa';

/**
 * AI Answer Ninja User Management Service
 * Comprehensive authentication, authorization, and user management system
 */
class UserManagementServer {
  private app: express.Application;
  private server: any;

  constructor() {
    this.app = express();
    this.setupGlobalErrorHandlers();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    process.on('uncaughtException', uncaughtExceptionHandler);
    process.on('unhandledRejection', unhandledRejectionHandler);
    process.on('SIGTERM', gracefulShutdown(this.server));
    process.on('SIGINT', gracefulShutdown(this.server));
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Trust proxy for proper IP detection
    this.app.set('trust proxy', 1);

    // Request ID and context
    this.app.use(requestId);
    this.app.use(extractRequestContext);

    // Security headers
    this.app.use(helmet());
    this.app.use(securityHeaders);
    this.app.use(additionalSecurityHeaders);

    // CORS configuration
    this.app.use(corsHandler);
    this.app.use(authCors);

    // Request timeout
    this.app.use(requestTimeout(30000)); // 30 seconds

    // Body parsing with size limits
    this.app.use(express.json({ 
      limit: '10mb',
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      }
    }));
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));
    this.app.use(cookieParser());

    // Body size limit error handler
    this.app.use(bodySizeLimitErrorHandler);

    // Compression
    this.app.use(compression());

    // Request logging
    if (isDevelopment) {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined', {
        stream: {
          write: (message: string) => {
            logger.info(message.trim());
          }
        }
      }));
    }

    // API access logging
    this.app.use(logApiAccess);

    // Security middleware
    this.app.use(validateUserAgent);
    this.app.use(preventNoSQLInjection);
    this.app.use(preventParameterPollution);
    this.app.use(sanitizeRequestBody);
    this.app.use(validateContentType(['application/json', 'application/x-www-form-urlencoded']));

    // Rate limiting
    this.app.use('/api/', generalRateLimit);
    this.app.use('/api/auth/', authRateLimit);
    this.app.use('/api/auth/password-reset', passwordResetRateLimit);

    // Brute force protection
    this.app.use('/api/auth/login', bruteForcePrevention({
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxAttempts: 5,
      blockDuration: 60 * 60 * 1000 // 1 hour
    }));
    this.app.use(cleanupBruteForceTracking);
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check endpoints
    this.app.get('/health', healthCheck);
    this.app.get('/health/deep', deepHealthCheck);

    // API documentation
    this.app.get('/', (req, res) => {
      res.json({
        service: 'AI Answer Ninja - User Management Service',
        version: process.env.npm_package_version || '1.0.0',
        environment: config.nodeEnv,
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          deepHealth: '/health/deep',
          auth: '/api/auth/*',
          users: '/api/users/*',
          admin: '/api/admin/*',
          mfa: '/api/mfa/*'
        }
      });
    });

    // Placeholder for route implementations
    // TODO: Implement actual routes
    this.app.use('/api/auth', this.createPlaceholderRouter('Authentication routes'));
    this.app.use('/api/users', authenticate, this.createPlaceholderRouter('User management routes'));
    this.app.use('/api/admin', authenticate, this.createPlaceholderRouter('Admin routes'));
    this.app.use('/api/mfa', authenticate, this.createPlaceholderRouter('MFA routes'));

    // API documentation placeholder
    this.app.get('/api', (req, res) => {
      res.json({
        message: 'AI Answer Ninja User Management API',
        version: '1.0.0',
        documentation: '/api/docs',
        endpoints: {
          authentication: '/api/auth',
          users: '/api/users',
          admin: '/api/admin',
          mfa: '/api/mfa'
        }
      });
    });
  }

  /**
   * Create placeholder router for development
   */
  private createPlaceholderRouter(description: string): express.Router {
    const router = express.Router();
    
    router.all('*', (req, res) => {
      res.status(501).json({
        success: false,
        message: `${description} - Not implemented yet`,
        endpoint: req.originalUrl,
        method: req.method,
        note: 'This endpoint is under development'
      });
    });

    return router;
  }

  /**
   * Setup error handling middleware
   */
  private setupErrorHandling(): void {
    // 404 handler for unknown routes
    this.app.use(notFoundHandler);

    // Global error handler (must be last)
    this.app.use(errorHandler);
  }

  /**
   * Initialize database connections
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await database.connect();
      logger.info('Database connection established');
      
      // Run cleanup on startup
      const cleanupResult = await database.cleanupExpiredData();
      logger.info('Startup cleanup completed', cleanupResult);
    } catch (error) {
      logger.error('Database initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Initialize Redis connection
   */
  private async initializeRedis(): Promise<void> {
    try {
      await redisService.connect();
      logger.info('Redis connection established');
    } catch (error) {
      logger.error('Redis initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Setup periodic cleanup tasks
   */
  private setupCleanupTasks(): void {
    // Cleanup expired data every hour
    setInterval(async () => {
      try {
        const result = await database.cleanupExpiredData();
        logger.info('Periodic cleanup completed', result);
      } catch (error) {
        logger.error('Periodic cleanup failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 60 * 60 * 1000); // 1 hour

    // Log system metrics every 5 minutes
    setInterval(async () => {
      try {
        const [dbStats, redisHealthy] = await Promise.all([
          database.getStats(),
          redisService.ping()
        ]);

        logger.info('System metrics', {
          database: dbStats,
          redis: { healthy: redisHealthy },
          memory: process.memoryUsage(),
          uptime: process.uptime()
        });
      } catch (error) {
        logger.error('Failed to collect system metrics', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Initialize external dependencies
      await this.initializeDatabase();
      await this.initializeRedis();

      // Setup periodic tasks
      this.setupCleanupTasks();

      // Start HTTP server
      this.server = this.app.listen(config.port, () => {
        logger.info(`🚀 User Management Service started`, {
          port: config.port,
          environment: config.nodeEnv,
          nodeVersion: process.version,
          pid: process.pid
        });

        if (isDevelopment) {
          logger.info(`📖 API Documentation: http://localhost:${config.port}/api`);
          logger.info(`🏥 Health Check: http://localhost:${config.port}/health`);
        }
      });

      // Handle server errors
      this.server.on('error', (error: Error) => {
        logger.error('Server error', { error: error.message });
      });

      // Handle graceful shutdown
      const shutdown = gracefulShutdown(this.server);
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
      logger.error('Failed to start server', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      process.exit(1);
    }
  }

  /**
   * Stop the server gracefully
   */
  public async stop(): Promise<void> {
    try {
      logger.info('Stopping User Management Service...');

      // Close HTTP server
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          this.server.close((err?: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // Close database connection
      await database.disconnect();

      // Close Redis connection
      await redisService.disconnect();

      logger.info('User Management Service stopped gracefully');
    } catch (error) {
      logger.error('Error during server shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get Express app instance
   */
  public getApp(): express.Application {
    return this.app;
  }
}

// Create and export server instance
const server = new UserManagementServer();

// Start server if this file is run directly
if (require.main === module) {
  server.start().catch((error) => {
    logger.error('Failed to start User Management Service', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  });
}

export default server;
export { UserManagementServer };