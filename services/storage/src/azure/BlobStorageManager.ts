import {
  BlobServiceClient,
  ContainerClient,
  BlockBlobClient,
  BlobUploadCommonOptions,
  BlobDownloadResponseParsed,
  BlobDeleteOptions,
  BlobSetTierOptions
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import logger from '../utils/logger';
import { CryptoUtils } from '../utils/crypto';
import { CompressionUtils, CompressionAlgorithm } from '../utils/compression';
import { StorageTier, FileMetadata, ChunkInfo, StorageError } from '../types';

export interface BlobUploadOptions {
  encrypt?: boolean;
  compress?: boolean;
  compressionAlgorithm?: CompressionAlgorithm;
  storageTier?: StorageTier;
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
  contentType?: string;
}

export interface BlobDownloadOptions {
  decrypt?: boolean;
  decompress?: boolean;
  compressionAlgorithm?: CompressionAlgorithm;
  range?: {
    start: number;
    end: number;
  };
}

export interface MultipartUploadSession {
  uploadId: string;
  blobName: string;
  totalChunks: number;
  uploadedChunks: ChunkInfo[];
  metadata: Record<string, string>;
}

export class BlobStorageManager {
  private blobServiceClient: BlobServiceClient;
  private containerClient: ContainerClient;
  private readonly containerName: string;
  private readonly cdnEndpoint?: string;

  constructor(
    connectionStringOrAccount: string,
    containerName: string,
    cdnEndpoint?: string
  ) {
    this.containerName = containerName;
    this.cdnEndpoint = cdnEndpoint;

    // 支持连接字符串或存储账户名
    if (connectionStringOrAccount.includes('DefaultEndpointsProtocol')) {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionStringOrAccount);
    } else {
      // 使用Azure默认凭据
      const credential = new DefaultAzureCredential();
      this.blobServiceClient = new BlobServiceClient(
        `https://${connectionStringOrAccount}.blob.core.windows.net`,
        credential
      );
    }

    this.containerClient = this.blobServiceClient.getContainerClient(containerName);
    this.initializeContainer();
  }

  /**
   * 初始化容器
   */
  private async initializeContainer(): Promise<void> {
    try {
      await this.containerClient.createIfNotExists({
        access: 'private'
      });
      logger.info(`Container ${this.containerName} initialized successfully`);
    } catch (error) {
      logger.error('Failed to initialize container:', error);
      throw new StorageError('Failed to initialize storage container', 'INIT_ERROR');
    }
  }

  /**
   * 上传单个文件
   */
  async uploadFile(
    blobName: string,
    data: Buffer,
    options: BlobUploadOptions = {}
  ): Promise<{
    url: string;
    etag: string;
    checksum: string;
    metadata: Record<string, string>;
  }> {
    try {
      let processedData = data;
      const metadata: Record<string, string> = { ...options.metadata };
      let encryptionKey: string | undefined;
      let compressionInfo: { algorithm: CompressionAlgorithm; ratio: number } | undefined;

      // 压缩处理
      if (options.compress) {
        const algorithm = options.compressionAlgorithm || 'gzip';
        const compressionResult = await CompressionUtils.compress(processedData, algorithm);
        
        if (compressionResult.compressionRatio < 0.9) { // 只有压缩效果好才使用
          processedData = compressionResult.compressed;
          compressionInfo = {
            algorithm: compressionResult.algorithm,
            ratio: compressionResult.compressionRatio
          };
          metadata.compressed = 'true';
          metadata.compression_algorithm = algorithm;
          metadata.original_size = data.length.toString();
          metadata.compression_ratio = compressionResult.compressionRatio.toString();
        }
      }

      // 加密处理
      if (options.encrypt) {
        encryptionKey = CryptoUtils.generateKey();
        const encryptResult = CryptoUtils.encrypt(processedData, encryptionKey);
        processedData = encryptResult.encrypted;
        metadata.encrypted = 'true';
        metadata.encryption_iv = encryptResult.iv;
        metadata.encryption_tag = encryptResult.tag;
      }

      // 计算校验和
      const checksum = CryptoUtils.generateChecksum(processedData);
      metadata.checksum = checksum;
      metadata.upload_timestamp = new Date().toISOString();

      // 准备上传选项
      const uploadOptions: BlobUploadCommonOptions = {
        blobHTTPHeaders: {
          blobContentType: options.contentType || 'application/octet-stream'
        },
        metadata,
        tags: options.tags,
        tier: this.mapStorageTier(options.storageTier || StorageTier.HOT)
      };

      // 执行上传
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const uploadResponse = await blockBlobClient.upload(processedData, processedData.length, uploadOptions);

      // 构建URL（优先使用CDN）
      const url = this.cdnEndpoint 
        ? `${this.cdnEndpoint}/${this.containerName}/${blobName}`
        : blockBlobClient.url;

      logger.info(`File uploaded successfully: ${blobName}`, {
        size: data.length,
        processedSize: processedData.length,
        compressed: !!compressionInfo,
        encrypted: !!options.encrypt,
        storageTier: options.storageTier
      });

      return {
        url,
        etag: uploadResponse.etag!,
        checksum,
        metadata: {
          ...metadata,
          ...(encryptionKey && { encryption_key: encryptionKey })
        }
      };

    } catch (error) {
      logger.error(`Failed to upload file ${blobName}:`, error);
      throw new StorageError(`Failed to upload file: ${error.message}`, 'UPLOAD_ERROR');
    }
  }

  /**
   * 下载文件
   */
  async downloadFile(
    blobName: string,
    options: BlobDownloadOptions = {}
  ): Promise<{
    data: Buffer;
    metadata: Record<string, string>;
    properties: any;
  }> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      let downloadResponse: BlobDownloadResponseParsed;
      
      if (options.range) {
        downloadResponse = await blockBlobClient.download(
          options.range.start,
          options.range.end - options.range.start + 1
        );
      } else {
        downloadResponse = await blockBlobClient.download();
      }

      if (!downloadResponse.readableStreamBody) {
        throw new Error('No data received from blob storage');
      }

      // 读取数据流
      const chunks: Buffer[] = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
      }
      let data = Buffer.concat(chunks);

      const metadata = downloadResponse.metadata || {};

      // 解密处理
      if (options.decrypt && metadata.encrypted === 'true') {
        const encryptionKey = metadata.encryption_key;
        const iv = metadata.encryption_iv;
        const tag = metadata.encryption_tag;
        
        if (!encryptionKey || !iv || !tag) {
          throw new Error('Missing encryption metadata for decryption');
        }
        
        data = CryptoUtils.decrypt(data, encryptionKey, iv, tag);
      }

      // 解压缩处理
      if (options.decompress && metadata.compressed === 'true') {
        const algorithm = (metadata.compression_algorithm as CompressionAlgorithm) || 'gzip';
        data = await CompressionUtils.decompress(data, algorithm);
      }

      // 校验完整性
      if (metadata.checksum) {
        const isValid = CryptoUtils.verifyChecksum(data, metadata.checksum);
        if (!isValid) {
          throw new Error('File integrity check failed');
        }
      }

      logger.debug(`File downloaded successfully: ${blobName}`, {
        size: data.length,
        encrypted: metadata.encrypted === 'true',
        compressed: metadata.compressed === 'true'
      });

      return {
        data,
        metadata,
        properties: downloadResponse
      };

    } catch (error) {
      logger.error(`Failed to download file ${blobName}:`, error);
      throw new StorageError(`Failed to download file: ${error.message}`, 'DOWNLOAD_ERROR');
    }
  }

  /**
   * 分块上传 - 初始化
   */
  async initiateMultipartUpload(
    blobName: string,
    metadata: Record<string, string> = {}
  ): Promise<string> {
    try {
      const uploadId = CryptoUtils.generateUploadId();
      
      // 在metadata中存储上传会话信息
      const sessionMetadata = {
        ...metadata,
        multipart_upload_id: uploadId,
        upload_initiated: new Date().toISOString()
      };

      // 创建一个临时blob来存储会话信息
      const sessionBlobName = `${blobName}.upload_session_${uploadId}`;
      const sessionData = JSON.stringify({
        uploadId,
        blobName,
        metadata: sessionMetadata,
        chunks: []
      });

      const blockBlobClient = this.containerClient.getBlockBlobClient(sessionBlobName);
      await blockBlobClient.upload(Buffer.from(sessionData), sessionData.length, {
        metadata: { session: 'true', upload_id: uploadId }
      });

      logger.info(`Multipart upload initiated: ${uploadId} for ${blobName}`);
      return uploadId;

    } catch (error) {
      logger.error(`Failed to initiate multipart upload for ${blobName}:`, error);
      throw new StorageError('Failed to initiate multipart upload', 'MULTIPART_INIT_ERROR');
    }
  }

  /**
   * 上传分块
   */
  async uploadChunk(
    blobName: string,
    uploadId: string,
    chunkIndex: number,
    chunkData: Buffer
  ): Promise<string> {
    try {
      const blockId = Buffer.from(`chunk-${chunkIndex.toString().padStart(6, '0')}`).toString('base64');
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      await blockBlobClient.stageBlock(blockId, chunkData, chunkData.length);
      
      // 更新会话信息
      await this.updateUploadSession(blobName, uploadId, chunkIndex, blockId);
      
      logger.debug(`Chunk ${chunkIndex} uploaded for ${blobName}`, {
        uploadId,
        chunkSize: chunkData.length
      });

      return blockId;

    } catch (error) {
      logger.error(`Failed to upload chunk ${chunkIndex} for ${blobName}:`, error);
      throw new StorageError('Failed to upload chunk', 'CHUNK_UPLOAD_ERROR');
    }
  }

  /**
   * 完成分块上传
   */
  async completeMultipartUpload(
    blobName: string,
    uploadId: string,
    options: BlobUploadOptions = {}
  ): Promise<string> {
    try {
      // 获取上传会话
      const session = await this.getUploadSession(blobName, uploadId);
      if (!session) {
        throw new Error('Upload session not found');
      }

      // 获取所有块ID
      const blockIds = session.uploadedChunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(chunk => chunk.etag!);

      // 提交块列表
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const commitResponse = await blockBlobClient.commitBlockList(blockIds, {
        blobHTTPHeaders: {
          blobContentType: options.contentType || 'application/octet-stream'
        },
        metadata: session.metadata,
        tags: options.tags,
        tier: this.mapStorageTier(options.storageTier || StorageTier.HOT)
      });

      // 清理会话文件
      await this.cleanupUploadSession(blobName, uploadId);

      logger.info(`Multipart upload completed: ${uploadId} for ${blobName}`);
      return commitResponse.etag!;

    } catch (error) {
      logger.error(`Failed to complete multipart upload ${uploadId} for ${blobName}:`, error);
      throw new StorageError('Failed to complete multipart upload', 'MULTIPART_COMPLETE_ERROR');
    }
  }

  /**
   * 取消分块上传
   */
  async abortMultipartUpload(blobName: string, uploadId: string): Promise<void> {
    try {
      await this.cleanupUploadSession(blobName, uploadId);
      logger.info(`Multipart upload aborted: ${uploadId} for ${blobName}`);
    } catch (error) {
      logger.error(`Failed to abort multipart upload ${uploadId} for ${blobName}:`, error);
      throw new StorageError('Failed to abort multipart upload', 'MULTIPART_ABORT_ERROR');
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(blobName: string, options: BlobDeleteOptions = {}): Promise<void> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.delete(options);
      
      logger.info(`File deleted successfully: ${blobName}`);
    } catch (error) {
      logger.error(`Failed to delete file ${blobName}:`, error);
      throw new StorageError(`Failed to delete file: ${error.message}`, 'DELETE_ERROR');
    }
  }

  /**
   * 更改存储层级
   */
  async changeStorageTier(blobName: string, tier: StorageTier): Promise<void> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const azureTier = this.mapStorageTier(tier);
      
      await blockBlobClient.setAccessTier(azureTier);
      
      logger.info(`Storage tier changed for ${blobName}: ${tier}`);
    } catch (error) {
      logger.error(`Failed to change storage tier for ${blobName}:`, error);
      throw new StorageError('Failed to change storage tier', 'TIER_CHANGE_ERROR');
    }
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(blobName: string): Promise<{
    exists: boolean;
    size?: number;
    lastModified?: Date;
    metadata?: Record<string, string>;
    tier?: string;
  }> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const properties = await blockBlobClient.getProperties();
      
      return {
        exists: true,
        size: properties.contentLength,
        lastModified: properties.lastModified,
        metadata: properties.metadata,
        tier: properties.accessTier
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        return { exists: false };
      }
      throw new StorageError(`Failed to get file info: ${error.message}`, 'INFO_ERROR');
    }
  }

  /**
   * 生成访问URL
   */
  async generateAccessUrl(
    blobName: string, 
    expirationMinutes: number = 60,
    permissions: string = 'r'
  ): Promise<string> {
    try {
      // 如果有CDN，使用CDN URL
      if (this.cdnEndpoint) {
        return `${this.cdnEndpoint}/${this.containerName}/${blobName}`;
      }

      // 否则生成SAS URL
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const expiryDate = new Date();
      expiryDate.setMinutes(expiryDate.getMinutes() + expirationMinutes);

      // Note: 这里需要实际的SAS token生成逻辑
      // 暂时返回blob的直接URL
      return blockBlobClient.url;
      
    } catch (error) {
      logger.error(`Failed to generate access URL for ${blobName}:`, error);
      throw new StorageError('Failed to generate access URL', 'URL_GENERATION_ERROR');
    }
  }

  /**
   * 映射存储层级
   */
  private mapStorageTier(tier: StorageTier): string {
    switch (tier) {
      case StorageTier.HOT:
        return 'Hot';
      case StorageTier.COOL:
        return 'Cool';
      case StorageTier.ARCHIVE:
        return 'Archive';
      default:
        return 'Hot';
    }
  }

  /**
   * 更新上传会话
   */
  private async updateUploadSession(
    blobName: string,
    uploadId: string,
    chunkIndex: number,
    etag: string
  ): Promise<void> {
    try {
      const sessionBlobName = `${blobName}.upload_session_${uploadId}`;
      const session = await this.getUploadSession(blobName, uploadId);
      
      if (session) {
        session.uploadedChunks.push({
          chunkIndex,
          chunkSize: 0,
          startByte: 0,
          endByte: 0,
          etag,
          uploaded: true
        });

        const sessionData = JSON.stringify(session);
        const blockBlobClient = this.containerClient.getBlockBlobClient(sessionBlobName);
        await blockBlobClient.upload(Buffer.from(sessionData), sessionData.length);
      }
    } catch (error) {
      logger.error(`Failed to update upload session ${uploadId}:`, error);
    }
  }

  /**
   * 获取上传会话
   */
  private async getUploadSession(blobName: string, uploadId: string): Promise<MultipartUploadSession | null> {
    try {
      const sessionBlobName = `${blobName}.upload_session_${uploadId}`;
      const blockBlobClient = this.containerClient.getBlockBlobClient(sessionBlobName);
      
      const response = await blockBlobClient.download();
      if (!response.readableStreamBody) {
        return null;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
      }
      const sessionData = Buffer.concat(chunks).toString('utf8');
      
      return JSON.parse(sessionData);
    } catch (error) {
      return null;
    }
  }

  /**
   * 清理上传会话
   */
  private async cleanupUploadSession(blobName: string, uploadId: string): Promise<void> {
    try {
      const sessionBlobName = `${blobName}.upload_session_${uploadId}`;
      const blockBlobClient = this.containerClient.getBlockBlobClient(sessionBlobName);
      await blockBlobClient.delete();
    } catch (error) {
      logger.warn(`Failed to cleanup upload session ${uploadId}:`, error);
    }
  }
}