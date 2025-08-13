/**
 * Azure语音服务配置管理器
 * 支持多语言、多声音配置和动态切换
 */

import { logger } from '../utils/logger';
import { AudioFormat, AzureSpeechConfig } from '../types';

export interface VoiceConfig {
  name: string;
  locale: string;
  gender: 'Male' | 'Female';
  neuralVoice: boolean;
  style?: string;
  degree?: number;
}

export interface SpeechRecognitionConfig {
  language: string;
  format: AudioFormat;
  sampleRate: number;
  channels: number;
  enableProfanityFilter: boolean;
  enableWordLevelTimestamps: boolean;
  enableDiarization: boolean;
  continuousRecognition: boolean;
}

export interface SpeechSynthesisConfig {
  voice: VoiceConfig;
  format: AudioFormat;
  sampleRate: number;
  bitRate: number;
  prosody: {
    rate?: number;
    pitch?: number;
    volume?: number;
  };
  effects?: string[];
}

export interface OptimizationConfig {
  streaming: boolean;
  latencyOptimized: boolean;
  compressionLevel: number;
  bufferSize: number;
  timeout: number;
}

export class SpeechConfigManager {
  private recognitionConfig: SpeechRecognitionConfig;
  private synthesisConfig: SpeechSynthesisConfig;
  private optimizationConfig: OptimizationConfig;
  private availableVoices: Map<string, VoiceConfig[]>;
  private azureConfig: AzureSpeechConfig;

  constructor(azureConfig: AzureSpeechConfig) {
    this.azureConfig = azureConfig;
    this.initializeConfigs();
    this.initializeVoices();
  }

  private initializeConfigs(): void {
    // 默认语音识别配置
    this.recognitionConfig = {
      language: this.azureConfig.language || 'zh-CN',
      format: AudioFormat.WAV,
      sampleRate: 16000,
      channels: 1,
      enableProfanityFilter: false,
      enableWordLevelTimestamps: true,
      enableDiarization: false,
      continuousRecognition: true
    };

    // 默认语音合成配置
    this.synthesisConfig = {
      voice: {
        name: 'zh-CN-XiaoxiaoNeural',
        locale: 'zh-CN',
        gender: 'Female',
        neuralVoice: true,
        style: 'general'
      },
      format: AudioFormat.WAV,
      sampleRate: 24000,
      bitRate: 128000,
      prosody: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
      },
      effects: []
    };

    // 性能优化配置
    this.optimizationConfig = {
      streaming: true,
      latencyOptimized: true,
      compressionLevel: 6,
      bufferSize: 4096,
      timeout: 30000
    };
  }

  private initializeVoices(): void {
    this.availableVoices = new Map();

    // 中文声音
    this.availableVoices.set('zh-CN', [
      {
        name: 'zh-CN-XiaoxiaoNeural',
        locale: 'zh-CN',
        gender: 'Female',
        neuralVoice: true,
        style: 'general'
      },
      {
        name: 'zh-CN-YunyangNeural',
        locale: 'zh-CN',
        gender: 'Male',
        neuralVoice: true,
        style: 'general'
      },
      {
        name: 'zh-CN-XiaoyiNeural',
        locale: 'zh-CN',
        gender: 'Female',
        neuralVoice: true,
        style: 'assistant'
      },
      {
        name: 'zh-CN-YunjianNeural',
        locale: 'zh-CN',
        gender: 'Male',
        neuralVoice: true,
        style: 'sports'
      }
    ]);

    // 英文声音
    this.availableVoices.set('en-US', [
      {
        name: 'en-US-JennyNeural',
        locale: 'en-US',
        gender: 'Female',
        neuralVoice: true,
        style: 'assistant'
      },
      {
        name: 'en-US-GuyNeural',
        locale: 'en-US',
        gender: 'Male',
        neuralVoice: true,
        style: 'newscast'
      },
      {
        name: 'en-US-AriaNeural',
        locale: 'en-US',
        gender: 'Female',
        neuralVoice: true,
        style: 'chat'
      }
    ]);
  }

  /**
   * 获取语音识别配置
   */
  getRecognitionConfig(): SpeechRecognitionConfig {
    return { ...this.recognitionConfig };
  }

  /**
   * 获取语音合成配置
   */
  getSynthesisConfig(): SpeechSynthesisConfig {
    return { ...this.synthesisConfig };
  }

  /**
   * 获取优化配置
   */
  getOptimizationConfig(): OptimizationConfig {
    return { ...this.optimizationConfig };
  }

  /**
   * 设置语音识别语言
   */
  setRecognitionLanguage(language: string): void {
    this.recognitionConfig.language = language;
    logger.info(`Recognition language set to: ${language}`);
  }

  /**
   * 设置合成语音
   */
  setSynthesisVoice(voiceName: string, locale?: string): boolean {
    const targetLocale = locale || this.extractLocaleFromVoice(voiceName);
    const voices = this.availableVoices.get(targetLocale);
    
    if (!voices) {
      logger.error(`No voices available for locale: ${targetLocale}`);
      return false;
    }

    const voice = voices.find(v => v.name === voiceName);
    if (!voice) {
      logger.error(`Voice not found: ${voiceName}`);
      return false;
    }

    this.synthesisConfig.voice = { ...voice };
    logger.info(`Synthesis voice set to: ${voiceName}`);
    return true;
  }

  /**
   * 设置语音风格（仅神经语音支持）
   */
  setVoiceStyle(style: string, degree?: number): boolean {
    if (!this.synthesisConfig.voice.neuralVoice) {
      logger.warn('Voice style is only supported for neural voices');
      return false;
    }

    this.synthesisConfig.voice.style = style;
    if (degree !== undefined) {
      this.synthesisConfig.voice.degree = Math.max(0.01, Math.min(2.0, degree));
    }

    logger.info(`Voice style set to: ${style} with degree: ${degree || 'default'}`);
    return true;
  }

  /**
   * 设置语速、音调、音量
   */
  setProsody(rate?: number, pitch?: number, volume?: number): void {
    if (rate !== undefined) {
      this.synthesisConfig.prosody.rate = Math.max(0.5, Math.min(3.0, rate));
    }
    if (pitch !== undefined) {
      this.synthesisConfig.prosody.pitch = Math.max(-50, Math.min(50, pitch));
    }
    if (volume !== undefined) {
      this.synthesisConfig.prosody.volume = Math.max(0, Math.min(100, volume));
    }

    logger.info('Prosody settings updated', this.synthesisConfig.prosody);
  }

  /**
   * 设置音频格式
   */
  setAudioFormat(format: AudioFormat, sampleRate?: number): void {
    this.synthesisConfig.format = format;
    if (sampleRate) {
      this.synthesisConfig.sampleRate = sampleRate;
    }

    // 根据格式调整默认采样率
    switch (format) {
      case AudioFormat.OPUS:
        this.synthesisConfig.sampleRate = 48000;
        break;
      case AudioFormat.MP3:
        this.synthesisConfig.sampleRate = 22050;
        break;
      case AudioFormat.WAV:
        this.synthesisConfig.sampleRate = 24000;
        break;
      default:
        break;
    }

    logger.info(`Audio format set to: ${format} at ${this.synthesisConfig.sampleRate}Hz`);
  }

  /**
   * 启用流式处理
   */
  enableStreaming(enabled: boolean = true): void {
    this.optimizationConfig.streaming = enabled;
    if (enabled) {
      this.optimizationConfig.latencyOptimized = true;
      this.optimizationConfig.bufferSize = 2048; // 较小缓冲区以减少延迟
    }
    logger.info(`Streaming ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 设置延迟优化
   */
  setLatencyOptimization(enabled: boolean): void {
    this.optimizationConfig.latencyOptimized = enabled;
    if (enabled) {
      this.optimizationConfig.timeout = 10000; // 较短超时
      this.optimizationConfig.compressionLevel = 3; // 较低压缩以提高速度
    } else {
      this.optimizationConfig.timeout = 30000;
      this.optimizationConfig.compressionLevel = 6;
    }
    logger.info(`Latency optimization ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 获取可用声音列表
   */
  getAvailableVoices(locale?: string): VoiceConfig[] {
    if (locale) {
      return this.availableVoices.get(locale) || [];
    }

    const allVoices: VoiceConfig[] = [];
    for (const voices of this.availableVoices.values()) {
      allVoices.push(...voices);
    }
    return allVoices;
  }

  /**
   * 根据用户画像推荐最佳声音
   */
  recommendVoice(userProfile: {
    gender?: 'male' | 'female';
    age?: number;
    personality?: string;
    locale?: string;
  }): VoiceConfig | null {
    const locale = userProfile.locale || 'zh-CN';
    const voices = this.availableVoices.get(locale);
    
    if (!voices || voices.length === 0) {
      return null;
    }

    // 根据用户画像筛选
    let filteredVoices = voices;

    // 性别匹配
    if (userProfile.gender) {
      const preferredGender = userProfile.gender === 'male' ? 'Male' : 'Female';
      const genderMatched = voices.filter(v => v.gender === preferredGender);
      if (genderMatched.length > 0) {
        filteredVoices = genderMatched;
      }
    }

    // 根据个性选择风格
    if (userProfile.personality) {
      const personalityVoiceMap: Record<string, string[]> = {
        'friendly': ['assistant', 'chat'],
        'professional': ['newscast', 'general'],
        'casual': ['chat', 'cheerful'],
        'serious': ['general', 'newscast']
      };

      const preferredStyles = personalityVoiceMap[userProfile.personality.toLowerCase()];
      if (preferredStyles) {
        const styleMatched = filteredVoices.filter(v => 
          preferredStyles.includes(v.style || 'general')
        );
        if (styleMatched.length > 0) {
          filteredVoices = styleMatched;
        }
      }
    }

    // 返回第一个匹配的声音，或随机选择
    return filteredVoices[0] || voices[0];
  }

  /**
   * 生成Azure Speech SDK配置字符串
   */
  generateAzureConfig(): {
    recognitionConfig: string;
    synthesisConfig: string;
  } {
    const recognition = {
      language: this.recognitionConfig.language,
      format: this.getAzureAudioFormat(this.recognitionConfig.format),
      sampleRate: this.recognitionConfig.sampleRate,
      enableWordLevelTimestamps: this.recognitionConfig.enableWordLevelTimestamps,
      enableProfanityFilter: this.recognitionConfig.enableProfanityFilter,
      continuousRecognition: this.recognitionConfig.continuousRecognition
    };

    const synthesis = {
      voice: this.synthesisConfig.voice.name,
      format: this.getAzureAudioFormat(this.synthesisConfig.format),
      sampleRate: this.synthesisConfig.sampleRate,
      prosody: this.synthesisConfig.prosody,
      style: this.synthesisConfig.voice.style,
      degree: this.synthesisConfig.voice.degree
    };

    return {
      recognitionConfig: JSON.stringify(recognition),
      synthesisConfig: JSON.stringify(synthesis)
    };
  }

  private extractLocaleFromVoice(voiceName: string): string {
    const parts = voiceName.split('-');
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`;
    }
    return 'zh-CN'; // 默认
  }

  private getAzureAudioFormat(format: AudioFormat): string {
    const formatMap: Record<AudioFormat, string> = {
      [AudioFormat.WAV]: 'riff-24khz-16bit-mono-pcm',
      [AudioFormat.MP3]: 'audio-24khz-48kbitrate-mono-mp3',
      [AudioFormat.OPUS]: 'ogg-48khz-16bit-mono-opus',
      [AudioFormat.AAC]: 'audio-24khz-48kbitrate-mono-aac',
      [AudioFormat.PCM]: 'raw-24khz-16bit-mono-pcm'
    };

    return formatMap[format] || formatMap[AudioFormat.WAV];
  }

  /**
   * 验证配置有效性
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.azureConfig.key) {
      errors.push('Azure Speech API key is required');
    }

    if (!this.azureConfig.region) {
      errors.push('Azure Speech region is required');
    }

    if (!this.recognitionConfig.language) {
      errors.push('Recognition language is required');
    }

    if (!this.synthesisConfig.voice.name) {
      errors.push('Synthesis voice name is required');
    }

    if (this.synthesisConfig.sampleRate < 8000 || this.synthesisConfig.sampleRate > 48000) {
      errors.push('Sample rate must be between 8000 and 48000');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 重置为默认配置
   */
  resetToDefaults(): void {
    this.initializeConfigs();
    logger.info('Configuration reset to defaults');
  }

  /**
   * 获取配置摘要
   */
  getConfigSummary(): object {
    return {
      recognition: {
        language: this.recognitionConfig.language,
        format: this.recognitionConfig.format,
        sampleRate: this.recognitionConfig.sampleRate,
        streaming: this.optimizationConfig.streaming
      },
      synthesis: {
        voice: this.synthesisConfig.voice.name,
        style: this.synthesisConfig.voice.style,
        format: this.synthesisConfig.format,
        sampleRate: this.synthesisConfig.sampleRate,
        prosody: this.synthesisConfig.prosody
      },
      optimization: {
        latencyOptimized: this.optimizationConfig.latencyOptimized,
        streaming: this.optimizationConfig.streaming,
        timeout: this.optimizationConfig.timeout
      }
    };
  }
}