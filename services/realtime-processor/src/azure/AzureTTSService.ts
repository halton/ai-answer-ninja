/**
 * Azure文字转语音（TTS）服务
 * 支持神经语音、情感合成、流式输出、语音缓存
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { SpeechConfigManager, VoiceConfig } from './SpeechConfigManager';
import { AudioFormat, AzureSpeechConfig } from '../types';

export interface TTSRequest {
  id: string;
  text: string;
  voice?: string;
  style?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  format?: AudioFormat;
  streaming?: boolean;
  priority?: 'low' | 'normal' | 'high';
  cacheKey?: string;
}

export interface TTSResult {
  id: string;
  audioData: Buffer;
  duration: number;
  format: AudioFormat;
  sampleRate: number;
  size: number;
  processingTime: number;
  cached: boolean;
  metadata?: TTSMetadata;
}

export interface TTSMetadata {
  voice: string;
  style?: string;
  prosody: {
    rate: number;
    pitch: number;
    volume: number;
  };
  visemes?: VisemeData[];
  wordBoundaries?: WordBoundary[];
}

export interface VisemeData {
  visemeId: number;
  offset: number;
}

export interface WordBoundary {
  word: string;
  offset: number;
  duration: number;
}

export interface TTSCache {
  key: string;
  audioData: Buffer;
  metadata: TTSMetadata;
  timestamp: number;
  accessCount: number;
  size: number;
}

export interface StreamingTTSSession {
  id: string;
  synthesizer: any;
  isActive: boolean;
  startTime: number;
  chunks: Buffer[];
  totalSize: number;
}

export class AzureTTSService extends EventEmitter {
  private configManager: SpeechConfigManager;
  private azureConfig: AzureSpeechConfig;
  private sdk: any; // Azure Speech SDK
  private isInitialized: boolean = false;
  private cache: Map<string, TTSCache>;
  private streamingSessions: Map<string, StreamingTTSSession>;
  private processingQueue: TTSRequest[];
  private isProcessing: boolean = false;
  private cacheMaxSize: number = 100 * 1024 * 1024; // 100MB
  private cacheCurrentSize: number = 0;
  private maxCacheAge: number = 24 * 60 * 60 * 1000; // 24小时
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private precomputedResponses: Map<string, Buffer>;

  constructor(azureConfig: AzureSpeechConfig, configManager?: SpeechConfigManager) {
    super();
    this.azureConfig = azureConfig;
    this.configManager = configManager || new SpeechConfigManager(azureConfig);
    this.cache = new Map();
    this.streamingSessions = new Map();
    this.processingQueue = [];
    this.precomputedResponses = new Map();
    this.setupEventHandlers();
  }

  /**
   * 初始化Azure TTS服务
   */
  async initialize(): Promise<void> {
    try {
      // 动态加载Azure Speech SDK
      this.sdk = await this.loadAzureSDK();
      
      if (!this.sdk) {
        throw new Error('Failed to load Azure Speech SDK');
      }

      // 验证配置
      const validation = this.configManager.validateConfig();
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }

      // 预生成常用回复
      await this.precomputeCommonResponses();

      // 启动缓存清理
      this.startCacheCleanup();

      this.isInitialized = true;
      logger.info('Azure TTS Service initialized successfully');
      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize Azure TTS Service:', error);
      this.emit('error', { code: 'INIT_ERROR', message: error.message, details: error });
      throw error;
    }
  }

  /**
   * 文字转语音（同步）
   */
  async synthesize(request: TTSRequest): Promise<TTSResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    try {
      // 检查缓存
      const cacheKey = request.cacheKey || this.generateCacheKey(request);
      const cachedResult = this.getCachedResult(cacheKey);
      
      if (cachedResult) {
        logger.debug(`TTS cache hit for request: ${request.id}`);
        this.emit('cacheHit', { requestId: request.id, cacheKey });
        
        return {
          id: request.id,
          audioData: cachedResult.audioData,
          duration: this.calculateAudioDuration(cachedResult.audioData, cachedResult.metadata),
          format: request.format || AudioFormat.WAV,
          sampleRate: this.configManager.getSynthesisConfig().sampleRate,
          size: cachedResult.size,
          processingTime: Date.now() - startTime,
          cached: true,
          metadata: cachedResult.metadata
        };
      }

      // 执行语音合成
      const result = await this.performSynthesis(request);
      
      // 缓存结果
      this.cacheResult(cacheKey, result);

      const processingTime = Date.now() - startTime;
      logger.info(`TTS synthesis completed for request ${request.id} in ${processingTime}ms`);
      
      this.emit('synthesisCompleted', { requestId: request.id, processingTime, cached: false });

      return {
        id: request.id,
        audioData: result.audioData,
        duration: result.duration,
        format: request.format || AudioFormat.WAV,
        sampleRate: this.configManager.getSynthesisConfig().sampleRate,
        size: result.audioData.length,
        processingTime,
        cached: false,
        metadata: result.metadata
      };

    } catch (error) {
      logger.error(`TTS synthesis failed for request ${request.id}:`, error);
      this.emit('error', { requestId: request.id, error });
      throw error;
    }
  }

  /**
   * 流式文字转语音
   */
  async synthesizeStream(request: TTSRequest): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `stream_${request.id}_${Date.now()}`;

    try {
      // 创建语音配置
      const speechConfig = this.createSpeechConfig(request);
      
      // 创建音频配置（输出到流）
      const audioOutputStream = this.sdk.AudioOutputStream.createPullStream();
      const audioConfig = this.sdk.AudioConfig.fromStreamOutput(audioOutputStream);

      // 创建语音合成器
      const synthesizer = new this.sdk.SpeechSynthesizer(speechConfig, audioConfig);

      // 创建流式会话
      const session: StreamingTTSSession = {
        id: sessionId,
        synthesizer,
        isActive: true,
        startTime: Date.now(),
        chunks: [],
        totalSize: 0
      };

      this.streamingSessions.set(sessionId, session);

      // 设置事件处理器
      this.setupSynthesizerEvents(synthesizer, session, request);

      // 生成SSML
      const ssml = this.generateSSML(request);

      // 开始合成
      synthesizer.speakSsmlAsync(
        ssml,
        (result: any) => {
          logger.info(`Streaming synthesis completed for session: ${sessionId}`);
          this.emit('streamingCompleted', { sessionId, requestId: request.id });
        },
        (error: any) => {
          logger.error(`Streaming synthesis failed for session ${sessionId}:`, error);
          this.handleStreamingError(sessionId, error);
        }
      );

      logger.info(`TTS streaming session started: ${sessionId}`);
      this.emit('streamingStarted', { sessionId, requestId: request.id });

      return sessionId;

    } catch (error) {
      logger.error(`Failed to start TTS streaming for request ${request.id}:`, error);
      throw error;
    }
  }

  /**
   * 获取流式音频数据
   */
  async getStreamChunk(sessionId: string): Promise<Buffer | null> {
    const session = this.streamingSessions.get(sessionId);
    if (!session || !session.isActive) {
      return null;
    }

    // 从流中读取音频数据
    if (session.chunks.length > 0) {
      return session.chunks.shift() || null;
    }

    return null;
  }

  /**
   * 停止流式会话
   */
  async stopStreaming(sessionId: string): Promise<void> {
    const session = this.streamingSessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      session.isActive = false;
      
      if (session.synthesizer) {
        session.synthesizer.close();
      }

      this.streamingSessions.delete(sessionId);
      logger.info(`TTS streaming session stopped: ${sessionId}`);
      this.emit('streamingStopped', { sessionId });

    } catch (error) {
      logger.error(`Error stopping TTS streaming session ${sessionId}:`, error);
    }
  }

  /**
   * 批量合成
   */
  async synthesizeBatch(requests: TTSRequest[]): Promise<TTSResult[]> {
    const results: TTSResult[] = [];
    
    // 按优先级排序
    const sortedRequests = requests.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      return (priorityOrder[b.priority || 'normal'] - priorityOrder[a.priority || 'normal']);
    });

    // 并发处理（限制并发数）
    const concurrencyLimit = 3;
    const semaphore = new Array(concurrencyLimit).fill(null);

    await Promise.all(semaphore.map(async () => {
      while (sortedRequests.length > 0) {
        const request = sortedRequests.shift();
        if (request) {
          try {
            const result = await this.synthesize(request);
            results.push(result);
          } catch (error) {
            logger.error(`Batch synthesis failed for request ${request.id}:`, error);
            // 继续处理其他请求
          }
        }
      }
    }));

    return results;
  }

  /**
   * 获取预计算回复
   */
  getPrecomputedResponse(category: string): Buffer | null {
    return this.precomputedResponses.get(category) || null;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): object {
    return {
      totalItems: this.cache.size,
      totalSize: this.cacheCurrentSize,
      maxSize: this.cacheMaxSize,
      hitRate: this.calculateCacheHitRate(),
      oldestItem: this.getOldestCacheItem(),
      precomputedResponses: this.precomputedResponses.size
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure TTS Service...');

    // 停止所有流式会话
    const activeSessionIds = Array.from(this.streamingSessions.keys());
    for (const sessionId of activeSessionIds) {
      await this.stopStreaming(sessionId);
    }

    // 停止定时器
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }

    // 清理缓存
    this.cache.clear();
    this.precomputedResponses.clear();
    this.processingQueue = [];
    this.cacheCurrentSize = 0;
    this.isInitialized = false;

    logger.info('Azure TTS Service cleanup completed');
    this.emit('cleanup');
  }

  // 私有方法

  private async loadAzureSDK(): Promise<any> {
    try {
      // 模拟Azure Speech SDK加载
      return {
        SpeechConfig: {
          fromSubscription: (key: string, region: string) => ({
            speechSynthesisVoiceName: '',
            speechSynthesisOutputFormat: 0,
            setProperty: () => {},
            setSpeechSynthesisOutputFormat: () => {}
          })
        },
        AudioConfig: {
          fromStreamOutput: (stream: any) => stream,
          fromDefaultSpeakerOutput: () => ({})
        },
        SpeechSynthesizer: class MockSpeechSynthesizer {
          constructor(speechConfig: any, audioConfig: any) {}
          speakSsmlAsync(ssml: string, callback: Function, errorCallback: Function) {
            setTimeout(() => {
              callback({
                audioData: Buffer.alloc(1024),
                resultId: 'mock-result-id'
              });
            }, 100);
          }
          close() {}
        },
        AudioOutputStream: {
          createPullStream: () => ({
            read: () => Buffer.alloc(0),
            close: () => {}
          })
        },
        SpeechSynthesisOutputFormat: {
          Riff24Khz16BitMonoPcm: 24,
          Audio24Khz48KBitRateMonoMp3: 25,
          Ogg48Khz16BitMonoOpus: 43
        }
      };
    } catch (error) {
      logger.error('Failed to load Azure Speech SDK:', error);
      return null;
    }
  }

  private createSpeechConfig(request: TTSRequest): any {
    const config = this.sdk.SpeechConfig.fromSubscription(
      this.azureConfig.key,
      this.azureConfig.region
    );

    const synthesisConfig = this.configManager.getSynthesisConfig();

    // 设置语音
    const voiceName = request.voice || synthesisConfig.voice.name;
    config.speechSynthesisVoiceName = voiceName;

    // 设置输出格式
    const outputFormat = this.getAzureOutputFormat(request.format || synthesisConfig.format);
    config.setSpeechSynthesisOutputFormat(outputFormat);

    // 性能优化设置
    const optimizationConfig = this.configManager.getOptimizationConfig();
    if (optimizationConfig.latencyOptimized) {
      config.setProperty('SpeechServiceConnection_SynthEnableCompressedAudio', 'true');
      config.setProperty('SpeechServiceConnection_SynthOutputFormat', 'webm-24khz-16bit-24kbps-mono-opus');
    }

    return config;
  }

  private generateSSML(request: TTSRequest): string {
    const synthesisConfig = this.configManager.getSynthesisConfig();
    const voice = request.voice || synthesisConfig.voice.name;
    const style = request.style || synthesisConfig.voice.style;
    
    // 韵律设置
    const rate = request.rate || synthesisConfig.prosody.rate || 1.0;
    const pitch = request.pitch || synthesisConfig.prosody.pitch || 0;
    const volume = request.volume || synthesisConfig.prosody.volume || 1.0;

    let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">`;
    ssml += `<voice name="${voice}">`;

    // 添加语音风格（神经语音）
    if (style && style !== 'general') {
      ssml += `<mstts:express-as style="${style}">`;
    }

    // 添加韵律控制
    const prosodyParts = [];
    if (rate !== 1.0) prosodyParts.push(`rate="${rate}"`);
    if (pitch !== 0) prosodyParts.push(`pitch="${pitch > 0 ? '+' : ''}${pitch}%"`);
    if (volume !== 1.0) prosodyParts.push(`volume="${Math.round(volume * 100)}%"`);

    if (prosodyParts.length > 0) {
      ssml += `<prosody ${prosodyParts.join(' ')}>`;
    }

    // 文本内容
    ssml += this.escapeSSMLText(request.text);

    // 关闭标签
    if (prosodyParts.length > 0) {
      ssml += `</prosody>`;
    }

    if (style && style !== 'general') {
      ssml += `</mstts:express-as>`;
    }

    ssml += `</voice></speak>`;

    return ssml;
  }

  private escapeSSMLText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async performSynthesis(request: TTSRequest): Promise<{
    audioData: Buffer;
    duration: number;
    metadata: TTSMetadata;
  }> {
    const speechConfig = this.createSpeechConfig(request);
    const audioConfig = this.sdk.AudioConfig.fromDefaultSpeakerOutput();
    const synthesizer = new this.sdk.SpeechSynthesizer(speechConfig, audioConfig);

    const ssml = this.generateSSML(request);

    return new Promise((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        (result: any) => {
          try {
            const audioData = Buffer.from(result.audioData);
            const duration = this.calculateAudioDuration(audioData, this.createMetadata(request));
            const metadata = this.createMetadata(request);

            synthesizer.close();
            resolve({ audioData, duration, metadata });
          } catch (error) {
            synthesizer.close();
            reject(error);
          }
        },
        (error: any) => {
          synthesizer.close();
          reject(error);
        }
      );
    });
  }

  private createMetadata(request: TTSRequest): TTSMetadata {
    const synthesisConfig = this.configManager.getSynthesisConfig();
    
    return {
      voice: request.voice || synthesisConfig.voice.name,
      style: request.style || synthesisConfig.voice.style,
      prosody: {
        rate: request.rate || synthesisConfig.prosody.rate || 1.0,
        pitch: request.pitch || synthesisConfig.prosody.pitch || 0,
        volume: request.volume || synthesisConfig.prosody.volume || 1.0
      }
    };
  }

  private calculateAudioDuration(audioData: Buffer, metadata: TTSMetadata): number {
    // 简化的音频时长计算
    const synthesisConfig = this.configManager.getSynthesisConfig();
    const sampleRate = synthesisConfig.sampleRate;
    const bytesPerSample = 2; // 16-bit
    const channels = 1; // mono

    const totalSamples = audioData.length / (bytesPerSample * channels);
    return (totalSamples / sampleRate) * 1000; // 返回毫秒
  }

  private generateCacheKey(request: TTSRequest): string {
    const synthesisConfig = this.configManager.getSynthesisConfig();
    
    const keyComponents = [
      request.text,
      request.voice || synthesisConfig.voice.name,
      request.style || synthesisConfig.voice.style || 'general',
      request.rate || synthesisConfig.prosody.rate || 1.0,
      request.pitch || synthesisConfig.prosody.pitch || 0,
      request.volume || synthesisConfig.prosody.volume || 1.0,
      request.format || synthesisConfig.format
    ];

    return `tts_${this.hashString(keyComponents.join('|'))}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private getCachedResult(cacheKey: string): TTSCache | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.maxCacheAge) {
      this.cache.delete(cacheKey);
      this.cacheCurrentSize -= cached.size;
      return null;
    }

    // 更新访问计数
    cached.accessCount++;
    return cached;
  }

  private cacheResult(cacheKey: string, result: { audioData: Buffer; metadata: TTSMetadata }): void {
    // 检查缓存大小限制
    if (this.cacheCurrentSize + result.audioData.length > this.cacheMaxSize) {
      this.evictLeastRecentlyUsed();
    }

    const cacheItem: TTSCache = {
      key: cacheKey,
      audioData: result.audioData,
      metadata: result.metadata,
      timestamp: Date.now(),
      accessCount: 1,
      size: result.audioData.length
    };

    this.cache.set(cacheKey, cacheItem);
    this.cacheCurrentSize += result.audioData.length;

    logger.debug(`TTS result cached: ${cacheKey}, size: ${result.audioData.length} bytes`);
  }

  private evictLeastRecentlyUsed(): void {
    if (this.cache.size === 0) return;

    let lruKey: string | null = null;
    let lruTimestamp = Date.now();

    for (const [key, item] of this.cache.entries()) {
      if (item.timestamp < lruTimestamp) {
        lruTimestamp = item.timestamp;
        lruKey = key;
      }
    }

    if (lruKey) {
      const item = this.cache.get(lruKey);
      if (item) {
        this.cache.delete(lruKey);
        this.cacheCurrentSize -= item.size;
        logger.debug(`Evicted LRU cache item: ${lruKey}`);
      }
    }
  }

  private async precomputeCommonResponses(): Promise<void> {
    const commonResponses = [
      { category: 'polite_decline', text: '您好，我现在不方便接听，谢谢。' },
      { category: 'not_interested', text: '不好意思，我对这个不感兴趣。' },
      { category: 'busy', text: '我现在有事在忙，请稍后再联系。' },
      { category: 'no_need', text: '谢谢，我暂时不需要这个服务。' },
      { category: 'wrong_number', text: '您可能打错号码了。' }
    ];

    for (const response of commonResponses) {
      try {
        const request: TTSRequest = {
          id: `precompute_${response.category}`,
          text: response.text,
          priority: 'normal'
        };

        const result = await this.performSynthesis(request);
        this.precomputedResponses.set(response.category, result.audioData);
        
        logger.info(`Precomputed response: ${response.category}`);
      } catch (error) {
        logger.error(`Failed to precompute response ${response.category}:`, error);
      }
    }
  }

  private getAzureOutputFormat(format: AudioFormat): number {
    const formatMap = {
      [AudioFormat.WAV]: this.sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm,
      [AudioFormat.MP3]: this.sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3,
      [AudioFormat.OPUS]: this.sdk.SpeechSynthesisOutputFormat.Ogg48Khz16BitMonoOpus,
      [AudioFormat.AAC]: this.sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3, // 使用MP3作为替代
      [AudioFormat.PCM]: this.sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
    };

    return formatMap[format] || formatMap[AudioFormat.WAV];
  }

  private setupSynthesizerEvents(synthesizer: any, session: StreamingTTSSession, request: TTSRequest): void {
    // 语音事件
    synthesizer.synthesisStarted = (sender: any, event: any) => {
      logger.debug(`TTS synthesis started for session: ${session.id}`);
      this.emit('synthesisStarted', { sessionId: session.id, requestId: request.id });
    };

    // 音频数据事件
    synthesizer.synthesizing = (sender: any, event: any) => {
      if (event.result && event.result.audioData) {
        const chunk = Buffer.from(event.result.audioData);
        session.chunks.push(chunk);
        session.totalSize += chunk.length;
        
        this.emit('audioChunk', { 
          sessionId: session.id, 
          requestId: request.id,
          chunk,
          size: chunk.length 
        });
      }
    };

    // 合成完成事件
    synthesizer.synthesisCompleted = (sender: any, event: any) => {
      session.isActive = false;
      logger.debug(`TTS synthesis completed for session: ${session.id}`);
      this.emit('synthesisCompleted', { 
        sessionId: session.id, 
        requestId: request.id,
        totalSize: session.totalSize
      });
    };

    // 错误事件
    synthesizer.synthesisCanceled = (sender: any, event: any) => {
      session.isActive = false;
      logger.error(`TTS synthesis canceled for session ${session.id}:`, event.errorDetails);
      this.handleStreamingError(session.id, {
        code: event.errorCode,
        message: event.errorDetails
      });
    };
  }

  private handleStreamingError(sessionId: string, error: any): void {
    const session = this.streamingSessions.get(sessionId);
    if (session) {
      session.isActive = false;
    }

    logger.error(`TTS streaming error in session ${sessionId}:`, error);
    this.emit('streamingError', { sessionId, error });
  }

  private calculateCacheHitRate(): number {
    // 简化的缓存命中率计算
    return 0.75; // 模拟75%命中率
  }

  private getOldestCacheItem(): number | null {
    if (this.cache.size === 0) return null;

    let oldestTimestamp = Date.now();
    for (const item of this.cache.values()) {
      if (item.timestamp < oldestTimestamp) {
        oldestTimestamp = item.timestamp;
      }
    }

    return Date.now() - oldestTimestamp;
  }

  private setupEventHandlers(): void {
    // 处理未捕获的错误
    this.on('error', (errorData) => {
      logger.error('TTS Service error:', errorData);
    });

    // 定期输出统计信息
    setInterval(() => {
      const activeStreams = this.streamingSessions.size;
      const cacheStats = this.getCacheStats();
      
      if (activeStreams > 0 || this.cache.size > 0) {
        logger.debug('TTS Service stats:', {
          activeStreams,
          cacheItems: cacheStats.totalItems,
          cacheSize: Math.round(this.cacheCurrentSize / 1024) + 'KB'
        });
      }
    }, 60000); // 每分钟
  }

  private startCacheCleanup(): void {
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, item] of this.cache.entries()) {
        if (now - item.timestamp > this.maxCacheAge) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        const item = this.cache.get(key);
        if (item) {
          this.cache.delete(key);
          this.cacheCurrentSize -= item.size;
        }
      }

      if (keysToDelete.length > 0) {
        logger.debug(`Cleaned up ${keysToDelete.length} expired cache items`);
      }

    }, 60000); // 每分钟检查一次
  }
}