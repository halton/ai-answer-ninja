import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ConfigurationService } from './services/ConfigurationService';
import { DatabaseService } from './services/DatabaseService';
import { CacheService } from './services/CacheService';
import { NotificationService } from './services/NotificationService';
import { HealthCheckService } from './services/HealthCheckService';
import { MetricsService } from './services/MetricsService';
import config from './config';
import logger from './utils/logger';
import { ConfigurationError } from './types/errors';
import * as routes from './routes';

export class ConfigurationServer {
  private app: express.Application;
  private server: any;
  private configService: ConfigurationService;
  private database: DatabaseService;
  private cache: CacheService;
  private notifications: NotificationService;
  private healthCheck: HealthCheckService;
  private metrics: MetricsService;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    
    // Initialize services
    this.database = new DatabaseService(config.database);
    this.cache = new CacheService(config.redis);
    this.notifications = new NotificationService();
    this.metrics = new MetricsService();
    this.configService = new ConfigurationService(
      this.database,
      this.cache,
      this.notifications
    );
    
    this.healthCheck = new HealthCheckService({
      database: this.database,
      cache: this.cache,
      configService: this.configService,
      metrics: this.metrics
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false // Allow for admin UI if needed
    }));
    
    // CORS configuration
    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
    }));

    // Compression
    if (config.performance.compressionEnabled) {
      this.app.use(compression());
    }

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.security.rateLimiting.windowMs,
      max: config.security.rateLimiting.max,
      message: {
        error: 'Too many requests from this IP',
        retryAfter: Math.ceil(config.security.rateLimiting.windowMs / 1000)
      }
    });
    this.app.use(limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(cookieParser(config.security.cookieSecret));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info({
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }, 'Incoming request');
      next();
    });

    // Inject services into request context
    this.app.use((req, res, next) => {
      req.services = {
        config: this.configService,
        database: this.database,
        cache: this.cache,
        notifications: this.notifications,
        metrics: this.metrics
      };
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const healthStatus = await this.healthCheck.getHealthStatus();
        const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(healthStatus);
      } catch (error) {
        logger.error({ error }, 'Health check failed');
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed'
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.metrics.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve metrics');
        res.status(500).json({ error: 'Failed to retrieve metrics' });
      }
    });

    // Configuration API routes
    this.app.use('/api/v1/config', routes.configRoutes);
    this.app.use('/api/v1/features', routes.featureRoutes);
    this.app.use('/api/v1/experiments', routes.experimentRoutes);
    this.app.use('/api/v1/templates', routes.templateRoutes);
    this.app.use('/api/v1/validation', routes.validationRoutes);

    // Bulk configuration operations
    this.app.post('/api/v1/bulk/export', async (req, res) => {
      try {
        const { services, environments, includeSecrets } = req.body;
        const exportData = await this.configService.bulkExport({
          services,
          environments,
          includeSecrets: includeSecrets || false
        });
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=config-export.json');
        res.json(exportData);
      } catch (error: any) {
        logger.error({ error, body: req.body }, 'Failed to export configurations');
        res.status(500).json({ error: 'Failed to export configurations' });
      }
    });

    this.app.post('/api/v1/bulk/import', async (req, res) => {
      try {
        const { data, strategy, validate } = req.body;
        const result = await this.configService.bulkImport(data, {
          strategy: strategy || 'merge',
          validate: validate !== false
        });
        
        res.json(result);
      } catch (error: any) {
        logger.error({ error, body: req.body }, 'Failed to import configurations');
        res.status(500).json({ error: 'Failed to import configurations' });
      }
    });

    // Configuration history and audit
    this.app.get('/api/v1/audit/:configKey', async (req, res) => {
      try {
        const { configKey } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        const auditLog = await this.configService.getAuditLog(configKey, {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        });
        
        res.json(auditLog);
      } catch (error: any) {
        logger.error({ error, configKey: req.params.configKey }, 'Failed to get audit log');
        res.status(500).json({ error: 'Failed to get audit log' });
      }
    });

    // Configuration validation
    this.app.post('/api/v1/validate', async (req, res) => {
      try {
        const { config: configData, schema } = req.body;
        const validation = await this.configService.validateConfiguration(configData, schema);
        res.json(validation);
      } catch (error: any) {
        logger.error({ error, body: req.body }, 'Configuration validation failed');
        res.status(500).json({ error: 'Configuration validation failed' });
      }
    });

    // Configuration comparison
    this.app.post('/api/v1/compare', async (req, res) => {
      try {
        const { source, target, format } = req.body;
        const comparison = await this.configService.compareConfigurations(source, target, format);
        res.json(comparison);
      } catch (error: any) {
        logger.error({ error, body: req.body }, 'Configuration comparison failed');
        res.status(500).json({ error: 'Configuration comparison failed' });
      }
    });

    // Service configuration endpoints
    this.app.get('/api/v1/services/:service/config', async (req, res) => {
      try {
        const { service } = req.params;
        const { environment = 'production' } = req.query;
        
        const serviceConfig = await this.configService.getServiceConfiguration(
          service,
          environment as string
        );
        
        res.json(serviceConfig);
      } catch (error: any) {
        logger.error({ error, service: req.params.service }, 'Failed to get service configuration');
        res.status(500).json({ error: 'Failed to get service configuration' });
      }
    });

    this.app.put('/api/v1/services/:service/config', async (req, res) => {
      try {
        const { service } = req.params;
        const { environment = 'production', config: configData } = req.body;
        
        const result = await this.configService.updateServiceConfiguration(
          service,
          environment,
          configData,
          req.body.userId || 'system'
        );
        
        res.json(result);
      } catch (error: any) {
        logger.error({ error, service: req.params.service }, 'Failed to update service configuration');
        res.status(500).json({ error: 'Failed to update service configuration' });
      }
    });

    // Real-time configuration updates via WebSocket
    this.app.get('/api/v1/stream/:service', async (req, res) => {
      try {
        const { service } = req.params;
        const { environment = 'production' } = req.query;
        
        // Upgrade to WebSocket for real-time config updates
        if (req.headers.upgrade === 'websocket') {
          await this.configService.createConfigStream(req, res, service, environment as string);
        } else {
          res.status(400).json({ error: 'WebSocket upgrade required' });
        }
      } catch (error: any) {
        logger.error({ error, service: req.params.service }, 'Failed to create config stream');
        res.status(500).json({ error: 'Failed to create config stream' });
      }
    });

    // Service info endpoint
    this.app.get('/', (req, res) => {
      res.json({
        service: 'Configuration Service',
        version: '1.0.0',
        description: 'Unified configuration management service for AI Answer Ninja',
        endpoints: {
          health: 'GET /health',
          metrics: 'GET /metrics',
          config: 'GET|PUT|POST|DELETE /api/v1/config/*',
          features: 'GET|PUT|POST|DELETE /api/v1/features/*',
          experiments: 'GET|PUT|POST|DELETE /api/v1/experiments/*',
          templates: 'GET|PUT|POST|DELETE /api/v1/templates/*',
          validation: 'POST /api/v1/validate',
          bulkExport: 'POST /api/v1/bulk/export',
          bulkImport: 'POST /api/v1/bulk/import',
          audit: 'GET /api/v1/audit/:configKey',
          compare: 'POST /api/v1/compare',
          serviceConfig: 'GET|PUT /api/v1/services/:service/config',
          configStream: 'GET /api/v1/stream/:service'
        },
        features: {
          multiEnvironment: true,
          featureFlags: true,
          abTesting: true,
          realTimeUpdates: true,
          configValidation: true,
          auditLogging: true,
          bulkOperations: true,
          configTemplates: true
        }
      });
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
      });
    });

    // Global error handler
    this.app.use((
      error: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      logger.error({
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        },
        request: {
          method: req.method,
          url: req.url,
          body: req.body
        }
      }, 'Unhandled error');

      if (error instanceof ConfigurationError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: config.server.environment === 'development' ? error.message : 'Something went wrong'
      });
    });

    // Process-level error handling
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      this.gracefulShutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled promise rejection');
      this.gracefulShutdown();
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, starting graceful shutdown');
      this.gracefulShutdown();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, starting graceful shutdown');
      this.gracefulShutdown();
    });
  }

  public async start(): Promise<void> {
    try {
      // Initialize services
      await this.database.connect();
      await this.cache.connect();
      await this.configService.initialize();
      await this.metrics.start();
      
      // Start HTTP server
      this.server.listen(config.server.port, config.server.host, () => {
        logger.info({
          port: config.server.port,
          host: config.server.host,
          environment: config.server.environment
        }, 'Configuration Service started');
      });

      // Start health monitoring
      this.healthCheck.start();

      // Start configuration change monitoring
      await this.configService.startChangeMonitoring();

    } catch (error) {
      logger.fatal({ error }, 'Failed to start server');
      process.exit(1);
    }
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown...');

    try {
      // Stop accepting new connections
      this.server.close(() => {
        logger.info('HTTP server closed');
      });

      // Stop services
      await this.configService.stopChangeMonitoring();
      await this.metrics.stop();
      await this.cache.disconnect();
      await this.database.disconnect();
      this.healthCheck.stop();

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  }
}

// Extend Express Request interface to include services
declare global {
  namespace Express {
    interface Request {
      services?: {
        config: ConfigurationService;
        database: DatabaseService;
        cache: CacheService;
        notifications: NotificationService;
        metrics: MetricsService;
      };
    }
  }
}

// Start the server
const server = new ConfigurationServer();

if (require.main === module) {
  server.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  });
}

export default server;