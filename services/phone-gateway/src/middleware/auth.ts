import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import config from '../config';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    permissions: string[];
  };
}

/**
 * Authenticate JWT token
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, config.security.jwtSecret) as any;
    
    req.user = {
      id: decoded.userId,
      role: decoded.role || 'user',
      permissions: decoded.permissions || []
    };

    logger.debug({ userId: req.user.id }, 'User authenticated');
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    logger.error({ error }, 'Authentication error');
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

/**
 * Extract token from request
 */
function extractToken(req: Request): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check query parameter
  if (req.query.token && typeof req.query.token === 'string') {
    return req.query.token;
  }

  // Check cookie
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  return null;
}

/**
 * Authorize based on role
 */
export function authorize(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn({ 
        userId: req.user.id, 
        userRole: req.user.role, 
        requiredRoles: roles 
      }, 'Authorization failed');
      
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
}

/**
 * Check specific permission
 */
export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    if (!req.user.permissions.includes(permission)) {
      logger.warn({ 
        userId: req.user.id, 
        requiredPermission: permission,
        userPermissions: req.user.permissions 
      }, 'Permission check failed');
      
      return res.status(403).json({
        success: false,
        error: `Missing required permission: ${permission}`
      });
    }

    next();
  };
}