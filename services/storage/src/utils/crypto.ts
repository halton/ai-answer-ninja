import crypto from 'crypto';
import logger from './logger';

export class CryptoUtils {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly TAG_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  /**
   * 生成随机加密密钥
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 生成文件校验和
   */
  static generateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 验证文件校验和
   */
  static verifyChecksum(data: Buffer, expectedChecksum: string): boolean {
    const actualChecksum = this.generateChecksum(data);
    return actualChecksum === expectedChecksum;
  }

  /**
   * 加密数据
   */
  static encrypt(data: Buffer, key: string): {
    encrypted: Buffer;
    iv: string;
    tag: string;
  } {
    try {
      const keyBuffer = Buffer.from(key, 'hex');
      const iv = crypto.randomBytes(this.IV_LENGTH);
      const cipher = crypto.createCipher(this.ALGORITHM, keyBuffer);
      cipher.setAutoPadding(true);

      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const tag = cipher.getAuthTag();

      return {
        encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex')
      };
    } catch (error) {
      logger.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * 解密数据
   */
  static decrypt(encryptedData: Buffer, key: string, iv: string, tag: string): Buffer {
    try {
      const keyBuffer = Buffer.from(key, 'hex');
      const ivBuffer = Buffer.from(iv, 'hex');
      const tagBuffer = Buffer.from(tag, 'hex');
      
      const decipher = crypto.createDecipher(this.ALGORITHM, keyBuffer);
      decipher.setAuthTag(tagBuffer);

      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * 生成安全的文件名
   */
  static generateSecureFilename(originalName: string, userId: string): string {
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString('hex');
    const userHash = crypto.createHash('md5').update(userId).digest('hex').substring(0, 8);
    const extension = originalName.split('.').pop() || '';
    
    return `${userHash}_${timestamp}_${randomId}.${extension}`;
  }

  /**
   * 生成上传ID
   */
  static generateUploadId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 哈希化敏感信息
   */
  static hashSensitiveData(data: string, salt?: string): {
    hash: string;
    salt: string;
  } {
    const usedSalt = salt || crypto.randomBytes(this.SALT_LENGTH).toString('hex');
    const hash = crypto.pbkdf2Sync(data, usedSalt, 100000, 64, 'sha512').toString('hex');
    
    return { hash, salt: usedSalt };
  }

  /**
   * 验证哈希
   */
  static verifyHash(data: string, hash: string, salt: string): boolean {
    const { hash: computedHash } = this.hashSensitiveData(data, salt);
    return computedHash === hash;
  }

  /**
   * 生成JWT签名密钥
   */
  static generateJWTSecret(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * 生成安全的临时Token
   */
  static generateTempToken(expirationMinutes: number = 60): {
    token: string;
    expiresAt: Date;
  } {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);
    
    return { token, expiresAt };
  }
}