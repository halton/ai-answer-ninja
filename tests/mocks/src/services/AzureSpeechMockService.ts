import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
  SpeechToTextRequest,
  SpeechToTextResponse,
  TextToSpeechRequest,
  TextToSpeechResponse,
  MockServiceConfig,
  MockStats
} from '../types';

export class AzureSpeechMockService {
  private requestCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];
  private config: MockServiceConfig = {
    latency: { min: 100, max: 500 },
    errorRate: 0,
    responses: {}
  };

  private mockResponses = [
    "你好，我是张经理，有个投资项目想和你聊聊",
    "先生您好，我们这里有个很好的理财产品",
    "请问您需要贷款吗？我们利息很低",
    "恭喜您获得了我们银行的信用卡额度",
    "您好，我是房产顾问，有个楼盘想推荐给您"
  ];

  private voices = [
    { name: "zh-CN-XiaoxiaoNeural", displayName: "晓晓", locale: "zh-CN", gender: "Female" },
    { name: "zh-CN-YunyangNeural", displayName: "云扬", locale: "zh-CN", gender: "Male" },
    { name: "zh-CN-XiaoyiNeural", displayName: "晓伊", locale: "zh-CN", gender: "Female" },
    { name: "zh-CN-YunjianNeural", displayName: "云健", locale: "zh-CN", gender: "Male" }
  ];

  speechToText(request: SpeechToTextRequest): SpeechToTextResponse {
    const startTime = Date.now();
    this.requestCount++;

    try {
      // 模拟处理延迟
      this.simulateLatency();

      // 模拟错误
      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock STT service error');
      }

      // 随机选择一个模拟响应
      const text = this.mockResponses[Math.floor(Math.random() * this.mockResponses.length)];
      
      const response: SpeechToTextResponse = {
        text,
        confidence: 0.85 + Math.random() * 0.15, // 0.85-1.0
        offset: 0,
        duration: text.length * 100, // 模拟持续时间
        words: this.generateWordTimings(text)
      };

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('STT Mock Response:', { text: response.text, confidence: response.confidence });
      return response;

    } catch (error) {
      logger.error('STT Mock Error:', error);
      throw error;
    }
  }

  textToSpeech(request: TextToSpeechRequest): TextToSpeechResponse {
    const startTime = Date.now();
    this.requestCount++;

    try {
      // 模拟处理延迟
      this.simulateLatency();

      // 模拟错误
      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock TTS service error');
      }

      // 生成模拟音频数据（空的WAV文件头）
      const audioData = this.generateMockAudio(request.text);
      
      const response: TextToSpeechResponse = {
        audioData,
        contentType: 'audio/wav',
        duration: request.text.length * 80 // 模拟音频持续时间
      };

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('TTS Mock Response:', { 
        textLength: request.text.length, 
        audioSize: audioData.length,
        voice: request.voice || 'default'
      });
      
      return response;

    } catch (error) {
      logger.error('TTS Mock Error:', error);
      throw error;
    }
  }

  getVoicesList() {
    this.requestCount++;
    logger.info('Voices list requested');
    return {
      voices: this.voices
    };
  }

  configure(config: MockServiceConfig) {
    this.config = { ...this.config, ...config };
    logger.info('Speech mock service configured:', this.config);
  }

  reset() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.latencies = [];
    logger.info('Speech mock service reset');
  }

  getStats(): MockStats {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      averageLatency: this.latencies.length > 0 
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length 
        : 0,
      lastRequestTime: this.latencies.length > 0 ? new Date() : undefined,
      configuration: this.config
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  private simulateLatency() {
    const { min, max } = this.config.latency!;
    const latency = min + Math.random() * (max - min);
    
    // 在实际场景中这里会有真正的延迟，但在测试中我们跳过
    if (process.env.NODE_ENV !== 'test') {
      const start = Date.now();
      while (Date.now() - start < latency) {
        // 忙等待模拟延迟
      }
    }
  }

  private shouldSimulateError(): boolean {
    return Math.random() < (this.config.errorRate || 0);
  }

  private generateWordTimings(text: string) {
    const words = text.split(/\s+/);
    let offset = 0;
    
    return words.map(word => {
      const duration = word.length * 100;
      const wordTiming = {
        word,
        offset,
        duration,
        confidence: 0.8 + Math.random() * 0.2
      };
      offset += duration + 50; // 50ms 间隔
      return wordTiming;
    });
  }

  private generateMockAudio(text: string): Buffer {
    // 生成一个最小的WAV文件头 + 一些模拟音频数据
    const headerSize = 44;
    const dataSize = text.length * 100; // 根据文本长度模拟音频大小
    const totalSize = headerSize + dataSize;
    
    const buffer = Buffer.alloc(totalSize);
    
    // WAV 文件头
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(totalSize - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
    buffer.writeUInt16LE(1, 22); // NumChannels (Mono)
    buffer.writeUInt32LE(16000, 24); // SampleRate
    buffer.writeUInt32LE(32000, 28); // ByteRate
    buffer.writeUInt16LE(2, 32); // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // 填充模拟音频数据（随机噪音）
    for (let i = headerSize; i < totalSize; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    
    return buffer;
  }
}