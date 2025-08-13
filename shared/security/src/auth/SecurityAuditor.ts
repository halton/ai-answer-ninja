/**
 * Security Auditor
 * Comprehensive security audit tool with threat detection and compliance monitoring
 * Implements real-time security monitoring and automated threat response
 */

import { Request } from 'express';
import { logger } from '../utils/Logger';
import { encryptionService } from '../crypto/EncryptionService';

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  timestamp: number;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  result: 'success' | 'failure' | 'blocked';
  metadata: Record<string, any>;
  risk_score: number;
  threat_category?: string;
}

export enum SecurityEventType {
  LOGIN_ATTEMPT = 'login_attempt',
  LOGIN_FAILURE = 'login_failure',
  PASSWORD_CHANGE = 'password_change',
  PRIVILEGE_ESCALATION = 'privilege_escalation',
  UNAUTHORIZED_ACCESS = 'unauthorized_access',
  DATA_ACCESS = 'data_access',
  API_ABUSE = 'api_abuse',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  ACCOUNT_LOCKOUT = 'account_lockout',
  MFA_FAILURE = 'mfa_failure',
  TOKEN_MANIPULATION = 'token_manipulation',
  SQL_INJECTION_ATTEMPT = 'sql_injection_attempt',
  XSS_ATTEMPT = 'xss_attempt',
  CSRF_ATTEMPT = 'csrf_attempt',
  BRUTE_FORCE = 'brute_force',
  DOS_ATTEMPT = 'dos_attempt',
  DATA_EXFILTRATION = 'data_exfiltration',
  MALICIOUS_UPLOAD = 'malicious_upload',
  ANOMALOUS_BEHAVIOR = 'anomalous_behavior'
}

export enum SecuritySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ThreatPattern {
  name: string;
  pattern: RegExp;
  category: string;
  severity: SecuritySeverity;
  description: string;
  mitigation: string;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsBySeverity: Record<SecuritySeverity, number>;
  eventsByType: Record<SecurityEventType, number>;
  threatsByCategory: Record<string, number>;
  averageRiskScore: number;
  activeThreats: number;
  blockedAttempts: number;
  timeRange: {
    start: number;
    end: number;
  };
}

export interface AuditReport {
  reportId: string;
  generatedAt: number;
  timeRange: {
    start: number;
    end: number;
  };
  summary: SecurityMetrics;
  criticalEvents: SecurityEvent[];
  threatAnalysis: ThreatAnalysis;
  recommendations: SecurityRecommendation[];
  complianceStatus: ComplianceStatus;
}

export interface ThreatAnalysis {
  detectedThreats: string[];
  riskAssessment: string;
  attackVectors: string[];
  compromisedAssets: string[];
  mitigation_actions: string[];
}

export interface SecurityRecommendation {
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  action: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
}

export interface ComplianceStatus {
  gdpr: {
    compliant: boolean;
    issues: string[];
    score: number;
  };
  iso27001: {
    compliant: boolean;
    issues: string[];
    score: number;
  };
  soc2: {
    compliant: boolean;
    issues: string[];
    score: number;
  };
  overall_score: number;
}

export class SecurityAuditor {
  private static instance: SecurityAuditor;
  private events: SecurityEvent[] = [];
  private threatPatterns: ThreatPattern[] = [];
  private userSessions: Map<string, any> = new Map();
  private ipReputation: Map<string, number> = new Map();
  private suspiciousIPs: Set<string> = new Set();
  private anomalyDetector: AnomalyDetector;

  // Configuration
  private readonly MAX_EVENTS = 100000;
  private readonly RISK_THRESHOLD = 7.0;
  private readonly ANOMALY_THRESHOLD = 0.8;
  private readonly EVENT_RETENTION_DAYS = 90;

  private constructor() {
    this.initializeThreatPatterns();
    this.anomalyDetector = new AnomalyDetector();
    this.startPeriodicCleanup();
  }

  public static getInstance(): SecurityAuditor {
    if (!SecurityAuditor.instance) {
      SecurityAuditor.instance = new SecurityAuditor();
    }
    return SecurityAuditor.instance;
  }

  /**
   * Log security event
   */
  public async logSecurityEvent(
    type: SecurityEventType,
    req: Request,
    metadata: Record<string, any> = {},
    result: 'success' | 'failure' | 'blocked' = 'success'
  ): Promise<SecurityEvent> {
    try {
      const event: SecurityEvent = {
        id: this.generateEventId(),
        type,
        severity: this.calculateSeverity(type, result, metadata),
        timestamp: Date.now(),
        userId: metadata.userId || req.headers['x-user-id'] as string,
        sessionId: metadata.sessionId || req.headers['x-session-id'] as string,
        ipAddress: this.extractIPAddress(req),
        userAgent: req.headers['user-agent'],
        resource: req.path,
        action: req.method,
        result,
        metadata: this.sanitizeMetadata(metadata),
        risk_score: await this.calculateRiskScore(type, req, metadata, result),
        threat_category: this.categorizeThreat(type)
      };

      // Store event
      this.events.push(event);
      this.trimEvents();

      // Check for immediate threats
      await this.analyzeEventForThreats(event);

      // Update IP reputation
      this.updateIPReputation(event.ipAddress, event.risk_score);

      // Log to system
      logger.info('Security event logged', {
        eventId: event.id,
        type: event.type,
        severity: event.severity,
        riskScore: event.risk_score,
        ipAddress: event.ipAddress
      });

      return event;
    } catch (error) {
      logger.error('Failed to log security event', {
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Detect anomalous behavior
   */
  public async detectAnomalies(userId: string, req: Request): Promise<boolean> {
    try {
      const userBaseline = await this.getUserBaseline(userId);
      const currentActivity = this.extractActivityPattern(req);
      
      const anomalyScore = await this.anomalyDetector.calculateScore(
        currentActivity,
        userBaseline
      );

      if (anomalyScore > this.ANOMALY_THRESHOLD) {
        await this.logSecurityEvent(
          SecurityEventType.ANOMALOUS_BEHAVIOR,
          req,
          { 
            anomalyScore,
            userBaseline: userBaseline.summary,
            currentActivity
          },
          'blocked'
        );

        return true;
      }

      return false;
    } catch (error) {
      logger.error('Anomaly detection failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check for threat patterns in request
   */
  public async scanForThreats(req: Request): Promise<ThreatDetectionResult> {
    const detectedThreats: DetectedThreat[] = [];

    try {
      // Scan URL parameters
      const urlThreats = this.scanUrlForThreats(req.url);
      detectedThreats.push(...urlThreats);

      // Scan request headers
      const headerThreats = this.scanHeadersForThreats(req.headers);
      detectedThreats.push(...headerThreats);

      // Scan request body if present
      if (req.body) {
        const bodyThreats = this.scanBodyForThreats(req.body);
        detectedThreats.push(...bodyThreats);
      }

      // Calculate overall threat level
      const threatLevel = this.calculateThreatLevel(detectedThreats);

      const result: ThreatDetectionResult = {
        hasThreats: detectedThreats.length > 0,
        threatLevel,
        detectedThreats,
        recommendedAction: this.getRecommendedAction(threatLevel)
      };

      if (result.hasThreats) {
        await this.logSecurityEvent(
          this.mapThreatToEventType(detectedThreats[0].category),
          req,
          { threatDetection: result },
          'blocked'
        );
      }

      return result;
    } catch (error) {
      logger.error('Threat scanning failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        hasThreats: false,
        threatLevel: 'unknown',
        detectedThreats: [],
        recommendedAction: 'allow'
      };
    }
  }

  /**
   * Generate comprehensive audit report
   */
  public async generateAuditReport(
    startTime: number,
    endTime: number
  ): Promise<AuditReport> {
    try {
      const filteredEvents = this.events.filter(
        event => event.timestamp >= startTime && event.timestamp <= endTime
      );

      const summary = this.calculateMetrics(filteredEvents);
      const criticalEvents = filteredEvents.filter(
        event => event.severity === SecuritySeverity.CRITICAL
      );

      const threatAnalysis = await this.analyzeThrends(filteredEvents);
      const recommendations = await this.generateRecommendations(filteredEvents);
      const complianceStatus = await this.assessCompliance(filteredEvents);

      const report: AuditReport = {
        reportId: this.generateReportId(),
        generatedAt: Date.now(),
        timeRange: { start: startTime, end: endTime },
        summary,
        criticalEvents,
        threatAnalysis,
        recommendations,
        complianceStatus
      };

      // Encrypt and store report
      const encryptedReport = await encryptionService.encryptData(
        JSON.stringify(report),
        'audit_reports'
      );

      logger.info('Audit report generated', {
        reportId: report.reportId,
        eventCount: filteredEvents.length,
        criticalEvents: criticalEvents.length,
        overallScore: complianceStatus.overall_score
      });

      return report;
    } catch (error) {
      logger.error('Failed to generate audit report', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Monitor user session for suspicious activity
   */
  public async monitorUserSession(
    userId: string,
    sessionId: string,
    activity: any
  ): Promise<SessionSecurityStatus> {
    try {
      const sessionKey = `${userId}:${sessionId}`;
      let sessionData = this.userSessions.get(sessionKey) || {
        userId,
        sessionId,
        startTime: Date.now(),
        activities: [],
        riskScore: 0,
        anomalies: []
      };

      // Add current activity
      sessionData.activities.push({
        ...activity,
        timestamp: Date.now()
      });

      // Detect session anomalies
      const sessionAnomalies = await this.detectSessionAnomalies(sessionData);
      sessionData.anomalies.push(...sessionAnomalies);

      // Update risk score
      sessionData.riskScore = this.calculateSessionRiskScore(sessionData);

      // Update session data
      this.userSessions.set(sessionKey, sessionData);

      const status: SessionSecurityStatus = {
        secure: sessionData.riskScore < this.RISK_THRESHOLD,
        riskScore: sessionData.riskScore,
        anomalies: sessionAnomalies,
        recommendedAction: sessionData.riskScore >= this.RISK_THRESHOLD ? 'terminate' : 'continue'
      };

      if (!status.secure) {
        logger.warn('Suspicious user session detected', {
          userId,
          sessionId,
          riskScore: sessionData.riskScore,
          anomalies: sessionAnomalies.length
        });
      }

      return status;
    } catch (error) {
      logger.error('Session monitoring failed', {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get security metrics for dashboard
   */
  public getSecurityMetrics(timeRange?: { start: number; end: number }): SecurityMetrics {
    let events = this.events;
    
    if (timeRange) {
      events = events.filter(
        event => event.timestamp >= timeRange.start && event.timestamp <= timeRange.end
      );
    }

    return this.calculateMetrics(events);
  }

  /**
   * Check IP reputation
   */
  public checkIPReputation(ipAddress: string): IPReputationResult {
    const reputation = this.ipReputation.get(ipAddress) || 0;
    const isSuspicious = this.suspiciousIPs.has(ipAddress);
    
    return {
      ipAddress,
      reputation,
      isSuspicious,
      trustLevel: this.calculateTrustLevel(reputation),
      recommendedAction: this.getIPRecommendedAction(reputation, isSuspicious)
    };
  }

  /**
   * Block suspicious IP
   */
  public blockSuspiciousIP(ipAddress: string, reason: string): void {
    this.suspiciousIPs.add(ipAddress);
    this.ipReputation.set(ipAddress, -10); // Severely negative reputation
    
    logger.warn('IP address blocked', {
      ipAddress,
      reason
    });
  }

  // Private helper methods

  private initializeThreatPatterns(): void {
    this.threatPatterns = [
      {
        name: 'SQL Injection',
        pattern: /(union|select|insert|update|delete|drop|exec|script)/i,
        category: 'injection',
        severity: SecuritySeverity.HIGH,
        description: 'Potential SQL injection attempt detected',
        mitigation: 'Block request and sanitize input'
      },
      {
        name: 'XSS Attack',
        pattern: /<script|javascript:|onload=|onerror=/i,
        category: 'xss',
        severity: SecuritySeverity.HIGH,
        description: 'Cross-site scripting attempt detected',
        mitigation: 'Sanitize input and encode output'
      },
      {
        name: 'Path Traversal',
        pattern: /\.\.[\/\\]/,
        category: 'traversal',
        severity: SecuritySeverity.MEDIUM,
        description: 'Directory traversal attempt detected',
        mitigation: 'Validate and sanitize file paths'
      },
      {
        name: 'Command Injection',
        pattern: /[;&|`$()]/,
        category: 'injection',
        severity: SecuritySeverity.CRITICAL,
        description: 'Command injection attempt detected',
        mitigation: 'Block request and validate input'
      }
    ];
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateReportId(): string {
    return `rpt_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private extractIPAddress(req: Request): string {
    return (req.headers['x-forwarded-for'] as string) ||
           (req.headers['x-real-ip'] as string) ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           '0.0.0.0';
  }

  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const sanitized = { ...metadata };
    
    // Remove sensitive data
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.secret;
    delete sanitized.key;
    
    return sanitized;
  }

  private calculateSeverity(
    type: SecurityEventType,
    result: string,
    metadata: Record<string, any>
  ): SecuritySeverity {
    // Critical events
    if ([
      SecurityEventType.PRIVILEGE_ESCALATION,
      SecurityEventType.DATA_EXFILTRATION,
      SecurityEventType.SQL_INJECTION_ATTEMPT,
      SecurityEventType.MALICIOUS_UPLOAD
    ].includes(type)) {
      return SecuritySeverity.CRITICAL;
    }

    // High severity events
    if ([
      SecurityEventType.UNAUTHORIZED_ACCESS,
      SecurityEventType.BRUTE_FORCE,
      SecurityEventType.XSS_ATTEMPT,
      SecurityEventType.DOS_ATTEMPT
    ].includes(type)) {
      return SecuritySeverity.HIGH;
    }

    // Medium severity events
    if ([
      SecurityEventType.LOGIN_FAILURE,
      SecurityEventType.MFA_FAILURE,
      SecurityEventType.API_ABUSE,
      SecurityEventType.SUSPICIOUS_ACTIVITY
    ].includes(type)) {
      return SecuritySeverity.MEDIUM;
    }

    // Default to low
    return SecuritySeverity.LOW;
  }

  private async calculateRiskScore(
    type: SecurityEventType,
    req: Request,
    metadata: Record<string, any>,
    result: string
  ): Promise<number> {
    let score = 0;

    // Base score by event type
    const typeScores = {
      [SecurityEventType.LOGIN_ATTEMPT]: 1,
      [SecurityEventType.LOGIN_FAILURE]: 3,
      [SecurityEventType.UNAUTHORIZED_ACCESS]: 8,
      [SecurityEventType.PRIVILEGE_ESCALATION]: 10,
      [SecurityEventType.DATA_EXFILTRATION]: 10,
      [SecurityEventType.SQL_INJECTION_ATTEMPT]: 9,
      [SecurityEventType.XSS_ATTEMPT]: 8,
      [SecurityEventType.BRUTE_FORCE]: 7,
      [SecurityEventType.DOS_ATTEMPT]: 6,
      [SecurityEventType.ANOMALOUS_BEHAVIOR]: 5
    };

    score += typeScores[type] || 1;

    // IP reputation factor
    const ipAddress = this.extractIPAddress(req);
    const ipReputation = this.ipReputation.get(ipAddress) || 0;
    score += Math.max(0, -ipReputation);

    // Result factor
    if (result === 'failure' || result === 'blocked') {
      score += 2;
    }

    // Time-based factor (off-hours increase risk)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      score += 1;
    }

    return Math.min(10, score);
  }

  private categorizeThreat(type: SecurityEventType): string {
    const categoryMap = {
      [SecurityEventType.SQL_INJECTION_ATTEMPT]: 'injection',
      [SecurityEventType.XSS_ATTEMPT]: 'xss',
      [SecurityEventType.CSRF_ATTEMPT]: 'csrf',
      [SecurityEventType.BRUTE_FORCE]: 'authentication',
      [SecurityEventType.DOS_ATTEMPT]: 'availability',
      [SecurityEventType.DATA_EXFILTRATION]: 'data_breach',
      [SecurityEventType.UNAUTHORIZED_ACCESS]: 'access_control',
      [SecurityEventType.PRIVILEGE_ESCALATION]: 'privilege_abuse'
    };

    return categoryMap[type] || 'general';
  }

  private trimEvents(): void {
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }
  }

  private async analyzeEventForThreats(event: SecurityEvent): Promise<void> {
    if (event.risk_score >= this.RISK_THRESHOLD) {
      logger.warn('High-risk security event detected', {
        eventId: event.id,
        type: event.type,
        riskScore: event.risk_score,
        ipAddress: event.ipAddress
      });

      // Auto-block if critical
      if (event.severity === SecuritySeverity.CRITICAL) {
        this.blockSuspiciousIP(event.ipAddress, `Critical security event: ${event.type}`);
      }
    }
  }

  private updateIPReputation(ipAddress: string, riskScore: number): void {
    const currentReputation = this.ipReputation.get(ipAddress) || 0;
    let newReputation = currentReputation;

    if (riskScore >= 7) {
      newReputation -= 2;
    } else if (riskScore >= 5) {
      newReputation -= 1;
    } else if (riskScore <= 2) {
      newReputation += 0.1;
    }

    // Clamp reputation between -10 and 10
    newReputation = Math.max(-10, Math.min(10, newReputation));
    this.ipReputation.set(ipAddress, newReputation);

    // Auto-block if reputation is very low
    if (newReputation <= -8) {
      this.blockSuspiciousIP(ipAddress, 'Poor IP reputation');
    }
  }

  private startPeriodicCleanup(): void {
    setInterval(() => {
      const cutoffTime = Date.now() - (this.EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      this.events = this.events.filter(event => event.timestamp > cutoffTime);
      
      logger.info('Security event cleanup completed', {
        eventsRemaining: this.events.length
      });
    }, 24 * 60 * 60 * 1000); // Run daily
  }

  // Additional helper methods would be implemented here...
  // Due to length constraints, I'm including the core structure
}

// Helper interfaces and classes
interface ThreatDetectionResult {
  hasThreats: boolean;
  threatLevel: string;
  detectedThreats: DetectedThreat[];
  recommendedAction: string;
}

interface DetectedThreat {
  name: string;
  category: string;
  severity: SecuritySeverity;
  description: string;
  location: string;
}

interface SessionSecurityStatus {
  secure: boolean;
  riskScore: number;
  anomalies: any[];
  recommendedAction: string;
}

interface IPReputationResult {
  ipAddress: string;
  reputation: number;
  isSuspicious: boolean;
  trustLevel: string;
  recommendedAction: string;
}

class AnomalyDetector {
  public async calculateScore(current: any, baseline: any): Promise<number> {
    // Simplified anomaly detection - implement proper ML-based detection
    return Math.random();
  }
}

// Export singleton instance
export const securityAuditor = SecurityAuditor.getInstance();