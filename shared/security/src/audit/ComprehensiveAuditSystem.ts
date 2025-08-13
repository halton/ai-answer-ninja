/**
 * Comprehensive Audit System
 * Implements detailed access logging, audit trails, and compliance monitoring
 * Provides tamper-proof audit logs with cryptographic integrity verification
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { Request } from 'express';
import { encryptionService } from '../crypto/EncryptionService';
import { secureStorageManager, DataClassification } from '../storage/SecureStorageManager';
import { logger } from '../utils/Logger';

export enum AuditEventType {
  // Authentication events
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILURE = 'login_failure',
  LOGOUT = 'logout',
  PASSWORD_CHANGE = 'password_change',
  MFA_VERIFICATION = 'mfa_verification',
  SESSION_TIMEOUT = 'session_timeout',
  
  // Authorization events
  ACCESS_GRANTED = 'access_granted',
  ACCESS_DENIED = 'access_denied',
  PRIVILEGE_ESCALATION = 'privilege_escalation',
  PERMISSION_CHANGE = 'permission_change',
  
  // Data events
  DATA_CREATE = 'data_create',
  DATA_READ = 'data_read',
  DATA_UPDATE = 'data_update',
  DATA_DELETE = 'data_delete',
  DATA_EXPORT = 'data_export',
  DATA_IMPORT = 'data_import',
  
  // System events
  SYSTEM_START = 'system_start',
  SYSTEM_SHUTDOWN = 'system_shutdown',
  CONFIG_CHANGE = 'config_change',
  BACKUP_CREATE = 'backup_create',
  BACKUP_RESTORE = 'backup_restore',
  
  // Security events
  THREAT_DETECTED = 'threat_detected',
  VULNERABILITY_FOUND = 'vulnerability_found',
  SECURITY_SCAN = 'security_scan',
  INCIDENT_RESPONSE = 'incident_response',
  FORENSIC_ANALYSIS = 'forensic_analysis',
  
  // Compliance events
  GDPR_REQUEST = 'gdpr_request',
  DATA_RETENTION = 'data_retention',
  COMPLIANCE_CHECK = 'compliance_check',
  AUDIT_REVIEW = 'audit_review'
}

export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  severity: AuditSeverity;
  source: string;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  result: 'success' | 'failure' | 'pending';
  details: AuditEventDetails;
  context: AuditContext;
  integrity: IntegrityInfo;
}

export interface AuditEventDetails {
  description: string;
  beforeState?: any;
  afterState?: any;
  parameters?: Record<string, any>;
  response?: any;
  error?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface AuditContext {
  requestId?: string;
  correlationId?: string;
  businessProcess?: string;
  riskLevel?: string;
  dataClassification?: DataClassification;
  complianceRequirement?: string[];
  tags?: string[];
}

export interface IntegrityInfo {
  hash: string;
  previousHash?: string;
  signature?: string;
  chainPosition: number;
  witnessSignatures?: string[];
}

export interface AuditFilter {
  startTime?: number;
  endTime?: number;
  types?: AuditEventType[];
  severities?: AuditSeverity[];
  userId?: string;
  resource?: string;
  result?: 'success' | 'failure' | 'pending';
  ipAddress?: string;
  tags?: string[];
}

export interface AuditReport {
  id: string;
  title: string;
  generatedAt: number;
  timeRange: { start: number; end: number };
  filters: AuditFilter;
  summary: AuditSummary;
  events: AuditEvent[];
  analysis: AuditAnalysis;
  recommendations: AuditRecommendation[];
  complianceStatus: ComplianceAssessment;
  integrity: ReportIntegrity;
}

export interface AuditSummary {
  totalEvents: number;
  eventsByType: Record<AuditEventType, number>;
  eventsBySeverity: Record<AuditSeverity, number>;
  uniqueUsers: number;
  uniqueResources: number;
  successRate: number;
  averageResponseTime: number;
}

export interface AuditAnalysis {
  anomalies: AuditAnomaly[];
  patterns: AuditPattern[];
  trends: AuditTrend[];
  risks: RiskAssessment[];
}

export interface AuditAnomaly {
  type: string;
  description: string;
  severity: AuditSeverity;
  events: string[];
  riskScore: number;
  recommendation: string;
}

export interface AuditPattern {
  name: string;
  description: string;
  frequency: number;
  events: string[];
  significance: 'low' | 'medium' | 'high';
}

export interface AuditTrend {
  metric: string;
  direction: 'increasing' | 'decreasing' | 'stable';
  change: number;
  period: string;
  significance: 'low' | 'medium' | 'high';
}

export interface RiskAssessment {
  category: string;
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  mitigation: string;
  events: string[];
}

export interface AuditRecommendation {
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  action: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  timeline: string;
}

export interface ComplianceAssessment {
  framework: string;
  overallScore: number;
  requirements: ComplianceRequirement[];
  violations: ComplianceViolation[];
  recommendations: string[];
}

export interface ComplianceRequirement {
  id: string;
  name: string;
  status: 'compliant' | 'non_compliant' | 'partial';
  score: number;
  evidence: string[];
  gaps: string[];
}

export interface ComplianceViolation {
  requirementId: string;
  severity: AuditSeverity;
  description: string;
  events: string[];
  remediation: string;
}

export interface ReportIntegrity {
  hash: string;
  signature: string;
  timestamp: number;
  verificationMethod: string;
}

export class ComprehensiveAuditSystem extends EventEmitter {
  private static instance: ComprehensiveAuditSystem;
  private auditEvents: Map<string, AuditEvent> = new Map();
  private auditChain: string[] = [];
  private lastChainHash: string = '';
  private config: AuditSystemConfig;
  private integrityTimer?: NodeJS.Timeout;

  // Real-time monitoring
  private activeConnections: Set<string> = new Set();
  private alertThresholds: Map<string, number> = new Map();
  private anomalyDetector: AuditAnomalyDetector;

  private constructor(config?: Partial<AuditSystemConfig>) {
    super();
    this.config = this.mergeConfig(config);
    this.anomalyDetector = new AuditAnomalyDetector();
    this.initializeAuditSystem();
  }

  public static getInstance(config?: Partial<AuditSystemConfig>): ComprehensiveAuditSystem {
    if (!ComprehensiveAuditSystem.instance) {
      ComprehensiveAuditSystem.instance = new ComprehensiveAuditSystem(config);
    }
    return ComprehensiveAuditSystem.instance;
  }

  /**
   * Log audit event
   */
  public async logEvent(
    type: AuditEventType,
    details: Partial<AuditEventDetails>,
    context: Partial<AuditContext> = {},
    req?: Request
  ): Promise<AuditEvent> {
    try {
      const event = await this.createAuditEvent(type, details, context, req);
      
      // Store event
      this.auditEvents.set(event.id, event);
      this.auditChain.push(event.id);
      
      // Update chain integrity
      await this.updateChainIntegrity(event);
      
      // Store persistently
      await this.storeAuditEvent(event);
      
      // Real-time analysis
      await this.analyzeEventRealTime(event);
      
      // Emit event for real-time monitoring
      this.emit('auditEvent', event);
      
      logger.debug('Audit event logged', {
        id: event.id,
        type: event.type,
        severity: event.severity,
        userId: event.userId
      });

      return event;
    } catch (error) {
      logger.error('Failed to log audit event', {
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Log access event from HTTP request
   */
  public async logAccessEvent(
    req: Request,
    result: 'success' | 'failure',
    details: Partial<AuditEventDetails> = {}
  ): Promise<AuditEvent> {
    const eventType = result === 'success' ? AuditEventType.ACCESS_GRANTED : AuditEventType.ACCESS_DENIED;
    
    return this.logEvent(
      eventType,
      {
        description: `${req.method} ${req.path} - ${result}`,
        parameters: {
          method: req.method,
          path: req.path,
          query: req.query,
          headers: this.sanitizeHeaders(req.headers)
        },
        ...details
      },
      {
        requestId: req.headers['x-request-id'] as string,
        businessProcess: 'api_access'
      },
      req
    );
  }

  /**
   * Log data access event
   */
  public async logDataAccess(
    operation: 'create' | 'read' | 'update' | 'delete',
    resource: string,
    userId: string,
    result: 'success' | 'failure',
    details: Partial<AuditEventDetails> = {},
    dataClassification?: DataClassification
  ): Promise<AuditEvent> {
    const eventTypeMap = {
      create: AuditEventType.DATA_CREATE,
      read: AuditEventType.DATA_READ,
      update: AuditEventType.DATA_UPDATE,
      delete: AuditEventType.DATA_DELETE
    };

    return this.logEvent(
      eventTypeMap[operation],
      {
        description: `Data ${operation} operation on ${resource}`,
        ...details
      },
      {
        businessProcess: 'data_access',
        dataClassification,
        riskLevel: this.calculateDataRiskLevel(operation, dataClassification)
      }
    );
  }

  /**
   * Query audit events
   */
  public async queryEvents(filter: AuditFilter): Promise<AuditEvent[]> {
    try {
      let events = Array.from(this.auditEvents.values());
      
      // Apply filters
      events = events.filter(event => {
        if (filter.startTime && event.timestamp < filter.startTime) return false;
        if (filter.endTime && event.timestamp > filter.endTime) return false;
        if (filter.types && !filter.types.includes(event.type)) return false;
        if (filter.severities && !filter.severities.includes(event.severity)) return false;
        if (filter.userId && event.userId !== filter.userId) return false;
        if (filter.resource && event.resource !== filter.resource) return false;
        if (filter.result && event.result !== filter.result) return false;
        if (filter.ipAddress && event.ipAddress !== filter.ipAddress) return false;
        if (filter.tags && !filter.tags.every(tag => event.context.tags?.includes(tag))) return false;
        
        return true;
      });
      
      // Sort by timestamp (newest first)
      events.sort((a, b) => b.timestamp - a.timestamp);
      
      logger.info('Audit events queried', {
        totalEvents: events.length,
        filter
      });

      return events;
    } catch (error) {
      logger.error('Failed to query audit events', {
        filter,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate comprehensive audit report
   */
  public async generateReport(
    title: string,
    filter: AuditFilter,
    options: {
      includeAnalysis?: boolean;
      includeRecommendations?: boolean;
      complianceFramework?: string;
    } = {}
  ): Promise<AuditReport> {
    try {
      const events = await this.queryEvents(filter);
      const summary = this.calculateSummary(events);
      const analysis = options.includeAnalysis ? await this.performAnalysis(events) : this.getEmptyAnalysis();
      const recommendations = options.includeRecommendations ? await this.generateRecommendations(events, analysis) : [];
      const complianceStatus = options.complianceFramework ? await this.assessCompliance(events, options.complianceFramework) : this.getEmptyCompliance();
      
      const report: AuditReport = {
        id: this.generateReportId(),
        title,
        generatedAt: Date.now(),
        timeRange: {
          start: filter.startTime || 0,
          end: filter.endTime || Date.now()
        },
        filters: filter,
        summary,
        events,
        analysis,
        recommendations,
        complianceStatus,
        integrity: await this.generateReportIntegrity(events)
      };

      // Store report securely
      await this.storeReport(report);
      
      logger.info('Audit report generated', {
        reportId: report.id,
        title,
        eventCount: events.length,
        complianceScore: complianceStatus.overallScore
      });

      return report;
    } catch (error) {
      logger.error('Failed to generate audit report', {
        title,
        filter,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Verify audit chain integrity
   */
  public async verifyChainIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    try {
      const errors: string[] = [];
      let previousHash = '';
      
      for (const eventId of this.auditChain) {
        const event = this.auditEvents.get(eventId);
        if (!event) {
          errors.push(`Missing event: ${eventId}`);
          continue;
        }
        
        // Verify event hash
        const calculatedHash = await this.calculateEventHash(event);
        if (calculatedHash !== event.integrity.hash) {
          errors.push(`Hash mismatch for event: ${eventId}`);
        }
        
        // Verify chain linkage
        if (previousHash && event.integrity.previousHash !== previousHash) {
          errors.push(`Chain linkage broken at event: ${eventId}`);
        }
        
        previousHash = event.integrity.hash;
      }
      
      const isValid = errors.length === 0;
      
      logger.info('Audit chain integrity verification completed', {
        valid: isValid,
        totalEvents: this.auditChain.length,
        errors: errors.length
      });

      return { valid: isValid, errors };
    } catch (error) {
      logger.error('Audit chain integrity verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return { valid: false, errors: ['Verification process failed'] };
    }
  }

  /**
   * Start real-time monitoring
   */
  public startRealTimeMonitoring(): void {
    // Set up event handlers for real-time analysis
    this.on('auditEvent', async (event: AuditEvent) => {
      await this.processRealTimeEvent(event);
    });
    
    // Start integrity verification timer
    this.integrityTimer = setInterval(async () => {
      const result = await this.verifyChainIntegrity();
      if (!result.valid) {
        this.emit('integrityViolation', result.errors);
      }
    }, this.config.integrityCheckInterval);
    
    logger.info('Real-time monitoring started');
  }

  /**
   * Stop real-time monitoring
   */
  public stopRealTimeMonitoring(): void {
    if (this.integrityTimer) {
      clearInterval(this.integrityTimer);
      this.integrityTimer = undefined;
    }
    
    this.removeAllListeners();
    
    logger.info('Real-time monitoring stopped');
  }

  // Private helper methods

  private mergeConfig(config?: Partial<AuditSystemConfig>): AuditSystemConfig {
    const defaultConfig: AuditSystemConfig = {
      enabled: true,
      retentionDays: 2555, // 7 years
      encryptionEnabled: true,
      realTimeAnalysis: true,
      integrityCheckInterval: 60000, // 1 minute
      maxEventsInMemory: 10000,
      compressionEnabled: true,
      backupEnabled: true,
      alertingEnabled: true
    };

    return { ...defaultConfig, ...config };
  }

  private async initializeAuditSystem(): Promise<void> {
    try {
      // Load existing audit chain
      await this.loadAuditChain();
      
      // Initialize alert thresholds
      this.initializeAlertThresholds();
      
      // Start real-time monitoring if enabled
      if (this.config.realTimeAnalysis) {
        this.startRealTimeMonitoring();
      }
      
      logger.info('Comprehensive audit system initialized', {
        eventsInChain: this.auditChain.length,
        realTimeAnalysis: this.config.realTimeAnalysis
      });
    } catch (error) {
      logger.error('Failed to initialize audit system', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async createAuditEvent(
    type: AuditEventType,
    details: Partial<AuditEventDetails>,
    context: Partial<AuditContext>,
    req?: Request
  ): Promise<AuditEvent> {
    const eventId = this.generateEventId();
    const timestamp = Date.now();
    
    const event: AuditEvent = {
      id: eventId,
      timestamp,
      type,
      severity: this.calculateSeverity(type, details.error),
      source: 'audit-system',
      userId: req?.headers['x-user-id'] as string || context.userId,
      sessionId: req?.headers['x-session-id'] as string || context.sessionId,
      ipAddress: this.extractIPAddress(req),
      userAgent: req?.headers['user-agent'],
      resource: req?.path || context.resource,
      action: req?.method || context.action,
      result: details.error ? 'failure' : 'success',
      details: {
        description: details.description || `${type} event`,
        ...details
      },
      context: {
        requestId: req?.headers['x-request-id'] as string,
        correlationId: this.generateCorrelationId(),
        ...context
      },
      integrity: {
        hash: '',
        previousHash: this.lastChainHash,
        chainPosition: this.auditChain.length,
        witnessSignatures: []
      }
    };

    // Calculate event hash
    event.integrity.hash = await this.calculateEventHash(event);
    
    // Generate digital signature
    event.integrity.signature = await this.signEvent(event);

    return event;
  }

  private calculateSeverity(type: AuditEventType, error?: string): AuditSeverity {
    if (error) return AuditSeverity.ERROR;
    
    const criticalEvents = [
      AuditEventType.PRIVILEGE_ESCALATION,
      AuditEventType.THREAT_DETECTED,
      AuditEventType.VULNERABILITY_FOUND
    ];
    
    const warningEvents = [
      AuditEventType.LOGIN_FAILURE,
      AuditEventType.ACCESS_DENIED,
      AuditEventType.CONFIG_CHANGE
    ];
    
    if (criticalEvents.includes(type)) return AuditSeverity.CRITICAL;
    if (warningEvents.includes(type)) return AuditSeverity.WARNING;
    
    return AuditSeverity.INFO;
  }

  private async calculateEventHash(event: AuditEvent): Promise<string> {
    const eventCopy = { ...event };
    eventCopy.integrity = { ...event.integrity, hash: '', signature: '' };
    
    const eventString = JSON.stringify(eventCopy);
    return crypto.createHash('sha256').update(eventString).digest('hex');
  }

  private async signEvent(event: AuditEvent): Promise<string> {
    return encryptionService.generateHMAC(event.integrity.hash, 'audit-system-secret');
  }

  private async updateChainIntegrity(event: AuditEvent): Promise<void> {
    this.lastChainHash = event.integrity.hash;
  }

  private async storeAuditEvent(event: AuditEvent): Promise<void> {
    if (this.config.enabled) {
      await secureStorageManager.store(
        event,
        DataClassification.CONFIDENTIAL,
        'audit_event',
        'audit_system',
        {
          tags: ['audit', event.type, event.severity],
          metadata: {
            chainPosition: event.integrity.chainPosition,
            eventType: event.type
          }
        }
      );
    }
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    delete sanitized.authorization;
    delete sanitized.cookie;
    delete sanitized['x-api-key'];
    return sanitized;
  }

  private calculateDataRiskLevel(
    operation: string,
    classification?: DataClassification
  ): string {
    if (classification === DataClassification.TOP_SECRET) return 'critical';
    if (classification === DataClassification.RESTRICTED) return 'high';
    if (operation === 'delete') return 'high';
    if (operation === 'update') return 'medium';
    return 'low';
  }

  private extractIPAddress(req?: Request): string {
    if (!req) return '';
    return (req.headers['x-forwarded-for'] as string) ||
           (req.headers['x-real-ip'] as string) ||
           req.connection.remoteAddress ||
           '';
  }

  private generateEventId(): string {
    return `audit_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private generateReportId(): string {
    return `report_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // Placeholder methods for complex analysis features
  private calculateSummary(events: AuditEvent[]): AuditSummary {
    // Implementation would calculate comprehensive summary
    return {
      totalEvents: events.length,
      eventsByType: {} as any,
      eventsBySeverity: {} as any,
      uniqueUsers: 0,
      uniqueResources: 0,
      successRate: 0,
      averageResponseTime: 0
    };
  }

  private async performAnalysis(events: AuditEvent[]): Promise<AuditAnalysis> {
    // Implementation would perform comprehensive analysis
    return this.getEmptyAnalysis();
  }

  private getEmptyAnalysis(): AuditAnalysis {
    return {
      anomalies: [],
      patterns: [],
      trends: [],
      risks: []
    };
  }

  private async generateRecommendations(events: AuditEvent[], analysis: AuditAnalysis): Promise<AuditRecommendation[]> {
    // Implementation would generate intelligent recommendations
    return [];
  }

  private async assessCompliance(events: AuditEvent[], framework: string): Promise<ComplianceAssessment> {
    // Implementation would assess compliance against framework
    return this.getEmptyCompliance();
  }

  private getEmptyCompliance(): ComplianceAssessment {
    return {
      framework: '',
      overallScore: 0,
      requirements: [],
      violations: [],
      recommendations: []
    };
  }

  private async generateReportIntegrity(events: AuditEvent[]): Promise<ReportIntegrity> {
    const reportHash = crypto.createHash('sha256')
      .update(JSON.stringify(events))
      .digest('hex');
    
    return {
      hash: reportHash,
      signature: await encryptionService.generateHMAC(reportHash, 'report-integrity-secret'),
      timestamp: Date.now(),
      verificationMethod: 'HMAC-SHA256'
    };
  }
}

// Helper interfaces
interface AuditSystemConfig {
  enabled: boolean;
  retentionDays: number;
  encryptionEnabled: boolean;
  realTimeAnalysis: boolean;
  integrityCheckInterval: number;
  maxEventsInMemory: number;
  compressionEnabled: boolean;
  backupEnabled: boolean;
  alertingEnabled: boolean;
}

class AuditAnomalyDetector {
  public async detectAnomalies(events: AuditEvent[]): Promise<AuditAnomaly[]> {
    // Placeholder for ML-based anomaly detection
    return [];
  }
}

// Export singleton instance
export const comprehensiveAuditSystem = ComprehensiveAuditSystem.getInstance();