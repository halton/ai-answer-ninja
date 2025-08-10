import { EventEmitter } from 'eventemitter3';
import { 
  AudioChunk, 
  AudioMetadata, 
  AudioFormat, 
  VoiceActivityResult,
  AudioProcessingError 
} from '../types';
import { MetricsService } from './metrics';
import logger from '../utils/logger';

export interface AudioProcessingConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  chunkSize: number;
  enableNoiseReduction: boolean;
  enableEchoCancellation: boolean;
  enableAGC: boolean; // Automatic Gain Control
  enableVAD: boolean; // Voice Activity Detection
  adaptiveBitrate: boolean;
  qualityThreshold: number;
  latencyTarget: number; // milliseconds
}

export interface NoiseReductionConfig {
  enabled: boolean;
  aggressiveness: number; // 0-3
  adaptiveThreshold: boolean;
  spectralSubtraction: boolean;
  wienerFiltering: boolean;
}

export interface EchoCancellationConfig {
  enabled: boolean;
  tailLength: number; // milliseconds
  adaptiveFilter: boolean;
  suppressionLevel: number; // dB
  doubleClickSuppression: boolean;
}

export interface AdaptiveBitrateConfig {
  enabled: boolean;
  minBitrate: number;
  maxBitrate: number;
  stepSize: number;
  qualityThreshold: number;
  networkLatencyThreshold: number;
}

export interface AudioQualityMetrics {
  snr: number; // Signal-to-Noise Ratio
  thd: number; // Total Harmonic Distortion
  dynamicRange: number;
  bitrate: number;
  packetLoss: number;
  jitter: number;
  latency: number;
}

export interface ProcessedAudioResult {
  audioData: Buffer;
  metadata: AudioMetadata;
  quality: AudioQualityMetrics;
  processingLatency: number;
  vadResult?: VoiceActivityResult;
  compressionRatio?: number;
}

/**
 * Advanced Audio Processing Pipeline
 * Handles noise reduction, echo cancellation, adaptive bitrate, and quality optimization
 */
export class AdvancedAudioProcessor extends EventEmitter {
  private config: AudioProcessingConfig;
  private metrics: MetricsService;
  
  // Audio processing components
  private noiseReducer: NoiseReducer;
  private echoCanceller: EchoCanceller;
  private automaticGainControl: AutomaticGainControl;
  private voiceActivityDetector: VoiceActivityDetector;
  private adaptiveBitrateController: AdaptiveBitrateController;
  private audioQualityAnalyzer: AudioQualityAnalyzer;
  
  // Processing state
  private processingHistory: Map<string, ProcessedAudioResult[]> = new Map();
  private qualityMetrics: Map<string, AudioQualityMetrics[]> = new Map();
  
  constructor(config: Partial<AudioProcessingConfig>, metrics: MetricsService) {
    super();
    
    this.config = {
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
      latencyTarget: 100,
      ...config,
    };
    
    this.metrics = metrics;
    
    // Initialize processing components
    this.initializeComponents();
  }

  private initializeComponents(): void {
    // Initialize noise reduction
    this.noiseReducer = new NoiseReducer({
      enabled: this.config.enableNoiseReduction,
      aggressiveness: 2,
      adaptiveThreshold: true,
      spectralSubtraction: true,
      wienerFiltering: true,
    });

    // Initialize echo cancellation
    this.echoCanceller = new EchoCanceller({
      enabled: this.config.enableEchoCancellation,
      tailLength: 200, // 200ms tail
      adaptiveFilter: true,
      suppressionLevel: 20, // 20dB suppression
      doubleClickSuppression: true,
    });

    // Initialize AGC
    this.automaticGainControl = new AutomaticGainControl({
      enabled: this.config.enableAGC,
      targetLevel: -16, // dBFS
      maxGain: 30, // dB
      compressionRatio: 3.0,
      attackTime: 5, // ms
      releaseTime: 50, // ms
    });

    // Initialize VAD
    this.voiceActivityDetector = new VoiceActivityDetector({
      enabled: this.config.enableVAD,
      energyThreshold: 0.01,
      spectralCentroidThreshold: 1000,
      zeroCrossingRateThreshold: 0.1,
      hangoverTime: 200, // ms
    });

    // Initialize adaptive bitrate controller
    this.adaptiveBitrateController = new AdaptiveBitrateController({
      enabled: this.config.adaptiveBitrate,
      minBitrate: 8000,
      maxBitrate: 64000,
      stepSize: 4000,
      qualityThreshold: this.config.qualityThreshold,
      networkLatencyThreshold: 150,
    });

    // Initialize quality analyzer
    this.audioQualityAnalyzer = new AudioQualityAnalyzer({
      sampleRate: this.config.sampleRate,
      analysisWindowSize: 2048,
      enableRealTimeAnalysis: true,
    });
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing advanced audio processor');

    // Initialize all components
    await Promise.all([
      this.noiseReducer.initialize(),
      this.echoCanceller.initialize(),
      this.automaticGainControl.initialize(),
      this.voiceActivityDetector.initialize(),
      this.adaptiveBitrateController.initialize(),
      this.audioQualityAnalyzer.initialize(),
    ]);

    logger.info('Advanced audio processor initialized successfully');
  }

  public async processAudio(audioChunk: AudioChunk, callId?: string): Promise<ProcessedAudioResult> {
    const startTime = Date.now();
    const processingSteps: string[] = [];

    try {
      let audioData = this.validateAndConvertAudioData(audioChunk.audioData);
      let metadata: AudioMetadata = {
        sampleRate: audioChunk.sampleRate || this.config.sampleRate,
        channels: audioChunk.channels || this.config.channels,
        bitDepth: this.config.bitDepth,
        format: audioChunk.format || AudioFormat.PCM,
        duration: audioData.length / (this.config.sampleRate * this.config.channels * (this.config.bitDepth / 8)),
        size: audioData.length,
      };

      // Step 1: Voice Activity Detection (early exit if no speech)
      let vadResult: VoiceActivityResult | undefined;
      if (this.config.enableVAD) {
        processingSteps.push('VAD');
        vadResult = await this.voiceActivityDetector.detect(audioData, metadata);
        
        if (!vadResult.isSpeech) {
          logger.debug({ callId: audioChunk.callId }, 'No speech detected, skipping audio processing');
          return {
            audioData,
            metadata,
            quality: this.getDefaultQualityMetrics(),
            processingLatency: Date.now() - startTime,
            vadResult,
          };
        }
      }

      // Step 2: Noise Reduction
      if (this.config.enableNoiseReduction) {
        processingSteps.push('NoiseReduction');
        audioData = await this.noiseReducer.process(audioData, metadata);
      }

      // Step 3: Echo Cancellation
      if (this.config.enableEchoCancellation) {
        processingSteps.push('EchoCancellation');
        audioData = await this.echoCanceller.process(audioData, metadata);
      }

      // Step 4: Automatic Gain Control
      if (this.config.enableAGC) {
        processingSteps.push('AGC');
        audioData = await this.automaticGainControl.process(audioData, metadata);
      }

      // Step 5: Quality Analysis
      processingSteps.push('QualityAnalysis');
      const quality = await this.audioQualityAnalyzer.analyze(audioData, metadata);

      // Step 6: Adaptive Bitrate Control
      let compressionRatio = 1.0;
      if (this.config.adaptiveBitrate) {
        processingSteps.push('AdaptiveBitrate');
        const bitrateAdjustment = await this.adaptiveBitrateController.adjustBitrate(
          quality,
          metadata,
          callId
        );
        
        if (bitrateAdjustment.shouldCompress) {
          const compressionResult = await this.compressAudio(audioData, metadata, bitrateAdjustment.targetBitrate);
          audioData = compressionResult.data;
          metadata = compressionResult.metadata;
          compressionRatio = compressionResult.ratio;
        }
      }

      const processingLatency = Date.now() - startTime;

      const result: ProcessedAudioResult = {
        audioData,
        metadata,
        quality,
        processingLatency,
        vadResult,
        compressionRatio,
      };

      // Store processing history for adaptive optimization
      if (callId) {
        this.updateProcessingHistory(callId, result);
      }

      // Record metrics
      this.recordProcessingMetrics(processingSteps, processingLatency, quality);

      // Emit processing events
      this.emit('audioProcessed', {
        callId: audioChunk.callId,
        processingLatency,
        quality,
        steps: processingSteps,
      });

      return result;

    } catch (error) {
      logger.error({ 
        error, 
        callId: audioChunk.callId,
        processingSteps,
      }, 'Audio processing failed');
      
      throw new AudioProcessingError(`Advanced audio processing failed: ${error.message}`);
    }
  }

  private validateAndConvertAudioData(audioData: Buffer | string): Buffer {
    if (typeof audioData === 'string') {
      // Assume base64 encoded
      return Buffer.from(audioData, 'base64');
    }
    
    if (!Buffer.isBuffer(audioData)) {
      throw new AudioProcessingError('Invalid audio data format');
    }
    
    return audioData;
  }

  private async compressAudio(
    audioData: Buffer, 
    metadata: AudioMetadata, 
    targetBitrate: number
  ): Promise<{ data: Buffer; metadata: AudioMetadata; ratio: number }> {
    // Simplified audio compression (in production, use proper codecs like Opus)
    const originalSize = audioData.length;
    const compressionFactor = Math.min(1.0, targetBitrate / (metadata.sampleRate * metadata.channels * metadata.bitDepth));
    
    // Simple downsampling for demonstration
    if (compressionFactor < 1.0) {
      const step = Math.round(1 / compressionFactor);
      const compressedData = Buffer.alloc(Math.floor(originalSize / step));
      
      for (let i = 0, j = 0; i < originalSize; i += step, j++) {
        if (j < compressedData.length) {
          compressedData[j] = audioData[i];
        }
      }
      
      const newMetadata: AudioMetadata = {
        ...metadata,
        size: compressedData.length,
        duration: metadata.duration, // Duration stays the same
      };
      
      return {
        data: compressedData,
        metadata: newMetadata,
        ratio: originalSize / compressedData.length,
      };
    }
    
    return {
      data: audioData,
      metadata,
      ratio: 1.0,
    };
  }

  private updateProcessingHistory(callId: string, result: ProcessedAudioResult): void {
    if (!this.processingHistory.has(callId)) {
      this.processingHistory.set(callId, []);
    }
    
    const history = this.processingHistory.get(callId)!;
    history.push(result);
    
    // Keep only recent history (last 50 chunks)
    if (history.length > 50) {
      history.shift();
    }
    
    // Update quality metrics
    if (!this.qualityMetrics.has(callId)) {
      this.qualityMetrics.set(callId, []);
    }
    
    const qualityHistory = this.qualityMetrics.get(callId)!;
    qualityHistory.push(result.quality);
    
    if (qualityHistory.length > 100) {
      qualityHistory.shift();
    }
  }

  private recordProcessingMetrics(steps: string[], latency: number, quality: AudioQualityMetrics): void {
    // Record overall processing metrics
    this.metrics.recordHistogram('audio_processing_duration_ms', latency);
    this.metrics.recordHistogram('audio_quality_snr_db', quality.snr);
    this.metrics.recordHistogram('audio_processing_steps_count', steps.length);
    
    // Record step-specific metrics
    steps.forEach(step => {
      this.metrics.incrementCounter(`audio_processing_steps_${step.toLowerCase()}_total`);
    });
    
    // Record quality metrics
    this.metrics.setGauge('audio_quality_current_snr', quality.snr);
    this.metrics.setGauge('audio_quality_current_bitrate', quality.bitrate);
    this.metrics.setGauge('audio_processing_current_latency', latency);
  }

  private getDefaultQualityMetrics(): AudioQualityMetrics {
    return {
      snr: 0,
      thd: 0,
      dynamicRange: 0,
      bitrate: 0,
      packetLoss: 0,
      jitter: 0,
      latency: 0,
    };
  }

  public getProcessingStats(callId: string): any {
    const history = this.processingHistory.get(callId) || [];
    const qualityHistory = this.qualityMetrics.get(callId) || [];
    
    if (history.length === 0) {
      return null;
    }
    
    const avgLatency = history.reduce((sum, h) => sum + h.processingLatency, 0) / history.length;
    const avgQuality = qualityHistory.reduce((sum, q) => sum + q.snr, 0) / qualityHistory.length;
    const avgCompressionRatio = history
      .filter(h => h.compressionRatio)
      .reduce((sum, h) => sum + (h.compressionRatio || 1), 0) / 
      Math.max(1, history.filter(h => h.compressionRatio).length);
    
    return {
      callId,
      totalChunks: history.length,
      averageProcessingLatency: avgLatency,
      averageQualityScore: avgQuality,
      averageCompressionRatio: avgCompressionRatio,
      recentQuality: qualityHistory.slice(-10),
      recentLatencies: history.slice(-10).map(h => h.processingLatency),
    };
  }

  public async optimizeForCall(callId: string): Promise<void> {
    const stats = this.getProcessingStats(callId);
    if (!stats) return;
    
    // Adaptive optimization based on call statistics
    if (stats.averageProcessingLatency > this.config.latencyTarget) {
      logger.info({
        callId,
        currentLatency: stats.averageProcessingLatency,
        target: this.config.latencyTarget,
      }, 'Optimizing audio processing for latency');
      
      // Reduce processing complexity
      await this.reduceProcessingComplexity();
    }
    
    if (stats.averageQualityScore < this.config.qualityThreshold) {
      logger.info({
        callId,
        currentQuality: stats.averageQualityScore,
        threshold: this.config.qualityThreshold,
      }, 'Optimizing audio processing for quality');
      
      // Increase processing quality
      await this.increaseProcessingQuality();
    }
  }

  private async reduceProcessingComplexity(): Promise<void> {
    // Reduce noise reduction aggressiveness
    await this.noiseReducer.updateConfig({
      aggressiveness: Math.max(0, this.noiseReducer.getConfig().aggressiveness - 1),
    });
    
    // Simplify echo cancellation
    await this.echoCanceller.updateConfig({
      tailLength: Math.max(50, this.echoCanceller.getConfig().tailLength - 50),
    });
  }

  private async increaseProcessingQuality(): Promise<void> {
    // Increase noise reduction aggressiveness
    await this.noiseReducer.updateConfig({
      aggressiveness: Math.min(3, this.noiseReducer.getConfig().aggressiveness + 1),
    });
    
    // Improve echo cancellation
    await this.echoCanceller.updateConfig({
      tailLength: Math.min(300, this.echoCanceller.getConfig().tailLength + 50),
    });
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down advanced audio processor');
    
    // Shutdown all components
    await Promise.allSettled([
      this.noiseReducer.shutdown(),
      this.echoCanceller.shutdown(),
      this.automaticGainControl.shutdown(),
      this.voiceActivityDetector.shutdown(),
      this.adaptiveBitrateController.shutdown(),
      this.audioQualityAnalyzer.shutdown(),
    ]);
    
    // Clear processing history
    this.processingHistory.clear();
    this.qualityMetrics.clear();
    
    this.removeAllListeners();
    
    logger.info('Advanced audio processor shutdown complete');
  }
}

// Specialized audio processing components

class NoiseReducer {
  private config: NoiseReductionConfig;
  
  constructor(config: NoiseReductionConfig) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize noise reduction algorithms
  }
  
  async process(audioData: Buffer, metadata: AudioMetadata): Promise<Buffer> {
    if (!this.config.enabled) return audioData;
    
    // Implement spectral subtraction and Wiener filtering
    // This is a simplified implementation - in production, use proper DSP libraries
    return this.spectralSubtraction(audioData, metadata);
  }
  
  private spectralSubtraction(audioData: Buffer, metadata: AudioMetadata): Buffer {
    // Simplified spectral subtraction algorithm
    return audioData; // Placeholder
  }
  
  getConfig(): NoiseReductionConfig {
    return { ...this.config };
  }
  
  async updateConfig(updates: Partial<NoiseReductionConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
  }
  
  async shutdown(): Promise<void> {
    // Cleanup resources
  }
}

class EchoCanceller {
  private config: EchoCancellationConfig;
  
  constructor(config: EchoCancellationConfig) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize adaptive filter
  }
  
  async process(audioData: Buffer, metadata: AudioMetadata): Promise<Buffer> {
    if (!this.config.enabled) return audioData;
    
    // Implement adaptive echo cancellation
    return this.adaptiveFilter(audioData, metadata);
  }
  
  private adaptiveFilter(audioData: Buffer, metadata: AudioMetadata): Buffer {
    // Simplified AEC implementation
    return audioData; // Placeholder
  }
  
  getConfig(): EchoCancellationConfig {
    return { ...this.config };
  }
  
  async updateConfig(updates: Partial<EchoCancellationConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
  }
  
  async shutdown(): Promise<void> {
    // Cleanup resources
  }
}

class AutomaticGainControl {
  private config: any;
  
  constructor(config: any) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize AGC
  }
  
  async process(audioData: Buffer, metadata: AudioMetadata): Promise<Buffer> {
    if (!this.config.enabled) return audioData;
    
    // Implement AGC algorithm
    return this.applyGainControl(audioData, metadata);
  }
  
  private applyGainControl(audioData: Buffer, metadata: AudioMetadata): Buffer {
    // Simplified AGC implementation
    return audioData; // Placeholder
  }
  
  async shutdown(): Promise<void> {
    // Cleanup resources
  }
}

class VoiceActivityDetector {
  private config: any;
  
  constructor(config: any) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize VAD
  }
  
  async detect(audioData: Buffer, metadata: AudioMetadata): Promise<VoiceActivityResult> {
    if (!this.config.enabled) {
      return {
        isSpeech: true,
        confidence: 1.0,
        energy: 0.5,
      };
    }
    
    // Implement VAD algorithm using energy, spectral features, etc.
    const energy = this.calculateEnergy(audioData);
    const isSpeech = energy > this.config.energyThreshold;
    
    return {
      isSpeech,
      confidence: isSpeech ? Math.min(energy / this.config.energyThreshold, 1.0) : 0.1,
      energy,
    };
  }
  
  private calculateEnergy(audioData: Buffer): number {
    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < audioData.length; i += 2) {
      const sample = audioData.readInt16LE(i) / 32768;
      sum += sample * sample;
    }
    return Math.sqrt(sum / (audioData.length / 2));
  }
  
  async shutdown(): Promise<void> {
    // Cleanup resources
  }
}

class AdaptiveBitrateController {
  private config: AdaptiveBitrateConfig;
  private qualityHistory: Map<string, number[]> = new Map();
  
  constructor(config: AdaptiveBitrateConfig) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize adaptive bitrate control
  }
  
  async adjustBitrate(
    quality: AudioQualityMetrics, 
    metadata: AudioMetadata, 
    callId?: string
  ): Promise<{ shouldCompress: boolean; targetBitrate: number }> {
    if (!this.config.enabled || !callId) {
      return { shouldCompress: false, targetBitrate: metadata.sampleRate * metadata.channels * 16 };
    }
    
    // Track quality history
    if (!this.qualityHistory.has(callId)) {
      this.qualityHistory.set(callId, []);
    }
    
    const history = this.qualityHistory.get(callId)!;
    history.push(quality.snr);
    
    if (history.length > 10) {
      history.shift();
    }
    
    // Calculate average quality
    const avgQuality = history.reduce((a, b) => a + b, 0) / history.length;
    
    // Determine target bitrate based on quality and network conditions
    let targetBitrate = metadata.sampleRate * metadata.channels * 16; // Default PCM bitrate
    
    if (avgQuality < this.config.qualityThreshold || quality.latency > this.config.networkLatencyThreshold) {
      // Reduce bitrate for poor quality/high latency
      targetBitrate = Math.max(this.config.minBitrate, targetBitrate - this.config.stepSize);
    } else if (avgQuality > this.config.qualityThreshold + 0.2) {
      // Increase bitrate for good quality
      targetBitrate = Math.min(this.config.maxBitrate, targetBitrate + this.config.stepSize);
    }
    
    const currentBitrate = metadata.sampleRate * metadata.channels * 16;
    const shouldCompress = targetBitrate < currentBitrate;
    
    return { shouldCompress, targetBitrate };
  }
  
  async shutdown(): Promise<void> {
    this.qualityHistory.clear();
  }
}

class AudioQualityAnalyzer {
  private config: any;
  
  constructor(config: any) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize quality analysis
  }
  
  async analyze(audioData: Buffer, metadata: AudioMetadata): Promise<AudioQualityMetrics> {
    // Implement audio quality analysis
    const snr = this.calculateSNR(audioData);
    const thd = this.calculateTHD(audioData);
    const dynamicRange = this.calculateDynamicRange(audioData);
    
    return {
      snr,
      thd,
      dynamicRange,
      bitrate: metadata.sampleRate * metadata.channels * 16, // Assume 16-bit
      packetLoss: 0, // Should be provided from network layer
      jitter: 0, // Should be provided from network layer
      latency: 0, // Should be provided from network layer
    };
  }
  
  private calculateSNR(audioData: Buffer): number {
    // Simplified SNR calculation
    const energy = this.calculateEnergy(audioData);
    const noise = this.estimateNoiseLevel(audioData);
    return 20 * Math.log10(energy / Math.max(noise, 0.001));
  }
  
  private calculateTHD(audioData: Buffer): number {
    // Simplified THD calculation
    return 0.01; // Placeholder
  }
  
  private calculateDynamicRange(audioData: Buffer): number {
    // Calculate dynamic range
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    
    for (let i = 0; i < audioData.length; i += 2) {
      const sample = audioData.readInt16LE(i);
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    
    return 20 * Math.log10((max - min) / 65536);
  }
  
  private calculateEnergy(audioData: Buffer): number {
    let sum = 0;
    for (let i = 0; i < audioData.length; i += 2) {
      const sample = audioData.readInt16LE(i) / 32768;
      sum += sample * sample;
    }
    return Math.sqrt(sum / (audioData.length / 2));
  }
  
  private estimateNoiseLevel(audioData: Buffer): number {
    // Simplified noise level estimation
    return 0.01; // Placeholder
  }
  
  async shutdown(): Promise<void> {
    // Cleanup resources
  }
}

export default AdvancedAudioProcessor;