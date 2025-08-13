import { 
  Intent, 
  IntentCategory, 
  IntentClassificationResult, 
  ConversationContext,
  IntentClassificationError
} from '@/types';
import { Logger, LogPerformance, LogErrors } from '@/utils/logger';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import config from '@/config';
import natural from 'natural';

/**
 * 智能意图识别器 - 多层次意图识别算法
 */
export class IntentClassifier {
  private logger: Logger;
  private openaiClient: OpenAIClient;
  private keywordClassifier: KeywordBasedClassifier;
  private semanticClassifier: SemanticClassifier;
  private contextClassifier: ContextualClassifier;

  constructor() {
    this.logger = new Logger('IntentClassifier');
    this.openaiClient = new OpenAIClient(
      config.azure.endpoint,
      new AzureKeyCredential(config.azure.apiKey)
    );
    this.keywordClassifier = new KeywordBasedClassifier();
    this.semanticClassifier = new SemanticClassifier(this.openaiClient);
    this.contextClassifier = new ContextualClassifier();
  }

  /**
   * 主要的意图分类方法 - 融合多种分类策略
   */
  @LogPerformance('intent_classification')
  @LogErrors()
  async classifyIntent(
    text: string, 
    context?: ConversationContext
  ): Promise<IntentClassificationResult> {
    try {
      this.logger.info('Classifying intent', { 
        textLength: text.length,
        hasContext: !!context
      });

      const startTime = Date.now();

      // 并行执行多种分类方法
      const [keywordResult, semanticResult, contextResult] = await Promise.all([
        this.keywordClassifier.classify(text),
        this.semanticClassifier.classify(text),
        context ? this.contextClassifier.classify(text, context) : null
      ]);

      // 融合分类结果
      const fusedResult = await this.fuseClassificationResults([
        keywordResult,
        semanticResult,
        contextResult
      ].filter(Boolean) as Intent[]);

      // 生成备选意图
      const alternativeIntents = this.generateAlternativeIntents([
        keywordResult,
        semanticResult,
        contextResult
      ].filter(Boolean) as Intent[], fusedResult);

      const processingTime = Date.now() - startTime;

      // 记录分类结果
      this.logger.business('intent_classified', {
        text: text.substring(0, 100),
        intent: fusedResult.category,
        confidence: fusedResult.confidence,
        processingTime,
        methods: {
          keyword: keywordResult.confidence,
          semantic: semanticResult.confidence,
          contextual: contextResult?.confidence || 0
        }
      });

      return {
        intent: fusedResult,
        alternativeIntents,
        processingTime,
        method: 'hybrid'
      };

    } catch (error) {
      this.logger.error('Intent classification failed', error, { text: text.substring(0, 100) });
      throw new IntentClassificationError(
        'Failed to classify intent',
        { text: text.substring(0, 100), error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 融合多种分类结果
   */
  private async fuseClassificationResults(results: Intent[]): Promise<Intent> {
    if (results.length === 0) {
      return {
        category: IntentCategory.UNKNOWN,
        confidence: 0.0,
        context: { reason: 'no_classification_results' }
      };
    }

    if (results.length === 1) {
      return results[0];
    }

    // 权重配置
    const weights = {
      keyword: 0.3,
      semantic: 0.5,
      contextual: 0.4
    };

    // 计算加权平均
    const intentScores = new Map<IntentCategory, number>();
    const intentCounts = new Map<IntentCategory, number>();

    results.forEach((result, index) => {
      const weight = index === 0 ? weights.keyword : 
                    index === 1 ? weights.semantic : weights.contextual;
      
      const category = result.category;
      const score = result.confidence * weight;
      
      intentScores.set(category, (intentScores.get(category) || 0) + score);
      intentCounts.set(category, (intentCounts.get(category) || 0) + 1);
    });

    // 找到得分最高的意图
    let bestIntent = IntentCategory.UNKNOWN;
    let bestScore = 0;

    for (const [category, score] of intentScores.entries()) {
      const avgScore = score / (intentCounts.get(category) || 1);
      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestIntent = category;
      }
    }

    // 合并实体和上下文信息
    const entities = this.mergeEntities(results);
    const context = this.mergeContext(results);

    return {
      category: bestIntent,
      confidence: Math.min(bestScore, 1.0),
      entities,
      context: {
        ...context,
        fusionMethod: 'weighted_average',
        contributingMethods: results.length
      }
    };
  }

  /**
   * 生成备选意图
   */
  private generateAlternativeIntents(allResults: Intent[], primaryIntent: Intent): Intent[] {
    const alternatives = allResults
      .filter(result => result.category !== primaryIntent.category)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3); // 最多3个备选

    return alternatives;
  }

  /**
   * 合并实体信息
   */
  private mergeEntities(results: Intent[]): Record<string, any> {
    const merged = {};
    results.forEach(result => {
      if (result.entities) {
        Object.assign(merged, result.entities);
      }
    });
    return merged;
  }

  /**
   * 合并上下文信息
   */
  private mergeContext(results: Intent[]): Record<string, any> {
    const merged = {};
    results.forEach(result => {
      if (result.context) {
        Object.assign(merged, result.context);
      }
    });
    return merged;
  }
}

/**
 * 基于关键词的分类器
 */
class KeywordBasedClassifier {
  private patterns: Map<IntentCategory, KeywordPattern>;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('KeywordClassifier');
    this.patterns = this.initializePatterns();
  }

  private initializePatterns(): Map<IntentCategory, KeywordPattern> {
    const patterns = new Map<IntentCategory, KeywordPattern>();

    patterns.set(IntentCategory.SALES_CALL, {
      keywords: ['产品', '促销', '优惠', '活动', '了解一下', '推荐', '新品', '特价'],
      phrases: ['我们的产品', '特别优惠', '限时活动', '了解一下我们'],
      weight: 0.3,
      negativeKeywords: ['不需要', '不感兴趣']
    });

    patterns.set(IntentCategory.LOAN_OFFER, {
      keywords: ['贷款', '借钱', '利息', '额度', '征信', '放款', '资金', '融资'],
      phrases: ['贷款需求', '资金周转', '信用贷款', '抵押贷款'],
      weight: 0.4,
      negativeKeywords: ['不需要贷款', '不借钱']
    });

    patterns.set(IntentCategory.INVESTMENT_PITCH, {
      keywords: ['投资', '理财', '收益', '股票', '基金', '赚钱', '财富', '增值'],
      phrases: ['投资机会', '理财产品', '高收益', '稳定收益'],
      weight: 0.35,
      negativeKeywords: ['不投资', '不理财']
    });

    patterns.set(IntentCategory.INSURANCE_SALES, {
      keywords: ['保险', '保障', '理赔', '保费', '受益人', '意外', '医疗'],
      phrases: ['保险产品', '保障方案', '投保', '理赔服务'],
      weight: 0.25,
      negativeKeywords: ['不买保险', '已有保险']
    });

    patterns.set(IntentCategory.SURVEY_REQUEST, {
      keywords: ['调查', '问卷', '访问', '了解', '反馈', '意见', '评价'],
      phrases: ['市场调查', '用户调研', '满意度调查'],
      weight: 0.2,
      negativeKeywords: ['不参与', '没时间']
    });

    patterns.set(IntentCategory.SCAM_ATTEMPT, {
      keywords: ['中奖', '免费', '紧急', '立即', '马上', '验证码', '转账'],
      phrases: ['恭喜中奖', '紧急通知', '账户异常', '需要验证'],
      weight: 0.9,
      negativeKeywords: []
    });

    return patterns;
  }

  async classify(text: string): Promise<Intent> {
    const normalizedText = text.toLowerCase().trim();
    let bestMatch: IntentCategory = IntentCategory.UNKNOWN;
    let bestScore = 0;
    let matchedKeywords: string[] = [];

    for (const [intent, pattern] of this.patterns.entries()) {
      const score = this.calculatePatternScore(normalizedText, pattern);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = intent;
        matchedKeywords = this.getMatchedKeywords(normalizedText, pattern);
      }
    }

    return {
      category: bestMatch,
      confidence: Math.min(bestScore, 1.0),
      entities: {
        matchedKeywords,
        textLength: text.length
      },
      context: {
        classifier: 'keyword_based',
        patterns_checked: this.patterns.size
      }
    };
  }

  private calculatePatternScore(text: string, pattern: KeywordPattern): number {
    let score = 0;
    
    // 检查关键词匹配
    const keywordMatches = pattern.keywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    ).length;
    
    score += (keywordMatches / pattern.keywords.length) * pattern.weight;

    // 检查短语匹配（权重更高）
    const phraseMatches = pattern.phrases.filter(phrase => 
      text.includes(phrase.toLowerCase())
    ).length;
    
    score += (phraseMatches / pattern.phrases.length) * pattern.weight * 1.5;

    // 检查负面关键词（降低得分）
    const negativeMatches = pattern.negativeKeywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    ).length;
    
    score -= negativeMatches * 0.3;

    return Math.max(0, score);
  }

  private getMatchedKeywords(text: string, pattern: KeywordPattern): string[] {
    return pattern.keywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    );
  }
}

/**
 * 基于语义的分类器（使用Azure OpenAI）
 */
class SemanticClassifier {
  private logger: Logger;
  private openaiClient: OpenAIClient;

  constructor(openaiClient: OpenAIClient) {
    this.logger = new Logger('SemanticClassifier');
    this.openaiClient = openaiClient;
  }

  async classify(text: string): Promise<Intent> {
    try {
      const prompt = this.buildClassificationPrompt(text);
      
      const response = await this.openaiClient.getChatCompletions(
        config.azure.deploymentName,
        [
          {
            role: 'system',
            content: '你是一个专业的对话意图分析专家。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          maxTokens: 100,
          temperature: 0.1
        }
      );

      const result = response.choices[0]?.message?.content;
      if (!result) {
        throw new Error('No response from OpenAI');
      }

      return this.parseOpenAIResponse(result);

    } catch (error) {
      this.logger.warn('Semantic classification failed, using fallback', error);
      return {
        category: IntentCategory.UNKNOWN,
        confidence: 0.0,
        context: {
          classifier: 'semantic_failed',
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private buildClassificationPrompt(text: string): string {
    return `
请分析以下对话内容的意图，并返回JSON格式结果：

对话内容："${text}"

请从以下意图类别中选择最匹配的：
- sales_call: 销售推广
- loan_offer: 贷款推销  
- investment_pitch: 投资理财
- insurance_sales: 保险销售
- survey_request: 调查访问
- scam_attempt: 诈骗嫌疑
- legitimate_call: 正当来电
- unknown: 无法确定

返回格式：
{
  "intent": "意图类别",
  "confidence": 0.0-1.0的置信度,
  "reasoning": "分类理由"
}
`;
  }

  private parseOpenAIResponse(response: string): Intent {
    try {
      const parsed = JSON.parse(response);
      
      return {
        category: this.mapIntentCategory(parsed.intent),
        confidence: parsed.confidence || 0.5,
        context: {
          classifier: 'semantic_openai',
          reasoning: parsed.reasoning
        }
      };
    } catch (error) {
      this.logger.warn('Failed to parse OpenAI response', error, { response });
      return {
        category: IntentCategory.UNKNOWN,
        confidence: 0.0,
        context: {
          classifier: 'semantic_parse_failed',
          raw_response: response
        }
      };
    }
  }

  private mapIntentCategory(intent: string): IntentCategory {
    const mapping: Record<string, IntentCategory> = {
      'sales_call': IntentCategory.SALES_CALL,
      'loan_offer': IntentCategory.LOAN_OFFER,
      'investment_pitch': IntentCategory.INVESTMENT_PITCH,
      'insurance_sales': IntentCategory.INSURANCE_SALES,
      'survey_request': IntentCategory.SURVEY_REQUEST,
      'scam_attempt': IntentCategory.SCAM_ATTEMPT,
      'legitimate_call': IntentCategory.LEGITIMATE_CALL,
      'unknown': IntentCategory.UNKNOWN
    };

    return mapping[intent] || IntentCategory.UNKNOWN;
  }
}

/**
 * 基于上下文的分类器
 */
class ContextualClassifier {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('ContextualClassifier');
  }

  async classify(text: string, context: ConversationContext): Promise<Intent> {
    // 基于历史对话上下文调整分类
    const recentIntents = this.getRecentIntents(context);
    const contextWeight = this.calculateContextWeight(context);
    
    if (recentIntents.length > 0) {
      const lastIntent = recentIntents[recentIntents.length - 1];
      
      // 如果最近的意图一致且置信度高，增强当前分类
      if (this.isConsistentIntent(text, lastIntent)) {
        return {
          category: lastIntent.category,
          confidence: Math.min(lastIntent.confidence * 1.2, 1.0),
          context: {
            classifier: 'contextual',
            context_influenced: true,
            recent_intents: recentIntents.length,
            context_weight: contextWeight
          }
        };
      }
    }

    return {
      category: IntentCategory.UNKNOWN,
      confidence: 0.0,
      context: {
        classifier: 'contextual',
        context_influenced: false
      }
    };
  }

  private getRecentIntents(context: ConversationContext): Intent[] {
    return context.conversationHistory
      .filter(turn => turn.intent)
      .slice(-3)
      .map(turn => turn.intent!);
  }

  private calculateContextWeight(context: ConversationContext): number {
    // 根据对话轮次和时间计算上下文权重
    const turnWeight = Math.min(context.turnCount / 10, 1.0);
    const timeWeight = Math.min(
      (Date.now() - context.startTime.getTime()) / (5 * 60 * 1000), 
      1.0
    );
    
    return (turnWeight + timeWeight) / 2;
  }

  private isConsistentIntent(text: string, lastIntent: Intent): boolean {
    // 简单的一致性检查逻辑
    // 实际实现中可能需要更复杂的语义一致性分析
    return lastIntent.confidence > 0.7;
  }
}

// 辅助类型定义
interface KeywordPattern {
  keywords: string[];
  phrases: string[];
  weight: number;
  negativeKeywords: string[];
}