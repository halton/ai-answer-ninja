import * as speechSDK from '@azure/cognitiveservices-speech-sdk';
import { config } from '../config';
import logger, { logPerformance } from '../utils/logger';
import {
  TTSConfig,
  TTSResult,
  TTSOutputFormat,
  SpeechServiceError,
  ErrorCode,
} from '../types';
import { EventEmitter } from 'events';
import PQueue from 'p-queue';

export class AzureTTSService extends EventEmitter {
  private speechConfig: speechSDK.SpeechConfig;
  private synthesizers: Map<string, speechSDK.SpeechSynthesizer>;
  private queue: PQueue;
  private performanceMetrics: Map<string, number[]>;
  private availableVoices: Map<string, VoiceInfo>;

  constructor() {
    super();
    this.speechConfig = this.initializeSpeechConfig();
    this.synthesizers = new Map();
    this.queue = new PQueue({ concurrency: config.performance.maxConcurrentTTS });
    this.performanceMetrics = new Map();
    this.availableVoices = new Map();
    this.loadAvailableVoices();
  }

  private initializeSpeechConfig(): speechSDK.SpeechConfig {
    const speechConfig = speechSDK.SpeechConfig.fromSubscription(
      config.azure.speechKey,
      config.azure.speechRegion
    );

    // Set default speech synthesis language and voice
    speechConfig.speechSynthesisLanguage = 'zh-CN';
    speechConfig.speechSynthesisVoiceName = 'zh-CN-XiaoxiaoNeural';

    return speechConfig;
  }

  /**
   * Load available voices from Azure
   */
  private async loadAvailableVoices(): Promise<void> {
    try {
      const synthesizer = new speechSDK.SpeechSynthesizer(this.speechConfig);
      
      const result = await synthesizer.getVoicesAsync();
      
      if (result.reason === speechSDK.ResultReason.VoicesListRetrieved) {
        for (const voice of result.voices) {
          this.availableVoices.set(voice.shortName, {
            name: voice.shortName,
            displayName: voice.displayName,
            localName: voice.localName,
            locale: voice.locale,
            gender: voice.gender === speechSDK.SynthesisVoiceGender.Female ? 'Female' : 'Male',
            voiceType: voice.voiceType,
            styleList: voice.styleList || [],
            sampleRateHertz: '24000',
          });
        }
        logger.info(`Loaded ${this.availableVoices.size} available voices`);
      }
      
      synthesizer.close();
    } catch (error) {
      logger.error('Failed to load available voices:', error);
    }
  }

  /**
   * Synthesize text to speech
   */
  public async synthesize(
    text: string,
    ttsConfig?: Partial<TTSConfig>
  ): Promise<TTSResult> {
    return this.queue.add(async () => {
      const startTime = Date.now();

      try {
        // Configure synthesis
        const synthesisConfig = this.configureSynthesisConfig(ttsConfig);
        
        // Create SSML if needed
        const ssml = this.buildSSML(text, ttsConfig);
        
        // Create synthesizer
        const synthesizer = new speechSDK.SpeechSynthesizer(synthesisConfig);

        // Perform synthesis
        const result = await new Promise<TTSResult>((resolve, reject) => {
          const audioChunks: Buffer[] = [];

          // Handle audio data
          synthesizer.synthesizing = (sender, event) => {
            if (event.result.audioData) {
              audioChunks.push(Buffer.from(event.result.audioData));
            }
          };

          // Start synthesis
          synthesizer.speakSsmlAsync(
            ssml,
            (result) => {
              const latency = Date.now() - startTime;
              
              if (result.reason === speechSDK.ResultReason.SynthesizingAudioCompleted) {
                const audioData = Buffer.concat(audioChunks);
                
                logPerformance('tts_synthesis', latency, {
                  textLength: text.length,
                  audioSize: audioData.length,
                  voice: ttsConfig?.voiceName || 'default',
                });

                resolve({
                  audioData,
                  duration: result.audioDuration / 10000000, // Convert to seconds
                  format: ttsConfig?.outputFormat || TTSOutputFormat.Riff16Khz16BitMonoPcm,
                  timestamp: Date.now(),
                  voiceUsed: ttsConfig?.voiceName || 'zh-CN-XiaoxiaoNeural',
                  latency,
                  cached: false,
                });
              } else {
                reject(new SpeechServiceError(
                  'Synthesis failed',
                  ErrorCode.TTS_SYNTHESIS_FAILED,
                  500,
                  { reason: result.reason, errorDetails: result.errorDetails }
                ));
              }
            },
            (error) => {
              logger.error('Synthesis error:', error);
              reject(new SpeechServiceError(
                'Synthesis error',
                ErrorCode.TTS_SYNTHESIS_FAILED,
                500,
                error
              ));
            }
          );
        });

        synthesizer.close();
        
        // Track performance metrics
        this.trackPerformance('synthesis', Date.now() - startTime);
        
        return result;
      } catch (error) {
        logger.error('Error in synthesize:', error);
        throw error;
      }
    });
  }

  /**
   * Stream synthesis for real-time applications
   */
  public async streamSynthesize(
    text: string,
    callId: string,
    ttsConfig?: Partial<TTSConfig>
  ): Promise<NodeJS.ReadableStream> {
    const startTime = Date.now();
    
    try {
      // Configure synthesis
      const synthesisConfig = this.configureSynthesisConfig(ttsConfig);
      
      // Create SSML
      const ssml = this.buildSSML(text, ttsConfig);
      
      // Create audio output stream
      const { Readable } = require('stream');
      const audioStream = new Readable({
        read() {}
      });

      // Create synthesizer with pull audio output stream
      const pullStream = speechSDK.AudioOutputStream.createPullStream();
      const audioConfig = speechSDK.AudioConfig.fromStreamOutput(pullStream);
      const synthesizer = new speechSDK.SpeechSynthesizer(synthesisConfig, audioConfig);

      // Store synthesizer for this call
      this.synthesizers.set(callId, synthesizer);

      // Set up event handlers
      synthesizer.synthesizing = (sender, event) => {
        if (event.result.audioData && event.result.audioData.byteLength > 0) {
          const chunk = Buffer.from(event.result.audioData);
          audioStream.push(chunk);
          
          this.emit('audio_chunk', {
            callId,
            chunkSize: chunk.length,
            timestamp: Date.now(),
          });
        }
      };

      synthesizer.synthesisCompleted = (sender, event) => {
        const latency = Date.now() - startTime;
        
        logger.info(`Stream synthesis completed for call ${callId}`);
        logPerformance('tts_streaming', latency, {
          callId,
          textLength: text.length,
        });
        
        audioStream.push(null); // End the stream
        this.synthesizers.delete(callId);
        synthesizer.close();
      };

      synthesizer.synthesisStarted = (sender, event) => {
        logger.info(`Stream synthesis started for call ${callId}`);
        this.emit('synthesis_started', { callId });
      };

      // Start synthesis
      synthesizer.speakSsmlAsync(
        ssml,
        () => {}, // Success callback
        (error) => {
          logger.error(`Stream synthesis error for call ${callId}:`, error);
          audioStream.destroy(new Error(error));
          this.synthesizers.delete(callId);
          synthesizer.close();
        }
      );

      return audioStream;
    } catch (error) {
      logger.error('Error in streamSynthesize:', error);
      throw error;
    }
  }

  /**
   * Configure synthesis config with custom settings
   */
  private configureSynthesisConfig(customConfig?: Partial<TTSConfig>): speechSDK.SpeechConfig {
    const synthesisConfig = speechSDK.SpeechConfig.fromSubscription(
      config.azure.speechKey,
      config.azure.speechRegion
    );

    // Set voice name
    if (customConfig?.voiceName) {
      synthesisConfig.speechSynthesisVoiceName = customConfig.voiceName;
    } else {
      synthesisConfig.speechSynthesisVoiceName = 'zh-CN-XiaoxiaoNeural';
    }

    // Set language
    if (customConfig?.language) {
      synthesisConfig.speechSynthesisLanguage = customConfig.language;
    }

    // Set output format
    if (customConfig?.outputFormat) {
      const formatMap: Record<TTSOutputFormat, speechSDK.SpeechSynthesisOutputFormat> = {
        [TTSOutputFormat.Audio16Khz32KBitRateMonoMp3]: speechSDK.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3,
        [TTSOutputFormat.Audio16Khz64KBitRateMonoMp3]: speechSDK.SpeechSynthesisOutputFormat.Audio16Khz64KBitRateMonoMp3,
        [TTSOutputFormat.Audio16Khz128KBitRateMonoMp3]: speechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3,
        [TTSOutputFormat.Audio24Khz48KBitRateMonoMp3]: speechSDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3,
        [TTSOutputFormat.Audio24Khz96KBitRateMonoMp3]: speechSDK.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
        [TTSOutputFormat.Audio48Khz192KBitRateMonoMp3]: speechSDK.SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3,
        [TTSOutputFormat.Riff16Khz16BitMonoPcm]: speechSDK.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm,
        [TTSOutputFormat.Riff24Khz16BitMonoPcm]: speechSDK.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm,
        [TTSOutputFormat.Riff48Khz16BitMonoPcm]: speechSDK.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm,
        [TTSOutputFormat.Raw16Khz16BitMonoPcm]: speechSDK.SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm,
        [TTSOutputFormat.Raw24Khz16BitMonoPcm]: speechSDK.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm,
        [TTSOutputFormat.Raw48Khz16BitMonoPcm]: speechSDK.SpeechSynthesisOutputFormat.Raw48Khz16BitMonoPcm,
      };
      
      synthesisConfig.speechSynthesisOutputFormat = formatMap[customConfig.outputFormat];
    }

    return synthesisConfig;
  }

  /**
   * Build SSML for advanced speech synthesis
   */
  private buildSSML(text: string, ttsConfig?: Partial<TTSConfig>): string {
    const voice = ttsConfig?.voiceName || 'zh-CN-XiaoxiaoNeural';
    const lang = ttsConfig?.language || 'zh-CN';
    const rate = ttsConfig?.rate || 1.0;
    const pitch = ttsConfig?.pitch || 0;
    const volume = ttsConfig?.volume || 100;
    const style = ttsConfig?.style;
    const styleDegree = ttsConfig?.styleDegree || 1;
    const role = ttsConfig?.role;

    let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" `;
    ssml += `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">`;
    ssml += `<voice name="${voice}">`;

    // Add style if specified
    if (style) {
      ssml += `<mstts:express-as style="${style}"`;
      if (styleDegree !== 1) {
        ssml += ` styledegree="${styleDegree}"`;
      }
      if (role) {
        ssml += ` role="${role}"`;
      }
      ssml += `>`;
    }

    // Add prosody for rate, pitch, and volume
    ssml += `<prosody`;
    if (rate !== 1.0) {
      const ratePercent = Math.round((rate - 1.0) * 100);
      ssml += ` rate="${ratePercent > 0 ? '+' : ''}${ratePercent}%"`;
    }
    if (pitch !== 0) {
      ssml += ` pitch="${pitch > 0 ? '+' : ''}${pitch}%"`;
    }
    if (volume !== 100) {
      ssml += ` volume="${volume}"`;
    }
    ssml += `>`;

    // Escape XML characters in text
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    ssml += escapedText;
    ssml += `</prosody>`;

    if (style) {
      ssml += `</mstts:express-as>`;
    }

    ssml += `</voice></speak>`;

    return ssml;
  }

  /**
   * Get available voices
   */
  public getAvailableVoices(locale?: string): VoiceInfo[] {
    if (locale) {
      return Array.from(this.availableVoices.values()).filter(
        voice => voice.locale.startsWith(locale)
      );
    }
    return Array.from(this.availableVoices.values());
  }

  /**
   * Stop synthesis for a specific call
   */
  public async stopSynthesis(callId: string): Promise<void> {
    const synthesizer = this.synthesizers.get(callId);
    if (synthesizer) {
      synthesizer.close();
      this.synthesizers.delete(callId);
      logger.info(`Stopped synthesis for call ${callId}`);
    }
  }

  /**
   * Track performance metrics
   */
  private trackPerformance(operation: string, latency: number): void {
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, []);
    }
    
    const metrics = this.performanceMetrics.get(operation)!;
    metrics.push(latency);
    
    // Keep only last 1000 measurements
    if (metrics.length > 1000) {
      metrics.shift();
    }
  }

  /**
   * Get performance metrics
   */
  public getMetrics(): Map<string, any> {
    const metrics = new Map();
    
    // Calculate statistics for each operation
    for (const [operation, latencies] of this.performanceMetrics) {
      if (latencies.length > 0) {
        const sorted = latencies.slice().sort((a, b) => a - b);
        metrics.set(operation, {
          count: latencies.length,
          avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)],
        });
      }
    }

    // Add queue stats
    metrics.set('queue', {
      size: this.queue.size,
      pending: this.queue.pending,
      concurrency: this.queue.concurrency,
    });

    // Add active synthesizers count
    metrics.set('active_synthesizers', this.synthesizers.size);

    return metrics;
  }

  /**
   * Clean up resources
   */
  public async destroy(): Promise<void> {
    // Stop all active synthesizers
    for (const [callId, synthesizer] of this.synthesizers) {
      synthesizer.close();
    }
    
    this.synthesizers.clear();
    this.performanceMetrics.clear();
    this.queue.clear();
    
    logger.info('AzureTTSService destroyed');
  }
}

// Voice information interface
interface VoiceInfo {
  name: string;
  displayName: string;
  localName: string;
  locale: string;
  gender: string;
  voiceType: string;
  styleList: string[];
  sampleRateHertz: string;
}

// Export singleton instance
export default new AzureTTSService();