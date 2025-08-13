import { 
  GeneratedResponse,
  ConversationContext,
  Intent,
  EmotionalState,
  ConversationStage,
  PersonalityType,
  TerminationStrategy,
  ResponseMetadata,
  ResponseGenerationError
} from '@/types';
import { Logger, LogPerformance, LogErrors } from '@/utils/logger';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import { createClient } from 'redis';
import config from '@/config';

/**
 * 个性化响应生成器 - 生成符合用户个性的AI回复
 */
export class ResponseGenerator {
  private logger: Logger;
  private openaiClient: OpenAIClient;
  private redisClient: any;
  private responseTemplates: Map<string, ResponseTemplate>;
  private responseCache: Map<string, CachedResponse>;

  constructor() {
    this.logger = new Logger('ResponseGenerator');
    this.openaiClient = new OpenAIClient(
      config.azure.endpoint,
      new AzureKeyCredential(config.azure.apiKey)
    );
    this.responseCache = new Map();
    this.responseTemplates = this.initializeResponseTemplates();
    this.initializeRedisConnection();
  }

  private async initializeRedisConnection() {
    try {
      this.redisClient = createClient({ url: config.redis.url });
      await this.redisClient.connect();
      this.logger.info('Response generator Redis connection initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Redis connection', error);
    }
  }

  /**
   * 生成个性化回复
   */
  @LogPerformance('response_generation')
  @LogErrors()
  async generateResponse(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState
  ): Promise<GeneratedResponse> {
    try {
      const startTime = Date.now();

      this.logger.info('Generating response', {
        callId: context.callId,
        intent: intent.category,
        emotion: emotionalState.primary,
        stage: context.currentStage
      });

      // 检查缓存中是否有合适的回复
      const cachedResponse = await this.checkResponseCache(context, intent, emotionalState);
      if (cachedResponse) {
        this.logger.debug('Using cached response', { callId: context.callId });
        return this.enhanceCachedResponse(cachedResponse, startTime);
      }

      // 确定响应策略
      const strategy = this.determineResponseStrategy(context, intent, emotionalState);

      // 生成回复文本
      const responseText = await this.generateResponseText(
        context, 
        intent, 
        emotionalState, 
        strategy
      );

      // 确定下一个对话阶段
      const nextStage = this.determineNextStage(context, intent, strategy);

      // 计算回复置信度
      const confidence = this.calculateResponseConfidence(
        context, 
        intent, 
        emotionalState, 
        strategy
      );

      // 判断是否应该终止对话
      const shouldTerminate = this.shouldTerminateConversation(context, strategy);

      const generationLatency = Date.now() - startTime;

      const response: GeneratedResponse = {
        text: responseText,
        confidence,
        shouldTerminate,
        nextStage,
        emotion: this.determineResponseEmotion(emotionalState, strategy),
        metadata: {
          strategy: strategy.name,
          template: strategy.template,
          personalizationLevel: strategy.personalizationLevel,
          estimatedEffectiveness: strategy.estimatedEffectiveness,
          generationLatency,
          cacheHit: false
        }
      };

      // 缓存生成的回复
      await this.cacheResponse(context, intent, emotionalState, response);

      this.logger.business('response_generated', {
        callId: context.callId,
        strategy: strategy.name,
        confidence,
        shouldTerminate,
        generationLatency
      });

      return response;

    } catch (error) {
      this.logger.error('Response generation failed', error, {
        callId: context.callId,
        intent: intent.category
      });
      
      throw new ResponseGenerationError(
        'Failed to generate response',
        { 
          callId: context.callId, 
          intent: intent.category,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * 确定响应策略
   */
  private determineResponseStrategy(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState
  ): ResponseStrategy {
    const personality = context.userProfile?.personality || PersonalityType.POLITE;
    const stage = context.currentStage;
    const turnCount = context.turnCount;

    // 基于对话阶段的策略映射
    const stageStrategies: Record<ConversationStage, string> = {
      [ConversationStage.INITIAL]: 'initial_greeting',
      [ConversationStage.GREETING]: 'polite_greeting',
      [ConversationStage.IDENTIFYING_PURPOSE]: 'purpose_inquiry',
      [ConversationStage.HANDLING_REQUEST]: 'gentle_decline',
      [ConversationStage.POLITE_DECLINE]: 'firm_decline',
      [ConversationStage.FIRM_REJECTION]: 'clear_refusal',
      [ConversationStage.FINAL_WARNING]: 'final_warning',
      [ConversationStage.TERMINATING]: 'termination',
      [ConversationStage.ENDED]: 'goodbye'
    };

    let baseStrategy = stageStrategies[stage] || 'gentle_decline';

    // 根据意图调整策略
    if (intent.category === 'scam_attempt') {
      baseStrategy = 'immediate_termination';
    } else if (intent.confidence < 0.5) {
      baseStrategy = 'clarification_request';
    }

    // 根据情感状态调整策略
    if (emotionalState.primary === 'frustrated' && emotionalState.intensity > 0.7) {
      baseStrategy = 'empathetic_decline';
    } else if (emotionalState.primary === 'angry') {
      baseStrategy = 'calm_deescalation';
    }

    // 根据个性调整策略
    const personalizedStrategy = this.personalizeStrategy(baseStrategy, personality);

    return {
      name: personalizedStrategy,
      template: this.getTemplateForStrategy(personalizedStrategy),
      personalizationLevel: this.calculatePersonalizationLevel(context),
      estimatedEffectiveness: this.estimateEffectiveness(personalizedStrategy, context),
      shouldTerminate: this.strategyRequiresTermination(personalizedStrategy)
    };
  }

  /**
   * 生成回复文本
   */
  private async generateResponseText(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState,
    strategy: ResponseStrategy
  ): Promise<string> {
    // 首先尝试使用模板
    const templateResponse = this.generateFromTemplate(context, intent, strategy);
    if (templateResponse && strategy.personalizationLevel < 0.7) {
      return templateResponse;
    }

    // 使用 Azure OpenAI 生成个性化回复
    return await this.generateWithAI(context, intent, emotionalState, strategy);
  }

  /**
   * 使用模板生成回复
   */
  private generateFromTemplate(
    context: ConversationContext,
    intent: Intent,
    strategy: ResponseStrategy
  ): string | null {
    const template = this.responseTemplates.get(strategy.template);
    if (!template) return null;

    const personality = context.userProfile?.personality || PersonalityType.POLITE;
    const responses = template.responses[personality] || template.responses['default'];
    
    if (!responses || responses.length === 0) return null;

    // 随机选择一个回复模板
    const selectedResponse = responses[Math.floor(Math.random() * responses.length)];

    // 应用变量替换
    return this.applyTemplateVariables(selectedResponse, context, intent);
  }

  /**
   * 使用 AI 生成个性化回复
   */
  private async generateWithAI(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState,
    strategy: ResponseStrategy
  ): Promise<string> {
    const prompt = this.buildPersonalizedPrompt(context, intent, emotionalState, strategy);

    try {
      const response = await this.openaiClient.getChatCompletions(
        config.azure.deploymentName,
        [
          {
            role: 'system',
            content: this.getSystemPrompt(context.userProfile?.personality)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          maxTokens: config.azure.maxTokens,
          temperature: config.azure.temperature,
          topP: config.azure.topP
        }
      );

      const result = response.choices[0]?.message?.content;
      if (!result) {
        throw new Error('No response from Azure OpenAI');
      }

      // 后处理：确保回复符合长度限制和内容要求
      return this.postProcessResponse(result, context);

    } catch (error) {
      this.logger.warn('AI response generation failed, falling back to template', error);
      
      // 回退到模板
      const fallbackResponse = this.generateFromTemplate(context, intent, strategy);
      if (fallbackResponse) {
        return fallbackResponse;
      }

      // 最后的兜底回复
      return this.getFallbackResponse(context.userProfile?.personality);
    }
  }

  /**
   * 构建个性化提示词
   */
  private buildPersonalizedPrompt(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState,
    strategy: ResponseStrategy
  ): string {
    const userProfile = context.userProfile;
    const conversationHistory = context.conversationHistory.slice(-3); // 最近3轮对话

    return `
你是${userProfile?.name || '用户'}，正在接听一个${intent.category}类型的骚扰电话。

个人特征：
- 性格：${userProfile?.personality || 'polite'}
- 说话风格：${userProfile?.speechStyle || '自然友好'}
- 职业背景：${userProfile?.occupation || '普通用户'}

当前对话状态：
- 对话轮次：${context.turnCount}
- 当前阶段：${context.currentStage}
- 来电者情感：${emotionalState.primary}（强度：${emotionalState.intensity}）

最近对话历史：
${conversationHistory.map(turn => 
  `${turn.speaker}: ${turn.message}`
).join('\n')}

当前响应策略：${strategy.name}

请生成一个自然的回复（不超过${config.performance.maxResponseLength}字），要求：
1. 体现你的个性特征
2. 适应当前的对话阶段
3. 对来电者的情感状态做出适当回应
4. 保持礼貌但坚定地拒绝
5. 不要重复之前说过的话

回复：`;
  }

  /**
   * 获取系统提示词
   */
  private getSystemPrompt(personality?: PersonalityType): string {
    const personalityInstructions = {
      [PersonalityType.POLITE]: '你总是保持礼貌和友善，即使在拒绝时也很温和。',
      [PersonalityType.DIRECT]: '你喜欢直接明确地表达，不喜欢拐弯抹角。',
      [PersonalityType.HUMOROUS]: '你善于用幽默化解尴尬，常常用轻松的方式表达。',
      [PersonalityType.PROFESSIONAL]: '你说话正式规范，保持专业的交流方式。',
      [PersonalityType.FRIENDLY]: '你友好热情，但知道如何在必要时设置界限。'
    };

    const instruction = personalityInstructions[personality || PersonalityType.POLITE];

    return `你是一个智能电话应答助手。${instruction}

你的任务是帮助用户应对骚扰电话，要求：
1. 始终保持用户的个性特征
2. 礼貌但坚定地拒绝骚扰电话
3. 根据对话情况灵活调整回应策略
4. 必要时能够果断结束对话
5. 回复要自然、简洁、符合中文表达习惯`;
  }

  /**
   * 后处理回复内容
   */
  private postProcessResponse(response: string, context: ConversationContext): string {
    // 移除引号和多余的标点
    let processed = response.replace(/^["']|["']$/g, '').trim();
    
    // 限制长度
    if (processed.length > config.performance.maxResponseLength) {
      processed = processed.substring(0, config.performance.maxResponseLength - 3) + '...';
    }

    // 确保以适当的标点结尾
    if (!/[。！？]$/.test(processed)) {
      processed += '。';
    }

    return processed;
  }

  /**
   * 应用模板变量
   */
  private applyTemplateVariables(
    template: string,
    context: ConversationContext,
    intent: Intent
  ): string {
    const variables = {
      '{name}': context.userProfile?.name || '我',
      '{caller_type}': this.getCallerTypeDescription(intent.category),
      '{time_of_day}': this.getTimeOfDay(),
      '{polite_refusal}': this.getPoliteRefusal(context.userProfile?.personality)
    };

    let result = template;
    for (const [variable, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(variable, 'g'), value);
    }

    return result;
  }

  /**
   * 检查响应缓存
   */
  private async checkResponseCache(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState
  ): Promise<CachedResponse | null> {
    try {
      const cacheKey = this.generateCacheKey(context, intent, emotionalState);
      
      // 检查内存缓存
      if (this.responseCache.has(cacheKey)) {
        const cached = this.responseCache.get(cacheKey)!;
        if (Date.now() - cached.timestamp < cached.ttl) {
          cached.hitCount++;
          return cached;
        } else {
          this.responseCache.delete(cacheKey);
        }
      }

      // 检查 Redis 缓存
      if (this.redisClient) {
        const cachedData = await this.redisClient.get(`response:${cacheKey}`);
        if (cachedData) {
          const cached = JSON.parse(cachedData);
          this.responseCache.set(cacheKey, cached);
          return cached;
        }
      }

      return null;

    } catch (error) {
      this.logger.warn('Failed to check response cache', error);
      return null;
    }
  }

  /**
   * 缓存响应
   */
  private async cacheResponse(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState,
    response: GeneratedResponse
  ): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(context, intent, emotionalState);
      const cached: CachedResponse = {
        response,
        timestamp: Date.now(),
        ttl: config.performance.responseCacheTtl * 1000,
        hitCount: 0
      };

      // 缓存到内存
      this.responseCache.set(cacheKey, cached);

      // 缓存到 Redis
      if (this.redisClient) {
        await this.redisClient.setEx(
          `response:${cacheKey}`,
          config.performance.responseCacheTtl,
          JSON.stringify(cached)
        );
      }

    } catch (error) {
      this.logger.warn('Failed to cache response', error);
    }
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState
  ): string {
    const keyComponents = [
      intent.category,
      context.currentStage,
      context.userProfile?.personality || 'default',
      emotionalState.primary,
      Math.floor(emotionalState.intensity * 10) // 量化强度
    ];

    return keyComponents.join(':');
  }

  /**
   * 增强缓存响应
   */
  private enhanceCachedResponse(cached: CachedResponse, startTime: number): GeneratedResponse {
    const response = { ...cached.response };
    response.metadata = {
      ...response.metadata,
      generationLatency: Date.now() - startTime,
      cacheHit: true
    };
    return response;
  }

  /**
   * 计算个性化程度
   */
  private calculatePersonalizationLevel(context: ConversationContext): number {
    let level = 0.5; // 基础值

    // 有用户画像增加个性化程度
    if (context.userProfile) {
      level += 0.3;
    }

    // 对话轮次越多，个性化程度越高
    level += Math.min(context.turnCount * 0.05, 0.2);

    return Math.min(level, 1.0);
  }

  /**
   * 估计回复效果
   */
  private estimateEffectiveness(strategy: string, context: ConversationContext): number {
    // 基于策略类型的基础效果
    const baseEffectiveness: Record<string, number> = {
      'gentle_decline': 0.7,
      'firm_decline': 0.8,
      'clear_refusal': 0.9,
      'empathetic_decline': 0.85,
      'immediate_termination': 0.95
    };

    let effectiveness = baseEffectiveness[strategy] || 0.7;

    // 根据对话轮次调整
    if (context.turnCount > 5) {
      effectiveness += 0.1; // 多轮对话后更坚决的回复效果更好
    }

    return Math.min(effectiveness, 1.0);
  }

  /**
   * 其他辅助方法
   */
  private personalizeStrategy(baseStrategy: string, personality: PersonalityType): string {
    const personalityMappings: Record<PersonalityType, Record<string, string>> = {
      [PersonalityType.DIRECT]: {
        'gentle_decline': 'direct_decline',
        'polite_decline': 'straightforward_refusal'
      },
      [PersonalityType.HUMOROUS]: {
        'gentle_decline': 'humorous_deflection',
        'firm_decline': 'witty_refusal'
      },
      [PersonalityType.PROFESSIONAL]: {
        'gentle_decline': 'professional_decline',
        'firm_decline': 'formal_refusal'
      },
      [PersonalityType.FRIENDLY]: {
        'gentle_decline': 'friendly_decline',
        'firm_decline': 'kind_but_firm'
      },
      [PersonalityType.POLITE]: {} // 使用默认策略
    };

    const mapping = personalityMappings[personality] || {};
    return mapping[baseStrategy] || baseStrategy;
  }

  private determineNextStage(
    context: ConversationContext,
    intent: Intent,
    strategy: ResponseStrategy
  ): ConversationStage {
    if (strategy.shouldTerminate) {
      return ConversationStage.ENDED;
    }

    // 根据当前阶段和策略确定下一阶段
    const stageProgression: Record<ConversationStage, ConversationStage> = {
      [ConversationStage.INITIAL]: ConversationStage.IDENTIFYING_PURPOSE,
      [ConversationStage.GREETING]: ConversationStage.IDENTIFYING_PURPOSE,
      [ConversationStage.IDENTIFYING_PURPOSE]: ConversationStage.HANDLING_REQUEST,
      [ConversationStage.HANDLING_REQUEST]: ConversationStage.POLITE_DECLINE,
      [ConversationStage.POLITE_DECLINE]: ConversationStage.FIRM_REJECTION,
      [ConversationStage.FIRM_REJECTION]: ConversationStage.FINAL_WARNING,
      [ConversationStage.FINAL_WARNING]: ConversationStage.TERMINATING,
      [ConversationStage.TERMINATING]: ConversationStage.ENDED,
      [ConversationStage.ENDED]: ConversationStage.ENDED
    };

    return stageProgression[context.currentStage] || context.currentStage;
  }

  private calculateResponseConfidence(
    context: ConversationContext,
    intent: Intent,
    emotionalState: EmotionalState,
    strategy: ResponseStrategy
  ): number {
    let confidence = 0.7; // 基础置信度

    // 意图置信度影响
    confidence += intent.confidence * 0.2;

    // 情感分析置信度影响
    confidence += emotionalState.confidence * 0.1;

    // 策略有效性影响
    confidence += strategy.estimatedEffectiveness * 0.1;

    // 用户画像完整性影响
    if (context.userProfile) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private shouldTerminateConversation(
    context: ConversationContext, 
    strategy: ResponseStrategy
  ): boolean {
    return strategy.shouldTerminate || 
           context.turnCount >= 8 ||
           strategy.name.includes('termination');
  }

  private determineResponseEmotion(
    callerEmotion: EmotionalState, 
    strategy: ResponseStrategy
  ): string {
    // 根据来电者情感和策略确定回复情感
    if (callerEmotion.primary === 'angry') {
      return 'calm';
    } else if (callerEmotion.primary === 'frustrated') {
      return 'empathetic';
    } else if (strategy.name.includes('firm') || strategy.name.includes('clear')) {
      return 'assertive';
    } else {
      return 'polite';
    }
  }

  private strategyRequiresTermination(strategy: string): boolean {
    const terminationStrategies = [
      'immediate_termination',
      'final_warning',
      'termination'
    ];
    return terminationStrategies.some(s => strategy.includes(s));
  }

  private getTemplateForStrategy(strategy: string): string {
    // 策略到模板的映射
    const strategyTemplateMapping: Record<string, string> = {
      'gentle_decline': 'polite_decline',
      'firm_decline': 'firm_refusal',
      'direct_decline': 'direct_refusal',
      'humorous_deflection': 'humorous_response',
      'professional_decline': 'professional_refusal',
      'empathetic_decline': 'empathetic_response',
      'immediate_termination': 'termination'
    };

    return strategyTemplateMapping[strategy] || 'default_decline';
  }

  private getCallerTypeDescription(intentCategory: string): string {
    const descriptions: Record<string, string> = {
      'sales_call': '销售推广',
      'loan_offer': '贷款推销',
      'investment_pitch': '投资理财',
      'insurance_sales': '保险销售',
      'survey_request': '调查访问',
      'scam_attempt': '诈骗电话'
    };
    return descriptions[intentCategory] || '推销';
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return '上午';
    if (hour < 18) return '下午';
    return '晚上';
  }

  private getPoliteRefusal(personality?: PersonalityType): string {
    const refusals = {
      [PersonalityType.POLITE]: '不好意思，我不需要',
      [PersonalityType.DIRECT]: '不需要，谢谢',
      [PersonalityType.HUMOROUS]: '哈哈，不用了',
      [PersonalityType.PROFESSIONAL]: '感谢您的推荐，但我不需要',
      [PersonalityType.FRIENDLY]: '谢谢你，但我真的不需要'
    };
    return refusals[personality || PersonalityType.POLITE];
  }

  private getFallbackResponse(personality?: PersonalityType): string {
    const fallbacks = {
      [PersonalityType.POLITE]: '不好意思，我现在不方便，谢谢。',
      [PersonalityType.DIRECT]: '不需要，再见。',
      [PersonalityType.HUMOROUS]: '不用了，祝你工作顺利！',
      [PersonalityType.PROFESSIONAL]: '感谢您的来电，但我不需要相关服务。',
      [PersonalityType.FRIENDLY]: '谢谢你的好意，但我真的不需要。'
    };
    return fallbacks[personality || PersonalityType.POLITE];
  }

  /**
   * 初始化响应模板
   */
  private initializeResponseTemplates(): Map<string, ResponseTemplate> {
    const templates = new Map<string, ResponseTemplate>();

    // 礼貌拒绝模板
    templates.set('polite_decline', {
      responses: {
        [PersonalityType.POLITE]: [
          '不好意思，我现在不需要这个服务，谢谢你的介绍。',
          '谢谢你的推荐，但我暂时不考虑，不好意思。',
          '感谢你的来电，但我对这个不感兴趣，谢谢理解。'
        ],
        [PersonalityType.FRIENDLY]: [
          '谢谢你想到我，但我真的不需要这个，不好意思呀。',
          '你很用心，但我现在确实不需要，谢谢理解。'
        ],
        'default': [
          '不好意思，我不需要，谢谢。'
        ]
      }
    });

    // 坚决拒绝模板
    templates.set('firm_refusal', {
      responses: {
        [PersonalityType.DIRECT]: [
          '我已经说过了，不需要，请不要再打了。',
          '我的态度很明确，不需要，谢谢。'
        ],
        [PersonalityType.POLITE]: [
          '我已经很明确地表达了我的立场，请理解。',
          '我真的不需要，请不要再坚持了。'
        ],
        'default': [
          '我已经说得很清楚了，不需要。'
        ]
      }
    });

    // 幽默回应模板
    templates.set('humorous_response', {
      responses: {
        [PersonalityType.HUMOROUS]: [
          '哈哈，你的坚持精神很值得佩服，但我真的不需要。',
          '你这么努力推销，我都有点不好意思拒绝了，但还是不要。',
          '如果坚持有奖的话，你肯定能得第一名，但我还是不需要。'
        ],
        'default': [
          '不用了，祝你工作顺利！'
        ]
      }
    });

    return templates;
  }
}

// 辅助接口定义
interface ResponseStrategy {
  name: string;
  template: string;
  personalizationLevel: number;
  estimatedEffectiveness: number;
  shouldTerminate: boolean;
}

interface ResponseTemplate {
  responses: Record<string, string[]>;
}

interface CachedResponse {
  response: GeneratedResponse;
  timestamp: number;
  ttl: number;
  hitCount: number;
}