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
        
        const audioBuffer = Buffer.from(l2Result, 'base64');\n        const entry: CacheEntry<Buffer> = {\n          data: audioBuffer,\n          timestamp: Date.now(),\n          accessCount: 1,\n          size: audioBuffer.length,\n        };\n        this.ttsCache.set(key, entry);\n        \n        return audioBuffer;\n      }\n    } catch (error) {\n      logger.warn({ error, key }, 'TTS L2 cache lookup failed');\n    }\n    \n    this.recordMiss('tts');\n    return null;\n  }\n\n  async setTtsAudio(text: string, audioBuffer: Buffer, voiceProfile?: string): Promise<void> {\n    if (!this.config.enabled) return;\n    \n    const key = this.keyBuilders.tts(text, voiceProfile);\n    const entry: CacheEntry<Buffer> = {\n      data: audioBuffer,\n      timestamp: Date.now(),\n      accessCount: 0,\n      size: audioBuffer.length,\n    };\n    \n    this.ttsCache.set(key, entry);\n    \n    // Store as base64 in Redis\n    const base64Audio = audioBuffer.toString('base64');\n    this.redis.set(key, base64Audio, this.config.ttl.ttsAudio).catch(error => {\n      logger.warn({ error, key }, 'Failed to store TTS audio in L2 cache');\n    });\n  }\n\n  // User Profile Cache Methods\n  async getUserProfile(userId: string): Promise<any | null> {\n    if (!this.config.enabled) return null;\n    \n    const key = this.keyBuilders.userProfile(userId);\n    \n    const l1Result = this.userProfileCache.get(key);\n    if (l1Result) {\n      this.recordHit('userProfile');\n      l1Result.accessCount++;\n      return l1Result.data;\n    }\n    \n    try {\n      const l2Result = await this.redis.get(key);\n      if (l2Result) {\n        this.recordHit('userProfile');\n        \n        const entry: CacheEntry<any> = {\n          data: l2Result,\n          timestamp: Date.now(),\n          accessCount: 1,\n          size: JSON.stringify(l2Result).length,\n        };\n        this.userProfileCache.set(key, entry);\n        \n        return l2Result;\n      }\n    } catch (error) {\n      logger.warn({ error, key }, 'User profile L2 cache lookup failed');\n    }\n    \n    this.recordMiss('userProfile');\n    return null;\n  }\n\n  async setUserProfile(userId: string, profile: any): Promise<void> {\n    if (!this.config.enabled) return;\n    \n    const key = this.keyBuilders.userProfile(userId);\n    const entry: CacheEntry<any> = {\n      data: profile,\n      timestamp: Date.now(),\n      accessCount: 0,\n      size: JSON.stringify(profile).length,\n    };\n    \n    this.userProfileCache.set(key, entry);\n    \n    this.redis.set(key, profile, this.config.ttl.userProfiles).catch(error => {\n      logger.warn({ error, key }, 'Failed to store user profile in L2 cache');\n    });\n  }\n\n  // Preloading and Warming Methods\n  async preloadCommonResponses(): Promise<void> {\n    if (!this.config.preloadingEnabled) return;\n    \n    const commonResponses = [\n      '您好，我现在不方便接听',\n      '谢谢，我不需要这个服务',\n      '我对您的产品不感兴趣',\n      '请不要再打电话给我',\n      '我已经有相关的服务了',\n      '现在不是合适的时候',\n      '我需要考虑一下',\n      '请发资料给我看看',\n    ];\n    \n    logger.info({ count: commonResponses.length }, 'Preloading common TTS responses');\n    \n    for (const response of commonResponses) {\n      const key = this.keyBuilders.tts(response);\n      if (!this.ttsCache.has(key)) {\n        this.preloadQueue.add(key);\n      }\n    }\n  }\n\n  async warmupCaches(): Promise<void> {\n    if (!this.config.preloadingEnabled) return;\n    \n    try {\n      // Preload common responses\n      await this.preloadCommonResponses();\n      \n      // Load frequently accessed user profiles\n      await this.preloadFrequentProfiles();\n      \n      logger.info({\n        preloadQueueSize: this.preloadQueue.size,\n      }, 'Cache warmup completed');\n      \n    } catch (error) {\n      logger.error({ error }, 'Cache warmup failed');\n    }\n  }\n\n  private async preloadFrequentProfiles(): Promise<void> {\n    try {\n      // Get list of frequently accessed user profiles from Redis\n      const frequentUsers = await this.redis.smembers('frequent_users');\n      \n      for (const userId of frequentUsers) {\n        const profile = await this.getUserProfile(userId);\n        if (profile) {\n          logger.debug({ userId }, 'Preloaded user profile');\n        }\n      }\n    } catch (error) {\n      logger.warn({ error }, 'Failed to preload frequent user profiles');\n    }\n  }\n\n  private startWarmupProcess(): void {\n    // Initial warmup\n    this.warmupCaches();\n    \n    // Periodic warmup every 30 minutes\n    this.warmupInterval = setInterval(() => {\n      this.warmupCaches();\n    }, 30 * 60 * 1000);\n  }\n\n  // Statistics and Monitoring\n  private recordHit(cacheType: string): void {\n    this.stats[cacheType].totalHits++;\n    this.updateHitRate(cacheType);\n  }\n\n  private recordMiss(cacheType: string): void {\n    this.stats[cacheType].totalMisses++;\n    this.updateHitRate(cacheType);\n  }\n\n  private updateHitRate(cacheType: string): void {\n    const stats = this.stats[cacheType];\n    const total = stats.totalHits + stats.totalMisses;\n    stats.hitRate = total > 0 ? stats.totalHits / total : 0;\n  }\n\n  public getCacheStats(): Record<string, CacheStats & { l1Size: number; l2Size?: number }> {\n    const result: Record<string, CacheStats & { l1Size: number; l2Size?: number }> = {};\n    \n    result.stt = { ...this.stats.stt, l1Size: this.sttCache.size };\n    result.intent = { ...this.stats.intent, l1Size: this.intentCache.size };\n    result.aiResponse = { ...this.stats.aiResponse, l1Size: this.aiResponseCache.size };\n    result.tts = { ...this.stats.tts, l1Size: this.ttsCache.size };\n    result.userProfile = { ...this.stats.userProfile, l1Size: this.userProfileCache.size };\n    \n    return result;\n  }\n\n  public getHealthStatus(): {\n    status: 'healthy' | 'degraded' | 'unhealthy';\n    details: any;\n  } {\n    const stats = this.getCacheStats();\n    const avgHitRate = Object.values(stats).reduce((sum, stat) => sum + stat.hitRate, 0) / Object.keys(stats).length;\n    \n    let status: 'healthy' | 'degraded' | 'unhealthy';\n    \n    if (avgHitRate > 0.7) {\n      status = 'healthy';\n    } else if (avgHitRate > 0.4) {\n      status = 'degraded';\n    } else {\n      status = 'unhealthy';\n    }\n    \n    return {\n      status,\n      details: {\n        averageHitRate: avgHitRate,\n        cacheStats: stats,\n        config: this.config,\n        uptime: Date.now() - (this.stats.stt?.totalHits + this.stats.stt?.totalMisses || 0),\n      },\n    };\n  }\n\n  // Cache Management\n  async invalidateCache(cacheType: string, pattern?: string): Promise<void> {\n    switch (cacheType) {\n      case 'stt':\n        this.sttCache.clear();\n        break;\n      case 'intent':\n        this.intentCache.clear();\n        break;\n      case 'aiResponse':\n        this.aiResponseCache.clear();\n        break;\n      case 'tts':\n        this.ttsCache.clear();\n        break;\n      case 'userProfile':\n        this.userProfileCache.clear();\n        break;\n      case 'all':\n        this.sttCache.clear();\n        this.intentCache.clear();\n        this.aiResponseCache.clear();\n        this.ttsCache.clear();\n        this.userProfileCache.clear();\n        break;\n    }\n    \n    logger.info({ cacheType, pattern }, 'Cache invalidated');\n  }\n\n  async shutdown(): Promise<void> {\n    if (this.warmupInterval) {\n      clearInterval(this.warmupInterval);\n      this.warmupInterval = undefined;\n    }\n    \n    // Clear all caches\n    await this.invalidateCache('all');\n    \n    logger.info('Cache Service shutdown completed');\n  }\n\n  // Utility methods\n  private hashText(text: string): string {\n    // Simple hash function for cache keys\n    let hash = 0;\n    for (let i = 0; i < text.length; i++) {\n      const char = text.charCodeAt(i);\n      hash = ((hash << 5) - hash) + char;\n      hash = hash & hash; // Convert to 32-bit integer\n    }\n    return Math.abs(hash).toString(36);\n  }\n\n  private hashAudio(audioBuffer: Buffer): string {\n    // Create a hash from audio buffer for caching\n    let hash = 0;\n    const step = Math.max(1, Math.floor(audioBuffer.length / 1000)); // Sample every nth byte\n    \n    for (let i = 0; i < audioBuffer.length; i += step) {\n      hash = ((hash << 5) - hash) + audioBuffer[i];\n      hash = hash & hash;\n    }\n    \n    return Math.abs(hash).toString(36);\n  }\n\n  // Public hash methods for external use\n  public createAudioHash(audioBuffer: Buffer): string {\n    return this.hashAudio(audioBuffer);\n  }\n\n  public createTextHash(text: string): string {\n    return this.hashText(text);\n  }\n\n  public createContextHash(context: any): string {\n    return this.hashText(JSON.stringify(context));\n  }\n}"