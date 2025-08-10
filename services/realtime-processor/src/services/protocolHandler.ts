import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  WebSocketMessage,
  MessageType,
  AudioChunk,
  ProcessedAudio,
  ConnectionStatus,
  ValidationError,
  ConnectionError,
} from '../types';
import { MetricsService } from './metrics';
import logger from '../utils/logger';

export interface ProtocolConfig {
  version: string;
  supportedMessageTypes: string[];
  maxMessageSize: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  heartbeatInterval: number;
  ackTimeout: number;
  maxRetries: number;
  enableMessageSequencing: boolean;
  enableDuplicateDetection: boolean;
}

export interface ProtocolMessage {
  version: string;
  type: string;
  id: string;
  timestamp: number;
  sequenceNumber?: number;
  ackRequired?: boolean;
  retry?: number;
  compressed?: boolean;
  encrypted?: boolean;
  checksum?: string;
  payload: any;
  metadata?: ProtocolMetadata;
}

export interface ProtocolMetadata {
  source: string;
  target?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  ttl?: number;
  correlation?: string;
  encoding?: string;
}

export interface MessageAcknowledgment {
  messageId: string;
  status: 'received' | 'processed' | 'error';
  timestamp: number;
  error?: string;
}

export interface ProtocolStats {
  messagesSent: number;
  messagesReceived: number;
  messagesAcknowledged: number;
  messagesFailed: number;
  duplicatesDetected: number;
  averageLatency: number;
  retransmissions: number;
}

/**
 * Real-time Communication Protocol Handler
 * Manages message formatting, sequencing, acknowledgments, and reliability
 */
export class ProtocolHandler extends EventEmitter {
  private config: ProtocolConfig;
  private metrics: MetricsService;

  // Message tracking
  private pendingAcks: Map<string, PendingMessage> = new Map();
  private sequenceNumbers: Map<string, number> = new Map(); // connectionId -> sequence
  private messageHistory: Map<string, Set<string>> = new Map(); // connectionId -> messageIds
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

  // Protocol statistics
  private stats: ProtocolStats = {
    messagesSent: 0,
    messagesReceived: 0,
    messagesAcknowledged: 0,
    messagesFailed: 0,
    duplicatesDetected: 0,
    averageLatency: 0,
    retransmissions: 0,
  };

  // Message handlers
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private messageProcessors: Map<string, MessageProcessor> = new Map();

  constructor(config: Partial<ProtocolConfig>, metrics: MetricsService) {
    super();

    this.config = {
      version: '1.0',
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
      ],
      maxMessageSize: 1024 * 1024, // 1MB
      compressionEnabled: true,
      encryptionEnabled: false, // Will be implemented later
      heartbeatInterval: 30000, // 30 seconds
      ackTimeout: 5000, // 5 seconds
      maxRetries: 3,
      enableMessageSequencing: true,
      enableDuplicateDetection: true,
      ...config,
    };

    this.metrics = metrics;
    this.initializeMessageHandlers();
  }

  private initializeMessageHandlers(): void {
    // Register default message handlers
    this.registerMessageHandler('audio_chunk', new AudioChunkHandler());
    this.registerMessageHandler('heartbeat', new HeartbeatHandler());
    this.registerMessageHandler('ack', new AcknowledgmentHandler());
    this.registerMessageHandler('error', new ErrorHandler());

    // Register message processors
    this.registerMessageProcessor('audio_chunk', new AudioChunkProcessor());
    this.registerMessageProcessor('transcript', new TranscriptProcessor());
    this.registerMessageProcessor('ai_response', new AIResponseProcessor());
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing protocol handler');

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();
    
    // Start acknowledgment timeout monitoring
    this.startAckTimeoutMonitoring();

    logger.info({ version: this.config.version }, 'Protocol handler initialized');
  }

  /**
   * Create a standardized protocol message
   */
  public createMessage(
    type: string,
    payload: any,
    options: Partial<ProtocolMessageOptions> = {}
  ): ProtocolMessage {
    this.validateMessageType(type);

    const messageId = uuidv4();
    const timestamp = Date.now();

    const message: ProtocolMessage = {
      version: this.config.version,
      type,
      id: messageId,
      timestamp,
      payload,
      metadata: {
        source: options.source || 'realtime-processor',
        target: options.target,
        priority: options.priority || 'normal',
        ttl: options.ttl,
        correlation: options.correlation,
        encoding: options.encoding || 'json',
      },
    };

    // Add sequence number if enabled
    if (this.config.enableMessageSequencing && options.connectionId) {
      const sequence = this.getNextSequenceNumber(options.connectionId);
      message.sequenceNumber = sequence;
    }

    // Set acknowledgment requirement
    if (options.requireAck || options.priority === 'high' || options.priority === 'urgent') {
      message.ackRequired = true;
    }

    // Apply compression if enabled and payload is large
    if (this.config.compressionEnabled && this.shouldCompressMessage(message)) {
      message.compressed = true;
      message.payload = this.compressPayload(message.payload);
    }

    // Calculate checksum for integrity
    message.checksum = this.calculateChecksum(message);

    return message;
  }

  /**
   * Send a message through the protocol
   */
  public async sendMessage(
    message: ProtocolMessage,
    connectionId: string,
    sendFunction: (data: string) => Promise<void>
  ): Promise<void> {
    try {
      this.validateMessage(message);

      // Track message for acknowledgment if required
      if (message.ackRequired) {
        this.trackPendingMessage(message, connectionId, sendFunction);
      }

      // Serialize and send
      const serialized = JSON.stringify(message);
      
      if (serialized.length > this.config.maxMessageSize) {
        throw new ValidationError(`Message size ${serialized.length} exceeds limit ${this.config.maxMessageSize}`);
      }

      await sendFunction(serialized);

      // Update statistics
      this.stats.messagesSent++;
      this.metrics.incrementCounter('protocol_messages_sent_total', { type: message.type });

      // Emit send event
      this.emit('messageSent', {
        messageId: message.id,
        type: message.type,
        connectionId,
        size: serialized.length,
        timestamp: Date.now(),
      });

      logger.debug({
        messageId: message.id,
        type: message.type,
        connectionId,
        size: serialized.length,
      }, 'Protocol message sent');

    } catch (error) {
      this.stats.messagesFailed++;
      this.metrics.incrementCounter('protocol_messages_failed_total', { type: message.type });
      
      logger.error({
        error,
        messageId: message.id,
        type: message.type,
        connectionId,
      }, 'Failed to send protocol message');
      
      throw error;
    }
  }

  /**
   * Process an incoming message
   */
  public async processMessage(
    data: string,
    connectionId: string
  ): Promise<ProcessedMessageResult> {
    const startTime = Date.now();

    try {
      // Parse message
      const message = this.parseMessage(data);
      
      // Validate message
      this.validateMessage(message);
      
      // Check for duplicates
      if (this.config.enableDuplicateDetection && this.isDuplicateMessage(message, connectionId)) {
        this.stats.duplicatesDetected++;
        this.metrics.incrementCounter('protocol_duplicates_detected_total');
        
        logger.debug({
          messageId: message.id,
          connectionId,
        }, 'Duplicate message detected and ignored');
        
        return {
          messageId: message.id,
          type: message.type,
          handled: false,
          reason: 'duplicate',
          processingTime: Date.now() - startTime,
        };
      }

      // Track message for duplicate detection
      this.trackMessageForDuplicateDetection(message, connectionId);

      // Handle acknowledgment messages
      if (message.type === 'ack') {
        return await this.handleAcknowledgment(message, connectionId);
      }

      // Send acknowledgment if required
      if (message.ackRequired) {
        await this.sendAcknowledgment(message, connectionId);
      }

      // Process message with appropriate handler
      const result = await this.handleMessage(message, connectionId);

      // Update statistics
      this.stats.messagesReceived++;
      const processingTime = Date.now() - startTime;
      this.updateAverageLatency(processingTime);
      
      this.metrics.incrementCounter('protocol_messages_received_total', { type: message.type });
      this.metrics.recordHistogram('protocol_message_processing_duration_ms', processingTime);

      // Emit processing event
      this.emit('messageProcessed', {
        messageId: message.id,
        type: message.type,
        connectionId,
        processingTime,
        result: result.handled,
      });

      return {
        messageId: message.id,
        type: message.type,
        handled: result.handled,
        data: result.data,
        processingTime,
      };

    } catch (error) {
      this.stats.messagesFailed++;
      this.metrics.incrementCounter('protocol_messages_processing_failed_total');
      
      logger.error({
        error,
        connectionId,
        dataLength: data.length,
      }, 'Failed to process protocol message');

      return {
        messageId: 'unknown',
        type: 'unknown',
        handled: false,
        error: error.message,
        processingTime: Date.now() - startTime,
      };
    }
  }

  private parseMessage(data: string): ProtocolMessage {
    try {
      const message = JSON.parse(data) as ProtocolMessage;
      
      // Decompress payload if needed
      if (message.compressed && this.config.compressionEnabled) {
        message.payload = this.decompressPayload(message.payload);
      }
      
      return message;
    } catch (error) {
      throw new ValidationError(`Invalid message format: ${error.message}`);
    }
  }

  private validateMessage(message: ProtocolMessage): void {
    if (!message.version || message.version !== this.config.version) {
      throw new ValidationError(`Unsupported protocol version: ${message.version}`);
    }

    if (!message.type || !this.config.supportedMessageTypes.includes(message.type)) {
      throw new ValidationError(`Unsupported message type: ${message.type}`);
    }

    if (!message.id || !message.timestamp) {
      throw new ValidationError('Missing required message fields');
    }

    // Verify checksum if present
    if (message.checksum) {
      const expectedChecksum = this.calculateChecksum({...message, checksum: undefined});
      if (message.checksum !== expectedChecksum) {
        throw new ValidationError('Message integrity check failed');
      }
    }

    // Check TTL
    if (message.metadata?.ttl) {
      const age = Date.now() - message.timestamp;
      if (age > message.metadata.ttl) {
        throw new ValidationError('Message expired');
      }
    }
  }

  private validateMessageType(type: string): void {
    if (!this.config.supportedMessageTypes.includes(type)) {
      throw new ValidationError(`Unsupported message type: ${type}`);
    }
  }

  private getNextSequenceNumber(connectionId: string): number {
    const current = this.sequenceNumbers.get(connectionId) || 0;
    const next = current + 1;
    this.sequenceNumbers.set(connectionId, next);
    return next;
  }

  private shouldCompressMessage(message: ProtocolMessage): boolean {
    const serialized = JSON.stringify(message.payload);
    return serialized.length > 1024; // Compress if payload > 1KB
  }

  private compressPayload(payload: any): string {
    // Simple compression (in production, use proper compression library)
    const jsonString = JSON.stringify(payload);
    return Buffer.from(jsonString).toString('base64');
  }

  private decompressPayload(compressedPayload: string): any {
    // Simple decompression
    const jsonString = Buffer.from(compressedPayload, 'base64').toString();
    return JSON.parse(jsonString);
  }

  private calculateChecksum(message: ProtocolMessage): string {
    // Simple checksum (in production, use proper cryptographic hash)
    const data = JSON.stringify({
      type: message.type,
      id: message.id,
      timestamp: message.timestamp,
      payload: message.payload,
    });
    
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString(16);
  }

  private trackPendingMessage(
    message: ProtocolMessage,
    connectionId: string,
    sendFunction: (data: string) => Promise<void>
  ): void {
    const pendingMessage: PendingMessage = {
      message,
      connectionId,
      sendFunction,
      sentAt: Date.now(),
      retries: 0,
    };

    this.pendingAcks.set(message.id, pendingMessage);

    // Set timeout for acknowledgment
    const timer = setTimeout(() => {
      this.handleAckTimeout(message.id);
    }, this.config.ackTimeout);

    this.retryTimers.set(message.id, timer);
  }

  private isDuplicateMessage(message: ProtocolMessage, connectionId: string): boolean {
    const messageHistory = this.messageHistory.get(connectionId);
    return messageHistory?.has(message.id) || false;
  }

  private trackMessageForDuplicateDetection(message: ProtocolMessage, connectionId: string): void {
    let messageHistory = this.messageHistory.get(connectionId);
    if (!messageHistory) {
      messageHistory = new Set();
      this.messageHistory.set(connectionId, messageHistory);
    }

    messageHistory.add(message.id);

    // Limit history size to prevent memory leaks
    if (messageHistory.size > 1000) {
      const firstId = messageHistory.values().next().value;
      messageHistory.delete(firstId);
    }
  }

  private async handleAcknowledgment(
    ackMessage: ProtocolMessage,
    connectionId: string
  ): Promise<ProcessedMessageResult> {
    const ack = ackMessage.payload as MessageAcknowledgment;
    const pendingMessage = this.pendingAcks.get(ack.messageId);

    if (pendingMessage) {
      // Clear timeout
      const timer = this.retryTimers.get(ack.messageId);
      if (timer) {
        clearTimeout(timer);
        this.retryTimers.delete(ack.messageId);
      }

      // Remove from pending
      this.pendingAcks.delete(ack.messageId);

      // Update statistics
      this.stats.messagesAcknowledged++;
      const latency = Date.now() - pendingMessage.sentAt;
      this.metrics.recordHistogram('protocol_message_acknowledgment_latency_ms', latency);

      // Emit acknowledgment event
      this.emit('messageAcknowledged', {
        messageId: ack.messageId,
        status: ack.status,
        latency,
        connectionId,
      });

      logger.debug({
        messageId: ack.messageId,
        status: ack.status,
        latency,
        connectionId,
      }, 'Message acknowledgment received');
    }

    return {
      messageId: ackMessage.id,
      type: ackMessage.type,
      handled: true,
      processingTime: 0,
    };
  }

  private async sendAcknowledgment(
    originalMessage: ProtocolMessage,
    connectionId: string
  ): Promise<void> {
    const ack: MessageAcknowledgment = {
      messageId: originalMessage.id,
      status: 'received',
      timestamp: Date.now(),
    };

    const ackMessage = this.createMessage('ack', ack, {
      source: 'protocol-handler',
      priority: 'high',
      connectionId,
    });

    // Find the send function (this is a simplified approach)
    // In a real implementation, you'd need to store the send function reference
    this.emit('sendAcknowledgment', {
      message: ackMessage,
      connectionId,
    });
  }

  private async handleAckTimeout(messageId: string): Promise<void> {
    const pendingMessage = this.pendingAcks.get(messageId);
    if (!pendingMessage) return;

    logger.warn({
      messageId,
      connectionId: pendingMessage.connectionId,
      retries: pendingMessage.retries,
    }, 'Message acknowledgment timeout');

    if (pendingMessage.retries < this.config.maxRetries) {
      // Retry sending the message
      pendingMessage.retries++;
      pendingMessage.message.retry = pendingMessage.retries;
      
      try {
        const serialized = JSON.stringify(pendingMessage.message);
        await pendingMessage.sendFunction(serialized);
        
        this.stats.retransmissions++;
        this.metrics.incrementCounter('protocol_message_retransmissions_total');

        // Reset timeout
        const timer = setTimeout(() => {
          this.handleAckTimeout(messageId);
        }, this.config.ackTimeout);

        this.retryTimers.set(messageId, timer);

        logger.debug({
          messageId,
          retries: pendingMessage.retries,
        }, 'Message retransmitted');

      } catch (error) {
        logger.error({
          error,
          messageId,
          retries: pendingMessage.retries,
        }, 'Failed to retransmit message');
        
        this.handleMessageFailure(messageId, pendingMessage);
      }
    } else {
      // Max retries exceeded
      this.handleMessageFailure(messageId, pendingMessage);
    }
  }

  private handleMessageFailure(messageId: string, pendingMessage: PendingMessage): void {
    // Clean up
    this.pendingAcks.delete(messageId);
    const timer = this.retryTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(messageId);
    }

    // Update statistics
    this.stats.messagesFailed++;
    this.metrics.incrementCounter('protocol_message_failures_total');

    // Emit failure event
    this.emit('messageFailed', {
      messageId,
      connectionId: pendingMessage.connectionId,
      retries: pendingMessage.retries,
      originalMessage: pendingMessage.message,
    });

    logger.error({
      messageId,
      connectionId: pendingMessage.connectionId,
      retries: pendingMessage.retries,
    }, 'Message delivery failed after max retries');
  }

  private async handleMessage(
    message: ProtocolMessage,
    connectionId: string
  ): Promise<MessageHandlingResult> {
    // Try message-specific handler first
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      return await handler.handle(message, connectionId);
    }

    // Try message processor
    const processor = this.messageProcessors.get(message.type);
    if (processor) {
      const data = await processor.process(message.payload, connectionId);
      return { handled: true, data };
    }

    // Default handling - just emit the message
    this.emit('messageReceived', {
      message,
      connectionId,
    });

    return { handled: true };
  }

  private updateAverageLatency(latency: number): void {
    // Simple moving average
    const alpha = 0.1;
    this.stats.averageLatency = (1 - alpha) * this.stats.averageLatency + alpha * latency;
  }

  private startHeartbeatMonitoring(): void {
    setInterval(() => {
      this.emit('heartbeatRequired');
    }, this.config.heartbeatInterval);
  }

  private startAckTimeoutMonitoring(): void {
    // Periodic cleanup of orphaned timers
    setInterval(() => {
      const now = Date.now();
      for (const [messageId, pendingMessage] of this.pendingAcks) {
        const age = now - pendingMessage.sentAt;
        if (age > this.config.ackTimeout * (this.config.maxRetries + 1)) {
          logger.warn({
            messageId,
            age,
          }, 'Cleaning up orphaned pending message');
          
          this.handleMessageFailure(messageId, pendingMessage);
        }
      }
    }, this.config.ackTimeout);
  }

  // Public API methods

  public registerMessageHandler(type: string, handler: MessageHandler): void {
    this.messageHandlers.set(type, handler);
    logger.debug({ type }, 'Message handler registered');
  }

  public registerMessageProcessor(type: string, processor: MessageProcessor): void {
    this.messageProcessors.set(type, processor);
    logger.debug({ type }, 'Message processor registered');
  }

  public getProtocolStats(): ProtocolStats {
    return { ...this.stats };
  }

  public getPendingMessages(): PendingMessageInfo[] {
    return Array.from(this.pendingAcks.entries()).map(([messageId, pending]) => ({
      messageId,
      type: pending.message.type,
      connectionId: pending.connectionId,
      sentAt: pending.sentAt,
      retries: pending.retries,
      age: Date.now() - pending.sentAt,
    }));
  }

  public clearPendingMessages(connectionId?: string): number {
    let cleared = 0;
    
    for (const [messageId, pending] of this.pendingAcks) {
      if (!connectionId || pending.connectionId === connectionId) {
        const timer = this.retryTimers.get(messageId);
        if (timer) {
          clearTimeout(timer);
          this.retryTimers.delete(messageId);
        }
        
        this.pendingAcks.delete(messageId);
        cleared++;
      }
    }

    if (connectionId) {
      this.messageHistory.delete(connectionId);
      this.sequenceNumbers.delete(connectionId);
    }

    logger.info({ connectionId, cleared }, 'Cleared pending messages');
    return cleared;
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down protocol handler');

    // Clear all timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }

    // Clear all data structures
    this.pendingAcks.clear();
    this.retryTimers.clear();
    this.messageHistory.clear();
    this.sequenceNumbers.clear();
    this.messageHandlers.clear();
    this.messageProcessors.clear();

    this.removeAllListeners();

    logger.info('Protocol handler shutdown complete');
  }
}

// Supporting interfaces and types

interface ProtocolMessageOptions {
  source?: string;
  target?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  ttl?: number;
  correlation?: string;
  encoding?: string;
  connectionId?: string;
  requireAck?: boolean;
}

interface PendingMessage {
  message: ProtocolMessage;
  connectionId: string;
  sendFunction: (data: string) => Promise<void>;
  sentAt: number;
  retries: number;
}

interface ProcessedMessageResult {
  messageId: string;
  type: string;
  handled: boolean;
  data?: any;
  error?: string;
  reason?: string;
  processingTime: number;
}

interface MessageHandlingResult {
  handled: boolean;
  data?: any;
}

interface PendingMessageInfo {
  messageId: string;
  type: string;
  connectionId: string;
  sentAt: number;
  retries: number;
  age: number;
}

// Message handlers and processors

abstract class MessageHandler {
  abstract handle(message: ProtocolMessage, connectionId: string): Promise<MessageHandlingResult>;
}

abstract class MessageProcessor {
  abstract process(payload: any, connectionId: string): Promise<any>;
}

class AudioChunkHandler extends MessageHandler {
  async handle(message: ProtocolMessage, connectionId: string): Promise<MessageHandlingResult> {
    const audioChunk = message.payload as AudioChunk;
    
    // Validate audio chunk
    if (!audioChunk.audioData || !audioChunk.callId) {
      return { handled: false };
    }

    // Emit for further processing
    // The actual processing will be handled by the audio processor
    return { handled: true, data: audioChunk };
  }
}

class HeartbeatHandler extends MessageHandler {
  async handle(message: ProtocolMessage, connectionId: string): Promise<MessageHandlingResult> {
    // Handle heartbeat - just acknowledge receipt
    logger.debug({ connectionId }, 'Heartbeat received');
    return { handled: true };
  }
}

class AcknowledgmentHandler extends MessageHandler {
  async handle(message: ProtocolMessage, connectionId: string): Promise<MessageHandlingResult> {
    // This is handled by the main protocol handler
    return { handled: true };
  }
}

class ErrorHandler extends MessageHandler {
  async handle(message: ProtocolMessage, connectionId: string): Promise<MessageHandlingResult> {
    const error = message.payload;
    logger.error({ error, connectionId }, 'Error message received from client');
    return { handled: true };
  }
}

class AudioChunkProcessor extends MessageProcessor {
  async process(payload: AudioChunk, connectionId: string): Promise<AudioChunk> {
    // Pre-process audio chunk if needed
    return payload;
  }
}

class TranscriptProcessor extends MessageProcessor {
  async process(payload: any, connectionId: string): Promise<any> {
    // Process transcript data
    return payload;
  }
}

class AIResponseProcessor extends MessageProcessor {
  async process(payload: any, connectionId: string): Promise<any> {
    // Process AI response data
    return payload;
  }
}

export default ProtocolHandler;