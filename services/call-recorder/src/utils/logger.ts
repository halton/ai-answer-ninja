import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { config } from '../config';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create transports
const transports: winston.transport[] = [];

// Console transport
if (config.logging.console) {
  transports.push(
    new winston.transports.Console({
      format: config.server.environment === 'development' ? consoleFormat : logFormat,
      level: config.logging.level
    })
  );
}

// File transport with rotation
if (config.server.environment !== 'test') {
  // General log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(config.logging.directory, config.logging.filename),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      format: logFormat,
      level: config.logging.level
    })
  );

  // Error log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(config.logging.directory, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      format: logFormat,
      level: 'error'
    })
  );

  // Audit log file (for security events)
  if (config.security.auditLog.enabled) {
    transports.push(
      new DailyRotateFile({
        filename: path.join(config.logging.directory, 'audit-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: config.logging.maxSize,
        maxFiles: '90d', // Keep audit logs for 90 days
        format: logFormat,
        level: config.security.auditLog.level
      })
    );
  }
}

// Create logger instance
export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  exitOnError: false
});

// Create audit logger
export const auditLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new DailyRotateFile({
      filename: path.join(config.logging.directory, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: config.logging.maxSize,
      maxFiles: '90d',
      format: logFormat
    })
  ]
});

// Stream for Morgan HTTP logging
export const httpLogStream = {
  write: (message: string) => {
    logger.info(message.trim(), { type: 'http' });
  }
};

// Helper functions for structured logging
export const logError = (message: string, error: Error, metadata?: any) => {
  logger.error(message, {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    ...metadata
  });
};

export const logAudit = (action: string, userId: string, resourceId: string, result: 'success' | 'failure', metadata?: any) => {
  auditLogger.info('Audit Event', {
    action,
    userId,
    resourceId,
    result,
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

export const logPerformance = (operation: string, duration: number, metadata?: any) => {
  logger.info('Performance Metric', {
    operation,
    duration,
    unit: 'ms',
    ...metadata
  });
};

export const logSecurity = (event: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata?: any) => {
  logger.warn('Security Event', {
    event,
    severity,
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

export default logger;