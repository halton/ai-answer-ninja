import { Router } from 'express';
import { ConversationController } from '@/controllers/ConversationController';
import { HealthController } from '@/controllers/HealthController';
import { ConversationEngine } from '@/engine/ConversationEngine';
import { IntentClassifier } from '@/intent/IntentClassifier';
import { ContextManager } from '@/context/ContextManager';
import { ResponseGenerator } from '@/response/ResponseGenerator';
import { EmotionAnalyzer } from '@/analysis/EmotionAnalyzer';
import { Logger } from '@/utils/logger';

/**
 * 路由配置
 */
export class Routes {
  public router: Router;
  private logger: Logger;
  private conversationController: ConversationController;
  private healthController: HealthController;

  constructor() {
    this.router = Router();
    this.logger = new Logger('Routes');
    
    // 初始化服务依赖
    this.initializeServices();
    this.setupRoutes();
  }

  private initializeServices() {
    try {
      // 初始化核心组件
      const intentClassifier = new IntentClassifier();
      const contextManager = new ContextManager();
      const responseGenerator = new ResponseGenerator();
      const emotionAnalyzer = new EmotionAnalyzer();

      // 初始化对话引擎
      const conversationEngine = new ConversationEngine(
        intentClassifier,
        contextManager,
        responseGenerator,
        emotionAnalyzer
      );

      // 初始化控制器
      this.conversationController = new ConversationController(conversationEngine);
      this.healthController = new HealthController();

      this.logger.info('Services initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize services', error);
      throw error;
    }
  }

  private setupRoutes() {
    // 健康检查路由
    this.setupHealthRoutes();
    
    // API v1 路由
    this.setupApiV1Routes();
    
    // 错误处理
    this.setupErrorHandling();

    this.logger.info('Routes configured successfully');
  }

  /**
   * 设置健康检查路由
   */
  private setupHealthRoutes() {
    // 基础健康检查
    this.router.get('/health', this.healthController.basicHealth);
    
    // 详细健康检查
    this.router.get('/health/detailed', this.healthController.detailedHealth);
    
    // Kubernetes 存活检查
    this.router.get('/health/liveness', this.healthController.livenessCheck);
    
    // Kubernetes 就绪检查
    this.router.get('/health/readiness', this.healthController.readinessCheck);
  }

  /**
   * 设置 API v1 路由
   */
  private setupApiV1Routes() {
    const v1Router = Router();

    // 对话相关路由
    this.setupConversationRoutes(v1Router);
    
    // 配置和状态路由
    this.setupConfigRoutes(v1Router);

    // 挂载 v1 路由
    this.router.use('/api/v1', v1Router);
  }

  /**
   * 设置对话相关路由
   */
  private setupConversationRoutes(router: Router) {
    // 处理对话轮次
    router.post('/conversation/process', this.conversationController.processConversation);
    
    // 批量处理对话
    router.post('/conversation/batch', this.conversationController.batchProcessConversations);
    
    // 获取对话统计信息
    router.get('/conversation/:callId/stats', this.conversationController.getConversationStats);
    
    // 结束对话
    router.post('/conversation/:callId/end', this.conversationController.endConversation);
  }

  /**
   * 设置配置相关路由
   */
  private setupConfigRoutes(router: Router) {
    // 获取引擎配置
    router.get('/conversation/config', this.conversationController.getEngineConfig);
    
    // 服务信息
    router.get('/info', this.getServiceInfo);
    
    // 版本信息
    router.get('/version', this.getVersionInfo);
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling() {
    // 404 处理
    this.router.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
          path: req.originalUrl
        },
        metadata: {
          timestamp: new Date(),
          requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }
      });
    });
  }

  /**
   * 获取服务信息
   */
  private getServiceInfo = (req: any, res: any) => {
    const info = {
      name: 'Conversation Engine Service',
      version: '1.0.0',
      description: 'AI-powered conversation engine for handling spam calls',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      timestamp: new Date(),
      features: {
        intentClassification: 'Multi-layer intent recognition with keyword, semantic, and contextual analysis',
        emotionAnalysis: 'Real-time emotion detection and response adaptation',
        personalizedResponse: 'User personality-based response generation',
        contextManagement: 'Conversation state tracking and history management',
        azureIntegration: 'Azure OpenAI and Speech Services integration'
      },
      endpoints: {
        health: {
          basic: '/health',
          detailed: '/health/detailed',
          liveness: '/health/liveness',
          readiness: '/health/readiness'
        },
        conversation: {
          process: 'POST /api/v1/conversation/process',
          batch: 'POST /api/v1/conversation/batch',
          stats: 'GET /api/v1/conversation/:callId/stats',
          end: 'POST /api/v1/conversation/:callId/end',
          config: 'GET /api/v1/conversation/config'
        }
      }
    };

    res.json({
      success: true,
      data: info,
      metadata: {
        requestId: `info_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date()
      }
    });
  };

  /**
   * 获取版本信息
   */
  private getVersionInfo = (req: any, res: any) => {
    const version = {
      service: 'conversation-engine-ts',
      version: '1.0.0',
      buildDate: new Date().toISOString(),
      gitCommit: process.env.GIT_COMMIT || 'unknown',
      nodeVersion: process.version,
      dependencies: {
        '@azure/openai': '^1.0.0-beta.8',
        'express': '^4.18.2',
        'redis': '^4.6.10',
        'pg': '^8.11.3',
        'natural': '^6.7.0',
        'sentiment': '^5.0.2'
      }
    };

    res.json({
      success: true,
      data: version,
      metadata: {
        requestId: `version_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date()
      }
    });
  };

  /**
   * 获取路由器实例
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * 获取路由列表（用于调试）
   */
  public getRoutesList(): string[] {
    const routes: string[] = [];
    
    const extractRoutes = (router: any, basePath = '') => {
      if (router.stack) {
        router.stack.forEach((layer: any) => {
          if (layer.route) {
            // 直接路由
            const methods = Object.keys(layer.route.methods);
            methods.forEach(method => {
              routes.push(`${method.toUpperCase()} ${basePath}${layer.route.path}`);
            });
          } else if (layer.name === 'router') {
            // 嵌套路由器
            const nestedPath = layer.regexp.source
              .replace('\\', '')
              .replace('?', '')
              .replace('$', '')
              .replace('^', '');
            extractRoutes(layer.handle, basePath + nestedPath);
          }
        });
      }
    };

    extractRoutes(this.router);
    return routes.sort();
  }

  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    try {
      await this.healthController.cleanup();
      this.logger.info('Routes cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup routes', error);
    }
  }
}