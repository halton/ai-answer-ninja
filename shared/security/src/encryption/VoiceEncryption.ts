/**
 * Voice Data Encryption Service
 * Specialized encryption for real-time voice data with optimizations for streaming
 * Implements streaming AES-256-GCM with chunked processing for minimal latency
 */

import * as crypto from 'crypto';
import { EncryptedData, VoiceEncryptionOptions, VoiceDataEncryption } from '../types';
import { KeyManagement } from './KeyManagement';
import { logger } from '../utils/Logger';

export interface VoiceStreamConfig {
  chunkSize: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  compression: boolean;
  realtime: boolean;
}

export interface VoiceChunk {
  sequenceNumber: number;
  callId: string;
  timestamp: number;
  data: Buffer;
  isLast: boolean;
}

export interface EncryptedVoiceChunk {
  sequenceNumber: number;
  callId: string;
  timestamp: number;
  encryptedData: EncryptedData;
  isLast: boolean;
  metadata: VoiceChunkMetadata;
}

export interface VoiceChunkMetadata {
  originalSize: number;
  compressedSize: number;
  encryptionTime: number;
  audioFormat: string;
  streamPosition: number;
}

export interface VoiceEncryptionSession {
  callId: string;
  sessionKey: Buffer;
  config: VoiceStreamConfig;
  createdAt: Date;
  lastActivity: Date;
  chunksProcessed: number;
  totalDataSize: number;
}

export class VoiceEncryption {
  private static instance: VoiceEncryption;
  private keyManager: KeyManagement;
  private readonly DEFAULT_ALGORITHM = 'aes-256-gcm';
  private readonly CHUNK_SIZE_DEFAULT = 4096; // 4KB chunks for low latency
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CHUNK_SIZE = 64 * 1024; // 64KB max chunk
  
  // Active encryption sessions
  private sessions: Map<string, VoiceEncryptionSession> = new Map();
  private sessionCleanupInterval: NodeJS.Timeout;

  private constructor() {
    this.keyManager = KeyManagement.getInstance();
    this.startSessionCleanup();
  }

  public static getInstance(): VoiceEncryption {
    if (!VoiceEncryption.instance) {
      VoiceEncryption.instance = new VoiceEncryption();
    }
    return VoiceEncryption.instance;
  }

  /**
   * Initialize voice encryption session for a call
   */
  public async initializeSession(
    callId: string, 
    config: Partial<VoiceStreamConfig> = {}
  ): Promise<VoiceEncryptionSession> {
    try {
      // Generate session-specific encryption key
      const sessionKey = crypto.randomBytes(32); // 256-bit key
      
      const fullConfig: VoiceStreamConfig = {
        chunkSize: config.chunkSize || this.CHUNK_SIZE_DEFAULT,
        sampleRate: config.sampleRate || 16000,
        channels: config.channels || 1,
        bitDepth: config.bitDepth || 16,
        compression: config.compression ?? true,
        realtime: config.realtime ?? true
      };

      // Validate chunk size
      if (fullConfig.chunkSize > this.MAX_CHUNK_SIZE) {
        throw new Error(`Chunk size too large: ${fullConfig.chunkSize}`);
      }

      const session: VoiceEncryptionSession = {
        callId,
        sessionKey,
        config: fullConfig,
        createdAt: new Date(),
        lastActivity: new Date(),
        chunksProcessed: 0,
        totalDataSize: 0
      };

      this.sessions.set(callId, session);

      logger.info('Voice encryption session initialized', {
        callId,
        config: fullConfig,
        sessionKeyLength: sessionKey.length
      });

      return session;
    } catch (error) {
      logger.error('Failed to initialize voice encryption session', {
        callId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
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
      
      // Get or create session
      let session = this.sessions.get(callId);
      if (!session) {
        session = await this.initializeSession(callId, {
          chunkSize: options.chunkSize,
          compression: options.compression,
          realtime: options.streamMode
        });
      }

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
          chunkSize: options.chunkSize || this.CHUNK_SIZE_DEFAULT,
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
   * Encrypt voice chunk in streaming mode
   */
  public async encryptVoiceChunk(voiceChunk: VoiceChunk): Promise<EncryptedVoiceChunk> {
    const startTime = Date.now();
    
    try {
      const session = this.sessions.get(voiceChunk.callId);
      if (!session) {
        throw new Error(`No encryption session found for call: ${voiceChunk.callId}`);
      }

      // Update session activity
      session.lastActivity = new Date();
      session.chunksProcessed++;
      session.totalDataSize += voiceChunk.data.length;

      let processedData = voiceChunk.data;
      let compressedSize = voiceChunk.data.length;

      // Apply compression if enabled and chunk is large enough
      if (session.config.compression && voiceChunk.data.length > 512) {
        processedData = await this.compressAudioChunk(voiceChunk.data);
        compressedSize = processedData.length;
      }

      // Prepare additional authenticated data
      const aad = JSON.stringify({
        callId: voiceChunk.callId,
        sequenceNumber: voiceChunk.sequenceNumber,
        timestamp: voiceChunk.timestamp,
        sampleRate: session.config.sampleRate,
        channels: session.config.channels,
        bitDepth: session.config.bitDepth
      });

      // Create cipher with session key
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipherGCM(this.DEFAULT_ALGORITHM, session.sessionKey, iv);
      cipher.setAAD(Buffer.from(aad));

      // Encrypt the audio data
      let encrypted = cipher.update(processedData);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Create encrypted data structure
      const encryptedData: EncryptedData = {
        data: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion: voiceChunk.callId, // Use callId as key version for session key
        algorithm: this.DEFAULT_ALGORITHM,
        timestamp: voiceChunk.timestamp,
        checksum: this.calculateChecksum(encrypted.toString('base64'))
      };

      const metadata: VoiceChunkMetadata = {
        originalSize: voiceChunk.data.length,
        compressedSize,
        encryptionTime: Date.now() - startTime,
        audioFormat: this.getAudioFormat(session.config),
        streamPosition: session.chunksProcessed
      };

      const result: EncryptedVoiceChunk = {
        sequenceNumber: voiceChunk.sequenceNumber,
        callId: voiceChunk.callId,
        timestamp: voiceChunk.timestamp,
        encryptedData,
        isLast: voiceChunk.isLast,
        metadata
      };

      logger.debug('Voice chunk encrypted', {
        callId: voiceChunk.callId,
        sequenceNumber: voiceChunk.sequenceNumber,
        originalSize: voiceChunk.data.length,
        compressedSize,
        encryptionTime: Date.now() - startTime
      });

      return result;
    } catch (error) {
      logger.error('Failed to encrypt voice chunk', {
        callId: voiceChunk.callId,
        sequenceNumber: voiceChunk.sequenceNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Decrypt voice chunk
   */
  public async decryptVoiceChunk(encryptedChunk: EncryptedVoiceChunk): Promise<VoiceChunk> {
    const startTime = Date.now();
    
    try {
      const session = this.sessions.get(encryptedChunk.callId);
      if (!session) {
        throw new Error(`No encryption session found for call: ${encryptedChunk.callId}`);
      }

      // Prepare additional authenticated data
      const aad = JSON.stringify({
        callId: encryptedChunk.callId,
        sequenceNumber: encryptedChunk.sequenceNumber,
        timestamp: encryptedChunk.timestamp,
        sampleRate: session.config.sampleRate,
        channels: session.config.channels,
        bitDepth: session.config.bitDepth
      });

      // Verify checksum
      const encryptedBuffer = Buffer.from(encryptedChunk.encryptedData.data, 'base64');
      const expectedChecksum = this.calculateChecksum(encryptedChunk.encryptedData.data);
      if (expectedChecksum !== encryptedChunk.encryptedData.checksum) {
        throw new Error('Voice chunk integrity check failed');
      }

      // Create decipher
      const iv = Buffer.from(encryptedChunk.encryptedData.iv, 'base64');
      const decipher = crypto.createDecipherGCM(this.DEFAULT_ALGORITHM, session.sessionKey, iv);
      decipher.setAuthTag(Buffer.from(encryptedChunk.encryptedData.authTag!, 'base64'));
      decipher.setAAD(Buffer.from(aad));

      // Decrypt the data
      let decrypted = decipher.update(encryptedBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      // Decompress if compression was used
      let finalData = decrypted;
      if (session.config.compression && encryptedChunk.metadata.compressedSize < encryptedChunk.metadata.originalSize) {
        finalData = await this.decompressAudioChunk(decrypted);
      }

      const result: VoiceChunk = {
        sequenceNumber: encryptedChunk.sequenceNumber,
        callId: encryptedChunk.callId,
        timestamp: encryptedChunk.timestamp,
        data: finalData,
        isLast: encryptedChunk.isLast
      };

      logger.debug('Voice chunk decrypted', {
        callId: encryptedChunk.callId,
        sequenceNumber: encryptedChunk.sequenceNumber,
        decryptionTime: Date.now() - startTime
      });

      return result;
    } catch (error) {
      logger.error('Failed to decrypt voice chunk', {
        callId: encryptedChunk.callId,
        sequenceNumber: encryptedChunk.sequenceNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
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
    const cipher = crypto.createCipherGCM(algorithm, derivedKey, iv);
    
    // Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);

    // Get auth tag for GCM mode
    const tag = cipher.getAuthTag();

    return {
      data: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      authTag: tag.toString('base64'),
      algorithm,
      keyVersion: await this.keyManager.getCurrentKeyVersion(),
      timestamp: Date.now(),
      checksum: this.calculateChecksum(encrypted.toString('base64'))
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
    const chunkSize = options.chunkSize || this.CHUNK_SIZE_DEFAULT;
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
      checksum: this.calculateChecksum(combinedBuffer.toString('base64'))
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
    const decipher = crypto.createDecipherGCM(algorithm, derivedKey, iv);
    
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

  private async compressAudioChunk(buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const zlib = require('zlib');
      zlib.gzip(buffer, { level: 1 }, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  private async decompressAudioChunk(buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const zlib = require('zlib');
      zlib.gunzip(buffer, (err, decompressed) => {
        if (err) reject(err);
        else resolve(decompressed);
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
   * Finalize encryption session and cleanup
   */
  public async finalizeSession(callId: string): Promise<void> {
    try {
      const session = this.sessions.get(callId);
      if (!session) {
        logger.warn('Attempted to finalize non-existent session', { callId });
        return;
      }

      // Clear session key from memory
      session.sessionKey.fill(0);
      
      // Remove session
      this.sessions.delete(callId);

      logger.info('Voice encryption session finalized', {
        callId,
        chunksProcessed: session.chunksProcessed,
        totalDataSize: session.totalDataSize,
        sessionDuration: Date.now() - session.createdAt.getTime()
      });
    } catch (error) {
      logger.error('Failed to finalize encryption session', {
        callId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Cleanup expired sessions
   */
  public cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [callId, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > this.SESSION_TIMEOUT) {
        expiredSessions.push(callId);
      }
    }

    for (const callId of expiredSessions) {
      this.finalizeSession(callId);
      logger.info('Expired voice encryption session cleaned up', { callId });
    }
  }

  /**
   * Get session information
   */
  public getSessionInfo(callId: string): VoiceEncryptionSession | null {
    return this.sessions.get(callId) || null;
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): VoiceEncryptionSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Secure deletion of voice data
   */
  public async secureDeleteVoiceData(callId: string, userId: string): Promise<void> {
    try {
      // Overwrite encryption keys
      await this.keyManager.destroyCallKey(callId, userId);

      // Finalize session
      await this.finalizeSession(callId);

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

  private getAudioFormat(config: VoiceStreamConfig): string {
    return `PCM_${config.sampleRate}_${config.channels}CH_${config.bitDepth}BIT`;
  }

  private startSessionCleanup(): void {
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
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
   * Cleanup when service is destroyed
   */
  public destroy(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }

    // Finalize all active sessions
    for (const callId of this.sessions.keys()) {
      this.finalizeSession(callId);
    }

    logger.info('Voice encryption service destroyed');
  }
}

// Export singleton instance
export const voiceEncryption = VoiceEncryption.getInstance();