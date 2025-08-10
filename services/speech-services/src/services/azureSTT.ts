import * as speechSDK from '@azure/cognitiveservices-speech-sdk';
import { config } from '../config';
import logger, { logPerformance } from '../utils/logger';
import {
  AudioChunk,
  STTConfig,
  STTResult,
  SpeechServiceError,
  ErrorCode,
  WordTimestamp,
} from '../types';
import { EventEmitter } from 'events';

export class AzureSTTService extends EventEmitter {
  private speechConfig: speechSDK.SpeechConfig;
  private recognizers: Map<string, speechSDK.SpeechRecognizer>;
  private activeStreams: Map<string, StreamContext>;
  private performanceMetrics: Map<string, number[]>;

  constructor() {
    super();
    this.speechConfig = this.initializeSpeechConfig();
    this.recognizers = new Map();
    this.activeStreams = new Map();
    this.performanceMetrics = new Map();
  }

  private initializeSpeechConfig(): speechSDK.SpeechConfig {
    const speechConfig = speechSDK.SpeechConfig.fromSubscription(
      config.azure.speechKey,
      config.azure.speechRegion
    );

    // Set service properties for optimal performance
    speechConfig.speechRecognitionLanguage = 'zh-CN';
    speechConfig.outputFormat = speechSDK.OutputFormat.Detailed;
    
    // Enable continuous recognition
    speechConfig.setProperty(
      speechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      '5000'
    );
    speechConfig.setProperty(
      speechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
      '1000'
    );
    
    // Enable word-level timestamps
    speechConfig.requestWordLevelTimestamps();
    
    // Set profanity handling
    speechConfig.setProfanity(speechSDK.ProfanityOption.Masked);

    return speechConfig;
  }

  /**
   * Start streaming recognition for a call
   */
  public async startStreamingRecognition(
    callId: string,
    config?: Partial<STTConfig>
  ): Promise<void> {
    try {
      if (this.recognizers.has(callId)) {
        logger.warn(`Recognizer already exists for call ${callId}`);
        return;
      }

      const startTime = Date.now();
      
      // Create push stream for audio input
      const pushStream = speechSDK.AudioInputStream.createPushStream(
        speechSDK.AudioStreamFormat.getWaveFormatPCM(
          config?.language === 'en-US' ? 16000 : 16000,
          16,
          1
        )
      );

      // Create audio config from push stream
      const audioConfig = speechSDK.AudioConfig.fromStreamInput(pushStream);

      // Configure speech config with custom settings
      const recognitionConfig = this.configureSpeechConfig(config);

      // Create recognizer
      const recognizer = new speechSDK.SpeechRecognizer(
        recognitionConfig,
        audioConfig
      );

      // Set up event handlers
      this.setupRecognizerEvents(recognizer, callId);

      // Store recognizer and stream context
      this.recognizers.set(callId, recognizer);
      this.activeStreams.set(callId, {
        pushStream,
        startTime,
        lastActivityTime: Date.now(),
        config: config || {},
        results: [],
      });

      // Start continuous recognition
      await new Promise<void>((resolve, reject) => {
        recognizer.startContinuousRecognitionAsync(
          () => {
            logger.info(`Started STT stream for call ${callId}`);
            logPerformance('stt_stream_init', Date.now() - startTime, { callId });
            resolve();
          },
          (error) => {
            logger.error(`Failed to start STT stream for call ${callId}:`, error);
            reject(new SpeechServiceError(
              'Failed to start speech recognition',
              ErrorCode.STT_INIT_FAILED,
              500,
              error
            ));
          }
        );
      });
    } catch (error) {
      logger.error('Error starting streaming recognition:', error);
      throw error;
    }
  }

  /**
   * Process audio chunk for streaming recognition
   */
  public async processAudioChunk(chunk: AudioChunk): Promise<void> {
    const context = this.activeStreams.get(chunk.callId);
    if (!context) {
      throw new SpeechServiceError(
        `No active stream for call ${chunk.callId}`,
        ErrorCode.STT_RECOGNITION_FAILED,
        400
      );
    }

    try {
      // Write audio data to push stream
      context.pushStream.write(chunk.data);
      context.lastActivityTime = Date.now();
      
      // Track chunk processing
      this.emit('chunk_processed', {
        callId: chunk.callId,
        timestamp: chunk.timestamp,
        size: chunk.data.length,
      });
    } catch (error) {
      logger.error(`Error processing audio chunk for call ${chunk.callId}:`, error);
      throw new SpeechServiceError(
        'Failed to process audio chunk',
        ErrorCode.AUDIO_FORMAT_ERROR,
        400,
        error
      );
    }
  }

  /**
   * Stop streaming recognition for a call
   */
  public async stopStreamingRecognition(callId: string): Promise<STTResult[]> {
    const recognizer = this.recognizers.get(callId);
    const context = this.activeStreams.get(callId);

    if (!recognizer || !context) {
      logger.warn(`No active recognizer for call ${callId}`);
      return [];
    }

    try {
      // Close push stream
      context.pushStream.close();

      // Stop recognition
      await new Promise<void>((resolve, reject) => {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            logger.info(`Stopped STT stream for call ${callId}`);
            resolve();
          },
          (error) => {
            logger.error(`Error stopping STT stream for call ${callId}:`, error);
            reject(error);
          }
        );
      });

      // Clean up
      recognizer.close();
      this.recognizers.delete(callId);
      this.activeStreams.delete(callId);

      // Return accumulated results
      return context.results;
    } catch (error) {
      logger.error(`Error stopping recognition for call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Perform one-shot recognition on audio buffer
   */
  public async recognizeOnce(audioBuffer: Buffer, config?: Partial<STTConfig>): Promise<STTResult> {
    const startTime = Date.now();

    try {
      // Create audio config from buffer
      const pushStream = speechSDK.AudioInputStream.createPushStream();
      pushStream.write(audioBuffer);
      pushStream.close();

      const audioConfig = speechSDK.AudioConfig.fromStreamInput(pushStream);
      const recognitionConfig = this.configureSpeechConfig(config);

      // Create recognizer
      const recognizer = new speechSDK.SpeechRecognizer(
        recognitionConfig,
        audioConfig
      );

      // Perform recognition
      const result = await new Promise<STTResult>((resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (result) => {
            const latency = Date.now() - startTime;
            
            if (result.reason === speechSDK.ResultReason.RecognizedSpeech) {
              const sttResult = this.processRecognitionResult(result, latency);
              logPerformance('stt_once', latency, {
                textLength: sttResult.text.length,
                confidence: sttResult.confidence,
              });
              resolve(sttResult);
            } else if (result.reason === speechSDK.ResultReason.NoMatch) {
              resolve({
                text: '',
                confidence: 0,
                language: config?.language || 'zh-CN',
                timestamp: Date.now(),
                duration: 0,
                isFinal: true,
                latency,
              });
            } else {
              reject(new SpeechServiceError(
                'Recognition failed',
                ErrorCode.STT_RECOGNITION_FAILED,
                500,
                { reason: result.reason }
              ));
            }
          },
          (error) => {
            logger.error('Recognition error:', error);
            reject(new SpeechServiceError(
              'Recognition error',
              ErrorCode.STT_RECOGNITION_FAILED,
              500,
              error
            ));
          }
        );
      });

      recognizer.close();
      return result;
    } catch (error) {
      logger.error('Error in recognizeOnce:', error);
      throw error;
    }
  }

  /**
   * Configure speech config with custom settings
   */
  private configureSpeechConfig(customConfig?: Partial<STTConfig>): speechSDK.SpeechConfig {
    const newConfig = speechSDK.SpeechConfig.fromSubscription(
      config.azure.speechKey,
      config.azure.speechRegion
    );

    // Apply custom settings
    if (customConfig?.language) {
      newConfig.speechRecognitionLanguage = customConfig.language;
    }

    if (customConfig?.profanityOption) {
      const profanityMap = {
        'masked': speechSDK.ProfanityOption.Masked,
        'removed': speechSDK.ProfanityOption.Removed,
        'raw': speechSDK.ProfanityOption.Raw,
      };
      newConfig.setProfanity(profanityMap[customConfig.profanityOption]);
    }

    if (customConfig?.enableDictation) {
      newConfig.enableDictation();
    }

    if (customConfig?.initialSilenceTimeout) {
      newConfig.setProperty(
        speechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
        customConfig.initialSilenceTimeout.toString()
      );
    }

    if (customConfig?.endSilenceTimeout) {
      newConfig.setProperty(
        speechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
        customConfig.endSilenceTimeout.toString()
      );
    }

    return newConfig;
  }

  /**
   * Set up event handlers for recognizer
   */
  private setupRecognizerEvents(recognizer: speechSDK.SpeechRecognizer, callId: string): void {
    // Recognizing event (partial results)
    recognizer.recognizing = (sender, event) => {
      if (event.result.reason === speechSDK.ResultReason.RecognizingSpeech) {
        const partialResult: STTResult = {
          text: event.result.text,
          confidence: 0.5, // Partial results have lower confidence
          language: event.result.language || 'zh-CN',
          timestamp: Date.now(),
          duration: event.result.duration / 10000000, // Convert to seconds
          isFinal: false,
          latency: 0,
        };

        this.emit('partial_result', { callId, result: partialResult });
      }
    };

    // Recognized event (final results)
    recognizer.recognized = (sender, event) => {
      if (event.result.reason === speechSDK.ResultReason.RecognizedSpeech) {
        const context = this.activeStreams.get(callId);
        if (context) {
          const latency = Date.now() - context.lastActivityTime;
          const finalResult = this.processRecognitionResult(event.result, latency);
          
          context.results.push(finalResult);
          this.emit('final_result', { callId, result: finalResult });
          
          logPerformance('stt_streaming', latency, {
            callId,
            textLength: finalResult.text.length,
            confidence: finalResult.confidence,
          });
        }
      }
    };

    // Canceled event
    recognizer.canceled = (sender, event) => {
      logger.error(`Recognition canceled for call ${callId}:`, event.errorDetails);
      this.emit('error', {
        callId,
        error: new SpeechServiceError(
          event.errorDetails,
          ErrorCode.STT_RECOGNITION_FAILED,
          500
        ),
      });
    };

    // Session events
    recognizer.sessionStarted = (sender, event) => {
      logger.info(`STT session started for call ${callId}`);
      this.emit('session_started', { callId, sessionId: event.sessionId });
    };

    recognizer.sessionStopped = (sender, event) => {
      logger.info(`STT session stopped for call ${callId}`);
      this.emit('session_stopped', { callId, sessionId: event.sessionId });
    };
  }

  /**
   * Process recognition result
   */
  private processRecognitionResult(
    result: speechSDK.SpeechRecognitionResult,
    latency: number
  ): STTResult {
    const json = result.json ? JSON.parse(result.json) : {};
    
    // Extract word timestamps if available
    let wordTimestamps: WordTimestamp[] | undefined;
    if (json.NBest && json.NBest[0]?.Words) {
      wordTimestamps = json.NBest[0].Words.map((word: any) => ({
        word: word.Word,
        startTime: word.Offset / 10000000,
        endTime: (word.Offset + word.Duration) / 10000000,
        confidence: word.Confidence || 1.0,
      }));
    }

    // Extract alternatives
    const alternatives = json.NBest?.slice(1).map((alt: any) => ({
      text: alt.Display,
      confidence: alt.Confidence,
    }));

    return {
      text: result.text,
      confidence: json.NBest?.[0]?.Confidence || 1.0,
      language: result.language || 'zh-CN',
      timestamp: Date.now(),
      duration: result.duration / 10000000, // Convert to seconds
      wordTimestamps,
      alternatives,
      isFinal: true,
      latency,
    };
  }

  /**
   * Get performance metrics
   */
  public getMetrics(): Map<string, any> {
    const metrics = new Map();
    
    // Calculate average latencies
    for (const [operation, latencies] of this.performanceMetrics) {
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95 = this.calculatePercentile(latencies, 95);
      const p99 = this.calculatePercentile(latencies, 99);
      
      metrics.set(operation, { avg, p95, p99 });
    }

    // Add active streams count
    metrics.set('active_streams', this.activeStreams.size);
    metrics.set('active_recognizers', this.recognizers.size);

    return metrics;
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  /**
   * Clean up resources
   */
  public async destroy(): Promise<void> {
    // Stop all active recognitions
    const stopPromises = Array.from(this.recognizers.keys()).map(callId =>
      this.stopStreamingRecognition(callId)
    );

    await Promise.allSettled(stopPromises);
    
    this.recognizers.clear();
    this.activeStreams.clear();
    this.performanceMetrics.clear();
    
    logger.info('AzureSTTService destroyed');
  }
}

// Stream context interface
interface StreamContext {
  pushStream: speechSDK.PushAudioInputStream;
  startTime: number;
  lastActivityTime: number;
  config: Partial<STTConfig>;
  results: STTResult[];
}

// Export singleton instance
export default new AzureSTTService();