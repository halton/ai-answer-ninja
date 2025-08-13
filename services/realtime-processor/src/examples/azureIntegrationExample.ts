/**
 * Azure语音服务集成示例
 * 展示如何在实际项目中使用Azure语音服务
 */

import { AzureSpeechService, AzureSTTService, AzureTTSService } from '../azure';
import { AudioFormat } from '../types';
import { logger } from '../utils/logger';

// 模拟的Azure配置
const azureConfig = {
  key: process.env.AZURE_SPEECH_KEY || 'your-azure-speech-key',
  region: process.env.AZURE_SPEECH_REGION || 'eastasia',
  endpoint: process.env.AZURE_SPEECH_ENDPOINT || 'https://eastasia.api.cognitive.microsoft.com/',
  language: 'zh-CN',
  outputFormat: 'riff-24khz-16bit-mono-pcm'
};

/**
 * 示例1: 基础语音处理流程
 */
export async function basicSpeechProcessingExample() {
  logger.info('开始基础语音处理示例...');

  const speechService = new AzureSpeechService(azureConfig);
  
  try {
    // 初始化服务
    await speechService.initialize();
    logger.info('Azure语音服务初始化成功');

    // 模拟音频数据
    const audioData = generateMockAudioData();
    
    // 处理音频
    const result = await speechService.processAudio({
      id: 'example-request-001',
      callId: 'call-example-001',
      audioChunk: {
        id: 'chunk-001',
        callId: 'call-example-001',
        timestamp: Date.now(),
        audioData: audioData,
        sequenceNumber: 1,
        sampleRate: 16000,
        channels: 1,
        format: AudioFormat.WAV
      },
      userProfile: {
        userId: 'user-example-001',
        preferredVoice: 'zh-CN-XiaoxiaoNeural',
        personality: 'friendly',
        speechStyle: 'assistant',
        language: 'zh-CN'
      },
      options: {
        enableSTT: true,
        enableTTS: true,
        latencyOptimized: true,
        qualityMode: 'balanced',
        cacheEnabled: true
      }
    });

    logger.info('语音处理完成:', {
      requestId: result.id,
      transcriptText: result.transcript?.text,
      responseText: result.response?.text,
      processingTime: result.processingTime,
      qualityScore: result.quality.overallScore
    });

    // 清理资源
    await speechService.cleanup();
    
  } catch (error) {
    logger.error('基础语音处理示例失败:', error);
  }
}

/**
 * 示例2: 流式语音处理
 */
export async function streamingSpeechExample() {
  logger.info('开始流式语音处理示例...');

  const speechService = new AzureSpeechService(azureConfig);
  
  try {
    await speechService.initialize();

    // 用户画像
    const userProfile = {
      userId: 'streaming-user-001',
      preferredVoice: 'zh-CN-YunyangNeural',
      personality: 'professional',
      language: 'zh-CN'
    };

    // 配置语音
    await speechService.configureVoice(userProfile);

    // 启动流式处理
    const sessionId = await speechService.processAudioStream({
      id: 'streaming-request-001',
      callId: 'streaming-call-001',
      audioChunk: {
        id: 'stream-chunk-001',
        callId: 'streaming-call-001',
        timestamp: Date.now(),
        audioData: generateMockAudioData(),
        sequenceNumber: 1,
        format: AudioFormat.WAV
      },
      userProfile,
      context: {
        sessionId: 'conversation-session-001',
        turnCount: 1,
        conversationHistory: []
      },
      options: {
        streamingMode: true,
        latencyOptimized: true
      }
    });

    logger.info(`流式会话已启动: ${sessionId}`);

    // 监听流式结果
    speechService.on('streamingResponse', (data) => {
      logger.info('收到流式响应:', {
        sessionId: data.sessionId,
        transcript: data.transcript.text,
        response: data.responseText,
        confidence: data.transcript.confidence
      });
    });

    // 模拟连续音频数据流
    const audioChunks = generateMockAudioStream(5); // 5个音频块
    for (let i = 0; i < audioChunks.length; i++) {
      await speechService.processStreamChunk(sessionId, {
        id: `stream-chunk-${i + 2}`,
        callId: 'streaming-call-001',
        timestamp: Date.now(),
        audioData: audioChunks[i],
        sequenceNumber: i + 2,
        format: AudioFormat.WAV
      });

      // 模拟实时处理间隔
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 停止流式处理
    const results = await speechService.stopStreaming(sessionId);
    logger.info(`流式处理完成，共收到 ${results.length} 个结果`);

    await speechService.cleanup();

  } catch (error) {
    logger.error('流式语音处理示例失败:', error);
  }
}

/**
 * 示例3: 独立STT服务使用
 */
export async function sttServiceExample() {
  logger.info('开始STT服务示例...');

  const sttService = new AzureSTTService(azureConfig);
  
  try {
    await sttService.initialize();

    // 开始识别会话
    const sessionId = await sttService.startSession({
      sessionId: 'stt-example-session',
      language: 'zh-CN',
      enableWordTimestamps: true,
      enableProfanityFilter: false,
      continuousRecognition: true,
      timeout: 30000
    });

    logger.info(`STT会话已启动: ${sessionId}`);

    // 监听识别结果
    sttService.on('partialResult', (result) => {
      logger.debug('部分识别结果:', result.text);
    });

    sttService.on('finalResult', (result) => {
      logger.info('最终识别结果:', {
        text: result.text,
        confidence: result.confidence,
        words: result.words?.length,
        duration: result.duration
      });
    });

    sttService.on('lowQuality', (data) => {
      logger.warn('检测到低质量音频:', {
        sessionId: data.sessionId,
        quality: data.quality
      });
    });

    // 发送音频数据
    const audioChunks = generateMockAudioStream(3);
    for (let i = 0; i < audioChunks.length; i++) {
      await sttService.processAudioStream(sessionId, {
        id: `stt-chunk-${i + 1}`,
        callId: 'stt-call-001',
        timestamp: Date.now(),
        audioData: audioChunks[i],
        sequenceNumber: i + 1,
        sampleRate: 16000,
        channels: 1,
        format: AudioFormat.WAV
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 获取会话统计
    const stats = sttService.getSessionStats(sessionId);
    logger.info('会话统计:', stats);

    // 停止会话
    const finalResults = await sttService.stopSession(sessionId);
    logger.info(`STT会话结束，共识别 ${finalResults.length} 段语音`);

    await sttService.cleanup();

  } catch (error) {
    logger.error('STT服务示例失败:', error);
  }
}

/**
 * 示例4: 独立TTS服务使用
 */
export async function ttsServiceExample() {
  logger.info('开始TTS服务示例...');

  const ttsService = new AzureTTSService(azureConfig);
  
  try {
    await sttService.initialize();

    // 单个文本合成
    const synthesisResult = await ttsService.synthesize({
      id: 'tts-example-001',
      text: '您好，我是AI助手。我现在不方便接听电话，请稍后再联系我。',
      voice: 'zh-CN-XiaoxiaoNeural',
      style: 'friendly',
      rate: 1.0,
      pitch: 0,
      volume: 1.0,
      format: AudioFormat.WAV,
      priority: 'high'
    });

    logger.info('语音合成完成:', {
      audioSize: synthesisResult.audioData.length,
      duration: synthesisResult.duration,
      processingTime: synthesisResult.processingTime,
      cached: synthesisResult.cached
    });

    // 批量合成
    const batchRequests = [
      {
        id: 'batch-001',
        text: '不好意思，我对这个不感兴趣。',
        priority: 'high' as const
      },
      {
        id: 'batch-002',
        text: '谢谢，我暂时不需要这个服务。',
        priority: 'normal' as const
      },
      {
        id: 'batch-003',
        text: '我现在有事在忙，请稍后再联系。',
        priority: 'low' as const
      }
    ];

    const batchResults = await ttsService.synthesizeBatch(batchRequests);
    logger.info(`批量合成完成，共处理 ${batchResults.length} 个请求`);

    // 流式合成
    const streamSessionId = await ttsService.synthesizeStream({
      id: 'stream-tts-001',
      text: '这是一段较长的文本，将被流式合成为语音。流式合成可以降低首字节延迟，提供更好的用户体验。',
      voice: 'zh-CN-YunyangNeural',
      style: 'newscast',
      streaming: true
    });

    logger.info(`流式合成已启动: ${streamSessionId}`);

    // 监听音频流
    ttsService.on('audioChunk', (data) => {
      logger.debug('收到音频块:', {
        sessionId: data.sessionId,
        size: data.size
      });
    });

    // 等待流式合成完成
    await new Promise(resolve => {
      ttsService.once('synthesisCompleted', () => {
        logger.info('流式合成完成');
        resolve(void 0);
      });
    });

    await ttsService.stopStreaming(streamSessionId);

    // 获取缓存统计
    const cacheStats = ttsService.getCacheStats();
    logger.info('TTS缓存统计:', cacheStats);

    // 测试预计算回复
    const precomputedResponse = ttsService.getPrecomputedResponse('polite_decline');
    if (precomputedResponse) {
      logger.info(`预计算回复可用，大小: ${precomputedResponse.length} 字节`);
    }

    await ttsService.cleanup();

  } catch (error) {
    logger.error('TTS服务示例失败:', error);
  }
}

/**
 * 示例5: 服务监控和性能分析
 */
export async function monitoringExample() {
  logger.info('开始服务监控示例...');

  const speechService = new AzureSpeechService(azureConfig);
  
  try {
    await speechService.initialize();

    // 监听服务事件
    speechService.on('processingCompleted', (result) => {
      logger.info('处理完成事件:', {
        requestId: result.id,
        totalLatency: result.processingTime.total,
        qualityScore: result.quality.overallScore
      });
    });

    speechService.on('metricsUpdated', (healthStatus) => {
      logger.info('指标更新:', {
        sttStatus: healthStatus.stt.status,
        ttsStatus: healthStatus.tts.status,
        overallStatus: healthStatus.overall.status,
        requestsPerMinute: healthStatus.overall.requestsPerMinute
      });
    });

    speechService.on('error', (error) => {
      logger.error('服务错误:', error);
    });

    // 启用延迟优化
    speechService.optimizeForLatency(true);

    // 处理多个请求以生成监控数据
    for (let i = 0; i < 5; i++) {
      await speechService.processAudio({
        id: `monitoring-request-${i + 1}`,
        callId: `monitoring-call-${i + 1}`,
        audioChunk: {
          id: `monitoring-chunk-${i + 1}`,
          callId: `monitoring-call-${i + 1}`,
          timestamp: Date.now(),
          audioData: generateMockAudioData(),
          sequenceNumber: 1,
          format: AudioFormat.WAV
        },
        userProfile: {
          userId: `monitoring-user-${i + 1}`,
          language: 'zh-CN'
        },
        options: {
          latencyOptimized: true,
          qualityMode: 'fast'
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 获取健康状态
    const health = speechService.getHealthStatus();
    logger.info('服务健康状态:', health);

    // 获取性能指标
    const metrics = speechService.getPerformanceMetrics();
    logger.info(`收集到 ${metrics.length} 个性能指标数据点`);

    // 获取请求历史
    const history = speechService.getRequestHistory(10);
    logger.info(`最近 ${history.length} 个请求的历史记录`);

    // 分析平均延迟
    const avgLatency = history.reduce((sum, req) => sum + req.processingTime.total, 0) / history.length;
    logger.info(`平均处理延迟: ${avgLatency.toFixed(2)}ms`);

    // 分析质量分数
    const avgQuality = history.reduce((sum, req) => sum + req.quality.overallScore, 0) / history.length;
    logger.info(`平均质量分数: ${avgQuality.toFixed(2)}`);

    await speechService.cleanup();

  } catch (error) {
    logger.error('服务监控示例失败:', error);
  }
}

/**
 * 运行所有示例
 */
export async function runAllExamples() {
  logger.info('开始运行所有Azure语音服务示例...');

  try {
    await basicSpeechProcessingExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await streamingSpeechExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await sttServiceExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await ttsServiceExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await monitoringExample();

    logger.info('所有示例运行完成！');

  } catch (error) {
    logger.error('示例运行失败:', error);
  }
}

// 辅助函数

function generateMockAudioData(): Buffer {
  // 生成1秒钟的16kHz单声道音频数据
  const sampleRate = 16000;
  const duration = 1; // 秒
  const samplesCount = sampleRate * duration;
  const buffer = Buffer.alloc(samplesCount * 2); // 16-bit samples

  // 生成440Hz正弦波（A音）
  for (let i = 0; i < samplesCount; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0x7FFF;
    buffer.writeInt16LE(sample, i * 2);
  }

  return buffer;
}

function generateMockAudioStream(chunkCount: number): Buffer[] {
  const chunks: Buffer[] = [];
  
  for (let i = 0; i < chunkCount; i++) {
    // 每个块500ms的音频数据
    const sampleRate = 16000;
    const duration = 0.5; // 秒
    const samplesCount = Math.floor(sampleRate * duration);
    const buffer = Buffer.alloc(samplesCount * 2);

    // 生成不同频率的正弦波
    const frequency = 440 + (i * 110); // A, B, C#, D#, F#
    for (let j = 0; j < samplesCount; j++) {
      const sample = Math.sin(2 * Math.PI * frequency * j / sampleRate) * 0x7FFF;
      buffer.writeInt16LE(sample, j * 2);
    }

    chunks.push(buffer);
  }

  return chunks;
}

// 如果直接运行此文件，则执行所有示例
if (require.main === module) {
  runAllExamples().catch(console.error);
}