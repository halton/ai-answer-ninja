/**
 * Azure语音服务主控制器
 * 集成STT、TTS服务，提供统一的语音处理接口
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { SpeechConfigManager } from './SpeechConfigManager';
import { AzureSTTService, STTResult, STTSessionConfig } from './AzureSTTService';
import { AzureTTSService, TTSRequest, TTSResult } from './AzureTTSService';
import { AudioChunk, AudioFormat, AzureSpeechConfig, PerformanceMetrics } from '../types';

export interface SpeechProcessingRequest {
  id: string;
  callId: string;
  audioChunk: AudioChunk;
  userProfile?: UserProfile;
  context?: ConversationContext;
  options?: ProcessingOptions;
}

export interface UserProfile {
  userId: string;
  preferredVoice?: string;
  personality?: string;
  speechStyle?: string;
  language?: string;
}

export interface ConversationContext {
  sessionId: string;
  turnCount: number;
  lastIntent?: string;
  emotionalState?: string;
  conversationHistory: string[];
}

export interface ProcessingOptions {
  enableSTT?: boolean;
  enableTTS?: boolean;
  streamingMode?: boolean;
  latencyOptimized?: boolean;
  qualityMode?: 'fast' | 'balanced' | 'high';
  cacheEnabled?: boolean;
}

export interface SpeechProcessingResult {
  id: string;
  callId: string;
  transcript?: STTResult;
  response?: {
    text: string;
    audioData: Buffer;
    metadata: any;
  };
  processingTime: LatencyBreakdown;
  quality: QualityMetrics;
  cached: boolean;
}

export interface LatencyBreakdown {
  total: number;
  stt: number;
  processing: number;
  tts: number;
  overhead: number;
}

export interface QualityMetrics {
  audioQuality: number;
  transcriptionConfidence: number;
  responseRelevance: number;
  overallScore: number;
}

export interface ServiceHealth {
  stt: {
    status: 'healthy' | 'degraded' | 'down';
    latency: number;
    errorRate: number;
    activeSessions: number;
  };
  tts: {
    status: 'healthy' | 'degraded' | 'down';
    latency: number;
    errorRate: number;
    cacheHitRate: number;
  };
  overall: {
    status: 'healthy' | 'degraded' | 'down';
    uptime: number;
    requestsPerMinute: number;
  };
}

export class AzureSpeechService extends EventEmitter {
  private configManager: SpeechConfigManager;
  private sttService: AzureSTTService;
  private ttsService: AzureTTSService;
  private azureConfig: AzureSpeechConfig;
  
  private isInitialized: boolean = false;
  private healthStatus: ServiceHealth;
  private performanceMetrics: Map<string, PerformanceMetrics>;
  private requestHistory: Map<string, SpeechProcessingResult>;
  
  // 性能监控
  private metricsUpdateInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // 错误统计
  private errorCounts: Map<string, number> = new Map();
  private lastHealthCheck: number = 0;
  
  // 配置
  private readonly maxHistorySize = 1000;
  private readonly healthCheckIntervalMs = 30000; // 30秒
  private readonly metricsIntervalMs = 10000; // 10秒

  constructor(azureConfig: AzureSpeechConfig) {
    super();
    this.azureConfig = azureConfig;
    this.configManager = new SpeechConfigManager(azureConfig);
    this.sttService = new AzureSTTService(azureConfig, this.configManager);
    this.ttsService = new AzureTTSService(azureConfig, this.configManager);
    
    this.performanceMetrics = new Map();
    this.requestHistory = new Map();
    this.initializeHealthStatus();
    this.setupEventHandlers();
  }

  /**
   * 初始化语音服务
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Azure Speech Service...');

      // 初始化子服务
      await Promise.all([
        this.sttService.initialize(),
        this.ttsService.initialize()
      ]);

      // 启动监控
      this.startMonitoring();

      this.isInitialized = true;
      logger.info('Azure Speech Service initialized successfully');
      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize Azure Speech Service:', error);
      this.emit('error', { code: 'INIT_ERROR', message: error.message });
      throw error;
    }
  }

  /**
   * 完整语音处理流程
   */
  async processAudio(request: SpeechProcessingRequest): Promise<SpeechProcessingResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const processingId = `proc_${request.id}_${startTime}`;

    try {
      logger.debug(`Starting speech processing for request: ${request.id}`);

      // 初始化结果对象
      const result: SpeechProcessingResult = {
        id: request.id,
        callId: request.callId,
        processingTime: {
          total: 0,
          stt: 0,
          processing: 0,
          tts: 0,
          overhead: 0
        },
        quality: {
          audioQuality: 0,
          transcriptionConfidence: 0,
          responseRelevance: 0,
          overallScore: 0
        },
        cached: false
      };

      // 阶段1: 语音转文字
      if (request.options?.enableSTT !== false) {
        const sttStartTime = Date.now();
        result.transcript = await this.performSTT(request);
        result.processingTime.stt = Date.now() - sttStartTime;
        
        if (result.transcript) {
          result.quality.transcriptionConfidence = result.transcript.confidence;
        }
      }

      // 阶段2: 生成回复音频
      if (request.options?.enableTTS !== false && result.transcript) {
        const ttsStartTime = Date.now();
        const responseText = await this.generateResponse(result.transcript, request.context);
        
        if (responseText) {
          const ttsRequest = this.createTTSRequest(responseText, request.userProfile, request.id);
          const ttsResult = await this.ttsService.synthesize(ttsRequest);
          
          result.response = {
            text: responseText,
            audioData: ttsResult.audioData,
            metadata: ttsResult.metadata
          };
          result.cached = ttsResult.cached;
        }
        
        result.processingTime.tts = Date.now() - ttsStartTime;
      }

      // 计算总处理时间和质量分数
      result.processingTime.total = Date.now() - startTime;
      result.processingTime.overhead = result.processingTime.total - 
        result.processingTime.stt - result.processingTime.tts;
      
      result.quality = this.calculateQualityMetrics(result, request);

      // 存储历史记录
      this.storeRequestHistory(result);

      // 更新性能指标
      this.updatePerformanceMetrics(result);

      logger.info(`Speech processing completed for ${request.id} in ${result.processingTime.total}ms`);
      this.emit('processingCompleted', result);

      return result;

    } catch (error) {
      logger.error(`Speech processing failed for ${request.id}:`, error);
      this.recordError('processing', error);
      this.emit('processingError', { requestId: request.id, error });
      throw error;
    }
  }

  /**
   * 流式语音处理
   */
  async processAudioStream(request: SpeechProcessingRequest): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `stream_${request.callId}_${Date.now()}`;

    try {
      // 启动STT流式会话
      const sttSessionConfig: STTSessionConfig = {
        sessionId,
        language: request.userProfile?.language,
        enableWordTimestamps: true,
        continuousRecognition: true
      };

      await this.sttService.startSession(sttSessionConfig);

      // 设置流式事件处理
      this.setupStreamingEventHandlers(sessionId, request);

      logger.info(`Streaming speech processing started: ${sessionId}`);
      this.emit('streamingStarted', { sessionId, requestId: request.id });

      return sessionId;

    } catch (error) {
      logger.error(`Failed to start streaming processing for ${request.id}:`, error);
      throw error;
    }
  }

  /**
   * 处理流式音频数据
   */
  async processStreamChunk(sessionId: string, audioChunk: AudioChunk): Promise<void> {
    try {
      await this.sttService.processAudioStream(sessionId, audioChunk);
    } catch (error) {
      logger.error(`Failed to process stream chunk for session ${sessionId}:`, error);
      this.emit('streamingError', { sessionId, error });
    }
  }

  /**
   * 停止流式处理
   */
  async stopStreaming(sessionId: string): Promise<STTResult[]> {
    try {
      const results = await this.sttService.stopSession(sessionId);
      logger.info(`Streaming session stopped: ${sessionId}`);
      this.emit('streamingStopped', { sessionId, results });
      return results;
    } catch (error) {
      logger.error(`Failed to stop streaming session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * 配置语音参数
   */
  async configureVoice(userProfile: UserProfile): Promise<boolean> {
    try {
      // 根据用户画像推荐最佳语音
      const recommendedVoice = this.configManager.recommendVoice({
        personality: userProfile.personality,
        locale: userProfile.language
      });

      if (recommendedVoice) {
        const success = this.configManager.setSynthesisVoice(
          userProfile.preferredVoice || recommendedVoice.name,
          userProfile.language
        );

        if (success && userProfile.speechStyle) {
          this.configManager.setVoiceStyle(userProfile.speechStyle);
        }

        logger.info(`Voice configured for user ${userProfile.userId}: ${recommendedVoice.name}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to configure voice:', error);
      return false;
    }
  }

  /**
   * 获取服务健康状态
   */
  getHealthStatus(): ServiceHealth {
    return { ...this.healthStatus };
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(): PerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values());
  }

  /**
   * 获取请求历史
   */
  getRequestHistory(limit: number = 100): SpeechProcessingResult[] {
    const history = Array.from(this.requestHistory.values());
    return history.slice(-limit);
  }

  /**
   * 优化性能设置
   */
  optimizeForLatency(enabled: boolean = true): void {
    this.configManager.setLatencyOptimization(enabled);
    this.configManager.enableStreaming(enabled);
    
    if (enabled) {
      this.configManager.setAudioFormat(AudioFormat.OPUS, 16000);
    }

    logger.info(`Latency optimization ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure Speech Service...');

    // 停止监控
    this.stopMonitoring();

    // 清理子服务
    await Promise.all([
      this.sttService.cleanup(),
      this.ttsService.cleanup()
    ]);

    // 清理本地资源
    this.performanceMetrics.clear();
    this.requestHistory.clear();
    this.errorCounts.clear();
    this.isInitialized = false;

    logger.info('Azure Speech Service cleanup completed');
    this.emit('cleanup');
  }

  // 私有方法

  private async performSTT(request: SpeechProcessingRequest): Promise<STTResult | undefined> {
    try {
      const sessionId = `stt_${request.id}_${Date.now()}`;
      
      const sessionConfig: STTSessionConfig = {
        sessionId,
        language: request.userProfile?.language,
        enableWordTimestamps: true,
        continuousRecognition: false // 单次识别
      };

      await this.sttService.startSession(sessionConfig);
      await this.sttService.processAudioStream(sessionId, request.audioChunk);
      
      // 等待识别结果
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(undefined);
        }, 5000); // 5秒超时

        this.sttService.once('finalResult', (result: STTResult) => {
          if (result.sessionId === sessionId) {
            clearTimeout(timeout);
            resolve(result);
          }
        });
      });

    } catch (error) {
      logger.error('STT processing failed:', error);
      this.recordError('stt', error);
      return undefined;
    }
  }

  private async generateResponse(transcript: STTResult, context?: ConversationContext): Promise<string> {
    // 简化的响应生成逻辑
    // 实际项目中应该调用AI服务
    
    const responses = [
      '您好，我现在不方便接听电话。',
      '不好意思，我对这个不感兴趣。',
      '谢谢，我暂时不需要这个服务。',
      '请稍后再联系我。'
    ];

    // 根据转录内容选择合适的回复
    const text = transcript.text.toLowerCase();
    
    if (text.includes('贷款') || text.includes('借钱')) {
      return '我不需要贷款服务，谢谢。';
    } else if (text.includes('投资') || text.includes('理财')) {
      return '我对投资不感兴趣，谢谢。';
    } else if (text.includes('保险')) {
      return '我已经有保险了，不需要其他的。';
    } else {
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }

  private createTTSRequest(text: string, userProfile?: UserProfile, requestId?: string): TTSRequest {
    return {
      id: `tts_${requestId || Date.now()}`,
      text,
      voice: userProfile?.preferredVoice,
      style: userProfile?.speechStyle,
      priority: 'normal',
      streaming: false
    };
  }

  private calculateQualityMetrics(result: SpeechProcessingResult, request: SpeechProcessingRequest): QualityMetrics {
    let audioQuality = 0.8; // 默认音频质量
    let transcriptionConfidence = result.transcript?.confidence || 0;
    let responseRelevance = 0.9; // 简化的相关性分数
    
    // 基于音频chunk计算音频质量
    if (request.audioChunk.audioData) {
      audioQuality = this.assessAudioQuality(request.audioChunk.audioData);
    }

    const overallScore = (audioQuality * 0.3 + transcriptionConfidence * 0.4 + responseRelevance * 0.3);

    return {
      audioQuality,
      transcriptionConfidence,
      responseRelevance,
      overallScore
    };
  }

  private assessAudioQuality(audioData: Buffer | string): number {
    // 简化的音频质量评估
    if (typeof audioData === 'string') {
      // Base64数据，根据长度估算质量
      return Math.min(1.0, audioData.length / 10000);
    } else {
      // Buffer数据，根据大小和内容估算
      if (audioData.length < 1000) return 0.3;
      if (audioData.length < 5000) return 0.6;
      return 0.8;
    }
  }

  private storeRequestHistory(result: SpeechProcessingResult): void {
    this.requestHistory.set(result.id, result);
    
    // 限制历史记录大小
    if (this.requestHistory.size > this.maxHistorySize) {
      const firstKey = this.requestHistory.keys().next().value;
      this.requestHistory.delete(firstKey);
    }
  }

  private updatePerformanceMetrics(result: SpeechProcessingResult): void {
    const metrics: PerformanceMetrics = {
      connectionId: result.id,
      callId: result.callId,
      timestamp: Date.now(),
      latency: {
        totalPipeline: result.processingTime.total,
        audioPreprocessing: result.processingTime.overhead,
        speechToText: result.processingTime.stt,
        intentRecognition: 0, // 暂未实现
        aiGeneration: result.processingTime.processing,
        textToSpeech: result.processingTime.tts,
        networkTransmission: 0 // 暂未实现
      },
      throughput: {
        audioChunksPerSecond: 1, // 简化
        messagesPerSecond: 1,
        bytesPerSecond: result.response ? result.response.audioData.length : 0,
        concurrentConnections: this.performanceMetrics.size
      },
      resources: {
        cpuUsage: 0.5, // 模拟值
        memoryUsage: 0.3,
        networkUsage: 0.2,
        redisConnections: 0
      }
    };

    this.performanceMetrics.set(result.id, metrics);
  }

  private recordError(service: string, error: any): void {
    const key = `${service}_errors`;
    const count = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, count + 1);

    // 更新健康状态
    this.updateHealthStatus();
  }

  private setupEventHandlers(): void {
    // STT事件
    this.sttService.on('error', (error) => {
      this.recordError('stt', error);
      this.emit('sttError', error);
    });

    this.sttService.on('finalResult', (result) => {
      this.emit('transcriptionResult', result);
    });

    // TTS事件
    this.ttsService.on('error', (error) => {
      this.recordError('tts', error);
      this.emit('ttsError', error);
    });

    this.ttsService.on('synthesisCompleted', (result) => {
      this.emit('synthesisResult', result);
    });
  }

  private setupStreamingEventHandlers(sessionId: string, request: SpeechProcessingRequest): void {
    const finalResultHandler = async (result: STTResult) => {
      if (result.sessionId === sessionId && result.isFinal) {
        try {
          // 生成响应并合成语音
          const responseText = await this.generateResponse(result, request.context);
          
          if (responseText && request.userProfile) {
            const ttsRequest = this.createTTSRequest(responseText, request.userProfile, request.id);
            const streamSessionId = await this.ttsService.synthesizeStream(ttsRequest);
            
            this.emit('streamingResponse', {
              sessionId,
              requestId: request.id,
              transcript: result,
              responseText,
              ttsSessionId: streamSessionId
            });
          }
        } catch (error) {
          logger.error(`Failed to generate streaming response for session ${sessionId}:`, error);
        }
      }
    };

    this.sttService.on('finalResult', finalResultHandler);

    // 清理事件监听器
    const cleanup = () => {
      this.sttService.removeListener('finalResult', finalResultHandler);
    };

    this.once(`streamingStopped_${sessionId}`, cleanup);
  }

  private initializeHealthStatus(): void {
    this.healthStatus = {
      stt: {
        status: 'healthy',
        latency: 0,
        errorRate: 0,
        activeSessions: 0
      },
      tts: {
        status: 'healthy',
        latency: 0,
        errorRate: 0,
        cacheHitRate: 0
      },
      overall: {
        status: 'healthy',
        uptime: Date.now(),
        requestsPerMinute: 0
      }
    };
  }

  private updateHealthStatus(): void {
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastHealthCheck;
    
    // 计算错误率
    const sttErrors = this.errorCounts.get('stt_errors') || 0;
    const ttsErrors = this.errorCounts.get('tts_errors') || 0;
    const totalRequests = this.requestHistory.size;

    const sttErrorRate = totalRequests > 0 ? sttErrors / totalRequests : 0;
    const ttsErrorRate = totalRequests > 0 ? ttsErrors / totalRequests : 0;

    // 更新STT健康状态
    this.healthStatus.stt.errorRate = sttErrorRate;
    this.healthStatus.stt.activeSessions = this.sttService.getActiveSessions().length;
    this.healthStatus.stt.status = sttErrorRate > 0.1 ? 'degraded' : 'healthy';

    // 更新TTS健康状态
    this.healthStatus.tts.errorRate = ttsErrorRate;
    const ttsStats = this.ttsService.getCacheStats();
    this.healthStatus.tts.cacheHitRate = ttsStats.hitRate || 0;
    this.healthStatus.tts.status = ttsErrorRate > 0.1 ? 'degraded' : 'healthy';

    // 更新整体健康状态
    const overallErrorRate = (sttErrors + ttsErrors) / Math.max(totalRequests * 2, 1);
    if (overallErrorRate > 0.2) {
      this.healthStatus.overall.status = 'down';
    } else if (overallErrorRate > 0.1) {
      this.healthStatus.overall.status = 'degraded';
    } else {
      this.healthStatus.overall.status = 'healthy';
    }

    // 计算请求频率
    if (timeSinceLastCheck > 0) {
      const requestsInPeriod = Array.from(this.requestHistory.values())
        .filter(r => r.processingTime.total > (now - 60000)).length;
      this.healthStatus.overall.requestsPerMinute = requestsInPeriod;
    }

    this.lastHealthCheck = now;
  }

  private startMonitoring(): void {
    // 性能指标更新
    this.metricsUpdateInterval = setInterval(() => {
      this.updateHealthStatus();
      this.emit('metricsUpdated', this.healthStatus);
    }, this.metricsIntervalMs);

    // 健康检查
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckIntervalMs);
  }

  private stopMonitoring(): void {
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
      this.metricsUpdateInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      // 检查服务连接状态
      // 这里可以添加实际的健康检查逻辑
      
      this.updateHealthStatus();
      
      logger.debug('Health check completed', this.healthStatus);
      this.emit('healthCheckCompleted', this.healthStatus);

    } catch (error) {
      logger.error('Health check failed:', error);
      this.healthStatus.overall.status = 'down';
      this.emit('healthCheckFailed', error);
    }
  }
}