/**
 * Threat Detection Engine
 * Implements real-time threat detection with behavioral analysis and ML-driven insights
 * Provides automated threat response and incident classification
 */

import { EventEmitter } from 'events';
import { Request } from 'express';
import { securityAuditor, SecurityEventType, SecuritySeverity } from '../auth/SecurityAuditor';
import { comprehensiveAuditSystem, AuditEventType } from '../audit/ComprehensiveAuditSystem';
import { logger } from '../utils/Logger';

export enum ThreatType {
  // Network threats
  BRUTE_FORCE = 'brute_force',
  DDoS = 'ddos',
  PORT_SCAN = 'port_scan',
  IP_SPOOFING = 'ip_spoofing',
  
  // Application threats
  SQL_INJECTION = 'sql_injection',
  XSS = 'xss',
  CSRF = 'csrf',
  COMMAND_INJECTION = 'command_injection',
  PATH_TRAVERSAL = 'path_traversal',
  
  // Authentication threats
  CREDENTIAL_STUFFING = 'credential_stuffing',
  PASSWORD_SPRAY = 'password_spray',
  SESSION_HIJACKING = 'session_hijacking',
  TOKEN_THEFT = 'token_theft',
  
  // Behavioral threats
  ANOMALOUS_BEHAVIOR = 'anomalous_behavior',
  PRIVILEGE_ABUSE = 'privilege_abuse',
  DATA_EXFILTRATION = 'data_exfiltration',
  INSIDER_THREAT = 'insider_threat',
  
  // Advanced threats
  APT = 'apt',
  ZERO_DAY = 'zero_day',
  MALWARE = 'malware',
  PHISHING = 'phishing'
}

export enum ThreatSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ResponseAction {
  MONITOR = 'monitor',
  LOG = 'log',
  ALERT = 'alert',
  BLOCK = 'block',
  QUARANTINE = 'quarantine',
  ESCALATE = 'escalate'
}

export interface ThreatIndicator {
  id: string;
  type: ThreatType;
  name: string;
  description: string;
  pattern: RegExp | string | ((data: any) => boolean);
  severity: ThreatSeverity;
  confidence: number;
  enabled: boolean;
  metadata: Record<string, any>;
}

export interface ThreatDetection {
  id: string;
  timestamp: number;
  type: ThreatType;
  severity: ThreatSeverity;
  confidence: number;
  source: ThreatSource;
  indicators: string[];
  evidence: ThreatEvidence;
  context: ThreatContext;
  response: ThreatResponse;
  status: 'active' | 'resolved' | 'false_positive';
}

export interface ThreatSource {
  ipAddress: string;
  userAgent?: string;
  userId?: string;
  sessionId?: string;
  geolocation?: GeoLocation;
  reputation: number;
}

export interface ThreatEvidence {
  requestData?: any;
  responseData?: any;
  headers?: Record<string, string>;
  patterns?: string[];
  anomalies?: string[];
  timeline?: TimelineEvent[];
  artifacts?: string[];
}

export interface ThreatContext {
  requestId?: string;
  correlationId?: string;
  businessProcess?: string;
  affectedResources?: string[];
  relatedThreats?: string[];
  killChain?: string[];
}

export interface ThreatResponse {
  action: ResponseAction;
  automated: boolean;
  timestamp: number;
  effectiveness?: number;
  details?: string;
  followUpActions?: string[];
}

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  isp?: string;
}

export interface TimelineEvent {
  timestamp: number;
  event: string;
  details: any;
}

export interface BehavioralProfile {
  userId: string;
  baseline: BehavioralBaseline;
  currentSession: SessionBehavior;
  deviations: BehavioralDeviation[];
  riskScore: number;
  lastUpdated: number;
}

export interface BehavioralBaseline {
  typicalHours: number[];
  averageSessionDuration: number;
  commonResources: string[];
  typicalLocations: GeoLocation[];
  accessPatterns: AccessPattern[];
  deviceFingerprints: string[];
}

export interface SessionBehavior {
  sessionId: string;
  startTime: number;
  ipAddress: string;
  userAgent: string;
  accessedResources: string[];
  actionCounts: Record<string, number>;
  anomalyScore: number;
}

export interface BehavioralDeviation {
  type: string;
  severity: ThreatSeverity;
  description: string;
  confidence: number;
  timestamp: number;
  details: any;
}

export interface AccessPattern {
  resource: string;
  frequency: number;
  timePattern: number[];
  methods: string[];
}

export interface ThreatIntelligence {
  indicators: ThreatIndicator[];
  feeds: ThreatFeed[];
  signatures: ThreatSignature[];
  reputation: ReputationDatabase;
}

export interface ThreatFeed {
  name: string;
  url: string;
  type: 'ip' | 'domain' | 'hash' | 'signature';
  lastUpdated: number;
  enabled: boolean;
}

export interface ThreatSignature {
  id: string;
  name: string;
  pattern: string;
  type: ThreatType;
  severity: ThreatSeverity;
  enabled: boolean;
}

export interface ReputationDatabase {
  ipReputations: Map<string, number>;
  domainReputations: Map<string, number>;
  hashReputations: Map<string, number>;
  lastUpdated: number;
}

export class ThreatDetectionEngine extends EventEmitter {
  private static instance: ThreatDetectionEngine;
  private config: ThreatDetectionConfig;
  private indicators: Map<string, ThreatIndicator> = new Map();
  private detections: Map<string, ThreatDetection> = new Map();
  private behavioralProfiles: Map<string, BehavioralProfile> = new Map();
  private threatIntelligence: ThreatIntelligence;
  private mlModels: Map<string, any> = new Map();
  
  // Real-time tracking
  private activeConnections: Map<string, ConnectionState> = new Map();
  private suspiciousActivities: Map<string, SuspiciousActivity[]> = new Map();
  private rateLimitTracking: Map<string, RateLimitState> = new Map();

  private constructor(config?: Partial<ThreatDetectionConfig>) {
    super();
    this.config = this.mergeConfig(config);
    this.threatIntelligence = this.initializeThreatIntelligence();
    this.initializeDetectionEngine();
  }

  public static getInstance(config?: Partial<ThreatDetectionConfig>): ThreatDetectionEngine {
    if (!ThreatDetectionEngine.instance) {
      ThreatDetectionEngine.instance = new ThreatDetectionEngine(config);
    }
    return ThreatDetectionEngine.instance;
  }

  /**
   * Analyze request for threats
   */
  public async analyzeRequest(req: Request): Promise<ThreatDetection[]> {
    try {
      const detections: ThreatDetection[] = [];
      const source = this.extractThreatSource(req);
      
      // Run multiple detection engines in parallel
      const detectionResults = await Promise.allSettled([
        this.detectApplicationThreats(req, source),
        this.detectBehavioralAnomalies(req, source),
        this.detectNetworkThreats(req, source),
        this.detectAuthenticationThreats(req, source),
        this.runMLDetection(req, source)
      ]);

      // Collect all detections
      detectionResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          detections.push(...result.value);
        }
      });

      // Process detections
      for (const detection of detections) {
        await this.processDetection(detection);
      }

      // Update behavioral profiles
      await this.updateBehavioralProfile(source, req);

      logger.debug('Request threat analysis completed', {
        url: req.url,
        method: req.method,
        threatsDetected: detections.length,
        ipAddress: source.ipAddress
      });

      return detections;
    } catch (error) {
      logger.error('Threat analysis failed', {
        url: req.url,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Detect application-level threats
   */
  public async detectApplicationThreats(
    req: Request,
    source: ThreatSource
  ): Promise<ThreatDetection[]> {
    const detections: ThreatDetection[] = [];
    
    try {
      // SQL Injection detection
      const sqlInjection = await this.detectSQLInjection(req);
      if (sqlInjection) {
        detections.push(sqlInjection);
      }

      // XSS detection
      const xss = await this.detectXSS(req);
      if (xss) {
        detections.push(xss);
      }

      // Command injection detection
      const commandInjection = await this.detectCommandInjection(req);
      if (commandInjection) {
        detections.push(commandInjection);
      }

      // Path traversal detection
      const pathTraversal = await this.detectPathTraversal(req);
      if (pathTraversal) {
        detections.push(pathTraversal);
      }

      return detections;
    } catch (error) {
      logger.error('Application threat detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Detect behavioral anomalies
   */
  public async detectBehavioralAnomalies(
    req: Request,
    source: ThreatSource
  ): Promise<ThreatDetection[]> {
    const detections: ThreatDetection[] = [];
    
    try {
      if (!source.userId) {
        return detections; // No behavioral analysis for anonymous users
      }

      const profile = this.behavioralProfiles.get(source.userId);
      if (!profile) {
        return detections; // No baseline yet
      }

      // Time-based anomalies
      const timeAnomaly = this.detectTimeBasedAnomalies(profile, new Date());
      if (timeAnomaly) {
        detections.push(await this.createDetection(
          ThreatType.ANOMALOUS_BEHAVIOR,
          ThreatSeverity.MEDIUM,
          source,
          'Unusual access time detected',
          { timeAnomaly }
        ));
      }

      // Location-based anomalies
      const locationAnomaly = await this.detectLocationAnomalies(profile, source);
      if (locationAnomaly) {
        detections.push(await this.createDetection(
          ThreatType.ANOMALOUS_BEHAVIOR,
          ThreatSeverity.HIGH,
          source,
          'Unusual access location detected',
          { locationAnomaly }
        ));
      }

      // Resource access anomalies
      const resourceAnomaly = this.detectResourceAccessAnomalies(profile, req);
      if (resourceAnomaly) {
        detections.push(await this.createDetection(
          ThreatType.ANOMALOUS_BEHAVIOR,
          ThreatSeverity.MEDIUM,
          source,
          'Unusual resource access pattern detected',
          { resourceAnomaly }
        ));
      }

      return detections;
    } catch (error) {
      logger.error('Behavioral anomaly detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Detect network-level threats
   */
  public async detectNetworkThreats(
    req: Request,
    source: ThreatSource
  ): Promise<ThreatDetection[]> {
    const detections: ThreatDetection[] = [];
    
    try {
      // Rate limiting / DoS detection
      const rateLimitViolation = await this.detectRateLimitViolation(source);
      if (rateLimitViolation) {
        detections.push(rateLimitViolation);
      }

      // IP reputation check
      const reputationThreat = await this.checkIPReputation(source);
      if (reputationThreat) {
        detections.push(reputationThreat);
      }

      // Suspicious request patterns
      const suspiciousPattern = await this.detectSuspiciousPatterns(req, source);
      if (suspiciousPattern) {
        detections.push(suspiciousPattern);
      }

      return detections;
    } catch (error) {
      logger.error('Network threat detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Detect authentication threats
   */
  public async detectAuthenticationThreats(
    req: Request,
    source: ThreatSource
  ): Promise<ThreatDetection[]> {
    const detections: ThreatDetection[] = [];
    
    try {
      // Brute force detection
      if (this.isAuthenticationEndpoint(req)) {
        const bruteForce = await this.detectBruteForce(source);
        if (bruteForce) {
          detections.push(bruteForce);
        }

        // Credential stuffing detection
        const credentialStuffing = await this.detectCredentialStuffing(req, source);
        if (credentialStuffing) {
          detections.push(credentialStuffing);
        }
      }

      // Token manipulation detection
      const tokenManipulation = await this.detectTokenManipulation(req);
      if (tokenManipulation) {
        detections.push(tokenManipulation);
      }

      return detections;
    } catch (error) {
      logger.error('Authentication threat detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Run ML-based threat detection
   */
  public async runMLDetection(
    req: Request,
    source: ThreatSource
  ): Promise<ThreatDetection[]> {
    const detections: ThreatDetection[] = [];
    
    try {
      // Extract features for ML analysis
      const features = this.extractRequestFeatures(req, source);
      
      // Run through available ML models
      for (const [modelName, model] of this.mlModels) {
        try {
          const prediction = await this.runMLModel(model, features);
          if (prediction.isThreat && prediction.confidence > this.config.mlThreshold) {
            detections.push(await this.createDetection(
              prediction.threatType,
              this.mapConfidenceToSeverity(prediction.confidence),
              source,
              `ML model ${modelName} detected threat`,
              { mlPrediction: prediction, features }
            ));
          }
        } catch (modelError) {
          logger.warn('ML model execution failed', {
            modelName,
            error: modelError instanceof Error ? modelError.message : 'Unknown error'
          });
        }
      }

      return detections;
    } catch (error) {
      logger.error('ML threat detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Process detected threat
   */
  public async processDetection(detection: ThreatDetection): Promise<void> {
    try {
      // Store detection
      this.detections.set(detection.id, detection);
      
      // Determine response action
      const action = this.determineResponseAction(detection);
      detection.response = {
        action,
        automated: true,
        timestamp: Date.now()
      };

      // Execute response
      await this.executeResponse(detection);
      
      // Log to audit system
      await comprehensiveAuditSystem.logEvent(
        AuditEventType.THREAT_DETECTED,
        {
          description: `Threat detected: ${detection.type}`,
          metadata: {
            threatId: detection.id,
            severity: detection.severity,
            confidence: detection.confidence,
            source: detection.source.ipAddress
          }
        },
        {
          businessProcess: 'threat_detection',
          riskLevel: detection.severity
        }
      );

      // Emit event for real-time monitoring
      this.emit('threatDetected', detection);
      
      logger.warn('Threat detected and processed', {
        id: detection.id,
        type: detection.type,
        severity: detection.severity,
        action: action,
        source: detection.source.ipAddress
      });
    } catch (error) {
      logger.error('Failed to process threat detection', {
        detectionId: detection.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update threat intelligence
   */
  public async updateThreatIntelligence(): Promise<void> {
    try {
      logger.info('Updating threat intelligence');
      
      // Update threat feeds
      for (const feed of this.threatIntelligence.feeds) {
        if (feed.enabled) {
          await this.updateThreatFeed(feed);
        }
      }
      
      // Update reputation database
      await this.updateReputationDatabase();
      
      // Update ML models
      await this.updateMLModels();
      
      logger.info('Threat intelligence updated successfully');
    } catch (error) {
      logger.error('Failed to update threat intelligence', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Private helper methods for threat detection

  private async detectSQLInjection(req: Request): Promise<ThreatDetection | null> {
    const sqlPatterns = [
      /(\bUNION\b.*\bSELECT\b)/i,
      /(\bSELECT\b.*\bFROM\b.*\bWHERE\b)/i,
      /(\bINSERT\b.*\bINTO\b)/i,
      /(\bUPDATE\b.*\bSET\b)/i,
      /(\bDELETE\b.*\bFROM\b)/i,
      /(\bDROP\b.*\bTABLE\b)/i,
      /('.*OR.*'=')/i,
      /(1=1|1=0)/i
    ];

    const testStrings = [
      JSON.stringify(req.query),
      JSON.stringify(req.body),
      req.url
    ];

    for (const testString of testStrings) {
      for (const pattern of sqlPatterns) {
        if (pattern.test(testString)) {
          return await this.createDetection(
            ThreatType.SQL_INJECTION,
            ThreatSeverity.HIGH,
            this.extractThreatSource(req),
            'SQL injection attempt detected',
            { pattern: pattern.source, location: testString }
          );
        }
      }
    }

    return null;
  }

  private async detectXSS(req: Request): Promise<ThreatDetection | null> {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
      /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi
    ];

    const testStrings = [
      JSON.stringify(req.query),
      JSON.stringify(req.body),
      Object.values(req.headers).join(' ')
    ];

    for (const testString of testStrings) {
      for (const pattern of xssPatterns) {
        if (pattern.test(testString)) {
          return await this.createDetection(
            ThreatType.XSS,
            ThreatSeverity.HIGH,
            this.extractThreatSource(req),
            'XSS attempt detected',
            { pattern: pattern.source, location: testString }
          );
        }
      }
    }

    return null;
  }

  private async detectCommandInjection(req: Request): Promise<ThreatDetection | null> {
    const commandPatterns = [
      /[;&|`$()]/,
      /\b(cat|ls|pwd|whoami|id|uname)\b/i,
      /\b(wget|curl|nc|netcat)\b/i,
      /\b(rm|del|format)\b.*(-rf|-r|-f)/i
    ];

    const testStrings = [
      JSON.stringify(req.query),
      JSON.stringify(req.body)
    ];

    for (const testString of testStrings) {
      for (const pattern of commandPatterns) {
        if (pattern.test(testString)) {
          return await this.createDetection(
            ThreatType.COMMAND_INJECTION,
            ThreatSeverity.CRITICAL,
            this.extractThreatSource(req),
            'Command injection attempt detected',
            { pattern: pattern.source, location: testString }
          );
        }
      }
    }

    return null;
  }

  private async detectPathTraversal(req: Request): Promise<ThreatDetection | null> {
    const traversalPatterns = [
      /\.\.[\/\\]/,
      /\.\.%2f/i,
      /\.\.%5c/i,
      /%2e%2e[\/\\]/i
    ];

    const testStrings = [req.url, JSON.stringify(req.query)];

    for (const testString of testStrings) {
      for (const pattern of traversalPatterns) {
        if (pattern.test(testString)) {
          return await this.createDetection(
            ThreatType.PATH_TRAVERSAL,
            ThreatSeverity.MEDIUM,
            this.extractThreatSource(req),
            'Path traversal attempt detected',
            { pattern: pattern.source, location: testString }
          );
        }
      }
    }

    return null;
  }

  private async createDetection(
    type: ThreatType,
    severity: ThreatSeverity,
    source: ThreatSource,
    description: string,
    evidence: any
  ): Promise<ThreatDetection> {
    return {
      id: this.generateDetectionId(),
      timestamp: Date.now(),
      type,
      severity,
      confidence: this.calculateConfidence(type, evidence),
      source,
      indicators: [type],
      evidence: {
        ...evidence,
        description
      },
      context: {
        correlationId: this.generateCorrelationId()
      },
      response: {
        action: ResponseAction.LOG,
        automated: false,
        timestamp: Date.now()
      },
      status: 'active'
    };
  }

  private extractThreatSource(req: Request): ThreatSource {
    return {
      ipAddress: this.extractIPAddress(req),
      userAgent: req.headers['user-agent'],
      userId: req.headers['x-user-id'] as string,
      sessionId: req.headers['x-session-id'] as string,
      reputation: 0 // Would be calculated from reputation database
    };
  }

  private extractIPAddress(req: Request): string {
    return (req.headers['x-forwarded-for'] as string) ||
           (req.headers['x-real-ip'] as string) ||
           req.connection.remoteAddress ||
           '0.0.0.0';
  }

  private generateDetectionId(): string {
    return `threat_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private calculateConfidence(type: ThreatType, evidence: any): number {
    // Simplified confidence calculation
    let confidence = 0.5;
    
    if (evidence.pattern) confidence += 0.3;
    if (evidence.location) confidence += 0.2;
    
    return Math.min(1.0, confidence);
  }

  private determineResponseAction(detection: ThreatDetection): ResponseAction {
    if (detection.severity === ThreatSeverity.CRITICAL) {
      return ResponseAction.BLOCK;
    } else if (detection.severity === ThreatSeverity.HIGH) {
      return ResponseAction.ALERT;
    } else {
      return ResponseAction.LOG;
    }
  }

  private async executeResponse(detection: ThreatDetection): Promise<void> {
    switch (detection.response.action) {
      case ResponseAction.BLOCK:
        await this.blockThreatSource(detection.source);
        break;
      case ResponseAction.ALERT:
        await this.sendThreatAlert(detection);
        break;
      case ResponseAction.LOG:
        // Already logged
        break;
    }
  }

  private async blockThreatSource(source: ThreatSource): Promise<void> {
    // Implementation would block the IP address
    logger.warn('Threat source blocked', {
      ipAddress: source.ipAddress,
      userId: source.userId
    });
  }

  private async sendThreatAlert(detection: ThreatDetection): Promise<void> {
    // Implementation would send alerts to security team
    logger.warn('Threat alert sent', {
      detectionId: detection.id,
      type: detection.type,
      severity: detection.severity
    });
  }

  // Placeholder implementations for complex features
  private mergeConfig(config?: Partial<ThreatDetectionConfig>): ThreatDetectionConfig {
    return {
      enabled: true,
      mlThreshold: 0.7,
      realTimeAnalysis: true,
      behavioralAnalysis: true,
      threatIntelligence: true,
      autoResponse: true,
      ...config
    };
  }

  private initializeThreatIntelligence(): ThreatIntelligence {
    return {
      indicators: [],
      feeds: [],
      signatures: [],
      reputation: {
        ipReputations: new Map(),
        domainReputations: new Map(),
        hashReputations: new Map(),
        lastUpdated: Date.now()
      }
    };
  }

  private async initializeDetectionEngine(): Promise<void> {
    logger.info('Threat detection engine initialized');
  }

  // Placeholder methods for complex detection logic
  private detectTimeBasedAnomalies(profile: BehavioralProfile, time: Date): boolean { return false; }
  private async detectLocationAnomalies(profile: BehavioralProfile, source: ThreatSource): Promise<boolean> { return false; }
  private detectResourceAccessAnomalies(profile: BehavioralProfile, req: Request): boolean { return false; }
  private async detectRateLimitViolation(source: ThreatSource): Promise<ThreatDetection | null> { return null; }
  private async checkIPReputation(source: ThreatSource): Promise<ThreatDetection | null> { return null; }
  private async detectSuspiciousPatterns(req: Request, source: ThreatSource): Promise<ThreatDetection | null> { return null; }
  private isAuthenticationEndpoint(req: Request): boolean { return req.path.includes('/auth') || req.path.includes('/login'); }
  private async detectBruteForce(source: ThreatSource): Promise<ThreatDetection | null> { return null; }
  private async detectCredentialStuffing(req: Request, source: ThreatSource): Promise<ThreatDetection | null> { return null; }
  private async detectTokenManipulation(req: Request): Promise<ThreatDetection | null> { return null; }
  private extractRequestFeatures(req: Request, source: ThreatSource): any { return {}; }
  private async runMLModel(model: any, features: any): Promise<any> { return { isThreat: false, confidence: 0, threatType: ThreatType.ANOMALOUS_BEHAVIOR }; }
  private mapConfidenceToSeverity(confidence: number): ThreatSeverity { return ThreatSeverity.MEDIUM; }
  private async updateBehavioralProfile(source: ThreatSource, req: Request): Promise<void> {}
  private async updateThreatFeed(feed: ThreatFeed): Promise<void> {}
  private async updateReputationDatabase(): Promise<void> {}
  private async updateMLModels(): Promise<void> {}
}

// Helper interfaces
interface ThreatDetectionConfig {
  enabled: boolean;
  mlThreshold: number;
  realTimeAnalysis: boolean;
  behavioralAnalysis: boolean;
  threatIntelligence: boolean;
  autoResponse: boolean;
}

interface ConnectionState {
  ipAddress: string;
  connectionCount: number;
  firstSeen: number;
  lastSeen: number;
}

interface SuspiciousActivity {
  type: string;
  timestamp: number;
  details: any;
}

interface RateLimitState {
  requestCount: number;
  windowStart: number;
  blocked: boolean;
}

// Export singleton instance
export const threatDetectionEngine = ThreatDetectionEngine.getInstance();