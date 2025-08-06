import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  IntentResult,
  AIResponse,
  SpamCategory,
  EmotionalTone,
  ResponseStrategy,
  AIMetadata,
  AzureOpenAIConfig,
} from '../types';
import logger from '../utils/logger';

export interface ConversationContext {
  userId: string;
  callId: string;
  recentTranscripts?: string[];
  recentIntents?: IntentResult[];
  conversationDuration?: number;
  messageCount?: number;
  userProfile?: UserProfile;
}

export interface UserProfile {
  name?: string;
  personality?: string;
  voiceProfile?: string;
  preferences?: Record<string, any>;
}

export interface ResponseCache {
  key: string;
  response: AIResponse;
  timestamp: number;
  hitCount: number;
}

export class AIConversationService {
  private responseCache: Map<string, ResponseCache> = new Map();
  private readonly config: AzureOpenAIConfig;
  private axios: any;
  private isInitialized = false;

  constructor(config: AzureOpenAIConfig) {
    this.config = config;
    
    // Create axios instance for Azure OpenAI
    this.axios = axios.create({
      baseURL: this.config.endpoint,
      headers: {
        'api-key': this.config.key,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout for AI generation
    });

    logger.info('AI Conversation Service created');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Test connection to Azure OpenAI
      await this.healthCheck();
      this.initializeResponseTemplates();
      this.startCacheCleanup();
      
      this.isInitialized = true;
      logger.info('AI Conversation Service initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize AI Conversation Service');
      throw error;
    }
  }

  async generateResponse(
    transcript: string,
    intent: IntentResult,
    userId: string,
    context: ConversationContext
  ): Promise<AIResponse> {
    const startTime = performance.now();
    const requestId = uuidv4();

    try {
      logger.info(
        {
          requestId,
          userId,
          callId: context.callId,
          intent: intent.intent,
          transcriptLength: transcript.length,
        },
        'Generating AI response'
      );

      // Check cache first for common responses
      const cacheKey = this.generateCacheKey(intent, context);
      const cachedResponse = this.getCachedResponse(cacheKey);
      
      if (cachedResponse) {
        logger.info({ requestId, cacheKey }, 'Using cached response');
        return {
          ...cachedResponse,
          metadata: {
            ...cachedResponse.metadata,
            cached: true,
            cacheKey,
          },
        };
      }

      // Generate personalized response
      const response = await this.generatePersonalizedResponse(
        transcript,
        intent,
        userId,
        context,
        requestId
      );

      const processingTime = performance.now() - startTime;

      // Cache successful responses for common intents
      if (this.shouldCacheResponse(intent)) {
        this.cacheResponse(cacheKey, response);
      }

      // Add metadata
      response.metadata = {
        ...response.metadata,
        processingTime,
        requestId,
        cached: false,
      };

      logger.info(
        {
          requestId,
          processingTime,
          responseLength: response.text.length,
          shouldTerminate: response.shouldTerminate,
        },
        'AI response generated successfully'
      );

      return response;

    } catch (error) {
      const processingTime = performance.now() - startTime;
      
      logger.error(
        {
          error,
          requestId,
          userId,
          intent: intent.intent,
          processingTime,
        },
        'Failed to generate AI response'
      );

      // Return fallback response
      return this.getFallbackResponse(intent, context);
    }
  }

  private async generatePersonalizedResponse(
    transcript: string,
    intent: IntentResult,
    userId: string,
    context: ConversationContext,
    requestId: string
  ): Promise<AIResponse> {
    // Build conversation history context
    const conversationHistory = this.buildConversationHistory(context);
    
    // Get user profile for personalization
    const userProfile = context.userProfile || { personality: 'polite' };
    
    // Determine response strategy based on intent and context
    const strategy = this.determineResponseStrategy(intent, context);
    
    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(userProfile, strategy, intent);
    
    // Build user prompt with context
    const userPrompt = this.buildUserPrompt(
      transcript,
      intent,
      conversationHistory,
      context
    );

    // Call Azure OpenAI
    const response = await this.callAzureOpenAI(
      systemPrompt,
      userPrompt,
      requestId
    );

    // Process and validate response
    const processedResponse = this.processAIResponse(response, intent, strategy);
    
    return {
      text: processedResponse.text,
      shouldTerminate: processedResponse.shouldTerminate,
      confidence: processedResponse.confidence,
      responseStrategy: strategy,
      metadata: {
        model: this.config.deploymentName,
        temperature: this.config.temperature,
        tokens: response.usage,
        processingTime: 0, // Will be set by caller
      },
    };
  }

  private async callAzureOpenAI(
    systemPrompt: string,
    userPrompt: string,
    requestId: string
  ): Promise<any> {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const requestBody = {
      messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      top_p: 0.9,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
      stop: ['\n\n', '用户:', 'Human:'],
    };

    logger.debug(
      {
        requestId,
        messageCount: messages.length,
        maxTokens: this.config.maxTokens,
      },
      'Calling Azure OpenAI'
    );

    try {
      const response = await this.axios.post(
        `/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=${this.config.apiVersion}`,
        requestBody
      );

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from Azure OpenAI');
      }

      return {
        text: response.data.choices[0].message.content.trim(),
        usage: response.data.usage,
        finish_reason: response.data.choices[0].finish_reason,
      };

    } catch (error: any) {
      if (error.response) {
        logger.error(
          {
            requestId,
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
          },
          'Azure OpenAI API error'
        );
        throw new Error(`Azure OpenAI API error: ${error.response.status} ${error.response.statusText}`);
      } else {
        logger.error({ requestId, error: error.message }, 'Azure OpenAI request failed');
        throw error;
      }
    }
  }

  private buildSystemPrompt(
    userProfile: UserProfile,
    strategy: ResponseStrategy,
    intent: IntentResult
  ): string {
    const personality = userProfile.personality || 'polite';
    const userName = userProfile.name || '用户';

    const basePrompt = `你是${userName}，正在接听一个${this.getSpamCategoryDescription(intent.category)}类型的骚扰电话。

个人特征：
- 性格：${this.getPersonalityDescription(personality)}
- 说话风格：自然、真实的中文对话
- 回应策略：${this.getStrategyDescription(strategy)}

对话原则：
1. 保持自然的语调，像真人一样回应
2. 根据骚扰电话类型采用适当的拒绝方式
3. 回复简短有力，不超过20个字
4. 避免提供任何个人信息
5. 必要时可以礼貌但坚决地结束通话

请根据来电者的话语生成一个${personality}但有效的回复：`;

    return basePrompt;
  }

  private buildUserPrompt(
    transcript: string,
    intent: IntentResult,
    conversationHistory: string,
    context: ConversationContext
  ): string {
    let prompt = `来电者说："${transcript}"\n`;
    
    if (conversationHistory) {
      prompt += `\n对话历史：\n${conversationHistory}\n`;
    }

    prompt += `\n意图分析：${intent.intent}（置信度：${intent.confidence}）`;
    
    if (intent.emotionalTone) {
      prompt += `\n语调：${intent.emotionalTone}`;
    }

    if (context.messageCount && context.messageCount > 3) {
      prompt += `\n注意：这已经是第${context.messageCount}次交互，对方比较坚持，可能需要更坚决的回应。`;
    }

    prompt += `\n\n请生成一个合适的回复：`;

    return prompt;
  }

  private buildConversationHistory(context: ConversationContext): string {
    if (!context.recentTranscripts || context.recentTranscripts.length === 0) {
      return '';
    }

    return context.recentTranscripts
      .slice(-3) // Only last 3 exchanges
      .map((transcript, index) => `${index % 2 === 0 ? '来电者' : '我'}：${transcript}`)
      .join('\n');
  }

  private determineResponseStrategy(
    intent: IntentResult,
    context: ConversationContext
  ): ResponseStrategy {
    const messageCount = context.messageCount || 0;
    const conversationDuration = context.conversationDuration || 0;

    // Escalate strategy based on persistence
    if (messageCount > 5 || conversationDuration > 120000) { // 2 minutes
      return ResponseStrategy.CALL_TERMINATION;
    } else if (messageCount > 3) {
      return ResponseStrategy.FIRM_REJECTION;
    } else if (intent.category === SpamCategory.SURVEY) {
      return ResponseStrategy.POLITE_DECLINE;
    } else if (intent.emotionalTone === EmotionalTone.AGGRESSIVE) {
      return ResponseStrategy.FIRM_REJECTION;
    } else {
      return ResponseStrategy.POLITE_DECLINE;
    }
  }

  private processAIResponse(
    response: any,
    intent: IntentResult,
    strategy: ResponseStrategy
  ): { text: string; shouldTerminate: boolean; confidence: number } {
    let text = response.text;
    
    // Clean up the response
    text = text.replace(/^(我|用户)[:：]?\s*/, '');
    text = text.replace(/\n+/g, ' ').trim();
    
    // Ensure appropriate length
    if (text.length > 50) {
      text = text.substring(0, 47) + '...';
    }

    // Determine if conversation should terminate
    const shouldTerminate = this.shouldTerminateConversation(strategy, text);
    
    // Calculate confidence based on response quality
    const confidence = this.calculateResponseConfidence(text, intent);

    return { text, shouldTerminate, confidence };
  }

  private shouldTerminateConversation(strategy: ResponseStrategy, text: string): boolean {
    if (strategy === ResponseStrategy.CALL_TERMINATION) {
      return true;
    }

    // Check for termination keywords in response
    const terminationKeywords = ['再见', '挂了', '不用了', '结束', '拜拜'];
    return terminationKeywords.some(keyword => text.includes(keyword));
  }

  private calculateResponseConfidence(text: string, intent: IntentResult): number {
    let confidence = 0.8; // Base confidence
    
    // Adjust based on response quality indicators
    if (text.length > 5 && text.length < 30) {
      confidence += 0.1; // Good length
    }
    
    if (!text.includes('不知道') && !text.includes('可能')) {
      confidence += 0.05; // Confident response
    }
    
    if (intent.confidence > 0.8) {
      confidence += 0.05; // High intent confidence
    }
    
    return Math.min(confidence, 0.95);
  }

  private generateCacheKey(intent: IntentResult, context: ConversationContext): string {
    const keyComponents = [
      intent.intent,
      intent.category || 'unknown',
      context.messageCount && context.messageCount > 3 ? 'persistent' : 'initial',
      context.userProfile?.personality || 'default',
    ];
    
    return keyComponents.join(':');
  }

  private getCachedResponse(cacheKey: string): AIResponse | null {
    const cached = this.responseCache.get(cacheKey);
    
    if (!cached) {
      return null;
    }
    
    // Check if cache is still valid (5 minutes)
    if (Date.now() - cached.timestamp > 300000) {
      this.responseCache.delete(cacheKey);
      return null;
    }
    
    // Update hit count and return copy
    cached.hitCount++;
    return { ...cached.response };
  }

  private cacheResponse(cacheKey: string, response: AIResponse): void {
    // Only cache if we have space (max 100 entries)
    if (this.responseCache.size >= 100) {
      // Remove oldest entry
      const oldestKey = Array.from(this.responseCache.keys())[0];
      this.responseCache.delete(oldestKey);
    }

    this.responseCache.set(cacheKey, {
      key: cacheKey,
      response: { ...response },
      timestamp: Date.now(),
      hitCount: 0,
    });
  }

  private shouldCacheResponse(intent: IntentResult): boolean {
    // Cache common spam categories
    const cachableCategories = [
      SpamCategory.SALES_CALL,
      SpamCategory.LOAN_OFFER,
      SpamCategory.INSURANCE_SALES,
    ];
    
    return cachableCategories.includes(intent.category!) && intent.confidence > 0.7;
  }

  private getFallbackResponse(intent: IntentResult, context: ConversationContext): AIResponse {
    const fallbackResponses = {
      [SpamCategory.SALES_CALL]: '抱歉，我现在不方便。',
      [SpamCategory.LOAN_OFFER]: '我不需要贷款服务，谢谢。',
      [SpamCategory.INVESTMENT_PITCH]: '我对投资不感兴趣。',
      [SpamCategory.INSURANCE_SALES]: '我已经有保险了，谢谢。',
      [SpamCategory.SURVEY]: '我没时间参加调查，谢谢。',
      [SpamCategory.TELEMARKETING]: '请不要再打扰我了。',
    };

    const text = fallbackResponses[intent.category!] || '不好意思，现在不方便。';
    
    return {
      text,
      shouldTerminate: false,
      confidence: 0.6,
      responseStrategy: ResponseStrategy.POLITE_DECLINE,
      metadata: {
        model: 'fallback',
        temperature: 0,
        tokens: { prompt: 0, completion: 0, total: 0 },
        processingTime: 0,
        fallback: true,
      },
    };
  }

  private initializeResponseTemplates(): void {
    // Pre-populate cache with common responses
    const commonResponses = [
      {
        key: 'sales_call:unknown:initial:polite',
        text: '谢谢，我现在不需要。',
        shouldTerminate: false,
        confidence: 0.85,
        responseStrategy: ResponseStrategy.POLITE_DECLINE,
      },
      {
        key: 'loan_offer:unknown:initial:polite',
        text: '我不需要贷款，谢谢。',
        shouldTerminate: false,
        confidence: 0.85,
        responseStrategy: ResponseStrategy.POLITE_DECLINE,
      },
      {
        key: 'investment_pitch:unknown:initial:polite',
        text: '我对投资不感兴趣。',
        shouldTerminate: false,
        confidence: 0.85,
        responseStrategy: ResponseStrategy.POLITE_DECLINE,
      },
    ];

    commonResponses.forEach(template => {
      this.responseCache.set(template.key, {
        key: template.key,
        response: template as AIResponse,
        timestamp: Date.now(),
        hitCount: 0,
      });
    });

    logger.info(`Initialized ${commonResponses.length} response templates`);
  }

  private startCacheCleanup(): void {
    // Clean up old cache entries every 10 minutes
    setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, cached] of this.responseCache) {
        // Delete entries older than 30 minutes
        if (now - cached.timestamp > 1800000) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach(key => this.responseCache.delete(key));

      if (keysToDelete.length > 0) {
        logger.debug(`Cleaned up ${keysToDelete.length} expired cache entries`);
      }
    }, 600000); // 10 minutes
  }

  // Helper methods for prompt building
  private getSpamCategoryDescription(category?: SpamCategory): string {
    const descriptions = {
      [SpamCategory.SALES_CALL]: '销售推广',
      [SpamCategory.LOAN_OFFER]: '贷款推销',
      [SpamCategory.INVESTMENT_PITCH]: '投资理财',
      [SpamCategory.INSURANCE_SALES]: '保险销售',
      [SpamCategory.SURVEY]: '问卷调查',
      [SpamCategory.TELEMARKETING]: '电话营销',
    };
    
    return descriptions[category!] || '未知';
  }

  private getPersonalityDescription(personality: string): string {
    const descriptions = {
      polite: '礼貌友好，但能坚持自己的立场',
      direct: '直接明了，不拐弯抹角',
      humorous: '幽默风趣，用轻松的方式拒绝',
      professional: '专业正式，简洁有力',
    };
    
    return descriptions[personality] || '自然真实';
  }

  private getStrategyDescription(strategy: ResponseStrategy): string {
    const descriptions = {
      [ResponseStrategy.POLITE_DECLINE]: '礼貌拒绝',
      [ResponseStrategy.FIRM_REJECTION]: '坚决拒绝',
      [ResponseStrategy.HUMOR_DEFLECTION]: '幽默回避',
      [ResponseStrategy.INFORMATION_GATHERING]: '信息收集',
      [ResponseStrategy.CALL_TERMINATION]: '结束通话',
    };
    
    return descriptions[strategy] || '礼貌拒绝';
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const testPrompt = '测试连接';
      const response = await this.axios.post(
        `/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=${this.config.apiVersion}`,
        {
          messages: [{ role: 'user', content: testPrompt }],
          max_tokens: 10,
          temperature: 0,
        }
      );
      
      return response.status === 200;
    } catch (error) {
      logger.error({ error }, 'AI Conversation Service health check failed');
      return false;
    }
  }

  // Get cache statistics
  getCacheStats(): any {
    const stats = {
      size: this.responseCache.size,
      entries: Array.from(this.responseCache.values()).map(cached => ({
        key: cached.key,
        hitCount: cached.hitCount,
        age: Date.now() - cached.timestamp,
      })).sort((a, b) => b.hitCount - a.hitCount),
    };

    return stats;
  }

  // Clear cache
  clearCache(): void {
    this.responseCache.clear();
    logger.info('Response cache cleared');
  }
}