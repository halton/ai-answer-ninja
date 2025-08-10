import LRU from 'lru-cache';
import { RedisService } from './redis';
import logger from '../utils/logger';

interface CacheConfig {
  enabled: boolean;
  ttl: {
    sttResults: number;
    intentResults: number;
    aiResponses: number;
    ttsAudio: number;
    userProfiles: number;
  };
  maxSize: {
    sttResults: number;
    intentResults: number;
    aiResponses: number;
    ttsAudio: number;
    userProfiles: number;
  };
  compressionEnabled: boolean;
  preloadingEnabled: boolean;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
  size: number;
}

interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  totalSize: number;
  evictions: number;
}

export class CacheService {
  private config: CacheConfig;
  private redis: RedisService;
  
  // L1 Cache - In-memory LRU caches
  private sttCache: LRU<string, CacheEntry<string>>;
  private intentCache: LRU<string, CacheEntry<any>>;
  private aiResponseCache: LRU<string, CacheEntry<any>>;
  private ttsCache: LRU<string, CacheEntry<Buffer>>;
  private userProfileCache: LRU<string, CacheEntry<any>>;
  
  // Cache statistics
  private stats: Record<string, CacheStats> = {};
  
  // Preloading and warming
  private preloadQueue: Set<string> = new Set();
  private warmupInterval?: NodeJS.Timeout;
  
  // Cache key builders
  private keyBuilders = {
    stt: (audioHash: string, language: string = 'zh-CN') => `stt:${language}:${audioHash}`,
    intent: (text: string, userId: string) => `intent:${userId}:${this.hashText(text)}`,
    aiResponse: (intentHash: string, userHash: string, contextHash: string) => 
      `ai:${userHash}:${intentHash}:${contextHash}`,
    tts: (text: string, voiceProfile: string = 'default') => 
      `tts:${voiceProfile}:${this.hashText(text)}`,
    userProfile: (userId: string) => `profile:${userId}`,
  };

  constructor(redis: RedisService, config?: Partial<CacheConfig>) {
    this.redis = redis;
    this.config = {
      enabled: true,
      ttl: {
        sttResults: 3600, // 1 hour
        intentResults: 1800, // 30 minutes
        aiResponses: 900, // 15 minutes
        ttsAudio: 7200, // 2 hours
        userProfiles: 86400, // 24 hours
      },
      maxSize: {
        sttResults: 1000,
        intentResults: 2000,
        aiResponses: 500,
        ttsAudio: 100, // Audio files are larger
        userProfiles: 10000,
      },
      compressionEnabled: true,
      preloadingEnabled: true,
      ...config,
    };
    
    this.initializeCaches();
    this.initializeStats();
    
    if (this.config.preloadingEnabled) {
      this.startWarmupProcess();
    }
    
    logger.info('Cache Service initialized', { config: this.config });
  }

  private initializeCaches(): void {
    // STT Results Cache
    this.sttCache = new LRU({
      max: this.config.maxSize.sttResults,
      ttl: this.config.ttl.sttResults * 1000,
      updateAgeOnGet: true,
      allowStale: false,
    });

    // Intent Recognition Cache
    this.intentCache = new LRU({
      max: this.config.maxSize.intentResults,
      ttl: this.config.ttl.intentResults * 1000,
      updateAgeOnGet: true,
      allowStale: false,
    });

    // AI Response Cache
    this.aiResponseCache = new LRU({
      max: this.config.maxSize.aiResponses,
      ttl: this.config.ttl.aiResponses * 1000,
      updateAgeOnGet: true,
      allowStale: false,
    });

    // TTS Audio Cache
    this.ttsCache = new LRU({
      max: this.config.maxSize.ttsAudio,
      ttl: this.config.ttl.ttsAudio * 1000,
      updateAgeOnGet: true,
      allowStale: false,
      sizeCalculation: (entry) => entry.size,
    });

    // User Profile Cache
    this.userProfileCache = new LRU({
      max: this.config.maxSize.userProfiles,
      ttl: this.config.ttl.userProfiles * 1000,
      updateAgeOnGet: true,
      allowStale: false,
    });
  }

  private initializeStats(): void {
    const cacheTypes = ['stt', 'intent', 'aiResponse', 'tts', 'userProfile'];
    
    for (const type of cacheTypes) {
      this.stats[type] = {
        totalHits: 0,
        totalMisses: 0,
        hitRate: 0,
        totalSize: 0,
        evictions: 0,
      };
    }
  }

  // STT Cache Methods
  async getSttResult(audioHash: string, language?: string): Promise<string | null> {
    if (!this.config.enabled) return null;
    
    const key = this.keyBuilders.stt(audioHash, language);
    
    // L1 Cache check
    const l1Result = this.sttCache.get(key);
    if (l1Result) {
      this.recordHit('stt');
      l1Result.accessCount++;
      logger.debug({ key, accessCount: l1Result.accessCount }, 'STT L1 cache hit');
      return l1Result.data;
    }
    
    // L2 Cache check (Redis)
    try {
      const l2Result = await this.redis.get<string>(key);
      if (l2Result) {
        this.recordHit('stt');
        
        // Populate L1 cache
        const entry: CacheEntry<string> = {
          data: l2Result,
          timestamp: Date.now(),
          accessCount: 1,
          size: l2Result.length,
        };
        this.sttCache.set(key, entry);
        
        logger.debug({ key }, 'STT L2 cache hit, populated L1');
        return l2Result;
      }
    } catch (error) {
      logger.warn({ error, key }, 'STT L2 cache lookup failed');
    }
    
    this.recordMiss('stt');
    return null;
  }

  async setSttResult(audioHash: string, result: string, language?: string): Promise<void> {
    if (!this.config.enabled) return;
    
    const key = this.keyBuilders.stt(audioHash, language);
    const entry: CacheEntry<string> = {
      data: result,
      timestamp: Date.now(),
      accessCount: 0,
      size: result.length,
    };
    
    // Store in L1 cache
    this.sttCache.set(key, entry);
    
    // Store in L2 cache (Redis) asynchronously
    this.redis.set(key, result, this.config.ttl.sttResults).catch(error => {
      logger.warn({ error, key }, 'Failed to store STT result in L2 cache');
    });
    
    logger.debug({ key, resultLength: result.length }, 'STT result cached');
  }

  // Intent Cache Methods
  async getIntentResult(text: string, userId: string): Promise<any | null> {
    if (!this.config.enabled) return null;
    
    const key = this.keyBuilders.intent(text, userId);
    
    // L1 Cache check
    const l1Result = this.intentCache.get(key);
    if (l1Result) {
      this.recordHit('intent');
      l1Result.accessCount++;
      return l1Result.data;
    }
    
    // L2 Cache check
    try {
      const l2Result = await this.redis.get(key);
      if (l2Result) {
        this.recordHit('intent');
        
        const entry: CacheEntry<any> = {
          data: l2Result,
          timestamp: Date.now(),
          accessCount: 1,
          size: JSON.stringify(l2Result).length,
        };
        this.intentCache.set(key, entry);
        
        return l2Result;
      }
    } catch (error) {
      logger.warn({ error, key }, 'Intent L2 cache lookup failed');
    }
    
    this.recordMiss('intent');
    return null;
  }

  async setIntentResult(text: string, userId: string, result: any): Promise<void> {
    if (!this.config.enabled) return;
    
    const key = this.keyBuilders.intent(text, userId);
    const entry: CacheEntry<any> = {
      data: result,
      timestamp: Date.now(),
      accessCount: 0,
      size: JSON.stringify(result).length,
    };
    
    this.intentCache.set(key, entry);
    
    this.redis.set(key, result, this.config.ttl.intentResults).catch(error => {
      logger.warn({ error, key }, 'Failed to store intent result in L2 cache');
    });
  }

  // AI Response Cache Methods
  async getAiResponse(intentHash: string, userHash: string, contextHash: string): Promise<any | null> {
    if (!this.config.enabled) return null;
    
    const key = this.keyBuilders.aiResponse(intentHash, userHash, contextHash);
    
    const l1Result = this.aiResponseCache.get(key);
    if (l1Result) {
      this.recordHit('aiResponse');
      l1Result.accessCount++;
      return l1Result.data;
    }
    
    try {
      const l2Result = await this.redis.get(key);
      if (l2Result) {
        this.recordHit('aiResponse');
        
        const entry: CacheEntry<any> = {
          data: l2Result,
          timestamp: Date.now(),
          accessCount: 1,
          size: JSON.stringify(l2Result).length,
        };
        this.aiResponseCache.set(key, entry);
        
        return l2Result;
      }
    } catch (error) {
      logger.warn({ error, key }, 'AI response L2 cache lookup failed');
    }
    
    this.recordMiss('aiResponse');
    return null;
  }

  async setAiResponse(intentHash: string, userHash: string, contextHash: string, response: any): Promise<void> {
    if (!this.config.enabled) return;
    
    const key = this.keyBuilders.aiResponse(intentHash, userHash, contextHash);
    const entry: CacheEntry<any> = {
      data: response,
      timestamp: Date.now(),
      accessCount: 0,
      size: JSON.stringify(response).length,
    };
    
    this.aiResponseCache.set(key, entry);
    
    this.redis.set(key, response, this.config.ttl.aiResponses).catch(error => {
      logger.warn({ error, key }, 'Failed to store AI response in L2 cache');
    });
  }

  // TTS Cache Methods
  async getTtsAudio(text: string, voiceProfile?: string): Promise<Buffer | null> {
    if (!this.config.enabled) return null;
    
    const key = this.keyBuilders.tts(text, voiceProfile);
    
    const l1Result = this.ttsCache.get(key);
    if (l1Result) {
      this.recordHit('tts');
      l1Result.accessCount++;
      return l1Result.data;
    }
    
    try {
      // For TTS, we store audio as base64 in Redis
      const l2Result = await this.redis.get<string>(key);
      if (l2Result) {
        this.recordHit('tts');
        
        const audioBuffer = Buffer.from(l2Result, 'base64');
        const entry: CacheEntry<Buffer> = {
          data: audioBuffer,
          timestamp: Date.now(),
          accessCount: 1,
          size: audioBuffer.length,
        };
        this.ttsCache.set(key, entry);
        
        return audioBuffer;
      }
    } catch (error) {
      logger.warn({ error, key }, 'TTS L2 cache lookup failed');
    }
    
    this.recordMiss('tts');
    return null;
  }

  async setTtsAudio(text: string, audioBuffer: Buffer, voiceProfile?: string): Promise<void> {
    if (!this.config.enabled) return;
    
    const key = this.keyBuilders.tts(text, voiceProfile);
    const entry: CacheEntry<Buffer> = {
      data: audioBuffer,
      timestamp: Date.now(),
      accessCount: 0,
      size: audioBuffer.length,
    };
    
    this.ttsCache.set(key, entry);
    
    // Store as base64 in Redis
    const base64Audio = audioBuffer.toString('base64');
    this.redis.set(key, base64Audio, this.config.ttl.ttsAudio).catch(error => {
      logger.warn({ error, key }, 'Failed to store TTS audio in L2 cache');
    });
  }

  // User Profile Cache Methods
  async getUserProfile(userId: string): Promise<any | null> {
    if (!this.config.enabled) return null;
    
    const key = this.keyBuilders.userProfile(userId);
    
    const l1Result = this.userProfileCache.get(key);
    if (l1Result) {
      this.recordHit('userProfile');
      l1Result.accessCount++;
      return l1Result.data;
    }
    
    try {
      const l2Result = await this.redis.get(key);
      if (l2Result) {
        this.recordHit('userProfile');
        
        const entry: CacheEntry<any> = {
          data: l2Result,
          timestamp: Date.now(),
          accessCount: 1,
          size: JSON.stringify(l2Result).length,
        };
        this.userProfileCache.set(key, entry);
        
        return l2Result;
      }
    } catch (error) {
      logger.warn({ error, key }, 'User profile L2 cache lookup failed');
    }
    
    this.recordMiss('userProfile');
    return null;
  }

  async setUserProfile(userId: string, profile: any): Promise<void> {
    if (!this.config.enabled) return;
    
    const key = this.keyBuilders.userProfile(userId);
    const entry: CacheEntry<any> = {
      data: profile,
      timestamp: Date.now(),
      accessCount: 0,
      size: JSON.stringify(profile).length,
    };
    
    this.userProfileCache.set(key, entry);
    
    this.redis.set(key, profile, this.config.ttl.userProfiles).catch(error => {
      logger.warn({ error, key }, 'Failed to store user profile in L2 cache');
    });
  }

  // Preloading and Warming Methods
  async preloadCommonResponses(): Promise<void> {
    if (!this.config.preloadingEnabled) return;
    
    const commonResponses = [
      '您好，我现在不方便接听',
      '谢谢，我不需要这个服务',
      '我对您的产品不感兴趣',
      '请不要再打电话给我',
      '我已经有相关的服务了',
      '现在不是合适的时候',
      '我需要考虑一下',
      '请发资料给我看看',
    ];
    
    logger.info({ count: commonResponses.length }, 'Preloading common TTS responses');
    
    for (const response of commonResponses) {
      const key = this.keyBuilders.tts(response);
      if (!this.ttsCache.has(key)) {
        this.preloadQueue.add(key);
      }
    }
  }

  async warmupCaches(): Promise<void> {
    if (!this.config.preloadingEnabled) return;
    
    try {
      // Preload common responses
      await this.preloadCommonResponses();
      
      // Load frequently accessed user profiles
      await this.preloadFrequentProfiles();
      
      logger.info({
        preloadQueueSize: this.preloadQueue.size,
      }, 'Cache warmup completed');
      
    } catch (error) {
      logger.error({ error }, 'Cache warmup failed');
    }
  }

  private async preloadFrequentProfiles(): Promise<void> {
    try {
      // Get list of frequently accessed user profiles from Redis
      const frequentUsers = await this.redis.smembers('frequent_users');
      
      for (const userId of frequentUsers) {
        const profile = await this.getUserProfile(userId);
        if (profile) {
          logger.debug({ userId }, 'Preloaded user profile');
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to preload frequent user profiles');
    }
  }

  private startWarmupProcess(): void {
    // Initial warmup
    this.warmupCaches();
    
    // Periodic warmup every 30 minutes
    this.warmupInterval = setInterval(() => {
      this.warmupCaches();
    }, 30 * 60 * 1000);
  }

  // Statistics and Monitoring
  private recordHit(cacheType: string): void {
    this.stats[cacheType].totalHits++;
    this.updateHitRate(cacheType);
  }

  private recordMiss(cacheType: string): void {
    this.stats[cacheType].totalMisses++;
    this.updateHitRate(cacheType);
  }

  private updateHitRate(cacheType: string): void {
    const stats = this.stats[cacheType];
    const total = stats.totalHits + stats.totalMisses;
    stats.hitRate = total > 0 ? stats.totalHits / total : 0;
  }

  public getCacheStats(): Record<string, CacheStats & { l1Size: number; l2Size?: number }> {
    const result: Record<string, CacheStats & { l1Size: number; l2Size?: number }> = {};
    
    result.stt = { ...this.stats.stt, l1Size: this.sttCache.size };
    result.intent = { ...this.stats.intent, l1Size: this.intentCache.size };
    result.aiResponse = { ...this.stats.aiResponse, l1Size: this.aiResponseCache.size };
    result.tts = { ...this.stats.tts, l1Size: this.ttsCache.size };
    result.userProfile = { ...this.stats.userProfile, l1Size: this.userProfileCache.size };
    
    return result;
  }

  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: any;
  } {
    const stats = this.getCacheStats();
    const avgHitRate = Object.values(stats).reduce((sum, stat) => sum + stat.hitRate, 0) / Object.keys(stats).length;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (avgHitRate > 0.7) {
      status = 'healthy';
    } else if (avgHitRate > 0.4) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }
    
    return {
      status,
      details: {
        averageHitRate: avgHitRate,
        cacheStats: stats,
        config: this.config,
        uptime: Date.now() - (this.stats.stt?.totalHits + this.stats.stt?.totalMisses || 0),
      },
    };
  }

  // Cache Management
  async invalidateCache(cacheType: string, pattern?: string): Promise<void> {
    switch (cacheType) {
      case 'stt':
        this.sttCache.clear();
        break;
      case 'intent':
        this.intentCache.clear();
        break;
      case 'aiResponse':
        this.aiResponseCache.clear();
        break;
      case 'tts':
        this.ttsCache.clear();
        break;
      case 'userProfile':
        this.userProfileCache.clear();
        break;
      case 'all':
        this.sttCache.clear();
        this.intentCache.clear();
        this.aiResponseCache.clear();
        this.ttsCache.clear();
        this.userProfileCache.clear();
        break;
    }
    
    logger.info({ cacheType, pattern }, 'Cache invalidated');
  }

  async shutdown(): Promise<void> {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = undefined;
    }
    
    // Clear all caches
    await this.invalidateCache('all');
    
    logger.info('Cache Service shutdown completed');
  }

  // Utility methods
  private hashText(text: string): string {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private hashAudio(audioBuffer: Buffer): string {
    // Create a hash from audio buffer for caching
    let hash = 0;
    const step = Math.max(1, Math.floor(audioBuffer.length / 1000)); // Sample every nth byte
    
    for (let i = 0; i < audioBuffer.length; i += step) {
      hash = ((hash << 5) - hash) + audioBuffer[i];
      hash = hash & hash;
    }
    
    return Math.abs(hash).toString(36);
  }

  // Public hash methods for external use
  public createAudioHash(audioBuffer: Buffer): string {
    return this.hashAudio(audioBuffer);
  }

  public createTextHash(text: string): string {
    return this.hashText(text);
  }

  public createContextHash(context: any): string {
    return this.hashText(JSON.stringify(context));
  }
}"