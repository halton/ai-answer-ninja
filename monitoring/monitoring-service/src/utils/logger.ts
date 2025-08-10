import winston from 'winston';
import config from '../config';

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, traceId, spanId, userId, callId, ...meta }) => {
    const logEntry: any = {
      timestamp,
      level,
      message,
      service: service || 'monitoring-service',
    };

    // Add tracing information if available
    if (traceId) logEntry.traceId = traceId;
    if (spanId) logEntry.spanId = spanId;
    if (userId) logEntry.userId = userId;
    if (callId) logEntry.callId = callId;

    // Add metadata
    if (Object.keys(meta).length > 0) {
      logEntry.meta = meta;
    }

    return JSON.stringify(logEntry);
  })
);

// Create Winston logger instance
const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  defaultMeta: { 
    service: 'monitoring-service',
    version: process.env.npm_package_version || '1.0.0',
    environment: config.nodeEnv,
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/monitoring-service.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),

    // Separate file for error logs
    new winston.transports.File({
      filename: 'logs/monitoring-service-errors.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 3,
      tailable: true
    })
  ],

  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ],
  exitOnError: false
});

// Enhanced logging methods
export class Logger {
  private static instance: Logger;
  private winston: winston.Logger;

  private constructor() {
    this.winston = logger;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  // Standard logging methods
  error(message: string, meta?: any): void {
    this.winston.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }

  info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }

  // Context-aware logging methods
  logWithContext(level: string, message: string, context: {
    traceId?: string;
    spanId?: string;
    userId?: string;
    callId?: string;
    service?: string;
    operation?: string;
    duration?: number;
    error?: Error;
    [key: string]: any;
  }): void {
    this.winston.log(level, message, context);
  }

  // Alert-specific logging
  logAlert(alert: {
    id: string;
    name: string;
    severity: string;
    status: string;
    message: string;
    labels?: Record<string, string>;
  }): void {
    this.winston.info('Alert triggered', {
      alertId: alert.id,
      alertName: alert.name,
      severity: alert.severity,
      status: alert.status,
      message: alert.message,
      labels: alert.labels,
      type: 'alert'
    });
  }

  // Metric-specific logging
  logMetric(metric: {
    name: string;
    value: number;
    labels?: Record<string, string>;
    timestamp?: Date;
  }): void {
    this.winston.debug('Metric recorded', {
      metricName: metric.name,
      value: metric.value,
      labels: metric.labels,
      timestamp: metric.timestamp || new Date(),
      type: 'metric'
    });
  }

  // Performance logging
  logPerformance(operation: string, duration: number, context?: any): void {
    this.winston.info('Performance measurement', {
      operation,
      duration,
      durationMs: `${duration}ms`,
      ...context,
      type: 'performance'
    });
  }

  // Health check logging
  logHealthCheck(service: string, status: 'healthy' | 'unhealthy' | 'degraded', details?: any): void {
    this.winston.info('Health check result', {
      service,
      status,
      details,
      type: 'healthcheck'
    });
  }

  // Service interaction logging
  logServiceCall(service: string, endpoint: string, method: string, statusCode: number, duration: number): void {
    const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
    this.winston[level]('Service call', {
      service,
      endpoint,
      method,
      statusCode,
      duration,
      type: 'service_call'
    });
  }

  // Security event logging
  logSecurityEvent(event: string, details: any): void {
    this.winston.warn('Security event', {
      event,
      details,
      type: 'security'
    });
  }

  // Business event logging
  logBusinessEvent(event: string, data: any): void {
    this.winston.info('Business event', {
      event,
      data,
      type: 'business'
    });
  }

  // Configuration change logging
  logConfigChange(component: string, changes: any, userId?: string): void {
    this.winston.warn('Configuration changed', {
      component,
      changes,
      userId,
      type: 'config_change'
    });
  }

  // Create child logger with context
  child(context: Record<string, any>): winston.Logger {
    return this.winston.child(context);
  }

  // Stream interface for HTTP request logging
  get stream() {
    return {
      write: (message: string) => {
        this.winston.info(message.trim());
      }
    };
  }
}

// Export default instance
const loggerInstance = Logger.getInstance();
export default loggerInstance;

// Export specific logging functions for convenience
export const log = {
  error: (message: string, meta?: any) => loggerInstance.error(message, meta),
  warn: (message: string, meta?: any) => loggerInstance.warn(message, meta),
  info: (message: string, meta?: any) => loggerInstance.info(message, meta),
  debug: (message: string, meta?: any) => loggerInstance.debug(message, meta),
  alert: (alert: any) => loggerInstance.logAlert(alert),
  metric: (metric: any) => loggerInstance.logMetric(metric),
  performance: (operation: string, duration: number, context?: any) => 
    loggerInstance.logPerformance(operation, duration, context),
  health: (service: string, status: 'healthy' | 'unhealthy' | 'degraded', details?: any) => 
    loggerInstance.logHealthCheck(service, status, details),
  serviceCall: (service: string, endpoint: string, method: string, statusCode: number, duration: number) => 
    loggerInstance.logServiceCall(service, endpoint, method, statusCode, duration),
  security: (event: string, details: any) => loggerInstance.logSecurityEvent(event, details),
  business: (event: string, data: any) => loggerInstance.logBusinessEvent(event, data),
  configChange: (component: string, changes: any, userId?: string) => 
    loggerInstance.logConfigChange(component, changes, userId),
};