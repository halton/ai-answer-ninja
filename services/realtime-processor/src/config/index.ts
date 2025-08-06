import dotenv from 'dotenv';
import { ServiceConfig } from '../types';

dotenv.config();

export const config: ServiceConfig = {
  server: {
    port: parseInt(process.env.PORT || '3002', 10),
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '1000', 10),
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000', 10),
    keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT || '30000', 10),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    database: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '1000', 10),
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '5000', 10),
  },
  azure: {
    speech: {
      key: process.env.AZURE_SPEECH_KEY || '',
      region: process.env.AZURE_SPEECH_REGION || 'eastus2',
      endpoint: process.env.AZURE_SPEECH_ENDPOINT || '',
      language: process.env.AZURE_SPEECH_LANGUAGE || 'zh-CN',
      outputFormat: process.env.AZURE_SPEECH_OUTPUT_FORMAT || 'audio-16khz-32kbitrate-mono-mp3',
    },
    openai: {
      key: process.env.AZURE_OPENAI_KEY || '',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
      maxTokens: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS || '150', 10),
      temperature: parseFloat(process.env.AZURE_OPENAI_TEMPERATURE || '0.7'),
    },
  },
  performance: {
    audioChunkSize: parseInt(process.env.AUDIO_CHUNK_SIZE || '1024', 10),
    maxAudioDuration: parseInt(process.env.MAX_AUDIO_DURATION || '180000', 10),
    processingTimeout: parseInt(process.env.PROCESSING_TIMEOUT || '5000', 10),
    maxConcurrentProcessing: parseInt(process.env.MAX_CONCURRENT_PROCESSING || '10', 10),
    cacheSize: parseInt(process.env.CACHE_SIZE || '1000', 10),
    compressionEnabled: process.env.COMPRESSION_ENABLED === 'true',
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    corsOrigins: (process.env.ALLOWED_ORIGINS || 'localhost:3000').split(','),
    rateLimiting: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      maxConnections: parseInt(process.env.RATE_LIMIT_MAX_CONNECTIONS || '10', 10),
      skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESS === 'true',
    },
    encryption: {
      enabled: process.env.ENCRYPTION_ENABLED === 'true',
      algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
      keySize: parseInt(process.env.ENCRYPTION_KEY_SIZE || '32', 10),
    },
  },
  monitoring: {
    enabled: process.env.METRICS_ENABLED === 'true',
    metricsInterval: parseInt(process.env.METRICS_INTERVAL || '5000', 10),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    performanceTracking: process.env.PERFORMANCE_MONITORING === 'true',
  },
};

export default config;