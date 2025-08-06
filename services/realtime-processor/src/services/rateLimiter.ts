import { RateLimiterRedis } from 'rate-limiter-flexible';
import { RateLimitConfig, RateLimitError } from '../types';
import { RedisService } from './redis';
import logger from '../utils/logger';

export class RateLimiterService {
  private rateLimiters: Map<string, RateLimiterRedis> = new Map();
  private readonly config: RateLimitConfig;
  private redisService: RedisService | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  public async initialize(redisService: RedisService): Promise<void> {
    this.redisService = redisService;
    
    // Create rate limiters for different types
    this.setupRateLimiters();
    
    logger.info('Rate Limiter Service initialized');
  }

  private setupRateLimiters(): void {
    if (!this.redisService) {
      throw new Error('Redis service not provided');
    }

    // WebSocket connection rate limiter
    this.rateLimiters.set('websocket', new RateLimiterRedis({
      storeClient: this.redisService.getClient(),
      keyPrefix: 'rl_ws',
      points: this.config.maxConnections,
      duration: this.config.windowMs / 1000,
      blockDuration: 60, // Block for 1 minute
    }));

    // HTTP request rate limiter
    this.rateLimiters.set('http', new RateLimiterRedis({
      storeClient: this.redisService.getClient(),
      keyPrefix: 'rl_http',
      points: this.config.maxRequests,
      duration: this.config.windowMs / 1000,
      blockDuration: 60,
    }));

    // Audio processing rate limiter
    this.rateLimiters.set('audio', new RateLimiterRedis({
      storeClient: this.redisService.getClient(),
      keyPrefix: 'rl_audio',
      points: 100, // 100 audio chunks per minute
      duration: 60,
      blockDuration: 30,
    }));
  }

  public async checkRateLimit(identifier: string, type: string): Promise<void> {
    const rateLimiter = this.rateLimiters.get(type);
    if (!rateLimiter) {
      logger.warn({ type }, 'Unknown rate limiter type');
      return;
    }

    try {
      await rateLimiter.consume(identifier);
    } catch (rejRes: any) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      
      logger.warn({
        identifier,
        type,
        remainingPoints: rejRes.remainingPoints,
        msBeforeNext: rejRes.msBeforeNext,
      }, 'Rate limit exceeded');
      
      throw new RateLimitError(`Rate limit exceeded. Try again in ${secs} seconds`);
    }
  }

  public async getRemainingPoints(identifier: string, type: string): Promise<number> {
    const rateLimiter = this.rateLimiters.get(type);
    if (!rateLimiter) {
      return 0;
    }

    try {
      const resRateLimiter = await rateLimiter.get(identifier);
      return resRateLimiter ? resRateLimiter.remainingPoints : this.config.maxRequests;
    } catch (error) {
      logger.error({ error, identifier, type }, 'Failed to get remaining points');
      return 0;
    }
  }

  public async resetLimit(identifier: string, type: string): Promise<void> {
    const rateLimiter = this.rateLimiters.get(type);
    if (!rateLimiter) {
      return;
    }

    try {
      await rateLimiter.delete(identifier);
      logger.info({ identifier, type }, 'Rate limit reset');
    } catch (error) {
      logger.error({ error, identifier, type }, 'Failed to reset rate limit');
    }
  }
}