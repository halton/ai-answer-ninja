import { z } from 'zod';

// 文件类型枚举
export enum FileType {
  AUDIO = 'audio',
  IMAGE = 'image',
  DOCUMENT = 'document',
  VIDEO = 'video',
  OTHER = 'other'
}

// 存储层级枚举
export enum StorageTier {
  HOT = 'hot',      // 热存储 - 频繁访问
  COOL = 'cool',    // 冷存储 - 偶尔访问
  ARCHIVE = 'archive' // 归档存储 - 很少访问
}

// 文件状态枚举
export enum FileStatus {
  UPLOADING = 'uploading',
  AVAILABLE = 'available',
  PROCESSING = 'processing',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
  ERROR = 'error'
}

// 文件元数据Schema
export const FileMetadataSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  originalName: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().positive(),
  fileType: z.nativeEnum(FileType),
  storageTier: z.nativeEnum(StorageTier),
  status: z.nativeEnum(FileStatus),
  uploaderId: z.string().uuid(),
  tags: z.array(z.string()).default([]),
  checksum: z.string().optional(),
  encryptionKey: z.string().optional(),
  compressionRatio: z.number().min(0).max(1).optional(),
  cdnUrl: z.string().url().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  expiresAt: z.date().optional(),
  accessCount: z.number().default(0),
  lastAccessedAt: z.date().optional()
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

// 音频文件特定元数据
export const AudioMetadataSchema = z.object({
  duration: z.number().positive(), // 秒
  sampleRate: z.number().positive(),
  channels: z.number().positive(),
  bitrate: z.number().positive(),
  format: z.string(),
  transcription: z.string().optional(),
  language: z.string().optional(),
  callId: z.string().uuid().optional(),
  speakerCount: z.number().optional(),
  qualityScore: z.number().min(0).max(1).optional()
});

export type AudioMetadata = z.infer<typeof AudioMetadataSchema>;

// 完整音频文件信息
export interface AudioFileInfo extends FileMetadata {
  audioMetadata: AudioMetadata;
}

// 上传进度信息
export interface UploadProgress {
  uploadId: string;
  fileId: string;
  totalSize: number;
  uploadedSize: number;
  percentage: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  chunksTotal: number;
  chunksUploaded: number;
  estimatedTimeRemaining?: number;
  error?: string;
}

// 分块上传信息
export interface ChunkInfo {
  chunkIndex: number;
  chunkSize: number;
  startByte: number;
  endByte: number;
  etag?: string;
  uploaded: boolean;
}

// 存储配置
export interface StorageConfig {
  azure: {
    connectionString: string;
    containerName: string;
    cdnEndpoint?: string;
  };
  encryption: {
    algorithm: string;
    keyRotationDays: number;
  };
  compression: {
    enabled: boolean;
    algorithm: 'gzip' | 'brotli';
    minSize: number; // 最小压缩大小(字节)
  };
  cleanup: {
    schedulePattern: string;
    retentionDays: number;
    batchSize: number;
  };
  cache: {
    redis: {
      host: string;
      port: number;
      password?: string;
      ttl: number;
    };
  };
}

// 数据归档策略
export interface ArchivePolicy {
  name: string;
  conditions: {
    fileAge: number; // 天数
    accessCount: number;
    lastAccessDays: number;
    fileTypes: FileType[];
    sizeLargerThan?: number; // 字节
  };
  actions: {
    moveToTier: StorageTier;
    compress: boolean;
    encrypt: boolean;
    notify: boolean;
  };
}

// 清理任务
export interface CleanupTask {
  id: string;
  type: 'delete' | 'archive' | 'compress';
  status: 'pending' | 'running' | 'completed' | 'failed';
  targetFileIds: string[];
  progress: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  stats: {
    totalFiles: number;
    processedFiles: number;
    freedSpace: number; // 字节
    errors: number;
  };
}

// API响应格式
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: Date;
}

// 搜索过滤器
export interface FileSearchFilter {
  fileType?: FileType;
  storageTier?: StorageTier;
  status?: FileStatus;
  uploaderId?: string;
  tags?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  sizeMin?: number;
  sizeMax?: number;
  mimeType?: string;
}

// 分页参数
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// 分页结果
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// 存储统计信息
export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  sizeByTier: Record<StorageTier, number>;
  filesByType: Record<FileType, number>;
  recentUploads: number; // 最近24小时
  recentDownloads: number;
  topFileTypes: Array<{ type: string; count: number; size: number }>;
  storageUsageHistory: Array<{ date: Date; size: number; count: number }>;
}

// 错误类型
export class StorageError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export class ValidationError extends StorageError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends StorageError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends StorageError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}