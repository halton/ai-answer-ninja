import crypto from 'crypto';
import { promisify } from 'util';
import { config } from '../../config';
import { EncryptedData, EncryptionMetadata, EncryptionService } from '../../types';
import { logger } from '../../utils/logger';
import { CacheService } from '../cache/CacheService';

const pbkdf2 = promisify(crypto.pbkdf2);

export class AudioEncryptionService implements EncryptionService {
  private readonly algorithm: string;
  private readonly keyLength: number = 32; // 256 bits
  private readonly iterations: number;
  private readonly saltLength: number;
  private readonly ivLength: number;
  private readonly tagLength: number;
  private readonly masterKey: Buffer;
  private readonly cacheService: CacheService;
  private keyVersions: Map<string, string> = new Map();

  constructor(cacheService: CacheService) {
    this.algorithm = config.encryption.algorithm;
    this.iterations = config.encryption.iterations;
    this.saltLength = config.encryption.saltLength;
    this.ivLength = config.encryption.ivLength;
    this.tagLength = config.encryption.tagLength;
    this.cacheService = cacheService;

    // Validate and decode master key
    if (!config.encryption.masterKey) {
      throw new Error('Master encryption key is not configured');
    }
    this.masterKey = Buffer.from(config.encryption.masterKey, 'base64');
    
    if (this.masterKey.length !== this.keyLength) {
      throw new Error(`Master key must be ${this.keyLength} bytes`);
    }

    logger.info('Encryption service initialized', {
      algorithm: this.algorithm,
      keyDerivation: config.encryption.keyDerivation
    });
  }

  /**
   * Encrypt audio data with user-specific key derivation
   */
  async encrypt(data: Buffer, userId: string): Promise<EncryptedData> {
    try {
      // Generate salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);
      
      // Derive user-specific key
      const userKey = await this.deriveUserKey(userId, salt);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, userKey, iv);
      
      // Encrypt data
      const encrypted = Buffer.concat([
        cipher.update(data),
        cipher.final()
      ]);
      
      // Get auth tag for GCM mode
      let authTag: Buffer | undefined;
      if (this.algorithm.includes('gcm')) {
        authTag = cipher.getAuthTag();
      }
      
      // Generate checksum
      const checksum = this.generateChecksum(encrypted);
      
      // Create metadata
      const metadata: EncryptionMetadata = {
        algorithm: this.algorithm,
        keyVersion: await this.getKeyVersion(userId),
        iv: iv.toString('base64'),
        authTag: authTag?.toString('base64'),
        salt: salt.toString('base64'),
        encryptedAt: new Date()
      };
      
      logger.debug('Data encrypted successfully', {
        userId,
        dataSize: data.length,
        encryptedSize: encrypted.length
      });
      
      return {
        data: encrypted,
        metadata,
        checksum
      };
    } catch (error) {
      logger.error('Encryption failed', { userId, error });
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt audio data with user-specific key
   */
  async decrypt(encryptedData: EncryptedData, userId: string): Promise<Buffer> {
    try {
      // Validate integrity
      const isValid = await this.validateIntegrity(encryptedData);
      if (!isValid) {
        throw new Error('Data integrity validation failed');
      }
      
      const { data, metadata } = encryptedData;
      
      // Decode metadata
      const salt = Buffer.from(metadata.salt!, 'base64');
      const iv = Buffer.from(metadata.iv, 'base64');
      const authTag = metadata.authTag ? Buffer.from(metadata.authTag, 'base64') : undefined;
      
      // Derive user-specific key
      const userKey = await this.deriveUserKey(userId, salt);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(metadata.algorithm, userKey, iv);
      
      // Set auth tag for GCM mode
      if (authTag && metadata.algorithm.includes('gcm')) {
        decipher.setAuthTag(authTag);
      }
      
      // Decrypt data
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);
      
      logger.debug('Data decrypted successfully', {
        userId,
        encryptedSize: data.length,
        decryptedSize: decrypted.length
      });
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', { userId, error });
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Generate a new encryption key for a user
   */
  async generateKey(userId: string): Promise<string> {
    try {
      // Generate random key
      const key = crypto.randomBytes(this.keyLength);
      
      // Encrypt key with master key
      const encryptedKey = await this.encryptKey(key);
      
      // Store encrypted key
      const keyId = `key:${userId}:${Date.now()}`;
      await this.cacheService.set(keyId, encryptedKey.toString('base64'), 86400 * 30); // 30 days
      
      // Update key version
      this.keyVersions.set(userId, keyId);
      
      logger.info('New encryption key generated', { userId, keyId });
      
      return keyId;
    } catch (error) {
      logger.error('Key generation failed', { userId, error });
      throw new Error('Failed to generate encryption key');
    }
  }

  /**
   * Rotate encryption key for a user
   */
  async rotateKey(userId: string): Promise<void> {
    try {
      // Generate new key
      const newKeyId = await this.generateKey(userId);
      
      // Get old key version
      const oldKeyId = this.keyVersions.get(userId);
      
      // Schedule re-encryption of existing data
      if (oldKeyId) {
        await this.scheduleReencryption(userId, oldKeyId, newKeyId);
      }
      
      logger.info('Key rotation completed', { userId, newKeyId, oldKeyId });
    } catch (error) {
      logger.error('Key rotation failed', { userId, error });
      throw new Error('Failed to rotate encryption key');
    }
  }

  /**
   * Validate data integrity using checksum
   */
  async validateIntegrity(data: EncryptedData): Promise<boolean> {
    try {
      const calculatedChecksum = this.generateChecksum(data.data);
      return calculatedChecksum === data.checksum;
    } catch (error) {
      logger.error('Integrity validation failed', { error });
      return false;
    }
  }

  /**
   * Derive user-specific key from master key
   */
  private async deriveUserKey(userId: string, salt: Buffer): Promise<Buffer> {
    // Create user-specific context
    const context = Buffer.concat([
      Buffer.from(userId),
      Buffer.from('audio-encryption')
    ]);
    
    // Derive key using PBKDF2
    const derivedKey = await pbkdf2(
      Buffer.concat([this.masterKey, context]),
      salt,
      this.iterations,
      this.keyLength,
      'sha256'
    );
    
    return derivedKey;
  }

  /**
   * Encrypt a key with the master key
   */
  private async encryptKey(key: Buffer): Promise<Buffer> {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    
    const encrypted = Buffer.concat([
      iv,
      cipher.update(key),
      cipher.final()
    ]);
    
    if (this.algorithm.includes('gcm')) {
      const authTag = cipher.getAuthTag();
      return Buffer.concat([encrypted, authTag]);
    }
    
    return encrypted;
  }

  /**
   * Decrypt a key with the master key
   */
  private async decryptKey(encryptedKey: Buffer): Promise<Buffer> {
    const iv = encryptedKey.slice(0, this.ivLength);
    let ciphertext: Buffer;
    let authTag: Buffer | undefined;
    
    if (this.algorithm.includes('gcm')) {
      ciphertext = encryptedKey.slice(this.ivLength, -this.tagLength);
      authTag = encryptedKey.slice(-this.tagLength);
    } else {
      ciphertext = encryptedKey.slice(this.ivLength);
    }
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
    
    if (authTag) {
      decipher.setAuthTag(authTag);
    }
    
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
  }

  /**
   * Generate checksum for data integrity
   */
  private generateChecksum(data: Buffer): string {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');
  }

  /**
   * Get current key version for user
   */
  private async getKeyVersion(userId: string): Promise<string> {
    let version = this.keyVersions.get(userId);
    
    if (!version) {
      // Try to load from cache
      const cachedVersion = await this.cacheService.get(`keyVersion:${userId}`);
      if (cachedVersion) {
        version = cachedVersion;
        this.keyVersions.set(userId, version);
      } else {
        // Generate new key if none exists
        version = await this.generateKey(userId);
      }
    }
    
    return version;
  }

  /**
   * Schedule re-encryption of data after key rotation
   */
  private async scheduleReencryption(userId: string, oldKeyId: string, newKeyId: string): Promise<void> {
    // This would typically queue a job to re-encrypt all user data
    // For now, we'll just log it
    logger.info('Re-encryption scheduled', { userId, oldKeyId, newKeyId });
    
    // In production, this would:
    // 1. Queue a background job
    // 2. Fetch all encrypted data for the user
    // 3. Decrypt with old key
    // 4. Encrypt with new key
    // 5. Update storage with new encrypted data
  }

  /**
   * Securely wipe sensitive data from memory
   */
  private secureWipe(buffer: Buffer): void {
    crypto.randomFillSync(buffer);
    buffer.fill(0);
  }
}