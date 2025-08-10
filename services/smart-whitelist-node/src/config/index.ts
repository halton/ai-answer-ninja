import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  // Server Configuration
  PORT: z.string().default('3006').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database Configuration
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().default('5432').transform(Number),
  DB_NAME: z.string().default('ai_answer_ninja'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('password'),
  DB_SSL: z.string().default('false').transform(val => val === 'true'),
  DB_POOL_MIN: z.string().default('5').transform(Number),
  DB_POOL_MAX: z.string().default('20').transform(Number),
  
  // Redis Configuration
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().default('0').transform(Number),
  
  // Cache Configuration
  CACHE_TTL_WHITELIST: z.string().default('600').transform(Number), // 10 minutes
  CACHE_TTL_SPAM_PROFILE: z.string().default('7200').transform(Number), // 2 hours
  CACHE_TTL_USER_CONFIG: z.string().default('1800').transform(Number), // 30 minutes
  CACHE_TTL_ML_FEATURES: z.string().default('3600').transform(Number), // 1 hour
  
  // ML Configuration
  ML_ENABLED: z.string().default('true').transform(val => val === 'true'),
  ML_CONFIDENCE_THRESHOLD: z.string().default('0.7').transform(Number),
  ML_AUTO_LEARN_THRESHOLD: z.string().default('0.85').transform(Number),
  ML_FEATURE_WORKERS: z.string().default('4').transform(Number),
  ML_LEARNING_QUEUE_SIZE: z.string().default('1000').transform(Number),
  
  // Security Configuration
  JWT_SECRET: z.string().default('your-secret-key'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  RATE_LIMIT_WINDOW: z.string().default('900000').transform(Number), // 15 minutes
  RATE_LIMIT_MAX: z.string().default('100').transform(Number),
  
  // Performance Configuration
  REQUEST_TIMEOUT: z.string().default('10000').transform(Number), // 10 seconds
  SHUTDOWN_TIMEOUT: z.string().default('30000').transform(Number), // 30 seconds
  
  // Monitoring Configuration
  METRICS_ENABLED: z.string().default('true').transform(val => val === 'true'),
  HEALTH_CHECK_INTERVAL: z.string().default('30000').transform(Number), // 30 seconds
  
  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE_ENABLED: z.string().default('true').transform(val => val === 'true'),
  LOG_FILE_PATH: z.string().default('./logs/smart-whitelist.log'),
});

export type Config = z.infer<typeof ConfigSchema>;

const parseConfig = (): Config => {
  try {
    return ConfigSchema.parse(process.env);
  } catch (error) {
    console.error('Configuration validation failed:', error);
    process.exit(1);
  }
};

export const config = parseConfig();

// Performance targets configuration
export const PERFORMANCE_TARGETS = {
  WHITELIST_LOOKUP_MS: 5,
  ML_CLASSIFICATION_MS: 100,
  CACHE_HIT_RATE: 0.9,
  MAX_CONCURRENT_REQUESTS: 1000,
} as const;

// Feature flags
export const FEATURES = {
  ADVANCED_ML: config.NODE_ENV === 'production',
  AUTO_CLEANUP: true,
  REAL_TIME_LEARNING: true,
  BATCH_PROCESSING: config.NODE_ENV === 'production',
} as const;

export default config;