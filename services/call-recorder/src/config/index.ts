import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT || '3010'),
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
    trustProxy: process.env.TRUST_PROXY === 'true',
  },

  // Storage Configuration
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'azure', // 'azure' | 'aws' | 'local'
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB
    allowedFormats: ['wav', 'mp3', 'opus', 'webm', 'ogg', 'm4a'],
    compressionQuality: parseInt(process.env.COMPRESSION_QUALITY || '128'), // kbps
    
    // Azure Blob Storage
    azure: {
      connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
      containerName: process.env.AZURE_CONTAINER_NAME || 'call-recordings',
      sasTokenDuration: parseInt(process.env.AZURE_SAS_DURATION || '3600'), // 1 hour
      cdnEndpoint: process.env.AZURE_CDN_ENDPOINT || '',
    },
    
    // AWS S3
    aws: {
      region: process.env.AWS_REGION || 'us-east-1',
      bucketName: process.env.AWS_BUCKET_NAME || 'ai-ninja-recordings',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      cloudFrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN || '',
      presignedUrlExpiry: parseInt(process.env.AWS_PRESIGNED_URL_EXPIRY || '3600'),
    },
    
    // Local Storage
    local: {
      uploadDir: process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '../../uploads'),
      tempDir: process.env.LOCAL_TEMP_DIR || path.join(__dirname, '../../temp'),
    },
  },

  // Encryption Configuration
  encryption: {
    algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
    keyDerivation: process.env.KEY_DERIVATION || 'pbkdf2',
    iterations: parseInt(process.env.KEY_ITERATIONS || '100000'),
    saltLength: parseInt(process.env.SALT_LENGTH || '32'),
    ivLength: parseInt(process.env.IV_LENGTH || '16'),
    tagLength: parseInt(process.env.TAG_LENGTH || '16'),
    masterKey: process.env.MASTER_ENCRYPTION_KEY || '',
    keyRotationDays: parseInt(process.env.KEY_ROTATION_DAYS || '30'),
  },

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'ai_ninja',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || '2'),
      max: parseInt(process.env.DB_POOL_MAX || '10'),
    },
    ssl: process.env.DB_SSL === 'true',
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: 'call-recorder:',
    ttl: {
      metadata: parseInt(process.env.REDIS_TTL_METADATA || '3600'), // 1 hour
      presignedUrl: parseInt(process.env.REDIS_TTL_URL || '900'), // 15 minutes
      session: parseInt(process.env.REDIS_TTL_SESSION || '1800'), // 30 minutes
    },
  },

  // Queue Configuration
  queue: {
    redis: {
      host: process.env.QUEUE_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.QUEUE_REDIS_PORT || process.env.REDIS_PORT || '6379'),
      password: process.env.QUEUE_REDIS_PASSWORD || process.env.REDIS_PASSWORD || '',
    },
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  },

  // Audio Processing Configuration
  ffmpeg: {
    path: process.env.FFMPEG_PATH || 'ffmpeg',
    threads: parseInt(process.env.FFMPEG_THREADS || '2'),
    timeout: parseInt(process.env.FFMPEG_TIMEOUT || '30000'), // 30 seconds
    formats: {
      output: process.env.AUDIO_OUTPUT_FORMAT || 'mp3',
      codec: process.env.AUDIO_CODEC || 'libmp3lame',
      bitrate: process.env.AUDIO_BITRATE || '128k',
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE || '44100'),
      channels: parseInt(process.env.AUDIO_CHANNELS || '2'),
    },
  },

  // Lifecycle Management
  lifecycle: {
    retentionDays: {
      recording: parseInt(process.env.RETENTION_DAYS_RECORDING || '30'),
      transcript: parseInt(process.env.RETENTION_DAYS_TRANSCRIPT || '365'),
      metadata: parseInt(process.env.RETENTION_DAYS_METADATA || '730'), // 2 years
    },
    archival: {
      enabled: process.env.ARCHIVAL_ENABLED === 'true',
      tier: process.env.ARCHIVAL_TIER || 'cold', // 'cool' | 'cold' | 'archive'
      afterDays: parseInt(process.env.ARCHIVAL_AFTER_DAYS || '7'),
    },
    deletion: {
      batchSize: parseInt(process.env.DELETION_BATCH_SIZE || '100'),
      schedule: process.env.DELETION_SCHEDULE || '0 2 * * *', // 2 AM daily
    },
  },

  // Security Configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || '',
    jwtExpiry: process.env.JWT_EXPIRY || '1h',
    apiKeys: process.env.API_KEYS?.split(',') || [],
    rateLimiting: {
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    },
    ipWhitelist: process.env.IP_WHITELIST?.split(',') || [],
    auditLog: {
      enabled: process.env.AUDIT_LOG_ENABLED !== 'false',
      level: process.env.AUDIT_LOG_LEVEL || 'info',
    },
  },

  // Monitoring Configuration
  monitoring: {
    prometheus: {
      enabled: process.env.PROMETHEUS_ENABLED === 'true',
      port: parseInt(process.env.PROMETHEUS_PORT || '9090'),
      path: process.env.PROMETHEUS_PATH || '/metrics',
    },
    healthCheck: {
      enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      path: process.env.HEALTH_CHECK_PATH || '/health',
      detailed: process.env.HEALTH_CHECK_DETAILED === 'true',
    },
  },

  // Compliance Configuration
  compliance: {
    gdpr: {
      enabled: process.env.GDPR_ENABLED === 'true',
      anonymizationDelay: parseInt(process.env.GDPR_ANONYMIZATION_DELAY || '2592000000'), // 30 days in ms
      dataExportFormat: process.env.GDPR_EXPORT_FORMAT || 'json',
    },
    dataClassification: {
      voiceRecordings: 'Level3', // Highest sensitivity
      transcripts: 'Level3',
      metadata: 'Level2',
      analytics: 'Level2',
    },
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    directory: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
    filename: process.env.LOG_FILENAME || 'call-recorder-%DATE%.log',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    console: process.env.LOG_CONSOLE !== 'false',
  },
};

// Validate critical configuration
export function validateConfig(): void {
  const errors: string[] = [];

  // Check storage provider configuration
  if (config.storage.provider === 'azure' && !config.storage.azure.connectionString) {
    errors.push('Azure Storage connection string is required');
  }
  
  if (config.storage.provider === 'aws' && (!config.storage.aws.accessKeyId || !config.storage.aws.secretAccessKey)) {
    errors.push('AWS credentials are required');
  }

  // Check encryption configuration
  if (!config.encryption.masterKey) {
    errors.push('Master encryption key is required');
  }

  // Check database configuration
  if (!config.database.password && config.server.environment === 'production') {
    errors.push('Database password is required in production');
  }

  // Check security configuration
  if (!config.security.jwtSecret) {
    errors.push('JWT secret is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export default config;