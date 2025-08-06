import { config } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import {
  AuditLog,
  AuditAction,
  SecurityEvent,
  SecurityEventType,
  User
} from '@/types';

/**
 * Audit Service for logging security and user activities
 */
export class AuditService {
  private db: DatabaseService;
  private redis: RedisService;
  private batchSize = 100;
  private batchTimeout = 5000; // 5 seconds
  private auditBatch: Partial<AuditLog>[] = [];
  private securityBatch: Partial<SecurityEvent>[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.db = new DatabaseService();
    this.redis = new RedisService();
    
    // Start batch processing
    this.startBatchProcessing();
  }

  // ==========================================
  // Audit Logging Methods
  // ==========================================

  /**
   * Log user activity
   */
  async log(auditData: {
    userId?: string;
    action: AuditAction;
    resource: string;
    details: Record<string, any>;
    ipAddress: string;
    userAgent: string;
    success: boolean;
  }): Promise<void> {
    try {
      const auditLog: Partial<AuditLog> = {
        userId: auditData.userId,
        action: auditData.action,
        resource: auditData.resource,
        details: auditData.details || {},
        ipAddress: this.sanitizeIP(auditData.ipAddress),
        userAgent: this.sanitizeUserAgent(auditData.userAgent),
        success: auditData.success,
        timestamp: new Date()
      };

      // Add to batch for processing
      this.auditBatch.push(auditLog);

      // Process immediately if batch is full
      if (this.auditBatch.length >= this.batchSize) {
        await this.processBatch();
      }

      // Also log critical events immediately
      if (this.isCriticalEvent(auditData.action, auditData.success)) {
        await this.logImmediately(auditLog);
      }

    } catch (error) {
      logger.error('Audit logging failed', {
        action: auditData.action,
        resource: auditData.resource,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Log security event
   */
  async logSecurityEvent(eventData: {
    type: SecurityEventType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    userId?: string;
    details: Record<string, any>;
    timestamp: Date;
  }): Promise<void> {
    try {
      const securityEvent: Partial<SecurityEvent> = {
        type: eventData.type,
        severity: eventData.severity,
        userId: eventData.userId,
        details: eventData.details || {},
        resolved: false,
        timestamp: eventData.timestamp
      };

      // Add to batch
      this.securityBatch.push(securityEvent);

      // Process critical security events immediately
      if (eventData.severity === 'critical' || eventData.severity === 'high') {
        await this.processSecurityEventImmediately(securityEvent);
      }

      // Process batch if full
      if (this.securityBatch.length >= this.batchSize) {
        await this.processSecurityBatch();
      }

    } catch (error) {
      logger.error('Security event logging failed', {
        type: eventData.type,
        severity: eventData.severity,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(authData: {
    action: 'login' | 'logout' | 'register';
    userId: string;
    success: boolean;
    ipAddress: string;
    userAgent: string;
    details?: Record<string, any>;
  }): Promise<void> {
    await this.log({
      userId: authData.userId,
      action: authData.action,
      resource: 'auth',
      details: authData.details || {},
      ipAddress: authData.ipAddress,
      userAgent: authData.userAgent,
      success: authData.success
    });

    // Log failed auth attempts as security events
    if (!authData.success && authData.action === 'login') {
      await this.logSecurityEvent({
        type: 'failed_login',
        severity: 'medium',
        userId: authData.userId,
        details: {
          ipAddress: authData.ipAddress,
          userAgent: authData.userAgent,
          ...authData.details
        },
        timestamp: new Date()
      });
    }
  }

  // ==========================================
  // Query Methods
  // ==========================================

  /**
   * Get audit logs for user
   */
  async getUserAuditLogs(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      action?: AuditAction;
      resource?: string;
      startDate?: Date;
      endDate?: Date;
      success?: boolean;
    } = {}
  ): Promise<{ logs: AuditLog[]; total: number }> {
    try {
      return await this.db.getAuditLogs(userId, options);
    } catch (error) {
      logger.error('Failed to get user audit logs', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { logs: [], total: 0 };
    }
  }

  /**
   * Get security events
   */
  async getSecurityEvents(
    options: {
      limit?: number;
      offset?: number;
      type?: SecurityEventType;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      resolved?: boolean;
      startDate?: Date;
      endDate?: Date;
      userId?: string;
    } = {}
  ): Promise<{ events: SecurityEvent[]; total: number }> {
    try {
      return await this.db.getSecurityEvents(options);
    } catch (error) {
      logger.error('Failed to get security events', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { events: [], total: 0 };
    }
  }

  /**
   * Get failed login attempts for IP
   */
  async getFailedLoginAttempts(
    ipAddress: string,
    timeWindow: number = 3600000 // 1 hour
  ): Promise<number> {
    try {
      const startTime = new Date(Date.now() - timeWindow);
      
      const result = await this.db.getAuditLogs(undefined, {
        action: 'login',
        success: false,
        startDate: startTime,
        limit: 1000 // Maximum to count
      });

      // Filter by IP address
      const failedAttempts = result.logs.filter(log => 
        log.ipAddress === this.sanitizeIP(ipAddress)
      );

      return failedAttempts.length;
    } catch (error) {
      logger.error('Failed to get failed login attempts', {
        ipAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(
    userId: string,
    days = 30
  ): Promise<{
    totalActions: number;
    loginCount: number;
    failedLogins: number;
    lastActivity: Date | null;
    topActions: Array<{ action: string; count: number }>;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { logs } = await this.db.getAuditLogs(userId, {
        startDate,
        limit: 10000
      });

      const summary = {
        totalActions: logs.length,
        loginCount: logs.filter(log => log.action === 'login' && log.success).length,
        failedLogins: logs.filter(log => log.action === 'login' && !log.success).length,
        lastActivity: logs.length > 0 ? logs[0].timestamp : null,
        topActions: this.getTopActions(logs)
      };

      return summary;
    } catch (error) {
      logger.error('Failed to get user activity summary', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        totalActions: 0,
        loginCount: 0,
        failedLogins: 0,
        lastActivity: null,
        topActions: []
      };
    }
  }

  // ==========================================
  // Security Analytics Methods
  // ==========================================

  /**
   * Detect suspicious activity patterns
   */
  async detectSuspiciousActivity(userId: string): Promise<{
    suspiciousPatterns: string[];
    riskScore: number;
    recommendations: string[];
  }> {
    try {
      const { logs } = await this.db.getAuditLogs(userId, {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days
        limit: 1000
      });

      const patterns: string[] = [];
      let riskScore = 0;

      // Check for multiple failed logins
      const failedLogins = logs.filter(log => 
        log.action === 'login' && !log.success
      ).length;
      
      if (failedLogins > 10) {
        patterns.push('High number of failed login attempts');
        riskScore += 30;
      }

      // Check for unusual login times
      const loginTimes = logs
        .filter(log => log.action === 'login' && log.success)
        .map(log => log.timestamp.getHours());
      
      const unusualHours = loginTimes.filter(hour => hour < 6 || hour > 22);
      if (unusualHours.length > 3) {
        patterns.push('Unusual login times detected');
        riskScore += 20;
      }

      // Check for multiple IP addresses
      const uniqueIPs = new Set(
        logs.map(log => log.ipAddress)
      ).size;
      
      if (uniqueIPs > 5) {
        patterns.push('Multiple IP addresses used');
        riskScore += 25;
      }

      // Check for rapid successive actions
      const rapidActions = this.detectRapidActions(logs);
      if (rapidActions > 0) {
        patterns.push('Rapid successive actions detected');
        riskScore += 15;
      }

      const recommendations = this.generateSecurityRecommendations(patterns, riskScore);

      return {
        suspiciousPatterns: patterns,
        riskScore: Math.min(riskScore, 100),
        recommendations
      };
    } catch (error) {
      logger.error('Suspicious activity detection failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        suspiciousPatterns: [],
        riskScore: 0,
        recommendations: []
      };
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalEvents: number;
    criticalEvents: number;
    topThreats: Array<{ type: string; count: number }>;
    affectedUsers: number;
    resolvedEvents: number;
    avgResolutionTime: number;
  }> {
    try {
      const { events } = await this.db.getSecurityEvents({
        startDate,
        endDate,
        limit: 10000
      });

      const report = {
        totalEvents: events.length,
        criticalEvents: events.filter(e => e.severity === 'critical' || e.severity === 'high').length,
        topThreats: this.getTopThreats(events),
        affectedUsers: new Set(events.filter(e => e.userId).map(e => e.userId)).size,
        resolvedEvents: events.filter(e => e.resolved).length,
        avgResolutionTime: this.calculateAvgResolutionTime(events)
      };

      return report;
    } catch (error) {
      logger.error('Security report generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        totalEvents: 0,
        criticalEvents: 0,
        topThreats: [],
        affectedUsers: 0,
        resolvedEvents: 0,
        avgResolutionTime: 0
      };
    }
  }

  // ==========================================
  // Batch Processing Methods
  // ==========================================

  /**
   * Start batch processing timer
   */
  private startBatchProcessing(): void {
    this.batchTimer = setInterval(async () => {
      if (this.auditBatch.length > 0 || this.securityBatch.length > 0) {
        await this.processBatch();
        await this.processSecurityBatch();
      }
    }, this.batchTimeout);
  }

  /**
   * Stop batch processing
   */
  async stopBatchProcessing(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // Process remaining items
    await this.processBatch();
    await this.processSecurityBatch();
  }

  /**
   * Process audit log batch
   */
  private async processBatch(): Promise<void> {
    if (this.auditBatch.length === 0) return;

    try {
      const batch = [...this.auditBatch];
      this.auditBatch = [];

      await this.db.createAuditLogsBatch(batch as AuditLog[]);
      
      logger.debug('Processed audit log batch', { count: batch.length });
    } catch (error) {
      logger.error('Audit batch processing failed', {
        batchSize: this.auditBatch.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process security event batch
   */
  private async processSecurityBatch(): Promise<void> {
    if (this.securityBatch.length === 0) return;

    try {
      const batch = [...this.securityBatch];
      this.securityBatch = [];

      await this.db.createSecurityEventsBatch(batch as SecurityEvent[]);
      
      logger.debug('Processed security event batch', { count: batch.length });
    } catch (error) {
      logger.error('Security batch processing failed', {
        batchSize: this.securityBatch.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Log audit entry immediately (for critical events)
   */
  private async logImmediately(auditLog: Partial<AuditLog>): Promise<void> {
    try {
      await this.db.createAuditLog(auditLog as AuditLog);
    } catch (error) {
      logger.error('Immediate audit logging failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process security event immediately
   */
  private async processSecurityEventImmediately(event: Partial<SecurityEvent>): Promise<void> {
    try {
      await this.db.createSecurityEvent(event as SecurityEvent);
      
      // Trigger alerts for critical events
      if (event.severity === 'critical') {
        await this.triggerCriticalAlert(event as SecurityEvent);
      }
    } catch (error) {
      logger.error('Immediate security event processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check if event is critical and needs immediate processing
   */
  private isCriticalEvent(action: AuditAction, success: boolean): boolean {
    const criticalActions: AuditAction[] = [
      'account_lock',
      'account_unlock',
      'permissions_change',
      'data_deletion'
    ];

    return criticalActions.includes(action) || 
           (action === 'login' && !success);
  }

  /**
   * Sanitize IP address for logging
   */
  private sanitizeIP(ipAddress: string): string {
    // Remove or hash the last octet for privacy
    const parts = ipAddress.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
    return ipAddress;
  }

  /**
   * Sanitize user agent for logging
   */
  private sanitizeUserAgent(userAgent: string): string {
    // Truncate user agent to prevent log bloat
    return userAgent.length > 200 ? userAgent.substring(0, 200) + '...' : userAgent;
  }

  /**
   * Get top actions from logs
   */
  private getTopActions(logs: AuditLog[]): Array<{ action: string; count: number }> {
    const actionCounts = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(actionCounts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Get top security threats
   */
  private getTopThreats(events: SecurityEvent[]): Array<{ type: string; count: number }> {
    const threatCounts = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(threatCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Detect rapid successive actions
   */
  private detectRapidActions(logs: AuditLog[]): number {
    let rapidCount = 0;
    
    for (let i = 1; i < logs.length; i++) {
      const timeDiff = logs[i-1].timestamp.getTime() - logs[i].timestamp.getTime();
      if (timeDiff < 1000) { // Less than 1 second apart
        rapidCount++;
      }
    }
    
    return rapidCount;
  }

  /**
   * Generate security recommendations
   */
  private generateSecurityRecommendations(patterns: string[], riskScore: number): string[] {
    const recommendations: string[] = [];

    if (patterns.includes('High number of failed login attempts')) {
      recommendations.push('Enable account lockout after failed attempts');
      recommendations.push('Consider implementing CAPTCHA');
    }

    if (patterns.includes('Multiple IP addresses used')) {
      recommendations.push('Enable login notifications');
      recommendations.push('Consider requiring device verification');
    }

    if (riskScore > 50) {
      recommendations.push('Enable multi-factor authentication');
      recommendations.push('Review recent account activity');
    }

    if (riskScore > 75) {
      recommendations.push('Consider temporary account restriction');
      recommendations.push('Contact user to verify recent activity');
    }

    return recommendations;
  }

  /**
   * Calculate average resolution time for security events
   */
  private calculateAvgResolutionTime(events: SecurityEvent[]): number {
    const resolvedEvents = events.filter(e => e.resolved && e.resolvedAt);
    
    if (resolvedEvents.length === 0) return 0;

    const totalTime = resolvedEvents.reduce((sum, event) => {
      const resolutionTime = event.resolvedAt!.getTime() - event.timestamp.getTime();
      return sum + resolutionTime;
    }, 0);

    return totalTime / resolvedEvents.length / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Trigger critical security alert
   */
  private async triggerCriticalAlert(event: SecurityEvent): Promise<void> {
    try {
      // Store alert in Redis for immediate processing
      await this.redis.sadd('critical_alerts', JSON.stringify({
        eventId: event.id,
        type: event.type,
        severity: event.severity,
        userId: event.userId,
        timestamp: event.timestamp
      }));

      logger.warn('Critical security alert triggered', {
        eventId: event.id,
        type: event.type,
        userId: event.userId
      });
    } catch (error) {
      logger.error('Failed to trigger critical alert', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

// Export singleton instance
export const auditService = new AuditService();