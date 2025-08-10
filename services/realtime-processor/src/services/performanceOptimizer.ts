import { EventEmitter } from 'eventemitter3';
import { LRUCache } from 'lru-cache';
import { 
  AudioChunk, 
  ProcessedAudio, 
  LatencyMetrics, 
  PerformanceMetrics,
  AudioFormat 
} from '../types';
import { MetricsService } from './metrics';
import { RedisService } from './redis';
import logger from '../utils/logger';

export interface PerformanceConfig {
  bufferSize: number;
  maxLatency: number;
  adaptiveEncoding: boolean;
  cacheEnabled: boolean;
  cacheSize: number;
  cacheTTL: number;
  compressionEnabled: boolean;
  compressionThreshold: number;
  latencyTargets: LatencyTargets;
  qualityLevels: QualityLevel[];
}

export interface LatencyTargets {
  excellent: number;  // < 100ms
  good: number;       // < 200ms
  acceptable: number; // < 500ms
  poor: number;       // > 500ms
}

export interface QualityLevel {
  name: string;
  sampleRate: number;
  bitrate: number;
  latencyTarget: number;
  enabledFeatures: string[];
}

export interface BufferMetrics {
  size: number;
  utilization: number;
  overruns: number;
  underruns: number;
  averageLatency: number;
  jitter: number;
}

export interface AdaptiveEncodingConfig {
  enabled: boolean;
  currentLevel: number;
  targetLatency: number;
  qualityThreshold: number;
  adaptationRate: number;
}

export interface CacheStatistics {
  hitRate: number;
  missRate: number;
  evictionRate: number;
  totalRequests: number;
  totalHits: number;
  totalMisses: number;
  cacheSize: number;
  maxSize: number;
}

/**
 * Performance Optimization Engine
 * Handles buffer management, adaptive encoding, caching, and latency monitoring
 */
export class PerformanceOptimizer extends EventEmitter {
  private config: PerformanceConfig;
  private metrics: MetricsService;
  private redis: RedisService;

  // Buffer management
  private audioBuffers: Map<string, AudioBufferManager> = new Map();
  private globalBuffer: CircularBuffer<AudioChunk>;

  // Caching system
  private responseCache: LRUCache<string, ProcessedAudio>;
  private transcriptCache: LRUCache<string, string>;
  private intentCache: LRUCache<string, any>;

  // Adaptive encoding
  private encodingConfigs: Map<string, AdaptiveEncodingConfig> = new Map();
  private qualityMonitor: QualityMonitor;

  // Latency monitoring
  private latencyTracker: LatencyTracker;
  private performanceProfiler: PerformanceProfiler;

  // Compression
  private compressionEngine: CompressionEngine;

  constructor(
    config: Partial<PerformanceConfig>,
    metrics: MetricsService,
    redis: RedisService
  ) {
    super();

    this.config = {
      bufferSize: 8192,
      maxLatency: 500,
      adaptiveEncoding: true,
      cacheEnabled: true,
      cacheSize: 1000,
      cacheTTL: 300, // 5 minutes
      compressionEnabled: true,
      compressionThreshold: 1024, // 1KB
      latencyTargets: {
        excellent: 100,
        good: 200,
        acceptable: 500,
        poor: 1000,
      },
      qualityLevels: [
        {
          name: 'ultra',
          sampleRate: 48000,
          bitrate: 64000,
          latencyTarget: 50,
          enabledFeatures: ['noise_reduction', 'echo_cancellation', 'agc', 'vad'],
        },
        {
          name: 'high',
          sampleRate: 32000,
          bitrate: 32000,
          latencyTarget: 100,
          enabledFeatures: ['noise_reduction', 'echo_cancellation', 'vad'],
        },
        {
          name: 'medium',
          sampleRate: 16000,
          bitrate: 16000,
          latencyTarget: 200,
          enabledFeatures: ['noise_reduction', 'vad'],
        },
        {
          name: 'low',
          sampleRate: 8000,
          bitrate: 8000,
          latencyTarget: 300,
          enabledFeatures: ['vad'],
        },
      ],
      ...config,
    };

    this.metrics = metrics;
    this.redis = redis;

    this.initializeComponents();
  }

  private initializeComponents(): void {
    // Initialize global buffer
    this.globalBuffer = new CircularBuffer<AudioChunk>(this.config.bufferSize);

    // Initialize caches
    this.responseCache = new LRUCache<string, ProcessedAudio>({
      max: this.config.cacheSize,
      ttl: this.config.cacheTTL * 1000,
    });

    this.transcriptCache = new LRUCache<string, string>({
      max: this.config.cacheSize * 2,
      ttl: this.config.cacheTTL * 1000,
    });

    this.intentCache = new LRUCache<string, any>({
      max: this.config.cacheSize,
      ttl: this.config.cacheTTL * 1000,
    });

    // Initialize quality monitor
    this.qualityMonitor = new QualityMonitor(this.config.latencyTargets);

    // Initialize latency tracker
    this.latencyTracker = new LatencyTracker();

    // Initialize performance profiler
    this.performanceProfiler = new PerformanceProfiler();

    // Initialize compression engine
    this.compressionEngine = new CompressionEngine({
      enabled: this.config.compressionEnabled,
      threshold: this.config.compressionThreshold,
    });
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing performance optimizer');

    // Start background monitoring
    this.startPerformanceMonitoring();
    this.startAdaptiveOptimization();
    this.startCacheStatistics();

    logger.info('Performance optimizer initialized successfully');
  }

  /**
   * Optimized audio chunk processing with buffering and caching
   */
  public async processAudioChunk(
    audioChunk: AudioChunk,
    callId: string,
    processingFunction: (chunk: AudioChunk) => Promise<ProcessedAudio>
  ): Promise<ProcessedAudio> {
    const startTime = Date.now();

    try {
      // Get or create buffer manager for this call
      let bufferManager = this.audioBuffers.get(callId);
      if (!bufferManager) {
        bufferManager = new AudioBufferManager(callId, this.config.bufferSize);
        this.audioBuffers.set(callId, bufferManager);
      }

      // Add to buffer
      bufferManager.addChunk(audioChunk);

      // Check cache first
      const cacheKey = this.generateCacheKey(audioChunk);
      if (this.config.cacheEnabled) {
        const cachedResult = this.responseCache.get(cacheKey);
        if (cachedResult) {
          this.recordCacheHit('response');
          this.recordLatency(Date.now() - startTime, 'cache_hit');
          return cachedResult;
        }
      }

      // Adaptive quality adjustment
      const optimizedChunk = await this.optimizeAudioChunk(audioChunk, callId);

      // Process with buffering strategy
      const result = await this.processWithBuffering(
        optimizedChunk,
        bufferManager,
        processingFunction
      );

      // Cache the result
      if (this.config.cacheEnabled && this.shouldCache(result)) {
        this.responseCache.set(cacheKey, result);
        this.recordCacheMiss('response');
      }

      // Record performance metrics
      const processingTime = Date.now() - startTime;
      this.recordLatency(processingTime, 'total_processing');
      this.updatePerformanceProfile(callId, processingTime, result);

      // Trigger adaptive optimization if needed
      if (processingTime > this.config.maxLatency) {
        await this.triggerAdaptiveOptimization(callId, processingTime);
      }

      return result;

    } catch (error) {
      logger.error({ error, callId, audioChunkId: audioChunk.id }, 'Audio processing optimization failed');
      throw error;
    }
  }

  private async optimizeAudioChunk(audioChunk: AudioChunk, callId: string): Promise<AudioChunk> {
    if (!this.config.adaptiveEncoding) return audioChunk;

    const encodingConfig = this.getEncodingConfig(callId);
    const currentQuality = this.qualityMonitor.getCurrentQuality(callId);

    // Adapt quality based on performance
    if (currentQuality.averageLatency > encodingConfig.targetLatency) {
      return await this.downgradeQuality(audioChunk, callId);
    } else if (currentQuality.averageLatency < encodingConfig.targetLatency * 0.5) {
      return await this.upgradeQuality(audioChunk, callId);
    }

    return audioChunk;
  }

  private async processWithBuffering(
    audioChunk: AudioChunk,
    bufferManager: AudioBufferManager,
    processingFunction: (chunk: AudioChunk) => Promise<ProcessedAudio>
  ): Promise<ProcessedAudio> {
    // Check buffer state
    const bufferMetrics = bufferManager.getMetrics();
    
    if (bufferMetrics.utilization > 0.9) {
      logger.warn({
        callId: bufferManager.callId,
        utilization: bufferMetrics.utilization,
        size: bufferMetrics.size,
      }, 'Buffer utilization high, applying backpressure');

      // Apply backpressure by slightly delaying processing
      await this.sleep(10);
    }

    // Pre-process optimization
    const optimizedChunk = await this.preProcessOptimization(audioChunk);

    // Process with timeout
    const processingPromise = processingFunction(optimizedChunk);
    const timeoutPromise = new Promise<ProcessedAudio>((_, reject) => {
      setTimeout(() => reject(new Error('Processing timeout')), this.config.maxLatency);
    });

    const result = await Promise.race([processingPromise, timeoutPromise]);

    // Post-process optimization
    const optimizedResult = await this.postProcessOptimization(result);

    // Update buffer metrics
    bufferManager.recordProcessing(Date.now() - audioChunk.timestamp);

    return optimizedResult;
  }

  private async preProcessOptimization(audioChunk: AudioChunk): Promise<AudioChunk> {
    let optimizedChunk = { ...audioChunk };

    // Audio compression if enabled
    if (this.config.compressionEnabled) {
      const audioData = typeof audioChunk.audioData === 'string' 
        ? Buffer.from(audioChunk.audioData, 'base64')
        : audioChunk.audioData;

      if (audioData.length > this.config.compressionThreshold) {
        const compressed = await this.compressionEngine.compress(audioData);
        optimizedChunk.audioData = compressed;
      }
    }

    return optimizedChunk;
  }

  private async postProcessOptimization(result: ProcessedAudio): Promise<ProcessedAudio> {
    let optimizedResult = { ...result };

    // Compress audio response if present
    if (result.audioResponse && this.config.compressionEnabled) {
      const audioData = typeof result.audioResponse === 'string'
        ? Buffer.from(result.audioResponse, 'base64')
        : result.audioResponse;

      if (audioData.length > this.config.compressionThreshold) {
        const compressed = await this.compressionEngine.compress(audioData);
        optimizedResult.audioResponse = compressed;
      }
    }

    return optimizedResult;
  }

  private getEncodingConfig(callId: string): AdaptiveEncodingConfig {
    let config = this.encodingConfigs.get(callId);
    
    if (!config) {
      config = {
        enabled: this.config.adaptiveEncoding,
        currentLevel: 1, // Start with 'high' quality
        targetLatency: this.config.latencyTargets.good,
        qualityThreshold: 0.8,
        adaptationRate: 0.1,
      };
      this.encodingConfigs.set(callId, config);
    }
    
    return config;
  }

  private async downgradeQuality(audioChunk: AudioChunk, callId: string): Promise<AudioChunk> {
    const config = this.getEncodingConfig(callId);
    const currentLevelIndex = config.currentLevel;
    
    if (currentLevelIndex < this.config.qualityLevels.length - 1) {
      config.currentLevel++;
      const newLevel = this.config.qualityLevels[config.currentLevel];
      
      logger.info({
        callId,
        oldLevel: this.config.qualityLevels[currentLevelIndex].name,
        newLevel: newLevel.name,
        targetLatency: newLevel.latencyTarget,
      }, 'Downgrading audio quality for better performance');

      // Apply quality adjustments
      return this.applyQualityLevel(audioChunk, newLevel);
    }
    
    return audioChunk;
  }

  private async upgradeQuality(audioChunk: AudioChunk, callId: string): Promise<AudioChunk> {
    const config = this.getEncodingConfig(callId);
    const currentLevelIndex = config.currentLevel;
    
    if (currentLevelIndex > 0) {
      config.currentLevel--;
      const newLevel = this.config.qualityLevels[config.currentLevel];
      
      logger.info({
        callId,
        oldLevel: this.config.qualityLevels[currentLevelIndex].name,
        newLevel: newLevel.name,
        targetLatency: newLevel.latencyTarget,
      }, 'Upgrading audio quality');

      // Apply quality adjustments
      return this.applyQualityLevel(audioChunk, newLevel);
    }
    
    return audioChunk;
  }

  private applyQualityLevel(audioChunk: AudioChunk, level: QualityLevel): AudioChunk {
    return {
      ...audioChunk,
      sampleRate: level.sampleRate,
      format: this.getBestFormatForBitrate(level.bitrate),
    };
  }

  private getBestFormatForBitrate(bitrate: number): AudioFormat {
    if (bitrate >= 32000) return AudioFormat.OPUS;
    if (bitrate >= 16000) return AudioFormat.AAC;
    return AudioFormat.MP3;
  }

  private generateCacheKey(audioChunk: AudioChunk): string {
    // Generate a hash-based cache key
    const content = typeof audioChunk.audioData === 'string' 
      ? audioChunk.audioData.substring(0, 100) // First 100 chars
      : audioChunk.audioData.toString('base64').substring(0, 100);
    
    return `audio_${audioChunk.callId}_${content}_${audioChunk.sampleRate}_${audioChunk.channels}`;
  }

  private shouldCache(result: ProcessedAudio): boolean {
    // Cache results that have transcripts and responses
    return !!(result.transcript && result.response && result.processingLatency < this.config.maxLatency);
  }

  private recordCacheHit(type: string): void {
    this.metrics.incrementCounter(`cache_${type}_hits_total`);
  }

  private recordCacheMiss(type: string): void {
    this.metrics.incrementCounter(`cache_${type}_misses_total`);
  }

  private recordLatency(latency: number, type: string): void {
    this.metrics.recordHistogram(`latency_${type}_ms`, latency);
    this.latencyTracker.record(type, latency);
  }

  private updatePerformanceProfile(callId: string, processingTime: number, result: ProcessedAudio): void {
    this.performanceProfiler.update(callId, {
      processingTime,
      audioSize: typeof result.audioResponse === 'string' 
        ? Buffer.from(result.audioResponse, 'base64').length
        : result.audioResponse?.length || 0,
      quality: result.confidence || 0,
      hasTranscript: !!result.transcript,
      hasResponse: !!result.response,
    });

    this.qualityMonitor.updateQuality(callId, processingTime, result.confidence || 0);
  }

  private async triggerAdaptiveOptimization(callId: string, latency: number): Promise<void> {
    logger.warn({ callId, latency, threshold: this.config.maxLatency }, 'High latency detected, triggering optimization');

    // Immediate optimizations
    await this.reduceQualityForCall(callId);
    await this.clearOldCacheEntries();
    await this.optimizeBufferSizes(callId);

    // Emit optimization event
    this.emit('optimizationTriggered', {
      callId,
      latency,
      action: 'quality_reduction',
      timestamp: Date.now(),
    });
  }

  private async reduceQualityForCall(callId: string): Promise<void> {
    const config = this.getEncodingConfig(callId);
    if (config.currentLevel < this.config.qualityLevels.length - 1) {
      config.currentLevel++;
      logger.info({ callId, newLevel: this.config.qualityLevels[config.currentLevel].name }, 'Reduced quality for optimization');
    }
  }

  private async clearOldCacheEntries(): Promise<void> {
    const beforeSize = this.responseCache.size;
    this.responseCache.clear();
    this.transcriptCache.clear();
    this.intentCache.clear();
    
    logger.info({ beforeSize, afterSize: 0 }, 'Cleared cache for optimization');
    this.metrics.incrementCounter('cache_optimizations_total');
  }

  private async optimizeBufferSizes(callId: string): Promise<void> {
    const bufferManager = this.audioBuffers.get(callId);
    if (bufferManager) {
      bufferManager.optimize();
      logger.info({ callId }, 'Optimized buffer sizes');
    }
  }

  private startPerformanceMonitoring(): void {
    setInterval(() => {
      this.collectPerformanceMetrics();
    }, 10000); // Every 10 seconds
  }

  private startAdaptiveOptimization(): void {
    setInterval(() => {
      this.performAdaptiveOptimization();
    }, 30000); // Every 30 seconds
  }

  private startCacheStatistics(): void {
    setInterval(() => {
      this.updateCacheStatistics();
    }, 60000); // Every minute
  }

  private collectPerformanceMetrics(): void {
    // Buffer metrics
    let totalBufferUtilization = 0;
    let activeBuffers = 0;

    for (const [callId, buffer] of this.audioBuffers) {
      const metrics = buffer.getMetrics();
      totalBufferUtilization += metrics.utilization;
      activeBuffers++;
      
      this.metrics.setGauge(`buffer_utilization`, metrics.utilization, { call_id: callId });
      this.metrics.setGauge(`buffer_overruns`, metrics.overruns, { call_id: callId });
      this.metrics.setGauge(`buffer_underruns`, metrics.underruns, { call_id: callId });
    }

    if (activeBuffers > 0) {
      this.metrics.setGauge('average_buffer_utilization', totalBufferUtilization / activeBuffers);
    }

    // Latency metrics
    const latencyStats = this.latencyTracker.getStatistics();
    for (const [type, stats] of Object.entries(latencyStats)) {
      this.metrics.setGauge(`latency_${type}_avg`, stats.average);
      this.metrics.setGauge(`latency_${type}_p95`, stats.p95);
      this.metrics.setGauge(`latency_${type}_p99`, stats.p99);
    }

    // Performance profile metrics
    const profileStats = this.performanceProfiler.getGlobalStatistics();
    this.metrics.setGauge('performance_average_processing_time', profileStats.averageProcessingTime);
    this.metrics.setGauge('performance_average_quality', profileStats.averageQuality);
  }

  private async performAdaptiveOptimization(): Promise<void> {
    // Analyze performance patterns
    const globalStats = this.performanceProfiler.getGlobalStatistics();
    const latencyStats = this.latencyTracker.getStatistics();

    // Global optimization decisions
    if (globalStats.averageProcessingTime > this.config.maxLatency * 0.8) {
      logger.info('Global performance degradation detected, applying optimizations');
      
      // Reduce cache size to free memory
      if (this.responseCache.size > this.config.cacheSize * 0.5) {
        this.responseCache.resize(this.config.cacheSize * 0.7);
        this.transcriptCache.resize(this.config.cacheSize * 0.7);
      }
      
      // Increase compression threshold to compress more aggressively
      this.config.compressionThreshold = Math.max(512, this.config.compressionThreshold * 0.8);
    }

    // Per-call optimizations
    for (const [callId, buffer] of this.audioBuffers) {
      const callStats = this.performanceProfiler.getCallStatistics(callId);
      if (callStats.averageProcessingTime > this.config.maxLatency) {
        await this.reduceQualityForCall(callId);
      }
    }
  }

  private updateCacheStatistics(): void {
    const responseStats = this.getCacheStatistics(this.responseCache);
    const transcriptStats = this.getCacheStatistics(this.transcriptCache);
    const intentStats = this.getCacheStatistics(this.intentCache);

    // Response cache metrics
    this.metrics.setGauge('cache_response_hit_rate', responseStats.hitRate);
    this.metrics.setGauge('cache_response_size', responseStats.cacheSize);

    // Transcript cache metrics
    this.metrics.setGauge('cache_transcript_hit_rate', transcriptStats.hitRate);
    this.metrics.setGauge('cache_transcript_size', transcriptStats.cacheSize);

    // Intent cache metrics
    this.metrics.setGauge('cache_intent_hit_rate', intentStats.hitRate);
    this.metrics.setGauge('cache_intent_size', intentStats.cacheSize);
  }

  private getCacheStatistics(cache: LRUCache<any, any>): CacheStatistics {
    return {
      hitRate: 0, // LRU cache doesn't provide hit rate directly
      missRate: 0,
      evictionRate: 0,
      totalRequests: 0,
      totalHits: 0,
      totalMisses: 0,
      cacheSize: cache.size,
      maxSize: cache.max,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API methods

  public getPerformanceStats(): any {
    return {
      latency: this.latencyTracker.getStatistics(),
      buffers: Array.from(this.audioBuffers.entries()).map(([callId, buffer]) => ({
        callId,
        metrics: buffer.getMetrics(),
      })),
      cache: {
        response: this.getCacheStatistics(this.responseCache),
        transcript: this.getCacheStatistics(this.transcriptCache),
        intent: this.getCacheStatistics(this.intentCache),
      },
      quality: this.qualityMonitor.getAllQualityStats(),
      profile: this.performanceProfiler.getGlobalStatistics(),
    };
  }

  public async optimizeForCall(callId: string): Promise<void> {
    logger.info({ callId }, 'Manual optimization requested');
    
    await this.reduceQualityForCall(callId);
    await this.optimizeBufferSizes(callId);
    
    this.emit('manualOptimization', { callId, timestamp: Date.now() });
  }

  public clearCache(): void {
    this.responseCache.clear();
    this.transcriptCache.clear();
    this.intentCache.clear();
    
    logger.info('All caches cleared manually');
    this.metrics.incrementCounter('manual_cache_clears_total');
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down performance optimizer');

    // Clear all caches
    this.responseCache.clear();
    this.transcriptCache.clear();
    this.intentCache.clear();

    // Clear all buffers
    this.audioBuffers.clear();
    this.encodingConfigs.clear();

    this.removeAllListeners();

    logger.info('Performance optimizer shutdown complete');
  }
}

// Supporting classes

class AudioBufferManager {
  public readonly callId: string;
  private buffer: CircularBuffer<AudioChunk>;
  private metrics: BufferMetrics;
  private latencies: number[] = [];

  constructor(callId: string, size: number) {
    this.callId = callId;
    this.buffer = new CircularBuffer<AudioChunk>(size);
    this.metrics = {
      size: 0,
      utilization: 0,
      overruns: 0,
      underruns: 0,
      averageLatency: 0,
      jitter: 0,
    };
  }

  addChunk(chunk: AudioChunk): void {
    if (this.buffer.isFull()) {
      this.metrics.overruns++;
    }
    
    this.buffer.push(chunk);
    this.updateMetrics();
  }

  recordProcessing(latency: number): void {
    this.latencies.push(latency);
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }
    
    this.updateLatencyMetrics();
  }

  private updateMetrics(): void {
    this.metrics.size = this.buffer.size();
    this.metrics.utilization = this.buffer.size() / this.buffer.capacity();
  }

  private updateLatencyMetrics(): void {
    if (this.latencies.length === 0) return;
    
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    this.metrics.averageLatency = sum / this.latencies.length;
    
    // Calculate jitter (variance in latencies)
    const variance = this.latencies.reduce((acc, latency) => {
      const diff = latency - this.metrics.averageLatency;
      return acc + (diff * diff);
    }, 0) / this.latencies.length;
    
    this.metrics.jitter = Math.sqrt(variance);
  }

  getMetrics(): BufferMetrics {
    return { ...this.metrics };
  }

  optimize(): void {
    // Clear old chunks if utilization is high
    if (this.metrics.utilization > 0.8) {
      const toRemove = Math.floor(this.buffer.size() * 0.3);
      for (let i = 0; i < toRemove; i++) {
        this.buffer.shift();
      }
      this.updateMetrics();
    }
  }
}

class CircularBuffer<T> {
  private items: T[] = [];
  private head = 0;
  private tail = 0;
  private count = 0;
  private readonly maxSize: number;

  constructor(size: number) {
    this.maxSize = size;
    this.items = new Array(size);
  }

  push(item: T): void {
    this.items[this.tail] = item;
    this.tail = (this.tail + 1) % this.maxSize;
    
    if (this.count < this.maxSize) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.maxSize;
    }
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    
    const item = this.items[this.head];
    this.head = (this.head + 1) % this.maxSize;
    this.count--;
    
    return item;
  }

  size(): number {
    return this.count;
  }

  capacity(): number {
    return this.maxSize;
  }

  isFull(): boolean {
    return this.count === this.maxSize;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }
}

class QualityMonitor {
  private qualityData: Map<string, QualityData> = new Map();
  private targets: LatencyTargets;

  constructor(targets: LatencyTargets) {
    this.targets = targets;
  }

  updateQuality(callId: string, latency: number, confidence: number): void {
    let data = this.qualityData.get(callId);
    if (!data) {
      data = {
        latencies: [],
        confidences: [],
        averageLatency: 0,
        averageConfidence: 0,
      };
      this.qualityData.set(callId, data);
    }

    data.latencies.push(latency);
    data.confidences.push(confidence);

    // Keep only recent data
    if (data.latencies.length > 50) {
      data.latencies.shift();
      data.confidences.shift();
    }

    // Update averages
    data.averageLatency = data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length;
    data.averageConfidence = data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length;
  }

  getCurrentQuality(callId: string): QualityData {
    return this.qualityData.get(callId) || {
      latencies: [],
      confidences: [],
      averageLatency: 0,
      averageConfidence: 0,
    };
  }

  getAllQualityStats(): any {
    const stats: any = {};
    for (const [callId, data] of this.qualityData) {
      stats[callId] = {
        averageLatency: data.averageLatency,
        averageConfidence: data.averageConfidence,
        sampleCount: data.latencies.length,
      };
    }
    return stats;
  }
}

interface QualityData {
  latencies: number[];
  confidences: number[];
  averageLatency: number;
  averageConfidence: number;
}

class LatencyTracker {
  private latencies: Map<string, number[]> = new Map();

  record(type: string, latency: number): void {
    let typeLatencies = this.latencies.get(type);
    if (!typeLatencies) {
      typeLatencies = [];
      this.latencies.set(type, typeLatencies);
    }

    typeLatencies.push(latency);
    
    // Keep only recent measurements
    if (typeLatencies.length > 1000) {
      typeLatencies.shift();
    }
  }

  getStatistics(): any {
    const stats: any = {};
    
    for (const [type, latencies] of this.latencies) {
      if (latencies.length === 0) continue;
      
      const sorted = [...latencies].sort((a, b) => a - b);
      const sum = latencies.reduce((a, b) => a + b, 0);
      
      stats[type] = {
        count: latencies.length,
        average: sum / latencies.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }
    
    return stats;
  }
}

class PerformanceProfiler {
  private callProfiles: Map<string, CallProfile> = new Map();
  private globalProfile: GlobalProfile;

  constructor() {
    this.globalProfile = {
      totalCalls: 0,
      totalProcessingTime: 0,
      totalQuality: 0,
      averageProcessingTime: 0,
      averageQuality: 0,
    };
  }

  update(callId: string, data: ProfileData): void {
    let profile = this.callProfiles.get(callId);
    if (!profile) {
      profile = {
        callId,
        samples: [],
        averageProcessingTime: 0,
        averageQuality: 0,
      };
      this.callProfiles.set(callId, profile);
    }

    profile.samples.push(data);
    
    // Keep only recent samples
    if (profile.samples.length > 100) {
      profile.samples.shift();
    }

    // Update averages
    profile.averageProcessingTime = profile.samples.reduce((sum, s) => sum + s.processingTime, 0) / profile.samples.length;
    profile.averageQuality = profile.samples.reduce((sum, s) => sum + s.quality, 0) / profile.samples.length;

    // Update global profile
    this.globalProfile.totalCalls++;
    this.globalProfile.totalProcessingTime += data.processingTime;
    this.globalProfile.totalQuality += data.quality;
    this.globalProfile.averageProcessingTime = this.globalProfile.totalProcessingTime / this.globalProfile.totalCalls;
    this.globalProfile.averageQuality = this.globalProfile.totalQuality / this.globalProfile.totalCalls;
  }

  getCallStatistics(callId: string): CallProfile | null {
    return this.callProfiles.get(callId) || null;
  }

  getGlobalStatistics(): GlobalProfile {
    return { ...this.globalProfile };
  }
}

interface ProfileData {
  processingTime: number;
  audioSize: number;
  quality: number;
  hasTranscript: boolean;
  hasResponse: boolean;
}

interface CallProfile {
  callId: string;
  samples: ProfileData[];
  averageProcessingTime: number;
  averageQuality: number;
}

interface GlobalProfile {
  totalCalls: number;
  totalProcessingTime: number;
  totalQuality: number;
  averageProcessingTime: number;
  averageQuality: number;
}

class CompressionEngine {
  private config: { enabled: boolean; threshold: number };

  constructor(config: { enabled: boolean; threshold: number }) {
    this.config = config;
  }

  async compress(data: Buffer): Promise<Buffer> {
    if (!this.config.enabled || data.length <= this.config.threshold) {
      return data;
    }

    // Simple compression (in production, use proper compression libraries like zlib)
    return Buffer.from(data.toString('base64').substring(0, data.length * 0.7), 'base64');
  }

  async decompress(data: Buffer): Promise<Buffer> {
    // Simple decompression placeholder
    return data;
  }
}

export default PerformanceOptimizer;