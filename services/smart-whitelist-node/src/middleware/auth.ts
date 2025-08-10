import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '@/config';
import { WhitelistError } from '@/types';
import { logger } from '@/utils/logger';

export interface UserPayload {
  userId: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

/**
 * JWT Authentication middleware
 */
export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      throw new WhitelistError('Authorization header missing', 'MISSING_AUTH_HEADER', 401);
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7)
      : authHeader;

    if (!token) {
      throw new WhitelistError('Authentication token missing', 'MISSING_TOKEN', 401);
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    
    if (!decoded.userId) {
      throw new WhitelistError('Invalid token payload', 'INVALID_TOKEN_PAYLOAD', 401);
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
    };

    logger.debug('User authenticated', {
      userId: req.user.userId,
      path: req.path,
      method: req.method,
    });

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('JWT authentication failed', {
        error: error.message,
        path: req.path,
        method: req.method,
      });

      return next(new WhitelistError('Invalid authentication token', 'INVALID_TOKEN', 401));
    }

    if (error instanceof WhitelistError) {
      return next(error);
    }

    logger.error('Authentication error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
    });

    next(new WhitelistError('Authentication failed', 'AUTH_ERROR', 401));
  }
};

/**
 * Optional authentication middleware (allows unauthenticated requests)
 */
export const optionalAuthenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return next();
  }

  // Use regular authentication if header is present
  authenticate(req, res, next);
};

/**
 * Authorization middleware factory
 */
export const authorize = (requiredRoles: string[] = [], requiredPermissions: string[] = []) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new WhitelistError('Authentication required', 'AUTHENTICATION_REQUIRED', 401));
    }

    const userRoles = req.user.roles || [];
    const userPermissions = req.user.permissions || [];

    // Check roles (user must have at least one of the required roles)
    if (requiredRoles.length > 0) {
      const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));
      if (!hasRequiredRole) {
        logger.warn('Insufficient roles', {
          userId: req.user.userId,
          userRoles,
          requiredRoles,
          path: req.path,
          method: req.method,
        });

        return next(new WhitelistError('Insufficient permissions', 'INSUFFICIENT_ROLES', 403));
      }
    }

    // Check permissions (user must have at least one of the required permissions)
    if (requiredPermissions.length > 0) {
      const hasRequiredPermission = requiredPermissions.some(permission => 
        userPermissions.includes(permission)
      );

      if (!hasRequiredPermission) {
        logger.warn('Insufficient permissions', {
          userId: req.user.userId,
          userPermissions,
          requiredPermissions,
          path: req.path,
          method: req.method,
        });

        return next(new WhitelistError('Insufficient permissions', 'INSUFFICIENT_PERMISSIONS', 403));
      }
    }

    next();
  };
};

/**
 * API Key authentication middleware (for service-to-service calls)
 */
export const authenticateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      throw new WhitelistError('API key missing', 'MISSING_API_KEY', 401);
    }

    // Simple API key validation (in production, this would be more sophisticated)
    const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];
    
    if (!validApiKeys.includes(apiKey)) {
      throw new WhitelistError('Invalid API key', 'INVALID_API_KEY', 401);
    }

    logger.debug('API key authenticated', {
      path: req.path,
      method: req.method,
    });

    next();
  } catch (error) {
    if (error instanceof WhitelistError) {
      return next(error);
    }

    logger.error('API key authentication error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
    });

    next(new WhitelistError('API key authentication failed', 'API_KEY_AUTH_ERROR', 401));
  }
};

/**
 * User ownership validation (ensures user can only access their own resources)
 */
export const validateUserOwnership = (userIdParam: string = 'userId') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new WhitelistError('Authentication required', 'AUTHENTICATION_REQUIRED', 401));
    }

    const requestedUserId = req.params[userIdParam] || req.body.userId || req.query.userId;
    
    if (!requestedUserId) {
      return next(new WhitelistError('User ID not found in request', 'MISSING_USER_ID', 400));
    }

    // Check if user is accessing their own resources or has admin role
    const isOwnResource = req.user.userId === requestedUserId;
    const isAdmin = req.user.roles?.includes('admin');

    if (!isOwnResource && !isAdmin) {
      logger.warn('Unauthorized resource access attempt', {
        userId: req.user.userId,
        requestedUserId,
        path: req.path,
        method: req.method,
      });

      return next(new WhitelistError('Unauthorized access to resource', 'UNAUTHORIZED_ACCESS', 403));
    }

    next();
  };
};

/**
 * Rate limiting by user
 */
export const userRateLimit = (maxRequests: number = 100, windowMinutes: number = 15) => {
  const userRequestCounts = new Map<string, { count: number; resetTime: number }>();
  const windowMs = windowMinutes * 60 * 1000;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(); // Skip rate limiting for unauthenticated requests
    }

    const userId = req.user.userId;
    const now = Date.now();
    
    const userLimit = userRequestCounts.get(userId);
    
    if (!userLimit || now > userLimit.resetTime) {
      // Reset or create new limit window
      userRequestCounts.set(userId, {
        count: 1,
        resetTime: now + windowMs,
      });
      
      return next();
    }

    if (userLimit.count >= maxRequests) {
      logger.warn('User rate limit exceeded', {
        userId,
        count: userLimit.count,
        maxRequests,
        windowMinutes,
        path: req.path,
        method: req.method,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'USER_RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Limit: ${maxRequests} requests per ${windowMinutes} minutes.`,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'],
          resetTime: new Date(userLimit.resetTime).toISOString(),
        },
      });
      return;
    }

    // Increment request count
    userLimit.count++;
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - userLimit.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(userLimit.resetTime / 1000));

    next();
  };
};

/**
 * Service account authentication (for internal service calls)
 */
export const authenticateServiceAccount = (req: Request, res: Response, next: NextFunction): void => {
  const serviceToken = req.headers['x-service-token'] as string;
  const serviceId = req.headers['x-service-id'] as string;

  if (!serviceToken || !serviceId) {
    return next(new WhitelistError('Service authentication required', 'MISSING_SERVICE_AUTH', 401));
  }

  // Validate service token (in production, use proper service account management)
  const expectedToken = process.env[`SERVICE_TOKEN_${serviceId.toUpperCase()}`];
  
  if (!expectedToken || serviceToken !== expectedToken) {
    logger.warn('Invalid service authentication', {
      serviceId,
      path: req.path,
      method: req.method,
    });

    return next(new WhitelistError('Invalid service credentials', 'INVALID_SERVICE_CREDENTIALS', 401));
  }

  logger.debug('Service authenticated', {
    serviceId,
    path: req.path,
    method: req.method,
  });

  next();
};

/**
 * Generate JWT token (for testing or internal use)
 */
export const generateToken = (payload: UserPayload, expiresIn: string = '1h'): string => {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn });
};

/**
 * Decode JWT token without verification (for debugging)
 */
export const decodeToken = (token: string): any => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

export default authenticate;