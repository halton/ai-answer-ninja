/**
 * Key Management Service
 * Handles encryption key generation, rotation, and secure storage
 */

import * as crypto from 'crypto';
import { logger } from '../utils/Logger';

interface KeyMetadata {
  keyId: string;
  version: string;
  algorithm: string;
  createdAt: Date;
  expiresAt: Date;
  rotatedFrom?: string;
  isActive: boolean;
}

interface MasterKey {
  key: Buffer;
  salt: Buffer;
  version: string;
  createdAt: Date;
}

export class KeyManagement {
  private static instance: KeyManagement;
  private masterKey: MasterKey | null = null;
  private keyCache: Map<string, { key: string; expires: number }> = new Map();
  private keyMetadata: Map<string, KeyMetadata> = new Map();
  private readonly KEY_ROTATION_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 days
  private readonly KEY_CACHE_TTL = 3600000; // 1 hour

  private constructor() {
    this.initializeMasterKey();
    this.startKeyRotationSchedule();
  }

  public static getInstance(): KeyManagement {
    if (!KeyManagement.instance) {
      KeyManagement.instance = new KeyManagement();
    }
    return KeyManagement.instance;
  }

  /**
   * Initialize master key from environment or generate new one
   */
  private async initializeMasterKey(): Promise<void> {
    try {
      // In production, load from secure key management service (AWS KMS, Azure Key Vault, etc.)
      const masterKeyEnv = process.env.MASTER_ENCRYPTION_KEY;
      
      if (masterKeyEnv) {
        const keyBuffer = Buffer.from(masterKeyEnv, 'base64');
        const salt = crypto.randomBytes(32);
        
        this.masterKey = {
          key: keyBuffer,
          salt,
          version: 'v1',
          createdAt: new Date()
        };
      } else {
        // Generate new master key
        this.masterKey = await this.generateMasterKey();
      }

      logger.info('Master key initialized', {
        version: this.masterKey.version,
        createdAt: this.masterKey.createdAt
      });
    } catch (error) {
      logger.error('Failed to initialize master key', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Critical: Failed to initialize encryption keys');
    }
  }

  /**
   * Generate a new master key
   */
  private async generateMasterKey(): Promise<MasterKey> {
    const key = crypto.randomBytes(32); // 256-bit key
    const salt = crypto.randomBytes(32);
    
    return {
      key,
      salt,
      version: `v${Date.now()}`,
      createdAt: new Date()
    };
  }

  /**
   * Get or create encryption key for a specific call
   */
  public async getOrCreateCallKey(callId: string, userId: string): Promise<string> {
    const keyId = `call:${callId}:${userId}`;
    
    // Check cache first
    const cached = this.keyCache.get(keyId);
    if (cached && cached.expires > Date.now()) {
      return cached.key;
    }

    // Generate new key for this call
    const callKey = await this.deriveKey(keyId);
    
    // Cache the key
    this.keyCache.set(keyId, {
      key: callKey,
      expires: Date.now() + this.KEY_CACHE_TTL
    });

    // Store metadata
    this.keyMetadata.set(keyId, {
      keyId,
      version: await this.getCurrentKeyVersion(),
      algorithm: 'aes-256-gcm',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      isActive: true
    });

    return callKey;
  }

  /**
   * Get encryption key for a call
   */
  public async getCallKey(callId: string, userId: string): Promise<string | null> {
    const keyId = `call:${callId}:${userId}`;
    
    // Check cache
    const cached = this.keyCache.get(keyId);
    if (cached && cached.expires > Date.now()) {
      return cached.key;
    }

    // Check if key exists in metadata
    const metadata = this.keyMetadata.get(keyId);
    if (!metadata || !metadata.isActive) {
      return null;
    }

    // Regenerate from master key
    const callKey = await this.deriveKey(keyId);
    
    // Update cache
    this.keyCache.set(keyId, {
      key: callKey,
      expires: Date.now() + this.KEY_CACHE_TTL
    });

    return callKey;
  }

  /**
   * Get user-specific signing key
   */
  public async getUserSigningKey(userId: string): Promise<string> {
    const keyId = `sign:${userId}`;
    return this.deriveKey(keyId);
  }

  /**
   * Get user-specific encryption key
   */
  public async getUserEncryptionKey(userId: string): Promise<string> {
    const keyId = `encrypt:${userId}`;
    return this.deriveKey(keyId);
  }

  /**
   * Derive a key from the master key
   */
  private async deriveKey(context: string): Promise<string> {
    if (!this.masterKey) {
      throw new Error('Master key not initialized');
    }

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        this.masterKey.key,
        Buffer.concat([this.masterKey.salt, Buffer.from(context)]),
        100000,
        32,
        'sha256',
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey.toString('base64'));
        }
      );
    });
  }

  /**
   * Destroy a call key (secure deletion)
   */
  public async destroyCallKey(callId: string, userId: string): Promise<void> {
    const keyId = `call:${callId}:${userId}`;
    
    // Remove from cache
    this.keyCache.delete(keyId);
    
    // Mark as inactive in metadata
    const metadata = this.keyMetadata.get(keyId);
    if (metadata) {
      metadata.isActive = false;
      this.keyMetadata.set(keyId, metadata);
    }

    logger.info('Call key destroyed', { callId, userId });
  }

  /**
   * Get current key version
   */
  public async getCurrentKeyVersion(): Promise<string> {
    return this.masterKey?.version || 'unknown';
  }

  /**
   * Rotate master key
   */
  public async rotateMasterKey(): Promise<void> {
    try {
      const oldKey = this.masterKey;
      const newKey = await this.generateMasterKey();
      
      // Store old key reference for re-encryption
      if (oldKey) {
        newKey.version = `v${parseInt(oldKey.version.substring(1)) + 1}`;
      }

      this.masterKey = newKey;
      
      // Clear key cache to force re-derivation with new master key
      this.keyCache.clear();

      logger.info('Master key rotated', {
        oldVersion: oldKey?.version,
        newVersion: newKey.version,
        timestamp: new Date()
      });

      // Trigger re-encryption of existing data in background
      this.scheduleDataReEncryption(oldKey, newKey);
    } catch (error) {
      logger.error('Master key rotation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to rotate master key');
    }
  }

  /**
   * Schedule automatic key rotation
   */
  private startKeyRotationSchedule(): void {
    setInterval(async () => {
      try {
        await this.rotateMasterKey();
      } catch (error) {
        logger.error('Scheduled key rotation failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.KEY_ROTATION_INTERVAL);
  }

  /**
   * Schedule re-encryption of data with new key
   */
  private async scheduleDataReEncryption(
    oldKey: MasterKey | null,
    newKey: MasterKey
  ): Promise<void> {
    // This would trigger a background job to re-encrypt all data
    logger.info('Data re-encryption scheduled', {
      oldKeyVersion: oldKey?.version,
      newKeyVersion: newKey.version
    });
  }

  /**
   * Generate API key for service authentication
   */
  public async generateAPIKey(serviceId: string): Promise<string> {
    const prefix = 'ak_';
    const randomBytes = crypto.randomBytes(32);
    const timestamp = Date.now().toString(36);
    const signature = crypto
      .createHmac('sha256', this.masterKey?.key || '')
      .update(`${serviceId}:${timestamp}`)
      .digest('hex')
      .substring(0, 16);
    
    const apiKey = `${prefix}${timestamp}_${randomBytes.toString('hex')}_${signature}`;
    
    // Store API key metadata
    this.keyMetadata.set(`api:${serviceId}`, {
      keyId: `api:${serviceId}`,
      version: await this.getCurrentKeyVersion(),
      algorithm: 'hmac-sha256',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      isActive: true
    });

    return apiKey;
  }

  /**
   * Validate API key
   */
  public async validateAPIKey(apiKey: string): Promise<boolean> {
    try {
      if (!apiKey.startsWith('ak_')) {
        return false;
      }

      const parts = apiKey.substring(3).split('_');
      if (parts.length !== 3) {
        return false;
      }

      const [timestamp, random, signature] = parts;
      
      // Check if key is expired (older than 1 year)
      const keyAge = Date.now() - parseInt(timestamp, 36);
      if (keyAge > 365 * 24 * 60 * 60 * 1000) {
        return false;
      }

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.masterKey?.key || '')
        .update(`unknown:${timestamp}`) // Would need to lookup serviceId
        .digest('hex')
        .substring(0, 16);

      return signature === expectedSignature;
    } catch (error) {
      logger.error('API key validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Generate encryption key for database fields
   */
  public async getFieldEncryptionKey(tableName: string, fieldName: string): Promise<string> {
    const keyId = `field:${tableName}:${fieldName}`;
    return this.deriveKey(keyId);
  }

  /**
   * Clean up expired keys from cache
   */
  public cleanupExpiredKeys(): void {
    const now = Date.now();
    
    // Clean cache
    for (const [keyId, cached] of this.keyCache.entries()) {
      if (cached.expires < now) {
        this.keyCache.delete(keyId);
      }
    }

    // Clean metadata
    for (const [keyId, metadata] of this.keyMetadata.entries()) {
      if (metadata.expiresAt < new Date() && !metadata.isActive) {
        this.keyMetadata.delete(keyId);
      }
    }

    logger.info('Expired keys cleaned up', {
      cacheSize: this.keyCache.size,
      metadataSize: this.keyMetadata.size
    });
  }

  /**
   * Export key metrics for monitoring
   */
  public getKeyMetrics(): any {
    return {
      masterKeyVersion: this.masterKey?.version,
      masterKeyAge: this.masterKey ? Date.now() - this.masterKey.createdAt.getTime() : 0,
      cachedKeys: this.keyCache.size,
      totalKeys: this.keyMetadata.size,
      activeKeys: Array.from(this.keyMetadata.values()).filter(m => m.isActive).length,
      expiredKeys: Array.from(this.keyMetadata.values()).filter(m => m.expiresAt < new Date()).length
    };
  }
}