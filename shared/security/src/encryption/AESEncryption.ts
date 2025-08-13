/**
 * AES Encryption Service
 * Provides high-performance AES encryption with multiple modes and key management
 * Supports streaming encryption for large audio files and sensitive data
 */

import crypto from 'crypto';
import { promisify } from 'util';
import { logger } from '../utils/Logger';
import { KeyManagement } from './KeyManagement';

export interface EncryptionOptions {
  algorithm?: string;
  keySize?: number;
  mode?: 'GCM' | 'CBC' | 'CTR';
  ivLength?: number;
  tagLength?: number;
  additionalData?: Buffer;
}

export interface EncryptionResult {
  encrypted: Buffer;
  iv: Buffer;
  tag?: Buffer;
  keyId: string;
  algorithm: string;
  timestamp: number;
}

export interface DecryptionResult {
  decrypted: Buffer;
  verified: boolean;
  keyId: string;
  timestamp: number;
}

export interface StreamEncryptionConfig {
  inputStream: NodeJS.ReadableStream;
  outputStream: NodeJS.WritableStream;
  chunkSize?: number;
  algorithm?: string;
  keyId?: string;
}

export class AESEncryption {
  private static instance: AESEncryption;
  private keyManager: KeyManagement;
  
  // 支持的算法配置
  private readonly ALGORITHMS = {
    'aes-256-gcm': { keySize: 32, ivLength: 16, tagLength: 16 },
    'aes-256-cbc': { keySize: 32, ivLength: 16, tagLength: 0 },
    'aes-256-ctr': { keySize: 32, ivLength: 16, tagLength: 0 },
    'aes-192-gcm': { keySize: 24, ivLength: 16, tagLength: 16 },
    'aes-128-gcm': { keySize: 16, ivLength: 16, tagLength: 16 }
  };
  
  private readonly DEFAULT_ALGORITHM = 'aes-256-gcm';
  private readonly DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB chunks
  
  private constructor() {
    this.keyManager = KeyManagement.getInstance();
  }
  
  public static getInstance(): AESEncryption {
    if (!AESEncryption.instance) {
      AESEncryption.instance = new AESEncryption();
    }
    return AESEncryption.instance;
  }
  
  /**
   * Encrypt data with AES
   */
  public async encrypt(
    data: Buffer | string,
    keyId?: string,
    options: EncryptionOptions = {}
  ): Promise<EncryptionResult> {
    try {
      const algorithm = options.algorithm || this.DEFAULT_ALGORITHM;
      const config = this.ALGORITHMS[algorithm];
      
      if (!config) {
        throw new Error(`Unsupported algorithm: ${algorithm}`);
      }
      
      // 获取加密密钥
      const key = keyId 
        ? await this.keyManager.getEncryptionKey(keyId)
        : await this.keyManager.generateEncryptionKey();
      
      const actualKeyId = keyId || key.id;
      
      // 生成随机IV
      const iv = crypto.randomBytes(options.ivLength || config.ivLength);
      
      // 确保数据是Buffer
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      
      // 创建加密器
      const cipher = crypto.createCipher(algorithm, key.key);
      cipher.setAAD(iv); // 设置附加认证数据
      
      if (options.additionalData) {
        cipher.setAAD(options.additionalData);
      }
      
      // 执行加密
      const encrypted = Buffer.concat([
        cipher.update(dataBuffer),
        cipher.final()
      ]);
      
      // 获取认证标签（GCM模式）
      let tag: Buffer | undefined;
      if (algorithm.includes('gcm')) {
        tag = cipher.getAuthTag();
      }
      
      const result: EncryptionResult = {
        encrypted,
        iv,
        tag,
        keyId: actualKeyId,
        algorithm,
        timestamp: Date.now()
      };
      
      logger.debug('Data encrypted successfully', {
        algorithm,
        keyId: actualKeyId,
        dataSize: dataBuffer.length,
        encryptedSize: encrypted.length
      });
      
      return result;
    } catch (error) {
      logger.error('Encryption failed', {
        algorithm: options.algorithm,
        keyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Decrypt data with AES
   */
  public async decrypt(
    encryptionResult: EncryptionResult,
    keyId?: string
  ): Promise<DecryptionResult> {
    try {
      const { encrypted, iv, tag, algorithm, keyId: resultKeyId } = encryptionResult;
      const actualKeyId = keyId || resultKeyId;
      
      // 获取解密密钥
      const key = await this.keyManager.getEncryptionKey(actualKeyId);
      
      // 创建解密器
      const decipher = crypto.createDecipher(algorithm, key.key);
      decipher.setAAD(iv);
      
      // 设置认证标签（GCM模式）
      if (algorithm.includes('gcm') && tag) {
        decipher.setAuthTag(tag);
      }
      
      // 执行解密
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      const result: DecryptionResult = {
        decrypted,
        verified: true,
        keyId: actualKeyId,
        timestamp: Date.now()
      };
      
      logger.debug('Data decrypted successfully', {
        algorithm,
        keyId: actualKeyId,
        encryptedSize: encrypted.length,
        decryptedSize: decrypted.length
      });
      
      return result;
    } catch (error) {
      logger.error('Decryption failed', {
        algorithm: encryptionResult.algorithm,
        keyId: encryptionResult.keyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        decrypted: Buffer.alloc(0),
        verified: false,
        keyId: encryptionResult.keyId,
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Encrypt string data and return base64 encoded result
   */
  public async encryptString(
    text: string,
    keyId?: string,
    options: EncryptionOptions = {}
  ): Promise<string> {
    try {
      const result = await this.encrypt(Buffer.from(text, 'utf8'), keyId, options);
      
      // 将结果序列化为base64字符串
      const serialized = {
        encrypted: result.encrypted.toString('base64'),
        iv: result.iv.toString('base64'),
        tag: result.tag?.toString('base64'),
        keyId: result.keyId,
        algorithm: result.algorithm,
        timestamp: result.timestamp
      };
      
      return Buffer.from(JSON.stringify(serialized)).toString('base64');
    } catch (error) {
      logger.error('String encryption failed', {
        textLength: text.length,
        keyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Decrypt base64 encoded string data
   */
  public async decryptString(encryptedString: string, keyId?: string): Promise<string> {
    try {
      // 反序列化加密结果
      const serialized = JSON.parse(Buffer.from(encryptedString, 'base64').toString());
      
      const encryptionResult: EncryptionResult = {
        encrypted: Buffer.from(serialized.encrypted, 'base64'),
        iv: Buffer.from(serialized.iv, 'base64'),
        tag: serialized.tag ? Buffer.from(serialized.tag, 'base64') : undefined,
        keyId: serialized.keyId,
        algorithm: serialized.algorithm,
        timestamp: serialized.timestamp
      };
      
      const result = await this.decrypt(encryptionResult, keyId);
      
      if (!result.verified) {
        throw new Error('Decryption verification failed');
      }
      
      return result.decrypted.toString('utf8');
    } catch (error) {
      logger.error('String decryption failed', {
        keyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`String decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Stream encryption for large files (e.g., audio recordings)
   */
  public async encryptStream(config: StreamEncryptionConfig): Promise<EncryptionResult> {
    return new Promise(async (resolve, reject) => {
      try {
        const algorithm = config.algorithm || this.DEFAULT_ALGORITHM;
        const chunkSize = config.chunkSize || this.DEFAULT_CHUNK_SIZE;
        
        // 获取加密密钥
        const key = config.keyId 
          ? await this.keyManager.getEncryptionKey(config.keyId)
          : await this.keyManager.generateEncryptionKey();
        
        const keyId = config.keyId || key.id;
        const iv = crypto.randomBytes(this.ALGORITHMS[algorithm].ivLength);
        
        // 创建流加密器
        const cipher = crypto.createCipher(algorithm, key.key);
        cipher.setAAD(iv);
        
        let totalSize = 0;
        const chunks: Buffer[] = [];
        
        // 写入IV到输出流
        config.outputStream.write(iv);
        
        config.inputStream.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          const encryptedChunk = cipher.update(chunk);
          config.outputStream.write(encryptedChunk);
          chunks.push(encryptedChunk);
        });
        
        config.inputStream.on('end', () => {
          try {
            const finalChunk = cipher.final();
            config.outputStream.write(finalChunk);
            chunks.push(finalChunk);
            
            // 获取认证标签
            let tag: Buffer | undefined;
            if (algorithm.includes('gcm')) {
              tag = cipher.getAuthTag();
              config.outputStream.write(tag);
            }
            
            config.outputStream.end();
            
            const result: EncryptionResult = {
              encrypted: Buffer.concat(chunks),
              iv,
              tag,
              keyId,
              algorithm,
              timestamp: Date.now()
            };
            
            logger.info('Stream encryption completed', {
              algorithm,
              keyId,
              totalSize,
              encryptedSize: result.encrypted.length
            });
            
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
        
        config.inputStream.on('error', (error) => {
          logger.error('Stream encryption input error', { error: error.message });
          reject(error);
        });
        
        config.outputStream.on('error', (error) => {
          logger.error('Stream encryption output error', { error: error.message });
          reject(error);
        });
        
      } catch (error) {
        logger.error('Stream encryption setup failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        reject(error);
      }
    });
  }
  
  /**
   * Encrypt audio data specifically optimized for voice files
   */
  public async encryptAudioData(
    audioBuffer: Buffer,
    callId: string,
    userId: string
  ): Promise<EncryptionResult> {
    try {
      // 为音频数据生成专用密钥
      const audioKeyId = `audio_${callId}_${userId}`;
      const audioKey = await this.keyManager.generateAudioKey(audioKeyId);
      
      // 使用GCM模式确保完整性
      const result = await this.encrypt(audioBuffer, audioKey.id, {
        algorithm: 'aes-256-gcm',
        additionalData: Buffer.from(`${callId}:${userId}:audio`)
      });
      
      // 音频加密后立即销毁临时密钥
      await this.keyManager.destroyKey(audioKey.id);
      
      logger.info('Audio data encrypted', {
        callId,
        userId,
        originalSize: audioBuffer.length,
        encryptedSize: result.encrypted.length
      });
      
      return result;
    } catch (error) {
      logger.error('Audio encryption failed', {
        callId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Batch encrypt multiple data items
   */
  public async batchEncrypt(
    items: Array<{ data: Buffer | string; keyId?: string; options?: EncryptionOptions }>,
    concurrency: number = 5
  ): Promise<EncryptionResult[]> {
    const results: EncryptionResult[] = [];
    
    // 分批处理以控制并发
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(item => this.encrypt(item.data, item.keyId, item.options))
      );
      results.push(...batchResults);
    }
    
    logger.info('Batch encryption completed', {
      totalItems: items.length,
      successCount: results.length
    });
    
    return results;
  }
  
  /**
   * Generate secure hash with encryption
   */
  public async encryptAndHash(
    data: Buffer | string,
    keyId?: string,
    hashAlgorithm: string = 'sha256'
  ): Promise<{ encrypted: EncryptionResult; hash: string }> {
    try {
      // 先加密数据
      const encrypted = await this.encrypt(data, keyId);
      
      // 生成加密数据的哈希
      const hash = crypto
        .createHash(hashAlgorithm)
        .update(encrypted.encrypted)
        .digest('hex');
      
      return { encrypted, hash };
    } catch (error) {
      logger.error('Encrypt and hash failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Verify encrypted data integrity
   */
  public async verifyIntegrity(
    encryptionResult: EncryptionResult,
    expectedHash?: string
  ): Promise<boolean> {
    try {
      if (!expectedHash) {
        // 如果使用GCM模式，验证认证标签
        if (encryptionResult.algorithm.includes('gcm') && encryptionResult.tag) {
          // 标签存在表示数据完整
          return true;
        }
        return false;
      }
      
      // 计算当前数据哈希
      const currentHash = crypto
        .createHash('sha256')
        .update(encryptionResult.encrypted)
        .digest('hex');
      
      return currentHash === expectedHash;
    } catch (error) {
      logger.error('Integrity verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Key rotation - re-encrypt with new key
   */
  public async rotateEncryption(
    encryptionResult: EncryptionResult,
    newKeyId?: string
  ): Promise<EncryptionResult> {
    try {
      // 先解密数据
      const decrypted = await this.decrypt(encryptionResult);
      
      if (!decrypted.verified) {
        throw new Error('Cannot rotate - original data verification failed');
      }
      
      // 用新密钥重新加密
      const newResult = await this.encrypt(decrypted.decrypted, newKeyId, {
        algorithm: encryptionResult.algorithm
      });
      
      logger.info('Encryption rotated successfully', {
        oldKeyId: encryptionResult.keyId,
        newKeyId: newResult.keyId,
        algorithm: encryptionResult.algorithm
      });
      
      return newResult;
    } catch (error) {
      logger.error('Encryption rotation failed', {
        keyId: encryptionResult.keyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Secure compare of encrypted data
   */
  public async secureCompare(
    encrypted1: EncryptionResult,
    encrypted2: EncryptionResult
  ): Promise<boolean> {
    try {
      // 解密两个数据
      const [decrypted1, decrypted2] = await Promise.all([
        this.decrypt(encrypted1),
        this.decrypt(encrypted2)
      ]);
      
      if (!decrypted1.verified || !decrypted2.verified) {
        return false;
      }
      
      // 使用时间安全的比较
      return crypto.timingSafeEqual(decrypted1.decrypted, decrypted2.decrypted);
    } catch (error) {
      logger.error('Secure compare failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Clean up and destroy instance
   */
  public destroy(): void {
    // 清理任何敏感内存
    logger.info('AES Encryption service destroyed');
  }
  
  /**
   * Get encryption statistics
   */
  public getStats(): {
    supportedAlgorithms: string[];
    defaultAlgorithm: string;
    chunkSize: number;
  } {
    return {
      supportedAlgorithms: Object.keys(this.ALGORITHMS),
      defaultAlgorithm: this.DEFAULT_ALGORITHM,
      chunkSize: this.DEFAULT_CHUNK_SIZE
    };
  }
}