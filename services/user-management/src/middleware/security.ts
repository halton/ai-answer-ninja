import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { RedisService } from '@/services/redis';
import { AuditService } from '@/services/audit';
import { logger } from '@/utils/logger';
import { ApiResponse, AuthenticatedRequest } from '@/types';

const redis = new RedisService();
const audit = new AuditService();

// ==========================================
// Rate Limiting Middleware
// ==========================================

/**
 * General API rate limiting
 */
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    errors: [{
      field: 'request',
      message: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED'
    }]
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Consider both IP and user ID for authenticated requests
    const userKey = (req as AuthenticatedRequest).user?.id || '';
    return `${req.ip}:${userKey}`;
  },
  skip: (req: Request): boolean => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/health/deep';
  }
});

/**
 * Strict rate limiting for authentication endpoints
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit auth attempts
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    errors: [{
      field: 'auth',
      message: 'Authentication rate limit exceeded',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    }]
  },
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request): string => req.ip
});

/**
 * Very strict rate limiting for password reset
 */
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 password reset attempts per hour
  message: {
    success: false,
    message: 'Too many password reset attempts, please try again later.',
    errors: [{
      field: 'password_reset',
      message: 'Password reset rate limit exceeded',
      code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED'
    }]
  },
  keyGenerator: (req: Request): string => {
    // Rate limit by both IP and email
    const email = req.body?.email || '';
    return `${req.ip}:${email}`;
  }
});

/**
 * Redis-based distributed rate limiting
 */
export const distributedRateLimit = (
  keyPrefix: string,
  maxRequests: number,
  windowSeconds: number,
  message?: string
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `${keyPrefix}:${req.ip}`;
      const { allowed, remaining, resetTime } = await redis.checkRateLimit(
        key,
        maxRequests,
        windowSeconds
      );

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(resetTime.getTime() / 1000).toString()
      });

      if (!allowed) {
        const response: ApiResponse = {
          success: false,
          message: message || 'Rate limit exceeded',
          errors: [{
            field: 'request',
            message: `Rate limit exceeded. Try again in ${Math.ceil((resetTime.getTime() - Date.now()) / 1000)} seconds`,
            code: 'RATE_LIMIT_EXCEEDED'
          }]
        };

        // Log rate limit violation
        await audit.logSecurityEvent({
          type: 'failed_login',
          severity: 'medium',
          details: {
            type: 'rate_limit_exceeded',
            keyPrefix,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          },
          timestamp: new Date()
        });

        res.status(429).json(response);
        return;
      }

      next();
    } catch (error) {
      logger.error('Distributed rate limit error', {
        keyPrefix,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // On error, allow the request to continue
      next();
    }
  };
};

// ==========================================
// Security Headers and Helmet Configuration
// ==========================================

/**
 * Comprehensive security headers using Helmet
 */
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for development
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // Prevent MIME type sniffing
  noSniff: true,
  
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  
  // XSS Protection
  xssFilter: true,
  
  // Referrer Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  
  // Permissions Policy
  permissionsPolicy: {
    features: {
      geolocation: ["'none'"],
      microphone: ["'none'"],
      camera: ["'none'"],
      payment: ["'none'"],
      usb: ["'none'"]
    }
  }
});

// ==========================================
// Input Validation and Sanitization
// ==========================================

/**
 * Prevent NoSQL injection attacks
 */
export const preventNoSQLInjection = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const sanitizeObject = (obj: any): any => {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (key.startsWith('$') || key.includes('.')) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          obj[key] = sanitizeObject(obj[key]);
        }
      }
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

/**
 * Detect and prevent parameter pollution
 */
export const preventParameterPollution = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const checkPollution = (obj: any): boolean => {
    for (const key in obj) {
      if (Array.isArray(obj[key]) && obj[key].length > 10) {
        return true; // Potential parameter pollution
      }
    }
    return false;
  };

  if (checkPollution(req.query) || checkPollution(req.body)) {
    const response: ApiResponse = {
      success: false,
      message: 'Parameter pollution detected',
      errors: [{
        field: 'request',
        message: 'Suspicious parameter structure detected',
        code: 'PARAMETER_POLLUTION'
      }]
    };

    // Log security event
    audit.logSecurityEvent({
      type: 'suspicious_activity',
      severity: 'medium',
      details: {
        type: 'parameter_pollution',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path
      },
      timestamp: new Date()
    });

    res.status(400).json(response);
    return;
  }

  next();
};

// ==========================================
// IP and Geographic Restrictions
// ==========================================

/**
 * IP whitelist/blacklist middleware
 */
export const ipFilter = (options: {
  whitelist?: string[];
  blacklist?: string[];
  message?: string;
}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIP = req.ip;
    
    // Check blacklist first
    if (options.blacklist && options.blacklist.includes(clientIP)) {
      const response: ApiResponse = {
        success: false,
        message: options.message || 'Access denied',
        errors: [{
          field: 'ip',
          message: 'Your IP address is blocked',
          code: 'IP_BLOCKED'
        }]
      };

      // Log blocked access attempt
      audit.logSecurityEvent({
        type: 'failed_login',
        severity: 'high',
        details: {
          type: 'ip_blocked',
          ipAddress: clientIP,
          userAgent: req.get('User-Agent'),
          path: req.path
        },
        timestamp: new Date()
      });

      res.status(403).json(response);
      return;
    }
    
    // Check whitelist if provided
    if (options.whitelist && !options.whitelist.includes(clientIP)) {
      const response: ApiResponse = {
        success: false,
        message: options.message || 'Access denied',
        errors: [{
          field: 'ip',
          message: 'Your IP address is not authorized',
          code: 'IP_NOT_AUTHORIZED'
        }]
      };

      res.status(403).json(response);
      return;
    }

    next();
  };
};

/**
 * Geographic restrictions (simplified example)
 */
export const geoFilter = (options: {
  allowedCountries?: string[];
  blockedCountries?: string[];
}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // In a real implementation, you would use a geolocation service
      // For now, this is a placeholder
      
      const country = req.headers['cf-ipcountry'] as string || 'unknown';
      
      if (options.blockedCountries && options.blockedCountries.includes(country)) {
        const response: ApiResponse = {
          success: false,
          message: 'Access denied from your location',
          errors: [{
            field: 'location',
            message: 'Service not available in your country',
            code: 'LOCATION_BLOCKED'
          }]
        };

        res.status(403).json(response);
        return;
      }

      next();
    } catch (error) {
      // On error, allow the request
      next();
    }
  };
};

// ==========================================
// Device and User Agent Validation
// ==========================================

/**
 * Validate user agent to detect bots and suspicious clients
 */
export const validateUserAgent = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const userAgent = req.get('User-Agent') || '';
  
  // Block empty user agents
  if (!userAgent.trim()) {
    const response: ApiResponse = {
      success: false,
      message: 'Invalid client',
      errors: [{
        field: 'user_agent',
        message: 'User agent is required',
        code: 'INVALID_USER_AGENT'
      }]
    };

    res.status(400).json(response);
    return;
  }

  // Block known bot user agents (simplified)
  const suspiciousPatterns = [
    /curl/i,
    /wget/i,
    /python/i,
    /bot/i,
    /crawler/i,
    /spider/i
  ];

  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));
  
  if (isSuspicious) {
    // Log suspicious user agent
    audit.logSecurityEvent({
      type: 'suspicious_activity',
      severity: 'low',
      details: {
        type: 'suspicious_user_agent',
        userAgent,
        ipAddress: req.ip,
        path: req.path
      },
      timestamp: new Date()
    });

    // Could block or just log for now
    logger.warn('Suspicious user agent detected', {
      userAgent,
      ip: req.ip,
      path: req.path
    });
  }

  next();
};

/**
 * Device fingerprint validation
 */
export const validateDeviceFingerprint = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const fingerprint = req.headers['x-device-fingerprint'] as string;
  
  if (req.user && !fingerprint) {
    logger.warn('Missing device fingerprint for authenticated request', {
      userId: req.user.id,
      ip: req.ip,
      path: req.path
    });
  }

  // Store fingerprint for future validation
  if (fingerprint) {
    (req as any).deviceFingerprint = fingerprint;
  }

  next();
};

// ==========================================
// Brute Force Protection
// ==========================================

/**
 * Advanced brute force protection
 */
export const bruteForcePrevention = (options: {
  windowMs?: number;
  maxAttempts?: number;
  blockDuration?: number;
  skipSuccessfulRequests?: boolean;
}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxAttempts = 5,
    blockDuration = 60 * 60 * 1000, // 1 hour
    skipSuccessfulRequests = true
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `brute_force:${req.ip}`;
      const blockKey = `blocked:${req.ip}`;

      // Check if IP is currently blocked
      const isBlocked = await redis.exists(blockKey);
      if (isBlocked) {
        const ttl = await redis.ttl(blockKey);
        const response: ApiResponse = {
          success: false,
          message: 'IP temporarily blocked due to suspicious activity',
          errors: [{
            field: 'ip',
            message: `Blocked for ${Math.ceil(ttl / 60)} more minutes`,
            code: 'IP_BLOCKED'
          }]
        };

        res.status(429).json(response);
        return;
      }

      // Track attempt
      const attempts = await redis.incr(key);
      
      if (attempts === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }

      // Check if max attempts exceeded
      if (attempts > maxAttempts) {
        // Block IP
        await redis.setex(blockKey, Math.ceil(blockDuration / 1000), 'blocked');
        
        // Log security event
        await audit.logSecurityEvent({
          type: 'failed_login',
          severity: 'high',
          details: {
            type: 'brute_force_detected',
            attempts,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            blockDuration: blockDuration / 1000
          },
          timestamp: new Date()
        });

        const response: ApiResponse = {
          success: false,
          message: 'Too many failed attempts. IP blocked.',
          errors: [{
            field: 'security',
            message: `IP blocked for ${blockDuration / 60000} minutes due to suspicious activity`,
            code: 'BRUTE_FORCE_DETECTED'
          }]
        };

        res.status(429).json(response);
        return;
      }

      // Store attempt count for cleanup on success
      (req as any).attemptKey = key;
      (req as any).skipSuccessfulCleanup = !skipSuccessfulRequests;

      next();
    } catch (error) {
      logger.error('Brute force prevention error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // On error, allow the request
      next();
    }
  };
};

/**
 * Clean up brute force tracking on successful requests
 */
export const cleanupBruteForceTracking = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Override res.json to detect successful responses
  const originalJson = res.json;
  res.json = function(data: any) {
    // Clean up on successful authentication
    if (data?.success && (req as any).attemptKey && !(req as any).skipSuccessfulCleanup) {
      redis.delete((req as any).attemptKey).catch(error => {
        logger.error('Failed to cleanup brute force tracking', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }
    
    return originalJson.call(this, data);
  };

  next();
};

// ==========================================
// Request Size and Content Validation
// ==========================================

/**
 * Validate request content type
 */
export const validateContentType = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.get('Content-Type');
    
    if (req.method !== 'GET' && req.method !== 'DELETE' && contentType) {
      const isValidType = allowedTypes.some(type => 
        contentType.toLowerCase().includes(type.toLowerCase())
      );
      
      if (!isValidType) {
        const response: ApiResponse = {
          success: false,
          message: 'Unsupported content type',
          errors: [{
            field: 'content_type',
            message: `Content type must be one of: ${allowedTypes.join(', ')}`,
            code: 'INVALID_CONTENT_TYPE'
          }]
        };

        res.status(415).json(response);
        return;
      }
    }

    next();
  };
};

// Export all middleware functions
export {
  generalRateLimit,
  authRateLimit,
  passwordResetRateLimit,
  distributedRateLimit,
  preventNoSQLInjection,
  preventParameterPollution,
  ipFilter,
  geoFilter,
  validateUserAgent,
  bruteForcePrevention,
  cleanupBruteForceTracking,
  validateContentType
};