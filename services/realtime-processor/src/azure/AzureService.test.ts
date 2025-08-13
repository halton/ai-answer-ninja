/**
 * Azure语音服务测试
 * 验证基本功能和集成
 */

import { AzureSpeechService, AzureSTTService, AzureTTSService, SpeechConfigManager } from './index';
import { AudioFormat } from '../types';

describe('Azure Speech Services', () => {
  const mockAzureConfig = {
    key: 'test-key',
    region: 'test-region',
    endpoint: 'https://test-region.api.cognitive.microsoft.com/',
    language: 'zh-CN',
    outputFormat: 'riff-24khz-16bit-mono-pcm'
  };

  describe('SpeechConfigManager', () => {
    let configManager: SpeechConfigManager;

    beforeEach(() => {
      configManager = new SpeechConfigManager(mockAzureConfig);
    });

    test('should initialize with default configuration', () => {
      const recognitionConfig = configManager.getRecognitionConfig();
      const synthesisConfig = configManager.getSynthesisConfig();

      expect(recognitionConfig.language).toBe('zh-CN');
      expect(recognitionConfig.sampleRate).toBe(16000);
      expect(synthesisConfig.voice.name).toBe('zh-CN-XiaoxiaoNeural');
      expect(synthesisConfig.sampleRate).toBe(24000);
    });

    test('should set recognition language', () => {
      configManager.setRecognitionLanguage('en-US');
      const config = configManager.getRecognitionConfig();
      expect(config.language).toBe('en-US');
    });

    test('should set synthesis voice', () => {
      const success = configManager.setSynthesisVoice('zh-CN-YunyangNeural');
      expect(success).toBe(true);
      
      const config = configManager.getSynthesisConfig();
      expect(config.voice.name).toBe('zh-CN-YunyangNeural');
    });

    test('should set voice style for neural voices', () => {
      const success = configManager.setVoiceStyle('friendly', 1.2);
      expect(success).toBe(true);
      
      const config = configManager.getSynthesisConfig();
      expect(config.voice.style).toBe('friendly');
      expect(config.voice.degree).toBe(1.2);
    });

    test('should set prosody parameters', () => {
      configManager.setProsody(1.2, 10, 0.8);
      const config = configManager.getSynthesisConfig();
      
      expect(config.prosody.rate).toBe(1.2);
      expect(config.prosody.pitch).toBe(10);
      expect(config.prosody.volume).toBe(0.8);
    });

    test('should set audio format', () => {
      configManager.setAudioFormat(AudioFormat.OPUS, 48000);
      const config = configManager.getSynthesisConfig();
      
      expect(config.format).toBe(AudioFormat.OPUS);
      expect(config.sampleRate).toBe(48000);
    });

    test('should recommend voice based on user profile', () => {
      const voice = configManager.recommendVoice({
        gender: 'female',
        personality: 'friendly',
        locale: 'zh-CN'
      });

      expect(voice).toBeDefined();
      expect(voice?.locale).toBe('zh-CN');
      expect(voice?.gender).toBe('Female');
    });

    test('should get available voices', () => {
      const allVoices = configManager.getAvailableVoices();
      const chineseVoices = configManager.getAvailableVoices('zh-CN');

      expect(allVoices.length).toBeGreaterThan(0);
      expect(chineseVoices.length).toBeGreaterThan(0);
      expect(chineseVoices.every(v => v.locale === 'zh-CN')).toBe(true);
    });

    test('should validate configuration', () => {
      const validation = configManager.validateConfig();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should generate Azure config strings', () => {
      const azureConfig = configManager.generateAzureConfig();
      
      expect(azureConfig.recognitionConfig).toBeDefined();
      expect(azureConfig.synthesisConfig).toBeDefined();
      
      const recognitionConfig = JSON.parse(azureConfig.recognitionConfig);
      expect(recognitionConfig.language).toBe('zh-CN');
      
      const synthesisConfig = JSON.parse(azureConfig.synthesisConfig);
      expect(synthesisConfig.voice).toBe('zh-CN-XiaoxiaoNeural');
    });

    test('should enable latency optimization', () => {
      configManager.setLatencyOptimization(true);
      const optimizationConfig = configManager.getOptimizationConfig();
      
      expect(optimizationConfig.latencyOptimized).toBe(true);
      expect(optimizationConfig.timeout).toBe(10000);
      expect(optimizationConfig.compressionLevel).toBe(3);
    });

    test('should enable streaming', () => {
      configManager.enableStreaming(true);
      const optimizationConfig = configManager.getOptimizationConfig();
      
      expect(optimizationConfig.streaming).toBe(true);
      expect(optimizationConfig.latencyOptimized).toBe(true);
      expect(optimizationConfig.bufferSize).toBe(2048);
    });
  });

  describe('AzureSTTService', () => {
    let sttService: AzureSTTService;
    let configManager: SpeechConfigManager;

    beforeEach(() => {
      configManager = new SpeechConfigManager(mockAzureConfig);
      sttService = new AzureSTTService(mockAzureConfig, configManager);
    });

    afterEach(async () => {
      await sttService.cleanup();
    });

    test('should initialize successfully', async () => {
      await expect(sttService.initialize()).resolves.not.toThrow();
    });

    test('should start and stop session', async () => {
      await sttService.initialize();
      
      const sessionConfig = {
        sessionId: 'test-session-001',
        language: 'zh-CN',
        enableWordTimestamps: true,
        continuousRecognition: true
      };

      const sessionId = await sttService.startSession(sessionConfig);
      expect(sessionId).toBe(sessionConfig.sessionId);

      const activeSessions = sttService.getActiveSessions();
      expect(activeSessions).toContain(sessionId);

      const results = await sttService.stopSession(sessionId);
      expect(Array.isArray(results)).toBe(true);

      const activeSessionsAfter = sttService.getActiveSessions();
      expect(activeSessionsAfter).not.toContain(sessionId);
    });

    test('should get session statistics', async () => {
      await sttService.initialize();
      
      const sessionId = await sttService.startSession({
        sessionId: 'stats-test-session',
        language: 'zh-CN'
      });

      const stats = sttService.getSessionStats(sessionId);
      expect(stats).toBeDefined();
      expect(stats.sessionId).toBe(sessionId);
      expect(stats.isActive).toBe(true);
      expect(stats.startTime).toBeGreaterThan(0);

      await sttService.stopSession(sessionId);
    });

    test('should handle audio processing', async () => {
      await sttService.initialize();
      
      const sessionId = await sttService.startSession({
        sessionId: 'audio-test-session',
        language: 'zh-CN'
      });

      const audioChunk = {
        id: 'chunk-001',
        callId: 'call-001',
        timestamp: Date.now(),
        audioData: Buffer.alloc(1024), // Mock audio data
        sequenceNumber: 1,
        sampleRate: 16000,
        channels: 1,
        format: AudioFormat.WAV
      };

      await expect(
        sttService.processAudioStream(sessionId, audioChunk)
      ).resolves.not.toThrow();

      await sttService.stopSession(sessionId);
    });
  });

  describe('AzureTTSService', () => {
    let ttsService: AzureTTSService;
    let configManager: SpeechConfigManager;

    beforeEach(() => {
      configManager = new SpeechConfigManager(mockAzureConfig);
      ttsService = new AzureTTSService(mockAzureConfig, configManager);
    });

    afterEach(async () => {
      await ttsService.cleanup();
    });

    test('should initialize successfully', async () => {
      await expect(ttsService.initialize()).resolves.not.toThrow();
    });

    test('should synthesize text to speech', async () => {
      await ttsService.initialize();

      const request = {
        id: 'tts-test-001',
        text: '您好，这是一个测试。',
        voice: 'zh-CN-XiaoxiaoNeural',
        format: AudioFormat.WAV,
        priority: 'normal' as const
      };

      const result = await ttsService.synthesize(request);
      
      expect(result.id).toBe(request.id);
      expect(result.audioData).toBeInstanceOf(Buffer);
      expect(result.audioData.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.processingTime).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
    });

    test('should handle batch synthesis', async () => {
      await ttsService.initialize();

      const requests = [
        {
          id: 'batch-001',
          text: '第一个测试文本',
          priority: 'high' as const
        },
        {
          id: 'batch-002', 
          text: '第二个测试文本',
          priority: 'normal' as const
        },
        {
          id: 'batch-003',
          text: '第三个测试文本',
          priority: 'low' as const
        }
      ];

      const results = await ttsService.synthesizeBatch(requests);
      
      expect(results).toHaveLength(3);
      expect(results.every(r => r.audioData.length > 0)).toBe(true);
    });

    test('should start and stop streaming synthesis', async () => {
      await ttsService.initialize();

      const request = {
        id: 'stream-test-001',
        text: '这是一个流式合成测试文本。',
        streaming: true
      };

      const sessionId = await ttsService.synthesizeStream(request);
      expect(sessionId).toBeDefined();
      expect(sessionId).toContain('stream_');

      // 等待一些音频数据
      await new Promise(resolve => setTimeout(resolve, 200));

      await ttsService.stopStreaming(sessionId);
    });

    test('should use cache for repeated requests', async () => {
      await ttsService.initialize();

      const request = {
        id: 'cache-test-001',
        text: '缓存测试文本',
        cacheKey: 'test-cache-key'
      };

      // 第一次请求
      const result1 = await ttsService.synthesize(request);
      expect(result1.cached).toBe(false);

      // 第二次相同请求
      const result2 = await ttsService.synthesize({
        ...request,
        id: 'cache-test-002'
      });
      expect(result2.cached).toBe(true);
      expect(result2.processingTime).toBeLessThan(result1.processingTime);
    });

    test('should get precomputed responses', async () => {
      await ttsService.initialize();

      const politeDecline = ttsService.getPrecomputedResponse('polite_decline');
      const notInterested = ttsService.getPrecomputedResponse('not_interested');

      expect(politeDecline).toBeInstanceOf(Buffer);
      expect(notInterested).toBeInstanceOf(Buffer);
    });

    test('should provide cache statistics', async () => {
      await ttsService.initialize();

      const stats = ttsService.getCacheStats();
      
      expect(stats).toHaveProperty('totalItems');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('precomputedResponses');
    });
  });

  describe('AzureSpeechService Integration', () => {
    let speechService: AzureSpeechService;

    beforeEach(() => {
      speechService = new AzureSpeechService(mockAzureConfig);
    });

    afterEach(async () => {
      await speechService.cleanup();
    });

    test('should initialize main service', async () => {
      await expect(speechService.initialize()).resolves.not.toThrow();
    });

    test('should process audio end-to-end', async () => {
      await speechService.initialize();

      const request = {
        id: 'integration-test-001',
        callId: 'call-001',
        audioChunk: {
          id: 'chunk-001',
          callId: 'call-001',
          timestamp: Date.now(),
          audioData: Buffer.alloc(2048), // Mock audio data
          sequenceNumber: 1,
          sampleRate: 16000,
          channels: 1,
          format: AudioFormat.WAV
        },
        userProfile: {
          userId: 'user-001',
          preferredVoice: 'zh-CN-XiaoxiaoNeural',
          personality: 'friendly',
          language: 'zh-CN'
        },
        options: {
          enableSTT: true,
          enableTTS: true,
          latencyOptimized: true
        }
      };

      const result = await speechService.processAudio(request);
      
      expect(result.id).toBe(request.id);
      expect(result.callId).toBe(request.callId);
      expect(result.processingTime.total).toBeGreaterThan(0);
      expect(result.quality.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.quality.overallScore).toBeLessThanOrEqual(1);
    });

    test('should configure voice based on user profile', async () => {
      await speechService.initialize();

      const userProfile = {
        userId: 'user-002',
        personality: 'professional',
        language: 'zh-CN'
      };

      const success = await speechService.configureVoice(userProfile);
      expect(success).toBe(true);
    });

    test('should provide health status', async () => {
      await speechService.initialize();

      const health = speechService.getHealthStatus();
      
      expect(health).toHaveProperty('stt');
      expect(health).toHaveProperty('tts');
      expect(health).toHaveProperty('overall');
      
      expect(health.stt.status).toBe('healthy');
      expect(health.tts.status).toBe('healthy');
      expect(health.overall.status).toBe('healthy');
    });

    test('should optimize for latency', () => {
      speechService.optimizeForLatency(true);
      
      // 验证配置已更改
      const health = speechService.getHealthStatus();
      expect(health).toBeDefined();
    });

    test('should handle streaming audio processing', async () => {
      await speechService.initialize();

      const request = {
        id: 'stream-integration-001',
        callId: 'call-002',
        audioChunk: {
          id: 'stream-chunk-001',
          callId: 'call-002',
          timestamp: Date.now(),
          audioData: Buffer.alloc(1024),
          sequenceNumber: 1,
          format: AudioFormat.WAV
        },
        userProfile: {
          userId: 'user-003',
          language: 'zh-CN'
        },
        options: {
          streamingMode: true
        }
      };

      const sessionId = await speechService.processAudioStream(request);
      expect(sessionId).toBeDefined();
      expect(sessionId).toContain('stream_');

      // 发送更多音频块
      await speechService.processStreamChunk(sessionId, {
        ...request.audioChunk,
        id: 'stream-chunk-002',
        sequenceNumber: 2
      });

      const results = await speechService.stopStreaming(sessionId);
      expect(Array.isArray(results)).toBe(true);
    });

    test('should track performance metrics', async () => {
      await speechService.initialize();

      // 处理一些请求以生成指标
      const request = {
        id: 'metrics-test-001',
        callId: 'call-003',
        audioChunk: {
          id: 'metrics-chunk-001',
          callId: 'call-003',
          timestamp: Date.now(),
          audioData: Buffer.alloc(512),
          sequenceNumber: 1,
          format: AudioFormat.WAV
        },
        userProfile: {
          userId: 'user-004',
          language: 'zh-CN'
        }
      };

      await speechService.processAudio(request);

      const metrics = speechService.getPerformanceMetrics();
      expect(Array.isArray(metrics)).toBe(true);

      const history = speechService.getRequestHistory(10);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });
  });
});

// 集成测试辅助函数
export const createTestAudioBuffer = (durationMs: number = 1000, sampleRate: number = 16000): Buffer => {
  const samplesCount = Math.floor(durationMs * sampleRate / 1000);
  const buffer = Buffer.alloc(samplesCount * 2); // 16-bit samples
  
  // 生成简单的正弦波测试音频
  for (let i = 0; i < samplesCount; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0x7FFF;
    buffer.writeInt16LE(sample, i * 2);
  }
  
  return buffer;
};

export const createTestAudioChunk = (callId: string, sequenceNumber: number) => {
  return {
    id: `chunk-${sequenceNumber}`,
    callId,
    timestamp: Date.now(),
    audioData: createTestAudioBuffer(500), // 500ms of audio
    sequenceNumber,
    sampleRate: 16000,
    channels: 1,
    format: AudioFormat.WAV
  };
};