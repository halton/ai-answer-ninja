import { 
  ConversationContext, 
  ConversationTurn, 
  GeneratedResponse, 
  Intent,
  ConversationStage,
  TerminationStrategy,
  ConversationEngineError
} from '@/types';
import { IntentClassifier } from '@/intent/IntentClassifier';
import { ContextManager } from '@/context/ContextManager';
import { ResponseGenerator } from '@/response/ResponseGenerator';
import { EmotionAnalyzer } from '@/analysis/EmotionAnalyzer';
import { Logger, LogPerformance, LogErrors } from '@/utils/logger';

/**
 * 主对话引擎 - 协调所有对话相关组件
 */
export class ConversationEngine {
  private logger: Logger;
  private intentClassifier: IntentClassifier;
  private contextManager: ContextManager;
  private responseGenerator: ResponseGenerator;
  private emotionAnalyzer: EmotionAnalyzer;

  constructor(
    intentClassifier: IntentClassifier,
    contextManager: ContextManager,
    responseGenerator: ResponseGenerator,
    emotionAnalyzer: EmotionAnalyzer
  ) {
    this.logger = new Logger('ConversationEngine');
    this.intentClassifier = intentClassifier;
    this.contextManager = contextManager;
    this.responseGenerator = responseGenerator;
    this.emotionAnalyzer = emotionAnalyzer;
  }

  /**
   * 处理来电者输入并生成AI回复
   */
  @LogPerformance('conversation_processing')
  @LogErrors()
  async processConversation(
    callId: string,
    userInput: string,
    metadata: Record<string, any> = {}
  ): Promise<GeneratedResponse> {
    try {
      this.logger.info('Processing conversation turn', {
        callId,
        inputLength: userInput.length,
        metadata
      });

      // 获取或创建对话上下文
      const context = await this.contextManager.getOrCreateContext(callId, metadata);
      
      // 检查对话是否应该终止
      if (await this.shouldTerminateConversation(context)) {
        return await this.generateTerminationResponse(context);
      }

      // 并行处理：意图识别 + 情感分析
      const [intentResult, emotionResult] = await Promise.all([
        this.intentClassifier.classifyIntent(userInput, context),
        this.emotionAnalyzer.analyzeEmotion(userInput, context)
      ]);

      // 创建对话轮次记录
      const conversationTurn: ConversationTurn = {
        id: `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        speaker: 'caller',
        message: userInput,
        timestamp: new Date(),
        intent: intentResult.intent,
        confidence: intentResult.intent.confidence,
        emotion: emotionResult.primary
      };

      // 更新上下文
      const updatedContext = await this.contextManager.updateContext(
        context,
        conversationTurn,
        intentResult.intent,
        emotionResult
      );

      // 生成个性化回复
      const response = await this.responseGenerator.generateResponse(
        updatedContext,
        intentResult.intent,
        emotionResult
      );

      // 记录AI响应
      const aiTurn: ConversationTurn = {
        id: `ai_turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        speaker: 'ai',
        message: response.text,
        timestamp: new Date(),
        processingLatency: response.metadata.generationLatency
      };

      // 更新上下文包含AI回复
      await this.contextManager.addTurnToContext(updatedContext.callId, aiTurn);

      // 记录业务指标
      this.logger.business('conversation_turn_processed', {
        callId,
        turnCount: updatedContext.turnCount,
        intent: intentResult.intent.category,
        confidence: intentResult.intent.confidence,
        emotion: emotionResult.primary,
        responseConfidence: response.confidence,
        shouldTerminate: response.shouldTerminate
      });

      return response;

    } catch (error) {
      this.logger.error('Failed to process conversation', error, { callId, userInput });
      throw new ConversationEngineError(
        'Failed to process conversation',
        'CONVERSATION_PROCESSING_ERROR',
        500,
        { callId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 检查对话是否应该终止
   */
  @LogPerformance('termination_check')
  private async shouldTerminateConversation(context: ConversationContext): Promise<boolean> {
    // 检查轮次限制
    if (context.turnCount >= 10) {
      this.logger.info('Conversation reached turn limit', { 
        callId: context.callId, 
        turnCount: context.turnCount 
      });
      return true;
    }

    // 检查时间限制（5分钟）
    const conversationDuration = Date.now() - context.startTime.getTime();
    if (conversationDuration > 5 * 60 * 1000) {
      this.logger.info('Conversation reached time limit', { 
        callId: context.callId, 
        duration: conversationDuration 
      });
      return true;
    }

    // 检查当前阶段是否为终止状态
    if ([ConversationStage.TERMINATING, ConversationStage.ENDED].includes(context.currentStage)) {
      return true;
    }

    // 检查持续性骚扰
    if (await this.detectPersistentHarassment(context)) {
      this.logger.warn('Persistent harassment detected', { 
        callId: context.callId,
        turnCount: context.turnCount
      });
      return true;
    }

    return false;
  }

  /**
   * 检测持续性骚扰行为
   */
  private async detectPersistentHarassment(context: ConversationContext): Promise<boolean> {
    if (context.turnCount < 6) return false;

    // 分析最近的意图模式
    const recentTurns = context.conversationHistory.slice(-4);
    const recentIntents = recentTurns
      .filter(turn => turn.intent)
      .map(turn => turn.intent!.category);

    // 如果最近4轮都是同一类型的骚扰意图，认为是持续骚扰
    const uniqueIntents = new Set(recentIntents);
    if (uniqueIntents.size === 1 && recentIntents.length >= 3) {
      const intent = Array.from(uniqueIntents)[0];
      if (['sales_call', 'loan_offer', 'investment_pitch'].includes(intent)) {
        return true;
      }
    }

    // 检查用户是否多次表达拒绝但对方仍在坚持
    const userRejections = recentTurns.filter(turn => 
      turn.speaker === 'ai' && 
      (turn.message.includes('不需要') || 
       turn.message.includes('不感兴趣') ||
       turn.message.includes('拒绝'))
    ).length;

    return userRejections >= 2;
  }

  /**
   * 生成终止对话的回复
   */
  @LogPerformance('termination_response')
  private async generateTerminationResponse(context: ConversationContext): Promise<GeneratedResponse> {
    const terminationStrategy = context.userProfile?.preferences.terminationStrategy || 
                               TerminationStrategy.POLITE_GRADUAL;

    let terminationMessage: string;
    let nextStage = ConversationStage.ENDED;

    switch (terminationStrategy) {
      case TerminationStrategy.FIRM_IMMEDIATE:
        terminationMessage = '抱歉，我现在真的很忙，请不要再打扰我了。再见。';
        break;
      case TerminationStrategy.HUMOR_DEFLECTION:
        terminationMessage = '哈哈，你的坚持精神很值得佩服，但我真的要去忙了。祝你工作顺利！';
        break;
      case TerminationStrategy.PROFESSIONAL_BOUNDARY:
        terminationMessage = '感谢您的来电，但我已经明确表达了我的立场。请尊重我的决定，谢谢。';
        break;
      default:
        terminationMessage = '好的，我明白了。但我现在确实不方便，谢谢你的理解。再见。';
    }

    // 个性化调整
    if (context.userProfile?.personality) {
      terminationMessage = await this.personalizeTerminationMessage(
        terminationMessage, 
        context.userProfile.personality
      );
    }

    this.logger.business('conversation_terminated', {
      callId: context.callId,
      strategy: terminationStrategy,
      turnCount: context.turnCount,
      duration: Date.now() - context.startTime.getTime()
    });

    return {
      text: terminationMessage,
      confidence: 0.95,
      shouldTerminate: true,
      nextStage,
      emotion: 'polite_firm',
      metadata: {
        strategy: terminationStrategy,
        personalizationLevel: 0.8,
        estimatedEffectiveness: 0.9,
        generationLatency: 50,
        cacheHit: false
      }
    };
  }

  /**
   * 个性化终止消息
   */
  private async personalizeTerminationMessage(
    message: string, 
    personality: string
  ): Promise<string> {
    // 这里可以根据用户个性特征调整措辞
    // 实际实现中可能会调用AI服务进行更复杂的个性化
    return message;
  }

  /**
   * 获取对话统计信息
   */
  @LogPerformance('get_conversation_stats')
  async getConversationStats(callId: string): Promise<any> {
    try {
      const context = await this.contextManager.getContext(callId);
      if (!context) {
        throw new ConversationEngineError(
          'Conversation not found',
          'CONVERSATION_NOT_FOUND',
          404
        );
      }

      const stats = {
        callId: context.callId,
        turnCount: context.turnCount,
        duration: Date.now() - context.startTime.getTime(),
        currentStage: context.currentStage,
        lastIntent: context.lastIntent,
        emotionalState: context.emotionalState,
        conversationHistory: context.conversationHistory.map(turn => ({
          speaker: turn.speaker,
          timestamp: turn.timestamp,
          intent: turn.intent?.category,
          confidence: turn.confidence,
          emotion: turn.emotion
        }))
      };

      return stats;
    } catch (error) {
      this.logger.error('Failed to get conversation stats', error, { callId });
      throw error;
    }
  }

  /**
   * 结束对话并清理资源
   */
  @LogPerformance('end_conversation')
  async endConversation(callId: string): Promise<void> {
    try {
      this.logger.info('Ending conversation', { callId });
      
      // 获取最终状态
      const context = await this.contextManager.getContext(callId);
      if (context) {
        // 记录对话结束事件
        this.logger.business('conversation_ended', {
          callId,
          turnCount: context.turnCount,
          duration: Date.now() - context.startTime.getTime(),
          finalStage: context.currentStage,
          lastIntent: context.lastIntent?.category
        });

        // 触发学习优化
        await this.triggerLearningOptimization(context);
      }

      // 清理上下文
      await this.contextManager.clearContext(callId);
      
    } catch (error) {
      this.logger.error('Failed to end conversation', error, { callId });
      throw error;
    }
  }

  /**
   * 触发学习优化
   */
  private async triggerLearningOptimization(context: ConversationContext): Promise<void> {
    try {
      // 这里可以触发机器学习模型的优化
      // 分析对话效果，提取成功模式，更新响应策略等
      this.logger.info('Triggering learning optimization', {
        callId: context.callId,
        turnCount: context.turnCount
      });
      
      // TODO: 实现学习优化逻辑
    } catch (error) {
      this.logger.warn('Learning optimization failed', error, {
        callId: context.callId
      });
    }
  }
}