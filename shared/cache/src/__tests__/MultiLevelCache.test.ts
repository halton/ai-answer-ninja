/**
 * 多级缓存系统测试
 */

import { MultiLevelCache } from '../core/MultiLevelCache';
import { CacheConfig } from '../types';

describe('MultiLevelCache', () => {
  let cache: MultiLevelCache;
  let mockConfig: CacheConfig;

  beforeEach(() => {
    mockConfig = {
      l1: {
        maxSize: 100,
        ttl: 30000,
        checkPeriod: 60
      },
      l2: {
        host: 'localhost',
        port: 6379,
        ttl: 3600
      },
      l3: {
        enabled: false
      },
      compression: {
        enabled: false,
        threshold: 1024,
        algorithm: 'gzip'
      },
      monitoring: {
        enabled: false,
        alertThresholds: {
          hitRatio: 0.7,
          errorRate: 0.05,
          latency: 1000
        }
      }
    };

    cache = new MultiLevelCache(mockConfig);
  });

  afterEach(async () => {
    if (cache) {
      await cache.close();
    }
  });

  describe('Basic Operations', () => {
    test('should initialize successfully', async () => {
      await expect(cache.initialize()).resolves.not.toThrow();
    });

    test('should set and get values', async () => {
      await cache.initialize();
      
      const key = { namespace: 'test', key: 'simple-key' };
      const value = { data: 'test-value', timestamp: Date.now() };

      const setResult = await cache.set(key, value);
      expect(setResult).toBe(true);

      const getValue = await cache.get(key);
      expect(getValue).toEqual(value);
    });

    test('should handle cache miss', async () => {
      await cache.initialize();
      
      const key = { namespace: 'test', key: 'non-existent' };
      const getValue = await cache.get(key);
      
      expect(getValue).toBeNull();
    });

    test('should use fallback function on cache miss', async () => {
      await cache.initialize();
      
      const key = { namespace: 'test', key: 'fallback-test' };
      const fallbackValue = { data: 'fallback-data' };
      
      const fallbackFn = jest.fn().mockResolvedValue(fallbackValue);
      
      const result = await cache.get(key, fallbackFn);
      
      expect(result).toEqual(fallbackValue);
      expect(fallbackFn).toHaveBeenCalledTimes(1);
    });

    test('should delete values', async () => {
      await cache.initialize();
      
      const key = { namespace: 'test', key: 'delete-test' };
      const value = { data: 'to-be-deleted' };

      await cache.set(key, value);
      expect(await cache.get(key)).toEqual(value);

      const deleteResult = await cache.delete(key);
      expect(deleteResult).toBe(true);
      
      expect(await cache.get(key)).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    test('should handle batch get operations', async () => {
      await cache.initialize();
      
      const keys = [
        { namespace: 'test', key: 'batch-1' },
        { namespace: 'test', key: 'batch-2' },
        { namespace: 'test', key: 'batch-3' }
      ];

      // Set some values
      await cache.set(keys[0], { data: 'value-1' });
      await cache.set(keys[1], { data: 'value-2' });
      // keys[2] intentionally not set

      const results = await cache.mget(keys);
      
      expect(results.size).toBe(3);
      expect(results.get('test:batch-1')).toEqual({ data: 'value-1' });
      expect(results.get('test:batch-2')).toEqual({ data: 'value-2' });
      expect(results.get('test:batch-3')).toBeNull();
    });

    test('should handle batch set operations', async () => {
      await cache.initialize();
      
      const entries = [
        { key: { namespace: 'test', key: 'mset-1' }, value: { data: 'value-1' } },
        { key: { namespace: 'test', key: 'mset-2' }, value: { data: 'value-2' } },
        { key: { namespace: 'test', key: 'mset-3' }, value: { data: 'value-3' } }
      ];

      const result = await cache.mset(entries);
      expect(result).toBe(true);

      // Verify values were set
      for (const entry of entries) {
        const value = await cache.get(entry.key);
        expect(value).toEqual(entry.value);
      }
    });
  });

  describe('TTL and Expiration', () => {
    test('should respect TTL settings', async () => {
      await cache.initialize();
      
      const key = { namespace: 'test', key: 'ttl-test' };
      const value = { data: 'expires-soon' };
      
      // Set with very short TTL for testing
      await cache.set(key, value, { ttl: 1 }); // 1 second
      
      // Should be available immediately
      expect(await cache.get(key)).toEqual(value);
      
      // Wait for expiration (with some buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired now
      expect(await cache.get(key)).toBeNull();
    });
  });

  describe('Health and Metrics', () => {
    test('should provide health status', async () => {
      await cache.initialize();
      
      const health = await cache.getHealthStatus();
      
      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('levels');
      expect(health).toHaveProperty('lastCheck');
      expect(health.levels).toHaveProperty('l1');
      expect(health.levels).toHaveProperty('l2');
    });

    test('should provide metrics', async () => {
      await cache.initialize();
      
      // Generate some cache activity
      await cache.set({ namespace: 'test', key: 'metrics-1' }, { data: 'value-1' });
      await cache.get({ namespace: 'test', key: 'metrics-1' });
      await cache.get({ namespace: 'test', key: 'non-existent' });
      
      const metrics = await cache.getMetrics();
      
      expect(metrics).toHaveProperty('l1');
      expect(metrics).toHaveProperty('l2');
      expect(metrics).toHaveProperty('overall');
      expect(metrics.overall).toHaveProperty('hitRatio');
      expect(metrics.overall).toHaveProperty('totalRequests');
    });
  });

  describe('Error Handling', () => {
    test('should handle Redis connection errors gracefully', async () => {
      // This test would fail if Redis is not available, but should handle gracefully
      await cache.initialize();
      
      const key = { namespace: 'test', key: 'error-test' };
      const value = { data: 'test-data' };
      
      // Should not throw even if Redis is unavailable
      await expect(cache.set(key, value)).resolves.toBeDefined();
      await expect(cache.get(key)).resolves.toBeDefined();
    });

    test('should validate cache keys', async () => {
      await cache.initialize();
      
      const invalidKey = { namespace: '', key: '' };
      const value = { data: 'test' };
      
      // Should handle empty keys gracefully
      await expect(cache.set(invalidKey, value)).resolves.toBeDefined();
    });
  });

  describe('Cleanup and Shutdown', () => {
    test('should close cleanly', async () => {
      await cache.initialize();
      
      // Add some data
      await cache.set({ namespace: 'test', key: 'cleanup' }, { data: 'test' });
      
      // Should close without errors
      await expect(cache.close()).resolves.not.toThrow();
    });
  });
});