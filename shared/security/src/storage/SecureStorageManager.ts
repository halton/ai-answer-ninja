/**
 * Secure Storage Manager
 * Implements secure storage mechanisms for sensitive data with encryption at rest
 * Provides data classification, encryption, and secure retrieval capabilities
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { encryptionService } from '../crypto/EncryptionService';
import { logger } from '../utils/Logger';

export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted',
  TOP_SECRET = 'top_secret'
}

export enum StorageType {
  FILE_SYSTEM = 'filesystem',
  DATABASE = 'database',
  OBJECT_STORAGE = 'object_storage',
  IN_MEMORY = 'memory',
  ENCRYPTED_VAULT = 'vault'
}

export interface StorageConfig {
  baseDirectory: string;
  encryptionEnabled: boolean;
  compressionEnabled: boolean;
  backupEnabled: boolean;
  auditEnabled: boolean;
  retentionPolicy: RetentionPolicy;
  accessControls: AccessControls;
}

export interface RetentionPolicy {
  defaultRetentionDays: number;
  classificationRetention: Record<DataClassification, number>;
  autoDelete: boolean;
  archiveAfterDays: number;
}

export interface AccessControls {
  requireAuthentication: boolean;
  allowedRoles: string[];
  ipWhitelist: string[];
  timeBasedAccess: boolean;
  maxAccessAttempts: number;
}

export interface SecureDataEntry {
  id: string;
  classification: DataClassification;
  type: string;
  data: any;
  metadata: StorageMetadata;
  encryption: EncryptionInfo;
  access: AccessInfo;
}

export interface StorageMetadata {
  originalSize: number;
  compressedSize?: number;
  checksum: string;
  contentType: string;
  tags: string[];
  customMetadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface EncryptionInfo {
  algorithm: string;
  keyVersion: string;
  iv: string;
  authTag: string;
  isEncrypted: boolean;
}

export interface AccessInfo {
  owner: string;
  permissions: string[];
  accessCount: number;
  lastAccessed: Date;
  accessHistory: AccessRecord[];
}

export interface AccessRecord {
  timestamp: Date;
  userId: string;
  action: string;
  ipAddress: string;
  success: boolean;
}

export interface StorageResult {
  success: boolean;
  id?: string;
  error?: string;
  metadata?: StorageMetadata;
}

export interface RetrievalResult {
  success: boolean;
  data?: any;
  metadata?: StorageMetadata;
  error?: string;
}

export class SecureStorageManager {
  private static instance: SecureStorageManager;
  private config: StorageConfig;
  private storageIndex: Map<string, SecureDataEntry> = new Map();
  private accessTokens: Map<string, any> = new Map();
  private encryptionKeys: Map<DataClassification, string> = new Map();

  private constructor(config?: Partial<StorageConfig>) {
    this.config = this.mergeConfig(config);
    this.initializeStorage();
  }

  public static getInstance(config?: Partial<StorageConfig>): SecureStorageManager {
    if (!SecureStorageManager.instance) {
      SecureStorageManager.instance = new SecureStorageManager(config);
    }
    return SecureStorageManager.instance;
  }

  /**
   * Store sensitive data securely
   */
  public async store(
    data: any,
    classification: DataClassification,
    type: string,
    owner: string,
    options: {
      tags?: string[];
      metadata?: Record<string, any>;
      expiresIn?: number;
      permissions?: string[];
    } = {}
  ): Promise<StorageResult> {
    try {
      const id = this.generateSecureId();
      
      // Validate data classification
      this.validateDataClassification(data, classification);
      
      // Prepare data for storage
      const processedData = await this.prepareDataForStorage(data, classification);
      
      // Create metadata
      const metadata: StorageMetadata = {
        originalSize: Buffer.byteLength(JSON.stringify(data)),
        checksum: this.calculateChecksum(data),
        contentType: this.detectContentType(data),
        tags: options.tags || [],
        customMetadata: options.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(options.expiresIn && {
          expiresAt: new Date(Date.now() + options.expiresIn)
        })
      };

      // Encrypt data if required
      const encryptionInfo = await this.encryptDataForStorage(
        processedData,
        classification,
        id
      );

      // Create secure data entry
      const entry: SecureDataEntry = {
        id,
        classification,
        type,
        data: encryptionInfo.encryptedData,
        metadata,
        encryption: {
          algorithm: encryptionInfo.algorithm,
          keyVersion: encryptionInfo.keyVersion,
          iv: encryptionInfo.iv,
          authTag: encryptionInfo.authTag,
          isEncrypted: encryptionInfo.isEncrypted
        },
        access: {
          owner,
          permissions: options.permissions || ['read', 'write'],
          accessCount: 0,
          lastAccessed: new Date(),
          accessHistory: []
        }
      };

      // Store data
      await this.writeToStorage(entry);
      
      // Update index
      this.storageIndex.set(id, entry);
      
      // Log storage operation
      await this.logStorageOperation('store', id, owner, classification);
      
      logger.info('Data stored securely', {
        id,
        classification,
        type,
        originalSize: metadata.originalSize,
        encrypted: encryptionInfo.isEncrypted
      });

      return {
        success: true,
        id,
        metadata
      };
    } catch (error) {
      logger.error('Failed to store data securely', {
        classification,
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Storage failed'
      };
    }
  }

  /**
   * Retrieve sensitive data securely
   */
  public async retrieve(
    id: string,
    userId: string,
    accessToken?: string
  ): Promise<RetrievalResult> {
    try {
      // Check if entry exists
      const entry = this.storageIndex.get(id);
      if (!entry) {
        await this.logAccessAttempt(id, userId, 'retrieve', false, 'Entry not found');
        return {
          success: false,
          error: 'Data not found'
        };
      }

      // Validate access permissions
      const hasAccess = await this.validateAccess(entry, userId, 'read', accessToken);
      if (!hasAccess) {
        await this.logAccessAttempt(id, userId, 'retrieve', false, 'Access denied');
        return {
          success: false,
          error: 'Access denied'
        };
      }

      // Check if data has expired
      if (entry.metadata.expiresAt && entry.metadata.expiresAt < new Date()) {
        await this.logAccessAttempt(id, userId, 'retrieve', false, 'Data expired');
        return {
          success: false,
          error: 'Data has expired'
        };
      }

      // Decrypt data if encrypted
      let decryptedData = entry.data;
      if (entry.encryption.isEncrypted) {
        decryptedData = await this.decryptStoredData(entry);
      }

      // Update access information
      await this.updateAccessInfo(entry, userId, 'retrieve');
      
      // Log successful access
      await this.logAccessAttempt(id, userId, 'retrieve', true);

      logger.info('Data retrieved securely', {
        id,
        userId,
        classification: entry.classification,
        type: entry.type
      });

      return {
        success: true,
        data: decryptedData,
        metadata: entry.metadata
      };
    } catch (error) {
      logger.error('Failed to retrieve data securely', {
        id,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      await this.logAccessAttempt(id, userId, 'retrieve', false, 'System error');
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Retrieval failed'
      };
    }
  }

  /**
   * Update sensitive data
   */
  public async update(
    id: string,
    data: any,
    userId: string,
    accessToken?: string
  ): Promise<StorageResult> {
    try {
      const entry = this.storageIndex.get(id);
      if (!entry) {
        return { success: false, error: 'Data not found' };
      }

      // Validate access permissions
      const hasAccess = await this.validateAccess(entry, userId, 'write', accessToken);
      if (!hasAccess) {
        return { success: false, error: 'Access denied' };
      }

      // Prepare updated data
      const processedData = await this.prepareDataForStorage(data, entry.classification);
      
      // Encrypt updated data
      const encryptionInfo = await this.encryptDataForStorage(
        processedData,
        entry.classification,
        id
      );

      // Update entry
      entry.data = encryptionInfo.encryptedData;
      entry.metadata.updatedAt = new Date();
      entry.metadata.originalSize = Buffer.byteLength(JSON.stringify(data));
      entry.metadata.checksum = this.calculateChecksum(data);
      entry.encryption = {
        algorithm: encryptionInfo.algorithm,
        keyVersion: encryptionInfo.keyVersion,
        iv: encryptionInfo.iv,
        authTag: encryptionInfo.authTag,
        isEncrypted: encryptionInfo.isEncrypted
      };

      // Write to storage
      await this.writeToStorage(entry);
      
      // Update access info
      await this.updateAccessInfo(entry, userId, 'update');
      
      // Log update operation
      await this.logStorageOperation('update', id, userId, entry.classification);

      logger.info('Data updated securely', {
        id,
        userId,
        classification: entry.classification
      });

      return {
        success: true,
        id,
        metadata: entry.metadata
      };
    } catch (error) {
      logger.error('Failed to update data securely', {
        id,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Update failed'
      };
    }
  }

  /**
   * Delete sensitive data securely
   */
  public async delete(
    id: string,
    userId: string,
    accessToken?: string,
    secureWipe: boolean = true
  ): Promise<StorageResult> {
    try {
      const entry = this.storageIndex.get(id);
      if (!entry) {
        return { success: false, error: 'Data not found' };
      }

      // Validate access permissions
      const hasAccess = await this.validateAccess(entry, userId, 'delete', accessToken);
      if (!hasAccess) {
        return { success: false, error: 'Access denied' };
      }

      // Perform secure deletion
      if (secureWipe) {
        await this.secureWipeData(entry);
      } else {
        await this.removeFromStorage(id);
      }
      
      // Remove from index
      this.storageIndex.delete(id);
      
      // Log deletion
      await this.logStorageOperation('delete', id, userId, entry.classification);

      logger.info('Data deleted securely', {
        id,
        userId,
        classification: entry.classification,
        secureWipe
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete data securely', {
        id,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Deletion failed'
      };
    }
  }

  /**
   * List accessible data entries
   */
  public async list(
    userId: string,
    filters: {
      classification?: DataClassification;
      type?: string;
      tags?: string[];
      owner?: string;
    } = {}
  ): Promise<{ entries: Array<Omit<SecureDataEntry, 'data'>>; total: number }> {
    try {
      const accessibleEntries: Array<Omit<SecureDataEntry, 'data'>> = [];
      
      for (const [id, entry] of this.storageIndex) {
        // Check access permissions
        const hasAccess = await this.validateAccess(entry, userId, 'read');
        if (!hasAccess) continue;
        
        // Apply filters
        if (filters.classification && entry.classification !== filters.classification) continue;
        if (filters.type && entry.type !== filters.type) continue;
        if (filters.owner && entry.access.owner !== filters.owner) continue;
        if (filters.tags && !filters.tags.every(tag => entry.metadata.tags.includes(tag))) continue;
        
        // Add to results (without sensitive data)
        const { data, ...entryWithoutData } = entry;
        accessibleEntries.push(entryWithoutData);
      }

      logger.info('Data listing completed', {
        userId,
        totalFound: accessibleEntries.length,
        filters
      });

      return {
        entries: accessibleEntries,
        total: accessibleEntries.length
      };
    } catch (error) {
      logger.error('Failed to list data entries', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return { entries: [], total: 0 };
    }
  }

  /**
   * Cleanup expired data
   */
  public async cleanupExpiredData(): Promise<{ deletedCount: number; errors: string[] }> {
    const deletedCount = 0;
    const errors: string[] = [];
    
    try {
      const now = new Date();
      const expiredEntries: string[] = [];
      
      // Find expired entries
      for (const [id, entry] of this.storageIndex) {
        if (entry.metadata.expiresAt && entry.metadata.expiresAt < now) {
          expiredEntries.push(id);
        }
      }
      
      // Delete expired entries
      for (const id of expiredEntries) {
        try {
          await this.secureWipeData(this.storageIndex.get(id)!);
          this.storageIndex.delete(id);
        } catch (error) {
          errors.push(`Failed to delete expired entry ${id}: ${error}`);
        }
      }

      logger.info('Expired data cleanup completed', {
        deletedCount: expiredEntries.length,
        errors: errors.length
      });

      return { deletedCount: expiredEntries.length, errors };
    } catch (error) {
      logger.error('Expired data cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return { deletedCount, errors: [error instanceof Error ? error.message : 'Unknown error'] };
    }
  }

  // Private helper methods

  private mergeConfig(config?: Partial<StorageConfig>): StorageConfig {
    const defaultConfig: StorageConfig = {
      baseDirectory: './secure_storage',
      encryptionEnabled: true,
      compressionEnabled: true,
      backupEnabled: true,
      auditEnabled: true,
      retentionPolicy: {
        defaultRetentionDays: 90,
        classificationRetention: {
          [DataClassification.PUBLIC]: 365,
          [DataClassification.INTERNAL]: 180,
          [DataClassification.CONFIDENTIAL]: 90,
          [DataClassification.RESTRICTED]: 30,
          [DataClassification.TOP_SECRET]: 7
        },
        autoDelete: true,
        archiveAfterDays: 30
      },
      accessControls: {
        requireAuthentication: true,
        allowedRoles: ['user', 'admin'],
        ipWhitelist: [],
        timeBasedAccess: false,
        maxAccessAttempts: 3
      }
    };

    return { ...defaultConfig, ...config };
  }

  private async initializeStorage(): Promise<void> {
    try {
      // Create base directory
      await fs.mkdir(this.config.baseDirectory, { recursive: true });
      
      // Initialize encryption keys for each classification
      for (const classification of Object.values(DataClassification)) {
        const keyId = `storage_${classification}`;
        this.encryptionKeys.set(classification, keyId);
      }
      
      // Load existing index
      await this.loadStorageIndex();
      
      // Start cleanup scheduler
      this.startCleanupScheduler();

      logger.info('Secure storage initialized', {
        baseDirectory: this.config.baseDirectory,
        encryptionEnabled: this.config.encryptionEnabled,
        entriesLoaded: this.storageIndex.size
      });
    } catch (error) {
      logger.error('Failed to initialize secure storage', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private validateDataClassification(data: any, classification: DataClassification): void {
    // Implement data classification validation logic
    // This would analyze the data content and ensure it matches the classification
  }

  private async prepareDataForStorage(data: any, classification: DataClassification): Promise<any> {
    let processedData = data;
    
    // Apply data processing based on classification
    if (classification === DataClassification.TOP_SECRET) {
      // Additional sanitization for top secret data
      processedData = this.sanitizeTopSecretData(data);
    }
    
    // Compress if enabled
    if (this.config.compressionEnabled) {
      processedData = await this.compressData(processedData);
    }
    
    return processedData;
  }

  private async encryptDataForStorage(
    data: any,
    classification: DataClassification,
    id: string
  ): Promise<{
    encryptedData: any;
    algorithm: string;
    keyVersion: string;
    iv: string;
    authTag: string;
    isEncrypted: boolean;
  }> {
    if (!this.config.encryptionEnabled) {
      return {
        encryptedData: data,
        algorithm: 'none',
        keyVersion: 'none',
        iv: '',
        authTag: '',
        isEncrypted: false
      };
    }

    const keyId = this.encryptionKeys.get(classification)!;
    const encryptedResult = await encryptionService.encryptData(
      JSON.stringify(data),
      keyId,
      id
    );

    return {
      encryptedData: encryptedResult.data,
      algorithm: encryptedResult.algorithm,
      keyVersion: encryptedResult.keyVersion,
      iv: encryptedResult.iv,
      authTag: encryptedResult.authTag,
      isEncrypted: true
    };
  }

  private async decryptStoredData(entry: SecureDataEntry): Promise<any> {
    const encryptedData = {
      data: entry.data,
      iv: entry.encryption.iv,
      authTag: entry.encryption.authTag,
      keyVersion: entry.encryption.keyVersion,
      algorithm: entry.encryption.algorithm,
      timestamp: entry.metadata.createdAt.getTime(),
      checksum: entry.metadata.checksum
    };

    const decryptedBuffer = await encryptionService.decryptData(encryptedData, entry.id);
    return JSON.parse(decryptedBuffer.toString());
  }

  private generateSecureId(): string {
    return `sec_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
  }

  private calculateChecksum(data: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  private detectContentType(data: any): string {
    if (Buffer.isBuffer(data)) return 'application/octet-stream';
    if (typeof data === 'string') return 'text/plain';
    if (typeof data === 'object') return 'application/json';
    return 'application/octet-stream';
  }

  private sanitizeTopSecretData(data: any): any {
    // Implement top secret data sanitization
    return data;
  }

  private async compressData(data: any): Promise<any> {
    // Implement data compression
    return data;
  }

  private async validateAccess(
    entry: SecureDataEntry,
    userId: string,
    action: string,
    accessToken?: string
  ): Promise<boolean> {
    // Implement comprehensive access validation
    return entry.access.owner === userId || entry.access.permissions.includes(action);
  }

  private async updateAccessInfo(entry: SecureDataEntry, userId: string, action: string): Promise<void> {
    entry.access.accessCount++;
    entry.access.lastAccessed = new Date();
    entry.access.accessHistory.push({
      timestamp: new Date(),
      userId,
      action,
      ipAddress: '0.0.0.0', // Would get from request context
      success: true
    });
    
    // Keep only last 100 access records
    if (entry.access.accessHistory.length > 100) {
      entry.access.accessHistory = entry.access.accessHistory.slice(-100);
    }
  }

  private async writeToStorage(entry: SecureDataEntry): Promise<void> {
    const filePath = path.join(this.config.baseDirectory, `${entry.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
  }

  private async removeFromStorage(id: string): Promise<void> {
    const filePath = path.join(this.config.baseDirectory, `${id}.json`);
    await fs.unlink(filePath);
  }

  private async secureWipeData(entry: SecureDataEntry): Promise<void> {
    // Implement secure data wiping
    await this.removeFromStorage(entry.id);
  }

  private async loadStorageIndex(): Promise<void> {
    // Load storage index from disk
  }

  private startCleanupScheduler(): void {
    // Start periodic cleanup of expired data
    setInterval(async () => {
      await this.cleanupExpiredData();
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  private async logStorageOperation(
    operation: string,
    id: string,
    userId: string,
    classification: DataClassification
  ): Promise<void> {
    if (this.config.auditEnabled) {
      logger.info('Storage operation logged', {
        operation,
        id,
        userId,
        classification,
        timestamp: new Date()
      });
    }
  }

  private async logAccessAttempt(
    id: string,
    userId: string,
    action: string,
    success: boolean,
    reason?: string
  ): Promise<void> {
    logger.info('Storage access attempt', {
      id,
      userId,
      action,
      success,
      reason,
      timestamp: new Date()
    });
  }
}

// Export singleton instance
export const secureStorageManager = SecureStorageManager.getInstance();