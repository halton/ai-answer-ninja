import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { WS_CONFIG } from '../config';
import {
  WSMessage,
  WSMessageType,
  AudioChunk,
  STTResult,
  TTSResult,
  SpeechServiceError,
  ErrorCode,
} from '../types';
import AzureSTTService from './azureSTT';
import AzureTTSService from './azureTTS';
import IntelligentCacheService from '../cache/intelligentCache';
import PerformanceMonitor from './performanceMonitor';
import { createDefaultPipeline } from '../pipelines/audioProcessingPipeline';

interface Connection {
  id: string;
  ws: WebSocket;
  callId?: string;
  userId?: string;
  isAlive: boolean;
  createdAt: Date;
  lastActivity: Date;
  pipeline?: any;
}

export class WebSocketHandler extends EventEmitter {
  private wss: WebSocketServer;
  private connections: Map<string, Connection>;
  private heartbeatInterval?: NodeJS.Timeout;
  private messageQueue: Map<string, WSMessage[]>;

  constructor(server?: HTTPServer) {
    super();
    
    // Create WebSocket server
    this.wss = new WebSocketServer({
      port: server ? undefined : WS_CONFIG.port,
      server: server,
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3,
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024,
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024,
      },
    });

    this.connections = new Map();
    this.messageQueue = new Map();
    
    // Set up WebSocket server events
    this.setupWebSocketServer();
    
    // Start heartbeat mechanism
    this.startHeartbeat();
    
    logger.info(`WebSocket server initialized on port ${WS_CONFIG.port}`);
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, request: any) => {
      this.handleNewConnection(ws, request);
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleNewConnection(ws: WebSocket, request: any): void {
    const connectionId = uuidv4();
    
    // Check connection limit
    if (this.connections.size >= WS_CONFIG.maxConnections) {
      logger.warn('Max connections reached, rejecting new connection');
      ws.close(1008, 'Max connections reached');
      return;
    }

    // Create connection object
    const connection: Connection = {
      id: connectionId,
      ws,
      isAlive: true,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    // Store connection
    this.connections.set(connectionId, connection);
    
    // Update metrics
    PerformanceMonitor.updateConnectionMetrics(this.connections.size);
    
    logger.info(`New WebSocket connection established: ${connectionId}`);

    // Set up connection event handlers
    this.setupConnectionHandlers(connection);
    
    // Send connection acknowledgment
    this.sendMessage(connection, {
      type: WSMessageType.ConnectionAck,
      callId: '',
      timestamp: Date.now(),
      data: { connectionId },
    });
  }

  /**
   * Set up connection event handlers
   */
  private setupConnectionHandlers(connection: Connection): void {
    const { ws } = connection;

    ws.on('message', async (data: Buffer) => {
      try {
        connection.lastActivity = new Date();
        await this.handleMessage(connection, data);
      } catch (error) {
        logger.error(`Error handling message from ${connection.id}:`, error);
        this.sendError(connection, error as Error);
      }
    });

    ws.on('pong', () => {
      connection.isAlive = true;
      connection.lastActivity = new Date();
    });

    ws.on('close', (code, reason) => {
      logger.info(`WebSocket connection closed: ${connection.id} (${code}: ${reason})`);
      this.handleConnectionClose(connection);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket connection error for ${connection.id}:`, error);
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(connection: Connection, data: Buffer): Promise<void> {
    let message: WSMessage;
    
    try {
      // Parse message
      const jsonStr = data.toString();
      message = JSON.parse(jsonStr);
    } catch (error) {
      // Handle binary audio data
      if (connection.callId) {
        await this.handleAudioChunk(connection, data);
        return;
      }
      throw new SpeechServiceError(
        'Invalid message format',
        ErrorCode.INVALID_CONFIG,
        400
      );
    }

    // Handle different message types
    switch (message.type) {
      case WSMessageType.ConnectionInit:
        await this.handleConnectionInit(connection, message);
        break;
        
      case WSMessageType.AudioChunk:
        await this.handleAudioMessage(connection, message);
        break;
        
      case WSMessageType.TTSRequest:
        await this.handleTTSRequest(connection, message);
        break;
        
      case WSMessageType.Heartbeat:
        this.handleHeartbeat(connection);
        break;
        
      case WSMessageType.ConnectionClose:
        this.handleConnectionClose(connection);
        break;
        
      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle connection initialization
   */
  private async handleConnectionInit(connection: Connection, message: WSMessage): Promise<void> {
    const { callId, userId } = message.data;
    
    connection.callId = callId;
    connection.userId = userId;
    
    // Create audio processing pipeline for this connection
    connection.pipeline = createDefaultPipeline();
    
    // Start STT stream for this call
    await AzureSTTService.startStreamingRecognition(callId, {
      language: message.data.language || 'zh-CN',
    });
    
    // Set up STT event listeners
    AzureSTTService.on('partial_result', (data) => {
      if (data.callId === callId) {
        this.sendSTTResult(connection, data.result, false);
      }
    });
    
    AzureSTTService.on('final_result', (data) => {
      if (data.callId === callId) {
        this.sendSTTResult(connection, data.result, true);
      }
    });
    
    logger.info(`Connection ${connection.id} initialized for call ${callId}`);
  }

  /**
   * Handle audio chunk message
   */
  private async handleAudioMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (!connection.callId) {
      throw new SpeechServiceError(
        'Connection not initialized',
        ErrorCode.INVALID_CONFIG,
        400
      );
    }

    const audioData = Buffer.from(message.data.audioData, 'base64');
    
    await this.handleAudioChunk(connection, audioData, message.sequenceNumber);
  }

  /**
   * Handle raw audio chunk
   */
  private async handleAudioChunk(
    connection: Connection,
    audioData: Buffer,
    sequenceNumber?: number
  ): Promise<void> {
    if (!connection.callId) return;

    const operationId = `${connection.callId}_${Date.now()}`;
    PerformanceMonitor.startOperation(operationId);

    try {
      // Create audio chunk
      const chunk: AudioChunk = {
        data: audioData,
        timestamp: Date.now(),
        sequenceNumber: sequenceNumber || 0,
        callId: connection.callId,
        userId: connection.userId,
      };

      // Process through pipeline if available
      if (connection.pipeline) {
        await connection.pipeline.process(chunk);
      }

      // Send to STT service
      await AzureSTTService.processAudioChunk(chunk);
      
      // Update metrics
      PerformanceMonitor.updateAudioBufferMetrics(connection.callId, audioData.length);
      PerformanceMonitor.endOperation(operationId, 'stt', true);
    } catch (error) {
      PerformanceMonitor.endOperation(operationId, 'stt', false);
      PerformanceMonitor.recordError('stt', error as Error);
      throw error;
    }
  }

  /**
   * Handle TTS request
   */
  private async handleTTSRequest(connection: Connection, message: WSMessage): Promise<void> {
    const operationId = `tts_${Date.now()}`;
    PerformanceMonitor.startOperation(operationId);

    try {
      const { text, voiceName, language } = message.data;
      
      // Check cache first
      let result = await IntelligentCacheService.getTTSCache(text, voiceName);
      
      if (!result) {
        // Generate TTS
        result = await AzureTTSService.synthesize(text, {
          voiceName,
          language,
        });
        
        // Cache the result
        await IntelligentCacheService.setTTSCache(text, voiceName, result);
      }
      
      // Send result
      this.sendTTSResult(connection, result);
      
      PerformanceMonitor.endOperation(operationId, 'tts', true, {
        cached: result.cached,
        voice: voiceName,
      });
    } catch (error) {
      PerformanceMonitor.endOperation(operationId, 'tts', false);
      PerformanceMonitor.recordError('tts', error as Error);
      throw error;
    }
  }

  /**
   * Send STT result to client
   */
  private sendSTTResult(connection: Connection, result: STTResult, isFinal: boolean): void {
    this.sendMessage(connection, {
      type: WSMessageType.STTResult,
      callId: connection.callId || '',
      timestamp: Date.now(),
      data: {
        ...result,
        isFinal,
      },
    });
  }

  /**
   * Send TTS result to client
   */
  private sendTTSResult(connection: Connection, result: TTSResult): void {
    this.sendMessage(connection, {
      type: WSMessageType.TTSResult,
      callId: connection.callId || '',
      timestamp: Date.now(),
      data: {
        audioData: result.audioData.toString('base64'),
        duration: result.duration,
        format: result.format,
        cached: result.cached,
      },
    });
  }

  /**
   * Send error to client
   */
  private sendError(connection: Connection, error: Error): void {
    const speechError = error as SpeechServiceError;
    
    this.sendMessage(connection, {
      type: WSMessageType.Error,
      callId: connection.callId || '',
      timestamp: Date.now(),
      data: {
        message: error.message,
        code: speechError.code || 'UNKNOWN_ERROR',
        details: speechError.details,
      },
    });
  }

  /**
   * Send message to client
   */
  private sendMessage(connection: Connection, message: WSMessage): void {
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(message));
    } else {
      // Queue message if connection is not ready
      if (!this.messageQueue.has(connection.id)) {
        this.messageQueue.set(connection.id, []);
      }
      this.messageQueue.get(connection.id)!.push(message);
    }
  }

  /**
   * Handle heartbeat
   */
  private handleHeartbeat(connection: Connection): void {
    connection.isAlive = true;
    connection.lastActivity = new Date();
    
    this.sendMessage(connection, {
      type: WSMessageType.Heartbeat,
      callId: connection.callId || '',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle connection close
   */
  private async handleConnectionClose(connection: Connection): Promise<void> {
    // Stop STT stream if active
    if (connection.callId) {
      await AzureSTTService.stopStreamingRecognition(connection.callId);
      await AzureTTSService.stopSynthesis(connection.callId);
    }
    
    // Clean up pipeline
    if (connection.pipeline) {
      connection.pipeline.destroy();
    }
    
    // Remove connection
    this.connections.delete(connection.id);
    this.messageQueue.delete(connection.id);
    
    // Update metrics
    PerformanceMonitor.updateConnectionMetrics(this.connections.size);
    
    logger.info(`Connection ${connection.id} cleaned up`);
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [id, connection] of this.connections) {
        if (!connection.isAlive) {
          logger.warn(`Connection ${id} is not responding, terminating`);
          connection.ws.terminate();
          this.handleConnectionClose(connection);
        } else {
          connection.isAlive = false;
          connection.ws.ping();
        }
      }
    }, WS_CONFIG.heartbeatInterval);
  }

  /**
   * Broadcast message to all connections
   */
  public broadcast(message: WSMessage, filter?: (conn: Connection) => boolean): void {
    for (const connection of this.connections.values()) {
      if (!filter || filter(connection)) {
        this.sendMessage(connection, message);
      }
    }
  }

  /**
   * Get connection statistics
   */
  public getStats(): any {
    const now = Date.now();
    const connections = Array.from(this.connections.values());
    
    return {
      totalConnections: connections.length,
      activeConnections: connections.filter(c => c.isAlive).length,
      averageConnectionAge: connections.reduce(
        (sum, c) => sum + (now - c.createdAt.getTime()),
        0
      ) / connections.length || 0,
      messageQueueSize: Array.from(this.messageQueue.values()).reduce(
        (sum, queue) => sum + queue.length,
        0
      ),
    };
  }

  /**
   * Destroy WebSocket handler
   */
  public async destroy(): Promise<void> {
    // Clear heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Close all connections
    for (const connection of this.connections.values()) {
      await this.handleConnectionClose(connection);
      connection.ws.close();
    }
    
    // Close WebSocket server
    this.wss.close();
    
    logger.info('WebSocket handler destroyed');
  }
}

// Export singleton instance
export default WebSocketHandler;