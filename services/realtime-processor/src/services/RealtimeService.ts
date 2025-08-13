/**
 * Realtime Service
 * Core service that coordinates real-time audio processing, AI conversation, and response generation
 */

import { EventEmitter } from 'events';
import { 
  AudioChunk, 
  ProcessedAudio, 
  WebSocketMessage, 
  MessageType,
  IntentResult,
  AIResponse,
  PerformanceMetrics,
  ProcessingStage,
  RealtimeProcessorError
} from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import WebSocketManager from '../websocket/WebSocketManager';
import AudioStreamHandler from '../websocket/AudioStreamHandler';

// Import existing services
import { AzureSpeechService } from './azureSpeech';
import { IntentRecognitionService } from './intentRecognition';
import { AIConversationService } from './aiConversation';
import { CacheService } from './cacheService';
import { PerformanceMonitor } from './performanceMonitor';

export interface RealtimeSession {
  sessionId: string;
  callId: string;
  userId: string;
  connectionId: string;
  startTime: number;
  lastActivity: number;
  status: 'active' | 'paused' | 'ended';
  processingStats: ProcessingStats;
  conversationContext: ConversationContext;
}

export interface ProcessingStats {
  totalAudioChunks: number;
  processedChunks: number;
  transcribedChunks: number;
  aiResponses: number;
  averageLatency: number;
  errorCount: number;
  lastProcessingTime: number;
}

export interface ConversationContext {
  turnCount: number;
  lastIntent: string;
  emotionalState: string;
  persistenceLevel: number;
  recentTranscripts: string[];
  conversationSummary: string;
  userProfile?: any;
  spamCategory?: string;
}

export interface ProcessingPipeline {
  stage: ProcessingStage;
  startTime: number;
  endTime?: number;
  latency?: number;
  success: boolean;
  error?: string;
  data?: any;
}

export class RealtimeService extends EventEmitter {
  private wsManager: WebSocketManager;
  private audioHandler: AudioStreamHandler;
  private speechService: AzureSpeechService;
  private intentService: IntentRecognitionService;
  private aiService: AIConversationService;
  private cacheService: CacheService;
  private performanceMonitor: PerformanceMonitor;

  private sessions: Map<string, RealtimeSession> = new Map();
  private processingPipelines: Map<string, ProcessingPipeline[]> = new Map();
  private messageQueue: Map<string, WebSocketMessage[]> = new Map();

  private readonly MAX_CONVERSATION_TURNS = 10;
  private readonly SESSION_TIMEOUT = 300000; // 5 minutes
  private readonly MAX_CONCURRENT_PROCESSING = 5;

  constructor(
    wsManager: WebSocketManager,
    audioHandler: AudioStreamHandler
  ) {
    super();
    
    this.wsManager = wsManager;
    this.audioHandler = audioHandler;
    
    // Initialize services
    this.speechService = new AzureSpeechService();
    this.intentService = new IntentRecognitionService();
    this.aiService = new AIConversationService();
    this.cacheService = new CacheService();
    this.performanceMonitor = new PerformanceMonitor();

    this.setupEventHandlers();
    this.startCleanupInterval();

    logger.info('RealtimeService initialized');
  }

  /**
   * Initialize the service
   */
  public async initialize(): Promise<void> {
    try {
      await Promise.all([
        this.speechService.initialize(),
        this.intentService.initialize(),
        this.aiService.initialize(),
        this.cacheService.initialize()
      ]);

      logger.info('RealtimeService fully initialized');
    } catch (error) {
      logger.error('Failed to initialize RealtimeService:', error);
      throw error;
    }
  }

  /**
   * Start a new realtime session
   */
  public async startSession(sessionId: string, callId: string, userId: string, connectionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new RealtimeProcessorError('Session already exists', 'DUPLICATE_SESSION', 409);
    }

    const session: RealtimeSession = {
      sessionId,
      callId,
      userId,
      connectionId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      status: 'active',
      processingStats: {
        totalAudioChunks: 0,
        processedChunks: 0,
        transcribedChunks: 0,
        aiResponses: 0,
        averageLatency: 0,
        errorCount: 0,
        lastProcessingTime: 0
      },
      conversationContext: {
        turnCount: 0,
        lastIntent: '',
        emotionalState: 'neutral',
        persistenceLevel: 0,
        recentTranscripts: [],
        conversationSummary: ''
      }
    };

    this.sessions.set(sessionId, session);
    this.processingPipelines.set(sessionId, []);
    this.messageQueue.set(sessionId, []);

    // Start audio stream
    this.audioHandler.startStream(callId, {
      enableVAD: true,
      vadThreshold: 0.3,
      enableDenoising: true,
      enableAGC: true
    });

    // Load user profile and context
    await this.loadSessionContext(session);

    logger.info(`Realtime session started: ${sessionId} for call ${callId}`);
    this.emit('sessionStarted', { sessionId, session });

    // Send session started message
    await this.wsManager.sendMessage(connectionId, {
      type: MessageType.CONNECTION_STATUS,
      callId,
      timestamp: Date.now(),
      data: {
        sessionId,
        status: 'started',
        message: 'Realtime processing session started'
      }
    });
  }

  /**
   * Process incoming audio chunk
   */
  public async processAudioChunk(sessionId: string, audioChunk: AudioChunk): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') {
      throw new RealtimeProcessorError('Invalid or inactive session', 'INVALID_SESSION', 400);
    }

    const startTime = Date.now();
    const pipeline: ProcessingPipeline[] = [];

    try {
      // Update session activity
      session.lastActivity = Date.now();
      session.processingStats.totalAudioChunks++;

      // Stage 1: Audio preprocessing
      const preprocessingStart = Date.now();
      const processedAudio = await this.audioHandler.processAudioChunk(audioChunk);
      
      pipeline.push({
        stage: ProcessingStage.PREPROCESSING,
        startTime: preprocessingStart,
        endTime: Date.now(),
        latency: Date.now() - preprocessingStart,
        success: true,
        data: { hasProcessedAudio: !!processedAudio }
      });

      if (!processedAudio) {
        // No speech detected, just update stats
        this.updateProcessingStats(session, pipeline, false);
        return;
      }

      session.processingStats.processedChunks++;

      // Stage 2: Speech-to-Text
      const sttStart = Date.now();
      const transcript = await this.speechService.transcribeAudio(processedAudio.audioResponse);
      
      pipeline.push({
        stage: ProcessingStage.SPEECH_TO_TEXT,
        startTime: sttStart,
        endTime: Date.now(),
        latency: Date.now() - sttStart,
        success: !!transcript,
        data: { transcript: transcript?.text, confidence: transcript?.confidence }
      });

      if (!transcript || !transcript.text) {
        this.updateProcessingStats(session, pipeline, false);
        return;
      }

      session.processingStats.transcribedChunks++;
      session.conversationContext.recentTranscripts.push(transcript.text);

      // Stage 3: Intent Recognition
      const intentStart = Date.now();
      const intent = await this.intentService.recognizeIntent(
        transcript.text, 
        session.conversationContext
      );
      
      pipeline.push({
        stage: ProcessingStage.INTENT_RECOGNITION,
        startTime: intentStart,
        endTime: Date.now(),
        latency: Date.now() - intentStart,
        success: !!intent,
        data: { intent: intent?.intent, confidence: intent?.confidence }
      });

      // Stage 4: AI Response Generation
      const aiStart = Date.now();
      const aiResponse = await this.generateAIResponse(session, transcript.text, intent);
      
      pipeline.push({
        stage: ProcessingStage.AI_GENERATION,
        startTime: aiStart,
        endTime: Date.now(),
        latency: Date.now() - aiStart,
        success: !!aiResponse,
        data: { responseLength: aiResponse?.text?.length, shouldTerminate: aiResponse?.shouldTerminate }
      });

      if (aiResponse) {
        session.processingStats.aiResponses++;
        session.conversationContext.turnCount++;
        session.conversationContext.lastIntent = intent?.intent || '';

        // Stage 5: Text-to-Speech (if needed)
        let audioResponse: Buffer | string | undefined;
        if (aiResponse.text && !aiResponse.audioData) {
          const ttsStart = Date.now();
          audioResponse = await this.speechService.synthesizeSpeech(aiResponse.text);
          
          pipeline.push({
            stage: ProcessingStage.TEXT_TO_SPEECH,
            startTime: ttsStart,
            endTime: Date.now(),
            latency: Date.now() - ttsStart,
            success: !!audioResponse,
            data: { audioSize: audioResponse ? Buffer.byteLength(audioResponse) : 0 }
          });
        } else {
          audioResponse = aiResponse.audioData;
        }

        // Send response to client
        await this.sendResponse(session, aiResponse, audioResponse, transcript.text);

        // Check if conversation should terminate
        if (aiResponse.shouldTerminate || session.conversationContext.turnCount >= this.MAX_CONVERSATION_TURNS) {
          await this.endSession(sessionId, 'conversation_ended');
        }
      }

      // Update processing statistics
      this.updateProcessingStats(session, pipeline, true);

      // Store processing pipeline for analysis
      this.processingPipelines.get(sessionId)?.push(...pipeline);

      // Emit processing complete event
      this.emit('processingComplete', {
        sessionId,
        audioChunk,
        processedAudio,
        transcript,
        intent,
        aiResponse,
        totalLatency: Date.now() - startTime,
        pipeline
      });

    } catch (error) {
      logger.error(`Error processing audio chunk for session ${sessionId}:`, error);
      session.processingStats.errorCount++;

      // Add error to pipeline
      pipeline.push({
        stage: ProcessingStage.ERROR,
        startTime: startTime,
        endTime: Date.now(),
        latency: Date.now() - startTime,
        success: false,
        error: error.message
      });

      this.updateProcessingStats(session, pipeline, false);

      // Send error to client
      await this.wsManager.sendError(session.connectionId, 'PROCESSING_ERROR', error.message);

      this.emit('processingError', { sessionId, error, audioChunk });
      throw error;
    }
  }

  /**
   * End a realtime session
   */
  public async endSession(sessionId: string, reason: string = 'user_request'): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`Attempt to end non-existent session: ${sessionId}`);
      return;
    }

    session.status = 'ended';

    // Stop audio stream
    this.audioHandler.stopStream(session.callId);

    // Generate final conversation summary
    const summary = await this.generateConversationSummary(session);

    // Send session ended message
    await this.wsManager.sendMessage(session.connectionId, {
      type: MessageType.CONNECTION_STATUS,
      callId: session.callId,
      timestamp: Date.now(),
      data: {
        sessionId,
        status: 'ended',
        reason,
        summary,
        stats: session.processingStats
      }
    });

    // Clean up session data
    this.sessions.delete(sessionId);
    this.processingPipelines.delete(sessionId);
    this.messageQueue.delete(sessionId);

    logger.info(`Realtime session ended: ${sessionId}, reason: ${reason}`);
    this.emit('sessionEnded', { sessionId, session, reason, summary });
  }

  /**
   * Get session information
   */
  public getSession(sessionId: string): RealtimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): RealtimeSession[] {
    return Array.from(this.sessions.values()).filter(session => session.status === 'active');
  }

  /**
   * Get service statistics
   */
  public getStatistics(): any {
    const activeSessions = this.getActiveSessions();
    const totalSessions = this.sessions.size;

    let totalProcessingStats = {
      totalAudioChunks: 0,
      processedChunks: 0,
      transcribedChunks: 0,
      aiResponses: 0,
      averageLatency: 0,
      errorCount: 0
    };

    for (const session of this.sessions.values()) {
      totalProcessingStats.totalAudioChunks += session.processingStats.totalAudioChunks;
      totalProcessingStats.processedChunks += session.processingStats.processedChunks;
      totalProcessingStats.transcribedChunks += session.processingStats.transcribedChunks;
      totalProcessingStats.aiResponses += session.processingStats.aiResponses;
      totalProcessingStats.errorCount += session.processingStats.errorCount;
    }

    // Calculate average latency across all sessions
    if (totalSessions > 0) {
      totalProcessingStats.averageLatency = 
        Array.from(this.sessions.values())
          .reduce((sum, session) => sum + session.processingStats.averageLatency, 0) / totalSessions;
    }

    return {
      activeSessions: activeSessions.length,
      totalSessions,
      processingStats: totalProcessingStats,
      wsStats: this.wsManager.getStats(),
      uptime: process.uptime() * 1000
    };
  }

  /**
   * Shutdown the service
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down RealtimeService...');

    // End all active sessions
    const activeSessions = this.getActiveSessions();
    await Promise.all(
      activeSessions.map(session => this.endSession(session.sessionId, 'service_shutdown'))
    );

    // Shutdown services
    await Promise.all([
      this.speechService.shutdown?.(),
      this.intentService.shutdown?.(),
      this.aiService.shutdown?.(),
      this.cacheService.shutdown?.()
    ]);

    this.sessions.clear();
    this.processingPipelines.clear();
    this.messageQueue.clear();

    logger.info('RealtimeService shut down');
  }

  /**
   * Private helper methods
   */
  private setupEventHandlers(): void {
    // WebSocket Manager events
    this.wsManager.on('message', this.handleWebSocketMessage.bind(this));
    this.wsManager.on('disconnection', this.handleWebSocketDisconnection.bind(this));

    // Audio Handler events
    this.audioHandler.on('audioProcessed', this.handleAudioProcessed.bind(this));
    this.audioHandler.on('processingError', this.handleAudioProcessingError.bind(this));
  }

  private async handleWebSocketMessage({ connectionId, message }: any): Promise<void> {
    try {
      switch (message.type) {
        case MessageType.AUDIO_CHUNK:
          const session = this.findSessionByConnection(connectionId);
          if (session && message.data) {
            const audioChunk: AudioChunk = {
              id: message.id || Date.now().toString(),
              callId: session.callId,
              timestamp: message.timestamp,
              audioData: message.data,
              sequenceNumber: message.sequenceNumber || 0
            };
            await this.processAudioChunk(session.sessionId, audioChunk);
          }
          break;

        case MessageType.HEARTBEAT:
          await this.wsManager.sendMessage(connectionId, {
            type: MessageType.HEARTBEAT,
            callId: '',
            timestamp: Date.now(),
            data: { status: 'alive' }
          });
          break;

        default:
          logger.debug(`Unhandled message type: ${message.type}`);
          break;
      }
    } catch (error) {
      logger.error(`Error handling WebSocket message:`, error);
      await this.wsManager.sendError(connectionId, 'MESSAGE_HANDLING_ERROR', error.message);
    }
  }

  private handleWebSocketDisconnection({ connectionId }: any): void {
    const session = this.findSessionByConnection(connectionId);
    if (session) {
      this.endSession(session.sessionId, 'client_disconnected');
    }
  }

  private async handleAudioProcessed({ callId, processed }: any): Promise<void> {
    logger.debug(`Audio processed for call ${callId}`);
  }

  private handleAudioProcessingError({ callId, error }: any): void {
    logger.error(`Audio processing error for call ${callId}:`, error);
  }

  private findSessionByConnection(connectionId: string): RealtimeSession | undefined {
    return Array.from(this.sessions.values()).find(session => session.connectionId === connectionId);
  }

  private async loadSessionContext(session: RealtimeSession): Promise<void> {
    try {
      // Load user profile from cache or database
      const userProfile = await this.cacheService.get(`user_profile:${session.userId}`);
      if (userProfile) {
        session.conversationContext.userProfile = userProfile;
      }

      // Load recent conversation history
      const recentHistory = await this.cacheService.get(`conversation_history:${session.userId}`);
      if (recentHistory) {
        session.conversationContext.conversationSummary = recentHistory.summary || '';
      }

    } catch (error) {
      logger.error(`Error loading session context for ${session.sessionId}:`, error);
    }
  }

  private async generateAIResponse(
    session: RealtimeSession, 
    transcript: string, 
    intent?: IntentResult
  ): Promise<AIResponse | null> {
    try {
      const context = {
        userId: session.userId,
        callId: session.callId,
        conversationContext: session.conversationContext,
        userProfile: session.conversationContext.userProfile
      };

      return await this.aiService.generateResponse(transcript, intent, context);
    } catch (error) {
      logger.error(`Error generating AI response:`, error);
      return null;
    }
  }

  private async sendResponse(
    session: RealtimeSession,
    aiResponse: AIResponse,
    audioResponse: Buffer | string | undefined,
    originalTranscript: string
  ): Promise<void> {
    // Send transcript
    await this.wsManager.sendMessage(session.connectionId, {
      type: MessageType.TRANSCRIPT,
      callId: session.callId,
      timestamp: Date.now(),
      data: {
        text: originalTranscript,
        confidence: 0.9 // TODO: Use actual confidence from STT
      }
    });

    // Send AI response
    await this.wsManager.sendMessage(session.connectionId, {
      type: MessageType.AI_RESPONSE,
      callId: session.callId,
      timestamp: Date.now(),
      data: {
        text: aiResponse.text,
        confidence: aiResponse.confidence,
        shouldTerminate: aiResponse.shouldTerminate,
        strategy: aiResponse.responseStrategy
      }
    });

    // Send audio response if available
    if (audioResponse) {
      await this.wsManager.sendMessage(session.connectionId, {
        type: MessageType.AUDIO_RESPONSE,
        callId: session.callId,
        timestamp: Date.now(),
        data: audioResponse
      });
    }
  }

  private updateProcessingStats(
    session: RealtimeSession,
    pipeline: ProcessingPipeline[],
    success: boolean
  ): void {
    const totalLatency = pipeline.reduce((sum, stage) => sum + (stage.latency || 0), 0);
    
    // Update average latency using exponential moving average
    if (session.processingStats.averageLatency === 0) {
      session.processingStats.averageLatency = totalLatency;
    } else {
      session.processingStats.averageLatency = 
        (session.processingStats.averageLatency * 0.8) + (totalLatency * 0.2);
    }

    session.processingStats.lastProcessingTime = totalLatency;

    if (!success) {
      session.processingStats.errorCount++;
    }
  }

  private async generateConversationSummary(session: RealtimeSession): Promise<string> {
    try {
      const context = session.conversationContext;
      const summary = `Conversation completed with ${context.turnCount} turns. ` +
                     `Last intent: ${context.lastIntent}. ` +
                     `Processing stats: ${session.processingStats.aiResponses} AI responses, ` +
                     `${session.processingStats.errorCount} errors.`;
      
      // Cache the summary for future reference
      await this.cacheService.set(
        `conversation_summary:${session.callId}`,
        summary,
        3600 // 1 hour TTL
      );

      return summary;
    } catch (error) {
      logger.error(`Error generating conversation summary:`, error);
      return 'Conversation completed';
    }
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Every minute
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.SESSION_TIMEOUT) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      logger.info(`Cleaning up expired session: ${sessionId}`);
      this.endSession(sessionId, 'session_timeout');
    }

    if (expiredSessions.length > 0) {
      logger.info(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }
}

export default RealtimeService;