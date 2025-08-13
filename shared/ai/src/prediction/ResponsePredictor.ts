import {
  PredictionContext,
  Intent,
  PredictionResult,
  ResponseTemplate,
  BehaviorPattern,
  ConversationTurn,
  UserProfile
} from '../types';
import { SmartCache } from '../cache/SmartCache';
import { Logger } from '../utils/Logger';

export class ResponsePredictor {
  private cache: SmartCache;
  private logger: Logger;
  private templates: Map<string, ResponseTemplate[]> = new Map();
  private behaviorPatterns: Map<string, BehaviorPattern[]> = new Map();

  constructor(cache: SmartCache) {
    this.cache = cache;
    this.logger = new Logger('ResponsePredictor');
    this.initializeTemplates();
    this.loadBehaviorPatterns();
  }

  async predictResponse(context: PredictionContext): Promise<PredictionResult> {
    const startTime = Date.now();
    
    try {
      const cacheKey = this.generateCacheKey(context);
      const cachedResult = await this.cache.get(cacheKey);
      
      if (cachedResult) {
        this.logger.info('Cache hit for prediction', { cacheKey, latency: Date.now() - startTime });
        return cachedResult as PredictionResult;
      }

      const predictedIntent = await this.predictIntent(context);
      const responseStrategy = await this.selectResponseStrategy(predictedIntent, context);
      const suggestedResponse = await this.generateResponse(responseStrategy, context);
      
      const result: PredictionResult = {
        intent: predictedIntent,
        confidence: this.calculateOverallConfidence(predictedIntent, responseStrategy),
        suggestedResponse,
        responseType: responseStrategy.type,
        cacheable: responseStrategy.cacheable,
        ttl: responseStrategy.ttl
      };

      if (result.cacheable) {
        await this.cache.set(cacheKey, result, result.ttl || 3600);
      }

      return result;
    } catch (error) {
      this.logger.error('Prediction failed', error);
      return this.getFallbackResponse(context);
    }
  }

  private async predictIntent(context: PredictionContext): Promise<Intent> {
    const keywordIntent = await this.keywordBasedClassification(context.conversationHistory);
    const patternIntent = await this.patternBasedPrediction(context);
    const profileAdjustedIntent = await this.adjustIntentByProfile(
      keywordIntent, 
      patternIntent, 
      context.userProfile
    );

    return profileAdjustedIntent;
  }

  private async keywordBasedClassification(history: ConversationTurn[]): Promise<Intent> {
    const patterns: Record<string, { keywords: string[], weight: number }> = {
      'sales_call': {
        keywords: ['产品', '促销', '优惠', '活动', '了解一下'],
        weight: 0.3
      },
      'loan_offer': {
        keywords: ['贷款', '借钱', '利息', '额度', '征信', '放款'],
        weight: 0.4
      },
      'investment_pitch': {
        keywords: ['投资', '理财', '收益', '股票', '基金', '赚钱'],
        weight: 0.35
      }
    };

    const recentText = history.slice(-3).map(turn => turn.text).join(' ');
    let maxScore = 0;
    let predictedIntent = 'unknown';

    Object.entries(patterns).forEach(([intent, config]) => {
      const score = this.calculateKeywordScore(recentText, config.keywords) * config.weight;
      if (score > maxScore) {
        maxScore = score;
        predictedIntent = intent;
      }
    });

    return {
      category: predictedIntent,
      confidence: Math.min(maxScore, 0.95),
      emotionalTone: 'neutral',
      urgency: 'medium'
    };
  }

  private async patternBasedPrediction(context: PredictionContext): Promise<Intent> {
    const userPatterns = this.behaviorPatterns.get(context.userId) || [];
    
    if (userPatterns.length === 0) {
      return { category: 'unknown', confidence: 0.0 };
    }

    return {
      category: 'sales_call',
      confidence: 0.7
    };
  }

  private async selectResponseStrategy(intent: Intent, context: PredictionContext): Promise<{
    type: 'precomputed' | 'template' | 'generated';
    cacheable: boolean;
    ttl?: number;
    template?: ResponseTemplate;
  }> {
    return {
      type: 'template',
      cacheable: true,
      ttl: 3600
    };
  }

  private async generateResponse(strategy: any, context: PredictionContext): Promise<string> {
    const personality = context.userProfile?.personality || 'polite';
    const intent = context.recentIntents[0]?.category || 'unknown';

    const responses: Record<string, Record<string, string>> = {
      polite: {
        sales_call: '谢谢您的来电，我现在不需要这个服务。',
        loan_offer: '感谢您的推荐，我暂时没有贷款需求。',
        investment_pitch: '谢谢分享，我有自己的理财规划。'
      },
      direct: {
        sales_call: '我不需要，请不要再打扰。',
        loan_offer: '不需要贷款，谢谢。',
        investment_pitch: '对投资不感兴趣。'
      },
      humorous: {
        sales_call: '哈哈，我的钱包比较害羞，不喜欢出来见人。',
        loan_offer: '我连花呗都还不起，你还想借钱给我？',
        investment_pitch: '投资？我连今晚吃什么都投资不起。'
      },
      professional: {
        sales_call: '感谢您的来电，我已经有固定的供应商。',
        loan_offer: '谢谢您的推荐，我有自己的财务顾问。',
        investment_pitch: '感谢分享，我有固定的投资策略。'
      }
    };

    return responses[personality]?.[intent] || '不好意思，我现在不方便。';
  }

  private initializeTemplates(): void {
    // 简化的模板初始化
  }

  private async loadBehaviorPatterns(): Promise<void> {
    // 简化的行为模式加载
  }

  private calculateKeywordScore(text: string, keywords: string[]): number {
    const textLower = text.toLowerCase();
    const matches = keywords.filter(keyword => 
      textLower.includes(keyword.toLowerCase())
    );
    return matches.length / keywords.length;
  }

  private generateCacheKey(context: PredictionContext): string {
    const recentIntents = context.recentIntents.slice(-2).map(i => i.category).join('_');
    const personality = context.userProfile?.personality || 'default';
    return `prediction_${context.userId}_${recentIntents}_${personality}`;
  }

  private calculateOverallConfidence(intent: Intent, strategy: any): number {
    return Math.min(intent.confidence * 0.85, 0.99);
  }

  private getFallbackResponse(context: PredictionContext): PredictionResult {
    return {
      intent: { category: 'unknown', confidence: 0.0 },
      confidence: 0.1,
      suggestedResponse: this.getDefaultResponse(context.userProfile?.personality),
      responseType: 'template',
      cacheable: false
    };
  }

  private getDefaultResponse(personality?: string): string {
    const defaults: Record<string, string> = {
      polite: '不好意思，我现在不方便，谢谢您的来电。',
      direct: '我不需要，请不要再打电话。',
      humorous: '今天不是购物的好日子，改天吧。',
      professional: '谢谢您的来电，我会考虑的。'
    };

    return defaults[personality || 'polite'];
  }

  private async adjustIntentByProfile(
    keywordIntent: Intent, 
    patternIntent: Intent, 
    profile?: UserProfile
  ): Promise<Intent> {
    if (!profile) return keywordIntent;

    const categoryBonus = profile.spamCategories.includes(keywordIntent.category) ? 0.1 : 0;
    const combinedConfidence = (keywordIntent.confidence * 0.6) + 
                              (patternIntent.confidence * 0.4) + 
                              categoryBonus;

    return {
      category: keywordIntent.confidence > patternIntent.confidence ? 
                keywordIntent.category : patternIntent.category,
      confidence: Math.min(combinedConfidence, 0.95),
      subCategory: keywordIntent.subCategory || patternIntent.subCategory,
      emotionalTone: keywordIntent.emotionalTone,
      urgency: keywordIntent.urgency
    };
  }

  async updateBehaviorPattern(userId: string, context: PredictionContext, actualResponse: string): Promise<void> {
    // 简化实现
  }
}