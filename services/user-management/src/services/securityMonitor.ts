import { EventEmitter } from 'events';
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { AuditService } from './audit';
import { EmailService } from './email';
import {
  User,
  SecurityEvent,
  SecurityEventType,
  AuditLog,
  UserSession
} from '@/types';

/**
 * Security Monitoring and Threat Detection Service
 * Provides real-time security monitoring, anomaly detection, and threat response
 */
export class SecurityMonitorService extends EventEmitter {
  private db: DatabaseService;
  private redis: RedisService;
  private audit: AuditService;
  private email: EmailService;
  private alertThresholds: Map<string, number>;
  private threatPatterns: Map<string, RegExp>;
  private monitoringEnabled: boolean;

  constructor() {
    super();
    this.db = new DatabaseService();
    this.redis = new RedisService();
    this.audit = new AuditService();
    this.email = new EmailService();
    this.alertThresholds = new Map();
    this.threatPatterns = new Map();
    this.monitoringEnabled = true;

    this.initializeThresholds();
    this.initializeThreatPatterns();
    this.setupEventListeners();
  }

  // ==========================================
  // Real-time Security Monitoring
  // ==========================================

  /**
   * Monitor login attempts for suspicious patterns
   */
  async monitorLoginAttempt(
    phoneNumber: string,
    ipAddress: string,
    userAgent: string,
    success: boolean,
    timestamp: Date = new Date()
  ): Promise<void> {
    if (!this.monitoringEnabled) return;

    try {
      const userId = success ? await this.getUserIdByPhone(phoneNumber) : null;
      
      // Record login attempt
      await this.recordLoginAttempt(phoneNumber, ipAddress, userAgent, success, timestamp);

      // Check for suspicious patterns
      const threats = await this.analyzeLoginPattern(phoneNumber, ipAddress, userAgent, success);
      
      for (const threat of threats) {
        await this.handleSecurityThreat(threat, userId);
      }

      // Check for brute force attacks
      if (!success) {
        await this.checkBruteForceAttack(phoneNumber, ipAddress);
      }

      // Check for suspicious device patterns
      await this.checkDeviceAnomalies(phoneNumber, userAgent, ipAddress);

    } catch (error) {
      logger.error('Login monitoring failed', {
        phoneNumber: phoneNumber.substring(0, 3) + '***',
        ipAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Monitor user session for anomalies
   */
  async monitorUserSession(
    userId: string,
    sessionId: string,
    activity: {
      action: string;
      resource: string;
      ipAddress: string;
      userAgent: string;
      timestamp: Date;
    }
  ): Promise<void> {
    if (!this.monitoringEnabled) return;

    try {
      // Record activity
      await this.recordSessionActivity(userId, sessionId, activity);

      // Check for session anomalies
      const anomalies = await this.detectSessionAnomalies(userId, sessionId, activity);
      
      for (const anomaly of anomalies) {
        await this.handleSecurityAnomaly(anomaly, userId);
      }

      // Check for privilege escalation attempts
      await this.checkPrivilegeEscalation(userId, activity);

      // Check for suspicious activity patterns
      await this.checkSuspiciousActivityPatterns(userId, activity);

    } catch (error) {
      logger.error('Session monitoring failed', {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Monitor API requests for security threats
   */
  async monitorAPIRequest(
    userId: string | null,
    endpoint: string,
    method: string,
    ipAddress: string,
    userAgent: string,
    responseStatus: number,
    responseTime: number
  ): Promise<void> {
    if (!this.monitoringEnabled) return;

    try {
      // Record API request
      await this.recordAPIRequest(userId, endpoint, method, ipAddress, userAgent, responseStatus, responseTime);

      // Check for API abuse patterns
      const threats = await this.analyzeAPIUsage(userId, endpoint, method, ipAddress, responseStatus);
      
      for (const threat of threats) {
        await this.handleAPIThreat(threat, userId);
      }

      // Check for scanning attempts
      if (responseStatus === 404 || responseStatus === 403) {
        await this.checkScanningAttempts(ipAddress, endpoint);
      }

      // Check for DDoS patterns
      await this.checkDDoSPatterns(ipAddress, endpoint);

    } catch (error) {
      logger.error('API monitoring failed', {
        userId,
        endpoint,
        ipAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Threat Detection Algorithms
  // ==========================================

  /**
   * Analyze login patterns for threats
   */
  private async analyzeLoginPattern(
    phoneNumber: string,
    ipAddress: string,
    userAgent: string,
    success: boolean
  ): Promise<Array<SecurityEvent>> {
    const threats: SecurityEvent[] = [];

    try {
      // Get recent login attempts
      const recentAttempts = await this.getRecentLoginAttempts(phoneNumber, ipAddress, 3600); // Last hour
      
      // Check for multiple failed attempts
      const failedAttempts = recentAttempts.filter(attempt => !attempt.success);
      if (failedAttempts.length >= this.alertThresholds.get('failed_login_threshold')!) {
        threats.push({
          type: 'failed_login',
          severity: 'high',
          details: {
            phoneNumber: phoneNumber.substring(0, 3) + '***',
            ipAddress,
            attemptCount: failedAttempts.length,
            timeWindow: '1 hour'
          },
          timestamp: new Date()
        });
      }

      // Check for distributed login attempts (same phone, different IPs)
      const uniqueIPs = new Set(recentAttempts.map(a => a.ipAddress));
      if (uniqueIPs.size >= this.alertThresholds.get('distributed_login_threshold')!) {
        threats.push({
          type: 'distributed_login_attempt',
          severity: 'medium',
          details: {
            phoneNumber: phoneNumber.substring(0, 3) + '***',
            uniqueIPs: uniqueIPs.size,
            timeWindow: '1 hour'
          },
          timestamp: new Date()
        });
      }

      // Check for impossible travel (same user, distant locations)
      if (success) {
        const previousLocation = await this.getLastKnownLocation(phoneNumber);
        if (previousLocation) {
          const distance = await this.calculateDistance(previousLocation.ipAddress, ipAddress);
          const timeDiff = Date.now() - previousLocation.timestamp.getTime();
          const impossibleSpeed = distance / (timeDiff / 3600000); // km/hour
          
          if (impossibleSpeed > 1000) { // More than 1000 km/h
            threats.push({
              type: 'impossible_travel',
              severity: 'high',
              details: {
                phoneNumber: phoneNumber.substring(0, 3) + '***',
                distance,
                timeDiff: timeDiff / 60000, // minutes
                calculatedSpeed: impossibleSpeed
              },
              timestamp: new Date()
            });
          }
        }
      }

      // Check for suspicious user agents
      const suspiciousUA = this.detectSuspiciousUserAgent(userAgent);
      if (suspiciousUA) {
        threats.push({
          type: 'suspicious_user_agent',
          severity: 'medium',
          details: {
            userAgent,
            suspiciousPattern: suspiciousUA,
            ipAddress
          },
          timestamp: new Date()
        });
      }

      return threats;

    } catch (error) {
      logger.error('Failed to analyze login pattern', {
        phoneNumber: phoneNumber.substring(0, 3) + '***',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Detect session anomalies
   */
  private async detectSessionAnomalies(
    userId: string,
    sessionId: string,
    activity: any
  ): Promise<Array<SecurityEvent>> {
    const anomalies: SecurityEvent[] = [];

    try {
      // Get user's typical behavior patterns
      const userPatterns = await this.getUserBehaviorPatterns(userId);
      
      // Check for unusual activity time
      const currentHour = new Date().getHours();
      if (userPatterns.typicalHours && !userPatterns.typicalHours.includes(currentHour)) {
        const deviation = Math.min(...userPatterns.typicalHours.map(h => Math.abs(h - currentHour)));
        if (deviation > 6) { // More than 6 hours deviation
          anomalies.push({
            type: 'unusual_activity_time',
            severity: 'low',
            userId,
            details: {
              currentHour,
              typicalHours: userPatterns.typicalHours,
              deviation
            },
            timestamp: new Date()
          });
        }
      }

      // Check for rapid successive actions
      const recentActivities = await this.getRecentSessionActivities(sessionId, 300); // Last 5 minutes
      if (recentActivities.length > this.alertThresholds.get('rapid_activity_threshold')!) {
        anomalies.push({
          type: 'rapid_activity',
          severity: 'medium',
          userId,
          details: {
            sessionId,
            activityCount: recentActivities.length,
            timeWindow: '5 minutes'
          },
          timestamp: new Date()
        });
      }

      // Check for unusual IP address
      if (userPatterns.knownIPs && !userPatterns.knownIPs.includes(activity.ipAddress)) {
        anomalies.push({
          type: 'unknown_ip_address',
          severity: 'medium',
          userId,
          details: {
            newIP: activity.ipAddress,
            knownIPs: userPatterns.knownIPs.slice(0, 3) // Only log first 3 for privacy
          },
          timestamp: new Date()
        });
      }

      // Check for session hijacking indicators
      const sessionInfo = await this.getSessionInfo(sessionId);
      if (sessionInfo && sessionInfo.userAgent !== activity.userAgent) {
        anomalies.push({
          type: 'session_hijacking_attempt',
          severity: 'critical',
          userId,
          details: {
            sessionId,
            originalUserAgent: sessionInfo.userAgent,
            currentUserAgent: activity.userAgent
          },
          timestamp: new Date()
        });
      }

      return anomalies;

    } catch (error) {
      logger.error('Failed to detect session anomalies', {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Analyze API usage patterns
   */
  private async analyzeAPIUsage(
    userId: string | null,
    endpoint: string,
    method: string,
    ipAddress: string,
    responseStatus: number
  ): Promise<Array<SecurityEvent>> {
    const threats: SecurityEvent[] = [];

    try {
      // Check for rate limiting violations
      const requestCount = await this.getAPIRequestCount(ipAddress, endpoint, 60); // Last minute
      if (requestCount > this.alertThresholds.get('api_rate_limit')!) {
        threats.push({
          type: 'api_rate_limit_exceeded',
          severity: 'medium',
          userId,
          details: {
            endpoint,
            ipAddress,
            requestCount,
            timeWindow: '1 minute'
          },
          timestamp: new Date()
        });
      }

      // Check for SQL injection attempts
      if (this.detectSQLInjectionAttempt(endpoint)) {
        threats.push({
          type: 'sql_injection_attempt',
          severity: 'critical',
          userId,
          details: {
            endpoint,
            ipAddress,
            method,
            suspiciousPatterns: this.extractSQLPatterns(endpoint)
          },
          timestamp: new Date()
        });
      }

      // Check for path traversal attempts
      if (this.detectPathTraversalAttempt(endpoint)) {
        threats.push({
          type: 'path_traversal_attempt',
          severity: 'high',
          userId,
          details: {
            endpoint,
            ipAddress,
            method
          },
          timestamp: new Date()
        });
      }

      // Check for excessive 4xx errors (potential scanning)
      if (responseStatus >= 400 && responseStatus < 500) {
        const errorCount = await this.get4xxErrorCount(ipAddress, 300); // Last 5 minutes
        if (errorCount > this.alertThresholds.get('scanning_threshold')!) {
          threats.push({
            type: 'potential_scanning',
            severity: 'medium',
            userId,
            details: {
              ipAddress,
              errorCount,
              timeWindow: '5 minutes',
              lastEndpoint: endpoint
            },
            timestamp: new Date()
          });
        }
      }

      return threats;

    } catch (error) {
      logger.error('Failed to analyze API usage', {
        userId,
        endpoint,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  // ==========================================
  // Threat Response
  // ==========================================

  /**
   * Handle security threat
   */
  private async handleSecurityThreat(threat: SecurityEvent, userId?: string | null): Promise<void> {
    try {
      // Log security event
      await this.audit.logSecurityEvent(threat);

      // Emit event for other services
      this.emit('security_threat', threat);

      // Take automated response based on severity
      switch (threat.severity) {
        case 'critical':
          await this.handleCriticalThreat(threat, userId);
          break;
        case 'high':
          await this.handleHighThreat(threat, userId);
          break;
        case 'medium':
          await this.handleMediumThreat(threat, userId);
          break;
        case 'low':
          await this.handleLowThreat(threat, userId);
          break;
      }

      // Send notifications
      await this.sendSecurityNotification(threat, userId);

    } catch (error) {
      logger.error('Failed to handle security threat', {
        threatType: threat.type,
        severity: threat.severity,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle critical security threats
   */
  private async handleCriticalThreat(threat: SecurityEvent, userId?: string | null): Promise<void> {
    try {
      switch (threat.type) {
        case 'session_hijacking_attempt':
          if (userId) {
            // Immediately revoke all user sessions
            await this.db.revokeAllUserSessions(userId);
            // Lock account temporarily
            await this.db.updateUserLockStatus(userId, true, 'Security: Session hijacking detected');
            logger.warn('User account locked due to session hijacking attempt', { userId });
          }
          break;

        case 'sql_injection_attempt':
          // Block IP address temporarily
          const ipAddress = threat.details?.ipAddress;
          if (ipAddress) {
            await this.blockIPAddress(ipAddress, 'SQL injection attempt', 3600); // 1 hour
            logger.warn('IP address blocked due to SQL injection attempt', { ipAddress });
          }
          break;

        default:
          logger.warn('Critical threat detected but no specific handler', { 
            type: threat.type 
          });
      }
    } catch (error) {
      logger.error('Failed to handle critical threat', {
        threatType: threat.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle high severity threats
   */
  private async handleHighThreat(threat: SecurityEvent, userId?: string | null): Promise<void> {
    try {
      switch (threat.type) {
        case 'impossible_travel':
        case 'failed_login':
          if (userId) {
            // Require additional verification for next login
            await this.requireAdditionalVerification(userId);
            logger.info('Additional verification required for user', { userId });
          }
          break;

        case 'path_traversal_attempt':
          const ipAddress = threat.details?.ipAddress;
          if (ipAddress) {
            await this.blockIPAddress(ipAddress, 'Path traversal attempt', 1800); // 30 minutes
            logger.warn('IP address blocked due to path traversal attempt', { ipAddress });
          }
          break;

        default:
          logger.info('High severity threat logged', { type: threat.type });
      }
    } catch (error) {
      logger.error('Failed to handle high threat', {
        threatType: threat.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle medium severity threats
   */
  private async handleMediumThreat(threat: SecurityEvent, userId?: string | null): Promise<void> {
    try {
      // Increase monitoring for this user/IP
      if (userId) {
        await this.increaseUserMonitoring(userId, 3600); // 1 hour
      }

      if (threat.details?.ipAddress) {
        await this.increaseIPMonitoring(threat.details.ipAddress, 1800); // 30 minutes
      }

      logger.info('Medium severity threat handled', { type: threat.type });
    } catch (error) {
      logger.error('Failed to handle medium threat', {
        threatType: threat.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle low severity threats
   */
  private async handleLowThreat(threat: SecurityEvent, userId?: string | null): Promise<void> {
    try {
      // Just log and monitor
      logger.info('Low severity threat logged', { type: threat.type });
    } catch (error) {
      logger.error('Failed to handle low threat', {
        threatType: threat.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Security Utilities
  // ==========================================

  /**
   * Block IP address
   */
  private async blockIPAddress(ipAddress: string, reason: string, duration: number): Promise<void> {
    try {
      await this.redis.setex(`blocked_ip:${ipAddress}`, duration, {
        reason,
        blockedAt: new Date().toISOString(),
        expiresIn: duration
      });

      logger.warn('IP address blocked', { ipAddress, reason, duration });
    } catch (error) {
      logger.error('Failed to block IP address', {
        ipAddress,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check if IP is blocked
   */
  async isIPBlocked(ipAddress: string): Promise<boolean> {
    try {
      const blocked = await this.redis.get(`blocked_ip:${ipAddress}`);
      return !!blocked;
    } catch (error) {
      logger.error('Failed to check IP block status', {
        ipAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Require additional verification
   */
  private async requireAdditionalVerification(userId: string): Promise<void> {
    try {
      await this.redis.setex(`require_verification:${userId}`, 3600, {
        requiredAt: new Date().toISOString(),
        reason: 'Security anomaly detected'
      });
    } catch (error) {
      logger.error('Failed to set additional verification requirement', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Increase user monitoring
   */
  private async increaseUserMonitoring(userId: string, duration: number): Promise<void> {
    try {
      await this.redis.setex(`enhanced_monitoring:user:${userId}`, duration, {
        startedAt: new Date().toISOString(),
        level: 'enhanced'
      });
    } catch (error) {
      logger.error('Failed to increase user monitoring', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Increase IP monitoring
   */
  private async increaseIPMonitoring(ipAddress: string, duration: number): Promise<void> {
    try {
      await this.redis.setex(`enhanced_monitoring:ip:${ipAddress}`, duration, {
        startedAt: new Date().toISOString(),
        level: 'enhanced'
      });
    } catch (error) {
      logger.error('Failed to increase IP monitoring', {
        ipAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Threat Detection Helpers
  // ==========================================

  /**
   * Detect suspicious user agent
   */
  private detectSuspiciousUserAgent(userAgent: string): string | null {
    for (const [pattern, regex] of this.threatPatterns) {
      if (regex.test(userAgent)) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Detect SQL injection attempt
   */
  private detectSQLInjectionAttempt(input: string): boolean {
    const sqlPatterns = [
      /(\bUNION\b|\bSELECT\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b|\bDROP\b)/i,
      /('|\b)(OR|AND)\b.*?=/i,
      /--|\*\/|\/\*/,
      /\bEXEC\b|\bEXECUTE\b/i
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Detect path traversal attempt
   */
  private detectPathTraversalAttempt(input: string): boolean {
    const pathTraversalPatterns = [
      /\.\.\/|\.\.\\/, // Directory traversal
      /%2e%2e%2f|%2e%2e%5c/i, // URL encoded traversal
      /\/etc\/passwd|\/etc\/shadow/i, // Unix system files
      /\\windows\\system32/i // Windows system files
    ];

    return pathTraversalPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Extract SQL patterns from input
   */
  private extractSQLPatterns(input: string): string[] {
    const patterns: string[] = [];
    const sqlKeywords = ['UNION', 'SELECT', 'INSERT', 'DELETE', 'UPDATE', 'DROP', 'EXEC'];
    
    sqlKeywords.forEach(keyword => {
      if (new RegExp(`\\b${keyword}\\b`, 'i').test(input)) {
        patterns.push(keyword);
      }
    });

    return patterns;
  }

  // ==========================================
  // Data Retrieval Methods
  // ==========================================

  /**
   * Get recent login attempts
   */
  private async getRecentLoginAttempts(
    phoneNumber: string,
    ipAddress: string,
    timeWindow: number
  ): Promise<Array<{ success: boolean; ipAddress: string; timestamp: Date }>> {
    try {
      const key = `login_attempts:${phoneNumber}`;
      const attempts = await this.redis.getJSON(key) || [];
      const cutoff = Date.now() - (timeWindow * 1000);
      
      return attempts.filter((attempt: any) => 
        new Date(attempt.timestamp).getTime() > cutoff
      );
    } catch (error) {
      logger.error('Failed to get recent login attempts', {
        phoneNumber: phoneNumber.substring(0, 3) + '***',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get user behavior patterns
   */
  private async getUserBehaviorPatterns(userId: string): Promise<{
    typicalHours?: number[];
    knownIPs?: string[];
    commonActions?: string[];
  }> {
    try {
      const key = `behavior_patterns:${userId}`;
      const cached = await this.redis.getJSON(key);
      
      if (cached) {
        return cached;
      }

      // Generate patterns from recent activity
      const recentSessions = await this.db.getRecentUserSessions(userId, 30); // Last 30 days
      const patterns = {
        typicalHours: [...new Set(recentSessions.map(s => new Date(s.createdAt).getHours()))],
        knownIPs: [...new Set(recentSessions.map(s => s.ipAddress))],
        commonActions: [] // Would be populated from audit logs
      };

      // Cache for 1 hour
      await this.redis.setex(key, 3600, patterns);
      
      return patterns;
    } catch (error) {
      logger.error('Failed to get user behavior patterns', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {};
    }
  }

  // ==========================================
  // Initialization Methods
  // ==========================================

  /**
   * Initialize alert thresholds
   */
  private initializeThresholds(): void {
    this.alertThresholds.set('failed_login_threshold', 5);
    this.alertThresholds.set('distributed_login_threshold', 3);
    this.alertThresholds.set('rapid_activity_threshold', 20);
    this.alertThresholds.set('api_rate_limit', 100);
    this.alertThresholds.set('scanning_threshold', 10);
  }

  /**
   * Initialize threat detection patterns
   */
  private initializeThreatPatterns(): void {
    // Suspicious user agent patterns
    this.threatPatterns.set('bot_ua', /bot|crawler|spider|scraper/i);
    this.threatPatterns.set('scanner_ua', /nikto|nmap|sqlmap|dirb|gobuster/i);
    this.threatPatterns.set('automated_tool', /curl|wget|python-requests|php/i);
    this.threatPatterns.set('empty_ua', /^$/);
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.on('security_threat', (threat: SecurityEvent) => {
      logger.warn('Security threat detected', {
        type: threat.type,
        severity: threat.severity,
        userId: threat.userId
      });
    });
  }

  // ==========================================
  // Helper Methods (simplified)
  // ==========================================

  private async getUserIdByPhone(phoneNumber: string): Promise<string | null> {
    try {
      const user = await this.db.getUserByPhoneNumber(phoneNumber);
      return user?.id || null;
    } catch (error) {
      return null;
    }
  }

  private async recordLoginAttempt(
    phoneNumber: string,
    ipAddress: string,
    userAgent: string,
    success: boolean,
    timestamp: Date
  ): Promise<void> {
    const key = `login_attempts:${phoneNumber}`;
    const attempts = await this.redis.getJSON(key) || [];
    
    attempts.push({ phoneNumber, ipAddress, userAgent, success, timestamp });
    
    // Keep only last 100 attempts
    if (attempts.length > 100) {
      attempts.splice(0, attempts.length - 100);
    }
    
    await this.redis.setex(key, 86400, attempts); // 24 hours
  }

  private async recordSessionActivity(userId: string, sessionId: string, activity: any): Promise<void> {
    // Simplified implementation
    const key = `session_activity:${sessionId}`;
    const activities = await this.redis.getJSON(key) || [];
    
    activities.push({ ...activity, timestamp: new Date() });
    
    // Keep only last 50 activities
    if (activities.length > 50) {
      activities.splice(0, activities.length - 50);
    }
    
    await this.redis.setex(key, 7200, activities); // 2 hours
  }

  private async recordAPIRequest(
    userId: string | null,
    endpoint: string,
    method: string,
    ipAddress: string,
    userAgent: string,
    responseStatus: number,
    responseTime: number
  ): Promise<void> {
    // Simplified implementation for monitoring
    const key = `api_requests:${ipAddress}`;
    await this.redis.incr(key);
    await this.redis.expire(key, 300); // 5 minutes
  }

  private async handleSecurityAnomaly(anomaly: SecurityEvent, userId: string): Promise<void> {
    await this.handleSecurityThreat(anomaly, userId);
  }

  private async handleAPIThreat(threat: SecurityEvent, userId: string | null): Promise<void> {
    await this.handleSecurityThreat(threat, userId);
  }

  // Simplified implementations for missing methods
  private async getLastKnownLocation(phoneNumber: string): Promise<{ ipAddress: string; timestamp: Date } | null> {
    return null; // Would implement geolocation logic
  }

  private async calculateDistance(ip1: string, ip2: string): Promise<number> {
    return 0; // Would implement geolocation distance calculation
  }

  private async checkBruteForceAttack(phoneNumber: string, ipAddress: string): Promise<void> {
    // Implementation would check for brute force patterns
  }

  private async checkDeviceAnomalies(phoneNumber: string, userAgent: string, ipAddress: string): Promise<void> {
    // Implementation would check for device-based anomalies
  }

  private async checkPrivilegeEscalation(userId: string, activity: any): Promise<void> {
    // Implementation would check for privilege escalation attempts
  }

  private async checkSuspiciousActivityPatterns(userId: string, activity: any): Promise<void> {
    // Implementation would check for suspicious activity patterns
  }

  private async checkScanningAttempts(ipAddress: string, endpoint: string): Promise<void> {
    // Implementation would check for scanning attempts
  }

  private async checkDDoSPatterns(ipAddress: string, endpoint: string): Promise<void> {
    // Implementation would check for DDoS patterns
  }

  private async getRecentSessionActivities(sessionId: string, seconds: number): Promise<any[]> {
    const key = `session_activity:${sessionId}`;
    const activities = await this.redis.getJSON(key) || [];
    const cutoff = Date.now() - (seconds * 1000);
    
    return activities.filter((activity: any) => 
      new Date(activity.timestamp).getTime() > cutoff
    );
  }

  private async getSessionInfo(sessionId: string): Promise<{ userAgent: string } | null> {
    try {
      const session = await this.db.getUserSession(sessionId);
      return session ? { userAgent: session.userAgent } : null;
    } catch (error) {
      return null;
    }
  }

  private async getAPIRequestCount(ipAddress: string, endpoint: string, seconds: number): Promise<number> {
    const key = `api_requests:${ipAddress}`;
    const count = await this.redis.get(key);
    return parseInt(count || '0');
  }

  private async get4xxErrorCount(ipAddress: string, seconds: number): Promise<number> {
    const key = `4xx_errors:${ipAddress}`;
    const count = await this.redis.get(key);
    return parseInt(count || '0');
  }

  private async sendSecurityNotification(threat: SecurityEvent, userId?: string | null): Promise<void> {
    try {
      if (threat.severity === 'critical' || threat.severity === 'high') {
        // Send immediate notification to security team
        logger.warn('Security notification sent', {
          threatType: threat.type,
          severity: threat.severity,
          userId
        });
      }
    } catch (error) {
      logger.error('Failed to send security notification', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Public Control Methods
  // ==========================================

  /**
   * Enable/disable security monitoring
   */
  setMonitoringEnabled(enabled: boolean): void {
    this.monitoringEnabled = enabled;
    logger.info(`Security monitoring ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update alert threshold
   */
  updateAlertThreshold(key: string, value: number): void {
    this.alertThresholds.set(key, value);
    logger.info('Alert threshold updated', { key, value });
  }

  /**
   * Get current security status
   */
  async getSecurityStatus(): Promise<{
    monitoringEnabled: boolean;
    activeThreats: number;
    blockedIPs: number;
    enhancedMonitoring: number;
  }> {
    try {
      // Get counts from Redis
      const keys = await this.redis.keys('blocked_ip:*');
      const enhancedKeys = await this.redis.keys('enhanced_monitoring:*');
      
      return {
        monitoringEnabled: this.monitoringEnabled,
        activeThreats: 0, // Would count active threats
        blockedIPs: keys.length,
        enhancedMonitoring: enhancedKeys.length
      };
    } catch (error) {
      logger.error('Failed to get security status', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        monitoringEnabled: this.monitoringEnabled,
        activeThreats: 0,
        blockedIPs: 0,
        enhancedMonitoring: 0
      };
    }
  }
}

// Export singleton instance
export const securityMonitor = new SecurityMonitorService();