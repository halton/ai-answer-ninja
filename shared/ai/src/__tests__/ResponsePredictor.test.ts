import { ResponsePredictor } from '../prediction/ResponsePredictor';
import { SmartCache } from '../cache/SmartCache';
import { PredictionContext } from '../types';
import { mockRedisClient } from './setup';

describe('ResponsePredictor', () => {
  let predictor: ResponsePredictor;
  let cache: SmartCache;
  let mockContext: PredictionContext;

  beforeEach(() => {
    cache = new SmartCache(mockRedisClient);
    predictor = new ResponsePredictor(cache);
    
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
        text: '你好，我想推荐一个产品给你',
        timestamp: Date.now(),
        intent: { category: 'sales_call', confidence: 0.85 }
      }],
      userProfile: {
        personality: 'polite',
        spamCategories: ['sales_call']
      }
    };
  });

  describe('predictResponse', () => {
    it('应该预测销售电话的响应', async () => {
      const result = await predictor.predictResponse(mockContext);

      expect(result).toBeDefined();
      expect(result.intent.category).toBe('sales_call');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.suggestedResponse).toBeTruthy();
      expect(['precomputed', 'template', 'generated']).toContain(result.responseType);
    });

    it('应该根据用户个性调整响应', async () => {
      const politeContext = { ...mockContext, userProfile: { ...mockContext.userProfile!, personality: 'polite' } };
      const directContext = { ...mockContext, userProfile: { ...mockContext.userProfile!, personality: 'direct' } };

      const politeResult = await predictor.predictResponse(politeContext);
      const directResult = await predictor.predictResponse(directContext);

      expect(politeResult.suggestedResponse).toBeTruthy();
      expect(directResult.suggestedResponse).toBeTruthy();
      // 直接性格的回复通常更短
      expect(directResult.suggestedResponse.length).toBeLessThanOrEqual(politeResult.suggestedResponse.length);
    });

    it('应该处理贷款推销电话', async () => {
      const loanContext = {
        ...mockContext,
        conversationHistory: [{
          speaker: 'user',
          text: '我们有低利息贷款，你需要吗？',
          timestamp: Date.now(),
          intent: { category: 'loan_offer', confidence: 0.9 }
        }],
        recentIntents: [{ category: 'loan_offer', confidence: 0.9, urgency: 'medium' }]
      };

      const result = await predictor.predictResponse(loanContext);

      expect(result.intent.category).toBe('loan_offer');
      expect(result.suggestedResponse).toContain('贷款');
    });

    it('应该处理投资推销电话', async () => {
      const investmentContext = {
        ...mockContext,
        conversationHistory: [{
          speaker: 'user',
          text: '我们有一个很好的投资机会，收益很高',
          timestamp: Date.now(),
          intent: { category: 'investment_pitch', confidence: 0.85 }
        }],
        recentIntents: [{ category: 'investment_pitch', confidence: 0.85, urgency: 'medium' }]
      };

      const result = await predictor.predictResponse(investmentContext);

      expect(result.intent.category).toBe('investment_pitch');
      expect(result.suggestedResponse).toMatch(/投资|理财|不感兴趣/);
    });

    it('应该处理未知意图', async () => {
      const unknownContext = {
        ...mockContext,
        conversationHistory: [{
          speaker: 'user',
          text: '这是一些模糊不清的内容',
          timestamp: Date.now()
        }],
        recentIntents: []
      };

      const result = await predictor.predictResponse(unknownContext);

      expect(result.intent.category).toBe('unknown');
      expect(result.confidence).toBeLessThan(0.8);
      expect(result.suggestedResponse).toBeTruthy();
    });

    it('应该处理幽默性格的回复', async () => {
      const humorousContext = {
        ...mockContext,
        userProfile: { 
          ...mockContext.userProfile!,
          personality: 'humorous' 
        }
      };

      const result = await predictor.predictResponse(humorousContext);

      expect(result.suggestedResponse).toBeTruthy();
      // 幽默回复通常包含一些轻松的词汇
      expect(result.suggestedResponse).toMatch(/哈哈|钱包|减肥|花呗|投资不起/);
    });

    it('应该使用缓存的结果', async () => {
      // 第一次调用
      const result1 = await predictor.predictResponse(mockContext);
      
      // 第二次调用应该更快（使用缓存）
      const startTime = Date.now();
      const result2 = await predictor.predictResponse(mockContext);
      const latency = Date.now() - startTime;

      expect(result1.suggestedResponse).toBe(result2.suggestedResponse);
      expect(latency).toBeLessThan(50); // 缓存命中应该很快
    });
  });

  describe('updateBehaviorPattern', () => {
    it('应该更新用户行为模式', async () => {
      const userId = 'test-user-123';
      const response = '我不需要这个服务';

      await expect(predictor.updateBehaviorPattern(userId, mockContext, response))
        .resolves.not.toThrow();
    });
  });
});