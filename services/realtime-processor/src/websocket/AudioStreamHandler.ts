/**
 * Audio Stream Handler
 * Processes real-time audio data with voice activity detection and buffering
 */

import { EventEmitter } from 'events';
import { 
  AudioChunk, 
  ProcessedAudio, 
  VoiceActivityResult, 
  AudioFormat,
  AudioMetadata,
  ProcessingStage,
  AudioProcessingError
} from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface AudioStreamState {
  callId: string;
  isActive: boolean;
  totalChunks: number;
  totalDuration: number;
  bytesProcessed: number;
  lastActivity: number;
  bufferSize: number;
  processingLatency: number[];
  averageLatency: number;
}

export interface AudioBuffer {
  chunks: AudioChunk[];
  maxSize: number;
  currentSize: number;
  totalDuration: number;
  lastChunkTime: number;
}

export interface ProcessingOptions {
  enableVAD: boolean;
  vadThreshold: number;
  maxChunkSize: number;
  bufferDuration: number;
  enableDenoising: boolean;
  enableAGC: boolean; // Automatic Gain Control
  sampleRate: number;
  channels: number;
}

export class AudioStreamHandler extends EventEmitter {
  private streams: Map<string, AudioStreamState> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  private processingQueue: Map<string, AudioChunk[]> = new Map();
  private vadProcessor: VoiceActivityDetector;
  private audioProcessor: AudioProcessor;
  
  private readonly DEFAULT_OPTIONS: ProcessingOptions = {
    enableVAD: true,
    vadThreshold: 0.3,
    maxChunkSize: 4096,
    bufferDuration: 3000, // 3 seconds
    enableDenoising: true,
    enableAGC: true,
    sampleRate: 16000,
    channels: 1
  };

  constructor() {
    super();
    this.vadProcessor = new VoiceActivityDetector();
    this.audioProcessor = new AudioProcessor();
    logger.info('AudioStreamHandler initialized');
  }

  /**
   * Start audio stream for a call
   */
  public startStream(callId: string, options: Partial<ProcessingOptions> = {}): void {
    if (this.streams.has(callId)) {
      logger.warn(`Audio stream already exists for call ${callId}`);
      return;
    }

    const streamOptions = { ...this.DEFAULT_OPTIONS, ...options };

    const state: AudioStreamState = {
      callId,
      isActive: true,
      totalChunks: 0,
      totalDuration: 0,
      bytesProcessed: 0,
      lastActivity: Date.now(),
      bufferSize: 0,
      processingLatency: [],
      averageLatency: 0
    };

    const buffer: AudioBuffer = {
      chunks: [],
      maxSize: Math.ceil(streamOptions.bufferDuration / 100), // Assuming 100ms chunks
      currentSize: 0,
      totalDuration: 0,
      lastChunkTime: 0
    };

    this.streams.set(callId, state);
    this.buffers.set(callId, buffer);
    this.processingQueue.set(callId, []);

    logger.info(`Audio stream started for call ${callId}`);
    this.emit('streamStarted', { callId, options: streamOptions });
  }

  /**
   * Process incoming audio chunk
   */
  public async processAudioChunk(chunk: AudioChunk): Promise<ProcessedAudio | null> {
    const startTime = Date.now();
    const state = this.streams.get(chunk.callId);
    
    if (!state || !state.isActive) {
      throw new AudioProcessingError(`No active stream for call ${chunk.callId}`);
    }

    try {
      // Update stream state
      state.totalChunks++;
      state.lastActivity = Date.now();
      
      // Validate audio chunk
      const validationResult = await this.validateAudioChunk(chunk);
      if (!validationResult.isValid) {
        throw new AudioProcessingError(`Invalid audio chunk: ${validationResult.reason}`);
      }

      // Add to buffer
      await this.addToBuffer(chunk);

      // Process audio data
      const processedChunk = await this.processAudioData(chunk);
      
      // Perform voice activity detection
      const vadResult = await this.vadProcessor.detect(processedChunk);
      
      // Update processing latency
      const latency = Date.now() - startTime;
      this.updateLatencyStats(chunk.callId, latency);

      // Emit processing stage events
      this.emit('processingStage', {
        callId: chunk.callId,
        stage: ProcessingStage.PREPROCESSING,
        timestamp: Date.now(),
        latency
      });

      // Check if we should process this chunk further
      if (vadResult.isSpeech && vadResult.confidence > 0.5) {
        const processedAudio = await this.createProcessedAudio(chunk, processedChunk, vadResult, latency);
        
        this.emit('audioProcessed', {
          callId: chunk.callId,
          chunk,
          processed: processedAudio,
          vadResult
        });

        return processedAudio;
      }

      // Just update stats for non-speech
      state.bytesProcessed += this.getChunkSize(chunk);
      return null;

    } catch (error) {
      logger.error(`Error processing audio chunk for call ${chunk.callId}:`, error);
      this.emit('processingError', { callId: chunk.callId, error, chunk });
      throw error;
    }
  }

  /**
   * Get stream state
   */
  public getStreamState(callId: string): AudioStreamState | undefined {
    return this.streams.get(callId);
  }

  /**
   * Get buffer state
   */
  public getBufferState(callId: string): AudioBuffer | undefined {
    return this.buffers.get(callId);
  }

  /**
   * Stop audio stream
   */
  public stopStream(callId: string): void {
    const state = this.streams.get(callId);
    if (!state) {
      logger.warn(`No stream to stop for call ${callId}`);
      return;
    }

    state.isActive = false;
    
    // Process any remaining buffered audio
    this.flushBuffer(callId);
    
    // Clean up
    this.streams.delete(callId);
    this.buffers.delete(callId);
    this.processingQueue.delete(callId);

    logger.info(`Audio stream stopped for call ${callId}`);
    this.emit('streamStopped', { callId, finalState: state });
  }

  /**
   * Get all active streams
   */
  public getActiveStreams(): string[] {
    return Array.from(this.streams.keys()).filter(callId => {
      const state = this.streams.get(callId);
      return state?.isActive;
    });
  }

  /**
   * Get stream statistics
   */
  public getStreamStatistics(callId: string): any {
    const state = this.streams.get(callId);
    const buffer = this.buffers.get(callId);
    
    if (!state) return null;

    return {
      callId,
      isActive: state.isActive,
      totalChunks: state.totalChunks,
      totalDuration: state.totalDuration,
      bytesProcessed: state.bytesProcessed,
      bufferSize: buffer?.currentSize || 0,
      averageLatency: state.averageLatency,
      lastActivity: state.lastActivity,
      uptime: Date.now() - (Date.now() - state.lastActivity)
    };
  }

  /**
   * Clean up expired streams
   */
  public cleanup(): void {
    const now = Date.now();
    const STREAM_TIMEOUT = 300000; // 5 minutes

    for (const [callId, state] of this.streams) {
      if (now - state.lastActivity > STREAM_TIMEOUT) {
        logger.info(`Cleaning up expired stream for call ${callId}`);
        this.stopStream(callId);
      }
    }
  }

  /**
   * Private helper methods
   */
  private async validateAudioChunk(chunk: AudioChunk): Promise<{ isValid: boolean; reason?: string }> {
    if (!chunk.audioData) {
      return { isValid: false, reason: 'Missing audio data' };
    }

    if (!chunk.callId) {
      return { isValid: false, reason: 'Missing call ID' };
    }

    if (chunk.sequenceNumber < 0) {
      return { isValid: false, reason: 'Invalid sequence number' };
    }

    const chunkSize = this.getChunkSize(chunk);
    if (chunkSize > config.performance.audioChunkSize * 10) {
      return { isValid: false, reason: 'Chunk too large' };
    }

    return { isValid: true };
  }

  private async addToBuffer(chunk: AudioChunk): Promise<void> {
    const buffer = this.buffers.get(chunk.callId);
    if (!buffer) return;

    // Add chunk to buffer
    buffer.chunks.push(chunk);
    buffer.currentSize++;
    buffer.lastChunkTime = chunk.timestamp;

    // Estimate duration (assuming 100ms chunks)
    buffer.totalDuration += 100;

    // Remove old chunks if buffer is full
    if (buffer.chunks.length > buffer.maxSize) {
      const removedChunk = buffer.chunks.shift();
      if (removedChunk) {
        buffer.currentSize--;
        buffer.totalDuration -= 100;
      }
    }
  }

  private async processAudioData(chunk: AudioChunk): Promise<AudioChunk> {
    // Apply audio processing (denoising, gain control, etc.)
    const processedData = await this.audioProcessor.process(chunk.audioData, {
      enableDenoising: true,
      enableAGC: true,
      sampleRate: chunk.sampleRate || 16000,
      channels: chunk.channels || 1
    });

    return {
      ...chunk,
      audioData: processedData
    };
  }

  private async createProcessedAudio(
    originalChunk: AudioChunk,
    processedChunk: AudioChunk,
    vadResult: VoiceActivityResult,
    processingLatency: number
  ): Promise<ProcessedAudio> {
    const metadata: AudioMetadata = {
      sampleRate: originalChunk.sampleRate || 16000,
      channels: originalChunk.channels || 1,
      bitDepth: 16,
      format: originalChunk.format || AudioFormat.PCM,
      duration: 100, // Estimated 100ms chunk
      size: this.getChunkSize(originalChunk)
    };

    return {
      id: originalChunk.id,
      callId: originalChunk.callId,
      timestamp: originalChunk.timestamp,
      audioResponse: processedChunk.audioData,
      processingLatency,
      metadata
    };
  }

  private updateLatencyStats(callId: string, latency: number): void {
    const state = this.streams.get(callId);
    if (!state) return;

    state.processingLatency.push(latency);
    
    // Keep only last 100 measurements
    if (state.processingLatency.length > 100) {
      state.processingLatency.shift();
    }

    // Calculate average latency
    state.averageLatency = state.processingLatency.reduce((sum, l) => sum + l, 0) / state.processingLatency.length;
  }

  private getChunkSize(chunk: AudioChunk): number {
    if (Buffer.isBuffer(chunk.audioData)) {
      return chunk.audioData.length;
    } else if (typeof chunk.audioData === 'string') {
      return chunk.audioData.length;
    }
    return 0;
  }

  private async flushBuffer(callId: string): Promise<void> {
    const buffer = this.buffers.get(callId);
    if (!buffer || buffer.chunks.length === 0) return;

    logger.info(`Flushing ${buffer.chunks.length} buffered chunks for call ${callId}`);

    for (const chunk of buffer.chunks) {
      try {
        await this.processAudioChunk(chunk);
      } catch (error) {
        logger.error(`Error processing buffered chunk:`, error);
      }
    }

    buffer.chunks = [];
    buffer.currentSize = 0;
    buffer.totalDuration = 0;
  }
}

/**
 * Voice Activity Detector
 */
class VoiceActivityDetector {
  private energyThreshold: number = 0.01;
  private zeroCrossingThreshold: number = 0.1;

  async detect(chunk: AudioChunk): Promise<VoiceActivityResult> {
    try {
      const audioData = this.getAudioBuffer(chunk.audioData);
      
      // Calculate energy
      const energy = this.calculateEnergy(audioData);
      
      // Calculate zero crossing rate
      const zcr = this.calculateZeroCrossingRate(audioData);
      
      // Simple decision logic
      const isSpeech = energy > this.energyThreshold && zcr > this.zeroCrossingThreshold;
      const confidence = Math.min((energy / this.energyThreshold) * (zcr / this.zeroCrossingThreshold), 1.0);

      return {
        isSpeech,
        confidence,
        energy,
        startTime: chunk.timestamp,
        endTime: chunk.timestamp + 100 // Assume 100ms chunk
      };

    } catch (error) {
      logger.error('VAD processing error:', error);
      return {
        isSpeech: false,
        confidence: 0,
        energy: 0
      };
    }
  }

  private getAudioBuffer(audioData: Buffer | string): Float32Array {
    if (Buffer.isBuffer(audioData)) {
      // Convert 16-bit PCM to Float32
      const float32Array = new Float32Array(audioData.length / 2);
      for (let i = 0; i < float32Array.length; i++) {
        const int16 = audioData.readInt16LE(i * 2);
        float32Array[i] = int16 / 32768.0;
      }
      return float32Array;
    } else {
      // Handle base64 encoded data
      const buffer = Buffer.from(audioData, 'base64');
      return this.getAudioBuffer(buffer);
    }
  }

  private calculateEnergy(samples: Float32Array): number {
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      energy += samples[i] * samples[i];
    }
    return energy / samples.length;
  }

  private calculateZeroCrossingRate(samples: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / samples.length;
  }
}

/**
 * Audio Processor
 */
class AudioProcessor {
  async process(audioData: Buffer | string, options: any): Promise<Buffer | string> {
    // For now, return the data as-is
    // In a real implementation, this would apply:
    // - Noise reduction
    // - Automatic gain control
    // - Frequency filtering
    // - Echo cancellation
    return audioData;
  }
}

export default AudioStreamHandler;