import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class PhoneGatewayError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code?: string, details?: any) {
    super(message);
    this.name = 'PhoneGatewayError';
    this.statusCode = statusCode;
    this.code = code || 'INTERNAL_ERROR';
    this.details = details;
    
    // Maintains proper stack trace
    Error.captureStackTrace(this, PhoneGatewayError);
  }
}

export class ValidationError extends PhoneGatewayError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends PhoneGatewayError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends PhoneGatewayError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends PhoneGatewayError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends PhoneGatewayError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, 'CONFLICT_ERROR');
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends PhoneGatewayError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_ERROR');
    this.name = 'RateLimitError';
  }
}

export class ServiceUnavailableError extends PhoneGatewayError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}

export class AzureServiceError extends PhoneGatewayError {
  constructor(message: string, originalError?: any) {
    super(message, 502, 'AZURE_SERVICE_ERROR', originalError);
    this.name = 'AzureServiceError';
  }
}

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error details
  logger.error({
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    request: {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      body: req.method !== 'GET' ? req.body : undefined,
      headers: {
        'user-agent': req.get('User-Agent'),
        'x-forwarded-for': req.get('X-Forwarded-For'),
        'authorization': req.get('Authorization') ? '[REDACTED]' : undefined,
      },
      ip: req.ip,
    },
  }, 'Request error occurred');

  // Handle known error types
  if (error instanceof PhoneGatewayError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Handle validation errors (Joi, etc.)
  if (error.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.message,
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Handle MongoDB/Database errors
  if (error.name === 'MongoError' || error.name === 'DatabaseError') {
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Database operation failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Handle Azure SDK errors
  if (error.name?.includes('Azure') || error.name?.includes('Communication')) {
    res.status(502).json({
      success: false,
      error: {
        code: 'AZURE_SERVICE_ERROR',
        message: 'Azure service error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Handle timeout errors
  if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
    res.status(408).json({
      success: false,
      error: {
        code: 'REQUEST_TIMEOUT',
        message: 'Request timeout',
        details: 'The request took too long to process',
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Handle network/connection errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'External service unavailable',
        details: 'Unable to connect to required service',
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Handle syntax errors (malformed JSON, etc.)
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body',
        details: error.message,
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    });
    return;
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || 'unknown',
  });
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      details: 'The requested endpoint does not exist',
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || 'unknown',
  });
};