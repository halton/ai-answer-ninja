import dotenv from 'dotenv';
import { ServiceConfig } from '../types';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Export configuration
export const config: ServiceConfig = {
  azure: {
    speechKey: process.env.AZURE_SPEECH_KEY!,
    speechRegion: process.env.AZURE_SPEECH_REGION!,
    speechEndpoint: process.env.AZURE_SPEECH_ENDPOINT,
    customVoiceEndpoint: process.env.AZURE_CUSTOM_VOICE_ENDPOINT,
    customVoiceProjectId: process.env.AZURE_CUSTOM_VOICE_PROJECT_ID,
    customVoiceDeploymentId: process.env.AZURE_CUSTOM_VOICE_DEPLOYMENT_ID,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  performance: {
    maxConcurrentSTT: parseInt(process.env.MAX_CONCURRENT_STT || '10', 10),
    maxConcurrentTTS: parseInt(process.env.MAX_CONCURRENT_TTS || '10', 10),
    audioBufferSize: parseInt(process.env.AUDIO_BUFFER_SIZE || '4096', 10),
    streamChunkSize: parseInt(process.env.STREAM_CHUNK_SIZE || '1024', 10),
  },
  cache: {
    ttl: parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10),
    maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
    pregeneratedResponsesEnabled: process.env.PREGENERATED_RESPONSES_ENABLED === 'true',
  },
  monitoring: {
    metricsEnabled: process.env.METRICS_ENABLED === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT || '3012', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  audio: {
    sampleRate: parseInt(process.env.SAMPLE_RATE || '16000', 10),
    format: process.env.AUDIO_FORMAT || 'wav',
    channels: parseInt(process.env.AUDIO_CHANNELS || '1', 10),
    bitDepth: parseInt(process.env.AUDIO_BIT_DEPTH || '16', 10),
  },
  latencyTargets: {
    stt: parseInt(process.env.TARGET_STT_LATENCY || '350', 10),
    tts: parseInt(process.env.TARGET_TTS_LATENCY || '300', 10),
    total: parseInt(process.env.TARGET_TOTAL_LATENCY || '1500', 10),
  },
};

// Service information
export const SERVICE_INFO = {
  name: process.env.SERVICE_NAME || 'speech-services',
  port: parseInt(process.env.SERVICE_PORT || '3010', 10),
  wsPort: parseInt(process.env.WS_PORT || '3011', 10),
  environment: process.env.NODE_ENV || 'development',
  version: process.env.npm_package_version || '1.0.0',
};

// WebSocket configuration
export const WS_CONFIG = {
  port: parseInt(process.env.WS_PORT || '3011', 10),
  heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10),
  maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '1000', 10),
};

// Validate configuration
export function validateConfig(): void {
  // Check Azure configuration
  if (!config.azure.speechKey || !config.azure.speechRegion) {
    throw new Error('Invalid Azure Speech configuration');
  }

  // Check Redis configuration
  if (config.redis.port < 1 || config.redis.port > 65535) {
    throw new Error('Invalid Redis port configuration');
  }

  // Check performance settings
  if (config.performance.maxConcurrentSTT < 1) {
    throw new Error('Invalid maxConcurrentSTT configuration');
  }

  if (config.performance.maxConcurrentTTS < 1) {
    throw new Error('Invalid maxConcurrentTTS configuration');
  }

  // Check audio settings
  const validSampleRates = [8000, 16000, 24000, 48000];
  if (!validSampleRates.includes(config.audio.sampleRate)) {
    console.warn(`Unusual sample rate: ${config.audio.sampleRate}`);
  }

  // Check latency targets
  if (config.latencyTargets.stt < 50) {
    console.warn('STT latency target might be too aggressive');
  }

  if (config.latencyTargets.tts < 50) {
    console.warn('TTS latency target might be too aggressive');
  }
}

// Development mode helpers
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';

// Export default config
export default config;