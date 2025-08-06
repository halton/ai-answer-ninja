import winston from 'winston';
import { config, isDevelopment } from '@/config';

/**
 * Custom log format for development
 */
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}${stackStr}`;
  })
);

/**
 * Custom log format for production
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Create logger instance with appropriate configuration
 */
const logger = winston.createLogger({
  level: isDevelopment ? 'debug' : 'info',
  format: isDevelopment ? developmentFormat : productionFormat,
  defaultMeta: {
    service: 'user-management',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      stderrLevels: ['error']
    })
  ],
  // Don't exit on handled exceptions
  exitOnError: false
});

// Add file transports for production
if (!isDevelopment) {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 50 * 1024 * 1024, // 50MB
    maxFiles: 5,
    tailable: true
  }));

  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 50 * 1024 * 1024, // 50MB
    maxFiles: 10,
    tailable: true
  }));
}

/**
 * Security-focused audit logger
 */
export const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'user-management-audit',
    type: 'security'
  },
  transports: [
    new winston.transports.File({
      filename: 'logs/audit.log',
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 20,
      tailable: true
    })
  ],
  exitOnError: false
});

/**
 * Performance logger for monitoring
 */
export const performanceLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'user-management-performance'
  },
  transports: [
    new winston.transports.File({
      filename: 'logs/performance.log',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
      tailable: true
    })
  ],
  exitOnError: false
});

/**
 * Log security events with standardized format
 */
export function logSecurityEvent(event: {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, any>;
}): void {
  auditLogger.info('security_event', {
    ...event,
    timestamp: new Date().toISOString()
  });

  // Also log to main logger for high/critical events
  if (event.severity === 'high' || event.severity === 'critical') {
    logger.warn('Critical security event', event);
  }
}

/**
 * Log authentication events
 */
export function logAuthEvent(event: {
  action: 'login' | 'logout' | 'register' | 'password_reset' | 'mfa_verify';
  userId?: string;
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
}): void {
  auditLogger.info('auth_event', {
    ...event,
    timestamp: new Date().toISOString()
  });

  const level = event.success ? 'info' : 'warn';
  logger[level](`Authentication ${event.action}`, {
    userId: event.userId,
    success: event.success,
    ipAddress: event.ipAddress
  });
}

/**
 * Log performance metrics
 */
export function logPerformance(metric: {
  operation: string;
  duration: number;
  success: boolean;
  details?: Record<string, any>;
}): void {
  performanceLogger.info('performance_metric', {
    ...metric,
    timestamp: new Date().toISOString()
  });

  // Log slow operations to main logger
  if (metric.duration > 1000) {
    logger.warn('Slow operation detected', metric);
  }
}

/**
 * Create request logger middleware
 */
export function createRequestLogger() {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${JSON.stringify(meta)}`;
    })
  );
}

/**
 * Sanitize sensitive data from logs
 */
export function sanitizeLogData(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sensitiveFields = [
    'password',
    'passwordHash',
    'token',
    'secret',
    'authorization',
    'cookie',
    'session',
    'mfaSecret',
    'backupCodes'
  ];

  const sanitized = { ...data };

  Object.keys(sanitized).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  });

  return sanitized;
}

export default logger;