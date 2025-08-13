import { AIPerformanceManager } from '../index';
import { PredictionContext } from '../types';
import { mockRedisClient, mockDbClient } from './setup';

describe('AIPerformanceManager', () => {
  let manager: AIPerformanceManager;
  let mockContext: PredictionContext;

  beforeEach(() => {
    manager = new AIPerformanceManager(mockRedisClient, mockDbClient);
    mockContext = {
      userId: 'test-user-123',
      callerPhone: '13800138000',
      recentIntents: [{
        category: 'sales_call',
        confidence: 0.9,
        urgency: 'low'
      }],
      conversationHistory: [{
        speaker: 'user',
        text: '你好，我想了解一下你们的产品',
        timestamp: Date.now(),
        confidence: 0.95
      }],
      userProfile: {
        personality: 'polite',
        spamCategories: ['sales_call']
      }
    };
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('generateOptimizedResponse', () => {
    it('应该生成优化的响应', async () => {
      const result = await manager.generateOptimizedResponse(mockContext);

      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
      expect(typeof result.latency).toBe('number');
      expect(Array.isArray(result.optimizations)).toBe(true);
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.fromCache).toBe('boolean');
    });

    it('应该在低置信度时返回备用响应', async () => {
      const lowConfidenceContext = {
        ...mockContext,
        recentIntents: [{
          category: 'unknown',
          confidence: 0.1
        }]
      };

      const result = await manager.generateOptimizedResponse(lowConfidenceContext);

      expect(result.response).toContain('不好意思');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('warmupCaches', () => {
    it('应该预热多个用户的缓存', async () => {
      const userIds = ['user1', 'user2', 'user3'];
      
      const result = await manager.warmupCaches(userIds);

      expect(result).toBeDefined();
      expect(typeof result.successful).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(typeof result.totalTime).toBe('number');
      expect(result.successful + result.failed).toBe(userIds.length);
    });
  });

  describe('getPerformanceReport', () => {
    it('应该返回完整的性能报告', () => {
      const report = manager.getPerformanceReport();

      expect(report).toBeDefined();
      expect(report.overall).toBeDefined();
      expect(report.optimization).toBeDefined();
      expect(report.cache).toBeDefined();
      expect(report.precompute).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('应该返回系统健康状态', async () => {
      const health = await manager.healthCheck();

      expect(health).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.components).toBeDefined();
      expect(health.metrics).toBeDefined();
    });
  });

  describe('adaptiveOptimization', () => {
    it('应该执行自适应优化', async () => {
      const result = await manager.adaptiveOptimization();

      expect(result).toBeDefined();
      expect(Array.isArray(result.adjustments)).toBe(true);
      expect(typeof result.expectedImprovement).toBe('number');
    });
  });

  describe('startSmartPrecompute', () => {
    it('应该启动智能预计算任务', async () => {
      const userIds = ['user1', 'user2'];
      
      await expect(manager.startSmartPrecompute(userIds)).resolves.not.toThrow();
    });
  });
});