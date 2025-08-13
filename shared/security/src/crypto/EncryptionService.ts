/**
 * Comprehensive Encryption Service
 * Provides end-to-end encryption for voice data and sensitive information
 * Implements AES-256-GCM for data encryption and RSA for key exchange
 */

import * as crypto from 'crypto';
import { logger } from '../utils/Logger';

export interface EncryptionKeyPair {
  publicKey: string;
  privateKey: string;
  keyId: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface EncryptedData {
  data: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  algorithm: string;
  timestamp: number;
  checksum: string;
}

export interface VoiceEncryptionOptions {
  chunkSize?: number;
  compression?: boolean;
  realtime?: boolean;
}

export interface EncryptionMetrics {
  encryptionTime: number;
  decryptionTime: number;
  dataSize: number;
  keyVersion: string;
  algorithm: string;
}

export class EncryptionService {
  private static instance: EncryptionService;
  private readonly AES_ALGORITHM = 'aes-256-gcm';
  private readonly RSA_ALGORITHM = 'rsa';
  private readonly KEY_LENGTH = 256; // bits
  private readonly IV_LENGTH = 16; // bytes
  private readonly AUTH_TAG_LENGTH = 16; // bytes
  private readonly RSA_KEY_SIZE = 2048; // bits

  // Key rotation settings
  private readonly KEY_ROTATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_KEY_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

  private keyStore: Map<string, Buffer> = new Map();
  private keyPairs: Map<string, EncryptionKeyPair> = new Map();
  private metrics: Map<string, EncryptionMetrics[]> = new Map();

  private constructor() {
    this.initializeDefaultKeys();
    this.startKeyRotation();
  }

  public static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
    }
    return EncryptionService.instance;
  }

  /**
   * Initialize default encryption keys
   */
  private async initializeDefaultKeys(): Promise<void> {
    try {
      // Generate system master key
      const masterKey = crypto.randomBytes(this.KEY_LENGTH / 8);
      this.keyStore.set('master', masterKey);

      // Generate default RSA key pair
      const keyPair = await this.generateKeyPair();
      this.keyPairs.set('default', keyPair);

      logger.info('Default encryption keys initialized', {
        masterKeyId: 'master',
        rsaKeyId: keyPair.keyId
      });
    } catch (error) {
      logger.error('Failed to initialize default keys', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate RSA key pair for asymmetric encryption
   */
  public async generateKeyPair(keyId?: string): Promise<EncryptionKeyPair> {
    const startTime = Date.now();
    
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync(this.RSA_ALGORITHM, {
        modulusLength: this.RSA_KEY_SIZE,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });

      const keyPair: EncryptionKeyPair = {
        publicKey,
        privateKey,
        keyId: keyId || this.generateKeyId(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.MAX_KEY_AGE)
      };

      this.keyPairs.set(keyPair.keyId, keyPair);
      
      logger.info('RSA key pair generated', {
        keyId: keyPair.keyId,
        generationTime: Date.now() - startTime
      });

      return keyPair;
    } catch (error) {
      logger.error('Failed to generate RSA key pair', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   */
  public async encryptData(
    data: string | Buffer, 
    keyId: string = 'master',
    additionalData?: string
  ): Promise<EncryptedData> {
    const startTime = Date.now();
    
    try {
      const key = this.getKey(keyId);
      if (!key) {
        throw new Error(`Encryption key not found: ${keyId}`);
      }

      // Generate random IV
      const iv = crypto.randomBytes(this.IV_LENGTH);
      
      // Create cipher
      const cipher = crypto.createCipherGCM(this.AES_ALGORITHM, key, iv);
      if (additionalData) {
        cipher.setAAD(Buffer.from(additionalData));
      }

      // Convert data to buffer if needed
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      
      // Encrypt data
      let encrypted = cipher.update(dataBuffer);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Get authentication tag
      const authTag = cipher.getAuthTag();
      
      // Calculate checksum
      const checksum = this.calculateChecksum(encrypted);

      const encryptedData: EncryptedData = {
        data: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion: keyId,
        algorithm: this.AES_ALGORITHM,
        timestamp: Date.now(),
        checksum
      };

      // Record metrics
      this.recordMetrics('encryption', {
        encryptionTime: Date.now() - startTime,
        decryptionTime: 0,
        dataSize: dataBuffer.length,
        keyVersion: keyId,
        algorithm: this.AES_ALGORITHM
      });

      logger.debug('Data encrypted successfully', {
        keyId,
        dataSize: dataBuffer.length,
        encryptionTime: Date.now() - startTime
      });

      return encryptedData;
    } catch (error) {
      logger.error('Failed to encrypt data', {
        keyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  public async decryptData(
    encryptedData: EncryptedData,
    additionalData?: string
  ): Promise<Buffer> {
    const startTime = Date.now();
    
    try {
      const key = this.getKey(encryptedData.keyVersion);
      if (!key) {
        throw new Error(`Decryption key not found: ${encryptedData.keyVersion}`);
      }

      // Verify checksum
      const dataBuffer = Buffer.from(encryptedData.data, 'base64');
      const expectedChecksum = this.calculateChecksum(dataBuffer);
      if (expectedChecksum !== encryptedData.checksum) {
        throw new Error('Data integrity check failed');
      }

      // Create decipher
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const decipher = crypto.createDecipherGCM(encryptedData.algorithm, key, iv);
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'base64'));
      if (additionalData) {
        decipher.setAAD(Buffer.from(additionalData));
      }

      // Decrypt data
      let decrypted = decipher.update(dataBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      // Record metrics
      this.recordMetrics('decryption', {
        encryptionTime: 0,
        decryptionTime: Date.now() - startTime,
        dataSize: decrypted.length,
        keyVersion: encryptedData.keyVersion,
        algorithm: encryptedData.algorithm
      });

      logger.debug('Data decrypted successfully', {
        keyVersion: encryptedData.keyVersion,
        dataSize: decrypted.length,
        decryptionTime: Date.now() - startTime
      });

      return decrypted;
    } catch (error) {
      logger.error('Failed to decrypt data', {
        keyVersion: encryptedData.keyVersion,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Encrypt voice data with specialized optimizations
   */
  public async encryptVoiceData(
    audioBuffer: Buffer,
    callId: string,
    options: VoiceEncryptionOptions = {}
  ): Promise<EncryptedData> {
    const startTime = Date.now();
    
    try {
      // Generate unique key for this call
      const voiceKey = this.generateVoiceKey(callId);
      
      // Apply compression if requested
      let processedBuffer = audioBuffer;
      if (options.compression) {
        processedBuffer = await this.compressAudioBuffer(audioBuffer);
      }

      // Encrypt with call-specific metadata
      const additionalData = JSON.stringify({
        callId,
        audioFormat: 'wav',
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        timestamp: Date.now()
      });

      const encrypted = await this.encryptData(processedBuffer, voiceKey, additionalData);
      
      // Destroy the temporary key for security
      this.destroyKey(voiceKey);

      logger.info('Voice data encrypted', {
        callId,
        originalSize: audioBuffer.length,
        compressedSize: processedBuffer.length,
        encryptionTime: Date.now() - startTime
      });

      return encrypted;
    } catch (error) {
      logger.error('Failed to encrypt voice data', {
        callId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Decrypt voice data
   */
  public async decryptVoiceData(
    encryptedData: EncryptedData,
    callId: string
  ): Promise<Buffer> {
    try {
      // Recreate the voice key
      const voiceKey = this.generateVoiceKey(callId);
      
      // Prepare additional data
      const additionalData = JSON.stringify({
        callId,
        audioFormat: 'wav',
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        timestamp: encryptedData.timestamp
      });

      // Decrypt with voice key
      const decrypted = await this.decryptData({
        ...encryptedData,
        keyVersion: voiceKey
      }, additionalData);

      // Destroy the temporary key
      this.destroyKey(voiceKey);

      return decrypted;
    } catch (error) {
      logger.error('Failed to decrypt voice data', {
        callId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Encrypt using RSA for key exchange
   */
  public async encryptWithRSA(data: string, publicKeyId: string = 'default'): Promise<string> {
    try {
      const keyPair = this.keyPairs.get(publicKeyId);
      if (!keyPair) {
        throw new Error(`RSA key pair not found: ${publicKeyId}`);
      }

      const encrypted = crypto.publicEncrypt(
        {
          key: keyPair.publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        Buffer.from(data, 'utf8')
      );

      return encrypted.toString('base64');
    } catch (error) {
      logger.error('RSA encryption failed', {
        publicKeyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Decrypt using RSA
   */
  public async decryptWithRSA(encryptedData: string, privateKeyId: string = 'default'): Promise<string> {
    try {
      const keyPair = this.keyPairs.get(privateKeyId);
      if (!keyPair) {
        throw new Error(`RSA key pair not found: ${privateKeyId}`);
      }

      const decrypted = crypto.privateDecrypt(
        {
          key: keyPair.privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        Buffer.from(encryptedData, 'base64')
      );

      return decrypted.toString('utf8');
    } catch (error) {
      logger.error('RSA decryption failed', {
        privateKeyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate HMAC for data integrity verification
   */
  public generateHMAC(data: string | Buffer, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(data);
    return hmac.digest('hex');
  }

  /**
   * Verify HMAC
   */
  public verifyHMAC(data: string | Buffer, signature: string, secret: string): boolean {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Generate secure random token
   */
  public generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash password using bcrypt-compatible algorithm
   */
  public async hashPassword(password: string, saltRounds: number = 12): Promise<string> {
    const bcrypt = require('bcrypt');
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password hash
   */
  public async verifyPassword(password: string, hash: string): Promise<boolean> {
    const bcrypt = require('bcrypt');
    return await bcrypt.compare(password, hash);
  }

  /**
   * Rotate encryption keys
   */
  public async rotateKeys(): Promise<void> {
    try {
      logger.info('Starting key rotation');

      // Generate new master key
      const newMasterKey = crypto.randomBytes(this.KEY_LENGTH / 8);
      const oldMasterKey = this.keyStore.get('master');
      
      this.keyStore.set('master', newMasterKey);
      this.keyStore.set('master_old', oldMasterKey!);

      // Generate new RSA key pair
      const newKeyPair = await this.generateKeyPair();
      this.keyPairs.set('default', newKeyPair);

      // Schedule cleanup of old keys
      setTimeout(() => {
        this.keyStore.delete('master_old');
        logger.info('Old master key cleaned up');
      }, this.KEY_ROTATION_INTERVAL);

      logger.info('Key rotation completed', {
        newMasterKeyGenerated: true,
        newRSAKeyId: newKeyPair.keyId
      });
    } catch (error) {
      logger.error('Key rotation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get encryption metrics
   */
  public getMetrics(): Record<string, EncryptionMetrics[]> {
    return Object.fromEntries(this.metrics);
  }

  /**
   * Clear sensitive data from memory
   */
  public clearSensitiveData(): void {
    this.keyStore.clear();
    this.keyPairs.clear();
    this.metrics.clear();
    logger.info('Sensitive encryption data cleared from memory');
  }

  // Private helper methods

  private getKey(keyId: string): Buffer | null {
    return this.keyStore.get(keyId) || null;
  }

  private generateKeyId(): string {
    return `key_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private generateVoiceKey(callId: string): string {
    const voiceKeyData = crypto.randomBytes(this.KEY_LENGTH / 8);
    const keyId = `voice_${callId}`;
    this.keyStore.set(keyId, voiceKeyData);
    return keyId;
  }

  private destroyKey(keyId: string): void {
    this.keyStore.delete(keyId);
  }

  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async compressAudioBuffer(buffer: Buffer): Promise<Buffer> {
    // Simple compression - in production, use proper audio compression
    const zlib = require('zlib');
    return new Promise((resolve, reject) => {
      zlib.gzip(buffer, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  private recordMetrics(operation: string, metrics: EncryptionMetrics): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    
    const operationMetrics = this.metrics.get(operation)!;
    operationMetrics.push(metrics);
    
    // Keep only last 1000 entries
    if (operationMetrics.length > 1000) {
      operationMetrics.splice(0, operationMetrics.length - 1000);
    }
  }

  private startKeyRotation(): void {
    setInterval(async () => {
      try {
        await this.rotateKeys();
      } catch (error) {
        logger.error('Automatic key rotation failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.KEY_ROTATION_INTERVAL);
  }
}

// Export singleton instance
export const encryptionService = EncryptionService.getInstance();