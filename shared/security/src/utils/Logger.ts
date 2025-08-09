/**
 * Security-focused Logger
 * Provides secure logging with data sanitization and audit trail
 */

import winston from 'winston';
import * as crypto from 'crypto';

class SecurityLogger {
  private logger: winston.Logger;
  private sensitivePatterns: RegExp[];

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { 
        service: 'security',
        environment: process.env.NODE_ENV || 'development'
      },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    // Patterns for sensitive data that should be redacted
    this.sensitivePatterns = [
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit cards
      /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
      /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g, // Bearer tokens
      /api[_-]?key["\s]*[:=]["\s]*[A-Za-z0-9\-._]+/gi, // API keys
      /password["\s]*[:=]["\s]*[^",}\s]+/gi // Passwords
    ];

    // Add file transport in production
    if (process.env.NODE_ENV === 'production') {
      this.logger.add(new winston.transports.File({
        filename: 'logs/security-error.log',
        level: 'error',
        maxsize: 10485760, // 10MB
        maxFiles: 5
      }));

      this.logger.add(new winston.transports.File({
        filename: 'logs/security-audit.log',
        level: 'info',
        maxsize: 10485760, // 10MB
        maxFiles: 10
      }));
    }
  }

  /**
   * Sanitize log data to remove sensitive information
   */
  private sanitize(data: any): any {
    if (typeof data === 'string') {
      let sanitized = data;
      for (const pattern of this.sensitivePatterns) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      return sanitized;
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: any = Array.isArray(data) ? [] : {};
      
      for (const key in data) {
        // Redact sensitive field names
        if (/password|secret|token|key|auth|credential/i.test(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(data[key]);
        }
      }
      
      return sanitized;
    }

    return data;
  }

  /**
   * Generate log integrity hash
   */
  private generateIntegrity(message: string, metadata: any): string {
    const data = JSON.stringify({ message, metadata, timestamp: Date.now() });
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Log info level message
   */
  public info(message: string, metadata?: any): void {
    const sanitizedMeta = this.sanitize(metadata);
    const integrity = this.generateIntegrity(message, sanitizedMeta);
    
    this.logger.info(message, {
      ...sanitizedMeta,
      integrity
    });
  }

  /**
   * Log warning level message
   */
  public warn(message: string, metadata?: any): void {
    const sanitizedMeta = this.sanitize(metadata);
    const integrity = this.generateIntegrity(message, sanitizedMeta);
    
    this.logger.warn(message, {
      ...sanitizedMeta,
      integrity
    });
  }

  /**
   * Log error level message
   */
  public error(message: string, metadata?: any): void {
    const sanitizedMeta = this.sanitize(metadata);
    const integrity = this.generateIntegrity(message, sanitizedMeta);
    
    this.logger.error(message, {
      ...sanitizedMeta,
      integrity,
      stack: metadata?.stack || new Error().stack
    });
  }

  /**
   * Log security event
   */
  public security(event: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata?: any): void {
    const sanitizedMeta = this.sanitize(metadata);
    const integrity = this.generateIntegrity(event, sanitizedMeta);
    
    this.logger.log({
      level: severity === 'critical' ? 'error' : 'warn',
      message: `SECURITY_EVENT: ${event}`,
      severity,
      ...sanitizedMeta,
      integrity,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log audit event
   */
  public audit(action: string, userId: string, metadata?: any): void {
    const sanitizedMeta = this.sanitize(metadata);
    const auditEntry = {
      action,
      userId,
      ...sanitizedMeta,
      timestamp: new Date().toISOString(),
      integrity: this.generateIntegrity(action, { userId, ...sanitizedMeta })
    };
    
    this.logger.info(`AUDIT: ${action}`, auditEntry);
  }
}

// Export singleton instance
export const logger = new SecurityLogger();