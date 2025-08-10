import { EventEmitter } from 'events';
import { Transform, pipeline } from 'stream';
import { promisify } from 'util';
import logger from '../utils/logger';
import {
  AudioChunk,
  AudioFormat,
  VADConfig,
  VADResult,
  StreamProcessor,
  StreamPipeline,
  PipelineMetrics,
  SpeechServiceError,
  ErrorCode,
} from '../types';
import { config } from '../config';

const pipelineAsync = promisify(pipeline);

/**
 * Voice Activity Detection Processor
 */
export class VADProcessor implements StreamProcessor {
  private config: VADConfig;
  private buffer: Buffer;
  private energyHistory: number[];
  private speechStartTime?: number;
  private isSpeaking: boolean;

  constructor(vadConfig?: Partial<VADConfig>) {
    this.config = {
      energyThreshold: vadConfig?.energyThreshold || 0.01,
      silenceThreshold: vadConfig?.silenceThreshold || 0.005,
      minSpeechDuration: vadConfig?.minSpeechDuration || 200,
      maxSilenceDuration: vadConfig?.maxSilenceDuration || 1000,
      smoothingWindow: vadConfig?.smoothingWindow || 10,
    };
    this.buffer = Buffer.alloc(0);
    this.energyHistory = [];
    this.isSpeaking = false;
  }

  async processChunk(chunk: AudioChunk): Promise<void> {
    const energy = this.calculateEnergy(chunk.data);
    this.energyHistory.push(energy);

    if (this.energyHistory.length > this.config.smoothingWindow) {
      this.energyHistory.shift();
    }

    const smoothedEnergy = this.getSmoothedEnergy();
    const vadResult = this.detectSpeech(smoothedEnergy, chunk.timestamp);

    // Emit VAD result
    if (vadResult.speechStart !== undefined || vadResult.speechEnd !== undefined) {
      chunk.data = this.buffer;
      this.buffer = Buffer.alloc(0);
    } else if (vadResult.isSpeech) {
      this.buffer = Buffer.concat([this.buffer, chunk.data]);
    }
  }

  private calculateEnergy(audioData: Buffer): number {
    let sum = 0;
    const samples = audioData.length / 2; // 16-bit samples

    for (let i = 0; i < audioData.length; i += 2) {
      const sample = audioData.readInt16LE(i);
      sum += sample * sample;
    }

    return Math.sqrt(sum / samples) / 32768; // Normalize to 0-1
  }

  private getSmoothedEnergy(): number {
    if (this.energyHistory.length === 0) return 0;
    const sum = this.energyHistory.reduce((a, b) => a + b, 0);
    return sum / this.energyHistory.length;
  }

  private detectSpeech(energy: number, timestamp: number): VADResult {
    const isSpeech = energy > this.config.energyThreshold;
    const confidence = Math.min(energy / this.config.energyThreshold, 1);

    let speechStart: number | undefined;
    let speechEnd: number | undefined;

    if (isSpeech && !this.isSpeaking) {
      this.speechStartTime = timestamp;
      this.isSpeaking = true;
      speechStart = timestamp;
    } else if (!isSpeech && this.isSpeaking) {
      if (this.speechStartTime && 
          timestamp - this.speechStartTime > this.config.minSpeechDuration) {
        this.isSpeaking = false;
        speechEnd = timestamp;
      }
    }

    return {
      isSpeech,
      confidence,
      energyLevel: energy,
      timestamp,
      speechStart,
      speechEnd,
    };
  }

  async getResults(): Promise<VADResult[]> {
    return [];
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.energyHistory = [];
    this.speechStartTime = undefined;
    this.isSpeaking = false;
  }

  destroy(): void {
    this.reset();
  }
}

/**
 * Audio Format Converter Processor
 */
export class AudioFormatConverter implements StreamProcessor {
  private targetFormat: AudioFormat;
  private buffer: Buffer;

  constructor(targetFormat: AudioFormat) {
    this.targetFormat = targetFormat;
    this.buffer = Buffer.alloc(0);
  }

  async processChunk(chunk: AudioChunk): Promise<void> {
    // Convert audio format if needed
    if (chunk.format && !this.isFormatMatch(chunk.format)) {
      chunk.data = await this.convertFormat(chunk.data, chunk.format);
      chunk.format = this.targetFormat;
    }
  }

  private isFormatMatch(format: AudioFormat): boolean {
    return (
      format.sampleRate === this.targetFormat.sampleRate &&
      format.channels === this.targetFormat.channels &&
      format.bitDepth === this.targetFormat.bitDepth &&
      format.codec === this.targetFormat.codec
    );
  }

  private async convertFormat(data: Buffer, sourceFormat: AudioFormat): Promise<Buffer> {
    // Simple PCM resampling (for demonstration)
    // In production, use proper audio processing library
    if (sourceFormat.sampleRate !== this.targetFormat.sampleRate) {
      return this.resamplePCM(
        data,
        sourceFormat.sampleRate,
        this.targetFormat.sampleRate
      );
    }
    return data;
  }

  private resamplePCM(data: Buffer, sourceSR: number, targetSR: number): Buffer {
    const ratio = targetSR / sourceSR;
    const targetLength = Math.floor(data.length * ratio);
    const result = Buffer.allocUnsafe(targetLength);

    for (let i = 0; i < targetLength; i += 2) {
      const sourceIndex = Math.floor(i / ratio);
      if (sourceIndex + 1 < data.length) {
        result.writeInt16LE(data.readInt16LE(sourceIndex), i);
      }
    }

    return result;
  }

  async getResults(): Promise<any> {
    return null;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  destroy(): void {
    this.reset();
  }
}

/**
 * Echo Cancellation Processor
 */
export class EchoCancellationProcessor implements StreamProcessor {
  private referenceBuffer: Buffer[];
  private maxBufferSize: number;

  constructor() {
    this.referenceBuffer = [];
    this.maxBufferSize = 10;
  }

  async processChunk(chunk: AudioChunk): Promise<void> {
    // Simple echo cancellation (for demonstration)
    // In production, use advanced DSP algorithms
    if (this.referenceBuffer.length > 0) {
      chunk.data = this.cancelEcho(chunk.data);
    }

    // Update reference buffer
    this.referenceBuffer.push(Buffer.from(chunk.data));
    if (this.referenceBuffer.length > this.maxBufferSize) {
      this.referenceBuffer.shift();
    }
  }

  private cancelEcho(data: Buffer): Buffer {
    const result = Buffer.allocUnsafe(data.length);
    
    for (let i = 0; i < data.length; i += 2) {
      let sample = data.readInt16LE(i);
      
      // Apply simple echo suppression
      for (const ref of this.referenceBuffer) {
        if (i < ref.length) {
          const refSample = ref.readInt16LE(i);
          sample = Math.round(sample - refSample * 0.1); // 10% echo suppression
        }
      }
      
      // Clamp to valid range
      sample = Math.max(-32768, Math.min(32767, sample));
      result.writeInt16LE(sample, i);
    }

    return result;
  }

  async getResults(): Promise<any> {
    return null;
  }

  reset(): void {
    this.referenceBuffer = [];
  }

  destroy(): void {
    this.reset();
  }
}

/**
 * Noise Reduction Processor
 */
export class NoiseReductionProcessor implements StreamProcessor {
  private noiseProfile: number[];
  private frameSize: number;

  constructor() {
    this.noiseProfile = [];
    this.frameSize = 512;
  }

  async processChunk(chunk: AudioChunk): Promise<void> {
    chunk.data = this.reduceNoise(chunk.data);
  }

  private reduceNoise(data: Buffer): Buffer {
    const result = Buffer.allocUnsafe(data.length);
    
    // Simple spectral subtraction (for demonstration)
    for (let i = 0; i < data.length; i += 2) {
      const sample = data.readInt16LE(i);
      
      // Apply simple high-pass filter to reduce low-frequency noise
      const filtered = this.highPassFilter(sample);
      
      result.writeInt16LE(filtered, i);
    }

    return result;
  }

  private highPassFilter(sample: number): number {
    // Simple first-order high-pass filter
    const cutoffFrequency = 100; // Hz
    const sampleRate = config.audio.sampleRate;
    const rc = 1.0 / (2.0 * Math.PI * cutoffFrequency);
    const dt = 1.0 / sampleRate;
    const alpha = rc / (rc + dt);
    
    // Apply filter (simplified)
    return Math.round(sample * alpha);
  }

  async getResults(): Promise<any> {
    return null;
  }

  reset(): void {
    this.noiseProfile = [];
  }

  destroy(): void {
    this.reset();
  }
}

/**
 * Main Audio Processing Pipeline
 */
export class AudioProcessingPipeline extends EventEmitter implements StreamPipeline {
  private processors: StreamProcessor[];
  private metrics: PipelineMetrics;
  private isProcessing: boolean;

  constructor() {
    super();
    this.processors = [];
    this.metrics = {
      totalChunks: 0,
      processedChunks: 0,
      failedChunks: 0,
      averageLatency: 0,
      throughput: 0,
    };
    this.isProcessing = false;
  }

  addProcessor(processor: StreamProcessor): void {
    this.processors.push(processor);
    logger.info(`Added processor to pipeline: ${processor.constructor.name}`);
  }

  removeProcessor(processor: StreamProcessor): void {
    const index = this.processors.indexOf(processor);
    if (index > -1) {
      this.processors.splice(index, 1);
      logger.info(`Removed processor from pipeline: ${processor.constructor.name}`);
    }
  }

  async process(chunk: AudioChunk): Promise<void> {
    if (this.isProcessing) {
      throw new SpeechServiceError(
        'Pipeline is already processing',
        ErrorCode.RESOURCE_EXHAUSTED,
        429
      );
    }

    this.isProcessing = true;
    const startTime = Date.now();
    this.metrics.totalChunks++;

    try {
      // Process through all processors in sequence
      for (const processor of this.processors) {
        await processor.processChunk(chunk);
      }

      this.metrics.processedChunks++;
      this.updateMetrics(Date.now() - startTime);
      
      this.emit('chunk_processed', {
        callId: chunk.callId,
        timestamp: chunk.timestamp,
        latency: Date.now() - startTime,
      });
    } catch (error) {
      this.metrics.failedChunks++;
      logger.error('Pipeline processing error:', error);
      
      this.emit('processing_error', {
        callId: chunk.callId,
        error,
      });
      
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private updateMetrics(latency: number): void {
    // Update average latency (exponential moving average)
    const alpha = 0.1;
    this.metrics.averageLatency = 
      alpha * latency + (1 - alpha) * this.metrics.averageLatency;

    // Update throughput (chunks per second)
    this.metrics.throughput = 
      this.metrics.processedChunks / (Date.now() / 1000);
  }

  getMetrics(): PipelineMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    for (const processor of this.processors) {
      processor.reset();
    }
    
    this.metrics = {
      totalChunks: 0,
      processedChunks: 0,
      failedChunks: 0,
      averageLatency: 0,
      throughput: 0,
    };
  }

  destroy(): void {
    for (const processor of this.processors) {
      processor.destroy();
    }
    this.processors = [];
    this.reset();
  }
}

/**
 * Create default audio processing pipeline
 */
export function createDefaultPipeline(): AudioProcessingPipeline {
  const pipeline = new AudioProcessingPipeline();

  // Add processors in order
  pipeline.addProcessor(new NoiseReductionProcessor());
  pipeline.addProcessor(new EchoCancellationProcessor());
  pipeline.addProcessor(new VADProcessor());
  pipeline.addProcessor(new AudioFormatConverter({
    sampleRate: config.audio.sampleRate,
    channels: config.audio.channels,
    bitDepth: config.audio.bitDepth,
    codec: 'pcm',
  }));

  return pipeline;
}

export default AudioProcessingPipeline;