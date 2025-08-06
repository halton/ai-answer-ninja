import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import PQueue from 'p-queue';

import {
  WebSocketMessage,
  MessageType,
  ConnectionContext,
  AudioChunk,
  ProcessedAudio,
  ConnectionStatus,
  ProcessingStage,
  PerformanceMetrics,
  ConnectionError,
  AudioProcessingError,
  ValidationError,
  RateLimitError,
} from '../types';
import { RedisService } from './redis';
import { RateLimiterService } from './rateLimiter';
import { MetricsService } from './metrics';
import { AudioProcessor } from './audioProcessor';
import { AzureSpeechService } from './azureSpeech';
import { IntentRecognitionService } from './intentRecognition';
import logger from '../utils/logger';

interface WebSocketManagerConfig {
  server: any;
  redis: RedisService;
  rateLimiter: RateLimiterService;
  metrics: MetricsService;
  config: any;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private connections: Map<string, ConnectionContext> = new Map();
  private wsConnections: Map<string, WebSocket> = new Map(); // Map connection ID to WebSocket
  private processingQueues: Map<string, PQueue> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  private readonly redis: RedisService;
  private readonly rateLimiter: RateLimiterService;
  private readonly metrics: MetricsService;
  private readonly audioProcessor: AudioProcessor;
  private readonly speechService: AzureSpeechService;
  private readonly intentService: IntentRecognitionService;
  private readonly config: any;

  constructor(options: WebSocketManagerConfig) {
    this.redis = options.redis;
    this.rateLimiter = options.rateLimiter;
    this.metrics = options.metrics;
    this.config = options.config;

    // Initialize services
    this.speechService = new AzureSpeechService(options.config.azure.speech);
    this.intentService = new IntentRecognitionService(options.config.azure.openai);
    this.audioProcessor = new AudioProcessor(options.config.performance);

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: options.server,
      path: '/realtime/conversation',
      verifyClient: this.verifyClient.bind(this),
      perMessageDeflate: {
        zlibDeflateOptions: {
          level: 6,
          chunkSize: 1024,
        },
        threshold: 1024,
        concurrencyLimit: 10,
        clientMaxWindowBits: 15,
        serverMaxWindowBits: 15,
        clientMaxNoContextTakeover: true,
        serverMaxNoContextTakeover: true,
      },
    });

    this.setupWebSocketHandlers();
    this.setupRedisSubscriptions();
  }

  private verifyClient(info: { req: IncomingMessage; origin: string }): boolean {
    try {
      const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        logger.warn('WebSocket connection rejected: No token provided');
        return false;
      }

      // Simple token verification (replace with proper JWT in production)
      if (!token.startsWith('valid_')) {
        logger.warn('WebSocket connection rejected: Invalid token format');
        return false;
      }

      // Extract user info from token (simplified)
      const parts = token.split('_');
      if (parts.length < 3) {
        logger.warn('WebSocket connection rejected: Invalid token structure');
        return false;
      }
      
      const userId = parts[1];
      const callId = parts[2];
      
      if (!userId || !callId) {
        logger.warn('WebSocket connection rejected: Invalid token payload');
        return false;
      }

      // Store user info in request for later use
      (info.req as any).userId = userId;
      (info.req as any).callId = callId;

      return true;
    } catch (error) {
      logger.warn({ error }, 'WebSocket connection rejected: Token verification failed');
      return false;
    }
  }

  private setupWebSocketHandlers(): void {
    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      const connectionId = uuidv4();
      const userId = (req as any).userId;
      const callId = (req as any).callId;

      try {
        // Check rate limiting
        await this.rateLimiter.checkRateLimit(userId, 'websocket');

        // Create connection context
        const context: ConnectionContext = {
          id: connectionId,
          userId,
          callId,
          startTime: Date.now(),
          lastActivity: Date.now(),
          isActive: true,
          rateLimitInfo: {
            requestCount: 0,
            connectionTime: Date.now(),
            lastRequest: Date.now(),
            isLimited: false,
          },
          audioBuffer: {
            chunks: [],
            totalDuration: 0,
            lastChunkTime: 0,
            isProcessing: false,
          },
          processingQueue: {
            pending: [],
            processing: [],
            completed: [],
            maxSize: 50,
          },
        };

        this.connections.set(connectionId, context);
        this.wsConnections.set(connectionId, ws); // Store WebSocket reference

        // Create processing queue for this connection
        this.processingQueues.set(connectionId, new PQueue({
          concurrency: 1,
          timeout: this.config.performance.processingTimeout,
        }));

        // Set up WebSocket event handlers
        this.setupConnectionHandlers(ws, context);

        // Send connection confirmation
        await this.sendMessage(ws, {
          type: MessageType.CONNECTION_STATUS,
          callId,
          timestamp: Date.now(),
          data: {
            status: ConnectionStatus.CONNECTED,
            connectionId,
            maxAudioDuration: this.config.performance.maxAudioDuration,
            supportedFormats: ['wav', 'mp3', 'opus', 'pcm'],
          },
        });

        // Subscribe to Redis channels for this call
        await this.redis.subscribe(`call:${callId}`, (message) => {
          this.handleRedisMessage(connectionId, message);
        });

        // Store connection in Redis for cluster coordination
        await this.redis.hset(`connections:${userId}`, connectionId, {
          userId,
          callId,
          startTime: context.startTime,
          serverInstance: process.env.HOSTNAME || 'unknown',
        });

        logger.info({
          connectionId,
          userId,
          callId,
          clientIP: req.socket.remoteAddress,
        }, 'WebSocket connection established');

        this.metrics.incrementCounter('websocket_connections_total');
        this.metrics.setGauge('websocket_active_connections', this.connections.size);

      } catch (error) {
        logger.error({ error, connectionId, userId }, 'Failed to establish WebSocket connection');
        ws.close(1008, 'Connection setup failed');
      }
    });

    this.wss.on('error', (error) => {
      logger.error({ error }, 'WebSocket server error');
    });
  }

  private setupConnectionHandlers(ws: WebSocket, context: ConnectionContext): void {
    ws.on('message', async (data: Buffer) => {
      try {
        context.lastActivity = Date.now();
        context.rateLimitInfo.requestCount++;
        context.rateLimitInfo.lastRequest = Date.now();

        // Check rate limiting per connection
        if (context.rateLimitInfo.requestCount > this.config.security.rateLimiting.maxRequests) {
          throw new RateLimitError('Too many requests per connection');
        }

        const message: WebSocketMessage = JSON.parse(data.toString());
        await this.handleMessage(ws, context, message);

      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.warn({ connectionId: context.id }, 'Invalid JSON received');
          await this.sendError(ws, context.callId, 'Invalid JSON format');
        } else {
          logger.error({ error, connectionId: context.id }, 'Message handling error');
          await this.sendError(ws, context.callId, error.message);
        }
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.handleConnectionClose(context.id, code, reason.toString());
    });

    ws.on('error', (error: Error) => {
      logger.error({ error, connectionId: context.id }, 'WebSocket connection error');
      this.handleConnectionClose(context.id, 1011, 'Connection error');
    });

    // Set up ping/pong for connection health
    ws.on('pong', () => {
      context.lastActivity = Date.now();
    });
  }

  private async handleMessage(
    ws: WebSocket,
    context: ConnectionContext,
    message: WebSocketMessage
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate message
      this.validateMessage(message);
      
      switch (message.type) {
        case MessageType.AUDIO_CHUNK:
          await this.handleAudioChunk(ws, context, message.data as AudioChunk);
          break;

        case MessageType.HEARTBEAT:
          await this.handleHeartbeat(ws, context);
          break;

        default:
          logger.warn({
            connectionId: context.id,
            messageType: message.type,
          }, 'Unknown message type received');
      }

      // Record processing latency
      const processingTime = Date.now() - startTime;
      this.metrics.recordHistogram('message_processing_duration_ms', processingTime);

    } catch (error) {
      logger.error({
        error,
        connectionId: context.id,
        messageType: message.type,
      }, 'Message processing failed');
      
      await this.sendError(ws, context.callId, error.message);
    }
  }

  private validateMessage(message: WebSocketMessage): void {
    if (!message.type || !message.callId || !message.timestamp) {
      throw new ValidationError('Invalid message format: missing required fields');
    }

    if (message.type === MessageType.AUDIO_CHUNK) {
      if (!message.data?.audioData) {
        throw new ValidationError('Audio data is required for audio chunks');
      }
    }
  }

  private async handleAudioChunk(
    ws: WebSocket,
    context: ConnectionContext,
    audioChunk: AudioChunk
  ): Promise<void> {
    // Validate audio chunk
    if (!audioChunk.audioData || !audioChunk.callId) {
      throw new ValidationError('Invalid audio chunk: missing required fields');
    }

    if (audioChunk.callId !== context.callId) {
      throw new ValidationError('Audio chunk callId mismatch');
    }

    // Add to processing queue
    const queue = this.processingQueues.get(context.id);
    if (!queue) {
      throw new ConnectionError('Processing queue not found');
    }

    // Add to queue with priority processing
    queue.add(async () => {
      await this.processAudioChunk(ws, context, audioChunk);
    }, { priority: -audioChunk.sequenceNumber }); // Process in sequence order

    // Update context
    context.audioBuffer.chunks.push(audioChunk);
    context.audioBuffer.lastChunkTime = Date.now();
    context.processingQueue.pending.push(audioChunk);

    // Send processing status
    await this.sendMessage(ws, {
      type: MessageType.PROCESSING_STATUS,
      callId: context.callId,
      timestamp: Date.now(),
      data: {
        stage: ProcessingStage.AUDIO_RECEIVED,
        queueSize: queue.size,
        sequenceNumber: audioChunk.sequenceNumber,
      },
    });
  }

  public async processAudioData(audioChunk: AudioChunk, userId: string): Promise<ProcessedAudio> {
    const startTime = Date.now();
    const metrics: Partial<PerformanceMetrics> = {
      callId: audioChunk.callId,
      timestamp: startTime,
      latency: {
        totalPipeline: 0,
        audioPreprocessing: 0,
        speechToText: 0,
        intentRecognition: 0,
        aiGeneration: 0,
        textToSpeech: 0,
        networkTransmission: 0,
      },
    };

    try {
      // Stage 1: Audio Preprocessing
      const preprocessStart = Date.now();
      const preprocessedAudio = await this.audioProcessor.preprocessAudio(audioChunk);
      metrics.latency!.audioPreprocessing = Date.now() - preprocessStart;

      // Stage 2: Voice Activity Detection
      const vadResult = await this.audioProcessor.detectVoiceActivity(preprocessedAudio);
      if (!vadResult.isSpeech) {
        logger.debug({ callId: audioChunk.callId }, 'No speech detected in audio chunk');
        return {
          id: audioChunk.id,
          callId: audioChunk.callId,
          timestamp: audioChunk.timestamp,
          processingLatency: Date.now() - startTime,
        };
      }

      // Stage 3: Speech-to-Text
      const sttStart = Date.now();
      const transcript = await this.speechService.speechToText(preprocessedAudio);
      metrics.latency!.speechToText = Date.now() - sttStart;

      if (!transcript || transcript.trim().length === 0) {
        logger.debug({ callId: audioChunk.callId }, 'No transcript generated');
        return {
          id: audioChunk.id,
          callId: audioChunk.callId,
          timestamp: audioChunk.timestamp,
          processingLatency: Date.now() - startTime,
        };
      }

      // Stage 4: Intent Recognition
      const intentStart = Date.now();
      const intent = await this.intentService.classifyIntent(transcript, {
        userId,
        callId: audioChunk.callId,
        previousIntents: [], // TODO: Get from context
      });
      metrics.latency!.intentRecognition = Date.now() - intentStart;

      // Stage 5: AI Response Generation
      const aiStart = Date.now();
      const aiResponse = await this.intentService.generateResponse(intent, {
        transcript,
        userId,
        callId: audioChunk.callId,
      });
      metrics.latency!.aiGeneration = Date.now() - aiStart;

      // Stage 6: Text-to-Speech
      const ttsStart = Date.now();
      const audioResponse = await this.speechService.textToSpeech(aiResponse.text);
      metrics.latency!.textToSpeech = Date.now() - ttsStart;

      // Calculate total latency
      metrics.latency!.totalPipeline = Date.now() - startTime;

      // Record metrics
      this.metrics.recordLatencyMetrics(metrics.latency!);

      return {
        id: audioChunk.id,
        callId: audioChunk.callId,
        timestamp: audioChunk.timestamp,
        transcript,
        confidence: intent.confidence,
        intent,
        response: aiResponse,
        audioResponse,
        processingLatency: metrics.latency!.totalPipeline,
        metadata: preprocessedAudio.metadata,
      };

    } catch (error) {
      logger.error({ error, callId: audioChunk.callId }, 'Audio processing pipeline failed');
      throw new AudioProcessingError(`Processing failed: ${error.message}`);
    }
  }

  private async processAudioChunk(
    ws: WebSocket,
    context: ConnectionContext,
    audioChunk: AudioChunk
  ): Promise<void> {
    try {
      context.audioBuffer.isProcessing = true;
      context.processingQueue.processing.push(audioChunk);

      // Remove from pending queue
      const pendingIndex = context.processingQueue.pending.findIndex(
        chunk => chunk.id === audioChunk.id
      );
      if (pendingIndex >= 0) {
        context.processingQueue.pending.splice(pendingIndex, 1);
      }

      // Process the audio
      const result = await this.processAudioData(audioChunk, context.userId);

      // Move to completed queue
      context.processingQueue.completed.push(result);
      const processingIndex = context.processingQueue.processing.findIndex(
        chunk => chunk.id === audioChunk.id
      );
      if (processingIndex >= 0) {
        context.processingQueue.processing.splice(processingIndex, 1);
      }

      // Send results back to client
      if (result.transcript) {
        await this.sendMessage(ws, {
          type: MessageType.TRANSCRIPT,
          callId: context.callId,
          timestamp: Date.now(),
          data: {
            transcript: result.transcript,
            confidence: result.confidence,
            sequenceNumber: audioChunk.sequenceNumber,
          },
        });
      }

      if (result.response && result.audioResponse) {
        await this.sendMessage(ws, {
          type: MessageType.AI_RESPONSE,
          callId: context.callId,
          timestamp: Date.now(),
          data: {
            text: result.response.text,
            audioData: result.audioResponse,
            shouldTerminate: result.response.shouldTerminate,
            confidence: result.response.confidence,
            sequenceNumber: audioChunk.sequenceNumber,
          },
        });

        // Publish to Redis for other services
        await this.redis.publish(`call:${context.callId}`, {
          type: 'ai_response_generated',
          callId: context.callId,
          userId: context.userId,
          response: result.response,
          timestamp: Date.now(),
        });
      }

      // Send processing complete status
      await this.sendMessage(ws, {
        type: MessageType.PROCESSING_STATUS,
        callId: context.callId,
        timestamp: Date.now(),
        data: {
          stage: ProcessingStage.RESPONSE_SENT,
          processingLatency: result.processingLatency,
          sequenceNumber: audioChunk.sequenceNumber,
        },
      });

      // Cleanup old chunks to prevent memory leaks
      this.cleanupAudioBuffer(context);

    } catch (error) {
      logger.error({
        error,
        connectionId: context.id,
        audioChunkId: audioChunk.id,
      }, 'Audio chunk processing failed');

      await this.sendError(ws, context.callId, `Processing failed: ${error.message}`);
    } finally {
      context.audioBuffer.isProcessing = false;
    }
  }

  private cleanupAudioBuffer(context: ConnectionContext): void {
    const maxChunks = 10;
    const maxCompletedResults = 20;

    // Keep only recent audio chunks
    if (context.audioBuffer.chunks.length > maxChunks) {
      context.audioBuffer.chunks = context.audioBuffer.chunks.slice(-maxChunks);
    }

    // Keep only recent completed results
    if (context.processingQueue.completed.length > maxCompletedResults) {
      context.processingQueue.completed = context.processingQueue.completed.slice(-maxCompletedResults);
    }
  }

  private async handleHeartbeat(ws: WebSocket, context: ConnectionContext): Promise<void> {
    await this.sendMessage(ws, {
      type: MessageType.HEARTBEAT,
      callId: context.callId,
      timestamp: Date.now(),
      data: {
        status: 'alive',
        serverTime: Date.now(),
        connection: {
          uptime: Date.now() - context.startTime,
          messageCount: context.rateLimitInfo.requestCount,
        },
      },
    });
  }

  private async sendMessage(ws: WebSocket, message: WebSocketMessage): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) {
      const serialized = JSON.stringify(message);
      ws.send(serialized);
    }
  }

  private async sendError(ws: WebSocket, callId: string, error: string): Promise<void> {
    await this.sendMessage(ws, {
      type: MessageType.ERROR,
      callId,
      timestamp: Date.now(),
      data: { error },
    });
  }

  private handleConnectionClose(connectionId: string, code: number, reason: string): void {
    const context = this.connections.get(connectionId);
    if (context) {
      context.isActive = false;
      
      logger.info({
        connectionId,
        userId: context.userId,
        callId: context.callId,
        code,
        reason,
        duration: Date.now() - context.startTime,
      }, 'WebSocket connection closed');

      // Cleanup
      this.connections.delete(connectionId);
      this.wsConnections.delete(connectionId);
      this.processingQueues.delete(connectionId);

      // Unsubscribe from Redis
      this.redis.unsubscribe(`call:${context.callId}`);

      // Remove from Redis
      this.redis.hdel(`connections:${context.userId}`, connectionId);

      this.metrics.decrementGauge('websocket_active_connections', 1);
      this.metrics.recordHistogram('websocket_connection_duration_ms', Date.now() - context.startTime);
    }
  }

  private setupRedisSubscriptions(): void {
    // Subscribe to global system events
    this.redis.subscribe('system:shutdown', () => {
      logger.info('Received system shutdown signal');
      this.shutdown();
    });

    this.redis.subscribe('system:maintenance', (message) => {
      logger.info({ message }, 'Maintenance mode activated');
      // Notify all clients about maintenance
      this.broadcastToAll({
        type: MessageType.CONNECTION_STATUS,
        callId: 'system',
        timestamp: Date.now(),
        data: {
          status: 'maintenance',
          message: message.message,
        },
      });
    });
  }

  private handleRedisMessage(connectionId: string, message: any): void {
    const context = this.connections.get(connectionId);
    if (!context) return;

    logger.debug({
      connectionId,
      messageType: message.type,
    }, 'Received Redis message');

    // Handle different types of Redis messages
    switch (message.type) {
      case 'call_transfer':
        this.handleCallTransfer(context, message);
        break;
      case 'call_terminate':
        this.handleCallTerminate(context, message);
        break;
      default:
        logger.debug({ messageType: message.type }, 'Unknown Redis message type');
    }
  }

  private async handleCallTransfer(context: ConnectionContext, message: any): Promise<void> {
    // Notify client about call transfer
    const ws = this.wsConnections.get(context.id);
    if (ws) {
      await this.sendMessage(ws, {
        type: MessageType.CONNECTION_STATUS,
        callId: context.callId,
        timestamp: Date.now(),
        data: {
          status: 'transferring',
          transferTo: message.transferTo,
        },
      });
    }
  }

  private async handleCallTerminate(context: ConnectionContext, message: any): Promise<void> {
    const ws = this.wsConnections.get(context.id);
    if (ws) {
      await this.sendMessage(ws, {
        type: MessageType.CONNECTION_STATUS,
        callId: context.callId,
        timestamp: Date.now(),
        data: {
          status: 'terminated',
          reason: message.reason,
        },
      });
      
      // Close connection gracefully
      ws.close(1000, 'Call terminated');
    }
  }

  private async broadcastToAll(message: WebSocketMessage): Promise<void> {
    const promises = Array.from(this.wss.clients).map(async (ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        await this.sendMessage(ws, message);
      }
    });

    await Promise.allSettled(promises);
  }

  // Public methods for external access

  public async initialize(): Promise<void> {
    logger.info('Initializing WebSocket manager');
    
    // Initialize services
    await this.speechService.initialize();
    await this.intentService.initialize();
    await this.audioProcessor.initialize();
    
    // Inject services into AudioProcessor
    const aiConversationService = new (await import('./aiConversation')).AIConversationService(
      this.config.azure.openai
    );
    await aiConversationService.initialize();
    
    this.audioProcessor.setServices(
      this.speechService,
      this.intentService,
      aiConversationService
    );

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();

    logger.info('WebSocket manager initialized successfully');
  }

  private startHeartbeatMonitoring(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds timeout

      for (const [connectionId, context] of this.connections) {
        if (now - context.lastActivity > timeout) {
          logger.warn({
            connectionId,
            lastActivity: context.lastActivity,
          }, 'Connection timeout detected');

          const ws = this.wsConnections.get(connectionId);
          if (ws) {
            ws.ping();
            
            // Close connection if still inactive after ping
            setTimeout(() => {
              if (now - context.lastActivity > timeout + 5000) {
                ws.close(1001, 'Connection timeout');
              }
            }, 5000);
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }

  public async getConnectionStats(): Promise<any> {
    return {
      totalConnections: this.connections.size,
      activeConnections: Array.from(this.connections.values()).filter(c => c.isActive).length,
      connections: Array.from(this.connections.values()).map(context => ({
        id: context.id,
        userId: context.userId,
        callId: context.callId,
        uptime: Date.now() - context.startTime,
        lastActivity: context.lastActivity,
        isActive: context.isActive,
        queueSizes: {
          pending: context.processingQueue.pending.length,
          processing: context.processingQueue.processing.length,
          completed: context.processingQueue.completed.length,
        },
      })),
    };
  }

  public async getProcessingStatus(callId: string): Promise<any> {
    const context = Array.from(this.connections.values()).find(c => c.callId === callId);
    
    if (!context) {
      return { status: 'not_found' };
    }

    return {
      callId,
      connectionId: context.id,
      status: context.isActive ? 'active' : 'inactive',
      processing: context.audioBuffer.isProcessing,
      queue: {
        pending: context.processingQueue.pending.length,
        processing: context.processingQueue.processing.length,
        completed: context.processingQueue.completed.length,
      },
      uptime: Date.now() - context.startTime,
      lastActivity: context.lastActivity,
    };
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket manager');

    // Stop heartbeat monitoring
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all connections gracefully
    const closePromises = Array.from(this.wss.clients).map(async (ws) => {
      return new Promise<void>((resolve) => {
        ws.close(1001, 'Server shutdown');
        ws.on('close', () => resolve());
        
        // Force close after timeout
        setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) {
            ws.terminate();
          }
          resolve();
        }, 5000);
      });
    });

    await Promise.allSettled(closePromises);

    // Clear all connections and queues
    this.connections.clear();
    this.wsConnections.clear();
    this.processingQueues.clear();

    // Close WebSocket server
    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    logger.info('WebSocket manager shutdown complete');
  }
}