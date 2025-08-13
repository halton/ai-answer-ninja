import { EventEmitter } from 'events';

export interface CacheConfig {
  defaultTTL: number;
  maxSize: number;
  checkPeriod: number;
  enableStatistics: boolean;
}

export interface CacheEntry<T> {
  value: T;
  expiry: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
}

export interface CacheStatistics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  totalSize: number;
  itemCount: number;
  hitRate: number;
}

export class CacheManager extends EventEmitter {
  private cache: Map<string, CacheEntry<any>>;
  private config: CacheConfig;
  private statistics: CacheStatistics;
  private cleanupInterval: NodeJS.Timeout | null;
  private currentSize: number;

  constructor(config?: Partial<CacheConfig>) {
    super();
    
    this.config = {
      defaultTTL: 3600, // 1 hour in seconds
      maxSize: 100 * 1024 * 1024, // 100MB
      checkPeriod: 60000, // 1 minute
      enableStatistics: true,
      ...config
    };

    this.cache = new Map();
    this.currentSize = 0;
    this.statistics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalSize: 0,
      itemCount: 0,
      hitRate: 0
    };

    this.cleanupInterval = null;
    this.startCleanupProcess();
  }

  /**
   * 设置缓存项
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const expiry = Date.now() + (ttl || this.config.defaultTTL) * 1000;
      const serializedValue = JSON.stringify(value);
      const size = this.calculateSize(serializedValue);

      // 检查是否需要清理空间
      await this.ensureSpace(size);

      const entry: CacheEntry<T> = {
        value,
        expiry,
        accessCount: 0,
        lastAccessed: Date.now(),
        size
      };

      // 如果键已存在，先减去旧的大小
      if (this.cache.has(key)) {
        const oldEntry = this.cache.get(key)!;
        this.currentSize -= oldEntry.size;
      }

      this.cache.set(key, entry);
      this.currentSize += size;

      if (this.config.enableStatistics) {
        this.statistics.sets++;
        this.statistics.totalSize = this.currentSize;
        this.statistics.itemCount = this.cache.size;
      }

      this.emit('set', { key, size, ttl });
    } catch (error) {
      this.emit('error', { operation: 'set', key, error });
      throw error;
    }
  }

  /**
   * 获取缓存项
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = this.cache.get(key);

      if (!entry) {
        if (this.config.enableStatistics) {
          this.statistics.misses++;
          this.updateHitRate();
        }
        this.emit('miss', { key });
        return null;
      }

      // 检查是否过期
      if (Date.now() > entry.expiry) {
        await this.delete(key);
        if (this.config.enableStatistics) {
          this.statistics.misses++;
          this.updateHitRate();
        }
        this.emit('expired', { key });
        return null;
      }

      // 更新访问统计
      entry.accessCount++;
      entry.lastAccessed = Date.now();

      if (this.config.enableStatistics) {
        this.statistics.hits++;
        this.updateHitRate();
      }

      this.emit('hit', { key, accessCount: entry.accessCount });
      return entry.value;
    } catch (error) {
      this.emit('error', { operation: 'get', key, error });
      throw error;
    }
  }

  /**
   * 删除缓存项
   */
  async delete(key: string): Promise<boolean> {
    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        return false;
      }

      this.cache.delete(key);
      this.currentSize -= entry.size;

      if (this.config.enableStatistics) {
        this.statistics.deletes++;
        this.statistics.totalSize = this.currentSize;
        this.statistics.itemCount = this.cache.size;
      }

      this.emit('delete', { key, size: entry.size });
      return true;
    } catch (error) {
      this.emit('error', { operation: 'delete', key, error });
      throw error;
    }
  }

  /**
   * 检查键是否存在
   */
  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // 检查是否过期
    if (Date.now() > entry.expiry) {
      await this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 获取多个缓存项
   */
  async mget<T>(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    for (const key of keys) {
      const value = await this.get<T>(key);
      results.set(key, value);
    }

    return results;
  }

  /**
   * 设置多个缓存项
   */
  async mset<T>(entries: Map<string, { value: T; ttl?: number }>): Promise<void> {
    for (const [key, { value, ttl }] of entries) {
      await this.set(key, value, ttl);
    }
  }

  /**
   * 删除多个缓存项
   */
  async mdel(keys: string[]): Promise<number> {
    let deletedCount = 0;

    for (const key of keys) {
      const deleted = await this.delete(key);
      if (deleted) deletedCount++;
    }

    return deletedCount;
  }

  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    const itemCount = this.cache.size;
    this.cache.clear();
    this.currentSize = 0;

    if (this.config.enableStatistics) {
      this.statistics.totalSize = 0;
      this.statistics.itemCount = 0;
    }

    this.emit('clear', { itemCount });
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return this.currentSize;
  }

  /**
   * 获取缓存项数量
   */
  getItemCount(): number {
    return this.cache.size;
  }

  /**
   * 获取统计信息
   */
  getStatistics(): CacheStatistics {
    return { ...this.statistics };
  }

  /**
   * 重置统计信息
   */
  resetStatistics(): void {
    this.statistics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalSize: this.currentSize,
      itemCount: this.cache.size,
      hitRate: 0
    };
  }

  /**
   * 获取缓存键列表
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取匹配模式的键
   */
  getKeysByPattern(pattern: string): string[] {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return this.getKeys().filter(key => regex.test(key));
  }

  /**
   * 设置过期时间
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    entry.expiry = Date.now() + ttl * 1000;
    return true;
  }

  /**
   * 获取剩余生存时间
   */
  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return -2; // Key not found
    }

    const remaining = entry.expiry - Date.now();
    
    if (remaining <= 0) {
      await this.delete(key);
      return -2;
    }

    return Math.floor(remaining / 1000);
  }

  /**
   * 计算对象大小
   */
  private calculateSize(serializedValue: string): number {
    return Buffer.byteLength(serializedValue, 'utf8');
  }

  /**
   * 确保有足够空间
   */
  private async ensureSpace(requiredSize: number): Promise<void> {
    if (this.currentSize + requiredSize <= this.config.maxSize) {
      return;
    }

    // 需要清理空间
    const targetSize = this.config.maxSize * 0.8; // 清理到80%
    const needToFree = this.currentSize + requiredSize - targetSize;

    await this.evictLRU(needToFree);
  }

  /**
   * LRU清理
   */
  private async evictLRU(sizeToFree: number): Promise<void> {
    const entries = Array.from(this.cache.entries());
    
    // 按最后访问时间排序
    entries.sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    let freedSize = 0;
    let evictedCount = 0;

    for (const [key, entry] of entries) {
      if (freedSize >= sizeToFree) {
        break;
      }

      await this.delete(key);
      freedSize += entry.size;
      evictedCount++;
    }

    if (this.config.enableStatistics) {
      this.statistics.evictions += evictedCount;
    }

    this.emit('eviction', { evictedCount, freedSize });
  }

  /**
   * 更新命中率
   */
  private updateHitRate(): void {
    const total = this.statistics.hits + this.statistics.misses;
    this.statistics.hitRate = total > 0 ? this.statistics.hits / total : 0;
  }

  /**
   * 启动清理进程
   */
  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, this.config.checkPeriod);
  }

  /**
   * 清理过期项
   */
  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        expiredKeys.push(key);
      }
    }

    let cleanedSize = 0;
    for (const key of expiredKeys) {
      const entry = this.cache.get(key);
      if (entry) {
        cleanedSize += entry.size;
        await this.delete(key);
      }
    }

    if (expiredKeys.length > 0) {
      this.emit('cleanup', { 
        expiredCount: expiredKeys.length, 
        cleanedSize 
      });
    }
  }

  /**
   * 预热缓存
   */
  async warmup(dataLoader: (key: string) => Promise<any>, keys: string[]): Promise<void> {
    const promises = keys.map(async (key) => {
      try {
        const data = await dataLoader(key);
        await this.set(key, data);
      } catch (error) {
        this.emit('warmupError', { key, error });
      }
    });

    await Promise.allSettled(promises);
    this.emit('warmupComplete', { keyCount: keys.length });
  }

  /**
   * 获取缓存健康状态
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    metrics: {
      memoryUsage: number;
      hitRate: number;
      itemCount: number;
      avgAccessCount: number;
    };
  } {
    const memoryUsagePercent = this.currentSize / this.config.maxSize;
    const avgAccessCount = this.cache.size > 0 
      ? Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.accessCount, 0) / this.cache.size 
      : 0;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (memoryUsagePercent > 0.9 || this.statistics.hitRate < 0.5) {
      status = 'critical';
    } else if (memoryUsagePercent > 0.7 || this.statistics.hitRate < 0.7) {
      status = 'warning';
    }

    return {
      status,
      metrics: {
        memoryUsage: memoryUsagePercent,
        hitRate: this.statistics.hitRate,
        itemCount: this.cache.size,
        avgAccessCount
      }
    };
  }

  /**
   * 导出缓存数据
   */
  async export(): Promise<{ [key: string]: any }> {
    const exported: { [key: string]: any } = {};
    
    for (const [key, entry] of this.cache) {
      if (Date.now() <= entry.expiry) {
        exported[key] = {
          value: entry.value,
          expiry: entry.expiry,
          accessCount: entry.accessCount
        };
      }
    }
    
    return exported;
  }

  /**
   * 导入缓存数据
   */
  async import(data: { [key: string]: any }): Promise<void> {
    for (const [key, item] of Object.entries(data)) {
      if (item.expiry > Date.now()) {
        const ttl = Math.floor((item.expiry - Date.now()) / 1000);
        await this.set(key, item.value, ttl);
        
        // 恢复访问统计
        const entry = this.cache.get(key);
        if (entry) {
          entry.accessCount = item.accessCount || 0;
        }
      }
    }
  }

  /**
   * 关闭缓存管理器
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.emit('shutdown', { 
      finalSize: this.currentSize,
      finalItemCount: this.cache.size,
      statistics: this.statistics
    });
  }
}

export default CacheManager;