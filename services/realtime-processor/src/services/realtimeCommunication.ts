import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

import { WebSocketManager } from './websocket';
import { WebRTCManager } from './webrtc';
import { RedisService } from './redis';
import { MetricsService } from './metrics';
import { 
  AudioChunk, 
  ProcessedAudio, 
  ConnectionContext,
  WebSocketMessage,
  MessageType,
  ConnectionStatus,
  RealtimeProcessorError 
} from '../types';
import logger from '../utils/logger';

export interface RealtimeCommunicationConfig {
  websocket: {
    server: any;
    maxConnections: number;
    heartbeatInterval: number;
  };
  webrtc: {
    iceServers: RTCIceServer[];
    enableAudioProcessing: boolean;
    bitrateLimit: number;
  };
  redis: {
    url: string;
    password?: string;
    database: number;
  };
  processing: {
    enableWebRTC: boolean;
    fallbackToWebSocket: boolean;
    preferredTransport: 'websocket' | 'webrtc' | 'auto';
  };
}

export interface CommunicationSession {
  id: string;
  userId: string;
  callId: string;
  transportType: 'websocket' | 'webrtc' | 'hybrid';
  websocketConnectionId?: string;
  webrtcConnectionId?: string;
  startTime: number;
  lastActivity: number;
  status: ConnectionStatus;
  audioQuality: AudioQualityMetrics;
  processingStats: ProcessingStats;
}

export interface AudioQualityMetrics {
  latency: number;
  jitter: number;
  packetsLost: number;
  audioClarity: number;
  bitrate: number;
  signalToNoise: number;
}

export interface ProcessingStats {
  messagesProcessed: number;
  audioChunksProcessed: number;
  averageProcessingTime: number;
  errorRate: number;
  successRate: number;
}

export class RealtimeCommunicationManager extends EventEmitter {
  private websocketManager: WebSocketManager;
  private webrtcManager: WebRTCManager;
  private redisService: RedisService;
  private metricsService: MetricsService;
  
  private sessions: Map<string, CommunicationSession> = new Map();
  private config: RealtimeCommunicationConfig;
  
  private qualityMonitorInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    config: RealtimeCommunicationConfig,
    dependencies: {
      redis: RedisService;
      metrics: MetricsService;
    }
  ) {
    super();
    
    this.config = config;
    this.redisService = dependencies.redis;
    this.metricsService = dependencies.metrics;
    
    // Initialize managers
    this.websocketManager = new WebSocketManager({
      server: config.websocket.server,
      redis: this.redisService,
      rateLimiter: null as any, // Will be injected
      metrics: this.metricsService,
      config: {
        performance: { processingTimeout: 30000, maxAudioDuration: 300000 },
        security: { rateLimiting: { maxRequests: 100 } },
        webrtc: config.webrtc,
        azure: {} // Will be configured from environment
      }
    });
    
    this.webrtcManager = new WebRTCManager(config.webrtc);
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // WebSocket events
    this.websocketManager.on('connectionEstablished', (data: any) => {
      this.handleWebSocketConnection(data);
    });
    
    this.websocketManager.on('audioChunkReceived', (data: any) => {
      this.handleAudioChunk(data, 'websocket');
    });
    
    this.websocketManager.on('connectionClosed', (data: any) => {
      this.handleConnectionClosed(data.connectionId, 'websocket');
    });

    // WebRTC events
    this.webrtcManager.on('connectionEstablished', (data: any) => {
      this.handleWebRTCConnection(data);
    });
    
    this.webrtcManager.on('audioChunk', (data: any) => {
      this.handleAudioChunk(data, 'webrtc');
    });
    
    this.webrtcManager.on('connectionFailed', (data: any) => {
      this.handleConnectionFailed(data.connectionId, 'webrtc');
    });
    
    this.webrtcManager.on('statsUpdate', (data: any) => {
      this.handleStatsUpdate(data, 'webrtc');
    });
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing Realtime Communication Manager');
    
    try {
      // Initialize all managers
      await this.websocketManager.initialize();
      await this.webrtcManager.initialize();
      
      // Start monitoring services
      this.startQualityMonitoring();
      this.startSessionCleanup();
      
      logger.info('Realtime Communication Manager initialized successfully');
      
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Realtime Communication Manager');
      throw new RealtimeProcessorError(
        `Initialization failed: ${error.message}`,
        'INITIALIZATION_ERROR'
      );
    }
  }

  private handleWebSocketConnection(data: any): void {
    const { connectionId, userId, callId } = data;
    
    logger.info({ connectionId, userId, callId }, 'WebSocket connection established');
    
    // Check if we should upgrade to WebRTC
    if (this.config.processing.enableWebRTC && this.shouldUseWebRTC(data)) {
      this.initiateWebRTCUpgrade(connectionId, userId, callId);
    } else {
      this.createSession(userId, callId, 'websocket', { websocketConnectionId: connectionId });
    }
  }

  private handleWebRTCConnection(data: any): void {
    const { connectionId, userId, callId } = data;
    
    logger.info({ connectionId, userId, callId }, 'WebRTC connection established');
    
    // Update existing session or create new one
    const existingSession = this.findSessionByCallId(callId);
    if (existingSession) {
      existingSession.webrtcConnectionId = connectionId;
      existingSession.transportType = 'hybrid';
      existingSession.status = ConnectionStatus.CONNECTED;
      
      logger.info({ 
        sessionId: existingSession.id, 
        callId 
      }, 'Session upgraded to hybrid WebSocket+WebRTC');
    } else {
      this.createSession(userId, callId, 'webrtc', { webrtcConnectionId: connectionId });
    }
  }

  private shouldUseWebRTC(connectionData: any): boolean {
    // Decision logic for WebRTC usage
    const { preferredTransport } = this.config.processing;
    
    if (preferredTransport === 'webrtc') return true;
    if (preferredTransport === 'websocket') return false;
    
    // Auto-detection based on client capabilities and network conditions
    // This would typically check user agent, network quality, etc.
    return true; // Default to WebRTC for better audio quality
  }

  private async initiateWebRTCUpgrade(
    websocketConnectionId: string, 
    userId: string, 
    callId: string
  ): Promise<void> {
    try {
      // Create WebRTC connection
      const webrtcConnectionId = await this.webrtcManager.createPeerConnection(
        userId, 
        callId, 
        true // Is initiator
      );
      
      // Initiate WebRTC handshake through WebSocket
      await this.websocketManager.initiateWebRTCConnection(websocketConnectionId);
      
      logger.info({ 
        websocketConnectionId, 
        webrtcConnectionId, 
        callId 
      }, 'WebRTC upgrade initiated');
      
    } catch (error) {
      logger.error({ 
        error, 
        websocketConnectionId, 
        callId 
      }, 'Failed to initiate WebRTC upgrade');
      
      // Fall back to WebSocket-only
      this.createSession(userId, callId, 'websocket', { websocketConnectionId });
    }
  }

  private createSession(
    userId: string, 
    callId: string, 
    transportType: 'websocket' | 'webrtc' | 'hybrid',
    connectionIds: { websocketConnectionId?: string; webrtcConnectionId?: string }
  ): string {
    const sessionId = uuidv4();
    const session: CommunicationSession = {
      id: sessionId,
      userId,
      callId,
      transportType,
      websocketConnectionId: connectionIds.websocketConnectionId,
      webrtcConnectionId: connectionIds.webrtcConnectionId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      status: ConnectionStatus.CONNECTED,
      audioQuality: {
        latency: 0,
        jitter: 0,
        packetsLost: 0,
        audioClarity: 0,
        bitrate: 0,
        signalToNoise: 0,
      },
      processingStats: {
        messagesProcessed: 0,
        audioChunksProcessed: 0,
        averageProcessingTime: 0,
        errorRate: 0,
        successRate: 1,
      },
    };
    
    this.sessions.set(sessionId, session);
    
    logger.info({ 
      sessionId, 
      userId, 
      callId, 
      transportType 
    }, 'Communication session created');
    
    this.emit('sessionCreated', { session });
    
    return sessionId;
  }

  private findSessionByCallId(callId: string): CommunicationSession | undefined {
    return Array.from(this.sessions.values()).find(session => session.callId === callId);
  }

  private findSessionByConnectionId(
    connectionId: string, 
    connectionType: 'websocket' | 'webrtc'
  ): CommunicationSession | undefined {
    return Array.from(this.sessions.values()).find(session => {
      if (connectionType === 'websocket') {
        return session.websocketConnectionId === connectionId;
      } else {
        return session.webrtcConnectionId === connectionId;
      }
    });
  }

  private async handleAudioChunk(data: any, source: 'websocket' | 'webrtc'): Promise<void> {
    const { connectionId, audioChunk } = data;
    const session = this.findSessionByConnectionId(connectionId, source);
    
    if (!session) {
      logger.warn({ connectionId, source }, 'Audio chunk received for unknown session');
      return;
    }
    
    try {
      // Update session activity
      session.lastActivity = Date.now();
      session.processingStats.audioChunksProcessed++;
      
      // Route audio chunk through appropriate processing pipeline
      const processingStartTime = Date.now();
      let result: ProcessedAudio;
      
      if (source === 'webrtc' && session.webrtcConnectionId) {
        // Process through WebRTC optimized pipeline
        result = await this.processWebRTCAudioChunk(session, audioChunk);
      } else if (source === 'websocket' && session.websocketConnectionId) {
        // Process through WebSocket pipeline
        result = await this.processWebSocketAudioChunk(session, audioChunk);
      } else {
        throw new Error(`Invalid audio processing configuration for session ${session.id}`);
      }
      
      // Update processing stats
      const processingTime = Date.now() - processingStartTime;
      this.updateProcessingStats(session, processingTime, true);
      
      // Send response back through appropriate channel
      await this.sendAudioResponse(session, result, source);
      
      // Update audio quality metrics
      this.updateAudioQualityMetrics(session, result, processingTime);
      
    } catch (error) {
      logger.error({ 
        error, 
        sessionId: session.id, 
        source 
      }, 'Failed to process audio chunk');
      
      this.updateProcessingStats(session, 0, false);
    }
  }

  private async processWebRTCAudioChunk(
    session: CommunicationSession, 
    audioChunk: AudioChunk
  ): Promise<ProcessedAudio> {
    // Use WebRTC-optimized processing pipeline
    // This could include additional optimizations for real-time processing
    return await this.websocketManager.processAudioData(audioChunk, session.userId);
  }

  private async processWebSocketAudioChunk(
    session: CommunicationSession, 
    audioChunk: AudioChunk
  ): Promise<ProcessedAudio> {
    // Standard WebSocket processing pipeline
    return await this.websocketManager.processAudioData(audioChunk, session.userId);
  }

  private async sendAudioResponse(
    session: CommunicationSession, 
    result: ProcessedAudio, 
    originalSource: 'websocket' | 'webrtc'
  ): Promise<void> {
    if (!result.response || !result.audioResponse) {
      return;
    }
    
    try {
      // Send through WebRTC if available and original source was WebRTC
      if (originalSource === 'webrtc' && session.webrtcConnectionId) {
        await this.webrtcManager.sendAudioData(
          session.webrtcConnectionId, 
          Buffer.from(result.audioResponse as string, 'base64'),
          {
            processingLatency: result.processingLatency,
            confidence: result.confidence,
            timestamp: Date.now(),
          }
        );
      }
      
      // Always send through WebSocket as fallback/confirmation
      if (session.websocketConnectionId) {
        // WebSocket manager will handle sending the message
        // This is already handled by the existing websocket processing
      }
      
      session.processingStats.messagesProcessed++;
      
    } catch (error) {
      logger.error({ 
        error, 
        sessionId: session.id 
      }, 'Failed to send audio response');
      throw error;
    }
  }

  private updateProcessingStats(
    session: CommunicationSession, 
    processingTime: number, 
    success: boolean
  ): void {
    const stats = session.processingStats;
    const totalProcessed = stats.audioChunksProcessed;
    
    if (success) {
      // Update average processing time
      stats.averageProcessingTime = (
        (stats.averageProcessingTime * (totalProcessed - 1)) + processingTime
      ) / totalProcessed;
      
      // Update success rate
      const successCount = Math.floor(stats.successRate * (totalProcessed - 1)) + 1;
      stats.successRate = successCount / totalProcessed;
    } else {
      // Update error rate
      const errorCount = Math.floor(stats.errorRate * (totalProcessed - 1)) + 1;
      stats.errorRate = errorCount / totalProcessed;
      stats.successRate = 1 - stats.errorRate;
    }
  }

  private updateAudioQualityMetrics(
    session: CommunicationSession, 
    result: ProcessedAudio, 
    processingTime: number
  ): void {
    const quality = session.audioQuality;
    
    // Update latency (use processing time as proxy)
    quality.latency = processingTime;
    
    // Update audio clarity (use confidence as proxy)
    if (result.confidence !== undefined) {
      quality.audioClarity = result.confidence;
    }
    
    // Get WebRTC stats if available
    if (session.webrtcConnectionId) {
      this.webrtcManager.getConnectionStats(session.webrtcConnectionId).then(stats => {
        if (stats) {
          quality.jitter = stats.jitter;
          quality.packetsLost = stats.packetsLost;
          quality.bitrate = stats.bitrate;
        }
      }).catch(error => {
        logger.warn({ error, sessionId: session.id }, 'Failed to get WebRTC stats');
      });
    }
  }

  private handleStatsUpdate(data: any, source: 'webrtc'): void {
    const session = this.findSessionByConnectionId(data.connectionId, source);
    if (!session) return;
    
    // Update audio quality metrics from WebRTC stats
    if (source === 'webrtc') {
      const stats = data.stats;
      Object.assign(session.audioQuality, {
        jitter: stats.jitter,
        packetsLost: stats.packetsLost,
        bitrate: stats.bitrate,
        // Add more metrics as needed
      });
    }
  }

  private handleConnectionClosed(connectionId: string, source: 'websocket' | 'webrtc'): void {
    const session = this.findSessionByConnectionId(connectionId, source);
    if (!session) return;
    
    logger.info({ 
      sessionId: session.id, 
      connectionId, 
      source 
    }, 'Connection closed');
    
    if (source === 'websocket') {
      session.websocketConnectionId = undefined;
    } else if (source === 'webrtc') {
      session.webrtcConnectionId = undefined;
    }
    
    // Check if session should be terminated
    if (!session.websocketConnectionId && !session.webrtcConnectionId) {
      this.terminateSession(session.id, 'all_connections_closed');
    } else if (source === 'webrtc' && this.config.processing.fallbackToWebSocket) {
      // Fallback to WebSocket-only
      session.transportType = 'websocket';
      logger.info({ sessionId: session.id }, 'Session fell back to WebSocket-only');
    }
  }

  private handleConnectionFailed(connectionId: string, source: 'websocket' | 'webrtc'): void {
    const session = this.findSessionByConnectionId(connectionId, source);
    if (!session) return;
    
    logger.error({ 
      sessionId: session.id, 
      connectionId, 
      source 
    }, 'Connection failed');
    
    if (source === 'webrtc' && this.config.processing.fallbackToWebSocket) {
      // Try to maintain session with WebSocket only
      session.webrtcConnectionId = undefined;
      session.transportType = 'websocket';
      session.status = ConnectionStatus.CONNECTED; // Keep alive if WebSocket still works
      
      logger.info({ sessionId: session.id }, 'Session maintained on WebSocket after WebRTC failure');
    } else {
      session.status = ConnectionStatus.ERROR;
    }
  }

  private terminateSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    logger.info({ 
      sessionId, 
      callId: session.callId, 
      reason,
      duration: Date.now() - session.startTime
    }, 'Session terminated');
    
    // Cleanup connections
    if (session.websocketConnectionId) {
      // WebSocket manager will handle cleanup
    }
    
    if (session.webrtcConnectionId) {
      this.webrtcManager.closePeerConnection(session.webrtcConnectionId);
    }
    
    // Record session metrics
    this.recordSessionMetrics(session);
    
    this.sessions.delete(sessionId);
    this.emit('sessionTerminated', { session, reason });
  }

  private recordSessionMetrics(session: CommunicationSession): void {
    const duration = Date.now() - session.startTime;
    
    this.metricsService.recordHistogram('session_duration_ms', duration);
    this.metricsService.recordHistogram('session_audio_chunks', session.processingStats.audioChunksProcessed);
    this.metricsService.recordHistogram('session_avg_processing_time', session.processingStats.averageProcessingTime);
    this.metricsService.recordHistogram('session_success_rate', session.processingStats.successRate);
    
    // Record quality metrics
    this.metricsService.recordHistogram('audio_quality_latency', session.audioQuality.latency);
    this.metricsService.recordHistogram('audio_quality_clarity', session.audioQuality.audioClarity);
    
    logger.info({
      sessionId: session.id,
      duration,
      transportType: session.transportType,
      audioChunksProcessed: session.processingStats.audioChunksProcessed,
      successRate: session.processingStats.successRate,
    }, 'Session metrics recorded');
  }

  private startQualityMonitoring(): void {
    this.qualityMonitorInterval = setInterval(() => {
      for (const session of this.sessions.values()) {
        this.monitorSessionQuality(session);
      }
    }, 10000); // Monitor every 10 seconds
  }

  private monitorSessionQuality(session: CommunicationSession): void {
    const now = Date.now();
    const timeSinceLastActivity = now - session.lastActivity;
    
    // Check for inactive sessions
    if (timeSinceLastActivity > 60000) { // 1 minute timeout
      logger.warn({ 
        sessionId: session.id, 
        timeSinceLastActivity 
      }, 'Session appears inactive');
      
      session.status = ConnectionStatus.IDLE;
    }
    
    // Check audio quality metrics
    if (session.audioQuality.packetsLost > 5) {
      logger.warn({ 
        sessionId: session.id, 
        packetsLost: session.audioQuality.packetsLost 
      }, 'High packet loss detected');
      
      // Could trigger quality adaptation here
    }
    
    if (session.audioQuality.latency > 1000) { // > 1 second latency
      logger.warn({ 
        sessionId: session.id, 
        latency: session.audioQuality.latency 
      }, 'High latency detected');
    }
  }

  private startSessionCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, 300000); // Clean up every 5 minutes
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const inactiveThreshold = 300000; // 5 minutes
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const timeSinceLastActivity = now - session.lastActivity;
      
      if (timeSinceLastActivity > inactiveThreshold) {
        logger.info({ 
          sessionId, 
          timeSinceLastActivity 
        }, 'Cleaning up inactive session');
        
        this.terminateSession(sessionId, 'inactive_cleanup');
      }
    }
  }

  // Public API Methods

  public async getSessionStats(): Promise<any> {
    const stats = {
      totalSessions: this.sessions.size,
      transportTypes: {
        websocket: 0,
        webrtc: 0,
        hybrid: 0,
      },
      averageQuality: {
        latency: 0,
        clarity: 0,
        jitter: 0,
      },
      sessionsDetail: [] as any[],
    };
    
    let totalLatency = 0;
    let totalClarity = 0;
    let totalJitter = 0;
    
    for (const session of this.sessions.values()) {
      stats.transportTypes[session.transportType]++;
      
      totalLatency += session.audioQuality.latency;
      totalClarity += session.audioQuality.audioClarity;
      totalJitter += session.audioQuality.jitter;
      
      stats.sessionsDetail.push({
        id: session.id,
        userId: session.userId,
        callId: session.callId,
        transportType: session.transportType,
        duration: Date.now() - session.startTime,
        status: session.status,
        audioQuality: session.audioQuality,
        processingStats: session.processingStats,
      });
    }
    
    if (this.sessions.size > 0) {
      stats.averageQuality.latency = totalLatency / this.sessions.size;
      stats.averageQuality.clarity = totalClarity / this.sessions.size;
      stats.averageQuality.jitter = totalJitter / this.sessions.size;
    }
    
    return stats;
  }

  public async getSession(sessionId: string): Promise<CommunicationSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  public async terminateSessionByCallId(callId: string, reason: string = 'external_termination'): Promise<boolean> {
    const session = this.findSessionByCallId(callId);
    if (!session) {
      return false;
    }
    
    this.terminateSession(session.id, reason);
    return true;
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down Realtime Communication Manager');
    
    // Stop monitoring intervals
    if (this.qualityMonitorInterval) {
      clearInterval(this.qualityMonitorInterval);
      this.qualityMonitorInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Terminate all sessions
    for (const sessionId of this.sessions.keys()) {
      this.terminateSession(sessionId, 'system_shutdown');
    }
    
    // Shutdown managers
    await this.websocketManager.shutdown();
    await this.webrtcManager.shutdown();
    
    this.sessions.clear();
    this.removeAllListeners();
    
    logger.info('Realtime Communication Manager shutdown complete');
  }
}

export default RealtimeCommunicationManager;