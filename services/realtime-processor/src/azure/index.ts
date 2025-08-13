/**
 * Azure语音服务模块导出
 * 提供完整的Azure Speech Services集成
 */

// 主要服务类
export { AzureSpeechService } from './AzureSpeechService';
export { AzureSTTService } from './AzureSTTService';
export { AzureTTSService } from './AzureTTSService';
export { SpeechConfigManager } from './SpeechConfigManager';

// STT相关类型和接口
export type {
  STTResult,
  WordResult,
  STTError,
  STTSessionConfig,
  RecognitionSession
} from './AzureSTTService';

// TTS相关类型和接口
export type {
  TTSRequest,
  TTSResult,
  TTSMetadata,
  VisemeData,
  WordBoundary,
  TTSCache,
  StreamingTTSSession
} from './AzureTTSService';

// 配置相关类型和接口
export type {
  VoiceConfig,
  SpeechRecognitionConfig,
  SpeechSynthesisConfig,
  OptimizationConfig
} from './SpeechConfigManager';

// 主控制器相关类型和接口
export type {
  SpeechProcessingRequest,
  UserProfile,
  ConversationContext,
  ProcessingOptions,
  SpeechProcessingResult,
  LatencyBreakdown,
  QualityMetrics,
  ServiceHealth
} from './AzureSpeechService';

// 便利函数和工具
export class AzureSpeechFactory {
  /**
   * 创建完整的Azure语音服务实例
   */
  static createSpeechService(azureConfig: any): AzureSpeechService {
    return new AzureSpeechService(azureConfig);
  }

  /**
   * 创建独立的STT服务
   */
  static createSTTService(azureConfig: any, configManager?: SpeechConfigManager): AzureSTTService {
    return new AzureSTTService(azureConfig, configManager);
  }

  /**
   * 创建独立的TTS服务
   */
  static createTTSService(azureConfig: any, configManager?: SpeechConfigManager): AzureTTSService {
    return new AzureTTSService(azureConfig, configManager);
  }

  /**
   * 创建配置管理器
   */
  static createConfigManager(azureConfig: any): SpeechConfigManager {
    return new SpeechConfigManager(azureConfig);
  }

  /**
   * 验证Azure配置
   */
  static validateConfig(azureConfig: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!azureConfig) {
      errors.push('Azure config is required');
      return { valid: false, errors };
    }

    if (!azureConfig.key) {
      errors.push('Azure Speech API key is required');
    }

    if (!azureConfig.region) {
      errors.push('Azure Speech region is required');
    }

    if (!azureConfig.endpoint) {
      errors.push('Azure Speech endpoint is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取推荐的配置
   */
  static getRecommendedConfig(): Partial<any> {
    return {
      language: 'zh-CN',
      outputFormat: 'riff-24khz-16bit-mono-pcm',
      voice: 'zh-CN-XiaoxiaoNeural',
      style: 'general',
      prosody: {
        rate: 1.0,
        pitch: 0,
        volume: 1.0
      },
      optimization: {
        streaming: true,
        latencyOptimized: true,
        compressionLevel: 6,
        timeout: 30000
      }
    };
  }
}

// 常量定义
export const AZURE_SPEECH_CONSTANTS = {
  // 支持的语音格式
  SUPPORTED_AUDIO_FORMATS: ['wav', 'mp3', 'opus', 'aac', 'pcm'],
  
  // 支持的语言
  SUPPORTED_LANGUAGES: [
    'zh-CN', 'zh-TW', 'zh-HK',
    'en-US', 'en-GB', 'en-AU',
    'ja-JP', 'ko-KR', 'fr-FR',
    'de-DE', 'es-ES', 'it-IT'
  ],
  
  // 默认配置值
  DEFAULT_SAMPLE_RATE: 24000,
  DEFAULT_CHANNELS: 1,
  DEFAULT_BIT_DEPTH: 16,
  DEFAULT_TIMEOUT: 30000,
  
  // 性能阈值
  LATENCY_THRESHOLDS: {
    EXCELLENT: 500,
    GOOD: 1000,
    ACCEPTABLE: 1500,
    POOR: 2000
  },
  
  // 质量阈值
  QUALITY_THRESHOLDS: {
    AUDIO_QUALITY_MIN: 0.6,
    CONFIDENCE_MIN: 0.7,
    RELEVANCE_MIN: 0.8
  },
  
  // 缓存配置
  CACHE_SETTINGS: {
    MAX_SIZE: 100 * 1024 * 1024, // 100MB
    MAX_AGE: 24 * 60 * 60 * 1000, // 24小时
    CLEANUP_INTERVAL: 60 * 1000   // 1分钟
  }
};

// 错误代码
export const AZURE_SPEECH_ERROR_CODES = {
  // 初始化错误
  INIT_ERROR: 'AZURE_SPEECH_INIT_ERROR',
  CONFIG_ERROR: 'AZURE_SPEECH_CONFIG_ERROR',
  
  // STT错误
  STT_SESSION_ERROR: 'AZURE_STT_SESSION_ERROR',
  STT_PROCESSING_ERROR: 'AZURE_STT_PROCESSING_ERROR',
  STT_TIMEOUT_ERROR: 'AZURE_STT_TIMEOUT_ERROR',
  
  // TTS错误
  TTS_SYNTHESIS_ERROR: 'AZURE_TTS_SYNTHESIS_ERROR',
  TTS_CACHE_ERROR: 'AZURE_TTS_CACHE_ERROR',
  TTS_STREAMING_ERROR: 'AZURE_TTS_STREAMING_ERROR',
  
  // 通用错误
  AUDIO_FORMAT_ERROR: 'AZURE_AUDIO_FORMAT_ERROR',
  NETWORK_ERROR: 'AZURE_NETWORK_ERROR',
  QUOTA_EXCEEDED: 'AZURE_QUOTA_EXCEEDED',
  AUTHENTICATION_ERROR: 'AZURE_AUTH_ERROR'
};

/**
 * 工具函数
 */
export class AzureSpeechUtils {
  /**
   * 计算音频时长（毫秒）
   */
  static calculateAudioDuration(audioData: Buffer, sampleRate: number = 24000): number {
    const bytesPerSample = 2; // 16-bit
    const channels = 1; // mono
    const totalSamples = audioData.length / (bytesPerSample * channels);
    return (totalSamples / sampleRate) * 1000;
  }

  /**
   * 转换音频格式枚举到Azure格式字符串
   */
  static audioFormatToAzureFormat(format: string): string {
    const formatMap: Record<string, string> = {
      'wav': 'riff-24khz-16bit-mono-pcm',
      'mp3': 'audio-24khz-48kbitrate-mono-mp3',
      'opus': 'ogg-48khz-16bit-mono-opus',
      'aac': 'audio-24khz-48kbitrate-mono-aac',
      'pcm': 'raw-24khz-16bit-mono-pcm'
    };
    return formatMap[format] || formatMap['wav'];
  }

  /**
   * 生成缓存键
   */
  static generateCacheKey(text: string, voice: string, options: any = {}): string {
    const components = [
      text,
      voice,
      options.style || 'general',
      options.rate || 1.0,
      options.pitch || 0,
      options.volume || 1.0
    ];
    return this.hashString(components.join('|'));
  }

  /**
   * 简单字符串哈希函数
   */
  static hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 验证音频数据
   */
  static validateAudioData(audioData: Buffer | string): boolean {
    if (!audioData) return false;
    
    if (Buffer.isBuffer(audioData)) {
      return audioData.length > 0;
    }
    
    if (typeof audioData === 'string') {
      try {
        const buffer = Buffer.from(audioData, 'base64');
        return buffer.length > 0;
      } catch {
        return false;
      }
    }
    
    return false;
  }

  /**
   * 转换Base64到Buffer
   */
  static base64ToBuffer(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }

  /**
   * 转换Buffer到Base64
   */
  static bufferToBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  /**
   * 创建SSML标记
   */
  static createSSML(text: string, options: {
    voice?: string;
    style?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    language?: string;
  } = {}): string {
    const {
      voice = 'zh-CN-XiaoxiaoNeural',
      style = 'general',
      rate = 1.0,
      pitch = 0,
      volume = 1.0,
      language = 'zh-CN'
    } = options;

    let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">`;
    ssml += `<voice name="${voice}">`;

    // 添加表达样式
    if (style !== 'general') {
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

    // 添加文本内容（转义特殊字符）
    ssml += text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // 关闭标签
    if (prosodyParts.length > 0) {
      ssml += `</prosody>`;
    }

    if (style !== 'general') {
      ssml += `</mstts:express-as>`;
    }

    ssml += `</voice></speak>`;

    return ssml;
  }
}

// 默认导出
export default AzureSpeechService;