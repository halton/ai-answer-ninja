import axios from 'axios';
import {
  IntentResult,
  AIResponse,
  SpamCategory,
  EmotionalTone,
  ResponseStrategy,
  AzureOpenAIConfig,
  RealtimeProcessorError,
} from '../types';
import logger from '../utils/logger';

interface IntentContext {
  userId: string;
  callId: string;
  previousIntents?: IntentResult[];
  conversationHistory?: string[];
}

interface ResponseContext {
  transcript: string;
  userId: string;
  callId: string;
  conversationHistory?: string[];
  userProfile?: any;
}

export class IntentRecognitionService {
  private isInitialized = false;
  private readonly config: AzureOpenAIConfig;
  private intentCache: Map<string, IntentResult> = new Map();
  private responseCache: Map<string, AIResponse> = new Map();

  constructor(config: AzureOpenAIConfig) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Test connection to Azure OpenAI
      await this.testConnection();
      
      this.isInitialized = true;
      logger.info('Intent Recognition Service initialized successfully');
      
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Intent Recognition Service');
      throw new RealtimeProcessorError(
        `Intent Recognition Service initialization failed: ${error.message}`,
        'INIT_ERROR',
        500
      );
    }
  }

  private async testConnection(): Promise<void> {
    try {
      const response = await axios.post(
        `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/completions`,
        {
          prompt: 'Test',
          max_tokens: 5,
          temperature: 0,
        },
        {
          headers: {
            'api-key': this.config.key,
            'Content-Type': 'application/json',
          },
          params: {
            'api-version': this.config.apiVersion,
          },
          timeout: 10000,
        }
      );

      if (response.status !== 200) {
        throw new Error(`Connection test failed with status ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Azure OpenAI connection test failed: ${error.message}`);
    }
  }

  public async classifyIntent(transcript: string, context: IntentContext): Promise<IntentResult> {
    if (!this.isInitialized) {
      throw new RealtimeProcessorError('Intent Recognition Service not initialized', 'NOT_INITIALIZED', 500);
    }

    const startTime = Date.now();

    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(transcript, context);
      const cached = this.intentCache.get(cacheKey);
      if (cached) {
        logger.debug({ callId: context.callId }, 'Using cached intent result');
        return cached;
      }

      // Build context-aware prompt
      const prompt = this.buildIntentClassificationPrompt(transcript, context);

      // Call Azure OpenAI
      const response = await this.callAzureOpenAI(prompt, {
        maxTokens: 200,
        temperature: 0.3,
        topP: 0.9,
      });

      // Parse the response
      const intentResult = this.parseIntentResponse(response, transcript);

      // Cache the result
      this.intentCache.set(cacheKey, intentResult);
      
      // Clean cache if it gets too large
      if (this.intentCache.size > 1000) {
        const firstKey = this.intentCache.keys().next().value;
        this.intentCache.delete(firstKey);
      }

      const processingTime = Date.now() - startTime;

      logger.debug({
        callId: context.callId,
        transcript: transcript.substring(0, 50) + '...',
        intent: intentResult.intent,
        category: intentResult.category,
        confidence: intentResult.confidence,
        processingTime,
      }, 'Intent classification completed');

      return intentResult;

    } catch (error) {
      logger.error({
        error,
        callId: context.callId,
        transcript: transcript.substring(0, 50),
        processingTime: Date.now() - startTime,
      }, 'Intent classification failed');

      // Return fallback intent
      return this.getFallbackIntent(transcript);
    }
  }

  public async generateResponse(intent: IntentResult, context: ResponseContext): Promise<AIResponse> {
    if (!this.isInitialized) {
      throw new RealtimeProcessorError('Intent Recognition Service not initialized', 'NOT_INITIALIZED', 500);
    }

    const startTime = Date.now();

    try {
      // Check cache first
      const cacheKey = this.generateResponseCacheKey(intent, context);
      const cached = this.responseCache.get(cacheKey);
      if (cached) {
        logger.debug({ callId: context.callId }, 'Using cached response');
        return cached;
      }

      // Build response generation prompt
      const prompt = this.buildResponseGenerationPrompt(intent, context);

      // Call Azure OpenAI
      const response = await this.callAzureOpenAI(prompt, {
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        topP: 0.95,
      });

      // Parse the response
      const aiResponse = this.parseResponseGeneration(response, intent);

      // Cache the result
      this.responseCache.set(cacheKey, aiResponse);
      
      // Clean cache if it gets too large
      if (this.responseCache.size > 500) {
        const firstKey = this.responseCache.keys().next().value;
        this.responseCache.delete(firstKey);
      }

      const processingTime = Date.now() - startTime;

      logger.debug({
        callId: context.callId,
        intent: intent.intent,
        responseLength: aiResponse.text.length,
        shouldTerminate: aiResponse.shouldTerminate,
        confidence: aiResponse.confidence,
        processingTime,
      }, 'Response generation completed');

      return aiResponse;

    } catch (error) {
      logger.error({
        error,
        callId: context.callId,
        intent: intent.intent,
        processingTime: Date.now() - startTime,
      }, 'Response generation failed');

      // Return fallback response
      return this.getFallbackResponse(intent);
    }
  }

  private buildIntentClassificationPrompt(transcript: string, context: IntentContext): string {
    const systemPrompt = `你是一个专业的电话意图识别助手。你需要分析骚扰电话的内容，识别对方的意图和情绪。

骚扰电话类型：
- SALES_CALL: 销售电话
- LOAN_OFFER: 贷款推广
- INVESTMENT_PITCH: 投资理财
- INSURANCE_SALES: 保险销售
- SURVEY: 问卷调查
- TELEMARKETING: 电话营销
- UNKNOWN: 未知类型

情绪类型：
- NEUTRAL: 中性
- FRIENDLY: 友好
- AGGRESSIVE: 咄咄逼人
- PERSUASIVE: 说服性强
- URGENT: 紧急的
- CONFUSED: 困惑的

请分析以下对话内容，返回JSON格式：
{
  "intent": "意图类型",
  "category": "骚扰电话类型", 
  "confidence": "置信度(0-1)",
  "emotionalTone": "情绪类型",
  "entities": {
    "product": "产品名称",
    "company": "公司名称",
    "amount": "金额",
    "rate": "利率"
  },
  "reasoning": "分析推理过程"
}`;

    let contextInfo = '';
    if (context.previousIntents && context.previousIntents.length > 0) {
      const recentIntents = context.previousIntents.slice(-3).map(i => i.intent).join(', ');
      contextInfo = `\n\n之前的意图：${recentIntents}`;
    }

    if (context.conversationHistory && context.conversationHistory.length > 0) {
      const recentHistory = context.conversationHistory.slice(-3).join('\n');
      contextInfo += `\n\n对话历史：\n${recentHistory}`;
    }

    return `${systemPrompt}${contextInfo}\n\n当前对话内容："${transcript}"\n\n请分析并返回JSON：`;
  }

  private buildResponseGenerationPrompt(intent: IntentResult, context: ResponseContext): string {
    const systemPrompt = `你是一个智能电话应答助手，需要代替用户应对骚扰电话。

用户特征：
- 性格：礼貌但坚定
- 目标：礼貌地拒绝骚扰者，尽快结束通话
- 策略：不透露个人信息，不被说服

应答原则：
1. 保持礼貌和友好的语气
2. 明确表达不感兴趣
3. 不提供个人信息
4. 适时结束对话
5. 回复简洁自然，控制在20字以内

根据对方的意图和情绪，选择合适的应答策略：
- 销售类：礼貌拒绝，表明不需要
- 贷款类：明确表示不需要贷款
- 投资类：表示没有投资需求
- 保险类：表示已有保险
- 调查类：表示没时间参与

请生成自然的应答内容，并判断是否应该结束通话。

返回JSON格式：
{
  "text": "应答内容",
  "shouldTerminate": "是否应该结束通话(boolean)",
  "confidence": "回复质量置信度(0-1)",
  "strategy": "使用的策略",
  "reasoning": "选择这个回复的原因"
}`;

    let contextInfo = '';
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      const recentHistory = context.conversationHistory.slice(-5).join('\n');
      contextInfo = `\n\n对话历史：\n${recentHistory}`;
    }

    const intentInfo = `
当前识别的意图：
- 类型：${intent.intent}
- 分类：${intent.category}
- 情绪：${intent.emotionalTone}
- 置信度：${intent.confidence}`;

    return `${systemPrompt}${contextInfo}${intentInfo}\n\n对方说："${context.transcript}"\n\n请生成应答并返回JSON：`;
  }

  private async callAzureOpenAI(prompt: string, options: {
    maxTokens: number;
    temperature: number;
    topP?: number;
  }): Promise<string> {
    try {
      const response = await axios.post(
        `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/completions`,
        {
          prompt,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          top_p: options.topP || 0.9,
          frequency_penalty: 0.2,
          presence_penalty: 0.1,
          stop: ['\\n\\n', 'Human:', 'AI:'],
        },
        {
          headers: {
            'api-key': this.config.key,
            'Content-Type': 'application/json',
          },
          params: {
            'api-version': this.config.apiVersion,
          },
          timeout: 30000,
        }
      );

      if (!response.data?.choices?.[0]?.text) {
        throw new Error('No response text received from Azure OpenAI');
      }

      return response.data.choices[0].text.trim();

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        
        logger.error({
          statusCode,
          errorData,
          prompt: prompt.substring(0, 100) + '...',
        }, 'Azure OpenAI API error');

        if (statusCode === 429) {
          throw new RealtimeProcessorError('Rate limit exceeded', 'RATE_LIMIT_ERROR', 429);
        } else if (statusCode === 401) {
          throw new RealtimeProcessorError('Authentication failed', 'AUTH_ERROR', 401);
        } else if (statusCode === 400) {
          throw new RealtimeProcessorError('Invalid request', 'INVALID_REQUEST_ERROR', 400);
        }
      }
      
      throw new RealtimeProcessorError(`Azure OpenAI API call failed: ${error.message}`, 'API_ERROR', 500);
    }
  }

  private parseIntentResponse(response: string, transcript: string): IntentResult {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(response);
      
      return {
        intent: parsed.intent || 'unknown',
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        entities: parsed.entities || {},
        category: this.mapToSpamCategory(parsed.category || parsed.intent),
        emotionalTone: this.mapToEmotionalTone(parsed.emotionalTone),
      };
    } catch (error) {
      logger.warn({
        error,
        response: response.substring(0, 200),
        transcript: transcript.substring(0, 50),
      }, 'Failed to parse intent response, using fallback');

      return this.getFallbackIntent(transcript);
    }
  }

  private parseResponseGeneration(response: string, intent: IntentResult): AIResponse {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(response);
      
      return {
        text: parsed.text || this.getDefaultResponse(intent.category),
        shouldTerminate: parsed.shouldTerminate || false,
        confidence: Math.min(Math.max(parsed.confidence || 0.7, 0), 1),
        responseStrategy: this.mapToResponseStrategy(parsed.strategy),
        metadata: {
          model: this.config.deploymentName,
          temperature: this.config.temperature,
          tokens: {
            prompt: 0, // Would be calculated in production
            completion: response.length,
            total: response.length,
          },
          processingTime: 0, // Would be calculated by caller
        },
      };
    } catch (error) {
      logger.warn({
        error,
        response: response.substring(0, 200),
        intent: intent.intent,
      }, 'Failed to parse response generation, using fallback');

      return this.getFallbackResponse(intent);
    }
  }

  private mapToSpamCategory(category: string): SpamCategory {
    const mapping: Record<string, SpamCategory> = {
      'sales_call': SpamCategory.SALES_CALL,
      'loan_offer': SpamCategory.LOAN_OFFER,
      'investment_pitch': SpamCategory.INVESTMENT_PITCH,
      'insurance_sales': SpamCategory.INSURANCE_SALES,
      'survey': SpamCategory.SURVEY,
      'telemarketing': SpamCategory.TELEMARKETING,
    };
    
    return mapping[category?.toLowerCase()] || SpamCategory.UNKNOWN;
  }

  private mapToEmotionalTone(tone: string): EmotionalTone {
    const mapping: Record<string, EmotionalTone> = {
      'neutral': EmotionalTone.NEUTRAL,
      'friendly': EmotionalTone.FRIENDLY,
      'aggressive': EmotionalTone.AGGRESSIVE,
      'persuasive': EmotionalTone.PERSUASIVE,
      'urgent': EmotionalTone.URGENT,
      'confused': EmotionalTone.CONFUSED,
    };
    
    return mapping[tone?.toLowerCase()] || EmotionalTone.NEUTRAL;
  }

  private mapToResponseStrategy(strategy: string): ResponseStrategy {
    const mapping: Record<string, ResponseStrategy> = {
      'polite_decline': ResponseStrategy.POLITE_DECLINE,
      'firm_rejection': ResponseStrategy.FIRM_REJECTION,
      'humor_deflection': ResponseStrategy.HUMOR_DEFLECTION,
      'information_gathering': ResponseStrategy.INFORMATION_GATHERING,
      'call_termination': ResponseStrategy.CALL_TERMINATION,
    };
    
    return mapping[strategy?.toLowerCase()] || ResponseStrategy.POLITE_DECLINE;
  }

  private getFallbackIntent(transcript: string): IntentResult {
    // Simple keyword-based fallback
    const lowerTranscript = transcript.toLowerCase();
    
    if (lowerTranscript.includes('贷款') || lowerTranscript.includes('借钱')) {
      return {
        intent: 'loan_offer',
        confidence: 0.6,
        category: SpamCategory.LOAN_OFFER,
        emotionalTone: EmotionalTone.PERSUASIVE,
        entities: {},
      };
    }
    
    if (lowerTranscript.includes('投资') || lowerTranscript.includes('理财')) {
      return {
        intent: 'investment_pitch',
        confidence: 0.6,
        category: SpamCategory.INVESTMENT_PITCH,
        emotionalTone: EmotionalTone.PERSUASIVE,
        entities: {},
      };
    }
    
    if (lowerTranscript.includes('保险')) {
      return {
        intent: 'insurance_sales',
        confidence: 0.6,
        category: SpamCategory.INSURANCE_SALES,
        emotionalTone: EmotionalTone.FRIENDLY,
        entities: {},
      };
    }
    
    return {
      intent: 'unknown',
      confidence: 0.3,
      category: SpamCategory.UNKNOWN,
      emotionalTone: EmotionalTone.NEUTRAL,
      entities: {},
    };
  }

  private getFallbackResponse(intent: IntentResult): AIResponse {
    const responses: Record<SpamCategory, string> = {
      [SpamCategory.SALES_CALL]: '谢谢，我现在不需要',
      [SpamCategory.LOAN_OFFER]: '我不需要贷款服务，谢谢',
      [SpamCategory.INVESTMENT_PITCH]: '我对投资不感兴趣',
      [SpamCategory.INSURANCE_SALES]: '我已经有保险了',
      [SpamCategory.SURVEY]: '我没时间参与调查',
      [SpamCategory.TELEMARKETING]: '不好意思，我不需要',
      [SpamCategory.UNKNOWN]: '不好意思，我现在不方便',
    };

    return {
      text: responses[intent.category] || '不好意思，我现在不方便',
      shouldTerminate: false,
      confidence: 0.7,
      responseStrategy: ResponseStrategy.POLITE_DECLINE,
    };
  }

  private getDefaultResponse(category: SpamCategory): string {
    return this.getFallbackResponse({ category } as IntentResult).text;
  }

  private generateCacheKey(transcript: string, context: IntentContext): string {
    // Simple hash of transcript + context
    const contextHash = `${context.userId}_${context.callId}`;
    const transcriptHash = transcript.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);
    return `intent_${contextHash}_${transcriptHash}`;
  }

  private generateResponseCacheKey(intent: IntentResult, context: ResponseContext): string {
    // Simple hash of intent + context
    const contextHash = `${context.userId}_${context.callId}`;
    const intentHash = `${intent.intent}_${intent.category}_${intent.emotionalTone}`;
    return `response_${contextHash}_${intentHash}`;
  }

  // Health check
  public async healthCheck(): Promise<{ status: string; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();
      
      await this.callAzureOpenAI('Health check', {
        maxTokens: 10,
        temperature: 0,
      });
      
      const latency = Date.now() - startTime;
      
      return {
        status: 'healthy',
        latency,
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  // Get service statistics
  public getStats(): {
    isInitialized: boolean;
    cacheSize: { intents: number; responses: number };
    config: Partial<AzureOpenAIConfig>;
  } {
    return {
      isInitialized: this.isInitialized,
      cacheSize: {
        intents: this.intentCache.size,
        responses: this.responseCache.size,
      },
      config: {
        endpoint: this.config.endpoint,
        deploymentName: this.config.deploymentName,
        apiVersion: this.config.apiVersion,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      },
    };
  }

  // Cleanup resources
  public async shutdown(): Promise<void> {
    try {
      this.intentCache.clear();
      this.responseCache.clear();
      this.isInitialized = false;
      
      logger.info('Intent Recognition Service shutdown completed');
      
    } catch (error) {
      logger.error({ error }, 'Error during Intent Recognition Service shutdown');
      throw error;
    }
  }
}