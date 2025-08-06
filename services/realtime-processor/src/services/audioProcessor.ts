import { v4 as uuidv4 } from 'uuid';
import {
  AudioChunk,
  ProcessedAudio,
  ConnectionContext,
  VoiceActivityResult,
  AudioProcessingError,
  ProcessingStage,
} from '../types';
import config from '../config';
import logger from '../utils/logger';
import { AzureSpeechService } from './azureSpeech';
import { IntentRecognitionService } from './intentRecognition';
import { AIConversationService } from './aiConversation';
import { VoiceActivityDetector } from './voiceActivityDetector';
import { PerformanceMonitor } from './performanceMonitor';
import PQueue from 'p-queue';

export class AudioProcessor {
  private vadService: VoiceActivityDetector;
  private performanceMonitor: PerformanceMonitor;
  private speechService?: AzureSpeechService;
  private intentService?: IntentRecognitionService;
  private aiService?: AIConversationService;
  private processingQueue: PQueue;
  private isInitialized = false;
  private readonly config: any;

  constructor(config: any) {
    this.config = config;
    this.vadService = new VoiceActivityDetector();
    this.performanceMonitor = new PerformanceMonitor();
    
    // Initialize processing queue with concurrency limit
    this.processingQueue = new PQueue({
      concurrency: config.maxConcurrentProcessing,
      timeout: config.processingTimeout,
    });

    logger.info('Audio processor created');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    // Initialize services (these will be injected externally)
    // The services are initialized by the WebSocketManager
    
    this.isInitialized = true;
    logger.info('Audio processor initialized');
  }

  // Service injection methods (called by WebSocketManager)
  setServices(
    speechService: AzureSpeechService,
    intentService: IntentRecognitionService,
    aiService: AIConversationService
  ): void {
    this.speechService = speechService;
    this.intentService = intentService;
    this.aiService = aiService;
  }

  async preprocessAudio(audioChunk: AudioChunk): Promise<AudioChunk> {
    // Convert base64 to buffer if needed
    let audioBuffer: Buffer;
    
    if (Buffer.isBuffer(audioChunk.audioData)) {
      audioBuffer = audioChunk.audioData;
    } else {
      audioBuffer = Buffer.from(audioChunk.audioData, 'base64');
    }

    // Basic audio validation
    if (audioBuffer.length === 0) {
      throw new AudioProcessingError('Empty audio data');
    }

    if (audioBuffer.length > this.config.audioChunkSize * 10) {
      throw new AudioProcessingError('Audio chunk too large');
    }

    // Apply noise reduction and normalization
    const processedBuffer = await this.applyAudioFilters(audioBuffer);

    return {
      ...audioChunk,
      audioData: processedBuffer,
      format: audioChunk.format || 'pcm',
      sampleRate: audioChunk.sampleRate || 16000,
      channels: audioChunk.channels || 1,
      metadata: {
        sampleRate: audioChunk.sampleRate || 16000,
        channels: audioChunk.channels || 1,
        bitDepth: 16,
        format: audioChunk.format || 'pcm',
        duration: this.calculateAudioDuration(processedBuffer),
        size: processedBuffer.length,
      },
    };
  }

  async detectVoiceActivity(audioChunk: AudioChunk): Promise<VoiceActivityResult> {
    let audioBuffer: Buffer;
    
    if (Buffer.isBuffer(audioChunk.audioData)) {
      audioBuffer = audioChunk.audioData;
    } else {
      audioBuffer = Buffer.from(audioChunk.audioData, 'base64');
    }

    return await this.vadService.detectSpeech(audioBuffer);
  }

  async processAudioChunk(
    audioChunk: AudioChunk,
    context: ConnectionContext
  ): Promise<ProcessedAudio | null> {
    const processingId = uuidv4();
    const startTime = performance.now();

    try {
      logger.debug(
        {
          processingId,
          chunkId: audioChunk.id,
          callId: audioChunk.callId,
          sequenceNumber: audioChunk.sequenceNumber,
        },
        'Starting audio chunk processing'
      );

      // Add to processing queue
      return await this.processingQueue.add(async () => {
        return await this.processAudioPipeline(audioChunk, context, processingId, startTime);
      });

    } catch (error) {
      const processingTime = performance.now() - startTime;
      logger.error(
        {
          error,
          processingId,
          chunkId: audioChunk.id,
          processingTime,
        },
        'Audio processing failed'
      );

      await this.performanceMonitor.recordError(
        context.id,
        'audio_processing',
        error as Error,
        processingTime
      );

      throw new AudioProcessingError(
        `Failed to process audio chunk: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { processingId, chunkId: audioChunk.id, error }
      );
    }
  }

  private async processAudioPipeline(
    audioChunk: AudioChunk,
    context: ConnectionContext,
    processingId: string,
    startTime: number
  ): Promise<ProcessedAudio | null> {
    const result: ProcessedAudio = {
      id: processingId,
      callId: audioChunk.callId,
      timestamp: audioChunk.timestamp,
      processingLatency: 0,
    };

    try {
      // Stage 1: Audio Preprocessing and VAD
      await this.recordStageMetrics(context.id, ProcessingStage.PREPROCESSING, async () => {
        const preprocessed = await this.preprocessAudio(audioChunk);
        const vadResult = await this.vadService.detectSpeech(preprocessed.audioData);
        
        if (!vadResult.isSpeech) {
          logger.debug({ processingId, chunkId: audioChunk.id }, 'No speech detected, skipping processing');
          return null;
        }

        result.metadata = {
          sampleRate: preprocessed.sampleRate || 16000,
          channels: preprocessed.channels || 1,
          bitDepth: 16,
          format: preprocessed.format || 'pcm',
          duration: this.calculateAudioDuration(preprocessed.audioData),
          size: Buffer.isBuffer(preprocessed.audioData) 
            ? preprocessed.audioData.length 
            : Buffer.from(preprocessed.audioData, 'base64').length,
        };
      });

      if (!result.metadata) {
        return null; // No speech detected
      }

      // Stage 2: Speech-to-Text
      await this.recordStageMetrics(context.id, ProcessingStage.SPEECH_TO_TEXT, async () => {
        if (!this.speechService) {
          throw new Error('Speech service not initialized');
        }
        
        const sttResult = await this.speechService.speechToText(audioChunk.audioData);
        
        if (sttResult && sttResult.trim().length > 0) {
          result.transcript = sttResult;
          result.confidence = 0.8; // Default confidence since speechToText returns string
          
          logger.debug(
            {
              processingId,
              transcript: result.transcript,
              confidence: result.confidence,
            },
            'Speech-to-text completed'
          );
        }
      });

      // Skip further processing if no transcript
      if (!result.transcript) {
        return result;
      }

      // Stage 3: Intent Recognition
      await this.recordStageMetrics(context.id, ProcessingStage.INTENT_RECOGNITION, async () => {
        if (!this.intentService) {
          throw new Error('Intent service not initialized');
        }
        
        result.intent = await this.intentService.classifyIntent(
          result.transcript!,
          this.buildConversationContext(context)
        );
      });

      // Stage 4: AI Response Generation
      await this.recordStageMetrics(context.id, ProcessingStage.AI_GENERATION, async () => {
        if (!this.aiService) {
          throw new Error('AI service not initialized');
        }
        
        if (result.intent) {
          result.response = await this.aiService.generateResponse(
            result.transcript!,
            result.intent,
            context.userId,
            this.buildConversationContext(context)
          );
        }
      });

      // Stage 5: Text-to-Speech (if AI response exists)
      if (result.response?.text) {
        await this.recordStageMetrics(context.id, ProcessingStage.TEXT_TO_SPEECH, async () => {
          if (!this.speechService) {
            throw new Error('Speech service not initialized');
          }
          
          const ttsResult = await this.speechService.textToSpeech(
            result.response!.text,
            context.userId
          );
          
          if (ttsResult && ttsResult.length > 0) {
            result.response!.audioData = ttsResult;
          }
        });
      }

      // Calculate total processing latency
      result.processingLatency = performance.now() - startTime;

      // Log successful processing
      logger.info(
        {
          processingId,
          chunkId: audioChunk.id,
          callId: audioChunk.callId,
          processingLatency: result.processingLatency,
          hasTranscript: !!result.transcript,
          hasIntent: !!result.intent,
          hasResponse: !!result.response,
          hasAudioResponse: !!result.response?.audioData,
        },
        'Audio processing completed successfully'
      );

      // Record overall performance metrics
      await this.performanceMonitor.recordLatency(
        context.id,
        'total_pipeline',
        result.processingLatency
      );

      return result;

    } catch (error) {
      const processingTime = performance.now() - startTime;
      result.processingLatency = processingTime;

      logger.error(
        {
          error,
          processingId,
          chunkId: audioChunk.id,
          processingTime,
        },
        'Error in audio processing pipeline'
      );

      await this.performanceMonitor.recordError(
        context.id,
        'audio_pipeline',
        error as Error,
        processingTime
      );

      throw error;
    }
  }

  private async preprocessAudio(audioChunk: AudioChunk): Promise<AudioChunk> {
    // Convert base64 to buffer if needed
    let audioBuffer: Buffer;
    
    if (Buffer.isBuffer(audioChunk.audioData)) {
      audioBuffer = audioChunk.audioData;
    } else {
      audioBuffer = Buffer.from(audioChunk.audioData, 'base64');
    }

    // Basic audio validation
    if (audioBuffer.length === 0) {
      throw new AudioProcessingError('Empty audio data');
    }

    if (audioBuffer.length > config.performance.audioChunkSize * 10) {
      throw new AudioProcessingError('Audio chunk too large');
    }

    // Apply noise reduction and normalization (placeholder)
    const processedBuffer = await this.applyAudioFilters(audioBuffer);

    return {
      ...audioChunk,
      audioData: processedBuffer,
      format: audioChunk.format || 'pcm',
      sampleRate: audioChunk.sampleRate || 16000,
      channels: audioChunk.channels || 1,
    };
  }

  private async applyAudioFilters(audioBuffer: Buffer): Promise<Buffer> {
    // Placeholder for audio filtering
    // In production, this would include:
    // - Noise reduction
    // - Audio normalization
    // - Echo cancellation
    // - Volume adjustment
    
    return audioBuffer;
  }

  private calculateAudioDuration(audioData: Buffer | string): number {
    // Approximate duration calculation for PCM data
    const buffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData, 'base64');
    const sampleRate = 16000; // Assuming 16kHz
    const bytesPerSample = 2; // 16-bit audio
    const channels = 1; // Mono
    
    return (buffer.length / (sampleRate * bytesPerSample * channels)) * 1000; // in milliseconds
  }

  private buildConversationContext(context: ConnectionContext): any {
    return {
      userId: context.userId,
      callId: context.callId,
      recentTranscripts: context.processingQueue.completed
        .slice(-5)
        .map((item) => item.transcript)
        .filter(Boolean),
      recentIntents: context.processingQueue.completed
        .slice(-3)
        .map((item) => item.intent)
        .filter(Boolean),
      conversationDuration: Date.now() - context.startTime,
      messageCount: context.processingQueue.completed.length,
    };
  }

  private async recordStageMetrics(
    connectionId: string,
    stage: ProcessingStage,
    operation: () => Promise<any>
  ): Promise<any> {
    const startTime = performance.now();
    
    try {
      const result = await operation();
      const latency = performance.now() - startTime;
      
      await this.performanceMonitor.recordLatency(connectionId, stage, latency);
      
      return result;
    } catch (error) {
      const latency = performance.now() - startTime;
      
      await this.performanceMonitor.recordError(
        connectionId,
        stage,
        error as Error,
        latency
      );
      
      throw error;
    }
  }

  // Batch processing for multiple chunks
  async processBatch(
    audioChunks: AudioChunk[],
    context: ConnectionContext
  ): Promise<ProcessedAudio[]> {
    logger.info(
      {
        batchSize: audioChunks.length,
        callId: context.callId,
      },
      'Processing audio batch'
    );

    const results = await Promise.allSettled(
      audioChunks.map((chunk) => this.processAudioChunk(chunk, context))
    );

    const successful: ProcessedAudio[] = [];
    const failed: any[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        successful.push(result.value);
      } else {
        failed.push({
          chunkId: audioChunks[index].id,
          error: result.status === 'rejected' ? result.reason : 'No result',
        });
      }
    });

    if (failed.length > 0) {
      logger.warn(
        {
          callId: context.callId,
          successCount: successful.length,
          failCount: failed.length,
          failures: failed,
        },
        'Batch processing completed with some failures'
      );
    }

    return successful;
  }

  // Stream processing for continuous audio
  async processAudioStream(
    audioStream: AsyncIterable<AudioChunk>,
    context: ConnectionContext,
    onProcessed: (result: ProcessedAudio) => void
  ): Promise<void> {
    logger.info({ callId: context.callId }, 'Starting audio stream processing');

    try {
      for await (const chunk of audioStream) {
        const result = await this.processAudioChunk(chunk, context);
        if (result) {
          onProcessed(result);
        }
      }
    } catch (error) {
      logger.error(
        { error, callId: context.callId },
        'Error in audio stream processing'
      );
      throw error;
    }
  }

  // Get processing statistics
  getProcessingStats(): any {
    return {
      queueSize: this.processingQueue.size,
      pending: this.processingQueue.pending,
      isPaused: this.processingQueue.isPaused,
      concurrency: this.processingQueue.concurrency,
    };
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    logger.info('Cleaning up audio processor');
    
    // Wait for all processing to complete
    await this.processingQueue.onIdle();
    
    // Clear the queue
    this.processingQueue.clear();
    
    logger.info('Audio processor cleanup completed');
  }
}