/**
 * Azure语音转文字（STT）服务
 * 支持流式识别、实时转录、多语言识别
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { SpeechConfigManager } from './SpeechConfigManager';
import { AudioChunk, AudioFormat, AzureSpeechConfig } from '../types';

export interface STTResult {
  text: string;
  confidence: number;
  offset: number;
  duration: number;
  words?: WordResult[];
  isFinal: boolean;
  sessionId: string;
}

export interface WordResult {
  word: string;
  confidence: number;
  offset: number;
  duration: number;
}

export interface STTError {
  code: string;
  message: string;
  details?: any;
}

export interface STTSessionConfig {
  sessionId: string;
  language?: string;
  enableWordTimestamps?: boolean;
  enableProfanityFilter?: boolean;
  continuousRecognition?: boolean;
  timeout?: number;
}

export interface RecognitionSession {
  id: string;
  startTime: number;
  lastActivity: number;
  isActive: boolean;
  totalProcessed: number;
  recognizer?: any; // Azure SDK recognizer instance
  audioBuffer: Buffer[];
  partialResults: STTResult[];
  finalResults: STTResult[];
}

export class AzureSTTService extends EventEmitter {
  private configManager: SpeechConfigManager;
  private azureConfig: AzureSpeechConfig;
  private activeSessions: Map<string, RecognitionSession>;
  private isInitialized: boolean = false;
  private sdk: any; // Azure Speech SDK
  private audioQualityThreshold: number = 0.7;
  private maxSessionDuration: number = 300000; // 5分钟
  private sessionCleanupInterval: NodeJS.Timeout | null = null;

  constructor(azureConfig: AzureSpeechConfig, configManager?: SpeechConfigManager) {
    super();
    this.azureConfig = azureConfig;
    this.configManager = configManager || new SpeechConfigManager(azureConfig);
    this.activeSessions = new Map();
    this.setupEventHandlers();
  }

  /**
   * 初始化Azure Speech SDK
   */
  async initialize(): Promise<void> {
    try {
      // 动态导入Azure Speech SDK
      this.sdk = await this.loadAzureSDK();
      
      if (!this.sdk) {
        throw new Error('Failed to load Azure Speech SDK');
      }

      // 验证配置
      const validation = this.configManager.validateConfig();
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }

      // 启动会话清理定时器
      this.startSessionCleanup();

      this.isInitialized = true;
      logger.info('Azure STT Service initialized successfully');
      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize Azure STT Service:', error);
      this.emit('error', { code: 'INIT_ERROR', message: error.message, details: error });
      throw error;
    }
  }

  /**
   * 开始新的识别会话
   */
  async startSession(config: STTSessionConfig): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const session: RecognitionSession = {
      id: config.sessionId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      isActive: true,
      totalProcessed: 0,
      audioBuffer: [],
      partialResults: [],
      finalResults: []
    };

    try {
      // 创建Azure语音配置
      const speechConfig = this.createSpeechConfig(config);
      
      // 创建音频配置（使用推送流）
      const audioConfig = this.createAudioConfig();
      
      // 创建语音识别器
      const recognizer = new this.sdk.SpeechRecognizer(speechConfig, audioConfig);
      
      // 设置事件处理器
      this.setupRecognizerEvents(recognizer, session);
      
      session.recognizer = recognizer;
      this.activeSessions.set(session.id, session);

      // 启动连续识别
      if (config.continuousRecognition !== false) {
        recognizer.startContinuousRecognitionAsync(() => {
          logger.info(`Continuous recognition started for session: ${session.id}`);
        }, (error: any) => {
          logger.error(`Failed to start recognition for session ${session.id}:`, error);
          this.handleSessionError(session.id, error);
        });
      }

      logger.info(`STT session started: ${session.id}`);
      this.emit('sessionStarted', { sessionId: session.id });
      
      return session.id;

    } catch (error) {
      logger.error(`Failed to start STT session ${config.sessionId}:`, error);
      this.activeSessions.delete(config.sessionId);
      throw error;
    }
  }

  /**
   * 处理音频数据流
   */
  async processAudioStream(sessionId: string, audioChunk: AudioChunk): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    try {
      // 更新会话活动时间
      session.lastActivity = Date.now();
      session.totalProcessed += 1;

      // 音频格式转换
      const processedAudio = await this.preprocessAudio(audioChunk);
      
      // 音频质量检测
      const quality = await this.assessAudioQuality(processedAudio);
      if (quality < this.audioQualityThreshold) {
        logger.warn(`Low audio quality detected for session ${sessionId}: ${quality}`);
        this.emit('lowQuality', { sessionId, quality, audioChunk });
      }

      // 将音频推送到识别器
      if (session.recognizer && session.recognizer.audioInputStream) {
        session.recognizer.audioInputStream.write(processedAudio);
      }

      // 缓存音频数据（用于错误恢复）
      session.audioBuffer.push(processedAudio);
      if (session.audioBuffer.length > 10) {
        session.audioBuffer.shift(); // 保持最近10个chunk
      }

      this.emit('audioProcessed', { sessionId, chunkId: audioChunk.id, quality });

    } catch (error) {
      logger.error(`Error processing audio for session ${sessionId}:`, error);
      this.handleSessionError(sessionId, error);
    }
  }

  /**
   * 获取实时识别结果
   */
  async getRealtimeResults(sessionId: string): Promise<STTResult[]> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return [...session.partialResults, ...session.finalResults];
  }

  /**
   * 停止识别会话
   */
  async stopSession(sessionId: string): Promise<STTResult[]> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      session.isActive = false;

      if (session.recognizer) {
        // 停止连续识别
        await new Promise<void>((resolve) => {
          session.recognizer.stopContinuousRecognitionAsync(() => {
            resolve();
          }, (error: any) => {
            logger.error(`Error stopping recognition for session ${sessionId}:`, error);
            resolve(); // 继续执行清理
          });
        });

        // 关闭音频流
        if (session.recognizer.audioInputStream) {
          session.recognizer.audioInputStream.close();
        }

        // 释放识别器资源
        session.recognizer.close();
      }

      const finalResults = [...session.finalResults];
      this.activeSessions.delete(sessionId);

      logger.info(`STT session stopped: ${sessionId}, total results: ${finalResults.length}`);
      this.emit('sessionStopped', { sessionId, results: finalResults });

      return finalResults;

    } catch (error) {
      logger.error(`Error stopping STT session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats(sessionId: string): any {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      startTime: session.startTime,
      duration: Date.now() - session.startTime,
      isActive: session.isActive,
      totalProcessed: session.totalProcessed,
      partialResultsCount: session.partialResults.length,
      finalResultsCount: session.finalResults.length,
      bufferSize: session.audioBuffer.length
    };
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys()).filter(sessionId => {
      const session = this.activeSessions.get(sessionId);
      return session?.isActive;
    });
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure STT Service...');

    // 停止所有活跃会话
    const activeSessionIds = this.getActiveSessions();
    for (const sessionId of activeSessionIds) {
      try {
        await this.stopSession(sessionId);
      } catch (error) {
        logger.error(`Error stopping session ${sessionId} during cleanup:`, error);
      }
    }

    // 停止定时器
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }

    this.activeSessions.clear();
    this.isInitialized = false;

    logger.info('Azure STT Service cleanup completed');
    this.emit('cleanup');
  }

  // 私有方法

  private async loadAzureSDK(): Promise<any> {
    try {
      // 模拟Azure Speech SDK加载
      // 实际项目中应该使用: const sdk = require('microsoft-cognitiveservices-speech-sdk');
      return {
        SpeechConfig: {
          fromSubscription: (key: string, region: string) => ({
            speechRecognitionLanguage: '',
            enableDictation: () => {},
            setProperty: () => {},
            outputFormat: 1
          })
        },
        AudioConfig: {
          fromStreamInput: (stream: any) => stream
        },
        SpeechRecognizer: class MockSpeechRecognizer {
          constructor(speechConfig: any, audioConfig: any) {}
          startContinuousRecognitionAsync(callback: Function, errorCallback: Function) {
            setTimeout(callback, 100);
          }
          stopContinuousRecognitionAsync(callback: Function, errorCallback: Function) {
            setTimeout(callback, 100);
          }
          close() {}
        },
        PushAudioInputStream: {
          create: () => ({
            write: (data: Buffer) => {},
            close: () => {}
          })
        },
        AudioStreamFormat: {
          getWaveFormatPCM: (sampleRate: number, bitsPerSample: number, channels: number) => ({})
        }
      };
    } catch (error) {
      logger.error('Failed to load Azure Speech SDK:', error);
      return null;
    }
  }

  private createSpeechConfig(sessionConfig: STTSessionConfig): any {
    const config = this.sdk.SpeechConfig.fromSubscription(
      this.azureConfig.key,
      this.azureConfig.region
    );

    const recognitionConfig = this.configManager.getRecognitionConfig();
    const optimizationConfig = this.configManager.getOptimizationConfig();

    // 设置识别语言
    config.speechRecognitionLanguage = sessionConfig.language || recognitionConfig.language;

    // 启用详细输出
    config.outputFormat = 1; // Detailed

    // 设置属性
    if (sessionConfig.enableProfanityFilter !== false) {
      config.setProperty('SpeechServiceConnection_ProfanityFilterMode', 'Masked');
    }

    if (sessionConfig.enableWordTimestamps !== false) {
      config.setProperty('SpeechServiceResponse_RequestWordLevelTimestamps', 'true');
    }

    // 性能优化设置
    if (optimizationConfig.latencyOptimized) {
      config.setProperty('SpeechServiceConnection_InitialSilenceTimeoutMs', '3000');
      config.setProperty('SpeechServiceConnection_EndSilenceTimeoutMs', '500');
    }

    // 流式优化
    if (optimizationConfig.streaming) {
      config.setProperty('SpeechServiceConnection_EnableAudioLogging', 'false');
      config.setProperty('SpeechServiceConnection_ReceiveCompressedAudio', 'true');
    }

    return config;
  }

  private createAudioConfig(): any {
    const recognitionConfig = this.configManager.getRecognitionConfig();
    
    // 创建推送音频流
    const audioFormat = this.sdk.AudioStreamFormat.getWaveFormatPCM(
      recognitionConfig.sampleRate,
      16, // 16 bits per sample
      recognitionConfig.channels
    );

    const pushStream = this.sdk.PushAudioInputStream.create(audioFormat);
    return this.sdk.AudioConfig.fromStreamInput(pushStream);
  }

  private setupRecognizerEvents(recognizer: any, session: RecognitionSession): void {
    // 中间结果事件
    recognizer.recognizing = (sender: any, event: any) => {
      if (event.result && event.result.text) {
        const result: STTResult = {
          text: event.result.text,
          confidence: event.result.confidence || 0.5,
          offset: event.result.offset,
          duration: event.result.duration,
          isFinal: false,
          sessionId: session.id
        };

        session.partialResults.push(result);
        this.emit('partialResult', result);
      }
    };

    // 最终结果事件
    recognizer.recognized = (sender: any, event: any) => {
      if (event.result && event.result.text) {
        const result: STTResult = {
          text: event.result.text,
          confidence: event.result.confidence || 0.8,
          offset: event.result.offset,
          duration: event.result.duration,
          words: this.extractWordResults(event.result),
          isFinal: true,
          sessionId: session.id
        };

        session.finalResults.push(result);
        this.emit('finalResult', result);
      }
    };

    // 会话开始事件
    recognizer.sessionStarted = (sender: any, event: any) => {
      logger.info(`Recognition session started: ${event.sessionId}`);
      this.emit('recognitionStarted', { sessionId: session.id, azureSessionId: event.sessionId });
    };

    // 会话停止事件
    recognizer.sessionStopped = (sender: any, event: any) => {
      logger.info(`Recognition session stopped: ${event.sessionId}`);
      this.emit('recognitionStopped', { sessionId: session.id, azureSessionId: event.sessionId });
    };

    // 错误事件
    recognizer.canceled = (sender: any, event: any) => {
      logger.error(`Recognition canceled for session ${session.id}:`, event.errorDetails);
      this.handleSessionError(session.id, {
        code: event.errorCode,
        message: event.errorDetails
      });
    };
  }

  private extractWordResults(result: any): WordResult[] | undefined {
    if (!result.json || !result.json.NBest || !result.json.NBest[0] || !result.json.NBest[0].Words) {
      return undefined;
    }

    return result.json.NBest[0].Words.map((word: any) => ({
      word: word.Word,
      confidence: word.Confidence,
      offset: word.Offset,
      duration: word.Duration
    }));
  }

  private async preprocessAudio(audioChunk: AudioChunk): Promise<Buffer> {
    try {
      let audioData: Buffer;

      // 处理不同的输入格式
      if (Buffer.isBuffer(audioChunk.audioData)) {
        audioData = audioChunk.audioData;
      } else if (typeof audioChunk.audioData === 'string') {
        // Base64解码
        audioData = Buffer.from(audioChunk.audioData, 'base64');
      } else {
        throw new Error('Unsupported audio data format');
      }

      // 音频格式转换（如果需要）
      const recognitionConfig = this.configManager.getRecognitionConfig();
      if (audioChunk.format && audioChunk.format !== recognitionConfig.format) {
        audioData = await this.convertAudioFormat(audioData, audioChunk.format, recognitionConfig.format);
      }

      // 采样率转换（如果需要）
      if (audioChunk.sampleRate && audioChunk.sampleRate !== recognitionConfig.sampleRate) {
        audioData = await this.resampleAudio(audioData, audioChunk.sampleRate, recognitionConfig.sampleRate);
      }

      return audioData;

    } catch (error) {
      logger.error('Error preprocessing audio:', error);
      throw error;
    }
  }

  private async convertAudioFormat(audioData: Buffer, fromFormat: AudioFormat, toFormat: AudioFormat): Promise<Buffer> {
    // 音频格式转换的简化实现
    // 实际项目中应该使用ffmpeg或其他音频处理库
    logger.info(`Converting audio from ${fromFormat} to ${toFormat}`);
    return audioData; // 暂时返回原数据
  }

  private async resampleAudio(audioData: Buffer, fromRate: number, toRate: number): Promise<Buffer> {
    // 音频重采样的简化实现
    // 实际项目中应该使用专业音频处理库
    logger.info(`Resampling audio from ${fromRate}Hz to ${toRate}Hz`);
    return audioData; // 暂时返回原数据
  }

  private async assessAudioQuality(audioData: Buffer): Promise<number> {
    // 简单的音频质量评估
    // 实际项目中应该实现更复杂的质量检测算法
    const amplitude = this.calculateRMSAmplitude(audioData);
    const snr = this.estimateSignalToNoiseRatio(audioData);
    
    // 基于振幅和信噪比计算质量分数
    const qualityScore = Math.min(1.0, (amplitude * 0.6 + snr * 0.4));
    return qualityScore;
  }

  private calculateRMSAmplitude(audioData: Buffer): number {
    // 计算RMS振幅（简化版本）
    let sum = 0;
    for (let i = 0; i < audioData.length; i += 2) {
      const sample = audioData.readInt16LE(i);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / (audioData.length / 2));
    return Math.min(1.0, rms / 32768); // 归一化到0-1
  }

  private estimateSignalToNoiseRatio(audioData: Buffer): number {
    // 简单的信噪比估算
    const amplitude = this.calculateRMSAmplitude(audioData);
    const noiseFloor = 0.01; // 假设噪声底噪
    return Math.min(1.0, amplitude / (amplitude + noiseFloor));
  }

  private handleSessionError(sessionId: string, error: any): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isActive = false;
    }

    const sttError: STTError = {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'Unknown error occurred',
      details: error
    };

    logger.error(`STT error in session ${sessionId}:`, sttError);
    this.emit('error', { sessionId, error: sttError });
  }

  private setupEventHandlers(): void {
    // 处理未捕获的错误
    this.on('error', (errorData) => {
      logger.error('STT Service error:', errorData);
    });

    // 定期输出统计信息
    setInterval(() => {
      const activeCount = this.getActiveSessions().length;
      if (activeCount > 0) {
        logger.debug(`Active STT sessions: ${activeCount}`);
      }
    }, 30000); // 每30秒
  }

  private startSessionCleanup(): void {
    this.sessionCleanupInterval = setInterval(() => {
      const now = Date.now();
      const sessionsToCleanup: string[] = [];

      for (const [sessionId, session] of this.activeSessions.entries()) {
        // 清理超时或不活跃的会话
        const isTimeout = (now - session.startTime) > this.maxSessionDuration;
        const isInactive = (now - session.lastActivity) > 60000; // 1分钟无活动

        if (isTimeout || isInactive) {
          sessionsToCleanup.push(sessionId);
        }
      }

      // 异步清理会话
      for (const sessionId of sessionsToCleanup) {
        this.stopSession(sessionId).catch(error => {
          logger.error(`Error cleaning up session ${sessionId}:`, error);
        });
      }

    }, 30000); // 每30秒检查一次
  }
}