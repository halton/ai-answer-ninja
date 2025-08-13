import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createStorageRoutes } from './api/routes';
import { FileStorageService } from './services/FileStorageService';
import { AudioStorageService } from './services/AudioStorageService';
import { DataArchiveService } from './cleanup/DataArchiveService';
import { BlobStorageManager } from './azure/BlobStorageManager';
import { StorageConfig } from './types';
import logger from './utils/logger';

// 加载配置
const config: StorageConfig = {
  azure: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    containerName: process.env.AZURE_STORAGE_CONTAINER || 'ai-answer-ninja-storage',
    cdnEndpoint: process.env.AZURE_CDN_ENDPOINT
  },
  encryption: {
    algorithm: 'aes-256-gcm',
    keyRotationDays: 90
  },
  compression: {
    enabled: true,
    algorithm: 'gzip',
    minSize: 1024
  },
  cleanup: {
    schedulePattern: '0 2 * * 0', // 每周日凌晨2点
    retentionDays: 90,
    batchSize: 100
  },
  cache: {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      ttl: 3600 // 1小时
    }
  }
};

class StorageServer {
  private app: express.Application;
  private fileService: FileStorageService;
  private audioService: AudioStorageService;
  private archiveService: DataArchiveService;
  private blobManager: BlobStorageManager;
  private server: any;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.initializeServices();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // 安全中间件
    this.app.use(helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    }));

    // CORS配置
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      maxAge: 86400 // 24小时
    }));

    // 压缩响应
    this.app.use(compression());

    // 解析JSON（限制大小）
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 请求日志
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length')
      });
      next();
    });
  }

  private initializeServices(): void {
    try {
      // 验证必要的环境变量
      if (!config.azure.connectionString) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
      }

      // 初始化Azure Blob存储管理器
      this.blobManager = new BlobStorageManager(
        config.azure.connectionString,
        config.azure.containerName,
        config.azure.cdnEndpoint
      );

      // 初始化文件存储服务
      this.fileService = new FileStorageService(config);

      // 初始化音频存储服务
      this.audioService = new AudioStorageService(this.fileService);

      // 初始化数据归档服务
      this.archiveService = new DataArchiveService(
        this.fileService,
        this.blobManager,
        config
      );

      logger.info('All storage services initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize storage services:', error);
      process.exit(1);
    }
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'storage-service',
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // API路由
    this.app.use('/api/v1/storage', createStorageRoutes(
      this.fileService,
      this.audioService,
      this.archiveService
    ));

    // 根路径
    this.app.get('/', (req, res) => {
      res.json({
        service: 'AI Answer Ninja - Storage Service',
        version: process.env.npm_package_version || '1.0.0',
        description: 'Unified storage management service with file storage, audio processing, and data archiving',
        endpoints: {
          health: '/health',
          api: '/api/v1/storage',
          docs: '/api/v1/storage/docs'
        }
      });
    });

    // API文档
    this.app.get('/api/v1/storage/docs', (req, res) => {
      res.json({
        title: 'Storage Service API Documentation',
        version: '1.0.0',
        endpoints: {
          'POST /api/v1/storage/upload': 'Upload single file',
          'POST /api/v1/storage/upload/audio': 'Upload and process audio file',
          'POST /api/v1/storage/upload/multipart/init': 'Initialize multipart upload',
          'POST /api/v1/storage/upload/multipart/:id/chunk/:index': 'Upload chunk',
          'POST /api/v1/storage/upload/multipart/:id/complete': 'Complete multipart upload',
          'GET /api/v1/storage/download/:id': 'Download file',
          'GET /api/v1/storage/download/audio/:id': 'Download audio file',
          'GET /api/v1/storage/audio/:id/waveform': 'Get audio waveform',
          'POST /api/v1/storage/audio/:id/extract': 'Extract audio segment',
          'POST /api/v1/storage/audio/:id/convert': 'Convert audio format',
          'GET /api/v1/storage/files/search': 'Search files',
          'DELETE /api/v1/storage/files/:id': 'Delete file',
          'PATCH /api/v1/storage/files/:id/tier': 'Change storage tier',
          'POST /api/v1/storage/files/:id/access-url': 'Generate access URL',
          'GET /api/v1/storage/stats': 'Get storage statistics',
          'POST /api/v1/storage/archive/execute/:rule': 'Execute archive task',
          'GET /api/v1/storage/archive/rules': 'Get archive rules',
          'GET /api/v1/storage/archive/tasks': 'Get running tasks'
        }
      });
    });

    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Endpoint ${req.method} ${req.path} not found`
        },
        timestamp: new Date()
      });
    });
  }

  private setupErrorHandling(): void {
    // 全局错误处理
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error:', error);

      // Multer错误处理
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds the maximum limit'
          },
          timestamp: new Date()
        });
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILE',
            message: 'Unexpected file field or too many files'
          },
          timestamp: new Date()
        });
      }

      // 默认错误响应
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred'
        },
        timestamp: new Date()
      });
    });

    // 进程错误处理
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // 优雅关闭信号处理
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      this.shutdown();
    });
  }

  public start(port: number = 3008): void {
    this.server = this.app.listen(port, () => {
      logger.info(`Storage Service started successfully`, {
        port,
        environment: process.env.NODE_ENV || 'development',
        container: config.azure.containerName,
        cdnEnabled: !!config.azure.cdnEndpoint
      });
    });

    this.server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`);
      } else {
        logger.error('Server error:', error);
      }
      process.exit(1);
    });
  }

  private async shutdown(): Promise<void> {
    logger.info('Starting graceful shutdown...');

    // 停止接受新连接
    if (this.server) {
      this.server.close(() => {
        logger.info('HTTP server closed');
      });
    }

    try {
      // 停止归档服务
      if (this.archiveService) {
        await this.archiveService.stop();
        logger.info('Archive service stopped');
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  public getApp(): express.Application {
    return this.app;
  }
}

// 启动服务器
if (require.main === module) {
  const server = new StorageServer();
  const port = parseInt(process.env.PORT || '3008');
  server.start(port);
}

export default StorageServer;