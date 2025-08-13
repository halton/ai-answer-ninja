import rateLimit from 'express-rate-limit';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redisClient } from '../utils/redis';
import config from '../config';
import { logger } from '../utils/logger';
import { RateLimitError } from './error';

// Redis-based rate limiter for distributed environments
const rateLimiterRedis = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'phone_gateway_rl',
  points: config.security.rateLimiting.max, // Number of requests
  duration: Math.floor(config.security.rateLimiting.windowMs / 1000), // Duration in seconds
  blockDuration: 60, // Block for 60 seconds if limit exceeded
  execEvenly: true, // Spread requests evenly across duration
});

// Webhook-specific rate limiter (more restrictive)
const webhookRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'webhook_rl',
  points: 30, // 30 requests
  duration: 60, // per minute
  blockDuration: 300, // Block for 5 minutes if exceeded
});

// API endpoint rate limiter
const apiRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'api_rl',
  points: config.security.rateLimiting.max,
  duration: Math.floor(config.security.rateLimiting.windowMs / 1000),
  blockDuration: 60,
});

// Express middleware for rate limiting
export const rateLimiter = rateLimit({
  windowMs: config.security.rateLimiting.windowMs,
  max: config.security.rateLimiting.max,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later',
      retryAfter: Math.ceil(config.security.rateLimiting.windowMs / 1000),
    },
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      method: req.method,
      url: req.url,
    }, 'Rate limit exceeded');

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later',
        retryAfter: Math.ceil(config.security.rateLimiting.windowMs / 1000),
      },
      timestamp: new Date().toISOString(),
    });
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/';
  },
});

// Advanced rate limiter middleware using Redis
export const advancedRateLimiter = (limiterType: 'default' | 'webhook' | 'api' = 'default') => {
  return async (req: any, res: any, next: any) => {
    const key = `${req.ip}_${req.method}_${req.route?.path || req.path}`;
    
    let limiter;
    switch (limiterType) {
      case 'webhook':
        limiter = webhookRateLimiter;
        break;
      case 'api':
        limiter = apiRateLimiter;
        break;
      default:
        limiter = rateLimiterRedis;
    }

    try {
      const result = await limiter.consume(key);
      
      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': limiter.points,
        'X-RateLimit-Remaining': result.remainingPoints,
        'X-RateLimit-Reset': new Date(Date.now() + result.msBeforeNext).toISOString(),
      });

      next();
    } catch (rejectedResult: any) {
      // Rate limit exceeded
      logger.warn({
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        method: req.method,
        url: req.url,
        limiterType,
        remainingPoints: rejectedResult.remainingPoints,
        msBeforeNext: rejectedResult.msBeforeNext,
      }, 'Advanced rate limit exceeded');

      const retryAfter = Math.round(rejectedResult.msBeforeNext / 1000);
      
      res.set({
        'X-RateLimit-Limit': limiter.points,
        'X-RateLimit-Remaining': rejectedResult.remainingPoints || 0,
        'X-RateLimit-Reset': new Date(Date.now() + rejectedResult.msBeforeNext).toISOString(),
        'Retry-After': retryAfter,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          retryAfter,
          type: limiterType,
        },
        timestamp: new Date().toISOString(),
      });
    }
  };
};

// IP-based rate limiter for suspicious activity
export const suspiciousActivityLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'suspicious_rl',
  points: 5, // 5 attempts
  duration: 300, // within 5 minutes
  blockDuration: 1800, // Block for 30 minutes
});

// Rate limiter for authentication attempts
export const authRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'auth_rl',
  points: 10, // 10 attempts
  duration: 900, // within 15 minutes
  blockDuration: 900, // Block for 15 minutes
});

// Middleware to track and limit suspicious activity
export const suspiciousActivityMiddleware = async (req: any, res: any, next: any) => {
  const key = req.ip;
  
  try {
    await suspiciousActivityLimiter.consume(key);
    next();
  } catch (rejectedResult: any) {
    logger.error({
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      method: req.method,
      url: req.url,
      headers: req.headers,
    }, 'Suspicious activity detected - IP blocked');

    res.status(429).json({
      success: false,
      error: {
        code: 'SUSPICIOUS_ACTIVITY',
        message: 'Suspicious activity detected. Access temporarily blocked.',
        retryAfter: Math.round(rejectedResult.msBeforeNext / 1000),
      },
      timestamp: new Date().toISOString(),
    });
  }
};

// Dynamic rate limiter that adjusts based on system load
export class DynamicRateLimiter {
  private baseLimit: number;
  private currentLimit: number;
  private systemLoadThreshold: number = 0.8;

  constructor(baseLimit: number = 100) {
    this.baseLimit = baseLimit;
    this.currentLimit = baseLimit;
  }

  adjustLimit(systemLoad: number): void {
    if (systemLoad > this.systemLoadThreshold) {
      // Reduce limit when system is under high load
      this.currentLimit = Math.max(10, Math.floor(this.baseLimit * (1 - systemLoad)));
    } else {
      // Restore to base limit when system load is normal
      this.currentLimit = this.baseLimit;
    }

    logger.debug({
      systemLoad,
      baseLimit: this.baseLimit,
      currentLimit: this.currentLimit,
    }, 'Dynamic rate limit adjusted');
  }

  getCurrentLimit(): number {
    return this.currentLimit;
  }
}

export const dynamicRateLimiter = new DynamicRateLimiter(config.security.rateLimiting.max);