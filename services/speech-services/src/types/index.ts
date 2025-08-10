// Core Types and Interfaces for Speech Services

// Audio Processing Types
export interface AudioChunk {
  data: Buffer;
  timestamp: number;
  sequenceNumber: number;
  callId: string;
  userId?: string;
  format?: AudioFormat;
}

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  codec: 'pcm' | 'wav' | 'opus' | 'mp3';
}

// Speech Recognition Types
export interface STTConfig {
  language: string;
  profanityOption?: 'masked' | 'removed' | 'raw';
  enableDictation?: boolean;
  enableWordLevelTimestamps?: boolean;
  maxAlternatives?: number;
  initialSilenceTimeout?: number;
  endSilenceTimeout?: number;
}

export interface STTResult {
  text: string;
  confidence: number;
  language: string;
  timestamp: number;
  duration: number;
  alternatives?: STTAlternative[];
  wordTimestamps?: WordTimestamp[];
  isFinal: boolean;
  latency: number;
}

export interface STTAlternative {
  text: string;
  confidence: number;
}

export interface WordTimestamp {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

// Speech Synthesis Types
export interface TTSConfig {
  voiceName: string;
  language?: string;
  rate?: number; // 0.5 to 2.0
  pitch?: number; // -50% to +50%
  volume?: number; // 0 to 100
  outputFormat?: TTSOutputFormat;
  style?: string;
  styleDegree?: number;
  role?: string;
}

export enum TTSOutputFormat {
  Audio16Khz32KBitRateMonoMp3 = 'audio-16khz-32kbitrate-mono-mp3',
  Audio16Khz64KBitRateMonoMp3 = 'audio-16khz-64kbitrate-mono-mp3',
  Audio16Khz128KBitRateMonoMp3 = 'audio-16khz-128kbitrate-mono-mp3',
  Audio24Khz48KBitRateMonoMp3 = 'audio-24khz-48kbitrate-mono-mp3',
  Audio24Khz96KBitRateMonoMp3 = 'audio-24khz-96kbitrate-mono-mp3',
  Audio48Khz192KBitRateMonoMp3 = 'audio-48khz-192kbitrate-mono-mp3',
  Riff16Khz16BitMonoPcm = 'riff-16khz-16bit-mono-pcm',
  Riff24Khz16BitMonoPcm = 'riff-24khz-16bit-mono-pcm',
  Riff48Khz16BitMonoPcm = 'riff-48khz-16bit-mono-pcm',
  Raw16Khz16BitMonoPcm = 'raw-16khz-16bit-mono-pcm',
  Raw24Khz16BitMonoPcm = 'raw-24khz-16bit-mono-pcm',
  Raw48Khz16BitMonoPcm = 'raw-48khz-16bit-mono-pcm',
}

export interface TTSResult {
  audioData: Buffer;
  duration: number;
  format: TTSOutputFormat;
  timestamp: number;
  voiceUsed: string;
  latency: number;
  cached: boolean;
}

// Custom Voice Types
export interface CustomVoiceProfile {
  profileId: string;
  userId: string;
  voiceName: string;
  modelId?: string;
  trainingStatus?: 'pending' | 'training' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  samples?: VoiceSample[];
}

export interface VoiceSample {
  sampleId: string;
  audioUrl: string;
  transcript: string;
  duration: number;
  quality: number;
}

// Voice Activity Detection
export interface VADConfig {
  energyThreshold: number;
  silenceThreshold: number;
  minSpeechDuration: number;
  maxSilenceDuration: number;
  smoothingWindow: number;
}

export interface VADResult {
  isSpeech: boolean;
  confidence: number;
  energyLevel: number;
  timestamp: number;
  speechStart?: number;
  speechEnd?: number;
}

// Cache Types
export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number;
  hits: number;
  size?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  evictions: number;
}

// Performance Monitoring
export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  latency: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface LatencyTarget {
  operation: string;
  target: number;
  p50: number;
  p95: number;
  p99: number;
  average: number;
}

// WebSocket Messages
export interface WSMessage {
  type: WSMessageType;
  callId: string;
  timestamp: number;
  sequenceNumber?: number;
  data?: any;
}

export enum WSMessageType {
  AudioChunk = 'audio_chunk',
  STTResult = 'stt_result',
  TTSRequest = 'tts_request',
  TTSResult = 'tts_result',
  VADResult = 'vad_result',
  Error = 'error',
  Heartbeat = 'heartbeat',
  ConnectionInit = 'connection_init',
  ConnectionAck = 'connection_ack',
  ConnectionClose = 'connection_close',
}

// Stream Processing
export interface StreamProcessor {
  processChunk(chunk: AudioChunk): Promise<void>;
  getResults(): Promise<any>;
  reset(): void;
  destroy(): void;
}

export interface StreamPipeline {
  addProcessor(processor: StreamProcessor): void;
  removeProcessor(processor: StreamProcessor): void;
  process(chunk: AudioChunk): Promise<void>;
  getMetrics(): PipelineMetrics;
}

export interface PipelineMetrics {
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  averageLatency: number;
  throughput: number;
}

// Error Types
export class SpeechServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'SpeechServiceError';
  }
}

export enum ErrorCode {
  STT_INIT_FAILED = 'STT_INIT_FAILED',
  STT_RECOGNITION_FAILED = 'STT_RECOGNITION_FAILED',
  TTS_INIT_FAILED = 'TTS_INIT_FAILED',
  TTS_SYNTHESIS_FAILED = 'TTS_SYNTHESIS_FAILED',
  AUDIO_FORMAT_ERROR = 'AUDIO_FORMAT_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  INVALID_CONFIG = 'INVALID_CONFIG',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
}

// Service Configuration
export interface ServiceConfig {
  azure: {
    speechKey: string;
    speechRegion: string;
    speechEndpoint?: string;
    customVoiceEndpoint?: string;
    customVoiceProjectId?: string;
    customVoiceDeploymentId?: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  performance: {
    maxConcurrentSTT: number;
    maxConcurrentTTS: number;
    audioBufferSize: number;
    streamChunkSize: number;
  };
  cache: {
    ttl: number;
    maxSize: number;
    pregeneratedResponsesEnabled: boolean;
  };
  monitoring: {
    metricsEnabled: boolean;
    metricsPort: number;
    logLevel: string;
  };
  audio: {
    sampleRate: number;
    format: string;
    channels: number;
    bitDepth: number;
  };
  latencyTargets: {
    stt: number;
    tts: number;
    total: number;
  };
}

// Response Cache Types
export interface PreGeneratedResponse {
  intent: string;
  text: string;
  audioData: Buffer;
  voiceName: string;
  language: string;
  createdAt: Date;
  usage: number;
}

export interface ResponsePrediction {
  predictedIntent: string;
  confidence: number;
  suggestedResponses: string[];
  preloadedAudio?: Buffer;
}

// Health Check Types
export interface HealthStatus {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  latency: {
    stt: number;
    tts: number;
  };
  errors: number;
  uptime: number;
  dependencies: {
    azure: boolean;
    redis: boolean;
  };
}