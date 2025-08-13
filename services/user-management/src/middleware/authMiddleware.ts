import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

import { config } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from '@/services/database';
import { RedisService } from '@/services/redis';
import { AuditService } from '@/services/audit';
import { permissionManager } from '@/auth/PermissionManager';
import {
  JWTPayload,
  AuthenticatedRequest,
  AdminRequest,
  User,
  UserSession,
  Permission,
  UserRole,
  SecurityEvent
} from '@/types';

/**
 * Authentication and Security Middleware Collection
 */
export class AuthMiddleware {
  private db: DatabaseService;
  private redis: RedisService;
  private audit: AuditService;
  private rateLimiters: Map<string, RateLimiterRedis>;

  constructor() {
    this.db = new DatabaseService();
    this.redis = new RedisService();
    this.audit = new AuditService();
    this.rateLimiters = new Map();
    this.initializeRateLimiters();
  }

  /**
   * Initialize rate limiters for different endpoints
   */
  private initializeRateLimiters(): void {
    const redisClient = new Redis(config.redis.url);

    // Login rate limiter - 5 attempts per 15 minutes per IP
    this.rateLimiters.set('login', new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_login',
      points: 5,
      duration: 900, // 15 minutes
      blockDuration: 900, // Block for 15 minutes
      execEvenly: true
    }));

    // Registration rate limiter - 3 registrations per hour per IP
    this.rateLimiters.set('register', new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_register',
      points: 3,
      duration: 3600, // 1 hour
      blockDuration: 3600, // Block for 1 hour
      execEvenly: true
    }));

    // MFA verification rate limiter - 10 attempts per 5 minutes per user
    this.rateLimiters.set('mfa', new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_mfa',
      points: 10,
      duration: 300, // 5 minutes
      blockDuration: 300, // Block for 5 minutes
      execEvenly: true
    }));

    // Password reset rate limiter - 3 attempts per hour per IP
    this.rateLimiters.set('password_reset', new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_pwd_reset',
      points: 3,
      duration: 3600, // 1 hour
      blockDuration: 3600, // Block for 1 hour
      execEvenly: true
    }));

    // API rate limiter - 100 requests per minute per user
    this.rateLimiters.set('api', new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_api',
      points: 100,
      duration: 60, // 1 minute
      blockDuration: 60, // Block for 1 minute
      execEvenly: true
    }));
  }

  // ==========================================
  // Authentication Middleware
  // ==========================================

  /**
   * JWT Authentication middleware
   */
  authenticateJWT = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      if (!token) {
        res.status(401).json({
          success: false,
          message: 'Access token required',
          code: 'NO_TOKEN'
        });
        return;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.accessSecret) as JWTPayload;

      // Check if token is blacklisted
      const isBlacklisted = await this.redis.get(`blacklist:${token}`);
      if (isBlacklisted) {
        res.status(401).json({
          success: false,
          message: 'Token has been revoked',
          code: 'TOKEN_REVOKED'
        });
        return;
      }

      // Get user from database
      const user = await this.db.getUserById(decoded.userId);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      // Check if user is active
      if (!user.isActive) {
        res.status(401).json({
          success: false,
          message: 'Account is inactive',
          code: 'ACCOUNT_INACTIVE'
        });
        return;
      }

      // Check if user is locked
      if (user.isLocked) {
        res.status(401).json({
          success: false,
          message: 'Account is locked',
          code: 'ACCOUNT_LOCKED'
        });
        return;
      }

      // Get or create user session
      const session = await this.getOrCreateSession(decoded, req);

      // Attach user and session to request
      (req as AuthenticatedRequest).user = user;
      (req as AuthenticatedRequest).session = session;
      (req as AuthenticatedRequest).permissions = decoded.permissions;

      // Update last activity
      await this.updateLastActivity(session.id);

      next();

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          message: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
        return;
      }

      if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({
          success: false,
          message: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
        return;
      }

      logger.error('JWT authentication failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        path: req.path
      });

      res.status(500).json({
        success: false,
        message: 'Authentication failed',
        code: 'AUTH_ERROR'
      });
    }
  };

  /**
   * Optional authentication - sets user if token is valid, continues if not
   */
  optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        next();
        return;
      }

      const decoded = jwt.verify(token, config.jwt.accessSecret) as JWTPayload;
      const user = await this.db.getUserById(decoded.userId);

      if (user && user.isActive && !user.isLocked) {
        (req as AuthenticatedRequest).user = user;
        (req as AuthenticatedRequest).permissions = decoded.permissions;
      }

      next();
    } catch (error) {
      // For optional auth, we just continue without setting user
      next();
    }
  };

  // ==========================================
  // Permission Middleware
  // ==========================================

  /**
   * Require specific permission
   */
  requirePermission = (permission: Permission, resourceType?: string) => {
    return permissionManager.requirePermission(permission, resourceType);
  };

  /**
   * Require specific role
   */
  requireRole = (role: UserRole | UserRole[]) => {
    return permissionManager.requireRole(role);
  };

  /**
   * Admin-only middleware
   */
  requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
        return;
      }

      if (!['admin', 'system'].includes(req.user.role)) {
        res.status(403).json({
          success: false,
          message: 'Admin privileges required',
          code: 'FORBIDDEN'
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Admin check failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Authorization check failed',
        code: 'AUTH_ERROR'
      });
    }
  };

  // ==========================================
  // Rate Limiting Middleware
  // ==========================================

  /**
   * Create rate limiting middleware
   */
  rateLimit = (type: string, keyGenerator?: (req: Request) => string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rateLimiter = this.rateLimiters.get(type);
        if (!rateLimiter) {
          next();
          return;
        }

        const key = keyGenerator ? keyGenerator(req) : req.ip || 'unknown';
        
        await rateLimiter.consume(key);
        next();

      } catch (rateLimiterRes) {
        const remainingPoints = rateLimiterRes.remainingPoints || 0;
        const msBeforeNext = rateLimiterRes.msBeforeNext || 0;

        res.set({
          'Retry-After': Math.round(msBeforeNext / 1000) || 1,
          'X-RateLimit-Limit': rateLimiterRes.totalHits || 'unknown',
          'X-RateLimit-Remaining': remainingPoints,
          'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString()
        });

        // Log rate limit exceeded
        await this.audit.logSecurityEvent({
          type: 'rate_limit_exceeded',
          severity: 'medium',
          details: {
            type,
            key: req.ip || 'unknown',
            path: req.path,
            userAgent: req.get('User-Agent')
          },
          timestamp: new Date()
        });

        res.status(429).json({
          success: false,
          message: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            retryAfter: Math.round(msBeforeNext / 1000),
            resetTime: new Date(Date.now() + msBeforeNext).toISOString()
          }
        });
      }
    };
  };

  // ==========================================
  // Security Headers Middleware
  // ==========================================

  /**
   * Security headers middleware
   */
  securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
    // Basic security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // HSTS for production
    if (config.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // CSP for API endpoints
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");

    next();
  };

  // ==========================================
  // Session Management
  // ==========================================

  /**
   * Get or create user session
   */
  private async getOrCreateSession(decoded: JWTPayload, req: Request): Promise<UserSession> {
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    // Try to find existing session
    let session = await this.db.getUserSession(decoded.sessionId);

    if (!session || session.expiresAt < new Date()) {
      // Create new session
      session = await this.db.createUserSession({
        userId: decoded.userId,
        sessionId: decoded.sessionId,
        deviceInfo: {
          fingerprint: 'unknown',
          platform: this.extractPlatform(userAgent),
          browser: this.extractBrowser(userAgent),
          version: this.extractVersion(userAgent),
          isMobile: this.isMobileDevice(userAgent),
          isTrusted: false
        },
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + config.security.sessionTimeout)
      });
    }

    return session;
  }

  /**
   * Update session last activity
   */
  private async updateLastActivity(sessionId: string): Promise<void> {
    try {
      await this.db.updateSessionActivity(sessionId);
    } catch (error) {
      logger.error('Failed to update session activity', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Device Detection Helpers
  // ==========================================

  private extractPlatform(userAgent: string): string {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS')) return 'iOS';
    return 'Unknown';
  }

  private extractBrowser(userAgent: string): string {
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  }

  private extractVersion(userAgent: string): string {
    const match = userAgent.match(/(?:Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/);
    return match ? match[1] : 'Unknown';
  }

  private isMobileDevice(userAgent: string): boolean {
    return /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  }

  // ==========================================
  // Anomaly Detection Middleware
  // ==========================================

  /**
   * Anomaly detection middleware
   */
  anomalyDetection = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        next();
        return;
      }

      const ipAddress = req.ip || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      const path = req.path;

      // Check for suspicious patterns
      const anomalies = await this.detectAnomalies(req.user.id, ipAddress, userAgent, path);

      if (anomalies.length > 0) {
        // Log security event
        await this.audit.logSecurityEvent({
          type: 'anomalous_activity',
          severity: this.calculateSeverity(anomalies),
          userId: req.user.id,
          details: {
            anomalies,
            ipAddress,
            userAgent,
            path
          },
          timestamp: new Date()
        });

        // If high-risk, require additional verification
        if (anomalies.some(a => a.severity === 'high')) {
          res.status(403).json({
            success: false,
            message: 'Suspicious activity detected. Additional verification required.',
            code: 'SUSPICIOUS_ACTIVITY',
            details: {
              requiresVerification: true
            }
          });
          return;
        }
      }

      next();

    } catch (error) {
      logger.error('Anomaly detection failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Don't block request on anomaly detection failure
      next();
    }
  };

  /**
   * Detect anomalous patterns in user behavior
   */
  private async detectAnomalies(
    userId: string, 
    ipAddress: string, 
    userAgent: string, 
    path: string
  ): Promise<Array<{ type: string; severity: 'low' | 'medium' | 'high'; details: any }>> {
    const anomalies: Array<{ type: string; severity: 'low' | 'medium' | 'high'; details: any }> = [];

    try {
      // Get user's recent activity
      const recentSessions = await this.db.getRecentUserSessions(userId, 7); // Last 7 days
      
      // Check for unusual IP address
      const knownIPs = recentSessions.map(s => s.ipAddress);
      if (!knownIPs.includes(ipAddress) && knownIPs.length > 0) {
        anomalies.push({
          type: 'new_ip_address',
          severity: 'medium',
          details: { newIP: ipAddress, knownIPs: knownIPs.slice(0, 3) }
        });
      }

      // Check for unusual user agent
      const knownUserAgents = recentSessions.map(s => s.userAgent);
      if (!knownUserAgents.includes(userAgent) && knownUserAgents.length > 0) {
        anomalies.push({
          type: 'new_user_agent',
          severity: 'low',
          details: { newUserAgent: userAgent }
        });
      }

      // Check for unusual activity time
      const currentHour = new Date().getHours();
      const typicalHours = recentSessions
        .map(s => new Date(s.lastActivityAt).getHours())
        .filter((hour, index, arr) => arr.indexOf(hour) === index);
      
      if (typicalHours.length > 0 && !typicalHours.includes(currentHour)) {
        const timeDiff = Math.min(
          ...typicalHours.map(h => Math.abs(h - currentHour))
        );
        
        if (timeDiff > 4) { // More than 4 hours difference
          anomalies.push({
            type: 'unusual_time',
            severity: 'low',
            details: { currentHour, typicalHours }
          });
        }
      }

      // Check for rapid requests from same IP
      const recentRequests = await this.redis.get(`requests:${ipAddress}:${userId}`);
      if (recentRequests && parseInt(recentRequests) > 20) { // More than 20 requests in last minute
        anomalies.push({
          type: 'rapid_requests',
          severity: 'high',
          details: { requestCount: parseInt(recentRequests) }
        });
      }

      // Increment request counter
      await this.redis.setex(`requests:${ipAddress}:${userId}`, 60, 
        recentRequests ? parseInt(recentRequests) + 1 : 1
      );

      return anomalies;

    } catch (error) {
      logger.error('Anomaly detection analysis failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Calculate overall severity based on individual anomalies
   */
  private calculateSeverity(anomalies: Array<{ severity: string }>): 'low' | 'medium' | 'high' | 'critical' {
    if (anomalies.some(a => a.severity === 'high')) return 'high';
    if (anomalies.filter(a => a.severity === 'medium').length >= 2) return 'high';
    if (anomalies.some(a => a.severity === 'medium')) return 'medium';
    return 'low';
  }
}

// Export singleton instance
export const authMiddleware = new AuthMiddleware();

// Export individual middleware functions for easy use
export const authenticateJWT = authMiddleware.authenticateJWT;
export const optionalAuth = authMiddleware.optionalAuth;
export const requirePermission = authMiddleware.requirePermission;
export const requireRole = authMiddleware.requireRole;
export const requireAdmin = authMiddleware.requireAdmin;
export const rateLimit = authMiddleware.rateLimit;
export const securityHeaders = authMiddleware.securityHeaders;
export const anomalyDetection = authMiddleware.anomalyDetection;