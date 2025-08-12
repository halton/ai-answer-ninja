/**
 * CORS Manager
 * Handles Cross-Origin Resource Sharing security policies
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/Logger';

export interface CORSOptions {
  origins: string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  optionsSuccessStatus?: number;
}

export class CORSManager {
  private static instance: CORSManager;
  private readonly DEFAULT_OPTIONS: CORSOptions = {
    origins: ['http://localhost:3000', 'https://*.ai-answer-ninja.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Client-ID',
      'X-Device-Fingerprint'
    ],
    exposedHeaders: [
      'X-Rate-Limit-Remaining',
      'X-Rate-Limit-Reset',
      'X-Response-Time'
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 204
  };

  private constructor() {}

  public static getInstance(): CORSManager {
    if (!CORSManager.instance) {
      CORSManager.instance = new CORSManager();
    }
    return CORSManager.instance;
  }

  /**
   * Create CORS middleware
   */
  public createMiddleware(options: Partial<CORSOptions> = {}): (req: Request, res: Response, next: NextFunction) => void {
    const corsOptions = { ...this.DEFAULT_OPTIONS, ...options };

    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const origin = req.headers.origin as string;
        
        // Check if origin is allowed
        const isAllowed = this.isOriginAllowed(origin, corsOptions.origins);
        
        if (isAllowed) {
          res.header('Access-Control-Allow-Origin', origin);
        }

        // Set CORS headers
        if (corsOptions.credentials) {
          res.header('Access-Control-Allow-Credentials', 'true');
        }

        if (corsOptions.allowedHeaders) {
          res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
        }

        if (corsOptions.exposedHeaders) {
          res.header('Access-Control-Expose-Headers', corsOptions.exposedHeaders.join(', '));
        }

        if (corsOptions.methods) {
          res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
        }

        if (corsOptions.maxAge) {
          res.header('Access-Control-Max-Age', corsOptions.maxAge.toString());
        }

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
          res.status(corsOptions.optionsSuccessStatus || 204).end();
          return;
        }

        // Log CORS request
        logger.debug('CORS request processed', {
          origin,
          method: req.method,
          path: req.path,
          allowed: isAllowed
        });

        next();
      } catch (error) {
        logger.error('CORS middleware error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          origin: req.headers.origin,
          method: req.method
        });
        
        // Deny request on error
        res.status(403).json({ error: 'CORS policy violation' });
      }
    };
  }

  /**
   * Check if origin is allowed
   */
  private isOriginAllowed(
    origin: string | undefined,
    allowedOrigins: string[] | ((origin: string) => boolean)
  ): boolean {
    if (!origin) {
      return false; // No origin header
    }

    if (typeof allowedOrigins === 'function') {
      return allowedOrigins(origin);
    }

    return allowedOrigins.some(allowed => {
      if (allowed === '*') {
        return true;
      }
      
      // Handle wildcard domains
      if (allowed.includes('*')) {
        const regex = new RegExp(
          '^' + allowed.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$'
        );
        return regex.test(origin);
      }
      
      return allowed === origin;
    });
  }

  /**
   * Create strict CORS policy for production
   */
  public createProductionMiddleware(allowedDomains: string[]): (req: Request, res: Response, next: NextFunction) => void {
    return this.createMiddleware({
      origins: allowedDomains,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true,
      maxAge: 3600 // 1 hour for production
    });
  }

  /**
   * Create development CORS policy
   */
  public createDevelopmentMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    return this.createMiddleware({
      origins: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true
    });
  }

  /**
   * Validate CORS configuration
   */
  public validateConfiguration(options: CORSOptions): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check origins
    if (Array.isArray(options.origins)) {
      if (options.origins.length === 0) {
        errors.push('At least one origin must be specified');
      }
      
      // Check for insecure wildcard in production
      if (process.env.NODE_ENV === 'production' && options.origins.includes('*')) {
        errors.push('Wildcard origin (*) is not allowed in production');
      }
    }

    // Check methods
    if (options.methods) {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
      const invalidMethods = options.methods.filter(method => !validMethods.includes(method));
      
      if (invalidMethods.length > 0) {
        errors.push(`Invalid HTTP methods: ${invalidMethods.join(', ')}`);
      }
    }

    // Check credentials with wildcard origin
    if (options.credentials && Array.isArray(options.origins) && options.origins.includes('*')) {
      errors.push('Cannot use credentials with wildcard origin');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Log CORS violation
   */
  public logViolation(req: Request, reason: string): void {
    logger.warn('CORS violation detected', {
      origin: req.headers.origin,
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      reason
    });
  }
}