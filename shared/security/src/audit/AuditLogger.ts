/**
 * Audit Logger Service
 * Provides comprehensive audit logging for compliance and security monitoring
 */

import * as crypto from 'crypto';
import { AuditLog, SecurityEvent, DataSubjectRequest, ConsentRecord } from '../types';
import { logger } from '../utils/Logger';

export class AuditLogger {
  private static instance: AuditLogger;
  private auditQueue: AuditLog[] = [];
  private flushInterval: NodeJS.Timeout;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private readonly BATCH_SIZE = 100;

  private constructor() {
    this.startFlushInterval();
  }

  public static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /**
   * Start interval to flush audit logs
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flushAuditLogs();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Log general audit event
   */
  public async log(entry: Partial<AuditLog>): Promise<void> {
    const auditLog: AuditLog = {
      id: this.generateAuditId(),
      timestamp: new Date(),
      success: true,
      ...entry,
      integrity: ''
    };

    // Generate integrity hash
    auditLog.integrity = this.generateIntegrityHash(auditLog);

    // Add to queue
    this.auditQueue.push(auditLog);

    // Flush if queue is full
    if (this.auditQueue.length >= this.BATCH_SIZE) {
      await this.flushAuditLogs();
    }

    // Log to system logger
    logger.audit(auditLog.action, auditLog.userId || 'system', {
      resource: auditLog.resource,
      success: auditLog.success
    });
  }

  /**
   * Log security event
   */
  public async logSecurityEvent(event: Omit<SecurityEvent, 'id'>): Promise<void> {
    const securityEvent: SecurityEvent = {
      id: this.generateEventId(),
      ...event
    };

    await this.log({
      action: `security:${event.type}`,
      resource: event.resource || 'system',
      userId: event.userId,
      sessionId: event.sessionId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      success: false,
      metadata: {
        severity: event.severity,
        details: event.details
      }
    });

    // Additional handling for critical events
    if (event.severity === 'critical') {
      await this.handleCriticalEvent(securityEvent);
    }
  }

  /**
   * Log authentication event
   */
  public async logAuthentication(
    userId: string,
    success: boolean,
    method: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId,
      action: 'authentication',
      resource: 'auth_system',
      method,
      ipAddress,
      userAgent,
      success,
      metadata: {
        authMethod: method,
        timestamp: new Date()
      }
    });
  }

  /**
   * Log authorization event
   */
  public async logAuthorization(
    userId: string,
    resource: string,
    action: string,
    allowed: boolean,
    reason?: string
  ): Promise<void> {
    await this.log({
      userId,
      action: `authorization:${action}`,
      resource,
      success: allowed,
      metadata: {
        allowed,
        reason,
        timestamp: new Date()
      }
    });
  }

  /**
   * Log data access event
   */
  public async logDataAccess(
    userId: string,
    dataType: string,
    operation: 'read' | 'write' | 'delete',
    recordIds?: string[],
    success: boolean = true
  ): Promise<void> {
    await this.log({
      userId,
      action: `data:${operation}`,
      resource: dataType,
      success,
      metadata: {
        operation,
        recordCount: recordIds?.length || 0,
        recordIds: recordIds?.slice(0, 10), // Log first 10 IDs only
        timestamp: new Date()
      }
    });
  }

  /**
   * Log configuration change
   */
  public async logConfigurationChange(
    userId: string,
    configType: string,
    oldValue: any,
    newValue: any
  ): Promise<void> {
    await this.log({
      userId,
      action: 'configuration:change',
      resource: configType,
      success: true,
      metadata: {
        changes: {
          before: this.sanitizeConfigValue(oldValue),
          after: this.sanitizeConfigValue(newValue)
        },
        timestamp: new Date()
      }
    });
  }

  /**
   * Log API call
   */
  public async logAPICall(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      userId,
      action: 'api:call',
      resource: path,
      method,
      ipAddress,
      statusCode,
      duration,
      success: statusCode < 400,
      metadata: {
        endpoint: `${method} ${path}`,
        responseTime: duration,
        timestamp: new Date()
      }
    });
  }

  /**
   * Log voice call processing
   */
  public async logVoiceCall(
    callId: string,
    userId: string,
    action: 'start' | 'end' | 'encrypt' | 'decrypt',
    duration?: number,
    metadata?: any
  ): Promise<void> {
    await this.log({
      userId,
      action: `voice:${action}`,
      resource: 'voice_call',
      resourceId: callId,
      duration,
      success: true,
      metadata: {
        callId,
        action,
        duration,
        ...metadata,
        timestamp: new Date()
      }
    });
  }

  /**
   * Log data subject request (GDPR)
   */
  public async logDataSubjectRequest(request: DataSubjectRequest): Promise<void> {
    await this.log({
      userId: request.userId,
      action: `gdpr:${request.type}`,
      resource: 'personal_data',
      resourceId: request.id,
      success: request.status === 'completed',
      metadata: {
        requestType: request.type,
        status: request.status,
        requestedAt: request.requestedAt,
        processedAt: request.processedAt,
        timestamp: new Date()
      }
    });
  }

  /**
   * Log consent event
   */
  public async logConsent(consent: ConsentRecord): Promise<void> {
    await this.log({
      userId: consent.userId,
      action: 'consent:granted',
      resource: 'consent',
      resourceId: consent.id,
      success: true,
      metadata: {
        purpose: consent.purpose,
        lawfulBasis: consent.lawfulBasis,
        grantedAt: consent.grantedAt,
        version: consent.version,
        timestamp: new Date()
      }
    });
  }

  /**
   * Log consent withdrawal
   */
  public async logConsentWithdrawal(userId: string, purpose: string): Promise<void> {
    await this.log({
      userId,
      action: 'consent:withdrawn',
      resource: 'consent',
      success: true,
      metadata: {
        purpose,
        withdrawnAt: new Date()
      }
    });
  }

  /**
   * Generate audit log ID
   */
  private generateAuditId(): string {
    return `AUDIT_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Generate security event ID
   */
  private generateEventId(): string {
    return `EVENT_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Generate integrity hash for audit log
   */
  private generateIntegrityHash(log: AuditLog): string {
    const data = JSON.stringify({
      id: log.id,
      userId: log.userId,
      action: log.action,
      resource: log.resource,
      success: log.success,
      timestamp: log.timestamp
    });

    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');
  }

  /**
   * Sanitize configuration values
   */
  private sanitizeConfigValue(value: any): any {
    if (typeof value === 'string' && value.length > 100) {
      return '[TRUNCATED]';
    }
    
    if (typeof value === 'object' && value !== null) {
      const sanitized: any = {};
      for (const key in value) {
        if (/password|secret|key|token/i.test(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitizeConfigValue(value[key]);
        }
      }
      return sanitized;
    }

    return value;
  }

  /**
   * Handle critical security events
   */
  private async handleCriticalEvent(event: SecurityEvent): Promise<void> {
    // Send immediate alert
    logger.security(
      `CRITICAL: ${event.type}`,
      'critical',
      {
        userId: event.userId,
        details: event.details
      }
    );

    // Additional critical event handling
    // - Send email/SMS alerts
    // - Trigger incident response
    // - Block user/IP if necessary
  }

  /**
   * Flush audit logs to storage
   */
  private async flushAuditLogs(): Promise<void> {
    if (this.auditQueue.length === 0) {
      return;
    }

    const logsToFlush = this.auditQueue.splice(0, this.BATCH_SIZE);

    try {
      // In production, this would write to database or log aggregation service
      await this.persistAuditLogs(logsToFlush);
      
      logger.info('Audit logs flushed', {
        count: logsToFlush.length,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Failed to flush audit logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        logCount: logsToFlush.length
      });
      
      // Re-queue failed logs
      this.auditQueue.unshift(...logsToFlush);
    }
  }

  /**
   * Persist audit logs to storage
   */
  private async persistAuditLogs(logs: AuditLog[]): Promise<void> {
    // This would write to database or external logging service
    // For now, just log to file through winston
    for (const log of logs) {
      logger.info('AUDIT_RECORD', log);
    }
  }

  /**
   * Query audit logs
   */
  public async queryLogs(
    filters: {
      userId?: string;
      action?: string;
      resource?: string;
      startDate?: Date;
      endDate?: Date;
      success?: boolean;
    },
    limit: number = 100
  ): Promise<AuditLog[]> {
    // In production, this would query from database
    // Returns empty array as placeholder
    return [];
  }

  /**
   * Verify audit log integrity
   */
  public async verifyLogIntegrity(log: AuditLog): Promise<boolean> {
    const expectedHash = this.generateIntegrityHash(log);
    return expectedHash === log.integrity;
  }

  /**
   * Export audit logs for compliance
   */
  public async exportLogs(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const logs = await this.queryLogs({ startDate, endDate }, 10000);
    
    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }
    
    // CSV export
    const headers = ['id', 'timestamp', 'userId', 'action', 'resource', 'success'];
    const rows = logs.map(log => [
      log.id,
      log.timestamp.toISOString(),
      log.userId || '',
      log.action,
      log.resource,
      log.success.toString()
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Cleanup old audit logs
   */
  public async cleanupOldLogs(retentionDays: number = 2555): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    // In production, delete logs older than cutoff date
    logger.info('Cleaning up old audit logs', {
      cutoffDate,
      retentionDays
    });
    
    return 0; // Placeholder
  }

  /**
   * Stop the audit logger
   */
  public stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Flush remaining logs
    this.flushAuditLogs();
  }
}