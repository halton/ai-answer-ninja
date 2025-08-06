import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { WebSocketManager } from './services/websocket';
import { RedisService } from './services/redis';
import { RateLimiterService } from './services/rateLimiter';
import { MetricsService } from './services/metrics';
import { HealthCheckService } from './services/healthCheck';
import config from './config';
import logger from './utils/logger';
import { RealtimeProcessorError } from './types';

class RealtimeProcessorServer {
  private app: express.Application;
  private server: any;
  private wsManager: WebSocketManager;
  private redisService: RedisService;
  private rateLimiter: RateLimiterService;
  private metricsService: MetricsService;
  private healthCheck: HealthCheckService;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    
    // Initialize services
    this.redisService = new RedisService(config.redis);
    this.rateLimiter = new RateLimiterService(config.security.rateLimiting);
    this.metricsService = new MetricsService(config.monitoring);
    this.healthCheck = new HealthCheckService({
      redis: this.redisService,
      metrics: this.metricsService,
    });
    
    this.wsManager = new WebSocketManager({
      server: this.server,
      redis: this.redisService,
      rateLimiter: this.rateLimiter,
      metrics: this.metricsService,
      config: config,
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Allow WebSocket connections
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Compression middleware
    if (config.performance.compressionEnabled) {
      this.app.use(compression({
        threshold: 1024,
        level: 6,
      }));
    }

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info({
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      }, 'Incoming request');
      next();
    });

    // Rate limiting for HTTP endpoints
    this.app.use(async (req, res, next) => {
      try {
        const clientId = req.ip || 'unknown';
        await this.rateLimiter.checkRateLimit(clientId, 'http');
        next();
      } catch (error) {
        logger.warn({ error, ip: req.ip }, 'Rate limit exceeded');
        res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: 60,
        });
      }
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
          error: 'Health check failed',
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.metricsService.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve metrics');
        res.status(500).json({ error: 'Failed to retrieve metrics' });
      }
    });

    // WebSocket connection info
    this.app.get('/connections', async (req, res) => {
      try {
        const connections = await this.wsManager.getConnectionStats();
        res.json(connections);
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve connection stats');
        res.status(500).json({ error: 'Failed to retrieve connection stats' });
      }
    });

    // Start processing endpoint (for debugging/testing)
    this.app.post('/process/audio', async (req, res) => {
      try {
        const { callId, audioData, userId } = req.body;
        
        if (!callId || !audioData) {
          return res.status(400).json({
            error: 'Missing required fields: callId, audioData',
          });
        }

        // This would typically be handled through WebSocket
        // This endpoint is for testing/debugging purposes
        const result = await this.wsManager.processAudioData({
          id: `test-${Date.now()}`,
          callId,
          timestamp: Date.now(),
          audioData,
          sequenceNumber: 1,
        }, userId || 'test-user');

        res.json(result);
      } catch (error) {
        logger.error({ error }, 'Audio processing failed');
        res.status(500).json({ error: 'Audio processing failed' });
      }
    });

    // Get processing status
    this.app.get('/process/status/:callId', async (req, res) => {
      try {
        const { callId } = req.params;
        const status = await this.wsManager.getProcessingStatus(callId);
        res.json(status);
      } catch (error) {
        logger.error({ error, callId: req.params.callId }, 'Failed to get processing status');
        res.status(500).json({ error: 'Failed to get processing status' });
      }
    });

    // API documentation
    this.app.get('/', (req, res) => {
      res.json({
        service: 'Realtime Processor',
        version: '1.0.0',
        description: 'Real-time audio processing service for AI Answer Ninja',
        endpoints: {
          health: 'GET /health',
          metrics: 'GET /metrics',
          connections: 'GET /connections',
          processAudio: 'POST /process/audio',
          processStatus: 'GET /process/status/:callId',
          websocket: 'WS /realtime/conversation',
        },
        websocket: {
          endpoint: '/realtime/conversation',
          protocols: ['realtime-audio-v1'],
          authentication: 'Bearer token required',
        },
      });
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
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
          code: error.code,
        },
        request: {
          method: req.method,
          url: req.url,
          body: req.body,
        },
      }, 'Unhandled error');

      if (error instanceof RealtimeProcessorError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: config.server.environment === 'development' ? error.message : 'Something went wrong',
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      this.gracefulShutdown();
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled promise rejection');
      this.gracefulShutdown();
    });

    // Handle SIGTERM and SIGINT
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
      await this.redisService.connect();
      await this.metricsService.start();
      
      // Start WebSocket server
      await this.wsManager.initialize();

      // Start HTTP server
      this.server.listen(config.server.port, config.server.host, () => {
        logger.info({
          port: config.server.port,
          host: config.server.host,
          environment: config.server.environment,
        }, 'Realtime Processor Server started');
      });

      // Start health monitoring
      this.healthCheck.start();

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

      // Close WebSocket connections
      await this.wsManager.shutdown();

      // Stop services
      await this.metricsService.stop();
      await this.redisService.disconnect();
      this.healthCheck.stop();

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  }
}

// Start the server
const server = new RealtimeProcessorServer();

if (require.main === module) {
  server.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  });
}

export default server;