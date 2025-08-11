import {
  BlobServiceClient,
  ContainerClient,
  BlockBlobClient,
  BlobDownloadResponseParsed,
  BlobUploadOptions,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  BlobGenerateSasUrlOptions
} from '@azure/storage-blob';
import { config } from '../../config';
import {
  StorageProvider,
  StorageResult,
  RecordingMetadata,
  RecordingFilters,
  ArchivalTier,
  RecordingStatus
} from '../../types';
import { logger } from '../../utils/logger';
import { AudioEncryptionService } from '../encryption/EncryptionService';

export class AzureStorageService implements StorageProvider {
  private blobServiceClient: BlobServiceClient;
  private containerClient: ContainerClient;
  private encryptionService: AudioEncryptionService;
  private cdnEndpoint?: string;

  constructor(encryptionService: AudioEncryptionService) {
    const connectionString = config.storage.azure.connectionString;
    if (!connectionString) {
      throw new Error('Azure Storage connection string is required');
    }

    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(
      config.storage.azure.containerName
    );
    this.encryptionService = encryptionService;
    this.cdnEndpoint = config.storage.azure.cdnEndpoint;

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Create container if it doesn't exist
      await this.containerClient.createIfNotExists({
        access: 'private',
        metadata: {
          service: 'call-recorder',
          encryption: 'enabled',
          created: new Date().toISOString()
        }
      });

      logger.info('Azure Storage Service initialized', {
        container: config.storage.azure.containerName
      });
    } catch (error) {
      logger.error('Failed to initialize Azure Storage', { error });
      throw error;
    }
  }

  /**
   * Upload encrypted audio file to Azure Blob Storage
   */
  async upload(file: Buffer, metadata: RecordingMetadata): Promise<StorageResult> {
    try {
      // Encrypt the file
      const encryptedData = await this.encryptionService.encrypt(file, metadata.userId);
      
      // Generate blob name with directory structure
      const blobName = this.generateBlobName(metadata);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      // Prepare upload options
      const uploadOptions: BlobUploadOptions = {
        blobHTTPHeaders: {
          blobContentType: `audio/${metadata.format}`,
          blobContentEncoding: 'gzip',
          blobCacheControl: 'private, max-age=3600'
        },
        metadata: {
          recordingId: metadata.id,
          callId: metadata.callId,
          userId: metadata.userId,
          encrypted: 'true',
          algorithm: encryptedData.metadata.algorithm,
          keyVersion: encryptedData.metadata.keyVersion,
          checksum: encryptedData.checksum,
          originalSize: file.length.toString(),
          encryptedSize: encryptedData.data.length.toString(),
          createdAt: new Date().toISOString()
        },
        tier: this.mapArchivalTier(ArchivalTier.HOT),
        tags: metadata.tags
      };

      // Upload encrypted data
      const uploadResponse = await blockBlobClient.upload(
        encryptedData.data,
        encryptedData.data.length,
        uploadOptions
      );

      // Store encryption metadata separately
      await this.storeEncryptionMetadata(metadata.id, encryptedData.metadata);

      const result: StorageResult = {
        location: blobName,
        url: blockBlobClient.url,
        etag: uploadResponse.etag,
        versionId: uploadResponse.versionId,
        size: encryptedData.data.length,
        contentType: `audio/${metadata.format}`
      };

      logger.info('Audio file uploaded successfully', {
        recordingId: metadata.id,
        blobName,
        size: result.size,
        encrypted: true
      });

      return result;
    } catch (error) {
      logger.error('Failed to upload audio file', {
        recordingId: metadata.id,
        error
      });
      throw new Error('Failed to upload audio file to Azure Storage');
    }
  }

  /**
   * Download and decrypt audio file from Azure Blob Storage
   */
  async download(recordingId: string): Promise<Buffer> {
    try {
      // Get blob name from metadata
      const blobName = await this.getBlobName(recordingId);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      // Check if blob exists
      const exists = await blockBlobClient.exists();
      if (!exists) {
        throw new Error(`Recording ${recordingId} not found`);
      }

      // Download blob
      const downloadResponse: BlobDownloadResponseParsed = await blockBlobClient.download();
      
      if (!downloadResponse.readableStreamBody) {
        throw new Error('Failed to get readable stream from blob');
      }

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
      }
      const encryptedData = Buffer.concat(chunks);

      // Get encryption metadata
      const encryptionMetadata = await this.getEncryptionMetadata(recordingId);
      const properties = await blockBlobClient.getProperties();
      const checksum = properties.metadata?.checksum || '';

      // Decrypt the data
      const decryptedData = await this.encryptionService.decrypt(
        {
          data: encryptedData,
          metadata: encryptionMetadata,
          checksum
        },
        properties.metadata?.userId || ''
      );

      logger.info('Audio file downloaded successfully', {
        recordingId,
        blobName,
        size: decryptedData.length
      });

      return decryptedData;
    } catch (error) {
      logger.error('Failed to download audio file', {
        recordingId,
        error
      });
      throw new Error('Failed to download audio file from Azure Storage');
    }
  }

  /**
   * Delete audio file from Azure Blob Storage
   */
  async delete(recordingId: string): Promise<void> {
    try {
      const blobName = await this.getBlobName(recordingId);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      // Soft delete (Azure Blob Storage supports soft delete for recovery)
      await blockBlobClient.delete({
        deleteSnapshots: 'include'
      });

      // Delete encryption metadata
      await this.deleteEncryptionMetadata(recordingId);

      logger.info('Audio file deleted successfully', {
        recordingId,
        blobName
      });
    } catch (error) {
      logger.error('Failed to delete audio file', {
        recordingId,
        error
      });
      throw new Error('Failed to delete audio file from Azure Storage');
    }
  }

  /**
   * Generate presigned URL for secure audio streaming
   */
  async getPresignedUrl(recordingId: string, expirySeconds?: number): Promise<string> {
    try {
      const blobName = await this.getBlobName(recordingId);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      // Use CDN endpoint if available
      const baseUrl = this.cdnEndpoint || blockBlobClient.url;

      // Generate SAS token
      const expiresOn = new Date(Date.now() + (expirySeconds || config.storage.azure.sasTokenDuration) * 1000);
      
      const sasOptions: BlobGenerateSasUrlOptions = {
        permissions: BlobSASPermissions.parse('r'), // Read only
        startsOn: new Date(),
        expiresOn,
        ipRange: undefined, // Can be restricted to specific IP ranges
        protocol: 'https',
        version: '2020-12-06',
        cacheControl: 'private, max-age=3600',
        contentDisposition: 'inline',
        contentType: 'audio/mpeg'
      };

      const sasUrl = await blockBlobClient.generateSasUrl(sasOptions);

      // If CDN is configured, replace the blob URL with CDN URL
      const finalUrl = this.cdnEndpoint 
        ? sasUrl.replace(blockBlobClient.url, this.cdnEndpoint + '/' + blobName)
        : sasUrl;

      logger.debug('Presigned URL generated', {
        recordingId,
        expiresOn,
        useCdn: !!this.cdnEndpoint
      });

      return finalUrl;
    } catch (error) {
      logger.error('Failed to generate presigned URL', {
        recordingId,
        error
      });
      throw new Error('Failed to generate presigned URL');
    }
  }

  /**
   * Archive recording to a different storage tier
   */
  async archive(recordingId: string, tier: ArchivalTier): Promise<void> {
    try {
      const blobName = await this.getBlobName(recordingId);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      // Set the access tier
      await blockBlobClient.setAccessTier(this.mapArchivalTier(tier));

      logger.info('Recording archived successfully', {
        recordingId,
        blobName,
        tier
      });
    } catch (error) {
      logger.error('Failed to archive recording', {
        recordingId,
        tier,
        error
      });
      throw new Error('Failed to archive recording');
    }
  }

  /**
   * Restore recording from archive tier
   */
  async restore(recordingId: string): Promise<void> {
    try {
      const blobName = await this.getBlobName(recordingId);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      // Restore to Hot tier with high priority
      await blockBlobClient.setAccessTier('Hot', {
        rehydratePriority: 'High'
      });

      logger.info('Recording restore initiated', {
        recordingId,
        blobName,
        targetTier: 'Hot'
      });
    } catch (error) {
      logger.error('Failed to restore recording', {
        recordingId,
        error
      });
      throw new Error('Failed to restore recording');
    }
  }

  /**
   * List recordings with filters
   */
  async listRecordings(filters?: RecordingFilters): Promise<RecordingMetadata[]> {
    try {
      const recordings: RecordingMetadata[] = [];
      const prefix = filters?.userId ? `users/${filters.userId}/` : '';
      
      // List blobs with prefix
      const blobs = this.containerClient.listBlobsFlat({
        prefix,
        includeTags: true,
        includeMetadata: true
      });

      for await (const blob of blobs) {
        // Apply filters
        if (!this.matchesFilters(blob, filters)) {
          continue;
        }

        // Parse metadata
        const metadata = this.parseBlobMetadata(blob);
        if (metadata) {
          recordings.push(metadata);
        }

        // Apply limit
        if (filters?.limit && recordings.length >= filters.limit) {
          break;
        }
      }

      logger.debug('Recordings listed', {
        count: recordings.length,
        filters
      });

      return recordings;
    } catch (error) {
      logger.error('Failed to list recordings', {
        filters,
        error
      });
      throw new Error('Failed to list recordings');
    }
  }

  /**
   * Generate blob name with directory structure
   */
  private generateBlobName(metadata: RecordingMetadata): string {
    const date = metadata.startTime;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `users/${metadata.userId}/recordings/${year}/${month}/${day}/${metadata.id}.${metadata.format}`;
  }

  /**
   * Get blob name for a recording ID
   */
  private async getBlobName(recordingId: string): Promise<string> {
    // In production, this would query a database or metadata service
    // For now, we'll search for the blob
    const blobs = this.containerClient.listBlobsFlat({
      includeMetadata: true
    });

    for await (const blob of blobs) {
      if (blob.metadata?.recordingId === recordingId) {
        return blob.name;
      }
    }

    throw new Error(`Blob not found for recording ${recordingId}`);
  }

  /**
   * Store encryption metadata
   */
  private async storeEncryptionMetadata(recordingId: string, metadata: any): Promise<void> {
    const metadataBlobName = `metadata/encryption/${recordingId}.json`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(metadataBlobName);
    
    await blockBlobClient.upload(
      JSON.stringify(metadata),
      JSON.stringify(metadata).length,
      {
        blobHTTPHeaders: {
          blobContentType: 'application/json'
        }
      }
    );
  }

  /**
   * Get encryption metadata
   */
  private async getEncryptionMetadata(recordingId: string): Promise<any> {
    const metadataBlobName = `metadata/encryption/${recordingId}.json`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(metadataBlobName);
    
    const downloadResponse = await blockBlobClient.download();
    if (!downloadResponse.readableStreamBody) {
      throw new Error('Failed to get encryption metadata');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.from(chunk));
    }
    
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  /**
   * Delete encryption metadata
   */
  private async deleteEncryptionMetadata(recordingId: string): Promise<void> {
    const metadataBlobName = `metadata/encryption/${recordingId}.json`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(metadataBlobName);
    
    await blockBlobClient.deleteIfExists();
  }

  /**
   * Map archival tier to Azure Access Tier
   */
  private mapArchivalTier(tier: ArchivalTier): string {
    const tierMap: Record<ArchivalTier, string> = {
      [ArchivalTier.HOT]: 'Hot',
      [ArchivalTier.COOL]: 'Cool',
      [ArchivalTier.COLD]: 'Cold',
      [ArchivalTier.ARCHIVE]: 'Archive'
    };
    return tierMap[tier] || 'Hot';
  }

  /**
   * Check if blob matches filters
   */
  private matchesFilters(blob: any, filters?: RecordingFilters): boolean {
    if (!filters) return true;

    // Check date range
    if (filters.startDate || filters.endDate) {
      const blobDate = new Date(blob.properties.lastModified);
      if (filters.startDate && blobDate < filters.startDate) return false;
      if (filters.endDate && blobDate > filters.endDate) return false;
    }

    // Check tags
    if (filters.tags && blob.tags) {
      for (const [key, value] of Object.entries(filters.tags)) {
        if (blob.tags[key] !== value) return false;
      }
    }

    return true;
  }

  /**
   * Parse blob metadata to RecordingMetadata
   */
  private parseBlobMetadata(blob: any): RecordingMetadata | null {
    try {
      if (!blob.metadata?.recordingId) return null;

      return {
        id: blob.metadata.recordingId,
        callId: blob.metadata.callId,
        userId: blob.metadata.userId,
        callerPhone: blob.metadata.callerPhone || '',
        receiverPhone: blob.metadata.receiverPhone || '',
        startTime: new Date(blob.properties.createdOn),
        endTime: new Date(blob.properties.lastModified),
        fileSize: blob.properties.contentLength,
        format: blob.name.split('.').pop() || 'unknown',
        storageLocation: blob.name,
        storageProvider: 'azure',
        status: RecordingStatus.COMPLETED,
        tags: blob.tags,
        createdAt: new Date(blob.properties.createdOn),
        updatedAt: new Date(blob.properties.lastModified)
      };
    } catch (error) {
      logger.error('Failed to parse blob metadata', { blob: blob.name, error });
      return null;
    }
  }
}