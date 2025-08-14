import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  MockServiceConfig,
  MockStats
} from '../types';

export class AzureOpenAIMockService {
  private requestCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];
  private config: MockServiceConfig = {
    latency: { min: 200, max: 800 },
    errorRate: 0,
    responses: {}
  };

  // 预定义的AI响应模板，根据不同场景
  private responseTemplates = {
    spam_response: [
      "谢谢您的来电，但我现在不方便。",
      "不好意思，我对这个不感兴趣。",
      "我现在正在忙，稍后再联系。",
      "感谢您的推荐，但我暂时不需要。",
      "抱歉，我已经有类似的服务了。"
    ],
    polite_decline: [
      "感谢您的来电，但我现在确实不需要这个服务。",
      "谢谢您的介绍，不过我暂时没有这方面的需求。",
      "我理解您的工作，但请不要再打这个电话了。",
      "很抱歉，我对您提到的产品不感兴趣。"
    ],
    firm_rejection: [
      "我已经说得很清楚了，请不要再打扰我。",
      "请把我的号码从您的通话名单中删除。",
      "我不需要任何销售电话，谢谢。",
      "请尊重我的决定，不要再联系我了。"
    ],
    conversation_end: [
      "好的，那就这样吧，再见。",
      "没关系，再见。",
      "我要挂电话了，再见。",
      "不用了，谢谢，再见。"
    ]
  };

  // 意图识别映射
  private intentMapping = {
    'sales': 'spam_response',
    'loan': 'polite_decline',
    'investment': 'polite_decline',
    'insurance': 'spam_response',
    'marketing': 'firm_rejection',
    'persistent': 'firm_rejection',
    'goodbye': 'conversation_end'
  };

  chatCompletions(request: ChatCompletionsRequest): ChatCompletionsResponse {
    const startTime = Date.now();
    this.requestCount++;

    try {
      // 模拟处理延迟
      this.simulateLatency();

      // 模拟错误
      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock OpenAI service error');
      }

      // 分析用户消息内容，生成合适的响应
      const lastUserMessage = request.messages
        .filter(msg => msg.role === 'user')
        .pop();

      const responseContent = this.generateContextualResponse(lastUserMessage?.content || '');
      
      const response: ChatCompletionsResponse = {
        id: `chatcmpl-${uuidv4()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model || 'gpt-35-turbo',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: this.estimateTokens(request.messages.map(m => m.content).join(' ')),
          completion_tokens: this.estimateTokens(responseContent),
          total_tokens: 0
        }
      };

      // 计算总tokens
      response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('OpenAI Chat Mock Response:', { 
        responseLength: responseContent.length,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens
      });

      return response;

    } catch (error) {
      logger.error('OpenAI Chat Mock Error:', error);
      throw error;
    }
  }

  completions(request: any) {
    // Legacy completions endpoint (基本实现)
    const startTime = Date.now();
    this.requestCount++;

    try {
      this.simulateLatency();

      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock OpenAI completions service error');
      }

      const text = this.generateContextualResponse(request.prompt || '');
      
      const response = {
        id: `cmpl-${uuidv4()}`,
        object: 'text_completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model || 'text-davinci-003',
        choices: [{
          text,
          index: 0,
          logprobs: null,
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: this.estimateTokens(request.prompt || ''),
          completion_tokens: this.estimateTokens(text),
          total_tokens: 0
        }
      };

      response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      return response;

    } catch (error) {
      logger.error('OpenAI Completions Mock Error:', error);
      throw error;
    }
  }

  configure(config: MockServiceConfig) {
    this.config = { ...this.config, ...config };
    logger.info('OpenAI mock service configured:', this.config);
  }

  reset() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.latencies = [];
    logger.info('OpenAI mock service reset');
  }

  getStats(): MockStats {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      averageLatency: this.latencies.length > 0 
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length 
        : 0,
      lastRequestTime: this.latencies.length > 0 ? new Date() : undefined,
      configuration: this.config
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  private generateContextualResponse(input: string): string {
    // 简单的意图识别（在实际场景中会更复杂）
    const intent = this.detectIntent(input.toLowerCase());
    const responseCategory = this.intentMapping[intent] || 'spam_response';
    const responses = this.responseTemplates[responseCategory];
    
    // 随机选择一个响应
    const selectedResponse = responses[Math.floor(Math.random() * responses.length)];
    
    // 根据输入长度和复杂度调整响应
    if (input.length > 100 || this.isComplexQuery(input)) {
      return this.enhanceResponse(selectedResponse);
    }
    
    return selectedResponse;
  }

  private detectIntent(input: string): string {
    const keywords = {
      'sales': ['产品', '推荐', '促销', '优惠', '活动', '购买'],
      'loan': ['贷款', '借钱', '利息', '额度', '征信', '放款'],
      'investment': ['投资', '理财', '收益', '股票', '基金', '赚钱'],
      'insurance': ['保险', '保障', '理赔', '保费'],
      'persistent': ['再考虑', '了解一下', '不会吃亏', '机会难得'],
      'goodbye': ['再见', '拜拜', '挂了', '结束']
    };

    for (const [intent, words] of Object.entries(keywords)) {
      if (words.some(keyword => input.includes(keyword))) {
        return intent;
      }
    }

    return 'sales'; // 默认意图
  }

  private isComplexQuery(input: string): boolean {
    // 检查是否是复杂查询（包含问号、多个句子等）
    return input.includes('?') || input.includes('？') || input.split(/[。！!]/).length > 2;
  }

  private enhanceResponse(baseResponse: string): string {
    const enhancements = [
      '不过还是谢谢您的来电。',
      '希望您能理解。',
      '祝您工作顺利。',
      '谢谢您的理解。'
    ];

    const enhancement = enhancements[Math.floor(Math.random() * enhancements.length)];
    return `${baseResponse}${enhancement}`;
  }

  private estimateTokens(text: string): number {
    // 简单的token估算（实际情况会更复杂）
    // 中文字符通常需要更多tokens
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text.split(/\s+/).length;
    
    return Math.ceil(chineseChars * 1.5 + englishWords);
  }

  private simulateLatency() {
    const { min, max } = this.config.latency!;
    const latency = min + Math.random() * (max - min);
    
    if (process.env.NODE_ENV !== 'test') {
      const start = Date.now();
      while (Date.now() - start < latency) {
        // 忙等待模拟延迟
      }
    }
  }

  private shouldSimulateError(): boolean {
    return Math.random() < (this.config.errorRate || 0);
  }
}