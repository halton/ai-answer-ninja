import dotenv from 'dotenv';
import { AppConfig } from '@/types';

// Load environment variables
dotenv.config();

/**
 * Validates required environment variables
 */
function validateEnv(): void {
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'EMAIL_HOST',
    'EMAIL_USER',
    'EMAIL_PASS'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Get environment variable with type safety
 */
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value || defaultValue!;
}

/**
 * Get numeric environment variable
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

/**
 * Get boolean environment variable
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  return value.toLowerCase() === 'true';
}

// Validate environment on startup
if (process.env.NODE_ENV !== 'test') {
  validateEnv();
}

/**
 * Application configuration
 */
export const config: AppConfig = {
  port: getEnvNumber('PORT', 3005),
  nodeEnv: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  
  database: {
    url: getEnv('DATABASE_URL'),
    poolSize: getEnvNumber('DB_POOL_SIZE', 10),
    timeout: getEnvNumber('DB_TIMEOUT', 30000)
  },
  
  redis: {
    url: getEnv('REDIS_URL'),
    keyPrefix: getEnv('REDIS_KEY_PREFIX', 'ai-ninja:user-mgmt:'),
    ttl: getEnvNumber('REDIS_TTL', 3600)
  },
  
  jwt: {
    accessSecret: getEnv('JWT_ACCESS_SECRET'),
    refreshSecret: getEnv('JWT_REFRESH_SECRET'),
    accessExpiry: getEnv('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: getEnv('JWT_REFRESH_EXPIRY', '7d'),
    issuer: getEnv('JWT_ISSUER', 'ai-answer-ninja'),
    audience: getEnv('JWT_AUDIENCE', 'ai-answer-ninja-users')
  },
  
  email: {
    host: getEnv('EMAIL_HOST'),
    port: getEnvNumber('EMAIL_PORT', 587),
    secure: getEnvBoolean('EMAIL_SECURE', false),
    auth: {
      user: getEnv('EMAIL_USER'),
      pass: getEnv('EMAIL_PASS')
    },
    from: getEnv('EMAIL_FROM', 'noreply@ai-answer-ninja.com')
  },
  
  security: {
    bcryptRounds: getEnvNumber('BCRYPT_ROUNDS', 12),
    maxLoginAttempts: getEnvNumber('MAX_LOGIN_ATTEMPTS', 5),
    lockoutDuration: getEnvNumber('LOCKOUT_DURATION', 900000), // 15 minutes
    sessionTimeout: getEnvNumber('SESSION_TIMEOUT', 3600000), // 1 hour
    mfaWindowSize: getEnvNumber('MFA_WINDOW_SIZE', 2),
    passwordMinLength: getEnvNumber('PASSWORD_MIN_LENGTH', 8),
    passwordRequireSpecial: getEnvBoolean('PASSWORD_REQUIRE_SPECIAL', true)
  },
  
  rateLimit: {
    windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
    max: getEnvNumber('RATE_LIMIT_MAX', 100),
    skipSuccessfulRequests: getEnvBoolean('RATE_LIMIT_SKIP_SUCCESS', false),
    skipFailedRequests: getEnvBoolean('RATE_LIMIT_SKIP_FAILED', false)
  }
};

// Feature flags
export const features = {
  mfaEnabled: getEnvBoolean('FEATURE_MFA_ENABLED', true),
  emailVerificationRequired: getEnvBoolean('FEATURE_EMAIL_VERIFICATION_REQUIRED', false),
  auditLoggingEnabled: getEnvBoolean('FEATURE_AUDIT_LOGGING_ENABLED', true),
  advancedSecurityEnabled: getEnvBoolean('FEATURE_ADVANCED_SECURITY_ENABLED', true),
  userRegistrationEnabled: getEnvBoolean('FEATURE_USER_REGISTRATION_ENABLED', true)
};

// Service URLs
export const services = {
  phoneGateway: getEnv('PHONE_GATEWAY_URL', 'http://localhost:3001'),
  realtimeProcessor: getEnv('REALTIME_PROCESSOR_URL', 'http://localhost:3002'),
  conversationEngine: getEnv('CONVERSATION_ENGINE_URL', 'http://localhost:3003'),
  profileAnalytics: getEnv('PROFILE_ANALYTICS_URL', 'http://localhost:3004')
};

// Constants
export const constants = {
  DEFAULT_PERSONALITY: 'polite' as const,
  DEFAULT_LANGUAGE: 'zh-CN' as const,
  DEFAULT_TIMEZONE: 'Asia/Shanghai' as const,
  DEFAULT_CALL_DURATION: 300,
  MIN_PASSWORD_STRENGTH: 3,
  MFA_CODE_LENGTH: 6,
  BACKUP_CODES_COUNT: 10,
  VERIFICATION_TOKEN_LENGTH: 32,
  PASSWORD_RESET_EXPIRY: 3600000, // 1 hour
  EMAIL_VERIFICATION_EXPIRY: 86400000, // 24 hours
  REFRESH_TOKEN_EXPIRY: 604800000 // 7 days
};

// Role permissions mapping
export const rolePermissions = {
  user: [
    'read:own_data',
    'update:own_profile',
    'delete:own_account',
    'manage:own_whitelist',
    'view:own_calls'
  ],
  moderator: [
    'read:own_data',
    'update:own_profile',
    'delete:own_account',
    'manage:own_whitelist',
    'view:own_calls',
    'view:analytics',
    'manage:spam_profiles'
  ],
  admin: [
    'read:own_data',
    'update:own_profile',
    'delete:own_account',
    'manage:own_whitelist',
    'view:own_calls',
    'read:all_data',
    'update:system_config',
    'manage:users',
    'view:analytics',
    'manage:spam_profiles'
  ],
  system: [
    'read:own_data',
    'update:own_profile', 
    'delete:own_account',
    'manage:own_whitelist',
    'view:own_calls',
    'read:all_data',
    'update:system_config',
    'manage:users',
    'view:analytics',
    'manage:spam_profiles',
    'system:admin'
  ]
} as const;

// Export individual configurations for convenience
export { config as default };
export const isDevelopment = config.nodeEnv === 'development';
export const isProduction = config.nodeEnv === 'production';
export const isTest = config.nodeEnv === 'test';