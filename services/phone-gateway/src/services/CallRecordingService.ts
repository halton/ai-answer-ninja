import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { CallRecording } from '@azure/communication-call-automation';
import logger from '../utils/logger';
import config from '../config';
import { RecordingInfo, CallState } from '../types';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface RecordingOptions {
  callId: string;
  userId: string;
  format?: 'wav' | 'mp3' | 'mp4';
  quality?: 'low' | 'medium' | 'high';
  encryption?: boolean;
  metadata?: Record<string, any>;
}

export interface RecordingMetadata {
  callId: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  fileSize?: number;
  format: string;
  encrypted: boolean;
  participants?: string[];
  tags?: string[];
}

export interface RecordingSearchCriteria {
  userId?: string;
  callId?: string;
  startDate?: Date;
  endDate?: Date;
  minDuration?: number;
  maxDuration?: number;
  tags?: string[];
}

export class CallRecordingService extends EventEmitter {
  private blobServiceClient: BlobServiceClient | null = null;
  private recordingContainerClient: ContainerClient | null = null;
  private transcriptionContainerClient: ContainerClient | null = null;
  private activeRecordings: Map<string, RecordingInfo> = new Map();
  private recordingMetadata: Map<string, RecordingMetadata> = new Map();
  private encryptionKey: Buffer | null = null;

  constructor() {
    super();
    this.initializeStorage();
    this.initializeEncryption();
  }

  /**
   * Initialize Azure Storage clients
   */
  private async initializeStorage(): Promise<void> {
    try {
      if (!config.azure.storage?.connectionString) {
        logger.warn('Azure Storage not configured for recording service');
        return;
      }

      this.blobServiceClient = BlobServiceClient.fromConnectionString(
        config.azure.storage.connectionString
      );

      // Initialize recording container
      this.recordingContainerClient = this.blobServiceClient.getContainerClient(
        config.azure.storage.recordingContainer
      );
      await this.recordingContainerClient.createIfNotExists({
        access: 'blob',
        metadata: {
          service: 'phone-gateway',
          purpose: 'call-recordings'
        }
      });

      // Initialize transcription container
      this.transcriptionContainerClient = this.blobServiceClient.getContainerClient(
        config.azure.storage.transcriptionContainer
      );
      await this.transcriptionContainerClient.createIfNotExists({
        access: 'blob',
        metadata: {
          service: 'phone-gateway',
          purpose: 'call-transcriptions'
        }
      });

      logger.info('Call recording storage initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize recording storage');
      throw error;
    }
  }

  /**
   * Initialize encryption for sensitive recordings
   */
  private initializeEncryption(): void {
    const encryptionKeyString = process.env.RECORDING_ENCRYPTION_KEY;
    if (encryptionKeyString) {
      this.encryptionKey = Buffer.from(encryptionKeyString, 'hex');
      logger.info('Recording encryption enabled');
    }
  }

  /**
   * Start recording a call
   */
  async startRecording(options: RecordingOptions): Promise<RecordingInfo> {
    const { callId, userId, format = 'wav', quality = 'high', encryption = false, metadata } = options;

    try {
      logger.info({ callId, userId, format, quality }, 'Starting call recording');

      // Generate unique recording ID
      const recordingId = this.generateRecordingId(callId);
      const timestamp = new Date();

      // Prepare storage path
      const storagePath = this.generateStoragePath(userId, callId, timestamp, format);
      const storageUrl = await this.getStorageUrl(storagePath);

      // Create recording info
      const recordingInfo: RecordingInfo = {
        recordingId,
        status: 'active',
        startTime: timestamp,
        storageUrl,
        recordingUrl: storagePath
      };

      // Store recording metadata
      const recordingMetadata: RecordingMetadata = {
        callId,
        userId,
        startTime: timestamp,
        format,
        encrypted: encryption,
        ...metadata
      };

      this.activeRecordings.set(callId, recordingInfo);
      this.recordingMetadata.set(recordingId, recordingMetadata);

      // Emit recording started event
      this.emit('recordingStarted', {
        callId,
        recordingId,
        timestamp
      });

      logger.info({ callId, recordingId, storagePath }, 'Recording started successfully');

      return recordingInfo;
    } catch (error) {
      logger.error({ error, callId }, 'Failed to start recording');
      throw error;
    }
  }

  /**
   * Stop recording a call
   */
  async stopRecording(callId: string): Promise<RecordingInfo | null> {
    try {
      const recordingInfo = this.activeRecordings.get(callId);
      if (!recordingInfo) {
        logger.warn({ callId }, 'No active recording found');
        return null;
      }

      logger.info({ callId, recordingId: recordingInfo.recordingId }, 'Stopping call recording');

      // Update recording info
      recordingInfo.status = 'stopped';
      recordingInfo.endTime = new Date();
      recordingInfo.duration = recordingInfo.endTime.getTime() - recordingInfo.startTime.getTime();

      // Update metadata
      const metadata = this.recordingMetadata.get(recordingInfo.recordingId);
      if (metadata) {
        metadata.endTime = recordingInfo.endTime;
        metadata.duration = recordingInfo.duration;
      }

      // Remove from active recordings
      this.activeRecordings.delete(callId);

      // Emit recording stopped event
      this.emit('recordingStopped', {
        callId,
        recordingId: recordingInfo.recordingId,
        duration: recordingInfo.duration,
        timestamp: recordingInfo.endTime
      });

      logger.info({ 
        callId, 
        recordingId: recordingInfo.recordingId,
        duration: recordingInfo.duration 
      }, 'Recording stopped successfully');

      return recordingInfo;
    } catch (error) {
      logger.error({ error, callId }, 'Failed to stop recording');
      throw error;
    }
  }

  /**
   * Process completed recording
   */
  async processCompletedRecording(
    recordingId: string, 
    recordingUrl: string,
    fileSize?: number
  ): Promise<void> {
    try {
      logger.info({ recordingId, recordingUrl }, 'Processing completed recording');

      const metadata = this.recordingMetadata.get(recordingId);
      if (!metadata) {
        logger.warn({ recordingId }, 'Recording metadata not found');
        return;
      }

      // Update metadata with file information
      if (fileSize) {
        metadata.fileSize = fileSize;
      }

      // Apply post-processing if needed
      if (metadata.encrypted && this.encryptionKey) {
        await this.encryptRecording(recordingUrl);
      }

      // Generate thumbnail/preview if applicable
      await this.generateRecordingPreview(recordingId, recordingUrl);

      // Index recording for search
      await this.indexRecording(recordingId, metadata);

      // Emit processing completed event
      this.emit('recordingProcessed', {
        recordingId,
        metadata,
        timestamp: new Date()
      });

      logger.info({ recordingId }, 'Recording processing completed');
    } catch (error) {
      logger.error({ error, recordingId }, 'Failed to process recording');
      throw error;
    }
  }

  /**
   * Retrieve recording by ID
   */
  async getRecording(recordingId: string): Promise<{
    metadata: RecordingMetadata | null;
    downloadUrl: string | null;
  }> {
    try {
      const metadata = this.recordingMetadata.get(recordingId);
      if (!metadata) {
        logger.warn({ recordingId }, 'Recording not found');
        return { metadata: null, downloadUrl: null };
      }

      // Generate secure download URL
      const downloadUrl = await this.generateDownloadUrl(recordingId, metadata);

      return { metadata, downloadUrl };
    } catch (error) {
      logger.error({ error, recordingId }, 'Failed to retrieve recording');
      throw error;
    }
  }

  /**
   * Search recordings based on criteria
   */
  async searchRecordings(criteria: RecordingSearchCriteria): Promise<RecordingMetadata[]> {
    try {
      logger.info({ criteria }, 'Searching recordings');

      const results: RecordingMetadata[] = [];

      for (const [recordingId, metadata] of this.recordingMetadata.entries()) {
        if (this.matchesCriteria(metadata, criteria)) {
          results.push(metadata);
        }
      }

      // Sort by start time (newest first)
      results.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

      logger.info({ criteria, resultCount: results.length }, 'Recording search completed');

      return results;
    } catch (error) {
      logger.error({ error, criteria }, 'Failed to search recordings');
      throw error;
    }
  }

  /**
   * Delete recording
   */
  async deleteRecording(recordingId: string): Promise<boolean> {
    try {
      logger.info({ recordingId }, 'Deleting recording');

      const metadata = this.recordingMetadata.get(recordingId);
      if (!metadata) {
        logger.warn({ recordingId }, 'Recording not found for deletion');
        return false;
      }

      // Delete from storage
      if (this.recordingContainerClient) {
        const blobName = this.getBlobNameFromRecordingId(recordingId);
        const blobClient = this.recordingContainerClient.getBlobClient(blobName);
        await blobClient.deleteIfExists();
      }

      // Remove metadata
      this.recordingMetadata.delete(recordingId);

      // Emit deletion event
      this.emit('recordingDeleted', {
        recordingId,
        metadata,
        timestamp: new Date()
      });

      logger.info({ recordingId }, 'Recording deleted successfully');

      return true;
    } catch (error) {
      logger.error({ error, recordingId }, 'Failed to delete recording');
      throw error;
    }
  }

  /**
   * Archive old recordings
   */
  async archiveOldRecordings(daysOld: number = 30): Promise<number> {
    try {
      logger.info({ daysOld }, 'Archiving old recordings');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      let archivedCount = 0;

      for (const [recordingId, metadata] of this.recordingMetadata.entries()) {
        if (metadata.startTime < cutoffDate) {
          await this.archiveRecording(recordingId, metadata);
          archivedCount++;
        }
      }

      logger.info({ daysOld, archivedCount }, 'Recordings archived');

      return archivedCount;
    } catch (error) {
      logger.error({ error, daysOld }, 'Failed to archive recordings');
      throw error;
    }
  }

  /**
   * Get recording statistics
   */
  async getRecordingStatistics(): Promise<{
    totalRecordings: number;
    activeRecordings: number;
    totalDuration: number;
    totalSize: number;
    averageDuration: number;
  }> {
    let totalDuration = 0;
    let totalSize = 0;
    let recordingCount = 0;

    for (const metadata of this.recordingMetadata.values()) {
      recordingCount++;
      if (metadata.duration) {
        totalDuration += metadata.duration;
      }
      if (metadata.fileSize) {
        totalSize += metadata.fileSize;
      }
    }

    return {
      totalRecordings: recordingCount,
      activeRecordings: this.activeRecordings.size,
      totalDuration,
      totalSize,
      averageDuration: recordingCount > 0 ? totalDuration / recordingCount : 0
    };
  }

  /**
   * Generate unique recording ID
   */
  private generateRecordingId(callId: string): string {
    return `rec-${callId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate storage path for recording
   */
  private generateStoragePath(
    userId: string, 
    callId: string, 
    timestamp: Date, 
    format: string
  ): string {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    
    return `${year}/${month}/${day}/${userId}/${callId}.${format}`;
  }

  /**
   * Get storage URL for a path
   */
  private async getStorageUrl(storagePath: string): Promise<string> {
    if (!this.recordingContainerClient) {
      throw new Error('Storage not configured');
    }

    const blobClient = this.recordingContainerClient.getBlobClient(storagePath);
    return blobClient.url;
  }

  /**
   * Generate secure download URL
   */
  private async generateDownloadUrl(
    recordingId: string, 
    metadata: RecordingMetadata
  ): Promise<string> {
    if (!this.recordingContainerClient) {
      throw new Error('Storage not configured');
    }

    const blobName = this.getBlobNameFromRecordingId(recordingId);
    const blobClient = this.recordingContainerClient.getBlobClient(blobName);

    // Generate SAS token for secure download
    const sasUrl = await blobClient.generateSasUrl({
      permissions: 'r',
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 3600 * 1000) // 1 hour
    });

    return sasUrl;
  }

  /**
   * Get blob name from recording ID
   */
  private getBlobNameFromRecordingId(recordingId: string): string {
    const metadata = this.recordingMetadata.get(recordingId);
    if (!metadata) {
      throw new Error(`Metadata not found for recording ${recordingId}`);
    }

    return this.generateStoragePath(
      metadata.userId,
      metadata.callId,
      metadata.startTime,
      metadata.format
    );
  }

  /**
   * Check if metadata matches search criteria
   */
  private matchesCriteria(
    metadata: RecordingMetadata, 
    criteria: RecordingSearchCriteria
  ): boolean {
    if (criteria.userId && metadata.userId !== criteria.userId) {
      return false;
    }

    if (criteria.callId && metadata.callId !== criteria.callId) {
      return false;
    }

    if (criteria.startDate && metadata.startTime < criteria.startDate) {
      return false;
    }

    if (criteria.endDate && metadata.startTime > criteria.endDate) {
      return false;
    }

    if (criteria.minDuration && (!metadata.duration || metadata.duration < criteria.minDuration)) {
      return false;
    }

    if (criteria.maxDuration && metadata.duration && metadata.duration > criteria.maxDuration) {
      return false;
    }

    if (criteria.tags && criteria.tags.length > 0) {
      if (!metadata.tags || !criteria.tags.some(tag => metadata.tags?.includes(tag))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Encrypt recording file
   */
  private async encryptRecording(recordingUrl: string): Promise<void> {
    if (!this.encryptionKey) {
      logger.warn('Encryption key not available');
      return;
    }

    // Implementation for encrypting the recording file
    logger.info({ recordingUrl }, 'Encrypting recording');
    // Actual encryption logic would go here
  }

  /**
   * Generate recording preview
   */
  private async generateRecordingPreview(
    recordingId: string, 
    recordingUrl: string
  ): Promise<void> {
    // Generate waveform or thumbnail preview
    logger.debug({ recordingId }, 'Generating recording preview');
    // Actual preview generation logic would go here
  }

  /**
   * Index recording for search
   */
  private async indexRecording(
    recordingId: string, 
    metadata: RecordingMetadata
  ): Promise<void> {
    // Index recording metadata for efficient search
    logger.debug({ recordingId }, 'Indexing recording');
    // Actual indexing logic would go here
  }

  /**
   * Archive recording to cold storage
   */
  private async archiveRecording(
    recordingId: string, 
    metadata: RecordingMetadata
  ): Promise<void> {
    // Move recording to archive storage tier
    logger.info({ recordingId }, 'Archiving recording');
    // Actual archiving logic would go here
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up recording service');

    // Stop all active recordings
    const stopPromises = Array.from(this.activeRecordings.keys()).map(callId =>
      this.stopRecording(callId).catch(err =>
        logger.error({ err, callId }, 'Failed to stop recording during cleanup')
      )
    );

    await Promise.allSettled(stopPromises);

    // Clear maps
    this.activeRecordings.clear();
    this.recordingMetadata.clear();

    logger.info('Recording service cleanup completed');
  }
}