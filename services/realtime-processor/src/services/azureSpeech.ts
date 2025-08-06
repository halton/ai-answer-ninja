import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { AudioFormat, AudioChunk, AzureSpeechConfig } from '../types';
import logger from '../utils/logger';

export interface SpeechToTextResult {
  text: string;
  confidence: number;
  offset: number;
  duration: number;
  reason: sdk.ResultReason;
}

export interface TextToSpeechResult {
  audioData: Buffer;
  format: AudioFormat;
  sampleRate: number;
  duration: number;
}

export class AzureSpeechService {
  private speechConfig: sdk.SpeechConfig;
  private voiceProfiles: Map<string, string> = new Map();
  private recognizerPool: sdk.SpeechRecognizer[] = [];
  private synthesizerPool: sdk.SpeechSynthesizer[] = [];
  private maxPoolSize = 10;
  private isInitialized = false;
  private readonly config: AzureSpeechConfig;

  constructor(config: AzureSpeechConfig) {
    this.config = config;
    logger.info('Azure Speech Service created');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    this.initializeSpeechConfig();
    this.initializeConnectionPools();
    this.isInitialized = true;
    
    logger.info('Azure Speech Service initialized');
  }

  private initializeSpeechConfig(): void {
    if (!this.config.key || !this.config.region) {
      throw new Error('Azure Speech Service credentials not configured');
    }

    this.speechConfig = sdk.SpeechConfig.fromSubscription(
      this.config.key,
      this.config.region
    );

    // Configure speech recognition
    this.speechConfig.speechRecognitionLanguage = this.config.language;
    this.speechConfig.outputFormat = sdk.OutputFormat.Detailed;

    // Configure speech synthesis
    this.speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
    this.speechConfig.speechSynthesisVoiceName = 'zh-CN-XiaoxiaoNeural'; // Default Chinese voice

    // Enable detailed results
    this.speechConfig.enableDictation();
    
    logger.info('Azure Speech configuration initialized');
  }

  private initializeConnectionPools(): void {
    // Pre-create recognizers and synthesizers for better performance
    for (let i = 0; i < this.maxPoolSize; i++) {
      const recognizer = new sdk.SpeechRecognizer(this.speechConfig);
      const synthesizer = new sdk.SpeechSynthesizer(this.speechConfig);
      
      this.recognizerPool.push(recognizer);
      this.synthesizerPool.push(synthesizer);
    }

    logger.info(`Connection pools initialized with ${this.maxPoolSize} instances each`);
  }

  async speechToText(audioData: Buffer | string | AudioChunk): Promise<string> {
    const startTime = performance.now();
    let recognizer: sdk.SpeechRecognizer | null = null;

    try {
      // Convert audio data to buffer if needed
      let audioBuffer: Buffer;
      if (Buffer.isBuffer(audioData)) {
        audioBuffer = audioData;
      } else if (typeof audioData === 'string') {
        audioBuffer = Buffer.from(audioData, 'base64');
      } else {
        // AudioChunk type
        audioBuffer = Buffer.isBuffer(audioData.audioData) 
          ? audioData.audioData 
          : Buffer.from(audioData.audioData, 'base64');
      }

      if (audioBuffer.length === 0) {
        logger.warn('Empty audio data provided for speech-to-text');
        return '';
      }

      // Get recognizer from pool
      recognizer = this.getRecognizer();
      if (!recognizer) {
        throw new Error('No available speech recognizer');
      }

      // Create audio config from buffer
      const audioConfig = this.createAudioConfigFromBuffer(audioBuffer);
      
      // Create new recognizer with audio config
      const activeRecognizer = new sdk.SpeechRecognizer(this.speechConfig, audioConfig);

      // Perform recognition
      const result = await new Promise<sdk.SpeechRecognitionResult>((resolve, reject) => {
        activeRecognizer.recognizeOnceAsync(
          (result) => {
            activeRecognizer.close();
            resolve(result);
          },
          (error) => {
            activeRecognizer.close();
            reject(new Error(`Speech recognition failed: ${error}`));
          }
        );
      });

      const processingTime = performance.now() - startTime;

      if (result.reason === sdk.ResultReason.RecognizedSpeech) {
        const confidence = this.calculateConfidence(result);
        
        logger.info(
          {
            text: result.text,
            confidence,
            processingTime,
            audioSize: audioBuffer.length,
          },
          'Speech-to-text completed successfully'
        );

        return result.text;
      } else if (result.reason === sdk.ResultReason.NoMatch) {
        logger.debug('No speech could be recognized');
        return '';
      } else {
        logger.warn(
          {
            reason: sdk.ResultReason[result.reason],
            errorDetails: result.errorDetails,
          },
          'Speech recognition failed'
        );
        return '';
      }

    } catch (error) {
      const processingTime = performance.now() - startTime;
      
      logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          processingTime,
        },
        'Speech-to-text error'
      );

      throw error;
    } finally {
      if (recognizer) {
        this.returnRecognizer(recognizer);
      }
    }
  }

  async textToSpeech(text: string, userId?: string): Promise<Buffer> {
    const startTime = performance.now();
    let synthesizer: sdk.SpeechSynthesizer | null = null;

    try {
      if (!text || text.trim().length === 0) {
        logger.warn('Empty text provided for text-to-speech');
        return Buffer.alloc(0);
      }

      // Get synthesizer from pool
      synthesizer = this.getSynthesizer();
      if (!synthesizer) {
        throw new Error('No available speech synthesizer');
      }

      // Get voice profile for user
      const voiceName = await this.getVoiceForUser(userId);
      
      // Create SSML for better control
      const ssml = this.createSSML(text, voiceName);

      // Perform synthesis
      const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
        synthesizer!.speakSsmlAsync(
          ssml,
          (result) => resolve(result),
          (error) => reject(new Error(`Speech synthesis failed: ${error}`))
        );
      });

      const processingTime = performance.now() - startTime;

      if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
        const audioData = Buffer.from(result.audioData);

        logger.info(
          {
            text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            userId,
            voiceName,
            audioSize: audioData.length,
            processingTime,
          },
          'Text-to-speech completed successfully'
        );

        return audioData;
      } else {
        logger.warn(
          {
            reason: sdk.ResultReason[result.reason],
            errorDetails: result.errorDetails,
          },
          'Speech synthesis failed'
        );
        return Buffer.alloc(0);
      }

    } catch (error) {
      const processingTime = performance.now() - startTime;
      
      logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          text: text.substring(0, 100),
          userId,
          processingTime,
        },
        'Text-to-speech error'
      );

      throw error;
    } finally {
      if (synthesizer) {
        this.returnSynthesizer(synthesizer);
      }
    }
  }

  // Streaming speech recognition
  async createStreamingRecognizer(
    onRecognizing: (text: string) => void,
    onRecognized: (result: SpeechToTextResult) => void,
    onError: (error: Error) => void
  ): Promise<sdk.SpeechRecognizer> {
    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new sdk.SpeechRecognizer(this.speechConfig, audioConfig);

    recognizer.recognizing = (sender, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech) {
        onRecognizing(e.result.text);
      }
    };

    recognizer.recognized = (sender, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const confidence = this.calculateConfidence(e.result);
        onRecognized({
          text: e.result.text,
          confidence,
          offset: e.result.offset,
          duration: e.result.duration,
          reason: e.result.reason,
        });
      }
    };

    recognizer.canceled = (sender, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        onError(new Error(`Recognition canceled: ${e.errorDetails}`));
      }
    };

    return recognizer;
  }

  // Custom voice training integration
  async trainCustomVoice(userId: string, audioSamples: Buffer[]): Promise<string> {
    // This would integrate with Azure Custom Neural Voice
    // For now, return a placeholder profile ID
    const profileId = `custom_voice_${userId}_${Date.now()}`;
    
    logger.info(
      { userId, profileId, sampleCount: audioSamples.length },
      'Custom voice training initiated (placeholder)'
    );

    // Store voice profile mapping
    this.voiceProfiles.set(userId, profileId);
    // TODO: Store in Redis when RedisService is available
    // await redisService.set(`voice_profile:${userId}`, profileId, 86400 * 30); // 30 days

    return profileId;
  }

  // Voice profile management
  async setVoiceProfile(userId: string, voiceProfile: string): Promise<void> {
    this.voiceProfiles.set(userId, voiceProfile);
    // TODO: Store in Redis when RedisService is available
    // await redisService.set(`voice_profile:${userId}`, voiceProfile, 86400 * 30); // 30 days
    
    logger.info({ userId, voiceProfile }, 'Voice profile set for user');
  }

  async getVoiceProfile(userId: string): Promise<string | null> {
    // Check memory cache first
    if (this.voiceProfiles.has(userId)) {
      return this.voiceProfiles.get(userId)!;
    }

    // TODO: Check Redis cache when RedisService is available
    // const cached = await redisService.get<string>(`voice_profile:${userId}`);
    // if (cached) {
    //   this.voiceProfiles.set(userId, cached);
    //   return cached;
    // }

    return null;
  }

  // Helper methods
  private getRecognizer(): sdk.SpeechRecognizer | null {
    return this.recognizerPool.length > 0 ? this.recognizerPool.pop()! : null;
  }

  private returnRecognizer(recognizer: sdk.SpeechRecognizer): void {
    if (this.recognizerPool.length < this.maxPoolSize) {
      this.recognizerPool.push(recognizer);
    } else {
      recognizer.close();
    }
  }

  private getSynthesizer(): sdk.SpeechSynthesizer | null {
    return this.synthesizerPool.length > 0 ? this.synthesizerPool.pop()! : null;
  }

  private returnSynthesizer(synthesizer: sdk.SpeechSynthesizer): void {
    if (this.synthesizerPool.length < this.maxPoolSize) {
      this.synthesizerPool.push(synthesizer);
    } else {
      synthesizer.close();
    }
  }

  private createAudioConfigFromBuffer(audioBuffer: Buffer): sdk.AudioConfig {
    // Create a stream from buffer
    const stream = sdk.AudioInputStream.createPushStream();
    stream.write(audioBuffer);
    stream.close();
    
    return sdk.AudioConfig.fromStreamInput(stream);
  }

  private calculateConfidence(result: sdk.SpeechRecognitionResult): number {
    // Extract confidence from detailed results
    try {
      const detailed = JSON.parse(result.json);
      if (detailed.NBest && detailed.NBest.length > 0) {
        return detailed.NBest[0].Confidence || 0.5;
      }
    } catch (error) {
      logger.debug('Could not parse detailed recognition results');
    }
    
    return 0.8; // Default confidence if detailed results unavailable
  }

  private calculateAudioDuration(audioData: Buffer): number {
    // Approximate duration for MP3 at 32kbps
    const bitrate = 32000; // 32 kbps
    const durationSeconds = (audioData.length * 8) / bitrate;
    return durationSeconds * 1000; // Convert to milliseconds
  }

  private async getVoiceForUser(userId?: string): Promise<string> {
    if (!userId) {
      return 'zh-CN-XiaoxiaoNeural'; // Default voice
    }

    const voiceProfile = await this.getVoiceProfile(userId);
    if (voiceProfile) {
      // Map voice profile to actual voice name
      return this.mapVoiceProfile(voiceProfile);
    }

    return 'zh-CN-XiaoxiaoNeural'; // Default voice
  }

  private mapVoiceProfile(voiceProfile: string): string {
    // Map custom voice profiles to Azure voice names
    const voiceMap: Record<string, string> = {
      'polite': 'zh-CN-XiaoxiaoNeural',
      'professional': 'zh-CN-YunxiNeural',
      'friendly': 'zh-CN-XiaoyiNeural',
      'authoritative': 'zh-CN-YunyangNeural',
    };

    return voiceMap[voiceProfile] || 'zh-CN-XiaoxiaoNeural';
  }

  private createSSML(text: string, voiceName: string): string {
    return `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
        <voice name="${voiceName}">
          <prosody rate="medium" pitch="medium">
            ${this.escapeXml(text)}
          </prosody>
        </voice>
      </speak>
    `;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private hashText(text: string): string {
    // Simple hash function for caching
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Test TTS with a simple phrase
      const testResult = await this.textToSpeech('测试');
      return testResult !== null;
    } catch (error) {
      logger.error({ error }, 'Azure Speech Service health check failed');
      return false;
    }
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure Speech Service');

    // Close all recognizers
    this.recognizerPool.forEach(recognizer => recognizer.close());
    this.recognizerPool = [];

    // Close all synthesizers
    this.synthesizerPool.forEach(synthesizer => synthesizer.close());
    this.synthesizerPool = [];

    logger.info('Azure Speech Service cleanup completed');
  }
}