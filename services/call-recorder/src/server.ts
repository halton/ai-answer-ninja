import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';
import { metricsMiddleware } from './middleware/metrics';
import { healthCheck } from './middleware/healthCheck';
import { setupRoutes } from './routes';
import { initializeServices } from './services';
import { DatabaseService } from './services/database/DatabaseService';
import { CacheService } from './services/cache/CacheService';

export class CallRecorderServer {
  private app: Application;
  private server: any;
  private io: SocketIOServer;
  private services: any;
  private isShuttingDown: boolean = false;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.server.corsOrigins,
        credentials: true
      }
    });
  }

  async initialize(): Promise<void> {
    try {
      // Validate configuration
      validateConfig();

      // Initialize services
      this.services = await initializeServices();

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup WebSocket handlers
      this.setupWebSocket();

      // Setup error handling
      this.setupErrorHandling();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      logger.info('Call Recorder Server initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize server', { error });
      throw error;
    }
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS
    this.app.use(cors({
      origin: config.server.corsOrigins,
      credentials: true,
      optionsSuccessStatus: 200
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    if (config.server.environment !== 'test') {
      this.app.use(morgan('combined', {
        stream: {
          write: (message: string) => logger.info(message.trim())
        }
      }));
    }

    // Trust proxy
    if (config.server.trustProxy) {
      this.app.set('trust proxy', 1);
    }

    // Rate limiting
    if (config.security.rateLimiting.enabled) {
      this.app.use(rateLimiter);
    }

    // Metrics collection
    if (config.monitoring.prometheus.enabled) {
      this.app.use(metricsMiddleware);
    }

    // Health check endpoint (before auth)
    if (config.monitoring.healthCheck.enabled) {
      this.app.get(config.monitoring.healthCheck.path, healthCheck(this.services));
    }

    // Authentication middleware for protected routes
    this.app.use('/api/v1/recordings', authMiddleware);
    this.app.use('/api/v1/playback', authMiddleware);
    this.app.use('/api/v1/lifecycle', authMiddleware);
    this.app.use('/api/v1/gdpr', authMiddleware);
  }

  private setupRoutes(): void {
    // API routes
    setupRoutes(this.app, this.services);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`,
        timestamp: new Date().toISOString()
      });
    });
  }

  private setupWebSocket(): void {
    // WebSocket authentication
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Verify token
        const user = await this.services.authService.verifyToken(token);
        if (!user) {
          return next(new Error('Invalid token'));
        }

        socket.data.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });

    // WebSocket connection handler
    this.io.on('connection', (socket) => {
      const userId = socket.data.user?.id;
      logger.info('WebSocket client connected', { userId, socketId: socket.id });

      // Join user room
      if (userId) {
        socket.join(`user:${userId}`);
      }

      // Handle real-time recording start
      socket.on('recording:start', async (data) => {
        try {
          const { callId, format } = data;
          await this.services.realtimeService.startRecording(userId, callId, format, socket);
          socket.emit('recording:started', { callId, status: 'recording' });
        } catch (error) {
          logger.error('Failed to start recording', { userId, error });
          socket.emit('recording:error', { error: 'Failed to start recording' });
        }
      });

      // Handle audio chunks
      socket.on('recording:chunk', async (data) => {
        try {
          const { callId, chunk, sequence } = data;
          await this.services.realtimeService.processChunk(userId, callId, chunk, sequence);
          socket.emit('recording:chunk:ack', { sequence });
        } catch (error) {
          logger.error('Failed to process audio chunk', { userId, error });
          socket.emit('recording:error', { error: 'Failed to process audio chunk' });
        }
      });

      // Handle recording stop
      socket.on('recording:stop', async (data) => {
        try {
          const { callId } = data;
          const result = await this.services.realtimeService.stopRecording(userId, callId);
          socket.emit('recording:stopped', { callId, recordingId: result.recordingId });
        } catch (error) {
          logger.error('Failed to stop recording', { userId, error });
          socket.emit('recording:error', { error: 'Failed to stop recording' });
        }
      });

      // Handle playback request
      socket.on('playback:start', async (data) => {
        try {
          const { recordingId, options } = data;
          const stream = await this.services.streamingService.createStream(recordingId, options);
          
          stream.on('data', (chunk: Buffer) => {
            socket.emit('playback:data', {
              recordingId,
              chunk: chunk.toString('base64')
            });
          });

          stream.on('end', () => {
            socket.emit('playback:end', { recordingId });
          });

          stream.on('error', (error: Error) => {
            logger.error('Playback stream error', { recordingId, error });
            socket.emit('playback:error', { recordingId, error: error.message });
          });

          socket.emit('playback:started', { recordingId });
        } catch (error) {
          logger.error('Failed to start playback', { userId, error });
          socket.emit('playback:error', { error: 'Failed to start playback' });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info('WebSocket client disconnected', { userId, socketId: socket.id });
        // Cleanup any ongoing recordings
        if (userId) {
          this.services.realtimeService.cleanupUserSessions(userId);
        }
      });
    });
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use(errorHandler);

    // Unhandled rejection handler
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      logger.error('Unhandled Promise Rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack
      });
    });

    // Uncaught exception handler
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception', {
        message: error.message,
        stack: error.stack
      });
      
      // Graceful shutdown on critical error
      this.shutdown(1);
    });
  }

  private setupGracefulShutdown(): void {
    const shutdownSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

    shutdownSignals.forEach(signal => {
      process.on(signal, () => {
        logger.info(`Received ${signal}, starting graceful shutdown`);
        this.shutdown(0);
      });
    });
  }

  private async shutdown(exitCode: number): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('Starting graceful shutdown...');

    // Stop accepting new connections
    this.server.close(() => {
      logger.info('HTTP server closed');
    });

    // Close WebSocket connections
    this.io.close(() => {
      logger.info('WebSocket server closed');
    });

    // Cleanup services
    try {
      if (this.services) {
        await Promise.all([
          this.services.databaseService?.close(),
          this.services.cacheService?.close(),
          this.services.queueService?.close(),
          this.services.lifecycleService?.cleanup()
        ]);
      }
      logger.info('All services cleaned up');
    } catch (error) {
      logger.error('Error during service cleanup', { error });
    }

    // Exit process
    logger.info(`Shutdown complete, exiting with code ${exitCode}`);
    process.exit(exitCode);
  }

  async start(): Promise<void> {
    const port = config.server.port;
    const host = config.server.host;

    return new Promise((resolve, reject) => {
      this.server.listen(port, host, () => {
        logger.info(`Call Recorder Server started`, {
          port,
          host,
          environment: config.server.environment,
          pid: process.pid
        });
        resolve();
      }).on('error', (error: Error) => {
        logger.error('Failed to start server', { error });
        reject(error);
      });
    });
  }
}

// Start server if running directly
if (require.main === module) {
  const server = new CallRecorderServer();
  
  server.initialize()
    .then(() => server.start())
    .catch((error) => {
      logger.error('Failed to start Call Recorder Server', { error });
      process.exit(1);
    });
}

export default CallRecorderServer;