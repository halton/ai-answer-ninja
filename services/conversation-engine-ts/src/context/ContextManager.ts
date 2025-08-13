import { 
  ConversationContext,
  ConversationTurn,
  Intent,
  EmotionalState,
  ConversationStage,
  UserProfile,
  PersonalityType,
  TerminationStrategy,
  ConversationEngineError
} from '@/types';
import { Logger, LogPerformance, LogErrors } from '@/utils/logger';
import { createClient } from 'redis';
import { Pool } from 'pg';
import config from '@/config';

/**
 * 对话上下文管理器 - 管理对话状态和历史
 */
export class ContextManager {
  private logger: Logger;
  private redisClient: any;
  private dbPool: Pool;
  private contextCache: Map<string, ConversationContext>;

  constructor() {
    this.logger = new Logger('ContextManager');
    this.contextCache = new Map();
    this.initializeConnections();
  }

  private async initializeConnections() {
    try {
      // 初始化 Redis 连接
      this.redisClient = createClient({
        url: config.redis.url,
        retry: {
          maxRetries: config.redis.maxRetries,
          delay: config.redis.retryDelay
        }
      });

      this.redisClient.on('error', (err: Error) => {
        this.logger.error('Redis connection error', err);
      });

      await this.redisClient.connect();

      // 初始化数据库连接池
      this.dbPool = new Pool({
        connectionString: config.database.url,
        max: config.database.maxConnections,
        connectionTimeoutMillis: config.database.connectionTimeout,
        ssl: config.database.ssl
      });

      this.logger.info('Context manager connections initialized');
    } catch (error) {
      this.logger.error('Failed to initialize connections', error);
      throw new ConversationEngineError(
        'Failed to initialize context manager connections',
        'CONTEXT_MANAGER_INIT_ERROR',
        500,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 获取或创建对话上下文
   */
  @LogPerformance('get_or_create_context')
  @LogErrors()
  async getOrCreateContext(
    callId: string, 
    metadata: Record<string, any> = {}
  ): Promise<ConversationContext> {
    try {
      // 首先检查内存缓存
      if (this.contextCache.has(callId)) {
        const cached = this.contextCache.get(callId)!;
        this.logger.debug('Context found in memory cache', { callId });
        return cached;
      }

      // 检查 Redis 缓存
      const redisKey = this.getRedisKey(callId);
      const cachedContext = await this.redisClient.get(redisKey);
      
      if (cachedContext) {
        const context = JSON.parse(cachedContext);
        context.startTime = new Date(context.startTime);
        context.conversationHistory = context.conversationHistory.map((turn: any) => ({
          ...turn,
          timestamp: new Date(turn.timestamp)
        }));
        
        this.contextCache.set(callId, context);
        this.logger.debug('Context found in Redis cache', { callId });
        return context;
      }

      // 创建新的对话上下文
      const newContext = await this.createNewContext(callId, metadata);
      
      // 缓存到内存和 Redis
      await this.cacheContext(newContext);
      
      this.logger.info('New conversation context created', { 
        callId,
        userId: newContext.userId,
        callerPhone: newContext.callerPhone
      });

      return newContext;

    } catch (error) {
      this.logger.error('Failed to get or create context', error, { callId, metadata });
      throw new ConversationEngineError(
        'Failed to get or create conversation context',
        'CONTEXT_RETRIEVAL_ERROR',
        500,
        { callId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 创建新的对话上下文
   */
  private async createNewContext(
    callId: string, 
    metadata: Record<string, any>
  ): Promise<ConversationContext> {
    // 从元数据中提取信息
    const userId = metadata.userId || 'unknown';
    const callerPhone = metadata.callerPhone || 'unknown';
    const sessionId = metadata.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 获取用户画像
    const userProfile = await this.getUserProfile(userId);

    const context: ConversationContext = {
      callId,
      userId,
      callerPhone,
      sessionId,
      startTime: new Date(),
      turnCount: 0,
      currentStage: ConversationStage.INITIAL,
      conversationHistory: [],
      userProfile,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
        version: '1.0'
      }
    };

    return context;
  }

  /**
   * 获取用户画像
   */
  @LogPerformance('get_user_profile')
  private async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    try {
      if (userId === 'unknown') return undefined;

      const query = `
        SELECT 
          id, name, personality, voice_profile_id, preferences,
          created_at, updated_at
        FROM users 
        WHERE id = $1
      `;
      
      const result = await this.dbPool.query(query, [userId]);
      
      if (result.rows.length === 0) {
        this.logger.warn('User profile not found', { userId });
        return undefined;
      }

      const row = result.rows[0];
      const profile: UserProfile = {
        id: row.id,
        name: row.name,
        personality: row.personality || PersonalityType.POLITE,
        speechStyle: row.preferences?.speechStyle,
        occupation: row.preferences?.occupation,
        voiceProfileId: row.voice_profile_id,
        preferences: {
          maxConversationLength: row.preferences?.maxConversationLength || 10,
          preferredResponseStyle: row.preferences?.preferredResponseStyle || 'polite',
          terminationStrategy: row.preferences?.terminationStrategy || TerminationStrategy.POLITE_GRADUAL,
          emotionalResponseLevel: row.preferences?.emotionalResponseLevel || 0.5,
          customResponses: row.preferences?.customResponses || {}
        }
      };

      this.logger.debug('User profile loaded', { userId, personality: profile.personality });
      return profile;

    } catch (error) {
      this.logger.error('Failed to get user profile', error, { userId });
      return undefined;
    }
  }

  /**
   * 更新对话上下文
   */
  @LogPerformance('update_context')
  @LogErrors()
  async updateContext(
    context: ConversationContext,
    newTurn: ConversationTurn,
    intent: Intent,
    emotionalState?: EmotionalState
  ): Promise<ConversationContext> {
    try {
      // 更新对话历史
      const updatedHistory = [...context.conversationHistory, newTurn];
      
      // 更新对话阶段
      const nextStage = this.determineNextStage(context.currentStage, intent, context);
      
      // 创建更新后的上下文
      const updatedContext: ConversationContext = {
        ...context,
        turnCount: context.turnCount + 1,
        currentStage: nextStage,
        lastIntent: intent,
        emotionalState,
        conversationHistory: updatedHistory,
        metadata: {
          ...context.metadata,
          lastUpdated: new Date().toISOString(),
          lastIntent: intent.category,
          lastEmotionalState: emotionalState?.primary
        }
      };

      // 缓存更新后的上下文
      await this.cacheContext(updatedContext);

      // 异步持久化到数据库
      this.persistContextToDatabase(updatedContext).catch(error => {
        this.logger.error('Failed to persist context to database', error, {
          callId: context.callId
        });
      });

      this.logger.debug('Context updated', {
        callId: context.callId,
        turnCount: updatedContext.turnCount,
        currentStage: updatedContext.currentStage,
        intent: intent.category
      });

      return updatedContext;

    } catch (error) {
      this.logger.error('Failed to update context', error, { callId: context.callId });
      throw new ConversationEngineError(
        'Failed to update conversation context',
        'CONTEXT_UPDATE_ERROR',
        500,
        { callId: context.callId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 确定下一个对话阶段
   */
  private determineNextStage(
    currentStage: ConversationStage,
    intent: Intent,
    context: ConversationContext
  ): ConversationStage {
    // 状态转换规则
    const stateTransitions: Record<ConversationStage, Partial<Record<string, ConversationStage>>> = {
      [ConversationStage.INITIAL]: {
        'sales_call': ConversationStage.HANDLING_REQUEST,
        'loan_offer': ConversationStage.HANDLING_REQUEST,
        'investment_pitch': ConversationStage.HANDLING_REQUEST,
        'insurance_sales': ConversationStage.HANDLING_REQUEST,
        'legitimate_call': ConversationStage.GREETING,
        'default': ConversationStage.IDENTIFYING_PURPOSE
      },
      [ConversationStage.GREETING]: {
        'default': ConversationStage.IDENTIFYING_PURPOSE
      },
      [ConversationStage.IDENTIFYING_PURPOSE]: {
        'sales_call': ConversationStage.HANDLING_REQUEST,
        'loan_offer': ConversationStage.HANDLING_REQUEST,
        'investment_pitch': ConversationStage.HANDLING_REQUEST,
        'insurance_sales': ConversationStage.HANDLING_REQUEST,
        'default': ConversationStage.HANDLING_REQUEST
      },
      [ConversationStage.HANDLING_REQUEST]: {
        'persistence': ConversationStage.POLITE_DECLINE,
        'continued_sales': ConversationStage.POLITE_DECLINE,
        'default': ConversationStage.POLITE_DECLINE
      },
      [ConversationStage.POLITE_DECLINE]: {
        'persistence': ConversationStage.FIRM_REJECTION,
        'continued_harassment': ConversationStage.FIRM_REJECTION,
        'goodbye': ConversationStage.ENDED,
        'default': ConversationStage.FIRM_REJECTION
      },
      [ConversationStage.FIRM_REJECTION]: {
        'continued_persistence': ConversationStage.FINAL_WARNING,
        'harassment': ConversationStage.FINAL_WARNING,
        'goodbye': ConversationStage.ENDED,
        'default': ConversationStage.FINAL_WARNING
      },
      [ConversationStage.FINAL_WARNING]: {
        'default': ConversationStage.TERMINATING
      },
      [ConversationStage.TERMINATING]: {
        'default': ConversationStage.ENDED
      },
      [ConversationStage.ENDED]: {
        'default': ConversationStage.ENDED
      }
    };

    const transitions = stateTransitions[currentStage] || {};
    const intentKey = intent.category;
    
    // 检查特定意图的转换
    if (transitions[intentKey]) {
      return transitions[intentKey]!;
    }

    // 检查是否存在持续骚扰
    if (this.detectPersistentBehavior(context, intent)) {
      if (currentStage === ConversationStage.HANDLING_REQUEST) {
        return ConversationStage.POLITE_DECLINE;
      } else if (currentStage === ConversationStage.POLITE_DECLINE) {
        return ConversationStage.FIRM_REJECTION;
      } else if (currentStage === ConversationStage.FIRM_REJECTION) {
        return ConversationStage.FINAL_WARNING;
      }
    }

    // 使用默认转换
    return transitions['default'] || currentStage;
  }

  /**
   * 检测持续性骚扰行为
   */
  private detectPersistentBehavior(context: ConversationContext, intent: Intent): boolean {
    if (context.turnCount < 3) return false;

    // 检查最近3轮的意图
    const recentIntents = context.conversationHistory
      .slice(-3)
      .filter(turn => turn.intent)
      .map(turn => turn.intent!.category);

    // 如果最近3轮都是相同的骚扰类型意图
    const spamIntents = ['sales_call', 'loan_offer', 'investment_pitch', 'insurance_sales'];
    const isAllSpam = recentIntents.every(intentCat => spamIntents.includes(intentCat));
    const isSameType = new Set(recentIntents).size === 1;

    return isAllSpam && isSameType;
  }

  /**
   * 添加对话轮次到上下文
   */
  @LogPerformance('add_turn_to_context')
  async addTurnToContext(callId: string, turn: ConversationTurn): Promise<void> {
    try {
      const context = await this.getContext(callId);
      if (!context) {
        throw new ConversationEngineError(
          'Context not found for adding turn',
          'CONTEXT_NOT_FOUND',
          404,
          { callId }
        );
      }

      context.conversationHistory.push(turn);
      context.metadata.lastUpdated = new Date().toISOString();

      await this.cacheContext(context);

    } catch (error) {
      this.logger.error('Failed to add turn to context', error, { callId, turnId: turn.id });
      throw error;
    }
  }

  /**
   * 获取对话上下文（不创建新的）
   */
  @LogPerformance('get_context')
  async getContext(callId: string): Promise<ConversationContext | null> {
    try {
      // 检查内存缓存
      if (this.contextCache.has(callId)) {
        return this.contextCache.get(callId)!;
      }

      // 检查 Redis 缓存
      const redisKey = this.getRedisKey(callId);
      const cachedContext = await this.redisClient.get(redisKey);
      
      if (cachedContext) {
        const context = JSON.parse(cachedContext);
        context.startTime = new Date(context.startTime);
        context.conversationHistory = context.conversationHistory.map((turn: any) => ({
          ...turn,
          timestamp: new Date(turn.timestamp)
        }));
        
        this.contextCache.set(callId, context);
        return context;
      }

      return null;

    } catch (error) {
      this.logger.error('Failed to get context', error, { callId });
      return null;
    }
  }

  /**
   * 清理对话上下文
   */
  @LogPerformance('clear_context')
  @LogErrors()
  async clearContext(callId: string): Promise<void> {
    try {
      // 从内存缓存中移除
      this.contextCache.delete(callId);

      // 从 Redis 中移除
      const redisKey = this.getRedisKey(callId);
      await this.redisClient.del(redisKey);

      this.logger.info('Context cleared', { callId });

    } catch (error) {
      this.logger.error('Failed to clear context', error, { callId });
      throw new ConversationEngineError(
        'Failed to clear conversation context',
        'CONTEXT_CLEAR_ERROR',
        500,
        { callId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 缓存上下文到内存和 Redis
   */
  private async cacheContext(context: ConversationContext): Promise<void> {
    try {
      // 缓存到内存
      this.contextCache.set(context.callId, context);

      // 缓存到 Redis（设置过期时间）
      const redisKey = this.getRedisKey(context.callId);
      const serialized = JSON.stringify(context);
      await this.redisClient.setEx(redisKey, config.performance.cacheTtl, serialized);

    } catch (error) {
      this.logger.error('Failed to cache context', error, { callId: context.callId });
    }
  }

  /**
   * 持久化上下文到数据库
   */
  private async persistContextToDatabase(context: ConversationContext): Promise<void> {
    try {
      const query = `
        INSERT INTO conversation_contexts (
          call_id, user_id, caller_phone, session_id, start_time,
          turn_count, current_stage, last_intent, emotional_state,
          conversation_history, metadata, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (call_id) DO UPDATE SET
          turn_count = $6,
          current_stage = $7,
          last_intent = $8,
          emotional_state = $9,
          conversation_history = $10,
          metadata = $11,
          updated_at = NOW()
      `;

      await this.dbPool.query(query, [
        context.callId,
        context.userId,
        context.callerPhone,
        context.sessionId,
        context.startTime,
        context.turnCount,
        context.currentStage,
        context.lastIntent ? JSON.stringify(context.lastIntent) : null,
        context.emotionalState ? JSON.stringify(context.emotionalState) : null,
        JSON.stringify(context.conversationHistory),
        JSON.stringify(context.metadata)
      ]);

    } catch (error) {
      this.logger.error('Failed to persist context to database', error, {
        callId: context.callId
      });
    }
  }

  /**
   * 生成 Redis 键
   */
  private getRedisKey(callId: string): string {
    return `${config.redis.keyPrefix}context:${callId}`;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      if (this.dbPool) {
        await this.dbPool.end();
      }
      this.contextCache.clear();
      this.logger.info('Context manager cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup context manager', error);
    }
  }
}