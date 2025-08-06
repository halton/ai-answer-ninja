/**
 * Type definitions for the Real-time Processor Service
 */

export interface AudioChunk {
  id: string;
  callId: string;
  timestamp: number;
  audioData: Buffer | string; // Base64 encoded audio data
  sequenceNumber: number;
  sampleRate?: number;
  channels?: number;
  format?: AudioFormat;
}

export interface ProcessedAudio {
  id: string;
  callId: string;
  timestamp: number;
  transcript?: string;
  confidence?: number;
  intent?: IntentResult;
  response?: AIResponse;
  audioResponse?: Buffer | string;
  processingLatency: number;
  metadata?: AudioMetadata;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  entities?: Record<string, any>;
  category?: SpamCategory;
  emotionalTone?: EmotionalTone;
}

export interface AIResponse {
  text: string;
  audioData?: Buffer | string;
  shouldTerminate?: boolean;
  confidence: number;
  responseStrategy?: ResponseStrategy;
  metadata?: AIMetadata;
}

export interface WebSocketMessage {
  type: MessageType;
  callId: string;
  timestamp: number;
  data?: any;
  sequenceNumber?: number;
  metadata?: MessageMetadata;
}

export interface ConnectionContext {
  id: string;
  userId: string;
  callId: string;
  startTime: number;
  lastActivity: number;
  isActive: boolean;
  rateLimitInfo: RateLimitInfo;
  audioBuffer: AudioBuffer;
  processingQueue: ProcessingQueue;
}

export interface AudioBuffer {
  chunks: AudioChunk[];
  totalDuration: number;
  lastChunkTime: number;
  isProcessing: boolean;
}

export interface ProcessingQueue {
  pending: AudioChunk[];
  processing: AudioChunk[];
  completed: ProcessedAudio[];
  maxSize: number;
}

export interface RateLimitInfo {
  requestCount: number;
  connectionTime: number;
  lastRequest: number;
  isLimited: boolean;
}

export interface PerformanceMetrics {
  connectionId: string;
  callId: string;
  timestamp: number;
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  resources: ResourceMetrics;
}

export interface LatencyMetrics {
  totalPipeline: number;
  audioPreprocessing: number;
  speechToText: number;
  intentRecognition: number;
  aiGeneration: number;
  textToSpeech: number;
  networkTransmission: number;
}

export interface ThroughputMetrics {
  audioChunksPerSecond: number;
  messagesPerSecond: number;
  bytesPerSecond: number;
  concurrentConnections: number;
}

export interface ResourceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  networkUsage: number;
  redisConnections: number;
}

export interface VoiceActivityResult {
  isSpeech: boolean;
  confidence: number;
  startTime?: number;
  endTime?: number;
  energy: number;
}

export interface AudioMetadata {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: AudioFormat;
  duration: number;
  size: number;
}

export interface AIMetadata {
  model: string;
  temperature: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  processingTime: number;
}

export interface MessageMetadata {
  source: string;
  version: string;
  compression?: string;
  encryption?: boolean;
}

// Enums
export enum MessageType {
  AUDIO_CHUNK = 'audio_chunk',
  AUDIO_RESPONSE = 'audio_response',
  TRANSCRIPT = 'transcript',
  AI_RESPONSE = 'ai_response',
  ERROR = 'error',
  HEARTBEAT = 'heartbeat',
  CONNECTION_STATUS = 'connection_status',
  PROCESSING_STATUS = 'processing_status',
  METRICS = 'metrics'
}

export enum AudioFormat {
  WAV = 'wav',
  MP3 = 'mp3',
  AAC = 'aac',
  OPUS = 'opus',
  PCM = 'pcm'
}

export enum SpamCategory {
  SALES_CALL = 'sales_call',
  LOAN_OFFER = 'loan_offer',
  INVESTMENT_PITCH = 'investment_pitch',
  INSURANCE_SALES = 'insurance_sales',
  SURVEY = 'survey',
  TELEMARKETING = 'telemarketing',
  UNKNOWN = 'unknown'
}

export enum EmotionalTone {
  NEUTRAL = 'neutral',
  FRIENDLY = 'friendly',
  AGGRESSIVE = 'aggressive',
  PERSUASIVE = 'persuasive',
  URGENT = 'urgent',
  CONFUSED = 'confused'
}

export enum ResponseStrategy {
  POLITE_DECLINE = 'polite_decline',
  FIRM_REJECTION = 'firm_rejection',
  HUMOR_DEFLECTION = 'humor_deflection',
  INFORMATION_GATHERING = 'information_gathering',
  CALL_TERMINATION = 'call_termination'
}

export enum ConnectionStatus {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  PROCESSING = 'processing',
  IDLE = 'idle',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  ERROR = 'error'
}

export enum ProcessingStage {
  AUDIO_RECEIVED = 'audio_received',
  PREPROCESSING = 'preprocessing',
  SPEECH_TO_TEXT = 'speech_to_text',
  INTENT_RECOGNITION = 'intent_recognition',
  AI_GENERATION = 'ai_generation',
  TEXT_TO_SPEECH = 'text_to_speech',
  RESPONSE_SENT = 'response_sent',
  ERROR = 'error'
}

// Configuration interfaces
export interface ServiceConfig {
  server: ServerConfig;
  redis: RedisConfig;
  azure: AzureConfig;
  performance: PerformanceConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
}

export interface ServerConfig {
  port: number;
  host: string;
  environment: string;
  maxConnections: number;
  connectionTimeout: number;
  keepAliveTimeout: number;
}

export interface RedisConfig {
  url: string;
  password?: string;
  database: number;
  maxRetries: number;
  retryDelay: number;
  connectTimeout: number;
}

export interface AzureConfig {
  speech: AzureSpeechConfig;
  openai: AzureOpenAIConfig;
}

export interface AzureSpeechConfig {
  key: string;
  region: string;
  endpoint: string;
  language: string;
  outputFormat: string;
}

export interface AzureOpenAIConfig {
  key: string;
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  maxTokens: number;
  temperature: number;
}

export interface PerformanceConfig {
  audioChunkSize: number;
  maxAudioDuration: number;
  processingTimeout: number;
  maxConcurrentProcessing: number;
  cacheSize: number;
  compressionEnabled: boolean;
}

export interface SecurityConfig {
  jwtSecret: string;
  corsOrigins: string[];
  rateLimiting: RateLimitConfig;
  encryption: EncryptionConfig;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxConnections: number;
  skipSuccessfulRequests: boolean;
}

export interface EncryptionConfig {
  enabled: boolean;
  algorithm: string;
  keySize: number;
}

export interface MonitoringConfig {
  enabled: boolean;
  metricsInterval: number;
  healthCheckInterval: number;
  logLevel: string;
  performanceTracking: boolean;
}

// Error types
export class RealtimeProcessorError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'RealtimeProcessorError';
  }
}

export class AudioProcessingError extends RealtimeProcessorError {
  constructor(message: string, details?: any) {
    super(message, 'AUDIO_PROCESSING_ERROR', 400, details);
    this.name = 'AudioProcessingError';
  }
}

export class ConnectionError extends RealtimeProcessorError {
  constructor(message: string, details?: any) {
    super(message, 'CONNECTION_ERROR', 500, details);
    this.name = 'ConnectionError';
  }
}

export class RateLimitError extends RealtimeProcessorError {
  constructor(message: string, details?: any) {
    super(message, 'RATE_LIMIT_ERROR', 429, details);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends RealtimeProcessorError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}