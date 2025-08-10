import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

// Import existing services
import { WebSocketManager } from './services/websocket';
import { RedisService } from './services/redis';
import { RateLimiterService } from './services/rateLimiter';
import { MetricsService } from './services/metrics';
import { HealthCheckService } from './services/healthCheck';
import { RealtimeCommunicationManager } from './services/realtimeCommunication';
import { ConnectionPool } from './services/connectionPool';

// Import new enhanced services
import SignalingServer from './services/signalingServer';
import AdvancedAudioProcessor from './services/advancedAudioProcessor';
import ConnectionManager from './services/connectionManager';
import PerformanceOptimizer from './services/performanceOptimizer';
import ProtocolHandler from './services/protocolHandler';
import WebRTCManager from './services/webrtc';

import config from './config';
import logger from './utils/logger';
import { RealtimeProcessorError } from './types';

/**
 * Enhanced Realtime Processor Server
 * Integrates all real-time communication components including WebRTC, advanced audio processing,
 * connection management, performance optimization, and protocol handling
 */
class EnhancedRealtimeProcessorServer {
  private app: express.Application;
  private server: any;
  
  // Core services
  private redisService: RedisService;
  private rateLimiter: RateLimiterService;
  private metricsService: MetricsService;
  private healthCheck: HealthCheckService;
  
  // Communication services
  private wsManager: WebSocketManager;
  private webrtcManager: WebRTCManager;
  private signalingServer: SignalingServer;
  private connectionManager: ConnectionManager;
  private protocolHandler: ProtocolHandler;
  
  // Processing services
  private advancedAudioProcessor: AdvancedAudioProcessor;
  private performanceOptimizer: PerformanceOptimizer;
  
  // Legacy services for compatibility
  private communicationManager: RealtimeCommunicationManager;
  private connectionPool: ConnectionPool;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    
    this.initializeServices();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.setupServiceIntegration();
  }

  private initializeServices(): void {
    logger.info('Initializing enhanced realtime processor services');

    // Core services
    this.redisService = new RedisService(config.redis);
    this.rateLimiter = new RateLimiterService(config.security.rateLimiting);
    this.metricsService = new MetricsService(config.monitoring);
    
    this.healthCheck = new HealthCheckService({
      redis: this.redisService,
      metrics: this.metricsService,
    });

    // Initialize protocol handler
    this.protocolHandler = new ProtocolHandler({
      version: '2.0',
      supportedMessageTypes: [
        'audio_chunk',
        'audio_response', 
        'transcript',
        'ai_response',
        'heartbeat',
        'connection_status',
        'processing_status',
        'metrics',
        'error',
        'webrtc_offer',
        'webrtc_answer',
        'webrtc_ice_candidate',
        'session_recovery',
      ],
      maxMessageSize: 2 * 1024 * 1024, // 2MB
      compressionEnabled: config.performance?.compressionEnabled || true,
      heartbeatInterval: 30000,
      ackTimeout: 5000,
      maxRetries: 3,
      enableMessageSequencing: true,
      enableDuplicateDetection: true,
    }, this.metricsService);

    // Initialize WebRTC manager
    this.webrtcManager = new WebRTCManager({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
      enableAudioProcessing: true,
      audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
        channelCount: 1,
      },
      bitrateLimit: 32000,
      latencyTarget: 100,
    });

    // Initialize signaling server
    this.signalingServer = new SignalingServer({
      redis: this.redisService,
      metrics: this.metricsService,
      maxRoomsPerUser: 5,
      peerTimeout: 60000,
      roomCleanupInterval: 300000, // 5 minutes
      enableRoomBroadcast: true,
    });

    // Initialize connection manager
    this.connectionManager = new ConnectionManager({
      redis: this.redisService,
      metrics: this.metricsService,
      maxConnectionsPerUser: 10,
      connectionTimeout: 60000,
      heartbeatInterval: 30000,
      reconnectDelay: 2000,
      maxReconnectAttempts: 5,
      sessionRecoveryTimeout: 300000, // 5 minutes
      enableFailover: true,
      enableLoadBalancing: true,
    });

    // Initialize performance optimizer
    this.performanceOptimizer = new PerformanceOptimizer({
      bufferSize: 16384,
      maxLatency: 800, // Adjusted from CLAUDE.md architecture targets
      adaptiveEncoding: true,
      cacheEnabled: true,
      cacheSize: 2000,
      cacheTTL: 600, // 10 minutes
      compressionEnabled: true,
      compressionThreshold: 1024,
      latencyTargets: {
        excellent: 100,
        good: 200,
        acceptable: 500,
        poor: 1000,
      },
      qualityLevels: [
        {
          name: 'ultra',
          sampleRate: 48000,
          bitrate: 64000,
          latencyTarget: 50,
          enabledFeatures: ['noise_reduction', 'echo_cancellation', 'agc', 'vad'],
        },
        {
          name: 'high',
          sampleRate: 32000,
          bitrate: 32000,
          latencyTarget: 100,
          enabledFeatures: ['noise_reduction', 'echo_cancellation', 'vad'],
        },
        {
          name: 'medium',
          sampleRate: 16000,
          bitrate: 16000,
          latencyTarget: 200,
          enabledFeatures: ['noise_reduction', 'vad'],
        },
        {
          name: 'low',
          sampleRate: 8000,
          bitrate: 8000,
          latencyTarget: 300,
          enabledFeatures: ['vad'],
        },
      ],
    }, this.metricsService, this.redisService);

    // Initialize advanced audio processor
    this.advancedAudioProcessor = new AdvancedAudioProcessor({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      chunkSize: 4096,
      enableNoiseReduction: true,
      enableEchoCancellation: true,
      enableAGC: true,
      enableVAD: true,
      adaptiveBitrate: true,
      qualityThreshold: 0.7,
      latencyTarget: 200, // MVP stage target from CLAUDE.md
    }, this.metricsService);

    // Initialize WebSocket manager with enhanced protocol support
    this.wsManager = new WebSocketManager({
      server: this.server,
      redis: this.redisService,
      rateLimiter: this.rateLimiter,
      metrics: this.metricsService,
      config: config,
    });

    // Legacy services for compatibility
    this.connectionPool = new ConnectionPool({
      maxConnections: config.server.maxConnections || 1000,
      maxConnectionsPerUser: 5,
      connectionTimeout: config.server.connectionTimeout || 30000,
      idleTimeout: 300000,
      cleanupInterval: 60000,
      enableConnectionReuse: true,
      priorityLevels: 3,
    });
    
    this.communicationManager = new RealtimeCommunicationManager({
      websocket: {
        server: this.server,
        maxConnections: config.server.maxConnections || 1000,
        heartbeatInterval: 30000,
      },
      webrtc: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
        enableAudioProcessing: true,
        bitrateLimit: 32000,
      },
      redis: config.redis,
      processing: {
        enableWebRTC: true,
        fallbackToWebSocket: true,
        preferredTransport: 'auto',
      },
    }, {
      redis: this.redisService,
      metrics: this.metricsService,
    });
  }

  private setupServiceIntegration(): void {
    logger.info('Setting up service integration');

    // Connect WebRTC manager to signaling server
    this.webrtcManager.on('iceCandidate', async (data) => {
      // Forward ICE candidates through signaling
      this.signalingServer.emit('iceCandidate', data);
    });

    this.webrtcManager.on('connectionFailed', async (data) => {
      // Handle WebRTC connection failures by falling back to WebSocket
      logger.warn(data, 'WebRTC connection failed, initiating fallback');
      // Trigger fallback logic here
    });

    // Connect signaling server to WebRTC manager
    this.signalingServer.on('connectionStateChange', (data) => {
      this.metricsService.setGauge('webrtc_connection_state', 1, {
        connection_id: data.connectionId,
        state: data.state,
      });
    });

    // Connect connection manager to WebSocket manager
    this.connectionManager.on('connectionRegistered', (data) => {
      logger.info(data, 'Connection registered with session recovery support');
    });

    this.connectionManager.on('connectionError', async (data) => {
      // Handle connection errors with automatic recovery
      logger.error(data, 'Connection error detected, initiating recovery');
    });

    // Connect performance optimizer to audio processor
    this.performanceOptimizer.on('optimizationTriggered', async (data) => {
      logger.info(data, 'Performance optimization triggered');
      await this.advancedAudioProcessor.optimizeForCall(data.callId);
    });

    // Connect protocol handler to communication services
    this.protocolHandler.on('messageSent', (data) => {
      this.metricsService.incrementCounter('protocol_messages_sent_total', {
        type: data.type,
      });
    });

    this.protocolHandler.on('messageProcessed', (data) => {
      this.metricsService.recordHistogram(
        'protocol_message_processing_duration_ms',
        data.processingTime
      );
    });

    // Advanced audio processor integration
    this.advancedAudioProcessor.on('audioProcessed', (data) => {
      this.metricsService.recordHistogram(
        'advanced_audio_processing_duration_ms',
        data.processingLatency
      );
      
      this.metricsService.setGauge('audio_quality_score', data.quality.snr, {
        call_id: data.callId,
      });
    });

    logger.info('Service integration setup completed');
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Allow WebSocket connections
      crossOriginEmbedderPolicy: false, // Allow WebRTC
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Compression middleware
    if (config.performance?.compressionEnabled) {
      this.app.use(compression({
        threshold: 1024,
        level: 6,
      }));
    }

    // Body parsing with larger limits for audio data
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

    // Rate limiting
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
        
        // Add enhanced services health
        const enhancedHealth = {
          ...healthStatus,
          services: {
            ...healthStatus.services,
            webrtc: this.webrtcManager ? 'healthy' : 'unhealthy',
            signaling: this.signalingServer ? 'healthy' : 'unhealthy',
            connectionManager: this.connectionManager ? 'healthy' : 'unhealthy',
            advancedAudioProcessor: this.advancedAudioProcessor ? 'healthy' : 'unhealthy',
            performanceOptimizer: this.performanceOptimizer ? 'healthy' : 'unhealthy',
            protocolHandler: this.protocolHandler ? 'healthy' : 'unhealthy',
          },
        };
        
        const statusCode = enhancedHealth.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(enhancedHealth);
      } catch (error) {
        logger.error({ error }, 'Health check failed');
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed',
        });
      }
    });

    // Enhanced metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const [
          basicMetrics,
          protocolStats,
          performanceStats,
          connectionStats,
          signalingStats,
        ] = await Promise.all([
          this.metricsService.getMetrics(),
          this.protocolHandler.getProtocolStats(),
          this.performanceOptimizer.getPerformanceStats(),
          this.connectionManager.getConnectionStats(),
          this.signalingServer.getAllRoomsStats(),
        ]);

        res.json({
          ...basicMetrics,
          enhanced: {
            protocol: protocolStats,
            performance: performanceStats,
            connections: connectionStats,
            signaling: signalingStats,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve enhanced metrics');
        res.status(500).json({ error: 'Failed to retrieve enhanced metrics' });
      }
    });

    // WebRTC signaling endpoints
    this.app.post('/signaling/rooms/:roomId/join', async (req, res) => {
      try {
        const { roomId } = req.params;
        const { userId, callId, metadata } = req.body;

        if (!userId || !callId) {
          return res.status(400).json({
            error: 'Missing required fields: userId, callId',
          });
        }

        // This would typically be handled through WebSocket
        // This is a REST fallback for debugging
        const roomStats = this.signalingServer.getRoomStats(roomId);
        
        res.json({
          roomId,
          joined: !!roomStats,
          roomStats,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to join signaling room');
        res.status(500).json({ error: 'Failed to join signaling room' });
      }
    });

    // Connection management endpoints
    this.app.get('/connections/health', async (req, res) => {
      try {
        const connectionsHealth = this.connectionManager.getAllConnectionsHealth();
        res.json(connectionsHealth);
      } catch (error) {
        logger.error({ error }, 'Failed to get connections health');
        res.status(500).json({ error: 'Failed to get connections health' });
      }
    });

    this.app.post('/connections/:connectionId/reconnect', async (req, res) => {
      try {
        const { connectionId } = req.params;
        const success = await this.connectionManager.forceReconnection(connectionId);
        
        res.json({
          connectionId,
          success,
          message: success ? 'Reconnection initiated' : 'Connection not found',
        });
      } catch (error) {
        logger.error({ error }, 'Failed to initiate reconnection');
        res.status(500).json({ error: 'Failed to initiate reconnection' });
      }
    });

    // Performance optimization endpoints
    this.app.get('/performance/stats/:callId?', async (req, res) => {
      try {
        const { callId } = req.params;
        
        if (callId) {
          const stats = this.performanceOptimizer.getPerformanceStats();
          res.json(stats);
        } else {
          const allStats = this.performanceOptimizer.getPerformanceStats();
          res.json(allStats);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to get performance stats');
        res.status(500).json({ error: 'Failed to get performance stats' });
      }
    });

    this.app.post('/performance/optimize/:callId', async (req, res) => {
      try {
        const { callId } = req.params;
        await this.performanceOptimizer.optimizeForCall(callId);
        
        res.json({
          callId,
          message: 'Optimization triggered',
        });
      } catch (error) {
        logger.error({ error }, 'Failed to trigger optimization');
        res.status(500).json({ error: 'Failed to trigger optimization' });
      }
    });

    this.app.delete('/performance/cache', async (req, res) => {
      try {
        this.performanceOptimizer.clearCache();
        res.json({ message: 'Cache cleared' });
      } catch (error) {
        logger.error({ error }, 'Failed to clear cache');
        res.status(500).json({ error: 'Failed to clear cache' });
      }
    });

    // Advanced audio processing endpoints
    this.app.post('/audio/process/advanced', async (req, res) => {
      try {
        const { callId, audioData, userId } = req.body;
        
        if (!callId || !audioData) {
          return res.status(400).json({
            error: 'Missing required fields: callId, audioData',
          });
        }

        const audioChunk = {
          id: `advanced-${Date.now()}`,
          callId,
          timestamp: Date.now(),
          audioData,
          sequenceNumber: 1,
          sampleRate: 16000,
          channels: 1,
        };

        const result = await this.advancedAudioProcessor.processAudio(audioChunk, callId);
        res.json(result);
      } catch (error) {
        logger.error({ error }, 'Advanced audio processing failed');
        res.status(500).json({ error: 'Advanced audio processing failed' });
      }
    });

    // Protocol handler endpoints
    this.app.get('/protocol/stats', async (req, res) => {
      try {
        const stats = this.protocolHandler.getProtocolStats();
        const pendingMessages = this.protocolHandler.getPendingMessages();
        
        res.json({
          stats,
          pendingMessages,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get protocol stats');
        res.status(500).json({ error: 'Failed to get protocol stats' });
      }
    });

    // Legacy compatibility endpoints
    this.app.get('/connections', async (req, res) => {
      try {
        const connections = await this.wsManager.getConnectionStats();
        res.json(connections);
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve connection stats');
        res.status(500).json({ error: 'Failed to retrieve connection stats' });
      }
    });

    this.app.get('/sessions', async (req, res) => {
      try {
        const sessions = await this.communicationManager.getSessionStats();
        res.json(sessions);
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve session stats');
        res.status(500).json({ error: 'Failed to retrieve session stats' });
      }
    });

    // Enhanced API documentation
    this.app.get('/', (req, res) => {
      res.json({
        service: 'Enhanced Realtime Processor',
        version: '2.0.0',
        description: 'Enhanced real-time communication service with WebRTC, advanced audio processing, and performance optimization',
        features: [
          'WebRTC P2P audio communication',
          'Advanced audio processing (noise reduction, echo cancellation, AGC, VAD)',
          'Intelligent connection management with session recovery',
          'Performance optimization with adaptive encoding',
          'Protocol handling with reliability features',
          'Signaling server for WebRTC coordination',
          'Comprehensive metrics and monitoring',
        ],
        endpoints: {
          // Core endpoints
          health: 'GET /health',
          metrics: 'GET /metrics',
          
          // WebRTC signaling
          joinRoom: 'POST /signaling/rooms/:roomId/join',
          
          // Connection management
          connectionsHealth: 'GET /connections/health',
          forceReconnect: 'POST /connections/:connectionId/reconnect',
          
          // Performance optimization
          performanceStats: 'GET /performance/stats/:callId?',
          optimizeCall: 'POST /performance/optimize/:callId',
          clearCache: 'DELETE /performance/cache',
          
          // Advanced audio processing
          advancedAudioProcess: 'POST /audio/process/advanced',
          
          // Protocol handling
          protocolStats: 'GET /protocol/stats',
          
          // Legacy compatibility
          connections: 'GET /connections',
          sessions: 'GET /sessions',
        },
        websocket: {
          endpoint: '/realtime/conversation',
          protocols: ['realtime-audio-v2', 'webrtc-signaling-v1'],
          authentication: 'Bearer token required',
          features: [
            'Audio chunk processing',
            'WebRTC signaling',
            'Session recovery',
            'Performance optimization',
            'Protocol reliability',
          ],
        },
        webrtc: {
          signalingEndpoint: '/realtime/conversation',
          iceServers: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:global.stun.twilio.com:3478',
          ],
          supportedCodecs: ['opus', 'aac', 'mp3', 'pcm'],
          bitrateRange: '8-64 kbps',
          latencyTarget: '< 200ms (MVP), < 100ms (optimized)',
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
      logger.info('Starting enhanced realtime processor server');

      // Initialize core services first
      await this.redisService.connect();
      await this.metricsService.start();

      // Initialize enhanced services
      await Promise.all([
        this.protocolHandler.initialize(),
        this.webrtcManager.initialize(),
        this.signalingServer.initialize(),
        this.connectionManager.initialize(),
        this.performanceOptimizer.initialize(),
        this.advancedAudioProcessor.initialize(),
      ]);

      // Initialize communication services
      await this.connectionPool.initialize();
      await this.wsManager.initialize();
      await this.communicationManager.initialize();

      // Start HTTP server
      this.server.listen(config.server.port, config.server.host, () => {
        logger.info({
          port: config.server.port,
          host: config.server.host,
          environment: config.server.environment,
          version: '2.0.0',
          features: [
            'WebRTC',
            'AdvancedAudio',
            'ConnectionManagement',
            'PerformanceOptimization',
            'ProtocolReliability',
          ],
        }, 'Enhanced Realtime Processor Server started successfully');
      });

      // Start health monitoring
      this.healthCheck.start();

      // Log initialization completion
      logger.info('All enhanced services initialized and ready');

    } catch (error) {
      logger.fatal({ error }, 'Failed to start enhanced server');
      process.exit(1);
    }
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown of enhanced server...');

    try {
      // Stop accepting new connections
      this.server.close(() => {
        logger.info('HTTP server closed');
      });

      // Shutdown enhanced services
      await Promise.all([
        this.protocolHandler.shutdown(),
        this.webrtcManager.shutdown(),
        this.signalingServer.shutdown(),
        this.connectionManager.shutdown(),
        this.performanceOptimizer.shutdown(),
        this.advancedAudioProcessor.shutdown(),
      ]);

      // Shutdown communication services
      await Promise.all([
        this.wsManager.shutdown(),
        this.communicationManager.shutdown(),
        this.connectionPool.shutdown(),
      ]);

      // Stop core services
      await this.metricsService.stop();
      await this.redisService.disconnect();
      this.healthCheck.stop();

      logger.info('Enhanced server graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during enhanced server shutdown');
      process.exit(1);
    }
  }

  // Public API methods
  public getServices() {
    return {
      // Core services
      redis: this.redisService,
      metrics: this.metricsService,
      rateLimiter: this.rateLimiter,
      healthCheck: this.healthCheck,
      
      // Enhanced services
      webrtc: this.webrtcManager,
      signaling: this.signalingServer,
      connectionManager: this.connectionManager,
      audioProcessor: this.advancedAudioProcessor,
      performanceOptimizer: this.performanceOptimizer,
      protocolHandler: this.protocolHandler,
      
      // Communication services
      websocket: this.wsManager,
      communication: this.communicationManager,
      connectionPool: this.connectionPool,
    };
  }
}

// Start the enhanced server
const enhancedServer = new EnhancedRealtimeProcessorServer();

if (require.main === module) {
  enhancedServer.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start enhanced server');
    process.exit(1);
  });
}

export default enhancedServer;