/**
 * Comprehensive Security Middleware Collection
 * Provides layered security middleware for Express applications
 * Implements defense-in-depth security strategy
 */

import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { body, validationResult, query, param } from 'express-validator';
import * as xss from 'xss';
import * as hpp from 'hpp';
import sanitizeHtml from 'sanitize-html';
import { CORSManager } from '../api/CORSManager';
import { securityAuditor, SecurityEventType } from '../auth/SecurityAuditor';
import { encryptionService } from '../crypto/EncryptionService';
import { logger } from '../utils/Logger';

export interface SecurityConfig {
  rateLimit: {
    windowMs: number;
    max: number;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
  };
  helmet: {
    contentSecurityPolicy: boolean;
    hsts: boolean;
    noSniff: boolean;
    xssFilter: boolean;
    referrerPolicy: string;
  };
  cors: {
    origins: string[];
    credentials: boolean;
  };
  inputValidation: {
    sanitizeHtml: boolean;
    xssProtection: boolean;
    maxFieldSize: number;
    maxFields: number;
  };
  authentication: {
    requireAuth: boolean;
    requireMFA: boolean;
    sessionTimeout: number;
  };
  audit: {
    logAllRequests: boolean;
    logSensitiveData: boolean;
  };
}

export interface SecurityHeaders {
  'Strict-Transport-Security'?: string;
  'Content-Security-Policy'?: string;
  'X-Content-Type-Options'?: string;
  'X-Frame-Options'?: string;
  'X-XSS-Protection'?: string;
  'Referrer-Policy'?: string;
  'Permissions-Policy'?: string;
  'X-Rate-Limit-Remaining'?: string;
  'X-Rate-Limit-Reset'?: string;
  'X-Security-Score'?: string;
}

export class SecurityMiddleware {
  private static instance: SecurityMiddleware;
  private corsManager: CORSManager;
  private config: SecurityConfig;
  private rateLimitStore: Map<string, any> = new Map();

  private constructor(config?: Partial<SecurityConfig>) {
    this.corsManager = CORSManager.getInstance();
    this.config = this.mergeConfig(config);
  }

  public static getInstance(config?: Partial<SecurityConfig>): SecurityMiddleware {
    if (!SecurityMiddleware.instance) {
      SecurityMiddleware.instance = new SecurityMiddleware(config);
    }
    return SecurityMiddleware.instance;
  }

  /**
   * Create complete security middleware stack
   */
  public createSecurityStack(): Array<(req: Request, res: Response, next: NextFunction) => void> {
    return [
      this.createSecurityHeaders(),
      this.createRateLimiting(),
      this.createCORSMiddleware(),
      this.createInputSanitization(),
      this.createRequestValidation(),
      this.createThreatDetection(),
      this.createAuditLogging(),
      this.createErrorHandling()
    ];
  }

  /**
   * Security headers middleware (Helmet configuration)
   */
  public createSecurityHeaders(): (req: Request, res: Response, next: NextFunction) => void {
    const helmetOptions = {
      contentSecurityPolicy: this.config.helmet.contentSecurityPolicy ? {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          workerSrc: ["'self'"],
          upgradeInsecureRequests: []
        }
      } : false,
      
      hsts: this.config.helmet.hsts ? {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
      } : false,
      
      noSniff: this.config.helmet.noSniff,
      
      xssFilter: this.config.helmet.xssFilter,
      
      referrerPolicy: {
        policy: this.config.helmet.referrerPolicy as any
      },
      
      // Additional security headers
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
        usb: [],
        fullscreen: ["'self'"]
      }
    };

    const helmetMiddleware = helmet(helmetOptions);

    return (req: Request, res: Response, next: NextFunction) => {
      // Add custom security headers
      const customHeaders: SecurityHeaders = {
        'X-Security-Score': this.calculateRequestSecurityScore(req).toString(),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      };

      Object.entries(customHeaders).forEach(([header, value]) => {
        if (value) {
          res.setHeader(header, value);
        }
      });

      // Apply helmet
      helmetMiddleware(req, res, next);
    };
  }

  /**
   * Advanced rate limiting middleware
   */
  public createRateLimiting(): (req: Request, res: Response, next: NextFunction) => void {
    const standardLimiter = rateLimit({
      windowMs: this.config.rateLimit.windowMs,
      max: this.config.rateLimit.max,
      skipSuccessfulRequests: this.config.rateLimit.skipSuccessfulRequests,
      skipFailedRequests: this.config.rateLimit.skipFailedRequests,
      
      // Custom key generator based on IP and user
      keyGenerator: (req: Request) => {
        const userId = req.headers['x-user-id'] as string;
        const ip = this.extractIPAddress(req);
        return userId ? `${userId}:${ip}` : ip;
      },
      
      // Custom skip function
      skip: (req: Request) => {
        const ip = this.extractIPAddress(req);
        const ipReputation = securityAuditor.checkIPReputation(ip);
        return ipReputation.trustLevel === 'high';
      },
      
      // Custom handler for rate limit exceeded
      handler: async (req: Request, res: Response) => {
        await securityAuditor.logSecurityEvent(
          SecurityEventType.API_ABUSE,
          req,
          { rateLimitExceeded: true },
          'blocked'
        );
        
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil(this.config.rateLimit.windowMs / 1000)
        });
      },
      
      // Add rate limit headers
      standardHeaders: true,
      legacyHeaders: false
    });

    // Special handling for authentication endpoints
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // Limit each IP to 5 requests per windowMs
      skipSuccessfulRequests: true
    });

    return (req: Request, res: Response, next: NextFunction) => {
      // Apply stricter limits to auth endpoints
      if (req.path.includes('/auth/') || req.path.includes('/login')) {
        return authLimiter(req, res, next);
      }
      
      return standardLimiter(req, res, next);
    };
  }

  /**
   * CORS middleware with enhanced security
   */
  public createCORSMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    return this.corsManager.createMiddleware({
      origins: this.config.cors.origins,
      credentials: this.config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Client-ID',
        'X-Device-Fingerprint',
        'X-CSRF-Token'
      ]
    });
  }

  /**
   * Input sanitization middleware
   */
  public createInputSanitization(): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Sanitize query parameters
        if (req.query) {
          req.query = this.sanitizeObject(req.query);
        }

        // Sanitize request body
        if (req.body) {
          req.body = this.sanitizeObject(req.body);
        }

        // Sanitize URL parameters
        if (req.params) {
          req.params = this.sanitizeObject(req.params);
        }

        // Log sanitization if sensitive data was found
        const sanitizationApplied = req.headers['x-sanitization-applied'];
        if (sanitizationApplied) {
          await securityAuditor.logSecurityEvent(
            SecurityEventType.SUSPICIOUS_ACTIVITY,
            req,
            { sanitizationApplied: true }
          );
        }

        next();
      } catch (error) {
        logger.error('Input sanitization failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          path: req.path
        });
        next(error);
      }
    };
  }

  /**
   * Request validation middleware
   */
  public createRequestValidation(): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Check request size
        const contentLength = parseInt(req.headers['content-length'] || '0');
        if (contentLength > this.config.inputValidation.maxFieldSize) {
          await securityAuditor.logSecurityEvent(
            SecurityEventType.SUSPICIOUS_ACTIVITY,
            req,
            { oversizedRequest: true, contentLength },
            'blocked'
          );
          
          return res.status(413).json({ error: 'Request entity too large' });
        }

        // Validate content type for POST/PUT requests
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const contentType = req.headers['content-type'];
          if (!contentType || !this.isValidContentType(contentType)) {
            await securityAuditor.logSecurityEvent(
              SecurityEventType.SUSPICIOUS_ACTIVITY,
              req,
              { invalidContentType: contentType },
              'blocked'
            );
            
            return res.status(415).json({ error: 'Unsupported Media Type' });
          }
        }

        // Check for required security headers
        const requiredHeaders = ['user-agent'];
        for (const header of requiredHeaders) {
          if (!req.headers[header]) {
            await securityAuditor.logSecurityEvent(
              SecurityEventType.SUSPICIOUS_ACTIVITY,
              req,
              { missingHeader: header },
              'blocked'
            );
            
            return res.status(400).json({ error: 'Missing required headers' });
          }
        }

        next();
      } catch (error) {
        logger.error('Request validation failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          path: req.path
        });
        next(error);
      }
    };
  }

  /**
   * Threat detection middleware
   */
  public createThreatDetection(): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Scan for threats
        const threatResult = await securityAuditor.scanForThreats(req);
        
        if (threatResult.hasThreats) {
          const action = threatResult.recommendedAction;
          
          if (action === 'block') {
            return res.status(403).json({ 
              error: 'Request blocked due to security policy',
              threatId: this.generateThreatId()
            });
          } else if (action === 'monitor') {
            // Continue but increase monitoring
            res.setHeader('X-Security-Monitor', 'true');
          }
        }

        // Check anomalies for authenticated users
        const userId = req.headers['x-user-id'] as string;
        if (userId) {
          const hasAnomalies = await securityAuditor.detectAnomalies(userId, req);
          if (hasAnomalies) {
            res.setHeader('X-Anomaly-Detected', 'true');
          }
        }

        next();
      } catch (error) {
        logger.error('Threat detection failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          path: req.path
        });
        next(); // Continue on detection error
      }
    };
  }

  /**
   * Audit logging middleware
   */
  public createAuditLogging(): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      // Override res.end to capture response
      const originalEnd = res.end;
      let responseData = '';
      
      res.end = function(chunk?: any) {
        if (chunk) {
          responseData = chunk.toString();
        }
        originalEnd.call(this, chunk);
      };

      // Continue with request
      res.on('finish', async () => {
        try {
          const responseTime = Date.now() - startTime;
          const shouldLog = this.shouldLogRequest(req, res);
          
          if (shouldLog) {
            await securityAuditor.logSecurityEvent(
              this.getEventTypeFromRequest(req, res),
              req,
              {
                responseStatus: res.statusCode,
                responseTime,
                userAgent: req.headers['user-agent'],
                responseSize: responseData.length
              },
              res.statusCode >= 400 ? 'failure' : 'success'
            );
          }
        } catch (error) {
          logger.error('Audit logging failed', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      });

      next();
    };
  }

  /**
   * Security error handling middleware
   */
  public createErrorHandling(): (error: any, req: Request, res: Response, next: NextFunction) => void {
    return async (error: any, req: Request, res: Response, next: NextFunction) => {
      try {
        // Log security-related errors
        await securityAuditor.logSecurityEvent(
          SecurityEventType.SUSPICIOUS_ACTIVITY,
          req,
          {
            error: error.message,
            stack: error.stack,
            type: error.constructor.name
          },
          'failure'
        );

        // Don't leak sensitive error information
        const safeError = this.sanitizeError(error);
        
        res.status(500).json({
          error: 'Internal server error',
          errorId: this.generateErrorId(),
          timestamp: Date.now()
        });
      } catch (auditError) {
        logger.error('Security error handling failed', {
          originalError: error.message,
          auditError: auditError instanceof Error ? auditError.message : 'Unknown error'
        });
        
        res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  /**
   * Create authentication middleware
   */
  public createAuthenticationMiddleware(options: { requireMFA?: boolean } = {}): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Check for authentication token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          await securityAuditor.logSecurityEvent(
            SecurityEventType.UNAUTHORIZED_ACCESS,
            req,
            { missingToken: true },
            'blocked'
          );
          
          return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.substring(7);
        
        // Validate token (implement your JWT validation logic)
        const isValidToken = await this.validateAuthToken(token);
        if (!isValidToken) {
          await securityAuditor.logSecurityEvent(
            SecurityEventType.TOKEN_MANIPULATION,
            req,
            { invalidToken: true },
            'blocked'
          );
          
          return res.status(401).json({ error: 'Invalid token' });
        }

        // Extract user information from token
        const userInfo = await this.extractUserFromToken(token);
        req.headers['x-user-id'] = userInfo.userId;
        req.headers['x-user-role'] = userInfo.role;

        // Check MFA if required
        if (options.requireMFA && !userInfo.mfaVerified) {
          await securityAuditor.logSecurityEvent(
            SecurityEventType.MFA_FAILURE,
            req,
            { mfaRequired: true },
            'blocked'
          );
          
          return res.status(403).json({ error: 'MFA verification required' });
        }

        next();
      } catch (error) {
        logger.error('Authentication middleware failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        res.status(500).json({ error: 'Authentication error' });
      }
    };
  }

  // Private helper methods

  private mergeConfig(config?: Partial<SecurityConfig>): SecurityConfig {
    const defaultConfig: SecurityConfig = {
      rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100,
        skipSuccessfulRequests: false,
        skipFailedRequests: false
      },
      helmet: {
        contentSecurityPolicy: true,
        hsts: true,
        noSniff: true,
        xssFilter: true,
        referrerPolicy: 'strict-origin-when-cross-origin'
      },
      cors: {
        origins: ['http://localhost:3000'],
        credentials: true
      },
      inputValidation: {
        sanitizeHtml: true,
        xssProtection: true,
        maxFieldSize: 1024 * 1024, // 1MB
        maxFields: 100
      },
      authentication: {
        requireAuth: true,
        requireMFA: false,
        sessionTimeout: 30 * 60 * 1000 // 30 minutes
      },
      audit: {
        logAllRequests: false,
        logSensitiveData: false
      }
    };

    return { ...defaultConfig, ...config };
  }

  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeValue(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = this.sanitizeObject(value);
    }

    return sanitized;
  }

  private sanitizeValue(value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    let sanitized = value;

    if (this.config.inputValidation.xssProtection) {
      sanitized = xss(sanitized);
    }

    if (this.config.inputValidation.sanitizeHtml) {
      sanitized = sanitizeHtml(sanitized, {
        allowedTags: [],
        allowedAttributes: {}
      });
    }

    return sanitized;
  }

  private calculateRequestSecurityScore(req: Request): number {
    let score = 10; // Start with perfect score

    // Deduct points for various risk factors
    const userAgent = req.headers['user-agent'];
    if (!userAgent || userAgent.length < 10) {
      score -= 2;
    }

    const origin = req.headers.origin;
    if (!origin) {
      score -= 1;
    }

    const ip = this.extractIPAddress(req);
    const ipReputation = securityAuditor.checkIPReputation(ip);
    if (ipReputation.isSuspicious) {
      score -= 3;
    }

    return Math.max(0, score);
  }

  private extractIPAddress(req: Request): string {
    return (req.headers['x-forwarded-for'] as string) ||
           (req.headers['x-real-ip'] as string) ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           '0.0.0.0';
  }

  private isValidContentType(contentType: string): boolean {
    const allowedTypes = [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain'
    ];

    return allowedTypes.some(type => contentType.startsWith(type));
  }

  private shouldLogRequest(req: Request, res: Response): boolean {
    if (this.config.audit.logAllRequests) {
      return true;
    }

    // Log security-relevant requests
    const securityPaths = ['/auth', '/login', '/admin', '/api'];
    const isSecurityPath = securityPaths.some(path => req.path.startsWith(path));

    // Log failed requests
    const isFailure = res.statusCode >= 400;

    // Log high-risk requests
    const ip = this.extractIPAddress(req);
    const ipReputation = securityAuditor.checkIPReputation(ip);
    const isHighRisk = ipReputation.isSuspicious;

    return isSecurityPath || isFailure || isHighRisk;
  }

  private getEventTypeFromRequest(req: Request, res: Response): SecurityEventType {
    if (req.path.includes('/auth') || req.path.includes('/login')) {
      return res.statusCode >= 400 ? SecurityEventType.LOGIN_FAILURE : SecurityEventType.LOGIN_ATTEMPT;
    }

    if (res.statusCode === 401 || res.statusCode === 403) {
      return SecurityEventType.UNAUTHORIZED_ACCESS;
    }

    if (res.statusCode === 429) {
      return SecurityEventType.API_ABUSE;
    }

    return SecurityEventType.DATA_ACCESS;
  }

  private sanitizeError(error: any): any {
    return {
      message: 'An error occurred',
      type: 'ApplicationError'
    };
  }

  private generateThreatId(): string {
    return `threat_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private async validateAuthToken(token: string): Promise<boolean> {
    try {
      const { JWTManager } = await import('../auth/JWTManager');
      const jwtManager = JWTManager.getInstance();
      
      const payload = await jwtManager.verifyAccessToken(token);
      return !!payload;
    } catch {
      return false;
    }
  }

  private async extractUserFromToken(token: string): Promise<any> {
    try {
      const { JWTManager } = await import('../auth/JWTManager');
      const jwtManager = JWTManager.getInstance();
      
      const payload = await jwtManager.verifyAccessToken(token);
      return {
        userId: payload.userId,
        role: payload.roles?.[0] || 'user',
        mfaVerified: payload.mfaVerified || false,
        sessionId: payload.sessionId,
        permissions: payload.permissions || []
      };
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const securityMiddleware = SecurityMiddleware.getInstance();