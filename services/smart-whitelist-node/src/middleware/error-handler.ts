import { Request, Response, NextFunction } from 'express';
import { WhitelistError, ValidationError, NotFoundError, ConflictError } from '@/types';
import { logger } from '@/utils/logger';

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  meta: {
    timestamp: string;
    requestId?: string;
    processingTime?: number;
  };
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
  const requestId = req.headers['x-request-id'] as string;
  const processingTime = req.startTime ? Date.now() - req.startTime : undefined;

  // Log error with context
  logger.error('Request error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    requestId,
    processingTime,
    body: sanitizeRequestBody(req.body),
    query: req.query,
    params: req.params,
  });

  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let errorMessage = 'An internal server error occurred';
  let details: any = undefined;

  // Handle specific error types
  if (error instanceof ValidationError) {
    statusCode = 400;
    errorCode = error.code;
    errorMessage = error.message;
    details = error.details;
  } else if (error instanceof NotFoundError) {
    statusCode = 404;
    errorCode = error.code;
    errorMessage = error.message;
  } else if (error instanceof ConflictError) {
    statusCode = 409;
    errorCode = error.code;
    errorMessage = error.message;
  } else if (error instanceof WhitelistError) {
    statusCode = error.statusCode;
    errorCode = error.code;
    errorMessage = error.message;
    details = error.details;
  } else if (error.name === 'CastError') {
    // Database cast errors (invalid UUIDs, etc.)
    statusCode = 400;
    errorCode = 'INVALID_PARAMETER';
    errorMessage = 'Invalid parameter format';
  } else if (error.name === 'ValidationError') {
    // Database validation errors
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    errorMessage = 'Data validation failed';
    details = error.message;
  } else if (error.message.includes('duplicate key')) {
    // Database duplicate key errors
    statusCode = 409;
    errorCode = 'DUPLICATE_ENTRY';
    errorMessage = 'Duplicate entry detected';
  } else if (error.message.includes('foreign key constraint')) {
    // Database foreign key constraint errors
    statusCode = 400;
    errorCode = 'INVALID_REFERENCE';
    errorMessage = 'Invalid reference to related entity';
  } else if (error.message.includes('connection')) {
    // Database connection errors
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    errorMessage = 'Service temporarily unavailable';
  }

  const errorResponse: ErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId,
      processingTime,
    },
  };

  // Don't expose internal details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    delete errorResponse.error.details;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const requestId = req.headers['x-request-id'] as string;

  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
    requestId,
  });

  const errorResponse: ErrorResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId,
    },
  };

  res.status(404).json(errorResponse);
};

/**
 * Async wrapper to catch errors in async route handlers
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Request timeout handler
 */
export const timeoutHandler = (timeout: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        const requestId = req.headers['x-request-id'] as string;
        
        logger.error('Request timeout', {
          path: req.path,
          method: req.method,
          timeout,
          requestId,
        });

        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timed out',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId,
            processingTime: timeout,
          },
        };

        res.status(408).json(errorResponse);
      }
    }, timeout);

    // Clear timeout if response is sent
    const originalSend = res.send;
    res.send = function(...args: any[]) {
      clearTimeout(timer);
      return originalSend.apply(this, args);
    };

    next();
  };
};

/**
 * Rate limit error handler
 */
export const rateLimitHandler = (req: Request, res: Response): void => {
  const requestId = req.headers['x-request-id'] as string;

  logger.warn('Rate limit exceeded', {
    ip: req.ip,
    path: req.path,
    method: req.method,
    requestId,
  });

  const errorResponse: ErrorResponse = {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId,
    },
  };

  res.status(429).json(errorResponse);
};

/**
 * Health check timeout handler (shorter timeout)
 */
export const healthCheckTimeoutHandler = (timeout: number = 5000) => {
  return timeoutHandler(timeout);
};

/**
 * Create custom error
 */
export const createError = (
  message: string,
  code: string,
  statusCode: number = 500,
  details?: any
): WhitelistError => {
  return new WhitelistError(message, code, statusCode, details);
};

/**
 * Sanitize request body for logging (remove sensitive data)
 */
const sanitizeRequestBody = (body: any): any => {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };

  // Remove or mask sensitive fields
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'phone', 'contactPhone'];
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      if (field === 'phone' || field === 'contactPhone') {
        // Mask phone numbers
        const phone = sanitized[field] as string;
        sanitized[field] = phone.length > 4 
          ? phone.substring(0, 4) + '*'.repeat(phone.length - 4)
          : phone;
      } else {
        sanitized[field] = '***';
      }
    }
  }

  // Recursively sanitize nested objects
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeRequestBody(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'object' && item !== null ? sanitizeRequestBody(item) : item
      );
    }
  }

  return sanitized;
};

/**
 * Middleware to add request start time for processing time calculation
 */
export const addRequestTime = (req: Request, res: Response, next: NextFunction): void => {
  req.startTime = Date.now();
  next();
};

/**
 * Response timing middleware
 */
export const responseTimer = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  const originalSend = res.send;
  res.send = function(data: any) {
    const processingTime = Date.now() - startTime;
    
    // Add processing time to response if it's a JSON response
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          if (!parsed.meta) {
            parsed.meta = {};
          }
          parsed.meta.processingTime = processingTime;
          data = JSON.stringify(parsed);
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }

    // Log slow requests
    if (processingTime > 1000) {
      logger.warn('Slow request detected', {
        path: req.path,
        method: req.method,
        processingTime,
        requestId: req.headers['x-request-id'],
      });
    }

    return originalSend.call(this, data);
  };

  next();
};

// Extend Express Request interface to include custom properties
declare module 'express' {
  interface Request {
    startTime?: number;
  }
}

export default errorHandler;