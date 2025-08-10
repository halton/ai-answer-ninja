import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ValidationError } from '@/types';
import { logger } from '@/utils/logger';

export interface ValidationSchemas {
  body?: z.ZodSchema;
  query?: z.ZodSchema;
  params?: z.ZodSchema;
}

/**
 * Middleware factory for request validation using Zod schemas
 */
export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      if (schemas.body && req.body) {
        req.body = schemas.body.parse(req.body);
      }

      // Validate query parameters
      if (schemas.query && req.query) {
        req.query = schemas.query.parse(req.query);
      }

      // Validate route parameters
      if (schemas.params && req.params) {
        req.params = schemas.params.parse(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = new ValidationError('Request validation failed', {
          issues: error.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        });

        logger.warn('Request validation failed', {
          path: req.path,
          method: req.method,
          errors: validationError.details.issues,
        });

        return res.status(400).json({
          success: false,
          error: {
            code: validationError.code,
            message: validationError.message,
            details: validationError.details,
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string,
          },
        });
      }

      next(error);
    }
  };
};

// Common validation schemas
export const commonSchemas = {
  uuid: z.string().uuid('Invalid UUID format'),
  phone: z.string().min(10, 'Phone number must be at least 10 digits').max(20, 'Phone number too long'),
  pagination: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val, 10) : 1),
    limit: z.string().optional().transform(val => val ? Math.min(parseInt(val, 10), 100) : 50),
  }),
  search: z.object({
    search: z.string().optional(),
    active: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
    type: z.enum(['manual', 'auto', 'temporary', 'learned']).optional(),
  }),
};

// Specific validation schemas for whitelist operations
export const whitelistSchemas = {
  // GET /api/v1/whitelist/:userId
  getUserWhitelist: {
    params: z.object({
      userId: commonSchemas.uuid,
    }),
    query: commonSchemas.pagination.merge(commonSchemas.search),
  },

  // POST /api/v1/whitelist
  createWhitelist: {
    body: z.object({
      userId: commonSchemas.uuid,
      contactPhone: commonSchemas.phone,
      contactName: z.string().min(1).max(100).optional(),
      whitelistType: z.enum(['manual', 'auto', 'temporary', 'learned']).default('manual'),
      confidenceScore: z.number().min(0).max(1).default(1.0),
      expiresAt: z.string().datetime().transform(val => new Date(val)).optional(),
    }),
  },

  // PUT /api/v1/whitelist/:id
  updateWhitelist: {
    params: z.object({
      id: commonSchemas.uuid,
    }),
    body: z.object({
      contactName: z.string().min(1).max(100).optional(),
      whitelistType: z.enum(['manual', 'auto', 'temporary', 'learned']).optional(),
      confidenceScore: z.number().min(0).max(1).optional(),
      isActive: z.boolean().optional(),
      expiresAt: z.string().datetime().transform(val => new Date(val)).optional().nullable(),
    }),
  },

  // DELETE /api/v1/whitelist/:id
  deleteWhitelist: {
    params: z.object({
      id: commonSchemas.uuid,
    }),
  },

  // POST /api/v1/whitelist/smart-add
  smartAdd: {
    body: z.object({
      userId: commonSchemas.uuid,
      contactPhone: commonSchemas.phone,
      contactName: z.string().min(1).max(100).optional(),
      confidence: z.number().min(0).max(1).default(1.0),
      context: z.string().max(200).optional(),
      tags: z.array(z.string().max(50)).default([]),
      expiresAt: z.string().datetime().transform(val => new Date(val)).optional(),
    }),
  },

  // POST /api/v1/whitelist/evaluate
  evaluatePhone: {
    body: z.object({
      phone: commonSchemas.phone,
      userId: commonSchemas.uuid.optional(),
      context: z.record(z.any()).default({}),
      includeFeatures: z.boolean().default(false),
    }),
  },

  // POST /api/v1/whitelist/learning
  recordLearning: {
    body: z.object({
      userId: commonSchemas.uuid,
      phone: commonSchemas.phone,
      eventType: z.enum(['accept', 'reject', 'timeout', 'manual_add', 'manual_remove', 'user_feedback']),
      confidence: z.number().min(0).max(1),
      features: z.record(z.any()).default({}),
      feedback: z.enum(['spam', 'not_spam', 'unknown', 'partial_spam']).optional(),
      context: z.record(z.any()).default({}),
      timestamp: z.string().datetime().transform(val => new Date(val)).default(() => new Date()),
    }),
  },

  // PUT /api/v1/whitelist/rules/:userId
  updateUserRules: {
    params: z.object({
      userId: commonSchemas.uuid,
    }),
    body: z.object({
      rules: z.object({
        autoLearnThreshold: z.number().min(0).max(1).optional(),
        allowTemporary: z.boolean().optional(),
        maxTemporaryDuration: z.number().min(1).max(168).optional(), // Max 1 week
        blockKnownSpam: z.boolean().optional(),
        requireManualApproval: z.boolean().optional(),
        patterns: z.object({
          allowedPrefixes: z.array(z.string().max(20)).optional(),
          blockedPrefixes: z.array(z.string().max(20)).optional(),
          allowedKeywords: z.array(z.string().max(50)).optional(),
          blockedKeywords: z.array(z.string().max(50)).optional(),
        }).optional(),
      }),
    }),
  },

  // GET /api/v1/whitelist/rules/:userId
  getUserRules: {
    params: z.object({
      userId: commonSchemas.uuid,
    }),
  },
};

// Batch operation schemas
export const batchSchemas = {
  // POST /api/v1/whitelist/batch
  batchCreate: {
    body: z.object({
      entries: z.array(z.object({
        userId: commonSchemas.uuid,
        contactPhone: commonSchemas.phone,
        contactName: z.string().min(1).max(100).optional(),
        whitelistType: z.enum(['manual', 'auto', 'temporary', 'learned']).default('manual'),
        confidenceScore: z.number().min(0).max(1).default(1.0),
        expiresAt: z.string().datetime().transform(val => new Date(val)).optional(),
      })).min(1).max(100), // Limit batch size
    }),
  },

  // PUT /api/v1/whitelist/batch
  batchUpdate: {
    body: z.object({
      updates: z.array(z.object({
        id: commonSchemas.uuid,
        contactName: z.string().min(1).max(100).optional(),
        whitelistType: z.enum(['manual', 'auto', 'temporary', 'learned']).optional(),
        confidenceScore: z.number().min(0).max(1).optional(),
        isActive: z.boolean().optional(),
        expiresAt: z.string().datetime().transform(val => new Date(val)).optional().nullable(),
      })).min(1).max(100),
    }),
  },

  // DELETE /api/v1/whitelist/batch
  batchDelete: {
    body: z.object({
      ids: z.array(commonSchemas.uuid).min(1).max(100),
      userId: commonSchemas.uuid,
    }),
  },
};

// Import/Export schemas
export const importExportSchemas = {
  // POST /api/v1/whitelist/import
  importWhitelist: {
    body: z.object({
      userId: commonSchemas.uuid,
      entries: z.array(z.object({
        contactPhone: commonSchemas.phone,
        contactName: z.string().min(1).max(100).optional(),
        whitelistType: z.enum(['manual', 'auto', 'temporary', 'learned']).default('manual'),
        confidenceScore: z.number().min(0).max(1).default(1.0),
      })).min(1).max(1000), // Allow larger imports
      overwrite: z.boolean().default(false),
    }),
  },

  // GET /api/v1/whitelist/export/:userId
  exportWhitelist: {
    params: z.object({
      userId: commonSchemas.uuid,
    }),
    query: z.object({
      format: z.enum(['json', 'csv']).default('json'),
      includeExpired: z.string().optional().transform(val => val === 'true'),
    }),
  },
};

// Rules management schemas
export const rulesSchemas = {
  // POST /api/v1/rules/:userId
  addRule: {
    params: z.object({
      userId: commonSchemas.uuid,
    }),
    body: z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      enabled: z.boolean().default(true),
      priority: z.number().int().min(1).max(1000).default(100),
      conditions: z.array(z.object({
        field: z.string().min(1).max(50),
        operator: z.enum(['equals', 'contains', 'startsWith', 'endsWith', 'greaterThan', 'lessThan', 'matches', 'in']),
        value: z.any(),
        caseSensitive: z.boolean().default(false),
      })).min(1).max(10),
      action: z.object({
        type: z.enum(['allow', 'block', 'analyze', 'flag']),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(1).max(200),
        temporary: z.boolean().default(false),
        duration: z.number().int().min(1).max(168).optional(), // hours
      }),
    }),
  },

  // PUT /api/v1/rules/:userId/:ruleId
  updateRule: {
    params: z.object({
      userId: commonSchemas.uuid,
      ruleId: z.string().min(1),
    }),
    body: z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      enabled: z.boolean().optional(),
      priority: z.number().int().min(1).max(1000).optional(),
      conditions: z.array(z.object({
        field: z.string().min(1).max(50),
        operator: z.enum(['equals', 'contains', 'startsWith', 'endsWith', 'greaterThan', 'lessThan', 'matches', 'in']),
        value: z.any(),
        caseSensitive: z.boolean().default(false),
      })).min(1).max(10).optional(),
      action: z.object({
        type: z.enum(['allow', 'block', 'analyze', 'flag']),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(1).max(200),
        temporary: z.boolean().default(false),
        duration: z.number().int().min(1).max(168).optional(),
      }).optional(),
    }),
  },

  // DELETE /api/v1/rules/:userId/:ruleId
  deleteRule: {
    params: z.object({
      userId: commonSchemas.uuid,
      ruleId: z.string().min(1),
    }),
  },

  // GET /api/v1/rules/:userId
  getUserRules: {
    params: z.object({
      userId: commonSchemas.uuid,
    }),
  },
};

/**
 * Sanitize request data by removing sensitive information
 */
export const sanitizeRequest = (req: Request): any => {
  const sanitized = { ...req };
  
  // Remove sensitive headers
  if (sanitized.headers) {
    delete sanitized.headers.authorization;
    delete sanitized.headers['x-api-key'];
  }

  // Mask phone numbers in body
  if (sanitized.body && typeof sanitized.body === 'object') {
    sanitized.body = maskSensitiveData(sanitized.body);
  }

  // Mask phone numbers in query
  if (sanitized.query && typeof sanitized.query === 'object') {
    sanitized.query = maskSensitiveData(sanitized.query);
  }

  return sanitized;
};

/**
 * Mask sensitive data in objects
 */
const maskSensitiveData = (obj: any): any => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveData);
  }

  const masked = { ...obj };
  
  // Mask phone numbers
  if (masked.phone && typeof masked.phone === 'string') {
    masked.phone = maskPhone(masked.phone);
  }
  
  if (masked.contactPhone && typeof masked.contactPhone === 'string') {
    masked.contactPhone = maskPhone(masked.contactPhone);
  }

  // Recursively mask nested objects
  for (const [key, value] of Object.entries(masked)) {
    if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value);
    }
  }

  return masked;
};

const maskPhone = (phone: string): string => {
  if (phone.length <= 4) return phone;
  return phone.substring(0, 4) + '*'.repeat(phone.length - 4);
};

export default validate;