/**
 * Rate Limiter
 * Implements various rate limiting strategies
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimitConfig, RateLimitStatus } from '../types';
import { logger } from '../utils/Logger';

interface RateLimitStore {
  key: string;
  count: number;
  resetTime: Date;
}

export class RateLimiter {
  private static instance: RateLimiter;
  private store: Map<string, RateLimitStore> = new Map();
  private blacklist: Set<string> = new Set();
  
  // Different rate limit tiers
  private readonly TIERS = {
    public: { windowMs: 60000, maxRequests: 60 }, // 60 requests per minute
    authenticated: { windowMs: 60000, maxRequests: 120 }, // 120 requests per minute
    premium: { windowMs: 60000, maxRequests: 300 }, // 300 requests per minute
    api: { windowMs: 60000, maxRequests: 1000 }, // 1000 requests per minute
    strict: { windowMs: 60000, maxRequests: 10 }, // 10 requests per minute (sensitive endpoints)
    auth: { windowMs: 900000, maxRequests: 5 } // 5 requests per 15 minutes (auth endpoints)
  };
  
  private constructor() {
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }
  
  public static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }
  
  /**
   * Create rate limit middleware
   */
  public createMiddleware(config?: Partial<RateLimitConfig>) {
    const finalConfig: RateLimitConfig = {
      windowMs: config?.windowMs || this.TIERS.public.windowMs,
      maxRequests: config?.maxRequests || this.TIERS.public.maxRequests,
      message: config?.message || 'Too many requests, please try again later',
      keyGenerator: config?.keyGenerator || this.defaultKeyGenerator,
      skipSuccessfulRequests: config?.skipSuccessfulRequests || false,
      skipFailedRequests: config?.skipFailedRequests || false,
      handler: config?.handler || this.defaultHandler
    };
    
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const key = finalConfig.keyGenerator!(req);
        
        // Check if key is blacklisted
        if (this.blacklist.has(key)) {
          logger.warn('Blacklisted key attempted access', { key });
          return res.status(429).json({
            error: 'Access denied due to rate limit violations'
          });
        }
        
        const status = await this.checkRateLimit(key, finalConfig);
        
        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', finalConfig.maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', status.remaining.toString());
        res.setHeader('X-RateLimit-Reset', status.resetTime.toISOString());
        
        if (!status.allowed) {
          res.setHeader('Retry-After', Math.ceil(status.retryAfter! / 1000).toString());
          
          // Check for repeat offenders
          await this.handleRateLimitViolation(key);
          
          if (finalConfig.handler) {
            return finalConfig.handler(req, res);
          }
          
          return res.status(429).json({
            error: finalConfig.message,
            retryAfter: status.retryAfter
          });
        }
        
        // Track response for conditional skipping
        if (finalConfig.skipSuccessfulRequests || finalConfig.skipFailedRequests) {
          const originalSend = res.send;
          res.send = function(data) {
            const shouldSkip = (
              (finalConfig.skipSuccessfulRequests && res.statusCode < 400) ||
              (finalConfig.skipFailedRequests && res.statusCode >= 400)
            );
            
            if (shouldSkip) {
              // Decrement the counter
              const entry = RateLimiter.instance.store.get(key);
              if (entry && entry.count > 0) {
                entry.count--;
              }
            }
            
            return originalSend.call(this, data);
          };
        }
        
        next();
      } catch (error) {
        logger.error('Rate limiter error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(); // Don't block on rate limiter errors
      }
    };
  }
  
  /**
   * Create tier-based rate limiter
   */
  public createTierLimiter(tier: keyof typeof RateLimiter.prototype.TIERS) {
    return this.createMiddleware(this.TIERS[tier]);
  }
  
  /**
   * Create dynamic rate limiter based on user role
   */
  public createDynamicLimiter() {
    return this.createMiddleware({
      keyGenerator: (req: Request) => {
        const user = (req as any).user;
        const baseKey = this.getClientIdentifier(req);
        
        if (!user) {
          return `public:${baseKey}`;
        }
        
        // Determine tier based on user role
        if (user.roles?.includes('admin')) {
          return `admin:${user.id}`;
        } else if (user.roles?.includes('premium')) {
          return `premium:${user.id}`;
        } else {
          return `authenticated:${user.id}`;
        }
      },
      windowMs: 60000,
      maxRequests: 100, // Will be overridden based on tier
      handler: async (req: Request, res: Response) => {
        const key = this.getClientIdentifier(req);
        const tier = key.split(':')[0];
        
        const limits = {
          public: 60,
          authenticated: 120,
          premium: 300,
          admin: 1000
        };
        
        const limit = limits[tier as keyof typeof limits] || 60;
        
        res.status(429).json({
          error: 'Rate limit exceeded',
          tier,
          limit,
          window: '1 minute'
        });
      }
    });
  }
  
  /**
   * Create sliding window rate limiter
   */
  public createSlidingWindowLimiter(windowMs: number, maxRequests: number) {
    const slidingWindows = new Map<string, number[]>();
    
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.getClientIdentifier(req);
      const now = Date.now();
      
      // Get or create window
      let timestamps = slidingWindows.get(key) || [];
      
      // Remove old timestamps outside the window
      timestamps = timestamps.filter(t => now - t < windowMs);
      
      if (timestamps.length >= maxRequests) {
        const oldestTimestamp = timestamps[0];
        const retryAfter = windowMs - (now - oldestTimestamp);
        
        res.setHeader('Retry-After', Math.ceil(retryAfter / 1000).toString());
        
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter
        });
      }
      
      // Add current timestamp
      timestamps.push(now);
      slidingWindows.set(key, timestamps);
      
      // Set headers
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', (maxRequests - timestamps.length).toString());
      
      next();
    };
  }
  
  /**
   * Create distributed rate limiter (for multiple instances)
   */
  public createDistributedLimiter(redisClient?: any) {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!redisClient) {
        // Fallback to local rate limiting
        return this.createMiddleware()(req, res, next);
      }
      
      const key = `rate_limit:${this.getClientIdentifier(req)}`;
      const windowMs = 60000;
      const maxRequests = 100;
      
      try {
        // Use Redis INCR with expiry
        const count = await redisClient.incr(key);
        
        if (count === 1) {
          await redisClient.expire(key, Math.ceil(windowMs / 1000));
        }
        
        if (count > maxRequests) {
          const ttl = await redisClient.ttl(key);
          
          res.setHeader('Retry-After', ttl.toString());
          
          return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: ttl * 1000
          });
        }
        
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', (maxRequests - count).toString());
        
        next();
      } catch (error) {
        logger.error('Distributed rate limiter error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(); // Don't block on Redis errors
      }
    };
  }
  
  /**
   * Check rate limit
   */
  private async checkRateLimit(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitStatus> {
    const now = new Date();
    let entry = this.store.get(key);
    
    // Create new entry if doesn't exist
    if (!entry || entry.resetTime < now) {
      entry = {
        key,
        count: 1,
        resetTime: new Date(now.getTime() + config.windowMs)
      };
      this.store.set(key, entry);
      
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests - 1,
        resetTime: entry.resetTime
      };
    }
    
    // Increment counter
    entry.count++;
    
    // Check if limit exceeded
    if (entry.count > config.maxRequests) {
      const retryAfter = entry.resetTime.getTime() - now.getTime();
      
      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        resetTime: entry.resetTime,
        retryAfter
      };
    }
    
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - entry.count,
      resetTime: entry.resetTime
    };
  }
  
  /**
   * Handle rate limit violations
   */
  private async handleRateLimitViolation(key: string): Promise<void> {
    const violations = this.getViolationCount(key);
    
    if (violations > 10) {
      // Add to blacklist after repeated violations
      this.blacklist.add(key);
      
      logger.warn('Key added to blacklist due to repeated violations', {
        key,
        violations
      });
      
      // Auto-remove from blacklist after 1 hour
      setTimeout(() => {
        this.blacklist.delete(key);
        logger.info('Key removed from blacklist', { key });
      }, 3600000);
    }
  }
  
  /**
   * Get violation count for a key
   */
  private getViolationCount(key: string): number {
    // Track violations in a separate store (simplified)
    const entry = this.store.get(key);
    if (!entry) return 0;
    
    // Count requests over limit
    const overLimit = Math.max(0, entry.count - 100);
    return Math.floor(overLimit / 10);
  }
  
  /**
   * Default key generator
   */
  private defaultKeyGenerator(req: Request): string {
    return this.getClientIdentifier(req);
  }
  
  /**
   * Get client identifier
   */
  private getClientIdentifier(req: Request): string {
    // Priority: authenticated user > API key > IP address
    const user = (req as any).user;
    if (user?.id) {
      return `user:${user.id}`;
    }
    
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      return `api:${apiKey.substring(0, 8)}`;
    }
    
    return `ip:${this.getClientIP(req)}`;
  }
  
  /**
   * Get client IP address
   */
  private getClientIP(req: Request): string {
    // Check various headers for real IP
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    const real = req.headers['x-real-ip'] as string;
    if (real) {
      return real;
    }
    
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
  
  /**
   * Default rate limit handler
   */
  private defaultHandler(req: Request, res: Response): void {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please wait before making another request'
    });
  }
  
  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = new Date();
    let cleaned = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug('Rate limit entries cleaned', { count: cleaned });
    }
  }
  
  /**
   * Reset rate limit for a key
   */
  public resetLimit(key: string): void {
    this.store.delete(key);
    logger.info('Rate limit reset', { key });
  }
  
  /**
   * Get current status for a key
   */
  public getStatus(key: string, tier: keyof typeof this.TIERS = 'public'): RateLimitStatus {
    const config = this.TIERS[tier];
    const entry = this.store.get(key);
    const now = new Date();
    
    if (!entry || entry.resetTime < now) {
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests,
        resetTime: new Date(now.getTime() + config.windowMs)
      };
    }
    
    return {
      allowed: entry.count <= config.maxRequests,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - entry.count),
      resetTime: entry.resetTime,
      retryAfter: entry.count > config.maxRequests 
        ? entry.resetTime.getTime() - now.getTime() 
        : undefined
    };
  }
}