import { Request, Response } from 'express';
import { 
  ConversationContext, 
  ResponseGenerationRequest, 
  IntentClassificationInput,
  TerminationAnalysis,
  HealthCheckResponse 
} from '../types';
import { ConversationEngine } from '../services/ConversationEngine';
import { IntentClassifier } from '../services/IntentClassifier';
import { EmotionAnalyzer } from '../services/EmotionAnalyzer';
import { ResponseGenerator } from '../services/ResponseGenerator';
import { TerminationManager } from '../services/TerminationManager';
import { ContextManager } from '../services/ContextManager';
import { logger } from '../utils/logger';

export class ConversationController {
  private conversationEngine: ConversationEngine;
  private intentClassifier: IntentClassifier;
  private emotionAnalyzer: EmotionAnalyzer;
  private responseGenerator: ResponseGenerator;
  private terminationManager: TerminationManager;
  private contextManager: ContextManager;

  constructor() {
    this.conversationEngine = new ConversationEngine();
    this.intentClassifier = new IntentClassifier();
    this.emotionAnalyzer = new EmotionAnalyzer();
    this.responseGenerator = new ResponseGenerator();
    this.terminationManager = new TerminationManager();
    this.contextManager = new ContextManager();
  }

  async manageConversation(req: Request, res: Response) {
    try {
      const { 
        text, 
        callId, 
        userId, 
        callerPhone,
        audioData 
      } = req.body;

      const startTime = performance.now();

      // Get or create conversation context
      let context = await this.contextManager.getContext(callId);
      if (!context) {
        context = await this.contextManager.createContext({
          callId,
          userId,
          callerPhone,
          conversationHistory: [],
          currentState: {
            stage: 'initial',
            turnCount: 0,
            lastIntent: '',
            emotionalState: {
              currentEmotion: 'neutral',
              emotionHistory: [],
              averageValence: 0,
              averageArousal: 0,
              emotionTrend: 'stable'
            },
            terminationScore: 0,
            userEngagement: 1.0
          },
          startTime: new Date(),
          lastActivity: new Date(),
          metadata: {}
        });
      }

      // Process the conversation turn
      const result = await this.conversationEngine.processConversationTurn({
        text,
        context,
        audioData
      });

      const processingTime = performance.now() - startTime;

      logger.info(`Conversation processed for call ${callId}`, {
        callId,
        processingTime,
        intent: result.intent?.intent,
        shouldTerminate: result.shouldTerminate
      });

      res.status(200).json({
        success: true,
        data: {
          response: result.response,
          audioResponse: result.audioResponse?.toString('base64'),
          intent: result.intent,
          emotion: result.emotion,
          shouldTerminate: result.shouldTerminate,
          nextState: result.nextState,
          processingTime
        }
      });

    } catch (error) {
      logger.error('Error in manageConversation:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to process conversation'
      });
    }
  }

  async personalizeResponse(req: Request, res: Response) {
    try {
      const request: ResponseGenerationRequest = req.body;
      
      const personalizedResponse = await this.responseGenerator.generatePersonalizedResponse(
        request
      );

      res.status(200).json({
        success: true,
        data: personalizedResponse
      });

    } catch (error) {
      logger.error('Error in personalizeResponse:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to personalize response'
      });
    }
  }

  async analyzeEmotion(req: Request, res: Response) {
    try {
      const { text, audioData, context } = req.body;

      const emotionResult = await this.emotionAnalyzer.analyzeEmotion({
        text,
        audioData,
        context
      });

      res.status(200).json({
        success: true,
        data: emotionResult
      });

    } catch (error) {
      logger.error('Error in analyzeEmotion:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to analyze emotion'
      });
    }
  }

  async shouldTerminate(req: Request, res: Response) {
    try {
      const { callId, context, currentResponse } = req.body;

      const terminationAnalysis: TerminationAnalysis = await this.terminationManager.shouldTerminateCall(
        context,
        currentResponse
      );

      res.status(200).json({
        success: true,
        data: terminationAnalysis
      });

    } catch (error) {
      logger.error('Error in shouldTerminate:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to analyze termination'
      });
    }
  }

  async getConversationHistory(req: Request, res: Response) {
    try {
      const { callId } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const history = await this.contextManager.getConversationHistory(
        callId,
        parseInt(page as string),
        parseInt(limit as string)
      );

      res.status(200).json({
        success: true,
        data: history
      });

    } catch (error) {
      logger.error('Error in getConversationHistory:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get conversation history'
      });
    }
  }

  async updateContext(req: Request, res: Response) {
    try {
      const { callId, updates } = req.body;

      const updatedContext = await this.contextManager.updateContext(callId, updates);

      res.status(200).json({
        success: true,
        data: updatedContext
      });

    } catch (error) {
      logger.error('Error in updateContext:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to update context'
      });
    }
  }

  async getContext(req: Request, res: Response) {
    try {
      const { callId } = req.params;

      const context = await this.contextManager.getContext(callId);

      if (!context) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Conversation context not found'
        });
      }

      res.status(200).json({
        success: true,
        data: context
      });

    } catch (error) {
      logger.error('Error in getContext:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get context'
      });
    }
  }

  async generateResponse(req: Request, res: Response) {
    try {
      const request: ResponseGenerationRequest = req.body;

      const response = await this.responseGenerator.generateResponse(request);

      res.status(200).json({
        success: true,
        data: response
      });

    } catch (error) {
      logger.error('Error in generateResponse:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to generate response'
      });
    }
  }

  async evaluateResponse(req: Request, res: Response) {
    try {
      const { callId, response, actualOutcome } = req.body;

      const evaluation = await this.conversationEngine.evaluateResponseEffectiveness({
        callId,
        response,
        actualOutcome
      });

      res.status(200).json({
        success: true,
        data: evaluation
      });

    } catch (error) {
      logger.error('Error in evaluateResponse:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to evaluate response'
      });
    }
  }

  async healthCheck(req: Request, res: Response) {
    try {
      const dependencies = {
        redis: await this.checkRedis(),
        database: await this.checkDatabase(),
        azureOpenAI: await this.checkAzureOpenAI(),
        textAnalytics: await this.checkTextAnalytics()
      };

      const allHealthy = Object.values(dependencies).every(dep => dep);

      const response: HealthCheckResponse = {
        status: allHealthy ? 'healthy' : 'unhealthy',
        service: 'conversation-engine-service',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        dependencies
      };

      res.status(allHealthy ? 200 : 503).json(response);

    } catch (error) {
      logger.error('Error in healthCheck:', error);
      res.status(503).json({
        status: 'unhealthy',
        service: 'conversation-engine-service',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      // Implement Redis health check
      return true;
    } catch {
      return false;
    }
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      // Implement Database health check
      return true;
    } catch {
      return false;
    }
  }

  private async checkAzureOpenAI(): Promise<boolean> {
    try {
      // Implement Azure OpenAI health check
      return true;
    } catch {
      return false;
    }
  }

  private async checkTextAnalytics(): Promise<boolean> {
    try {
      // Implement Text Analytics health check
      return true;
    } catch {
      return false;
    }
  }
}