/**
 * Realtime WebSocket Server
 * Enhanced WebSocket server with heartbeat detection, reconnection mechanism, and message queuing
 */

import express from 'express';
import { createServer, Server } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import jwt from 'jsonwebtoken';
import { 
  MessageType, 
  WebSocketMessage, 
  ConnectionStatus,
  ValidationError,
  RateLimitError
} from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import WebSocketManager from './WebSocketManager';
import AudioStreamHandler from './AudioStreamHandler';
import RealtimeService from '../services/RealtimeService';

export interface ServerOptions {
  enableCors: boolean;
  enableCompression: boolean;
  enableRateLimit: boolean;
  enableAuth: boolean;
  maxConnections: number;
  heartbeatInterval: number;
  reconnectTimeout: number;
}

export interface AuthResult {
  isValid: boolean;
  userId?: string;
  callId?: string;
  error?: string;
}

export interface HeartbeatConfig {
  interval: number;
  timeout: number;
  maxMissed: number;
  enabled: boolean;
}

export interface ReconnectionConfig {
  enabled: boolean;
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class RealtimeWebSocketServer {
  private app: express.Application;
  private server: Server;
  private wsManager: WebSocketManager;
  private audioHandler: AudioStreamHandler;
  private realtimeService: RealtimeService;
  private rateLimiter: RateLimiterMemory;
  
  private readonly options: ServerOptions;
  private heartbeatConfig: HeartbeatConfig;
  private reconnectionConfig: ReconnectionConfig;
  
  private isRunning: boolean = false;
  private connectedClients: Set<string> = new Set();
  private reconnectionSessions: Map<string, any> = new Map();

  constructor(options: Partial<ServerOptions> = {}) {
    this.options = {
      enableCors: true,
      enableCompression: true,
      enableRateLimit: true,
      enableAuth: true,
      maxConnections: 1000,
      heartbeatInterval: 30000,
      reconnectTimeout: 60000,
      ...options
    };

    this.heartbeatConfig = {
      interval: this.options.heartbeatInterval,
      timeout: this.options.heartbeatInterval * 2,
      maxMissed: 3,
      enabled: true
    };

    this.reconnectionConfig = {
      enabled: true,
      maxAttempts: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2.0
    };

    this.initializeServer();
    this.initializeRateLimit();
    this.initializeWebSocketComponents();
    this.setupEventHandlers();

    logger.info('RealtimeWebSocketServer initialized');
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Server is already running');
      return;
    }

    try {
      // Initialize services
      await this.realtimeService.initialize();

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        this.server.listen(config.server.port, config.server.host, (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Initialize WebSocket server
      this.wsManager.initialize(this.server);

      this.isRunning = true;
      
      logger.info(`Realtime WebSocket server started on ${config.server.host}:${config.server.port}`);
      logger.info(`WebSocket endpoint: ws://${config.server.host}:${config.server.port}/realtime/ws`);

    } catch (error) {
      logger.error('Failed to start RealtimeWebSocketServer:', error);
      throw error;
    }
  }

  /**
   * Stop the server
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Server is not running');
      return;
    }

    logger.info('Stopping RealtimeWebSocketServer...');

    try {
      // Shutdown services
      this.wsManager.shutdown();
      await this.realtimeService.shutdown();

      // Close HTTP server
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          resolve();
        });
      });

      this.isRunning = false;
      this.connectedClients.clear();
      this.reconnectionSessions.clear();

      logger.info('RealtimeWebSocketServer stopped');

    } catch (error) {
      logger.error('Error stopping server:', error);
      throw error;
    }
  }

  /**
   * Get server statistics
   */
  public getStatistics(): any {
    return {
      isRunning: this.isRunning,
      connectedClients: this.connectedClients.size,
      realtimeService: this.realtimeService.getStatistics(),
      wsManager: this.wsManager.getStats(),
      heartbeatConfig: this.heartbeatConfig,
      reconnectionConfig: this.reconnectionConfig,
      uptime: this.isRunning ? process.uptime() * 1000 : 0
    };
  }

  /**
   * Update heartbeat configuration
   */
  public updateHeartbeatConfig(config: Partial<HeartbeatConfig>): void {
    this.heartbeatConfig = { ...this.heartbeatConfig, ...config };
    logger.info('Heartbeat configuration updated:', this.heartbeatConfig);
  }

  /**
   * Update reconnection configuration
   */
  public updateReconnectionConfig(config: Partial<ReconnectionConfig>): void {
    this.reconnectionConfig = { ...this.reconnectionConfig, ...config };
    logger.info('Reconnection configuration updated:', this.reconnectionConfig);
  }

  /**
   * Initialize Express server
   */
  private initializeServer(): void {
    this.app = express();

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    if (this.options.enableCors) {
      this.app.use(cors({
        origin: config.security.corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
      }));
    }

    // Compression
    if (this.options.enableCompression) {
      this.app.use(compression());
    }

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        statistics: this.getStatistics()
      });
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      res.json(this.getStatistics());
    });

    // WebSocket authentication endpoint
    this.app.post('/auth/websocket', async (req, res) => {
      try {
        const { token, userId, callId } = req.body;
        const authResult = await this.authenticateWebSocket(token, userId, callId);
        
        if (authResult.isValid) {
          const sessionToken = this.generateSessionToken(authResult.userId!, authResult.callId!);
          res.json({
            success: true,
            sessionToken,
            userId: authResult.userId,
            callId: authResult.callId
          });
        } else {
          res.status(401).json({
            success: false,
            error: authResult.error || 'Authentication failed'
          });
        }
      } catch (error) {
        logger.error('WebSocket authentication error:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // Create HTTP server
    this.server = createServer(this.app);

    // Server error handling
    this.server.on('error', (error) => {
      logger.error('HTTP server error:', error);
    });
  }

  /**
   * Initialize rate limiting
   */
  private initializeRateLimit(): void {
    if (!this.options.enableRateLimit) return;

    this.rateLimiter = new RateLimiterMemory({
      keyGenerator: (req) => req.ip,
      points: config.security.rateLimiting.maxRequests,
      duration: config.security.rateLimiting.windowMs / 1000,
      blockDuration: 60 // 1 minute block
    });

    // Apply rate limiting middleware
    this.app.use(async (req, res, next) => {
      try {
        await this.rateLimiter.consume(req.ip);
        next();
      } catch (rateLimitError) {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: rateLimitError.msBeforeNext
        });
      }
    });
  }

  /**
   * Initialize WebSocket components
   */
  private initializeWebSocketComponents(): void {
    this.wsManager = new WebSocketManager();
    this.audioHandler = new AudioStreamHandler();
    this.realtimeService = new RealtimeService(this.wsManager, this.audioHandler);
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // WebSocket Manager events
    this.wsManager.on('connection', this.handleWebSocketConnection.bind(this));
    this.wsManager.on('disconnection', this.handleWebSocketDisconnection.bind(this));
    this.wsManager.on('message', this.handleWebSocketMessage.bind(this));
    this.wsManager.on('connectionError', this.handleWebSocketError.bind(this));

    // Realtime Service events
    this.realtimeService.on('sessionStarted', this.handleSessionStarted.bind(this));
    this.realtimeService.on('sessionEnded', this.handleSessionEnded.bind(this));
    this.realtimeService.on('processingComplete', this.handleProcessingComplete.bind(this));
    this.realtimeService.on('processingError', this.handleProcessingError.bind(this));

    // Audio Handler events
    this.audioHandler.on('streamStarted', this.handleAudioStreamStarted.bind(this));
    this.audioHandler.on('streamStopped', this.handleAudioStreamStopped.bind(this));

    // Process events
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
    process.on('SIGINT', this.gracefulShutdown.bind(this));
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleWebSocketConnection({ connectionId, connection }: any): Promise<void> {
    logger.info(`New WebSocket connection: ${connectionId}`);
    this.connectedClients.add(connectionId);

    // Start heartbeat for this connection
    if (this.heartbeatConfig.enabled) {
      this.startHeartbeatForConnection(connectionId);
    }

    // Send welcome message
    await this.wsManager.sendMessage(connectionId, {
      type: MessageType.CONNECTION_STATUS,
      callId: '',
      timestamp: Date.now(),
      data: {
        status: ConnectionStatus.CONNECTED,
        heartbeatInterval: this.heartbeatConfig.interval,
        reconnectionEnabled: this.reconnectionConfig.enabled,
        maxReconnectionAttempts: this.reconnectionConfig.maxAttempts
      }
    });
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleWebSocketDisconnection({ connectionId, connection, code, reason }: any): void {
    logger.info(`WebSocket disconnected: ${connectionId}, code: ${code}, reason: ${reason}`);
    this.connectedClients.delete(connectionId);

    // Handle reconnection if enabled
    if (this.reconnectionConfig.enabled && connection.userId && connection.callId) {
      this.handleReconnectionRequest(connectionId, connection);
    }
  }

  /**
   * Handle WebSocket message
   */
  private async handleWebSocketMessage({ connectionId, message, connection }: any): Promise<void> {
    try {
      // Update last activity
      connection.lastHeartbeat = Date.now();

      switch (message.type) {
        case MessageType.AUDIO_CHUNK:
          await this.handleAudioChunkMessage(connectionId, message, connection);
          break;

        case MessageType.HEARTBEAT:
          await this.handleHeartbeatMessage(connectionId, message);
          break;

        case 'session_start':
          await this.handleSessionStartMessage(connectionId, message, connection);
          break;

        case 'session_end':
          await this.handleSessionEndMessage(connectionId, message);
          break;

        case 'reconnect':
          await this.handleReconnectionMessage(connectionId, message, connection);
          break;

        default:
          logger.debug(`Unhandled message type: ${message.type} from ${connectionId}`);
          break;
      }

    } catch (error) {
      logger.error(`Error handling message from ${connectionId}:`, error);
      await this.wsManager.sendError(connectionId, 'MESSAGE_HANDLING_ERROR', error.message);
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleWebSocketError({ connectionId, error }: any): void {
    logger.error(`WebSocket error for ${connectionId}:`, error);
    this.connectedClients.delete(connectionId);
  }

  /**
   * Handle session started event
   */
  private handleSessionStarted({ sessionId, session }: any): void {
    logger.info(`Session started: ${sessionId} for user ${session.userId}`);
  }

  /**
   * Handle session ended event
   */
  private handleSessionEnded({ sessionId, session, reason, summary }: any): void {
    logger.info(`Session ended: ${sessionId}, reason: ${reason}`);
  }

  /**
   * Handle processing complete event
   */
  private handleProcessingComplete({ sessionId, totalLatency, pipeline }: any): void {
    logger.debug(`Processing complete for session ${sessionId}, latency: ${totalLatency}ms`);
  }

  /**
   * Handle processing error event
   */
  private handleProcessingError({ sessionId, error }: any): void {
    logger.error(`Processing error for session ${sessionId}:`, error);
  }

  /**
   * Handle audio stream started event
   */
  private handleAudioStreamStarted({ callId, options }: any): void {
    logger.info(`Audio stream started for call ${callId}`);
  }

  /**
   * Handle audio stream stopped event
   */
  private handleAudioStreamStopped({ callId, finalState }: any): void {
    logger.info(`Audio stream stopped for call ${callId}`);
  }

  /**
   * Message handlers
   */
  private async handleAudioChunkMessage(connectionId: string, message: WebSocketMessage, connection: any): Promise<void> {
    if (!connection.userId || !connection.callId) {
      throw new ValidationError('Connection not authenticated for audio processing');
    }

    // The RealtimeService will handle the audio chunk processing
    // This is handled automatically through the WebSocket Manager events
  }

  private async handleHeartbeatMessage(connectionId: string, message: WebSocketMessage): Promise<void> {
    await this.wsManager.sendMessage(connectionId, {
      type: MessageType.HEARTBEAT,
      callId: '',
      timestamp: Date.now(),
      data: {
        status: 'alive',
        serverTime: Date.now()
      }
    });
  }

  private async handleSessionStartMessage(connectionId: string, message: WebSocketMessage, connection: any): Promise<void> {
    const { userId, callId, authToken } = message.data || {};

    if (!userId || !callId) {
      throw new ValidationError('userId and callId are required to start session');
    }

    // Authenticate if required
    if (this.options.enableAuth) {
      const authResult = await this.authenticateWebSocket(authToken, userId, callId);
      if (!authResult.isValid) {
        throw new ValidationError(authResult.error || 'Authentication failed');
      }
    }

    // Authenticate the connection
    this.wsManager.authenticateConnection(connectionId, userId, callId);

    // Start realtime session
    const sessionId = `${userId}_${callId}_${Date.now()}`;
    await this.realtimeService.startSession(sessionId, callId, userId, connectionId);
  }

  private async handleSessionEndMessage(connectionId: string, message: WebSocketMessage): Promise<void> {
    const session = this.realtimeService.getActiveSessions().find(s => s.connectionId === connectionId);
    if (session) {
      await this.realtimeService.endSession(session.sessionId, 'user_request');
    }
  }

  private async handleReconnectionMessage(connectionId: string, message: WebSocketMessage, connection: any): Promise<void> {
    const { previousConnectionId, sessionId } = message.data || {};

    if (this.reconnectionSessions.has(previousConnectionId)) {
      const sessionData = this.reconnectionSessions.get(previousConnectionId);
      
      // Restore session
      this.wsManager.authenticateConnection(connectionId, sessionData.userId, sessionData.callId);
      
      // Resume or restart session
      await this.realtimeService.startSession(sessionId, sessionData.callId, sessionData.userId, connectionId);
      
      // Clean up reconnection data
      this.reconnectionSessions.delete(previousConnectionId);

      await this.wsManager.sendMessage(connectionId, {
        type: MessageType.CONNECTION_STATUS,
        callId: sessionData.callId,
        timestamp: Date.now(),
        data: {
          status: 'reconnected',
          sessionId,
          message: 'Session successfully restored'
        }
      });
    } else {
      throw new ValidationError('No reconnection session found');
    }
  }

  /**
   * Authentication methods
   */
  private async authenticateWebSocket(token: string, userId: string, callId: string): Promise<AuthResult> {
    try {
      if (!this.options.enableAuth) {
        return { isValid: true, userId, callId };
      }

      if (!token) {
        return { isValid: false, error: 'Authentication token required' };
      }

      // Verify JWT token
      const decoded = jwt.verify(token, config.security.jwtSecret) as any;
      
      if (decoded.userId !== userId) {
        return { isValid: false, error: 'Token userId mismatch' };
      }

      // Additional validation can be added here
      // e.g., check token expiration, user permissions, etc.

      return {
        isValid: true,
        userId: decoded.userId,
        callId
      };

    } catch (error) {
      logger.error('JWT verification failed:', error);
      return { isValid: false, error: 'Invalid token' };
    }
  }

  private generateSessionToken(userId: string, callId: string): string {
    return jwt.sign(
      { 
        userId, 
        callId, 
        type: 'websocket_session',
        iat: Math.floor(Date.now() / 1000)
      },
      config.security.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  /**
   * Heartbeat and reconnection methods
   */
  private startHeartbeatForConnection(connectionId: string): void {
    const interval = setInterval(async () => {
      const connection = this.wsManager.getConnection(connectionId);
      if (!connection) {
        clearInterval(interval);
        return;
      }

      const now = Date.now();
      if (now - connection.lastHeartbeat > this.heartbeatConfig.timeout) {
        logger.warn(`Connection ${connectionId} heartbeat timeout`);
        this.wsManager.closeConnection(connectionId, 1001, 'Heartbeat timeout');
        clearInterval(interval);
        return;
      }

      // Send heartbeat ping
      try {
        await this.wsManager.sendMessage(connectionId, {
          type: MessageType.HEARTBEAT,
          callId: '',
          timestamp: now,
          data: { ping: true }
        });
      } catch (error) {
        logger.error(`Failed to send heartbeat to ${connectionId}:`, error);
        clearInterval(interval);
      }
    }, this.heartbeatConfig.interval);
  }

  private handleReconnectionRequest(connectionId: string, connection: any): void {
    if (!this.reconnectionConfig.enabled) return;

    // Store session data for reconnection
    const sessionData = {
      userId: connection.userId,
      callId: connection.callId,
      disconnectedAt: Date.now(),
      reconnectAttempts: 0
    };

    this.reconnectionSessions.set(connectionId, sessionData);

    // Set timeout to clean up reconnection data
    setTimeout(() => {
      if (this.reconnectionSessions.has(connectionId)) {
        this.reconnectionSessions.delete(connectionId);
        logger.info(`Reconnection session expired for ${connectionId}`);
      }
    }, this.options.reconnectTimeout);

    logger.info(`Reconnection session created for ${connectionId}`);
  }

  /**
   * Graceful shutdown
   */
  private async gracefulShutdown(): Promise<void> {
    logger.info('Received shutdown signal, starting graceful shutdown...');
    
    try {
      await this.stop();
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

export default RealtimeWebSocketServer;