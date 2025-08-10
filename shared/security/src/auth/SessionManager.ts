/**
 * Session Manager
 * Manages user sessions, device fingerprinting, and session security
 */

import crypto from 'crypto';
import { UserSession, DeviceInfo, User } from '../types';
import { logger } from '../utils/Logger';

export class SessionManager {
  private static instance: SessionManager;
  
  // In-memory session storage (use Redis in production)
  private sessions: Map<string, UserSession> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();
  private deviceFingerprints: Map<string, DeviceInfo> = new Map();
  
  private readonly SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_SESSIONS_PER_USER = 5;
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  
  private constructor() {
    // Start cleanup interval
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000); // Every 5 minutes
  }
  
  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }
  
  /**
   * Create new session
   */
  public async createSession(
    user: User,
    ipAddress: string,
    userAgent: string,
    deviceFingerprint?: string
  ): Promise<UserSession> {
    try {
      // Check session limit
      await this.enforceSessionLimit(user.id);
      
      const sessionId = this.generateSessionId();
      
      // Process device info
      const deviceInfo = deviceFingerprint
        ? await this.processDeviceFingerprint(deviceFingerprint, userAgent)
        : undefined;
      
      const session: UserSession = {
        sessionId,
        userId: user.id,
        deviceInfo,
        ipAddress,
        userAgent,
        isActive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.SESSION_DURATION),
        lastActivityAt: new Date()
      };
      
      // Store session
      this.sessions.set(sessionId, session);
      
      // Track user sessions
      if (!this.userSessions.has(user.id)) {
        this.userSessions.set(user.id, new Set());
      }
      this.userSessions.get(user.id)!.add(sessionId);
      
      logger.info('Session created', {
        sessionId,
        userId: user.id,
        ipAddress: this.maskIP(ipAddress),
        deviceTrusted: deviceInfo?.isTrusted
      });
      
      return session;
    } catch (error) {
      logger.error('Failed to create session', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Get session
   */
  public getSession(sessionId: string): UserSession | null {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return null;
    }
    
    // Check if session is expired
    if (session.expiresAt < new Date()) {
      this.destroySession(sessionId);
      return null;
    }
    
    // Check idle timeout
    const idleTime = Date.now() - session.lastActivityAt.getTime();
    if (idleTime > this.IDLE_TIMEOUT) {
      logger.warn('Session idle timeout', { sessionId });
      this.destroySession(sessionId);
      return null;
    }
    
    return session;
  }
  
  /**
   * Update session activity
   */
  public updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    
    if (session && session.isActive) {
      session.lastActivityAt = new Date();
      
      // Extend session if needed
      const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
      if (timeUntilExpiry < this.SESSION_DURATION / 2) {
        session.expiresAt = new Date(Date.now() + this.SESSION_DURATION);
        logger.debug('Session extended', { sessionId });
      }
    }
  }
  
  /**
   * Validate session
   */
  public async validateSession(
    sessionId: string,
    ipAddress?: string,
    userAgent?: string,
    deviceFingerprint?: string
  ): Promise<boolean> {
    try {
      const session = this.getSession(sessionId);
      
      if (!session || !session.isActive) {
        logger.warn('Invalid or inactive session', { sessionId });
        return false;
      }
      
      // Validate IP address (optional strict mode)
      if (ipAddress && process.env.STRICT_IP_VALIDATION === 'true') {
        if (session.ipAddress !== ipAddress) {
          logger.warn('Session IP mismatch', {
            sessionId,
            expected: this.maskIP(session.ipAddress),
            actual: this.maskIP(ipAddress)
          });
          
          // Potential session hijacking
          await this.handleSuspiciousActivity(sessionId, 'ip_mismatch');
          return false;
        }
      }
      
      // Validate user agent
      if (userAgent && session.userAgent) {
        if (!this.isUserAgentSimilar(session.userAgent, userAgent)) {
          logger.warn('Session user agent mismatch', { sessionId });
          await this.handleSuspiciousActivity(sessionId, 'useragent_mismatch');
          return false;
        }
      }
      
      // Validate device fingerprint
      if (deviceFingerprint && session.deviceInfo) {
        if (session.deviceInfo.fingerprint !== deviceFingerprint) {
          logger.warn('Device fingerprint mismatch', { sessionId });
          await this.handleSuspiciousActivity(sessionId, 'device_mismatch');
          return false;
        }
      }
      
      // Update activity
      this.updateSessionActivity(sessionId);
      
      return true;
    } catch (error) {
      logger.error('Session validation failed', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Destroy session
   */
  public destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      // Remove from user sessions
      const userSessionSet = this.userSessions.get(session.userId);
      if (userSessionSet) {
        userSessionSet.delete(sessionId);
        if (userSessionSet.size === 0) {
          this.userSessions.delete(session.userId);
        }
      }
      
      // Remove session
      this.sessions.delete(sessionId);
      
      logger.info('Session destroyed', {
        sessionId,
        userId: session.userId
      });
    }
  }
  
  /**
   * Destroy all user sessions
   */
  public destroyAllUserSessions(userId: string): void {
    const sessionIds = this.userSessions.get(userId);
    
    if (sessionIds) {
      for (const sessionId of sessionIds) {
        this.sessions.delete(sessionId);
      }
      this.userSessions.delete(userId);
      
      logger.info('All user sessions destroyed', {
        userId,
        count: sessionIds.size
      });
    }
  }
  
  /**
   * Get user sessions
   */
  public getUserSessions(userId: string): UserSession[] {
    const sessionIds = this.userSessions.get(userId);
    
    if (!sessionIds) {
      return [];
    }
    
    const sessions: UserSession[] = [];
    
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        sessions.push(session);
      }
    }
    
    return sessions;
  }
  
  /**
   * Process device fingerprint
   */
  private async processDeviceFingerprint(
    fingerprint: string,
    userAgent: string
  ): Promise<DeviceInfo> {
    // Check if device is known
    let deviceInfo = this.deviceFingerprints.get(fingerprint);
    
    if (!deviceInfo) {
      // Parse user agent for device info
      const { type, os, browser } = this.parseUserAgent(userAgent);
      
      deviceInfo = {
        fingerprint,
        type,
        os,
        browser,
        isTrusted: false // New devices are not trusted by default
      };
      
      this.deviceFingerprints.set(fingerprint, deviceInfo);
      
      logger.info('New device registered', {
        fingerprint: this.hashFingerprint(fingerprint),
        type,
        os
      });
    }
    
    return deviceInfo;
  }
  
  /**
   * Mark device as trusted
   */
  public trustDevice(fingerprint: string): void {
    const deviceInfo = this.deviceFingerprints.get(fingerprint);
    
    if (deviceInfo) {
      deviceInfo.isTrusted = true;
      logger.info('Device marked as trusted', {
        fingerprint: this.hashFingerprint(fingerprint)
      });
    }
  }
  
  /**
   * Enforce session limit per user
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    const sessionIds = this.userSessions.get(userId);
    
    if (sessionIds && sessionIds.size >= this.MAX_SESSIONS_PER_USER) {
      // Remove oldest session
      let oldestSession: UserSession | null = null;
      let oldestSessionId: string | null = null;
      
      for (const sessionId of sessionIds) {
        const session = this.sessions.get(sessionId);
        if (session && (!oldestSession || session.createdAt < oldestSession.createdAt)) {
          oldestSession = session;
          oldestSessionId = sessionId;
        }
      }
      
      if (oldestSessionId) {
        this.destroySession(oldestSessionId);
        logger.info('Oldest session removed due to limit', {
          userId,
          sessionId: oldestSessionId
        });
      }
    }
  }
  
  /**
   * Handle suspicious activity
   */
  private async handleSuspiciousActivity(
    sessionId: string,
    reason: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      // Mark session as potentially compromised
      session.isActive = false;
      
      logger.warn('Suspicious session activity detected', {
        sessionId,
        userId: session.userId,
        reason,
        ipAddress: this.maskIP(session.ipAddress)
      });
      
      // In production, trigger security alerts
      // await this.securityAlertService.notify(...)
    }
  }
  
  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.destroySession(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info('Expired sessions cleaned', { count: cleaned });
    }
  }
  
  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `sess_${crypto.randomBytes(24).toString('hex')}`;
  }
  
  /**
   * Parse user agent
   */
  private parseUserAgent(userAgent: string): {
    type: string;
    os: string;
    browser?: string;
  } {
    // Simple parsing - use proper UA parser in production
    let type = 'unknown';
    let os = 'unknown';
    let browser: string | undefined;
    
    if (userAgent.includes('Mobile')) {
      type = 'mobile';
    } else if (userAgent.includes('Tablet')) {
      type = 'tablet';
    } else {
      type = 'desktop';
    }
    
    if (userAgent.includes('Windows')) {
      os = 'Windows';
    } else if (userAgent.includes('Mac')) {
      os = 'macOS';
    } else if (userAgent.includes('Linux')) {
      os = 'Linux';
    } else if (userAgent.includes('Android')) {
      os = 'Android';
    } else if (userAgent.includes('iOS')) {
      os = 'iOS';
    }
    
    if (userAgent.includes('Chrome')) {
      browser = 'Chrome';
    } else if (userAgent.includes('Firefox')) {
      browser = 'Firefox';
    } else if (userAgent.includes('Safari')) {
      browser = 'Safari';
    } else if (userAgent.includes('Edge')) {
      browser = 'Edge';
    }
    
    return { type, os, browser };
  }
  
  /**
   * Check if user agents are similar
   */
  private isUserAgentSimilar(ua1: string, ua2: string): boolean {
    // Extract major browser and OS versions
    const extract = (ua: string) => {
      const parts = ua.split(/[\s\/\(\)]+/);
      return parts.filter(p => p.length > 0).slice(0, 5).join(' ');
    };
    
    const normalized1 = extract(ua1);
    const normalized2 = extract(ua2);
    
    // Allow minor version differences
    return normalized1.startsWith(normalized2.substring(0, 20)) ||
           normalized2.startsWith(normalized1.substring(0, 20));
  }
  
  /**
   * Mask IP address for logging
   */
  private maskIP(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    // IPv6
    const v6Parts = ip.split(':');
    if (v6Parts.length > 4) {
      return `${v6Parts[0]}:${v6Parts[1]}:xxxx:xxxx`;
    }
    return 'xxx.xxx.xxx.xxx';
  }
  
  /**
   * Hash fingerprint for logging
   */
  private hashFingerprint(fingerprint: string): string {
    return crypto
      .createHash('sha256')
      .update(fingerprint)
      .digest('hex')
      .substring(0, 8);
  }
  
  /**
   * Get session statistics
   */
  public getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    uniqueUsers: number;
    averageSessionDuration: number;
  } {
    let activeSessions = 0;
    let totalDuration = 0;
    
    for (const session of this.sessions.values()) {
      if (session.isActive) {
        activeSessions++;
      }
      totalDuration += session.lastActivityAt.getTime() - session.createdAt.getTime();
    }
    
    return {
      totalSessions: this.sessions.size,
      activeSessions,
      uniqueUsers: this.userSessions.size,
      averageSessionDuration: this.sessions.size > 0 
        ? totalDuration / this.sessions.size 
        : 0
    };
  }
}