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
    this.app.use(helmet());\n    this.app.use(securityHeaders);\n    this.app.use(additionalSecurityHeaders);\n\n    // CORS configuration\n    this.app.use(corsHandler);\n    this.app.use(authCors);\n\n    // Request timeout\n    this.app.use(requestTimeout(30000)); // 30 seconds\n\n    // Body parsing with size limits\n    this.app.use(express.json({ \n      limit: '10mb',\n      verify: (req: any, res, buf) => {\n        req.rawBody = buf;\n      }\n    }));\n    this.app.use(express.urlencoded({ \n      extended: true, \n      limit: '10mb' \n    }));\n    this.app.use(cookieParser());\n\n    // Body size limit error handler\n    this.app.use(bodySizeLimitErrorHandler);\n\n    // Compression\n    this.app.use(compression());\n\n    // Request logging\n    if (isDevelopment) {\n      this.app.use(morgan('dev'));\n    } else {\n      this.app.use(morgan('combined', {\n        stream: {\n          write: (message: string) => {\n            logger.info(message.trim());\n          }\n        }\n      }));\n    }\n\n    // API access logging\n    this.app.use(logApiAccess);\n\n    // Security middleware\n    this.app.use(validateUserAgent);\n    this.app.use(preventNoSQLInjection);\n    this.app.use(preventParameterPollution);\n    this.app.use(sanitizeRequestBody);\n    this.app.use(validateContentType(['application/json', 'application/x-www-form-urlencoded']));\n\n    // Rate limiting\n    this.app.use('/api/', generalRateLimit);\n    this.app.use('/api/auth/', authRateLimit);\n    this.app.use('/api/auth/password-reset', passwordResetRateLimit);\n\n    // Brute force protection\n    this.app.use('/api/auth/login', bruteForcePrevention({\n      windowMs: 15 * 60 * 1000, // 15 minutes\n      maxAttempts: 5,\n      blockDuration: 60 * 60 * 1000 // 1 hour\n    }));\n    this.app.use(cleanupBruteForceTracking);\n  }\n\n  /**\n   * Setup API routes\n   */\n  private setupRoutes(): void {\n    // Health check endpoints\n    this.app.get('/health', healthCheck);\n    this.app.get('/health/deep', deepHealthCheck);\n\n    // API documentation\n    this.app.get('/', (req, res) => {\n      res.json({\n        service: 'AI Answer Ninja - User Management Service',\n        version: process.env.npm_package_version || '1.0.0',\n        environment: config.nodeEnv,\n        status: 'running',\n        timestamp: new Date().toISOString(),\n        endpoints: {\n          health: '/health',\n          deepHealth: '/health/deep',\n          auth: '/api/auth/*',\n          users: '/api/users/*',\n          admin: '/api/admin/*',\n          mfa: '/api/mfa/*'\n        }\n      });\n    });\n\n    // Placeholder for route implementations\n    // TODO: Implement actual routes\n    this.app.use('/api/auth', this.createPlaceholderRouter('Authentication routes'));\n    this.app.use('/api/users', authenticate, this.createPlaceholderRouter('User management routes'));\n    this.app.use('/api/admin', authenticate, this.createPlaceholderRouter('Admin routes'));\n    this.app.use('/api/mfa', authenticate, this.createPlaceholderRouter('MFA routes'));\n\n    // API documentation placeholder\n    this.app.get('/api', (req, res) => {\n      res.json({\n        message: 'AI Answer Ninja User Management API',\n        version: '1.0.0',\n        documentation: '/api/docs',\n        endpoints: {\n          authentication: '/api/auth',\n          users: '/api/users',\n          admin: '/api/admin',\n          mfa: '/api/mfa'\n        }\n      });\n    });\n  }\n\n  /**\n   * Create placeholder router for development\n   */\n  private createPlaceholderRouter(description: string): express.Router {\n    const router = express.Router();\n    \n    router.all('*', (req, res) => {\n      res.status(501).json({\n        success: false,\n        message: `${description} - Not implemented yet`,\n        endpoint: req.originalUrl,\n        method: req.method,\n        note: 'This endpoint is under development'\n      });\n    });\n\n    return router;\n  }\n\n  /**\n   * Setup error handling middleware\n   */\n  private setupErrorHandling(): void {\n    // 404 handler for unknown routes\n    this.app.use(notFoundHandler);\n\n    // Global error handler (must be last)\n    this.app.use(errorHandler);\n  }\n\n  /**\n   * Initialize database connections\n   */\n  private async initializeDatabase(): Promise<void> {\n    try {\n      await database.connect();\n      logger.info('Database connection established');\n      \n      // Run cleanup on startup\n      const cleanupResult = await database.cleanupExpiredData();\n      logger.info('Startup cleanup completed', cleanupResult);\n    } catch (error) {\n      logger.error('Database initialization failed', {\n        error: error instanceof Error ? error.message : 'Unknown error'\n      });\n      throw error;\n    }\n  }\n\n  /**\n   * Initialize Redis connection\n   */\n  private async initializeRedis(): Promise<void> {\n    try {\n      await redisService.connect();\n      logger.info('Redis connection established');\n    } catch (error) {\n      logger.error('Redis initialization failed', {\n        error: error instanceof Error ? error.message : 'Unknown error'\n      });\n      throw error;\n    }\n  }\n\n  /**\n   * Setup periodic cleanup tasks\n   */\n  private setupCleanupTasks(): void {\n    // Cleanup expired data every hour\n    setInterval(async () => {\n      try {\n        const result = await database.cleanupExpiredData();\n        logger.info('Periodic cleanup completed', result);\n      } catch (error) {\n        logger.error('Periodic cleanup failed', {\n          error: error instanceof Error ? error.message : 'Unknown error'\n        });\n      }\n    }, 60 * 60 * 1000); // 1 hour\n\n    // Log system metrics every 5 minutes\n    setInterval(async () => {\n      try {\n        const [dbStats, redisHealthy] = await Promise.all([\n          database.getStats(),\n          redisService.ping()\n        ]);\n\n        logger.info('System metrics', {\n          database: dbStats,\n          redis: { healthy: redisHealthy },\n          memory: process.memoryUsage(),\n          uptime: process.uptime()\n        });\n      } catch (error) {\n        logger.error('Failed to collect system metrics', {\n          error: error instanceof Error ? error.message : 'Unknown error'\n        });\n      }\n    }, 5 * 60 * 1000); // 5 minutes\n  }\n\n  /**\n   * Start the server\n   */\n  public async start(): Promise<void> {\n    try {\n      // Initialize external dependencies\n      await this.initializeDatabase();\n      await this.initializeRedis();\n\n      // Setup periodic tasks\n      this.setupCleanupTasks();\n\n      // Start HTTP server\n      this.server = this.app.listen(config.port, () => {\n        logger.info(`🚀 User Management Service started`, {\n          port: config.port,\n          environment: config.nodeEnv,\n          nodeVersion: process.version,\n          pid: process.pid\n        });\n\n        if (isDevelopment) {\n          logger.info(`📖 API Documentation: http://localhost:${config.port}/api`);\n          logger.info(`🏥 Health Check: http://localhost:${config.port}/health`);\n        }\n      });\n\n      // Handle server errors\n      this.server.on('error', (error: Error) => {\n        logger.error('Server error', { error: error.message });\n      });\n\n      // Handle graceful shutdown\n      const shutdown = gracefulShutdown(this.server);\n      process.on('SIGTERM', () => shutdown('SIGTERM'));\n      process.on('SIGINT', () => shutdown('SIGINT'));\n\n    } catch (error) {\n      logger.error('Failed to start server', {\n        error: error instanceof Error ? error.message : 'Unknown error'\n      });\n      process.exit(1);\n    }\n  }\n\n  /**\n   * Stop the server gracefully\n   */\n  public async stop(): Promise<void> {\n    try {\n      logger.info('Stopping User Management Service...');\n\n      // Close HTTP server\n      if (this.server) {\n        await new Promise<void>((resolve, reject) => {\n          this.server.close((err?: Error) => {\n            if (err) reject(err);\n            else resolve();\n          });\n        });\n      }\n\n      // Close database connection\n      await database.disconnect();\n\n      // Close Redis connection\n      await redisService.disconnect();\n\n      logger.info('User Management Service stopped gracefully');\n    } catch (error) {\n      logger.error('Error during server shutdown', {\n        error: error instanceof Error ? error.message : 'Unknown error'\n      });\n      throw error;\n    }\n  }\n\n  /**\n   * Get Express app instance\n   */\n  public getApp(): express.Application {\n    return this.app;\n  }\n}\n\n// Create and export server instance\nconst server = new UserManagementServer();\n\n// Start server if this file is run directly\nif (require.main === module) {\n  server.start().catch((error) => {\n    logger.error('Failed to start User Management Service', {\n      error: error instanceof Error ? error.message : 'Unknown error'\n    });\n    process.exit(1);\n  });\n}\n\nexport default server;\nexport { UserManagementServer };