import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import logger from '../utils/logger';
import { FileStorageService } from '../services/FileStorageService';
import { AudioStorageService } from '../services/AudioStorageService';
import { DataArchiveService } from '../cleanup/DataArchiveService';
import {
  FileType,
  StorageTier,
  ApiResponse,
  ValidationError,
  StorageError,
  NotFoundError,
  PaginationParams,
  FileSearchFilter
} from '../types';

// 配置multer用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // 基础文件类型检查
    const allowedMimes = [
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/opus', 'audio/m4a',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg',
      'application/pdf', 'text/plain', 'application/json'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  }
});

// 请求验证Schema
const UploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  fileType: z.nativeEnum(FileType).optional(),
  storageTier: z.nativeEnum(StorageTier).optional(),
  tags: z.array(z.string()).optional(),
  encrypt: z.boolean().optional(),
  compress: z.boolean().optional()
});

const MultipartUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  totalSize: z.number().positive(),
  chunkSize: z.number().positive().max(100 * 1024 * 1024), // 最大100MB分块
  fileType: z.nativeEnum(FileType).optional(),
  storageTier: z.nativeEnum(StorageTier).optional(),
  tags: z.array(z.string()).optional(),
  encrypt: z.boolean().optional(),
  compress: z.boolean().optional()
});

const SearchRequestSchema = z.object({
  fileType: z.nativeEnum(FileType).optional(),
  storageTier: z.nativeEnum(StorageTier).optional(),
  tags: z.array(z.string()).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  sizeMin: z.number().positive().optional(),
  sizeMax: z.number().positive().optional(),
  page: z.number().positive().default(1),
  limit: z.number().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

export function createStorageRoutes(
  fileService: FileStorageService,
  audioService: AudioStorageService,
  archiveService: DataArchiveService
): Router {
  const router = Router();

  // 错误处理中间件
  const handleError = (error: any, res: Response) => {
    logger.error('API Error:', error);

    if (error instanceof ValidationError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        },
        timestamp: new Date()
      } as ApiResponse);
    }

    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message
        },
        timestamp: new Date()
      } as ApiResponse);
    }

    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        },
        timestamp: new Date()
      } as ApiResponse);
    }

    // 未知错误
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      },
      timestamp: new Date()
    } as ApiResponse);
  };

  // 身份验证中间件（简化版）
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User ID header is required'
        },
        timestamp: new Date()
      } as ApiResponse);
    }
    
    req.user = { id: userId };
    next();
  };

  // 1. 上传单个文件
  router.post('/upload', authenticate, upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw new ValidationError('No file provided');
      }

      const requestData = UploadRequestSchema.parse({
        filename: req.body.filename || req.file.originalname,
        fileType: req.body.fileType,
        storageTier: req.body.storageTier,
        tags: req.body.tags ? JSON.parse(req.body.tags) : undefined,
        encrypt: req.body.encrypt === 'true',
        compress: req.body.compress === 'true'
      });

      const uploadRequest = {
        ...requestData,
        data: req.file.buffer,
        mimeType: req.file.mimetype,
        uploaderId: req.user.id
      };

      const metadata = await fileService.uploadFile(uploadRequest);

      res.json({
        success: true,
        data: metadata,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 2. 上传音频文件（带处理）
  router.post('/upload/audio', authenticate, upload.single('audio'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw new ValidationError('No audio file provided');
      }

      const processingOptions = {
        targetFormat: req.body.targetFormat as 'mp3' | 'wav' | 'opus' | 'm4a',
        targetBitrate: req.body.targetBitrate ? parseInt(req.body.targetBitrate) : undefined,
        normalizeAudio: req.body.normalizeAudio === 'true',
        removeNoise: req.body.removeNoise === 'true',
        generateWaveform: req.body.generateWaveform === 'true',
        extractThumbnail: req.body.extractThumbnail === 'true'
      };

      const uploadRequest = {
        filename: req.body.filename || req.file.originalname,
        audioData: req.file.buffer,
        uploaderId: req.user.id,
        callId: req.body.callId,
        language: req.body.language,
        transcription: req.body.transcription,
        storageTier: req.body.storageTier as StorageTier,
        encrypt: req.body.encrypt === 'true',
        compress: req.body.compress === 'true'
      };

      const audioInfo = await audioService.uploadAudio(uploadRequest, processingOptions);

      res.json({
        success: true,
        data: audioInfo,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 3. 初始化分块上传
  router.post('/upload/multipart/init', authenticate, async (req: Request, res: Response) => {
    try {
      const requestData = MultipartUploadRequestSchema.parse(req.body);

      const uploadRequest = {
        ...requestData,
        mimeType: req.body.mimeType || 'application/octet-stream',
        uploaderId: req.user.id
      };

      const result = await fileService.initiateMultipartUpload(uploadRequest);

      res.json({
        success: true,
        data: result,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 4. 上传分块
  router.post('/upload/multipart/:uploadId/chunk/:chunkIndex', authenticate, upload.single('chunk'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw new ValidationError('No chunk data provided');
      }

      const uploadId = req.params.uploadId;
      const chunkIndex = parseInt(req.params.chunkIndex);

      if (isNaN(chunkIndex) || chunkIndex < 0) {
        throw new ValidationError('Invalid chunk index');
      }

      const progress = await fileService.uploadChunk(uploadId, chunkIndex, req.file.buffer);

      res.json({
        success: true,
        data: progress,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 5. 完成分块上传
  router.post('/upload/multipart/:uploadId/complete', authenticate, async (req: Request, res: Response) => {
    try {
      const uploadId = req.params.uploadId;
      const requestData = UploadRequestSchema.parse(req.body);

      const completeRequest = {
        ...requestData,
        mimeType: req.body.mimeType || 'application/octet-stream',
        uploaderId: req.user.id
      };

      const metadata = await fileService.completeMultipartUpload(uploadId, completeRequest);

      res.json({
        success: true,
        data: metadata,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 6. 取消分块上传
  router.delete('/upload/multipart/:uploadId', authenticate, async (req: Request, res: Response) => {
    try {
      const uploadId = req.params.uploadId;
      await fileService.abortMultipartUpload(uploadId);

      res.json({
        success: true,
        data: { message: 'Multipart upload aborted successfully' },
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 7. 获取上传进度
  router.get('/upload/multipart/:uploadId/progress', authenticate, async (req: Request, res: Response) => {
    try {
      const uploadId = req.params.uploadId;
      const progress = await fileService.getUploadProgress(uploadId);

      if (!progress) {
        throw new NotFoundError('Upload session');
      }

      res.json({
        success: true,
        data: progress,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 8. 下载文件
  router.get('/download/:fileId', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const result = await fileService.downloadFile(fileId, req.user.id);

      // 设置响应头
      res.setHeader('Content-Type', result.metadata.mimeType);
      res.setHeader('Content-Length', result.data.length);
      res.setHeader('Content-Disposition', `attachment; filename="${result.metadata.originalName}"`);
      
      // 缓存控制
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('ETag', `"${result.metadata.checksum}"`);

      // 检查If-None-Match
      if (req.headers['if-none-match'] === `"${result.metadata.checksum}"`) {
        return res.status(304).end();
      }

      res.send(result.data);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 9. 下载音频文件
  router.get('/download/audio/:fileId', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const result = await audioService.downloadAudio(fileId, req.user.id);

      res.setHeader('Content-Type', result.audioInfo.mimeType);
      res.setHeader('Content-Length', result.audioData.length);
      res.setHeader('Content-Disposition', `attachment; filename="${result.audioInfo.originalName}"`);
      res.setHeader('X-Audio-Duration', result.audioInfo.audioMetadata.duration.toString());
      res.setHeader('X-Audio-Format', result.audioInfo.audioMetadata.format);

      res.send(result.audioData);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 10. 获取音频波形
  router.get('/audio/:fileId/waveform', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const waveform = await audioService.getWaveform(fileId, req.user.id);

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', waveform.length);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存24小时

      res.send(waveform);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 11. 提取音频片段
  router.post('/audio/:fileId/extract', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const { startTime, duration } = req.body;

      if (typeof startTime !== 'number' || typeof duration !== 'number') {
        throw new ValidationError('startTime and duration must be numbers');
      }

      const result = await audioService.extractAudioSegment(fileId, startTime, duration, req.user.id);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', result.segmentData.length);
      res.setHeader('Content-Disposition', `attachment; filename="segment_${startTime}-${duration}.mp3"`);

      res.send(result.segmentData);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 12. 转换音频格式
  router.post('/audio/:fileId/convert', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const { targetFormat, bitrate, sampleRate, quality } = req.body;

      if (!targetFormat || !['mp3', 'wav', 'opus', 'm4a'].includes(targetFormat)) {
        throw new ValidationError('Valid targetFormat is required');
      }

      const options = {
        bitrate: bitrate ? parseInt(bitrate) : undefined,
        sampleRate: sampleRate ? parseInt(sampleRate) : undefined,
        quality: quality as 'low' | 'medium' | 'high'
      };

      const convertedAudio = await audioService.convertAudioFormat(fileId, targetFormat, options, req.user.id);

      res.json({
        success: true,
        data: convertedAudio,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 13. 获取文件元数据
  router.get('/files/:fileId/metadata', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const metadata = await fileService.getFileMetadata(fileId);

      if (!metadata) {
        throw new NotFoundError('File');
      }

      res.json({
        success: true,
        data: metadata,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 14. 搜索文件
  router.get('/files/search', authenticate, async (req: Request, res: Response) => {
    try {
      const searchParams = SearchRequestSchema.parse(req.query);

      const filter: FileSearchFilter = {
        fileType: searchParams.fileType,
        storageTier: searchParams.storageTier,
        tags: searchParams.tags,
        createdAfter: searchParams.createdAfter ? new Date(searchParams.createdAfter) : undefined,
        createdBefore: searchParams.createdBefore ? new Date(searchParams.createdBefore) : undefined,
        sizeMin: searchParams.sizeMin,
        sizeMax: searchParams.sizeMax
      };

      const pagination: PaginationParams = {
        page: searchParams.page,
        limit: searchParams.limit,
        sortBy: searchParams.sortBy,
        sortOrder: searchParams.sortOrder
      };

      const result = await fileService.searchFiles(filter, pagination, req.user.id);

      res.json({
        success: true,
        data: result,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 15. 删除文件
  router.delete('/files/:fileId', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      await fileService.deleteFile(fileId, req.user.id);

      res.json({
        success: true,
        data: { message: 'File deleted successfully' },
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 16. 更改存储层级
  router.patch('/files/:fileId/tier', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const { tier } = req.body;

      if (!tier || !Object.values(StorageTier).includes(tier)) {
        throw new ValidationError('Valid storage tier is required');
      }

      await fileService.changeStorageTier(fileId, tier, req.user.id);

      res.json({
        success: true,
        data: { message: `Storage tier changed to ${tier}` },
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 17. 生成访问URL
  router.post('/files/:fileId/access-url', authenticate, async (req: Request, res: Response) => {
    try {
      const fileId = req.params.fileId;
      const expirationMinutes = req.body.expirationMinutes || 60;

      if (expirationMinutes < 1 || expirationMinutes > 1440) { // 最大24小时
        throw new ValidationError('Expiration minutes must be between 1 and 1440');
      }

      const url = await fileService.generateAccessUrl(fileId, expirationMinutes, req.user.id);

      res.json({
        success: true,
        data: { url, expiresIn: expirationMinutes * 60 },
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 18. 获取存储统计
  router.get('/stats', authenticate, async (req: Request, res: Response) => {
    try {
      const stats = await archiveService.getStorageStats();

      res.json({
        success: true,
        data: stats,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 19. 执行归档任务
  router.post('/archive/execute/:ruleName', authenticate, async (req: Request, res: Response) => {
    try {
      const ruleName = req.params.ruleName;
      const dryRun = req.body.dryRun === true;

      const report = await archiveService.executeArchiveTask(ruleName, dryRun);

      res.json({
        success: true,
        data: report,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 20. 获取归档规则
  router.get('/archive/rules', authenticate, async (req: Request, res: Response) => {
    try {
      const rules = archiveService.getArchiveRules();

      res.json({
        success: true,
        data: rules,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  // 21. 获取运行中的任务
  router.get('/archive/tasks', authenticate, async (req: Request, res: Response) => {
    try {
      const tasks = archiveService.getRunningTasks();

      res.json({
        success: true,
        data: tasks,
        timestamp: new Date()
      } as ApiResponse);

    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

// 扩展Request类型以包含user属性
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
      };
    }
  }
}