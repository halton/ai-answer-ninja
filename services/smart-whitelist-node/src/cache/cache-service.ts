import { redis } from './redis-client';
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { 
  SmartWhitelist, 
  SpamProfile, 
  CacheKey, 
  CacheItem,
  PhoneFeatures 
} from '@/types';

export class CacheService {
  private readonly keyPrefix = 'smart-whitelist:';
  private hitStats = new Map<string, number>();
  private missStats = new Map<string, number>();

  constructor() {
    // Set up periodic cache statistics logging
    setInterval(() => {
      this.logCacheStatistics();
    }, 300000); // Every 5 minutes
  }

  // Generate cache keys
  private generateKey(type: CacheKey['type'], params: Record<string, any>): string {
    const keyParts = [this.keyPrefix, type];
    
    switch (type) {
      case 'whitelist':
        keyParts.push(params.userId, params.phone);
        break;
      case 'spam_profile':
        keyParts.push(params.phoneHash);
        break;
      case 'user_config':
        keyParts.push(params.userId);
        break;
      case 'ml_features':
        keyParts.push(params.phoneHash);
        break;
      default:
        keyParts.push(JSON.stringify(params));
    }
    
    return keyParts.join(':');
  }

  // Get TTL for cache type
  private getTTL(type: CacheKey['type']): number {
    switch (type) {
      case 'whitelist':
        return config.CACHE_TTL_WHITELIST;
      case 'spam_profile':
        return config.CACHE_TTL_SPAM_PROFILE;
      case 'user_config':
        return config.CACHE_TTL_USER_CONFIG;
      case 'ml_features':
        return config.CACHE_TTL_ML_FEATURES;
      default:
        return config.CACHE_TTL_WHITELIST;
    }
  }

  // Ultra-fast whitelist lookup (< 5ms target)
  async fastWhitelistLookup(userId: string, phone: string): Promise<{
    found: boolean;
    entry?: SmartWhitelist;
    cacheHit: boolean;
  }> {
    const start = Date.now();
    const key = this.generateKey('whitelist', { userId, phone });
    
    try {
      // Multi-level lookup: exact match first, then pattern matching
      const cacheResult = await this.getWithStats<SmartWhitelist>(key);
      
      if (cacheResult) {
        // Verify cache entry is still valid
        if (cacheResult.isActive && (!cacheResult.expiresAt || new Date(cacheResult.expiresAt) > new Date())) {
          const duration = Date.now() - start;
          logger.debug('Fast whitelist lookup - cache hit', { 
            userId, 
            phone: this.maskPhone(phone), 
            duration: `${duration}ms`,
            cacheHit: true 
          });
          
          return {
            found: true,
            entry: cacheResult,
            cacheHit: true,
          };
        } else {
          // Invalid entry, remove from cache
          await this.invalidate('whitelist', { userId, phone });
        }
      }

      const duration = Date.now() - start;
      logger.debug('Fast whitelist lookup - cache miss', { 
        userId, 
        phone: this.maskPhone(phone), 
        duration: `${duration}ms`,
        cacheHit: false 
      });
      
      return {
        found: false,
        cacheHit: false,
      };
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Fast whitelist lookup failed', { 
        userId, 
        phone: this.maskPhone(phone), 
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return {
        found: false,
        cacheHit: false,
      };
    }
  }

  // Cache whitelist entry
  async cacheWhitelistEntry(entry: SmartWhitelist): Promise<void> {
    const key = this.generateKey('whitelist', { userId: entry.userId, phone: entry.contactPhone });
    const ttl = this.getTTL('whitelist');
    
    try {
      await this.setWithStats(key, entry, ttl);
      
      logger.debug('Whitelist entry cached', { 
        userId: entry.userId, 
        phone: this.maskPhone(entry.contactPhone),
        type: entry.whitelistType,
        ttl 
      });
    } catch (error) {
      logger.error('Failed to cache whitelist entry', { 
        userId: entry.userId, 
        phone: this.maskPhone(entry.contactPhone),
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Batch cache whitelist entries
  async cacheMultipleWhitelistEntries(entries: SmartWhitelist[]): Promise<void> {
    if (entries.length === 0) return;

    const start = Date.now();
    const keyValues: Record<string, string> = {};
    const ttl = this.getTTL('whitelist');

    for (const entry of entries) {
      const key = this.generateKey('whitelist', { userId: entry.userId, phone: entry.contactPhone });
      keyValues[key] = JSON.stringify(entry);
    }

    try {
      await redis.mset(keyValues);
      
      // Set expiration for each key (Redis doesn't support TTL with MSET)
      await Promise.all(
        Object.keys(keyValues).map(key => redis.expire(key, ttl))
      );

      const duration = Date.now() - start;
      logger.info('Batch cached whitelist entries', { 
        count: entries.length, 
        duration: `${duration}ms` 
      });
    } catch (error) {
      logger.error('Failed to batch cache whitelist entries', { 
        count: entries.length,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Cache spam profile
  async cacheSpamProfile(profile: SpamProfile): Promise<void> {
    const key = this.generateKey('spam_profile', { phoneHash: profile.phoneHash });
    const ttl = this.getTTL('spam_profile');
    
    try {
      await this.setWithStats(key, profile, ttl);
      
      logger.debug('Spam profile cached', { 
        phoneHash: profile.phoneHash.substring(0, 8) + '...',
        category: profile.spamCategory,
        riskScore: profile.riskScore,
        ttl 
      });
    } catch (error) {
      logger.error('Failed to cache spam profile', { 
        phoneHash: profile.phoneHash.substring(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Get spam profile from cache
  async getSpamProfile(phoneHash: string): Promise<SpamProfile | null> {
    const key = this.generateKey('spam_profile', { phoneHash });
    
    try {
      return await this.getWithStats<SpamProfile>(key);
    } catch (error) {
      logger.error('Failed to get spam profile from cache', { 
        phoneHash: phoneHash.substring(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  // Cache ML features
  async cacheMLFeatures(phoneHash: string, features: PhoneFeatures): Promise<void> {
    const key = this.generateKey('ml_features', { phoneHash });
    const ttl = this.getTTL('ml_features');
    
    try {
      await this.setWithStats(key, features, ttl);
      
      logger.debug('ML features cached', { 
        phoneHash: phoneHash.substring(0, 8) + '...',
        ttl 
      });
    } catch (error) {
      logger.error('Failed to cache ML features', { 
        phoneHash: phoneHash.substring(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Get ML features from cache
  async getMLFeatures(phoneHash: string): Promise<PhoneFeatures | null> {
    const key = this.generateKey('ml_features', { phoneHash });
    
    try {
      return await this.getWithStats<PhoneFeatures>(key);
    } catch (error) {
      logger.error('Failed to get ML features from cache', { 
        phoneHash: phoneHash.substring(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  // User configuration caching
  async cacheUserConfig(userId: string, config: Record<string, any>): Promise<void> {
    const key = this.generateKey('user_config', { userId });
    const ttl = this.getTTL('user_config');
    
    try {
      await this.setWithStats(key, config, ttl);
      
      logger.debug('User config cached', { userId, ttl });
    } catch (error) {
      logger.error('Failed to cache user config', { 
        userId,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Get user configuration from cache
  async getUserConfig(userId: string): Promise<Record<string, any> | null> {
    const key = this.generateKey('user_config', { userId });
    
    try {
      return await this.getWithStats<Record<string, any>>(key);
    } catch (error) {
      logger.error('Failed to get user config from cache', { 
        userId,
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  // Generic cache operations with statistics
  private async getWithStats<T>(key: string): Promise<T | null> {
    const result = await redis.getJson<T>(key);
    
    if (result) {
      this.recordHit(key);
    } else {
      this.recordMiss(key);
    }
    
    return result;
  }

  private async setWithStats<T>(key: string, data: T, ttl?: number): Promise<void> {
    await redis.setJson(key, data, ttl);
  }

  // Invalidation methods
  async invalidate(type: CacheKey['type'], params: Record<string, any>): Promise<void> {
    const key = this.generateKey(type, params);
    
    try {
      await redis.del(key);
      logger.debug('Cache invalidated', { key });
    } catch (error) {
      logger.error('Failed to invalidate cache', { 
        key,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  async invalidateUserCache(userId: string): Promise<void> {
    const patterns = [
      `${this.keyPrefix}whitelist:${userId}:*`,
      `${this.keyPrefix}user_config:${userId}`,
    ];
    
    try {
      for (const pattern of patterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(keys);
          logger.debug('User cache invalidated', { userId, keysRemoved: keys.length });
        }
      }
    } catch (error) {
      logger.error('Failed to invalidate user cache', { 
        userId,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  async invalidatePhoneCache(phone: string): Promise<void> {
    // This would require iterating through user patterns, which is expensive
    // In practice, we might use a reverse index or invalidate on demand
    logger.debug('Phone cache invalidation requested', { phone: this.maskPhone(phone) });
  }

  // Batch invalidation for performance
  async batchInvalidate(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;

    try {
      const deleted = await redis.del(keys);
      logger.debug('Batch cache invalidation completed', { keys: keys.length, deleted });
      return deleted;
    } catch (error) {
      logger.error('Batch cache invalidation failed', { 
        keys: keys.length,
        error: error instanceof Error ? error.message : String(error) 
      });
      return 0;
    }
  }

  // Statistics and monitoring
  private recordHit(key: string): void {
    const keyType = this.extractKeyType(key);
    this.hitStats.set(keyType, (this.hitStats.get(keyType) || 0) + 1);
  }

  private recordMiss(key: string): void {
    const keyType = this.extractKeyType(key);
    this.missStats.set(keyType, (this.missStats.get(keyType) || 0) + 1);
  }

  private extractKeyType(key: string): string {
    const parts = key.split(':');
    return parts.length > 1 ? parts[1] : 'unknown';
  }

  private logCacheStatistics(): void {
    const stats: Record<string, any> = {};
    
    for (const [type, hits] of this.hitStats.entries()) {
      const misses = this.missStats.get(type) || 0;
      const total = hits + misses;
      const hitRate = total > 0 ? (hits / total) : 0;
      
      stats[type] = {
        hits,
        misses,
        total,
        hitRate: Math.round(hitRate * 10000) / 10000, // 4 decimal places
      };
    }
    
    logger.info('Cache statistics', stats);
  }

  async getCacheStatistics(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    
    for (const [type, hits] of this.hitStats.entries()) {
      const misses = this.missStats.get(type) || 0;
      const total = hits + misses;
      const hitRate = total > 0 ? (hits / total) : 0;
      
      stats[type] = {
        hits,
        misses,
        total,
        hitRate,
      };
    }
    
    return stats;
  }

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; latency: number; hitRate: number }> {
    const redisHealth = await redis.healthCheck();
    
    // Calculate overall hit rate
    let totalHits = 0;
    let totalRequests = 0;
    
    for (const [type, hits] of this.hitStats.entries()) {
      const misses = this.missStats.get(type) || 0;
      totalHits += hits;
      totalRequests += hits + misses;
    }
    
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
    
    return {
      healthy: redisHealth.healthy,
      latency: redisHealth.latency,
      hitRate,
    };
  }

  // Utility methods
  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    return phone.substring(0, 4) + '*'.repeat(phone.length - 4);
  }

  // Cleanup methods
  async cleanup(): Promise<void> {
    try {
      // Clear expired entries (Redis handles this automatically, but we can be proactive)
      const patterns = [
        `${this.keyPrefix}whitelist:*`,
        `${this.keyPrefix}spam_profile:*`,
        `${this.keyPrefix}ml_features:*`,
        `${this.keyPrefix}user_config:*`,
      ];

      let totalCleaned = 0;
      for (const pattern of patterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          // Check TTL and remove expired keys
          for (const key of keys) {
            const ttl = await redis.ttl(key);
            if (ttl === -2) { // Key doesn't exist
              totalCleaned++;
            }
          }
        }
      }

      logger.info('Cache cleanup completed', { totalCleaned });
    } catch (error) {
      logger.error('Cache cleanup failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Preload frequently accessed data
  async preloadCache(): Promise<void> {
    logger.info('Cache preload started');
    // Implementation would depend on analytics of most frequently accessed patterns
    // This could include:
    // - Most active users' whitelist entries
    // - High-confidence spam profiles
    // - Common ML features
  }
}

export const cacheService = new CacheService();
export default cacheService;