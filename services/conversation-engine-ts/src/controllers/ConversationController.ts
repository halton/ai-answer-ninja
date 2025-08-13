import { Request, Response } from 'express';
import { ConversationEngine } from '@/engine/ConversationEngine';
import { 
  ApiResponse, 
  ConversationEngineError,
  IntentClassificationError,
  ResponseGenerationError
} from '@/types';
import { Logger } from '@/utils/logger';
import Joi from 'joi';

/**
 * 对话控制器 - 处理对话相关的 HTTP 请求
 */
export class ConversationController {
  private logger: Logger;
  private conversationEngine: ConversationEngine;

  constructor(conversationEngine: ConversationEngine) {
    this.logger = new Logger('ConversationController');
    this.conversationEngine = conversationEngine;
  }

  /**
   * 处理对话轮次
   * POST /api/v1/conversation/process
   */
  public processConversation = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      // 验证请求参数
      const validationResult = this.validateProcessRequest(req.body);
      if (validationResult.error) {
        this.respondWithError(res, {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validationResult.error.details
        }, 400, requestId, startTime);
        return;
      }

      const { callId, userInput, metadata } = validationResult.value;

      this.logger.info('Processing conversation request', {
        requestId,
        callId,
        inputLength: userInput.length,
        metadata
      });

      // 调用对话引擎处理
      const response = await this.conversationEngine.processConversation(
        callId,
        userInput,
        metadata
      );

      // 返回成功响应
      this.respondWithSuccess(res, {
        callId,
        response: {
          text: response.text,
          confidence: response.confidence,
          shouldTerminate: response.shouldTerminate,
          nextStage: response.nextStage,
          emotion: response.emotion,
          metadata: response.metadata
        }
      }, requestId, startTime);

    } catch (error) {
      this.handleControllerError(error, res, requestId, startTime);
    }
  };

  /**
   * 获取对话统计信息
   * GET /api/v1/conversation/:callId/stats
   */
  public getConversationStats = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const { callId } = req.params;

      if (!callId) {
        this.respondWithError(res, {
          code: 'MISSING_CALL_ID',
          message: 'Call ID is required'
        }, 400, requestId, startTime);
        return;
      }

      this.logger.info('Getting conversation stats', { requestId, callId });

      const stats = await this.conversationEngine.getConversationStats(callId);

      this.respondWithSuccess(res, stats, requestId, startTime);

    } catch (error) {
      this.handleControllerError(error, res, requestId, startTime);
    }
  };

  /**
   * 结束对话
   * POST /api/v1/conversation/:callId/end
   */
  public endConversation = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const { callId } = req.params;

      if (!callId) {
        this.respondWithError(res, {
          code: 'MISSING_CALL_ID',
          message: 'Call ID is required'
        }, 400, requestId, startTime);
        return;
      }

      this.logger.info('Ending conversation', { requestId, callId });

      await this.conversationEngine.endConversation(callId);

      this.respondWithSuccess(res, {
        callId,
        status: 'ended',
        message: 'Conversation ended successfully'
      }, requestId, startTime);

    } catch (error) {
      this.handleControllerError(error, res, requestId, startTime);
    }
  };

  /**
   * 批量处理对话（用于测试和批量分析）
   * POST /api/v1/conversation/batch
   */
  public batchProcessConversations = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      // 验证批量请求
      const validationResult = this.validateBatchRequest(req.body);
      if (validationResult.error) {
        this.respondWithError(res, {
          code: 'VALIDATION_ERROR',
          message: 'Invalid batch request parameters',
          details: validationResult.error.details
        }, 400, requestId, startTime);
        return;
      }

      const { conversations } = validationResult.value;

      this.logger.info('Processing batch conversations', {
        requestId,
        batchSize: conversations.length
      });

      // 并行处理多个对话（限制并发数）
      const batchSize = Math.min(conversations.length, 10); // 最多同时处理10个
      const results = [];

      for (let i = 0; i < conversations.length; i += batchSize) {
        const batch = conversations.slice(i, i + batchSize);
        const batchPromises = batch.map(async (conv: any) => {
          try {
            const response = await this.conversationEngine.processConversation(
              conv.callId,
              conv.userInput,
              conv.metadata
            );
            return {
              callId: conv.callId,
              success: true,
              response
            };
          } catch (error) {
            return {
              callId: conv.callId,
              success: false,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      this.respondWithSuccess(res, {
        processed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      }, requestId, startTime);

    } catch (error) {
      this.handleControllerError(error, res, requestId, startTime);
    }
  };

  /**
   * 获取对话引擎配置
   * GET /api/v1/conversation/config
   */
  public getEngineConfig = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      this.logger.info('Getting engine config', { requestId });

      // 返回安全的配置信息（不包含敏感数据）
      const config = {
        version: '1.0.0',
        features: {
          intentClassification: true,
          emotionAnalysis: true,
          personalizedResponse: true,
          contextManagement: true
        },
        limits: {
          maxConversationTurns: 10,
          maxResponseLength: 200,
          intentConfidenceThreshold: 0.7
        },
        supportedPersonalities: [
          'polite', 'direct', 'humorous', 'professional', 'friendly'
        ],
        supportedIntents: [
          'sales_call', 'loan_offer', 'investment_pitch', 
          'insurance_sales', 'survey_request', 'scam_attempt', 'legitimate_call'
        ]
      };

      this.respondWithSuccess(res, config, requestId, startTime);

    } catch (error) {
      this.handleControllerError(error, res, requestId, startTime);
    }
  };

  /**
   * 验证处理对话请求
   */
  private validateProcessRequest(body: any) {
    const schema = Joi.object({
      callId: Joi.string().required().min(1).max(100),
      userInput: Joi.string().required().min(1).max(1000),
      metadata: Joi.object({
        userId: Joi.string().optional(),
        callerPhone: Joi.string().optional(),
        sessionId: Joi.string().optional(),
        timestamp: Joi.string().optional(),
        additionalData: Joi.object().optional()
      }).optional().default({})
    });

    return schema.validate(body);
  }

  /**
   * 验证批量请求
   */
  private validateBatchRequest(body: any) {
    const schema = Joi.object({
      conversations: Joi.array().items(
        Joi.object({
          callId: Joi.string().required(),
          userInput: Joi.string().required().max(1000),
          metadata: Joi.object().optional().default({})
        })
      ).required().min(1).max(50) // 最多50个对话
    });

    return schema.validate(body);
  }

  /**
   * 处理控制器错误
   */
  private handleControllerError(
    error: any,
    res: Response,
    requestId: string,
    startTime: number
  ): void {
    this.logger.error('Controller error', error, { requestId });

    if (error instanceof ConversationEngineError) {
      this.respondWithError(res, {
        code: error.code,
        message: error.message,
        details: error.details
      }, error.statusCode, requestId, startTime);
    } else if (error instanceof IntentClassificationError) {
      this.respondWithError(res, {
        code: error.code,
        message: error.message,
        details: error.details
      }, error.statusCode, requestId, startTime);
    } else if (error instanceof ResponseGenerationError) {
      this.respondWithError(res, {
        code: error.code,
        message: error.message,
        details: error.details
      }, error.statusCode, requestId, startTime);
    } else {
      this.respondWithError(res, {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : String(error)
      }, 500, requestId, startTime);
    }
  }

  /**
   * 返回成功响应
   */
  private respondWithSuccess<T>(
    res: Response,
    data: T,
    requestId: string,
    startTime: number
  ): void {
    const response: ApiResponse<T> = {
      success: true,
      data,
      metadata: {
        requestId,
        timestamp: new Date(),
        processingTime: Date.now() - startTime
      }
    };

    res.status(200).json(response);
  }

  /**
   * 返回错误响应
   */
  private respondWithError(
    res: Response,
    error: { code: string; message: string; details?: any },
    statusCode: number,
    requestId: string,
    startTime: number
  ): void {
    const response: ApiResponse = {
      success: false,
      error,
      metadata: {
        requestId,
        timestamp: new Date(),
        processingTime: Date.now() - startTime
      }
    };

    res.status(statusCode).json(response);
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}