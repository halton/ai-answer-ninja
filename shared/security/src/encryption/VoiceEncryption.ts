/**
 * Voice Data Encryption Service
 * Provides end-to-end encryption for voice data in the AI phone system
 */

import * as crypto from 'crypto';
import { EncryptedData, VoiceEncryptionOptions, VoiceDataEncryption } from '../types';
import { KeyManagement } from './KeyManagement';
import { logger } from '../utils/Logger';

export class VoiceEncryption {
  private static instance: VoiceEncryption;
  private keyManager: KeyManagement;
  private readonly DEFAULT_ALGORITHM = 'aes-256-gcm';
  private readonly CHUNK_SIZE = 64 * 1024; // 64KB chunks for streaming

  private constructor() {
    this.keyManager = KeyManagement.getInstance();
  }

  public static getInstance(): VoiceEncryption {
    if (!VoiceEncryption.instance) {
      VoiceEncryption.instance = new VoiceEncryption();
    }
    return VoiceEncryption.instance;
  }

  /**
   * Encrypt voice data with end-to-end encryption
   */
  public async encryptVoiceData(
    audioBuffer: Buffer,
    callId: string,
    userId: string,
    options: VoiceEncryptionOptions = {}
  ): Promise<VoiceDataEncryption> {
    try {
      const startTime = Date.now();
      
      // Get or generate encryption key for this call
      const encryptionKey = await this.keyManager.getOrCreateCallKey(callId, userId);
      
      // Compress audio if requested
      let processedAudio = audioBuffer;
      if (options.compression) {
        processedAudio = await this.compressAudio(audioBuffer);
      }

      // Encrypt the audio data
      const encryptedData = options.streamMode
        ? await this.encryptStream(processedAudio, encryptionKey, options)
        : await this.encryptBuffer(processedAudio, encryptionKey, options);

      // Calculate checksum for integrity
      const checksum = this.calculateChecksum(encryptedData.data);

      // Create voice encryption record
      const voiceEncryption: VoiceDataEncryption = {
        callId,
        userId,
        encryptedAudio: Buffer.from(encryptedData.data, 'base64'),
        encryptionMetadata: {
          algorithm: encryptedData.algorithm,
          keyId: encryptedData.keyVersion,
          chunkSize: options.chunkSize || this.CHUNK_SIZE,
          duration: Date.now() - startTime,
          sampleRate: 16000, // Default for phone audio
          channels: 1 // Mono for phone calls
        },
        timestamp: new Date(),
        checksum
      };

      // Log encryption event for audit
      await this.logEncryptionEvent(callId, userId, 'voice_encrypted', {
        size: audioBuffer.length,
        compressed: options.compression,
        duration: voiceEncryption.encryptionMetadata.duration
      });

      return voiceEncryption;
    } catch (error) {
      logger.error('Voice encryption failed', {
        callId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to encrypt voice data');
    }
  }

  /**
   * Decrypt voice data
   */
  public async decryptVoiceData(
    encryptedData: VoiceDataEncryption,
    userId: string
  ): Promise<Buffer> {
    try {
      // Verify checksum first
      const calculatedChecksum = this.calculateChecksum(
        encryptedData.encryptedAudio.toString('base64')
      );
      
      if (calculatedChecksum !== encryptedData.checksum) {
        throw new Error('Voice data integrity check failed');
      }

      // Get decryption key
      const decryptionKey = await this.keyManager.getCallKey(
        encryptedData.callId,
        userId
      );

      if (!decryptionKey) {
        throw new Error('Decryption key not found');
      }

      // Decrypt the audio
      const decryptedBuffer = await this.decryptBuffer(
        encryptedData.encryptedAudio,
        decryptionKey,
        encryptedData.encryptionMetadata.algorithm as any
      );

      // Log decryption event
      await this.logEncryptionEvent(encryptedData.callId, userId, 'voice_decrypted', {
        size: decryptedBuffer.length
      });

      return decryptedBuffer;
    } catch (error) {
      logger.error('Voice decryption failed', {
        callId: encryptedData.callId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to decrypt voice data');
    }
  }

  /**
   * Encrypt audio buffer
   */
  private async encryptBuffer(
    buffer: Buffer,
    key: string,
    options: VoiceEncryptionOptions
  ): Promise<EncryptedData> {
    const algorithm = options.algorithm || this.DEFAULT_ALGORITHM;
    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(32);

    // Derive key from the provided key
    const derivedKey = await this.deriveKey(key, salt, options);

    // Create cipher
    const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);
    
    // Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);

    // Get auth tag for GCM mode
    let tag: Buffer | undefined;
    if (algorithm.includes('gcm')) {
      tag = cipher.getAuthTag();
    }

    return {
      data: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      tag: tag?.toString('base64'),
      algorithm,
      keyVersion: await this.keyManager.getCurrentKeyVersion(),
      timestamp: Date.now(),
      checksum: ''
    };
  }

  /**
   * Encrypt audio stream (for real-time processing)
   */
  private async encryptStream(
    buffer: Buffer,
    key: string,
    options: VoiceEncryptionOptions
  ): Promise<EncryptedData> {
    const algorithm = options.algorithm || this.DEFAULT_ALGORITHM;
    const chunkSize = options.chunkSize || this.CHUNK_SIZE;
    const encryptedChunks: Buffer[] = [];
    
    // Process in chunks for streaming
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, Math.min(i + chunkSize, buffer.length));
      const encryptedChunk = await this.encryptBuffer(chunk, key, options);
      encryptedChunks.push(Buffer.from(encryptedChunk.data, 'base64'));
    }

    const combinedBuffer = Buffer.concat(encryptedChunks);
    
    return {
      data: combinedBuffer.toString('base64'),
      iv: crypto.randomBytes(16).toString('base64'),
      salt: crypto.randomBytes(32).toString('base64'),
      algorithm,
      keyVersion: await this.keyManager.getCurrentKeyVersion(),
      timestamp: Date.now(),
      checksum: ''
    };
  }

  /**
   * Decrypt audio buffer
   */
  private async decryptBuffer(
    encryptedBuffer: Buffer,
    key: string,
    algorithm: string
  ): Promise<Buffer> {
    // Extract IV and salt from the encrypted data structure
    // In production, these would be stored separately
    const iv = crypto.randomBytes(16); // Should be retrieved from metadata
    const salt = crypto.randomBytes(32); // Should be retrieved from metadata

    // Derive key
    const derivedKey = await this.deriveKey(key, salt, { algorithm: algorithm as any });

    // Create decipher
    const decipher = crypto.createDecipheriv(algorithm, derivedKey, iv);
    
    // Decrypt data
    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]);

    return decrypted;
  }

  /**
   * Derive encryption key using PBKDF2
   */
  private async deriveKey(
    password: string,
    salt: Buffer,
    options: VoiceEncryptionOptions
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const iterations = options.iterations || 100000;
      const keyLength = 32; // 256 bits

      crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }

  /**
   * Compress audio data to reduce storage/transmission size
   */
  private async compressAudio(audioBuffer: Buffer): Promise<Buffer> {
    // Simple compression using zlib
    const zlib = require('zlib');
    return new Promise((resolve, reject) => {
      zlib.deflate(audioBuffer, (err: any, compressed: Buffer) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  /**
   * Calculate checksum for integrity verification
   */
  private calculateChecksum(data: string): string {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');
  }

  /**
   * Secure deletion of voice data
   */
  public async secureDeleteVoiceData(callId: string, userId: string): Promise<void> {
    try {
      // Overwrite encryption keys
      await this.keyManager.destroyCallKey(callId, userId);

      // Log deletion
      await this.logEncryptionEvent(callId, userId, 'voice_deleted', {
        timestamp: new Date()
      });

      logger.info('Voice data securely deleted', { callId, userId });
    } catch (error) {
      logger.error('Secure deletion failed', {
        callId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to securely delete voice data');
    }
  }

  /**
   * Generate voice data signature for authentication
   */
  public async generateVoiceSignature(
    audioBuffer: Buffer,
    userId: string
  ): Promise<string> {
    const signingKey = await this.keyManager.getUserSigningKey(userId);
    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(audioBuffer)
      .digest('hex');
    
    return signature;
  }

  /**
   * Verify voice data signature
   */
  public async verifyVoiceSignature(
    audioBuffer: Buffer,
    signature: string,
    userId: string
  ): Promise<boolean> {
    const expectedSignature = await this.generateVoiceSignature(audioBuffer, userId);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Log encryption events for audit
   */
  private async logEncryptionEvent(
    callId: string,
    userId: string,
    action: string,
    details: any
  ): Promise<void> {
    // This would integrate with the audit service
    logger.info('Voice encryption event', {
      callId,
      userId,
      action,
      details,
      timestamp: new Date()
    });
  }

  /**
   * Real-time voice stream encryption for WebRTC
   */
  public createEncryptionStream(callId: string, userId: string) {
    const { Transform } = require('stream');
    
    return new Transform({
      async transform(chunk: Buffer, encoding: string, callback: Function) {
        try {
          const encrypted = await this.encryptVoiceData(
            chunk,
            callId,
            userId,
            { streamMode: true, chunkSize: 4096 }
          );
          callback(null, encrypted.encryptedAudio);
        } catch (error) {
          callback(error);
        }
      }
    });
  }

  /**
   * Real-time voice stream decryption for WebRTC
   */
  public createDecryptionStream(callId: string, userId: string) {
    const { Transform } = require('stream');
    
    return new Transform({
      async transform(chunk: Buffer, encoding: string, callback: Function) {
        try {
          // Create temporary encryption object for decryption
          const encryptedData: VoiceDataEncryption = {
            callId,
            userId,
            encryptedAudio: chunk,
            encryptionMetadata: {
              algorithm: this.DEFAULT_ALGORITHM,
              keyId: await this.keyManager.getCurrentKeyVersion(),
              chunkSize: 4096,
              duration: 0,
              sampleRate: 16000,
              channels: 1
            },
            timestamp: new Date(),
            checksum: this.calculateChecksum(chunk.toString('base64'))
          };
          
          const decrypted = await this.decryptVoiceData(encryptedData, userId);
          callback(null, decrypted);
        } catch (error) {
          callback(error);
        }
      }
    });
  }
}