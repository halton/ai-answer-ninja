import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

/**
 * Custom error class for application errors
 */
export class AppError extends Error {
  public statusCode: number;
  public code?: string;
  public isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTH_ERROR');
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  public fields: Array<{ field: string; message: string }>;

  constructor(message: string, fields: Array<{ field: string; message: string }> = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.fields = fields;
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND_ERROR');
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_ERROR');
  }
}

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed') {
    super(message, 500, 'DATABASE_ERROR');
  }
}

/**
 * External service error
 */
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string = 'External service error') {
    super(`${service}: ${message}`, 503, 'EXTERNAL_SERVICE_ERROR');
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppError {
  constructor(message: string = 'Configuration error') {
    super(message, 500, 'CONFIGURATION_ERROR', false);
  }
}

/**
 * Global error handler middleware
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let errors: any[] = [];

  // Handle known error types
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code || 'APP_ERROR';

    if (error instanceof ValidationError) {
      errors = error.fields.map(field => ({
        field: field.field,
        message: field.message,
        code: 'VALIDATION_ERROR'
      }));
    }
  }
  // Handle Prisma/Database errors
  else if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    
    switch (prismaError.code) {
      case 'P2002':
        statusCode = 409;
        message = 'Unique constraint violation';
        code = 'DUPLICATE_ERROR';
        break;
      case 'P2025':
        statusCode = 404;
        message = 'Record not found';
        code = 'NOT_FOUND_ERROR';
        break;
      default:
        statusCode = 500;
        message = 'Database error';
        code = 'DATABASE_ERROR';
    }
  }
  // Handle JWT errors
  else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  }
  else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  }
  // Handle validation errors from express-validator
  else if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
  }
  // Handle MongoDB errors
  else if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    statusCode = 500;
    message = 'Database error';
    code = 'DATABASE_ERROR';
  }
  // Handle Redis errors
  else if (error.name === 'RedisError') {
    statusCode = 503;
    message = 'Cache service unavailable';
    code = 'CACHE_ERROR';
  }

  // Log error details
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]('Request error', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: code
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: (req as any).user?.id
    },
    statusCode
  });

  // Prepare response
  const response: ApiResponse = {
    success: false,
    message,
    errors: errors.length > 0 ? errors : undefined,
    meta: {
      timestamp: new Date(),
      requestId: (req as any).id || 'unknown'
    }
  };

  // Add error code for debugging in development
  if (process.env.NODE_ENV === 'development') {
    response.meta = {
      ...response.meta,
      errorCode: code,
      stack: error.stack
    };
  }

  res.status(statusCode).json(response);
};

/**
 * Handle 404 errors for unknown routes
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const error = new NotFoundError('Route');
  next(error);
};

/**
 * Async error wrapper to catch errors in async route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Middleware to handle uncaught exceptions
 */
export const uncaughtExceptionHandler = (error: Error): void => {
  logger.error('Uncaught exception', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  });

  // Graceful shutdown
  process.exit(1);
};

/**
 * Middleware to handle unhandled promise rejections
 */
export const unhandledRejectionHandler = (reason: any, promise: Promise<any>): void => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? {
      name: reason.name,
      message: reason.message,
      stack: reason.stack
    } : reason,
    promise: promise.toString()
  });

  // Graceful shutdown
  process.exit(1);
};

/**
 * Security headers middleware
 */
export const securityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Remove server header
  res.removeHeader('X-Powered-By');

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // HSTS for HTTPS
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // CSP header
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'"
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);

  next();
};

/**
 * Request timeout middleware
 */
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        const response: ApiResponse = {
          success: false,
          message: 'Request timeout',
          meta: {
            timestamp: new Date(),
            requestId: (req as any).id || 'unknown'
          }
        };
        
        res.status(408).json(response);
      }
    }, timeoutMs);

    // Clear timeout when response is finished
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

/**
 * Body size limit error handler
 */
export const bodySizeLimitErrorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (error.type === 'entity.too.large') {
    const response: ApiResponse = {
      success: false,
      message: 'Request body too large',
      errors: [{
        field: 'body',
        message: 'Request body exceeds maximum allowed size',
        code: 'BODY_SIZE_LIMIT_EXCEEDED'
      }],
      meta: {
        timestamp: new Date(),
        requestId: (req as any).id || 'unknown'
      }
    };
    
    res.status(413).json(response);
    return;
  }

  next(error);
};

/**
 * Graceful shutdown handler
 */
export const gracefulShutdown = (server: any) => {
  return (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);

    server.close((err?: Error) => {
      if (err) {
        logger.error('Error during server shutdown', { error: err.message });
        process.exit(1);
      }
      
      logger.info('Server closed successfully');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 30000);
  };
};

/**
 * Health check endpoint
 */
export const healthCheck = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  };

  res.status(200).json(healthData);
};

/**
 * Deep health check with dependencies
 */
export const deepHealthCheck = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const checks = {
      database: false,
      redis: false,
      email: false
    };

    const healthData = {
      status: 'checking',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      dependencies: checks
    };

    // Check database connection
    try {
      // This would be implemented based on your database service
      // const dbHealth = await databaseService.healthCheck();
      checks.database = true;
    } catch (error) {
      checks.database = false;
    }

    // Check Redis connection
    try {
      // const redisHealth = await redisService.ping();
      checks.redis = true;
    } catch (error) {
      checks.redis = false;
    }

    // Check email service
    try {
      // const emailHealth = await emailService.verify();
      checks.email = true;
    } catch (error) {
      checks.email = false;
    }

    // Determine overall status
    const allHealthy = Object.values(checks).every(status => status);
    healthData.status = allHealthy ? 'healthy' : 'degraded';

    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch (error) {
    next(error);
  }
};

/**
 * Request ID middleware
 */
export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = req.headers['x-request-id'] as string || 
    `req_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  
  (req as any).id = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  next();
};

/**
 * CORS middleware with security considerations
 */
export const corsHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  const origin = req.headers.origin;

  // Check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // Set other CORS headers
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Fingerprint, X-Request-ID');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
};