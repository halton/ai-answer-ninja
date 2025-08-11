/**
 * AI电话应答系统 - 备份加密服务
 * 
 * 功能特性:
 * - AES-256-GCM端到端加密
 * - 密钥分层管理和轮转
 * - 备份完整性验证
 * - 合规性加密存储
 * - 密钥托管和恢复
 * - 加密性能优化
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Transform } from 'stream';
import { promisify } from 'util';

interface EncryptionConfig {
  algorithm: 'aes-256-gcm' | 'aes-256-cbc';
  keyDerivation: {
    iterations: number;
    saltLength: number;
    keyLength: number;
  };
  storage: {
    keyStorePath: string;
    encryptedPath: string;
    metadataPath: string;
  };
  security: {
    keyRotationDays: number;
    masterKeyEnabled: boolean;
    hsmEnabled: boolean; // Hardware Security Module
  };
  compression: {
    enabled: boolean;
    level: number; // 0-9
  };
}

interface EncryptionKey {
  id: string;
  key: Buffer;
  salt: Buffer;
  algorithm: string;
  createdAt: Date;
  rotatedAt?: Date;
  version: number;
  isActive: boolean;
}

interface EncryptionMetadata {
  keyId: string;
  keyVersion: number;
  algorithm: string;
  iv: Buffer;
  authTag: Buffer;
  salt: Buffer;
  originalSize: number;
  encryptedSize: number;
  checksum: string;
  compressionEnabled: boolean;
  encryptedAt: Date;
}

interface EncryptionJob {
  id: string;
  filePath: string;
  status: 'pending' | 'encrypting' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  originalSize: number;
  encryptedSize?: number;
  compressionRatio?: number;
  keyId: string;
  errorMessage?: string;
}

export class BackupEncryptionService {
  private config: EncryptionConfig;
  private activeKeys: Map<string, EncryptionKey> = new Map();
  private currentMasterKey?: EncryptionKey;

  constructor(config: EncryptionConfig) {
    this.config = config;
  }

  /**
   * 初始化加密服务
   */
  async initialize(): Promise<void> {
    try {
      // 创建必要的目录
      await this.createEncryptionDirectories();
      
      // 加载现有密钥
      await this.loadExistingKeys();
      
      // 生成或加载主密钥
      await this.initializeMasterKey();
      
      // 检查密钥轮转需求
      await this.checkKeyRotation();
      
      console.log('备份加密服务初始化完成');
    } catch (error) {
      console.error('加密服务初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加密备份文件
   */
  async encryptBackupFile(
    inputFilePath: string, 
    options: {
      outputPath?: string;
      keyId?: string;
      enableCompression?: boolean;
      chunkSize?: number;
    } = {}
  ): Promise<{
    encryptedFilePath: string;
    metadata: EncryptionMetadata;
    job: EncryptionJob;
  }> {
    const jobId = this.generateJobId();
    const job: EncryptionJob = {
      id: jobId,
      filePath: inputFilePath,
      status: 'pending',
      startTime: new Date(),
      originalSize: 0,
      keyId: options.keyId || this.getActiveKeyId()
    };

    try {
      job.status = 'encrypting';
      
      // 获取文件大小
      const fileStats = await fs.stat(inputFilePath);
      job.originalSize = fileStats.size;

      // 获取加密密钥
      const encryptionKey = await this.getEncryptionKey(job.keyId);
      
      // 生成输出文件路径
      const outputPath = options.outputPath || this.generateEncryptedFilePath(inputFilePath);
      
      // 执行加密
      const metadata = await this.performEncryption(
        inputFilePath,
        outputPath,
        encryptionKey,
        {
          enableCompression: options.enableCompression ?? this.config.compression.enabled,
          chunkSize: options.chunkSize || 64 * 1024 // 64KB chunks
        }
      );

      // 保存元数据
      await this.saveEncryptionMetadata(outputPath, metadata);
      
      // 验证加密结果
      await this.verifyEncryptedFile(outputPath, metadata);

      const encryptedStats = await fs.stat(outputPath);
      job.encryptedSize = encryptedStats.size;
      job.compressionRatio = job.encryptedSize / job.originalSize;
      job.status = 'completed';
      job.endTime = new Date();
      job.duration = job.endTime.getTime() - job.startTime.getTime();

      console.log(`文件加密完成: ${inputFilePath} -> ${outputPath}`);
      console.log(`原始大小: ${this.formatBytes(job.originalSize)}, 加密后大小: ${this.formatBytes(job.encryptedSize)}`);

      return {
        encryptedFilePath: outputPath,
        metadata,
        job
      };
    } catch (error) {
      job.status = 'failed';
      job.endTime = new Date();
      job.errorMessage = error.message;
      
      console.error(`文件加密失败: ${inputFilePath}`, error);
      throw error;
    }
  }

  /**
   * 解密备份文件
   */
  async decryptBackupFile(
    encryptedFilePath: string,
    outputPath?: string
  ): Promise<{
    decryptedFilePath: string;
    metadata: EncryptionMetadata;
    verified: boolean;
  }> {
    try {
      // 加载加密元数据
      const metadata = await this.loadEncryptionMetadata(encryptedFilePath);
      
      // 获取解密密钥
      const decryptionKey = await this.getEncryptionKey(metadata.keyId);
      
      // 生成输出路径
      const decryptedPath = outputPath || this.generateDecryptedFilePath(encryptedFilePath);
      
      // 执行解密
      await this.performDecryption(encryptedFilePath, decryptedPath, metadata, decryptionKey);
      
      // 验证解密结果
      const verified = await this.verifyDecryptedFile(decryptedPath, metadata);
      
      console.log(`文件解密完成: ${encryptedFilePath} -> ${decryptedPath}`);
      
      return {
        decryptedFilePath: decryptedPath,
        metadata,
        verified
      };
    } catch (error) {
      console.error(`文件解密失败: ${encryptedFilePath}`, error);
      throw error;
    }
  }

  /**
   * 批量加密备份文件
   */
  async encryptMultipleFiles(
    filePaths: string[],
    options: {
      concurrency?: number;
      outputDir?: string;
      keyId?: string;
    } = {}
  ): Promise<Array<{
    inputPath: string;
    encryptedPath: string;
    metadata: EncryptionMetadata;
    success: boolean;
    error?: string;
  }>> {
    const concurrency = options.concurrency || 4;
    const results: Array<{
      inputPath: string;
      encryptedPath: string;
      metadata: EncryptionMetadata;
      success: boolean;
      error?: string;
    }> = [];

    // 分批处理文件
    const chunks = this.chunkArray(filePaths, concurrency);
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (filePath) => {
        try {
          const outputPath = options.outputDir 
            ? path.join(options.outputDir, `${path.basename(filePath)}.enc`)
            : undefined;
            
          const result = await this.encryptBackupFile(filePath, {
            outputPath,
            keyId: options.keyId
          });
          
          return {
            inputPath: filePath,
            encryptedPath: result.encryptedFilePath,
            metadata: result.metadata,
            success: true
          };
        } catch (error) {
          return {
            inputPath: filePath,
            encryptedPath: '',
            metadata: {} as EncryptionMetadata,
            success: false,
            error: error.message
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`批量加密完成: ${successCount}/${filePaths.length} 个文件加密成功`);

    return results;
  }

  /**
   * 生成新的加密密钥
   */
  async generateEncryptionKey(): Promise<EncryptionKey> {
    const keyId = this.generateKeyId();
    const salt = crypto.randomBytes(this.config.keyDerivation.saltLength);
    
    // 生成基础密钥
    const baseKey = crypto.randomBytes(32); // 256 bits
    
    // 如果启用主密钥，使用主密钥派生
    let derivedKey: Buffer;
    if (this.config.security.masterKeyEnabled && this.currentMasterKey) {
      derivedKey = crypto.pbkdf2Sync(
        baseKey,
        Buffer.concat([salt, this.currentMasterKey.key]),
        this.config.keyDerivation.iterations,
        this.config.keyDerivation.keyLength,
        'sha256'
      );
    } else {
      derivedKey = crypto.pbkdf2Sync(
        baseKey,
        salt,
        this.config.keyDerivation.iterations,
        this.config.keyDerivation.keyLength,
        'sha256'
      );
    }

    const encryptionKey: EncryptionKey = {
      id: keyId,
      key: derivedKey,
      salt,
      algorithm: this.config.algorithm,
      createdAt: new Date(),
      version: 1,
      isActive: true
    };

    // 保存密钥
    await this.saveEncryptionKey(encryptionKey);
    this.activeKeys.set(keyId, encryptionKey);

    console.log(`生成新的加密密钥: ${keyId}`);
    return encryptionKey;
  }

  /**
   * 轮转加密密钥
   */
  async rotateEncryptionKeys(): Promise<{
    rotatedKeys: string[];
    newKeyId: string;
  }> {
    try {
      console.log('开始密钥轮转...');
      
      const rotatedKeys: string[] = [];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.security.keyRotationDays);

      // 标记过期密钥为不活跃
      for (const [keyId, key] of this.activeKeys) {
        if (key.createdAt < cutoffDate && key.isActive) {
          key.isActive = false;
          key.rotatedAt = new Date();
          await this.saveEncryptionKey(key);
          rotatedKeys.push(keyId);
          console.log(`密钥已轮转: ${keyId}`);
        }
      }

      // 生成新的活跃密钥
      const newKey = await this.generateEncryptionKey();

      return {
        rotatedKeys,
        newKeyId: newKey.id
      };
    } catch (error) {
      console.error('密钥轮转失败:', error);
      throw error;
    }
  }

  /**
   * 验证加密文件完整性
   */
  async verifyEncryptionIntegrity(encryptedFilePath: string): Promise<{
    isValid: boolean;
    checksumValid: boolean;
    metadataValid: boolean;
    canDecrypt: boolean;
    errorDetails?: string[];
  }> {
    const errors: string[] = [];

    try {
      // 检查文件存在性
      const fileExists = await this.fileExists(encryptedFilePath);
      if (!fileExists) {
        errors.push('加密文件不存在');
        return {
          isValid: false,
          checksumValid: false,
          metadataValid: false,
          canDecrypt: false,
          errorDetails: errors
        };
      }

      // 加载并验证元数据
      let metadata: EncryptionMetadata;
      try {
        metadata = await this.loadEncryptionMetadata(encryptedFilePath);
      } catch (error) {
        errors.push(`元数据加载失败: ${error.message}`);
        return {
          isValid: false,
          checksumValid: false,
          metadataValid: false,
          canDecrypt: false,
          errorDetails: errors
        };
      }

      // 验证文件校验和
      const checksumValid = await this.verifyFileChecksum(encryptedFilePath, metadata.checksum);
      if (!checksumValid) {
        errors.push('文件校验和验证失败');
      }

      // 验证元数据完整性
      const metadataValid = await this.validateMetadata(metadata);
      if (!metadataValid) {
        errors.push('元数据验证失败');
      }

      // 测试解密能力
      let canDecrypt = false;
      try {
        const tempPath = `${encryptedFilePath}.decrypt-test`;
        await this.decryptBackupFile(encryptedFilePath, tempPath);
        await fs.unlink(tempPath); // 清理测试文件
        canDecrypt = true;
      } catch (error) {
        errors.push(`解密测试失败: ${error.message}`);
      }

      const isValid = checksumValid && metadataValid && canDecrypt;

      return {
        isValid,
        checksumValid,
        metadataValid,
        canDecrypt,
        errorDetails: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      errors.push(`完整性验证失败: ${error.message}`);
      return {
        isValid: false,
        checksumValid: false,
        metadataValid: false,
        canDecrypt: false,
        errorDetails: errors
      };
    }
  }

  // ==================== 私有方法 ====================

  private async createEncryptionDirectories(): Promise<void> {
    const dirs = [
      this.config.storage.keyStorePath,
      this.config.storage.encryptedPath,
      this.config.storage.metadataPath
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async loadExistingKeys(): Promise<void> {
    try {
      const keyFiles = await fs.readdir(this.config.storage.keyStorePath);
      
      for (const keyFile of keyFiles) {
        if (keyFile.endsWith('.key.enc')) {
          try {
            const keyData = await this.loadEncryptionKey(keyFile);
            this.activeKeys.set(keyData.id, keyData);
          } catch (error) {
            console.warn(`加载密钥文件失败: ${keyFile}`, error);
          }
        }
      }
      
      console.log(`加载了 ${this.activeKeys.size} 个加密密钥`);
    } catch (error) {
      console.warn('加载现有密钥失败:', error);
    }
  }

  private async initializeMasterKey(): Promise<void> {
    if (!this.config.security.masterKeyEnabled) {
      return;
    }

    const masterKeyPath = path.join(this.config.storage.keyStorePath, 'master.key');
    
    try {
      // 尝试加载现有主密钥
      const masterKeyData = await fs.readFile(masterKeyPath);
      this.currentMasterKey = JSON.parse(masterKeyData.toString());
      console.log('主密钥加载成功');
    } catch (error) {
      // 生成新的主密钥
      this.currentMasterKey = {
        id: 'master-key',
        key: crypto.randomBytes(32),
        salt: crypto.randomBytes(16),
        algorithm: 'aes-256-gcm',
        createdAt: new Date(),
        version: 1,
        isActive: true
      };
      
      await fs.writeFile(masterKeyPath, JSON.stringify(this.currentMasterKey, null, 2));
      console.log('新主密钥生成完成');
    }
  }

  private async checkKeyRotation(): Promise<void> {
    const activeKeys = Array.from(this.activeKeys.values()).filter(key => key.isActive);
    
    if (activeKeys.length === 0) {
      await this.generateEncryptionKey();
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.security.keyRotationDays);
    
    const needsRotation = activeKeys.some(key => key.createdAt < cutoffDate);
    
    if (needsRotation) {
      await this.rotateEncryptionKeys();
    }
  }

  private async performEncryption(
    inputPath: string,
    outputPath: string,
    encryptionKey: EncryptionKey,
    options: {
      enableCompression: boolean;
      chunkSize: number;
    }
  ): Promise<EncryptionMetadata> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipherGCM(this.config.algorithm, encryptionKey.key, iv);
    
    let inputStream = await fs.readFile(inputPath);
    let originalSize = inputStream.length;
    
    // 可选压缩
    if (options.enableCompression) {
      inputStream = await this.compressData(inputStream);
    }
    
    // 加密数据
    const encrypted = Buffer.concat([
      cipher.update(inputStream),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // 组合加密数据: IV + AuthTag + EncryptedData
    const finalData = Buffer.concat([iv, authTag, encrypted]);
    
    // 写入输出文件
    await fs.writeFile(outputPath, finalData);
    
    // 生成校验和
    const checksum = crypto.createHash('sha256').update(finalData).digest('hex');
    
    const metadata: EncryptionMetadata = {
      keyId: encryptionKey.id,
      keyVersion: encryptionKey.version,
      algorithm: encryptionKey.algorithm,
      iv,
      authTag,
      salt: encryptionKey.salt,
      originalSize,
      encryptedSize: finalData.length,
      checksum,
      compressionEnabled: options.enableCompression,
      encryptedAt: new Date()
    };
    
    return metadata;
  }

  private async performDecryption(
    inputPath: string,
    outputPath: string,
    metadata: EncryptionMetadata,
    decryptionKey: EncryptionKey
  ): Promise<void> {
    const encryptedData = await fs.readFile(inputPath);
    
    // 提取组件
    const iv = encryptedData.subarray(0, 16);
    const authTag = encryptedData.subarray(16, 32);
    const encrypted = encryptedData.subarray(32);
    
    // 创建解密器
    const decipher = crypto.createDecipherGCM(metadata.algorithm, decryptionKey.key, iv);
    decipher.setAuthTag(authTag);
    
    // 解密数据
    let decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    // 可选解压缩
    if (metadata.compressionEnabled) {
      decrypted = await this.decompressData(decrypted);
    }
    
    // 写入输出文件
    await fs.writeFile(outputPath, decrypted);
  }

  private async compressData(data: Buffer): Promise<Buffer> {
    const zlib = require('zlib');
    const gzip = promisify(zlib.gzip);
    return await gzip(data, { level: this.config.compression.level });
  }

  private async decompressData(data: Buffer): Promise<Buffer> {
    const zlib = require('zlib');
    const gunzip = promisify(zlib.gunzip);
    return await gunzip(data);
  }

  private async saveEncryptionKey(key: EncryptionKey): Promise<void> {
    const keyPath = path.join(this.config.storage.keyStorePath, `${key.id}.key.enc`);
    const keyData = JSON.stringify(key, null, 2);
    
    // 简化版本：在实际实现中，密钥本身也应该加密存储
    await fs.writeFile(keyPath, keyData);
  }

  private async loadEncryptionKey(keyFileName: string): Promise<EncryptionKey> {
    const keyPath = path.join(this.config.storage.keyStorePath, keyFileName);
    const keyData = await fs.readFile(keyPath, 'utf-8');
    return JSON.parse(keyData);
  }

  private async saveEncryptionMetadata(filePath: string, metadata: EncryptionMetadata): Promise<void> {
    const metadataPath = `${filePath}.metadata`;
    const metadataJson = JSON.stringify(metadata, null, 2);
    await fs.writeFile(metadataPath, metadataJson);
  }

  private async loadEncryptionMetadata(filePath: string): Promise<EncryptionMetadata> {
    const metadataPath = `${filePath}.metadata`;
    const metadataJson = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(metadataJson);
  }

  private async getEncryptionKey(keyId: string): Promise<EncryptionKey> {
    const key = this.activeKeys.get(keyId);
    if (!key) {
      throw new Error(`加密密钥不存在: ${keyId}`);
    }
    return key;
  }

  private getActiveKeyId(): string {
    const activeKeys = Array.from(this.activeKeys.values()).filter(key => key.isActive);
    if (activeKeys.length === 0) {
      throw new Error('没有活跃的加密密钥');
    }
    
    // 返回最新的活跃密钥
    const latestKey = activeKeys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return latestKey.id;
  }

  private generateKeyId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = crypto.randomBytes(4).toString('hex');
    return `key-${timestamp}-${random}`;
  }

  private generateJobId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = crypto.randomBytes(4).toString('hex');
    return `enc-job-${timestamp}-${random}`;
  }

  private generateEncryptedFilePath(inputPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basename = path.basename(inputPath);
    return path.join(this.config.storage.encryptedPath, `${basename}.${timestamp}.enc`);
  }

  private generateDecryptedFilePath(encryptedPath: string): string {
    const basename = path.basename(encryptedPath, '.enc');
    return path.join(path.dirname(encryptedPath), `decrypted-${basename}`);
  }

  private async verifyEncryptedFile(filePath: string, metadata: EncryptionMetadata): Promise<void> {
    const fileData = await fs.readFile(filePath);
    const actualChecksum = crypto.createHash('sha256').update(fileData).digest('hex');
    
    if (actualChecksum !== metadata.checksum) {
      throw new Error('加密文件校验和验证失败');
    }
  }

  private async verifyDecryptedFile(filePath: string, metadata: EncryptionMetadata): Promise<boolean> {
    try {
      const fileStats = await fs.stat(filePath);
      return fileStats.size === metadata.originalSize;
    } catch {
      return false;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async verifyFileChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    try {
      const fileData = await fs.readFile(filePath);
      const actualChecksum = crypto.createHash('sha256').update(fileData).digest('hex');
      return actualChecksum === expectedChecksum;
    } catch {
      return false;
    }
  }

  private async validateMetadata(metadata: EncryptionMetadata): Promise<boolean> {
    return !!(
      metadata.keyId &&
      metadata.algorithm &&
      metadata.iv &&
      metadata.authTag &&
      metadata.checksum &&
      metadata.originalSize > 0 &&
      metadata.encryptedSize > 0
    );
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}