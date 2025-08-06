import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from '@/services/database';
import { RedisService } from '@/services/redis';
import { AuditService } from '@/services/audit';
import {
  AuthenticatedRequest,
  JWTPayload,
  User,
  UserSession,
  ApiResponse
} from '@/types';

const db = new DatabaseService();
const redis = new RedisService();
const audit = new AuditService();

/**
 * Authentication middleware to verify JWT tokens
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const response: ApiResponse = {
        success: false,
        message: 'Authentication required'
      };
      res.status(401).json(response);
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    let payload: JWTPayload;
    try {
      payload = jwt.verify(token, config.jwt.accessSecret) as JWTPayload;
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        const response: ApiResponse = {
          success: false,
          message: 'Token expired',
          errors: [{ field: 'token', message: 'Access token has expired', code: 'TOKEN_EXPIRED' }]
        };
        res.status(401).json(response);
        return;
      }
      
      if (jwtError instanceof jwt.JsonWebTokenError) {
        const response: ApiResponse = {
          success: false,
          message: 'Invalid token',
          errors: [{ field: 'token', message: 'Access token is invalid', code: 'TOKEN_INVALID' }]
        };
        res.status(401).json(response);
        return;
      }
      
      throw jwtError;
    }

    // Get user from cache or database
    let user = await redis.getCachedUser<User>(payload.userId);
    if (!user) {
      user = await db.getUserById(payload.userId);
      if (!user) {
        const response: ApiResponse = {
          success: false,
          message: 'User not found'
        };
        res.status(401).json(response);
        return;
      }
      
      // Cache user for future requests
      await redis.cacheUser(payload.userId, user, 1800); // 30 minutes
    }

    // Check if user is active
    if (!user.isActive) {
      const response: ApiResponse = {
        success: false,
        message: 'Account is inactive'
      };
      res.status(401).json(response);
      return;
    }

    // Check if user is locked
    if (user.isLocked) {
      const response: ApiResponse = {
        success: false,
        message: 'Account is locked'
      };
      res.status(423).json(response); // 423 Locked
      return;
    }

    // Get session information
    const session = await getSessionInfo(payload.sessionId);

    // Attach user and session to request
    req.user = user;
    req.session = session;
    req.permissions = payload.permissions || [];

    // Update last activity
    await updateLastActivity(payload.sessionId);

    next();
  } catch (error) {
    logger.error('Authentication middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      url: req.url,
      method: req.method,
      ip: req.ip
    });

    const response: ApiResponse = {
      success: false,
      message: 'Authentication failed'
    };
    res.status(500).json(response);
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
export const optionalAuthenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No authentication provided - continue without user context
    next();
    return;
  }

  // If authentication is provided, verify it
  await authenticate(req, res, next);
};

/**
 * Middleware to ensure user is authenticated and has valid session
 */
export const requireValidSession = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user || !req.session) {
    const response: ApiResponse = {
      success: false,
      message: 'Valid session required'
    };
    res.status(401).json(response);
    return;
  }

  // Check if session is still active and not expired
  if (!req.session.isActive || req.session.expiresAt < new Date()) {
    const response: ApiResponse = {
      success: false,
      message: 'Session expired'
    };
    res.status(401).json(response);
    return;
  }

  next();
};

/**
 * Middleware to check if user has verified their email (if required)
 */
export const requireEmailVerification = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    const response: ApiResponse = {
      success: false,
      message: 'Authentication required'
    };
    res.status(401).json(response);
    return;
  }

  // Check if email verification is required
  const emailVerificationRequired = process.env.FEATURE_EMAIL_VERIFICATION_REQUIRED === 'true';
  
  if (emailVerificationRequired && req.user.email && !req.user.isEmailVerified) {
    const response: ApiResponse = {
      success: false,
      message: 'Email verification required',
      errors: [{ 
        field: 'email', 
        message: 'Please verify your email address to continue', 
        code: 'EMAIL_VERIFICATION_REQUIRED' 
      }]
    };
    res.status(403).json(response);
    return;
  }

  next();
};

/**
 * Middleware to ensure MFA is completed (if enabled)
 */
export const requireMFAVerification = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    const response: ApiResponse = {
      success: false,
      message: 'Authentication required'
    };
    res.status(401).json(response);
    return;
  }

  // Check if user has MFA enabled
  const mfaSettings = await db.getMFASettings(req.user.id);
  
  if (mfaSettings?.isEnabled) {
    // Check if current session has completed MFA
    const sessionMFAComplete = await redis.get(`mfa_complete:${req.session?.sessionId}`);
    
    if (!sessionMFAComplete) {
      const response: ApiResponse = {
        success: false,
        message: 'Multi-factor authentication required',
        errors: [{ 
          field: 'mfa', 
          message: 'Please complete MFA verification', 
          code: 'MFA_REQUIRED' 
        }]
      };
      res.status(403).json(response);
      return;
    }
  }

  next();
};

/**
 * Middleware to check if user account is locked
 */
export const checkAccountLock = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    next();
    return;
  }

  if (req.user.isLocked) {
    await audit.log({
      userId: req.user.id,
      action: 'unauthorized_access',
      resource: req.route?.path || req.path,
      details: { 
        reason: 'account_locked',
        lockReason: req.user.lockReason,
        method: req.method
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || '',
      success: false
    });

    const response: ApiResponse = {
      success: false,
      message: 'Account is locked',
      errors: [{ 
        field: 'account', 
        message: `Account locked: ${req.user.lockReason}`, 
        code: 'ACCOUNT_LOCKED' 
      }]
    };
    res.status(423).json(response);
    return;
  }

  next();
};

/**
 * Middleware to validate device fingerprint
 */
export const validateDeviceFingerprint = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user || !req.session) {
    next();
    return;
  }

  const deviceFingerprint = req.headers['x-device-fingerprint'] as string;
  
  if (deviceFingerprint && req.session.deviceInfo) {
    const sessionFingerprint = (req.session.deviceInfo as any).fingerprint;
    
    if (deviceFingerprint !== sessionFingerprint) {
      // Log suspicious activity
      await audit.logSecurityEvent({
        type: 'device_change',
        severity: 'medium',
        userId: req.user.id,
        details: {
          sessionFingerprint,
          requestFingerprint: deviceFingerprint,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        },
        timestamp: new Date()
      });

      logger.warn('Device fingerprint mismatch detected', {
        userId: req.user.id,
        sessionFingerprint,
        requestFingerprint: deviceFingerprint
      });

      // Could optionally require re-authentication or MFA
      // For now, just log and continue
    }
  }

  next();
};

/**
 * Middleware to log API access
 */
export const logApiAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Skip logging for health checks and static assets
  if (req.path === '/health' || req.path.startsWith('/static')) {
    next();
    return;
  }

  const startTime = Date.now();

  // Log request
  logger.info('API request', {
    userId: req.user?.id,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(data: any) {
    const duration = Date.now() - startTime;
    
    logger.info('API response', {
      userId: req.user?.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      success: data?.success
    });

    return originalJson.call(this, data);
  };

  next();
};

/**
 * Middleware to check API rate limits per user
 */
export const userRateLimit = (
  maxRequests: number = 100,
  windowSeconds: number = 900 // 15 minutes
) => {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      next();
      return;
    }

    try {
      const key = `user_rate_limit:${req.user.id}`;
      const { allowed, remaining, resetTime } = await redis.checkRateLimit(
        key,
        maxRequests,
        windowSeconds
      );

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(resetTime.getTime() / 1000).toString()
      });

      if (!allowed) {
        const response: ApiResponse = {
          success: false,
          message: 'Rate limit exceeded',
          errors: [{ 
            field: 'request', 
            message: `Too many requests. Try again after ${Math.ceil((resetTime.getTime() - Date.now()) / 1000)} seconds`, 
            code: 'RATE_LIMIT_EXCEEDED' 
          }]
        };
        res.status(429).json(response);
        return;
      }

      next();
    } catch (error) {
      logger.error('User rate limit middleware error', {
        userId: req.user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // On error, allow the request to continue
      next();
    }
  };
};

// ==========================================
// Helper Functions
// ==========================================

/**
 * Get session information
 */
async function getSessionInfo(sessionId: string): Promise<UserSession | null> {
  try {
    // Try cache first
    const cachedSession = await redis.getSession<UserSession>(sessionId);
    if (cachedSession) {
      return cachedSession;
    }

    // Get from database
    const session = await db.getUserSession(sessionId);
    if (session) {
      await redis.storeSession(sessionId, session, 3600); // 1 hour cache
    }

    return session;
  } catch (error) {
    logger.error('Failed to get session info', {
      sessionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

/**
 * Update last activity for session
 */
async function updateLastActivity(sessionId: string): Promise<void> {
  try {
    // Update in database (could be batched/debounced for performance)
    await db.updateSessionActivity(sessionId);
    
    // Update cache TTL
    const cachedSession = await redis.getSession(sessionId);
    if (cachedSession) {
      await redis.storeSession(sessionId, {
        ...cachedSession,
        lastActivityAt: new Date()
      }, 3600);
    }
  } catch (error) {
    logger.error('Failed to update session activity', {
      sessionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Middleware to extract and validate request context
 */
export const extractRequestContext = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Add request ID for tracing
  req.id = req.headers['x-request-id'] as string || 
           `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Extract client IP (considering proxies)
  req.clientIP = req.ip || 
                req.connection.remoteAddress || 
                req.headers['x-forwarded-for'] as string ||
                req.headers['x-real-ip'] as string ||
                'unknown';

  // Add request timestamp
  req.timestamp = new Date();

  next();
};

/**
 * Middleware to handle CORS for authentication endpoints
 */
export const authCors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Fingerprint, X-Request-ID');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
};