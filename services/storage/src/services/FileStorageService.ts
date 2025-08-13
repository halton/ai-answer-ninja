import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import logger from '../utils/logger';
import { CryptoUtils } from '../utils/crypto';
import { CompressionUtils } from '../utils/compression';
import { BlobStorageManager, BlobUploadOptions } from '../azure/BlobStorageManager';
import {
  FileMetadata,
  FileType,
  StorageTier,
  FileStatus,
  UploadProgress,
  ChunkInfo,
  StorageConfig,
  StorageError,
  ValidationError,
  NotFoundError,
  PaginationParams,
  PaginatedResult,
  FileSearchFilter
} from '../types';

export interface FileUploadRequest {
  filename: string;
  data: Buffer;
  mimeType: string;
  uploaderId: string;
  fileType?: FileType;
  tags?: string[];
  storageTier?: StorageTier;
  encrypt?: boolean;
  compress?: boolean;
}

export interface MultipartUploadRequest {
  filename: string;
  totalSize: number;
  chunkSize: number;
  mimeType: string;
  uploaderId: string;
  fileType?: FileType;
  tags?: string[];
  storageTier?: StorageTier;
  encrypt?: boolean;
  compress?: boolean;
}

export class FileStorageService {
  private blobManager: BlobStorageManager;
  private redis: Redis;
  private config: StorageConfig;
  
  // 缓存键前缀
  private static readonly CACHE_PREFIX = 'storage:';
  private static readonly UPLOAD_PROGRESS_PREFIX = 'upload:progress:';
  private static readonly FILE_METADATA_PREFIX = 'file:metadata:';

  constructor(config: StorageConfig) {
    this.config = config;
    
    // 初始化Azure Blob存储
    this.blobManager = new BlobStorageManager(
      config.azure.connectionString,
      config.azure.containerName,
      config.azure.cdnEndpoint
    );

    // 初始化Redis缓存
    this.redis = new Redis({
      host: config.cache.redis.host,
      port: config.cache.redis.port,
      password: config.cache.redis.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });

    logger.info('FileStorageService initialized successfully');
  }

  /**
   * 上传单个文件
   */
  async uploadFile(request: FileUploadRequest): Promise<FileMetadata> {
    try {
      // 验证请求
      this.validateUploadRequest(request);

      // 生成文件ID和安全文件名
      const fileId = uuidv4();
      const secureFilename = CryptoUtils.generateSecureFilename(request.filename, request.uploaderId);
      
      // 检测文件类型
      const fileType = request.fileType || this.detectFileType(request.mimeType);
      
      // 准备上传选项
      const uploadOptions: BlobUploadOptions = {
        encrypt: request.encrypt,
        compress: request.compress && CompressionUtils.shouldCompress(request.data.length, request.mimeType),
        storageTier: request.storageTier || StorageTier.HOT,
        contentType: request.mimeType,
        metadata: {
          file_id: fileId,
          original_name: request.filename,
          uploader_id: request.uploaderId,
          file_type: fileType,
          upload_timestamp: new Date().toISOString()
        },
        tags: {
          file_id: fileId,
          file_type: fileType,
          uploader_id: request.uploaderId,
          ...(request.tags && { custom_tags: request.tags.join(',') })
        }
      };

      // 上传到Azure Blob
      const uploadResult = await this.blobManager.uploadFile(
        secureFilename,
        request.data,
        uploadOptions
      );

      // 创建文件元数据
      const metadata: FileMetadata = {
        id: fileId,
        filename: secureFilename,
        originalName: request.filename,
        mimeType: request.mimeType,
        size: request.data.length,
        fileType,
        storageTier: request.storageTier || StorageTier.HOT,
        status: FileStatus.AVAILABLE,
        uploaderId: request.uploaderId,
        tags: request.tags || [],
        checksum: uploadResult.checksum,
        encryptionKey: uploadResult.metadata.encryption_key,
        compressionRatio: uploadResult.metadata.compression_ratio ? 
          parseFloat(uploadResult.metadata.compression_ratio) : undefined,
        cdnUrl: uploadResult.url,
        createdAt: new Date(),
        updatedAt: new Date(),
        accessCount: 0
      };

      // 缓存文件元数据
      await this.cacheFileMetadata(metadata);

      // 记录上传事件
      logger.info(`File uploaded successfully: ${fileId}`, {
        filename: request.filename,
        size: request.data.length,
        fileType,
        uploaderId: request.uploaderId
      });

      return metadata;

    } catch (error) {
      logger.error('File upload failed:', error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`File upload failed: ${error.message}`, 'UPLOAD_FAILED');
    }
  }

  /**
   * 初始化分块上传
   */
  async initiateMultipartUpload(request: MultipartUploadRequest): Promise<{
    uploadId: string;
    fileId: string;
    chunkSize: number;
    totalChunks: number;
  }> {
    try {
      // 验证请求
      this.validateMultipartRequest(request);

      const fileId = uuidv4();
      const secureFilename = CryptoUtils.generateSecureFilename(request.filename, request.uploaderId);
      
      // 计算分块信息
      const totalChunks = Math.ceil(request.totalSize / request.chunkSize);
      
      // 初始化Azure Blob分块上传
      const uploadId = await this.blobManager.initiateMultipartUpload(secureFilename, {
        file_id: fileId,
        original_name: request.filename,
        uploader_id: request.uploaderId,
        total_size: request.totalSize.toString(),
        chunk_size: request.chunkSize.toString(),
        total_chunks: totalChunks.toString()
      });

      // 创建上传进度跟踪
      const progress: UploadProgress = {
        uploadId,
        fileId,
        totalSize: request.totalSize,
        uploadedSize: 0,
        percentage: 0,
        status: 'pending',
        chunksTotal: totalChunks,
        chunksUploaded: 0
      };

      // 缓存上传进度
      await this.cacheUploadProgress(uploadId, progress);

      logger.info(`Multipart upload initiated: ${uploadId}`, {
        fileId,
        totalChunks,
        totalSize: request.totalSize
      });

      return {
        uploadId,
        fileId,
        chunkSize: request.chunkSize,
        totalChunks
      };

    } catch (error) {
      logger.error('Failed to initiate multipart upload:', error);
      throw new StorageError(`Failed to initiate multipart upload: ${error.message}`, 'MULTIPART_INIT_FAILED');
    }
  }

  /**
   * 上传文件分块
   */
  async uploadChunk(
    uploadId: string,
    chunkIndex: number,
    chunkData: Buffer
  ): Promise<UploadProgress> {
    try {
      // 获取上传进度
      const progress = await this.getUploadProgress(uploadId);
      if (!progress) {
        throw new NotFoundError('Upload session');
      }

      // 获取文件信息（从缓存的progress中获取）
      const fileInfo = await this.getUploadFileInfo(uploadId);
      if (!fileInfo) {
        throw new NotFoundError('Upload file info');
      }

      // 上传分块到Azure Blob
      const etag = await this.blobManager.uploadChunk(
        fileInfo.filename,
        uploadId,
        chunkIndex,
        chunkData
      );

      // 更新上传进度
      progress.chunksUploaded += 1;
      progress.uploadedSize += chunkData.length;
      progress.percentage = (progress.uploadedSize / progress.totalSize) * 100;
      progress.status = progress.chunksUploaded === progress.chunksTotal ? 'completed' : 'uploading';

      // 更新缓存
      await this.cacheUploadProgress(uploadId, progress);

      logger.debug(`Chunk uploaded: ${chunkIndex}/${progress.chunksTotal}`, {
        uploadId,
        progress: progress.percentage.toFixed(2) + '%'
      });

      return progress;

    } catch (error) {
      logger.error(`Failed to upload chunk ${chunkIndex}:`, error);
      
      // 更新失败状态
      const progress = await this.getUploadProgress(uploadId);
      if (progress) {
        progress.status = 'failed';
        progress.error = error.message;
        await this.cacheUploadProgress(uploadId, progress);
      }

      throw new StorageError(`Failed to upload chunk: ${error.message}`, 'CHUNK_UPLOAD_FAILED');
    }
  }

  /**
   * 完成分块上传
   */
  async completeMultipartUpload(
    uploadId: string,
    request: Omit<FileUploadRequest, 'data'>
  ): Promise<FileMetadata> {
    try {
      // 获取上传进度
      const progress = await this.getUploadProgress(uploadId);
      if (!progress || progress.status !== 'completed') {
        throw new StorageError('Upload not completed or not found', 'UPLOAD_INCOMPLETE');
      }

      // 获取文件信息
      const fileInfo = await this.getUploadFileInfo(uploadId);
      if (!fileInfo) {
        throw new NotFoundError('Upload file info');
      }

      // 完成Azure Blob上传
      const etag = await this.blobManager.completeMultipartUpload(fileInfo.filename, uploadId, {
        encrypt: request.encrypt,
        compress: request.compress,
        storageTier: request.storageTier || StorageTier.HOT,
        contentType: request.mimeType,
        tags: {
          file_id: progress.fileId,
          file_type: this.detectFileType(request.mimeType),
          uploader_id: request.uploaderId,
          ...(request.tags && { custom_tags: request.tags.join(',') })
        }
      });

      // 创建文件元数据
      const metadata: FileMetadata = {
        id: progress.fileId,
        filename: fileInfo.filename,
        originalName: request.filename,
        mimeType: request.mimeType,
        size: progress.totalSize,
        fileType: request.fileType || this.detectFileType(request.mimeType),
        storageTier: request.storageTier || StorageTier.HOT,
        status: FileStatus.AVAILABLE,
        uploaderId: request.uploaderId,
        tags: request.tags || [],
        checksum: '', // 将在后续计算
        cdnUrl: await this.blobManager.generateAccessUrl(fileInfo.filename),
        createdAt: new Date(),
        updatedAt: new Date(),
        accessCount: 0
      };

      // 缓存文件元数据
      await this.cacheFileMetadata(metadata);

      // 清理上传进度缓存
      await this.clearUploadProgress(uploadId);

      logger.info(`Multipart upload completed: ${uploadId}`, {
        fileId: progress.fileId,
        totalSize: progress.totalSize
      });

      return metadata;

    } catch (error) {
      logger.error(`Failed to complete multipart upload ${uploadId}:`, error);
      throw new StorageError(`Failed to complete multipart upload: ${error.message}`, 'MULTIPART_COMPLETE_FAILED');
    }
  }

  /**
   * 取消分块上传
   */
  async abortMultipartUpload(uploadId: string): Promise<void> {
    try {
      const fileInfo = await this.getUploadFileInfo(uploadId);
      if (fileInfo) {
        await this.blobManager.abortMultipartUpload(fileInfo.filename, uploadId);
      }

      // 清理缓存
      await this.clearUploadProgress(uploadId);

      logger.info(`Multipart upload aborted: ${uploadId}`);
    } catch (error) {
      logger.error(`Failed to abort multipart upload ${uploadId}:`, error);
      throw new StorageError(`Failed to abort multipart upload: ${error.message}`, 'MULTIPART_ABORT_FAILED');
    }
  }

  /**
   * 下载文件
   */
  async downloadFile(fileId: string, userId?: string): Promise<{
    data: Buffer;
    metadata: FileMetadata;
  }> {
    try {
      // 获取文件元数据
      const metadata = await this.getFileMetadata(fileId);
      if (!metadata) {
        throw new NotFoundError('File');
      }

      // 检查访问权限（如果提供了userId）
      if (userId && metadata.uploaderId !== userId) {
        // 这里可以添加更复杂的权限检查逻辑
        logger.warn(`Unauthorized file access attempt: ${fileId} by ${userId}`);
      }

      // 从Azure Blob下载
      const downloadResult = await this.blobManager.downloadFile(metadata.filename, {
        decrypt: !!metadata.encryptionKey,
        decompress: !!metadata.compressionRatio
      });

      // 验证文件完整性
      if (metadata.checksum) {
        const isValid = CryptoUtils.verifyChecksum(downloadResult.data, metadata.checksum);
        if (!isValid) {
          throw new StorageError('File integrity verification failed', 'INTEGRITY_ERROR');
        }
      }

      // 更新访问统计
      await this.updateAccessStats(fileId);

      logger.debug(`File downloaded successfully: ${fileId}`, {
        size: downloadResult.data.length,
        userId
      });

      return {
        data: downloadResult.data,
        metadata
      };

    } catch (error) {
      logger.error(`Failed to download file ${fileId}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to download file: ${error.message}`, 'DOWNLOAD_FAILED');
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(fileId: string, userId?: string): Promise<void> {
    try {
      // 获取文件元数据
      const metadata = await this.getFileMetadata(fileId);
      if (!metadata) {
        throw new NotFoundError('File');
      }

      // 检查删除权限
      if (userId && metadata.uploaderId !== userId) {
        throw new StorageError('Insufficient permissions to delete file', 'PERMISSION_DENIED', 403);
      }

      // 从Azure Blob删除
      await this.blobManager.deleteFile(metadata.filename);

      // 更新元数据状态
      metadata.status = FileStatus.DELETED;
      metadata.updatedAt = new Date();
      await this.cacheFileMetadata(metadata);

      // 清理缓存
      await this.clearFileMetadataCache(fileId);

      logger.info(`File deleted successfully: ${fileId}`, { userId });

    } catch (error) {
      logger.error(`Failed to delete file ${fileId}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to delete file: ${error.message}`, 'DELETE_FAILED');
    }
  }

  /**
   * 获取文件元数据
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata | null> {
    try {
      // 先从缓存获取
      const cached = await this.getCachedFileMetadata(fileId);
      if (cached) {
        return cached;
      }

      // 如果缓存中没有，可以从数据库或其他持久化存储获取
      // 这里暂时返回null，实际实现中应该从数据库获取
      return null;

    } catch (error) {
      logger.error(`Failed to get file metadata ${fileId}:`, error);
      return null;
    }
  }

  /**
   * 搜索文件
   */
  async searchFiles(
    filter: FileSearchFilter,
    pagination: PaginationParams,
    userId?: string
  ): Promise<PaginatedResult<FileMetadata>> {
    try {
      // 这里应该实现实际的搜索逻辑
      // 可能需要集成数据库查询或搜索引擎
      
      // 暂时返回空结果
      return {
        items: [],
        total: 0,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: 0,
        hasNext: false,
        hasPrev: false
      };

    } catch (error) {
      logger.error('File search failed:', error);
      throw new StorageError(`File search failed: ${error.message}`, 'SEARCH_FAILED');
    }
  }

  /**
   * 更改文件存储层级
   */
  async changeStorageTier(fileId: string, newTier: StorageTier, userId?: string): Promise<void> {
    try {
      const metadata = await this.getFileMetadata(fileId);
      if (!metadata) {
        throw new NotFoundError('File');
      }

      // 检查权限
      if (userId && metadata.uploaderId !== userId) {
        throw new StorageError('Insufficient permissions', 'PERMISSION_DENIED', 403);
      }

      // 更改Azure Blob存储层级
      await this.blobManager.changeStorageTier(metadata.filename, newTier);

      // 更新元数据
      metadata.storageTier = newTier;
      metadata.updatedAt = new Date();
      await this.cacheFileMetadata(metadata);

      logger.info(`Storage tier changed for file ${fileId}: ${newTier}`);

    } catch (error) {
      logger.error(`Failed to change storage tier for file ${fileId}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to change storage tier: ${error.message}`, 'TIER_CHANGE_FAILED');
    }
  }

  /**
   * 生成临时访问URL
   */
  async generateAccessUrl(
    fileId: string,
    expirationMinutes: number = 60,
    userId?: string
  ): Promise<string> {
    try {
      const metadata = await this.getFileMetadata(fileId);
      if (!metadata) {
        throw new NotFoundError('File');
      }

      // 检查权限
      if (userId && metadata.uploaderId !== userId) {
        throw new StorageError('Insufficient permissions', 'PERMISSION_DENIED', 403);
      }

      // 生成访问URL
      const url = await this.blobManager.generateAccessUrl(
        metadata.filename,
        expirationMinutes,
        'r'
      );

      logger.debug(`Access URL generated for file ${fileId}`, {
        expirationMinutes,
        userId
      });

      return url;

    } catch (error) {
      logger.error(`Failed to generate access URL for file ${fileId}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to generate access URL: ${error.message}`, 'URL_GENERATION_FAILED');
    }
  }

  /**
   * 获取上传进度
   */
  async getUploadProgress(uploadId: string): Promise<UploadProgress | null> {
    try {
      const cached = await this.redis.get(`${FileStorageService.UPLOAD_PROGRESS_PREFIX}${uploadId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error(`Failed to get upload progress ${uploadId}:`, error);
      return null;
    }
  }

  // 私有方法

  private validateUploadRequest(request: FileUploadRequest): void {
    if (!request.filename || request.filename.trim().length === 0) {
      throw new ValidationError('Filename is required');
    }

    if (!request.data || request.data.length === 0) {
      throw new ValidationError('File data is required');
    }

    if (!request.mimeType) {
      throw new ValidationError('MIME type is required');
    }

    if (!request.uploaderId) {
      throw new ValidationError('Uploader ID is required');
    }

    // 检查文件大小限制（100MB）
    if (request.data.length > 100 * 1024 * 1024) {
      throw new ValidationError('File size exceeds maximum limit (100MB)');
    }
  }

  private validateMultipartRequest(request: MultipartUploadRequest): void {
    if (!request.filename || request.filename.trim().length === 0) {
      throw new ValidationError('Filename is required');
    }

    if (!request.totalSize || request.totalSize <= 0) {
      throw new ValidationError('Valid total size is required');
    }

    if (!request.chunkSize || request.chunkSize <= 0) {
      throw new ValidationError('Valid chunk size is required');
    }

    if (!request.uploaderId) {
      throw new ValidationError('Uploader ID is required');
    }

    // 检查总文件大小限制（5GB）
    if (request.totalSize > 5 * 1024 * 1024 * 1024) {
      throw new ValidationError('File size exceeds maximum limit (5GB)');
    }

    // 检查分块大小（最小1MB，最大100MB）
    if (request.chunkSize < 1024 * 1024 || request.chunkSize > 100 * 1024 * 1024) {
      throw new ValidationError('Chunk size must be between 1MB and 100MB');
    }
  }

  private detectFileType(mimeType: string): FileType {
    if (mimeType.startsWith('audio/')) return FileType.AUDIO;
    if (mimeType.startsWith('image/')) return FileType.IMAGE;
    if (mimeType.startsWith('video/')) return FileType.VIDEO;
    if (mimeType.includes('document') || mimeType.includes('pdf') || mimeType.includes('text')) {
      return FileType.DOCUMENT;
    }
    return FileType.OTHER;
  }

  private async cacheFileMetadata(metadata: FileMetadata): Promise<void> {
    try {
      await this.redis.setex(
        `${FileStorageService.FILE_METADATA_PREFIX}${metadata.id}`,
        this.config.cache.redis.ttl,
        JSON.stringify(metadata)
      );
    } catch (error) {
      logger.warn(`Failed to cache file metadata ${metadata.id}:`, error);
    }
  }

  private async getCachedFileMetadata(fileId: string): Promise<FileMetadata | null> {
    try {
      const cached = await this.redis.get(`${FileStorageService.FILE_METADATA_PREFIX}${fileId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn(`Failed to get cached file metadata ${fileId}:`, error);
      return null;
    }
  }

  private async clearFileMetadataCache(fileId: string): Promise<void> {
    try {
      await this.redis.del(`${FileStorageService.FILE_METADATA_PREFIX}${fileId}`);
    } catch (error) {
      logger.warn(`Failed to clear file metadata cache ${fileId}:`, error);
    }
  }

  private async cacheUploadProgress(uploadId: string, progress: UploadProgress): Promise<void> {
    try {
      await this.redis.setex(
        `${FileStorageService.UPLOAD_PROGRESS_PREFIX}${uploadId}`,
        3600, // 1小时过期
        JSON.stringify(progress)
      );
    } catch (error) {
      logger.warn(`Failed to cache upload progress ${uploadId}:`, error);
    }
  }

  private async clearUploadProgress(uploadId: string): Promise<void> {
    try {
      await this.redis.del(`${FileStorageService.UPLOAD_PROGRESS_PREFIX}${uploadId}`);
    } catch (error) {
      logger.warn(`Failed to clear upload progress ${uploadId}:`, error);
    }
  }

  private async getUploadFileInfo(uploadId: string): Promise<{ filename: string } | null> {
    // 这里应该从上传会话中获取文件信息
    // 暂时返回null，实际实现需要从会话存储中获取
    return null;
  }

  private async updateAccessStats(fileId: string): Promise<void> {
    try {
      const metadata = await this.getFileMetadata(fileId);
      if (metadata) {
        metadata.accessCount += 1;
        metadata.lastAccessedAt = new Date();
        await this.cacheFileMetadata(metadata);
      }
    } catch (error) {
      logger.warn(`Failed to update access stats for file ${fileId}:`, error);
    }
  }
}