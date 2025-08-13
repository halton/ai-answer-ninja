import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Logger } from './utils/Logger';
import { CacheManager } from './utils/CacheManager';
import AdvancedProfileService from './services/AdvancedProfileService';
import RealtimeDataProcessor from './services/RealtimeDataProcessor';
import IntelligentRecommendationEngine from './services/IntelligentRecommendationEngine';
import TrendAnalyzer from './analytics/TrendAnalyzer';
import PredictiveModels from './ml/PredictiveModels';
import { ServiceConfig } from './types';

class ProfileAnalyticsService {
  private app: express.Application;
  private logger: Logger;
  private cache: CacheManager;
  private profileService: AdvancedProfileService;
  private realtimeProcessor: RealtimeDataProcessor;
  private recommendationEngine: IntelligentRecommendationEngine;
  private trendAnalyzer: TrendAnalyzer;
  private predictiveModels: PredictiveModels;
  private config: ServiceConfig;
  private server: any;

  constructor() {
    this.app = express();
    this.logger = new Logger('ProfileAnalyticsService');
    this.cache = new CacheManager();
    
    this.config = {
      port: parseInt(process.env.PORT || '3004'),
      host: process.env.HOST || '0.0.0.0',
      environment: (process.env.NODE_ENV as any) || 'development',
      logLevel: (process.env.LOG_LEVEL as any) || 'INFO',
      enableCaching: process.env.ENABLE_CACHING !== 'false',
      enableRealTimeAnalysis: process.env.ENABLE_REALTIME !== 'false'
    };

    this.initializeServices();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * 初始化服务
   */
  private async initializeServices(): Promise<void> {
    try {
      this.logger.info('Initializing services...');

      // 初始化预测模型
      this.predictiveModels = new PredictiveModels();

      // 初始化趋势分析器
      this.trendAnalyzer = new TrendAnalyzer({
        windowSize: 24,
        seasonalityThreshold: 0.7,
        anomalyThreshold: 3.0,
        forecastHorizon: 48,
        enableRealTimeAnalysis: this.config.enableRealTimeAnalysis
      });

      // 初始化高级画像服务
      this.profileService = new AdvancedProfileService();

      // 初始化实时数据处理器
      this.realtimeProcessor = new RealtimeDataProcessor(this.profileService, {
        batchSize: 100,
        flushInterval: 5000,
        maxRetries: 3,
        enableCompression: true,
        bufferSize: 10000,
        parallelProcessors: 4
      });

      // 初始化推荐引擎
      this.recommendationEngine = new IntelligentRecommendationEngine(this.profileService);

      this.logger.info('All services initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize services', { error });
      throw error;
    }
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 安全中间件
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS配置
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // 压缩
    this.app.use(compression());

    // 速率限制
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 1000, // 每个IP最多1000个请求
      message: {
        error: 'Too many requests from this IP, please try again later.'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // JSON解析
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 请求日志
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.logger.info('HTTP Request', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
          ip: req.ip
        });
      });
      next();
    });
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        environment: this.config.environment,
        services: {
          cache: this.cache.getHealthStatus(),
          realtimeProcessor: this.realtimeProcessor.getMetrics(),
          profileService: 'running'
        }
      });
    });

    // API信息
    this.app.get('/api', (req, res) => {
      res.json({
        name: 'Profile Analytics Service',
        version: '1.0.0',
        description: 'Advanced Profile Analytics Service with ML-powered insights',
        endpoints: {
          profiles: '/api/profiles',
          analytics: '/api/analytics',
          recommendations: '/api/recommendations',
          realtime: '/api/realtime',
          trends: '/api/trends',
          models: '/api/models'
        },
        documentation: '/api/docs'
      });
    });

    // 用户画像路由
    this.setupProfileRoutes();
    
    // 分析路由
    this.setupAnalyticsRoutes();
    
    // 推荐路由
    this.setupRecommendationRoutes();
    
    // 实时数据路由
    this.setupRealtimeRoutes();
    
    // 趋势分析路由
    this.setupTrendRoutes();
    
    // 机器学习模型路由
    this.setupModelRoutes();

    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        availableEndpoints: [
          'GET /health',
          'GET /api',
          'GET /api/profiles/:userId',
          'GET /api/analytics/:userId',
          'GET /api/recommendations/:userId',
          'POST /api/realtime/events',
          'GET /api/trends/:userId',
          'GET /api/models'
        ]
      });
    });
  }

  /**
   * 设置用户画像路由
   */
  private setupProfileRoutes(): void {
    // 获取用户画像
    this.app.get('/api/profiles/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const profile = await this.profileService.getUserProfile(userId);
        res.json(profile);
      } catch (error) {
        this.logger.error('Failed to get user profile', { error, userId: req.params.userId });
        res.status(500).json({ error: 'Failed to get user profile' });
      }
    });

    // 获取来电者画像
    this.app.get('/api/profiles/caller/:phoneNumber', async (req, res) => {
      try {
        const { phoneNumber } = req.params;
        const profile = await this.profileService.getCallerProfile(phoneNumber);
        res.json(profile);
      } catch (error) {
        this.logger.error('Failed to get caller profile', { error, phoneNumber: req.params.phoneNumber });
        res.status(500).json({ error: 'Failed to get caller profile' });
      }
    });

    // 分析用户行为模式
    this.app.get('/api/profiles/:userId/patterns', async (req, res) => {
      try {
        const { userId } = req.params;
        const patterns = await this.profileService.analyzeUserBehaviorPatterns(userId);
        res.json(patterns);
      } catch (error) {
        this.logger.error('Failed to analyze behavior patterns', { error, userId: req.params.userId });
        res.status(500).json({ error: 'Failed to analyze behavior patterns' });
      }
    });

    // 异常检测
    this.app.get('/api/profiles/:userId/anomalies', async (req, res) => {
      try {
        const { userId } = req.params;
        const anomalies = await this.profileService.detectAnomalies(userId);
        res.json(anomalies);
      } catch (error) {
        this.logger.error('Failed to detect anomalies', { error, userId: req.params.userId });
        res.status(500).json({ error: 'Failed to detect anomalies' });
      }
    });

    // 记录交互分析
    this.app.post('/api/profiles/interactions', async (req, res) => {
      try {
        const interaction = req.body;
        await this.profileService.recordInteractionAnalysis(interaction);
        res.json({ success: true });
      } catch (error) {
        this.logger.error('Failed to record interaction', { error, interaction: req.body });
        res.status(500).json({ error: 'Failed to record interaction' });
      }
    });
  }

  /**
   * 设置分析路由
   */
  private setupAnalyticsRoutes(): void {
    // 获取分析摘要
    this.app.get('/api/analytics/:userId/summary', async (req, res) => {
      try {
        const { userId } = req.params;
        const { timeRange } = req.query;
        
        // 这里应该实现分析摘要逻辑
        const summary = {
          userId,
          timeRange: timeRange || 'last_30_days',
          totalCalls: 0,
          spamBlocked: 0,
          aiEffectiveness: 0,
          trends: [],
          insights: []
        };

        res.json(summary);
      } catch (error) {
        this.logger.error('Failed to get analytics summary', { error });
        res.status(500).json({ error: 'Failed to get analytics summary' });
      }
    });

    // 获取指标
    this.app.get('/api/analytics/metrics', async (req, res) => {
      try {
        const metrics = {
          system: this.realtimeProcessor.getMetrics(),
          cache: this.cache.getStatistics(),
          processing: this.realtimeProcessor.getQueueStatus()
        };
        res.json(metrics);
      } catch (error) {
        this.logger.error('Failed to get metrics', { error });
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });
  }

  /**
   * 设置推荐路由
   */
  private setupRecommendationRoutes(): void {
    // 获取用户推荐
    this.app.get('/api/recommendations/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const recommendations = await this.recommendationEngine.getUserRecommendations(userId);
        res.json(recommendations);
      } catch (error) {
        this.logger.error('Failed to get recommendations', { error, userId: req.params.userId });
        res.status(500).json({ error: 'Failed to get recommendations' });
      }
    });

    // 标记推荐为已实施
    this.app.post('/api/recommendations/:userId/:recommendationId/implement', async (req, res) => {
      try {
        const { userId, recommendationId } = req.params;
        await this.recommendationEngine.markRecommendationImplemented(userId, recommendationId);
        res.json({ success: true });
      } catch (error) {
        this.logger.error('Failed to mark recommendation as implemented', { error });
        res.status(500).json({ error: 'Failed to mark recommendation as implemented' });
      }
    });

    // 提供推荐反馈
    this.app.post('/api/recommendations/:userId/:recommendationId/feedback', async (req, res) => {
      try {
        const { userId, recommendationId } = req.params;
        const { feedback } = req.body;
        await this.recommendationEngine.provideFeedback(userId, recommendationId, feedback);
        res.json({ success: true });
      } catch (error) {
        this.logger.error('Failed to provide feedback', { error });
        res.status(500).json({ error: 'Failed to provide feedback' });
      }
    });

    // 获取推荐统计
    this.app.get('/api/recommendations/stats', async (req, res) => {
      try {
        const stats = await this.recommendationEngine.getRecommendationStats();
        res.json(stats);
      } catch (error) {
        this.logger.error('Failed to get recommendation stats', { error });
        res.status(500).json({ error: 'Failed to get recommendation stats' });
      }
    });
  }

  /**
   * 设置实时数据路由
   */
  private setupRealtimeRoutes(): void {
    // 添加实时事件
    this.app.post('/api/realtime/events', async (req, res) => {
      try {
        const dataPoint = req.body;
        await this.realtimeProcessor.addDataPoint(dataPoint);
        res.json({ success: true });
      } catch (error) {
        this.logger.error('Failed to add real-time event', { error });
        res.status(500).json({ error: 'Failed to add real-time event' });
      }
    });

    // 获取实时指标
    this.app.get('/api/realtime/metrics', async (req, res) => {
      try {
        const metrics = this.realtimeProcessor.getMetrics();
        res.json(metrics);
      } catch (error) {
        this.logger.error('Failed to get real-time metrics', { error });
        res.status(500).json({ error: 'Failed to get real-time metrics' });
      }
    });

    // 获取处理器状态
    this.app.get('/api/realtime/processors', async (req, res) => {
      try {
        const processors = this.realtimeProcessor.getProcessorStatus();
        res.json(Array.from(processors.values()));
      } catch (error) {
        this.logger.error('Failed to get processor status', { error });
        res.status(500).json({ error: 'Failed to get processor status' });
      }
    });
  }

  /**
   * 设置趋势分析路由
   */
  private setupTrendRoutes(): void {
    // 获取趋势摘要
    this.app.get('/api/trends/:userId/summary', async (req, res) => {
      try {
        const { userId } = req.params;
        const { metric = 'call_frequency' } = req.query;
        
        const context = {
          userId,
          metric: metric as string,
          timeRange: {
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            end: new Date()
          },
          granularity: 'day' as const
        };

        const summary = await this.trendAnalyzer.getTrendSummary(context);
        res.json(summary);
      } catch (error) {
        this.logger.error('Failed to get trend summary', { error });
        res.status(500).json({ error: 'Failed to get trend summary' });
      }
    });

    // 启动实时趋势监控
    this.app.post('/api/trends/:userId/monitor', async (req, res) => {
      try {
        const { userId } = req.params;
        const { metric = 'call_frequency', interval = 60000 } = req.body;
        
        const context = {
          userId,
          metric,
          timeRange: {
            start: new Date(Date.now() - 24 * 60 * 60 * 1000),
            end: new Date()
          },
          granularity: 'hour' as const
        };

        await this.trendAnalyzer.startRealtimeAnalysis(context, interval);
        res.json({ success: true, monitoring: true });
      } catch (error) {
        this.logger.error('Failed to start trend monitoring', { error });
        res.status(500).json({ error: 'Failed to start trend monitoring' });
      }
    });
  }

  /**
   * 设置机器学习模型路由
   */
  private setupModelRoutes(): void {
    // 获取可用模型
    this.app.get('/api/models', async (req, res) => {
      try {
        const models = this.predictiveModels.listAvailableModels();
        res.json(models);
      } catch (error) {
        this.logger.error('Failed to get models', { error });
        res.status(500).json({ error: 'Failed to get models' });
      }
    });

    // 获取模型性能
    this.app.get('/api/models/:modelName/performance', async (req, res) => {
      try {
        const { modelName } = req.params;
        const performance = this.predictiveModels.getModelPerformance(modelName);
        
        if (performance) {
          res.json(performance);
        } else {
          res.status(404).json({ error: 'Model not found' });
        }
      } catch (error) {
        this.logger.error('Failed to get model performance', { error });
        res.status(500).json({ error: 'Failed to get model performance' });
      }
    });

    // 模型预测
    this.app.post('/api/models/:modelName/predict', async (req, res) => {
      try {
        const { modelName } = req.params;
        const { features } = req.body;
        
        // 获取模型（简化实现）
        const model = { type: 'placeholder' };
        const prediction = await this.predictiveModels.predict(model, features);
        
        res.json(prediction);
      } catch (error) {
        this.logger.error('Failed to make prediction', { error });
        res.status(500).json({ error: 'Failed to make prediction' });
      }
    });
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    // 全局错误处理
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        body: req.body
      });

      res.status(500).json({
        error: 'Internal server error',
        message: this.config.environment === 'development' ? error.message : 'Something went wrong',
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    });

    // 未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection', { reason, promise });
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception', { error });
      process.exit(1);
    });

    // 优雅关闭
    process.on('SIGTERM', () => {
      this.logger.info('SIGTERM received, shutting down gracefully');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      this.logger.info('SIGINT received, shutting down gracefully');
      this.shutdown();
    });
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    try {
      this.server = this.app.listen(this.config.port, this.config.host, () => {
        this.logger.info('Profile Analytics Service started', {
          port: this.config.port,
          host: this.config.host,
          environment: this.config.environment,
          nodeVersion: process.version,
          pid: process.pid
        });
      });

      // 设置服务器超时
      this.server.setTimeout(30000); // 30秒

    } catch (error) {
      this.logger.error('Failed to start service', { error });
      throw error;
    }
  }

  /**
   * 优雅关闭
   */
  async shutdown(): Promise<void> {
    this.logger.info('Starting graceful shutdown...');

    // 停止接受新连接
    if (this.server) {
      this.server.close(() => {
        this.logger.info('HTTP server closed');
      });
    }

    try {
      // 清理资源
      await this.realtimeProcessor.stop();
      await this.profileService.cleanup();
      await this.trendAnalyzer.cleanup();
      await this.cache.shutdown();

      this.logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  }
}

// 启动服务
const service = new ProfileAnalyticsService();
service.start().catch((error) => {
  console.error('Failed to start Profile Analytics Service:', error);
  process.exit(1);
});

export default ProfileAnalyticsService;