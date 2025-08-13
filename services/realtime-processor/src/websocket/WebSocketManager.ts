/**
 * WebSocket Connection Manager
 * Handles multiple client connections with heartbeat, reconnection, and message queuing
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { 
  ConnectionContext, 
  WebSocketMessage, 
  MessageType, 
  ConnectionStatus,
  ConnectionError,
  RateLimitError,
  ValidationError
} from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface ClientConnection {
  id: string;
  ws: WebSocket;
  userId: string;
  callId: string;
  status: ConnectionStatus;
  context: ConnectionContext;
  lastHeartbeat: number;
  messageQueue: WebSocketMessage[];
  reconnectAttempts: number;
  authenticatedAt: number;
  remoteAddress: string;
  userAgent?: string;
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  reconnections: number;
  errors: number;
}

export class WebSocketManager extends EventEmitter {
  private server: WebSocket.Server | null = null;
  private connections: Map<string, ClientConnection> = new Map();
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> connectionIds
  private callConnections: Map<string, Set<string>> = new Map(); // callId -> connectionIds
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private stats: ConnectionStats = {
    totalConnections: 0,
    activeConnections: 0,
    messagesSent: 0,
    messagesReceived: 0,
    bytesTransferred: 0,
    reconnections: 0,
    errors: 0
  };

  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 60000; // 60 seconds
  private readonly MAX_MESSAGE_QUEUE_SIZE = 100;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly MAX_MESSAGES_PER_MINUTE = 1000;

  constructor() {
    super();
    this.setupCleanupInterval();
    logger.info('WebSocketManager initialized');
  }

  /**
   * Initialize WebSocket server
   */
  public initialize(server: any): void {
    this.server = new WebSocket.Server({ 
      server,
      path: '/realtime/ws',
      perMessageDeflate: true,
      maxPayload: 10 * 1024 * 1024, // 10MB max payload
      clientTracking: true
    });

    this.server.on('connection', this.handleConnection.bind(this));
    this.server.on('error', this.handleServerError.bind(this));
    this.server.on('listening', () => {
      logger.info('WebSocket server listening on /realtime/ws');
    });

    this.startHeartbeat();
    logger.info('WebSocket server initialized');
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(ws: WebSocket, request: any): Promise<void> {
    const connectionId = uuidv4();
    const remoteAddress = request.socket.remoteAddress || 'unknown';
    const userAgent = request.headers['user-agent'];

    logger.info(`New WebSocket connection: ${connectionId} from ${remoteAddress}`);

    try {
      // Rate limiting check
      await this.checkRateLimit(remoteAddress);

      const connection: ClientConnection = {
        id: connectionId,
        ws,
        userId: '', // Will be set during authentication
        callId: '', // Will be set during call initialization
        status: ConnectionStatus.CONNECTING,
        context: this.createConnectionContext(connectionId),
        lastHeartbeat: Date.now(),
        messageQueue: [],
        reconnectAttempts: 0,
        authenticatedAt: 0,
        remoteAddress,
        userAgent
      };

      this.connections.set(connectionId, connection);
      this.stats.totalConnections++;
      this.stats.activeConnections++;

      // Setup connection handlers
      ws.on('message', (data) => this.handleMessage(connectionId, data));
      ws.on('close', (code, reason) => this.handleDisconnection(connectionId, code, reason));
      ws.on('error', (error) => this.handleConnectionError(connectionId, error));
      ws.on('pong', () => this.handlePong(connectionId));

      // Send connection acknowledgment
      await this.sendMessage(connectionId, {
        type: MessageType.CONNECTION_STATUS,
        callId: '',
        timestamp: Date.now(),
        data: {
          connectionId,
          status: ConnectionStatus.CONNECTED,
          serverTime: Date.now()
        }
      });

      connection.status = ConnectionStatus.CONNECTED;
      this.emit('connection', { connectionId, connection });

    } catch (error) {
      logger.error(`Failed to handle connection ${connectionId}:`, error);
      ws.close(1008, 'Connection initialization failed');
      this.stats.errors++;
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(connectionId: string, data: WebSocket.Data): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn(`Message received for unknown connection: ${connectionId}`);
      return;
    }

    try {
      connection.lastHeartbeat = Date.now();
      this.stats.messagesReceived++;

      let message: WebSocketMessage;

      // Handle binary data (audio chunks)
      if (Buffer.isBuffer(data)) {
        message = {
          type: MessageType.AUDIO_CHUNK,
          callId: connection.callId,
          timestamp: Date.now(),
          data: data
        };
        this.stats.bytesTransferred += data.length;
      } else {
        // Handle text messages (JSON)
        const textData = data.toString();
        message = JSON.parse(textData);
        this.stats.bytesTransferred += textData.length;
      }

      // Validate message
      await this.validateMessage(message, connection);

      // Rate limiting check
      await this.checkMessageRateLimit(connection);

      // Update connection context
      this.updateConnectionActivity(connection, message);

      // Emit message event
      this.emit('message', { connectionId, message, connection });

      logger.debug(`Message received from ${connectionId}: ${message.type}`);

    } catch (error) {
      logger.error(`Error handling message from ${connectionId}:`, error);
      await this.sendError(connectionId, 'MESSAGE_PROCESSING_ERROR', error.message);
      this.stats.errors++;
    }
  }

  /**
   * Handle connection disconnection
   */
  private handleDisconnection(connectionId: string, code: number, reason: Buffer): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    logger.info(`WebSocket disconnected: ${connectionId}, code: ${code}, reason: ${reason.toString()}`);

    connection.status = ConnectionStatus.DISCONNECTED;
    
    // Remove from mappings
    this.removeConnectionFromMappings(connection);
    
    // Clean up connection
    this.connections.delete(connectionId);
    this.stats.activeConnections--;

    this.emit('disconnection', { connectionId, connection, code, reason: reason.toString() });
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(connectionId: string, error: Error): void {
    const connection = this.connections.get(connectionId);
    logger.error(`WebSocket connection error for ${connectionId}:`, error);
    
    if (connection) {
      connection.status = ConnectionStatus.ERROR;
    }
    
    this.stats.errors++;
    this.emit('connectionError', { connectionId, error });
  }

  /**
   * Handle pong response
   */
  private handlePong(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
      logger.debug(`Pong received from ${connectionId}`);
    }
  }

  /**
   * Send message to specific connection
   */
  public async sendMessage(connectionId: string, message: WebSocketMessage): Promise<boolean> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn(`Attempt to send message to unknown connection: ${connectionId}`);
      return false;
    }

    if (connection.ws.readyState !== WebSocket.OPEN) {
      // Queue message if connection is not ready
      if (connection.messageQueue.length < this.MAX_MESSAGE_QUEUE_SIZE) {
        connection.messageQueue.push(message);
        logger.debug(`Message queued for ${connectionId}: ${message.type}`);
        return true;
      } else {
        logger.warn(`Message queue full for connection ${connectionId}`);
        return false;
      }
    }

    try {
      let data: string | Buffer;

      // Handle binary data (audio responses)
      if (message.type === MessageType.AUDIO_RESPONSE && Buffer.isBuffer(message.data)) {
        data = message.data;
      } else {
        // JSON message
        data = JSON.stringify(message);
      }

      connection.ws.send(data);
      this.stats.messagesSent++;
      this.stats.bytesTransferred += data.length;
      
      logger.debug(`Message sent to ${connectionId}: ${message.type}`);
      return true;

    } catch (error) {
      logger.error(`Failed to send message to ${connectionId}:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Broadcast message to all connections for a call
   */
  public async broadcastToCall(callId: string, message: WebSocketMessage): Promise<number> {
    const connectionIds = this.callConnections.get(callId) || new Set();
    let successCount = 0;

    for (const connectionId of connectionIds) {
      const success = await this.sendMessage(connectionId, message);
      if (success) successCount++;
    }

    logger.debug(`Broadcasted message to ${successCount}/${connectionIds.size} connections for call ${callId}`);
    return successCount;
  }

  /**
   * Broadcast message to all connections for a user
   */
  public async broadcastToUser(userId: string, message: WebSocketMessage): Promise<number> {
    const connectionIds = this.userConnections.get(userId) || new Set();
    let successCount = 0;

    for (const connectionId of connectionIds) {
      const success = await this.sendMessage(connectionId, message);
      if (success) successCount++;
    }

    logger.debug(`Broadcasted message to ${successCount}/${connectionIds.size} connections for user ${userId}`);
    return successCount;
  }

  /**
   * Send error message to connection
   */
  public async sendError(connectionId: string, errorCode: string, errorMessage: string): Promise<boolean> {
    return this.sendMessage(connectionId, {
      type: MessageType.ERROR,
      callId: '',
      timestamp: Date.now(),
      data: {
        code: errorCode,
        message: errorMessage
      }
    });
  }

  /**
   * Authenticate connection
   */
  public authenticateConnection(connectionId: string, userId: string, callId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    connection.userId = userId;
    connection.callId = callId;
    connection.authenticatedAt = Date.now();

    // Add to mappings
    this.addConnectionToMappings(connection);

    logger.info(`Connection ${connectionId} authenticated for user ${userId}, call ${callId}`);
    return true;
  }

  /**
   * Get connection information
   */
  public getConnection(connectionId: string): ClientConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get connections for user
   */
  public getUserConnections(userId: string): ClientConnection[] {
    const connectionIds = this.userConnections.get(userId) || new Set();
    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter(conn => conn !== undefined) as ClientConnection[];
  }

  /**
   * Get connections for call
   */
  public getCallConnections(callId: string): ClientConnection[] {
    const connectionIds = this.callConnections.get(callId) || new Set();
    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter(conn => conn !== undefined) as ClientConnection[];
  }

  /**
   * Get statistics
   */
  public getStats(): ConnectionStats {
    return { ...this.stats };
  }

  /**
   * Close connection
   */
  public closeConnection(connectionId: string, code: number = 1000, reason: string = 'Normal closure'): void {
    const connection = this.connections.get(connectionId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(code, reason);
    }
  }

  /**
   * Shutdown manager
   */
  public shutdown(): void {
    logger.info('Shutting down WebSocket manager...');

    // Stop intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    for (const [connectionId, connection] of this.connections) {
      this.closeConnection(connectionId, 1001, 'Server shutdown');
    }

    // Close server
    if (this.server) {
      this.server.close();
    }

    this.connections.clear();
    this.userConnections.clear();
    this.callConnections.clear();

    logger.info('WebSocket manager shut down');
  }

  /**
   * Private helper methods
   */
  private createConnectionContext(connectionId: string): ConnectionContext {
    return {
      id: connectionId,
      userId: '',
      callId: '',
      startTime: Date.now(),
      lastActivity: Date.now(),
      isActive: true,
      rateLimitInfo: {
        requestCount: 0,
        connectionTime: Date.now(),
        lastRequest: 0,
        isLimited: false
      },
      audioBuffer: {
        chunks: [],
        totalDuration: 0,
        lastChunkTime: 0,
        isProcessing: false
      },
      processingQueue: {
        pending: [],
        processing: [],
        completed: [],
        maxSize: 50
      }
    };
  }

  private addConnectionToMappings(connection: ClientConnection): void {
    // Add to user mapping
    if (connection.userId) {
      if (!this.userConnections.has(connection.userId)) {
        this.userConnections.set(connection.userId, new Set());
      }
      this.userConnections.get(connection.userId)!.add(connection.id);
    }

    // Add to call mapping
    if (connection.callId) {
      if (!this.callConnections.has(connection.callId)) {
        this.callConnections.set(connection.callId, new Set());
      }
      this.callConnections.get(connection.callId)!.add(connection.id);
    }
  }

  private removeConnectionFromMappings(connection: ClientConnection): void {
    // Remove from user mapping
    if (connection.userId) {
      const userConnections = this.userConnections.get(connection.userId);
      if (userConnections) {
        userConnections.delete(connection.id);
        if (userConnections.size === 0) {
          this.userConnections.delete(connection.userId);
        }
      }
    }

    // Remove from call mapping
    if (connection.callId) {
      const callConnections = this.callConnections.get(connection.callId);
      if (callConnections) {
        callConnections.delete(connection.id);
        if (callConnections.size === 0) {
          this.callConnections.delete(connection.callId);
        }
      }
    }
  }

  private updateConnectionActivity(connection: ClientConnection, message: WebSocketMessage): void {
    connection.context.lastActivity = Date.now();
    connection.context.rateLimitInfo.requestCount++;
    connection.context.rateLimitInfo.lastRequest = Date.now();
  }

  private async validateMessage(message: WebSocketMessage, connection: ClientConnection): Promise<void> {
    if (!message.type) {
      throw new ValidationError('Message type is required');
    }

    if (!Object.values(MessageType).includes(message.type)) {
      throw new ValidationError(`Invalid message type: ${message.type}`);
    }

    // Additional validation based on message type
    switch (message.type) {
      case MessageType.AUDIO_CHUNK:
        if (!message.data || (!Buffer.isBuffer(message.data) && typeof message.data !== 'string')) {
          throw new ValidationError('Audio chunk data is required');
        }
        break;
      
      case MessageType.HEARTBEAT:
        // Heartbeat messages don't need additional validation
        break;
      
      default:
        if (!message.callId && connection.callId) {
          message.callId = connection.callId;
        }
        break;
    }
  }

  private async checkRateLimit(remoteAddress: string): Promise<void> {
    // Implementation would check rate limits based on IP address
    // For now, we'll just log the check
    logger.debug(`Rate limit check for ${remoteAddress}`);
  }

  private async checkMessageRateLimit(connection: ClientConnection): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW;
    
    if (connection.context.rateLimitInfo.lastRequest < windowStart) {
      connection.context.rateLimitInfo.requestCount = 1;
    }

    if (connection.context.rateLimitInfo.requestCount > this.MAX_MESSAGES_PER_MINUTE) {
      connection.context.rateLimitInfo.isLimited = true;
      throw new RateLimitError('Message rate limit exceeded');
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeat();
    }, this.HEARTBEAT_INTERVAL);
  }

  private performHeartbeat(): void {
    const now = Date.now();
    const disconnectedConnections: string[] = [];

    for (const [connectionId, connection] of this.connections) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        if (now - connection.lastHeartbeat > this.CONNECTION_TIMEOUT) {
          logger.warn(`Connection ${connectionId} timed out`);
          disconnectedConnections.push(connectionId);
        } else {
          // Send ping
          connection.ws.ping();
        }
      } else {
        disconnectedConnections.push(connectionId);
      }
    }

    // Clean up disconnected connections
    for (const connectionId of disconnectedConnections) {
      this.closeConnection(connectionId, 1001, 'Connection timeout');
    }
  }

  private setupCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 60000); // Every minute
  }

  private performCleanup(): void {
    const now = Date.now();
    let cleanedConnections = 0;

    for (const [connectionId, connection] of this.connections) {
      // Clean up old queue messages
      const oldMessages = connection.messageQueue.filter(
        msg => now - msg.timestamp > 300000 // 5 minutes old
      );
      
      if (oldMessages.length > 0) {
        connection.messageQueue = connection.messageQueue.filter(
          msg => now - msg.timestamp <= 300000
        );
        cleanedConnections++;
      }

      // Reset rate limit counters if window has passed
      if (now - connection.context.rateLimitInfo.lastRequest > this.RATE_LIMIT_WINDOW) {
        connection.context.rateLimitInfo.requestCount = 0;
        connection.context.rateLimitInfo.isLimited = false;
      }
    }

    if (cleanedConnections > 0) {
      logger.debug(`Cleaned up ${cleanedConnections} connections`);
    }
  }

  private handleServerError(error: Error): void {
    logger.error('WebSocket server error:', error);
    this.emit('serverError', error);
  }
}

export default WebSocketManager;