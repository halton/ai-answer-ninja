/**
 * Data Encryption Service
 * Provides field-level and document-level encryption for sensitive data
 */

import * as crypto from 'crypto';
import CryptoJS from 'crypto-js';
import { EncryptedData, EncryptionOptions } from '../types';
import { KeyManagement } from './KeyManagement';
import { logger } from '../utils/Logger';

export class DataEncryption {
  private static instance: DataEncryption;
  private keyManager: KeyManagement;
  private readonly DEFAULT_ALGORITHM = 'aes-256-gcm';
  private readonly DEFAULT_ITERATIONS = 100000;

  private constructor() {
    this.keyManager = KeyManagement.getInstance();
  }

  public static getInstance(): DataEncryption {
    if (!DataEncryption.instance) {
      DataEncryption.instance = new DataEncryption();
    }
    return DataEncryption.instance;
  }

  /**
   * Encrypt sensitive string data
   */
  public async encryptString(
    plaintext: string,
    context: string,
    options: EncryptionOptions = {}
  ): Promise<EncryptedData> {
    try {
      const algorithm = options.algorithm || this.DEFAULT_ALGORITHM;
      const key = await this.keyManager.getUserEncryptionKey(context);
      
      // Generate IV and salt
      const iv = crypto.randomBytes(16);
      const salt = crypto.randomBytes(32);
      
      // Derive key
      const derivedKey = await this.deriveKey(key, salt, options);
      
      // Create cipher
      const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);
      
      // Encrypt data
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
      ]);
      
      // Get auth tag for GCM
      let tag: Buffer | undefined;
      if (algorithm.includes('gcm')) {
        tag = cipher.getAuthTag();
      }
      
      // Calculate checksum
      const checksum = this.calculateChecksum(encrypted);
      
      return {
        data: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        tag: tag?.toString('base64'),
        algorithm,
        keyVersion: await this.keyManager.getCurrentKeyVersion(),
        timestamp: Date.now(),
        checksum
      };
    } catch (error) {
      logger.error('String encryption failed', {
        context,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt sensitive string data
   */
  public async decryptString(
    encryptedData: EncryptedData,
    context: string
  ): Promise<string> {
    try {
      // Verify checksum
      const dataBuffer = Buffer.from(encryptedData.data, 'base64');
      const calculatedChecksum = this.calculateChecksum(dataBuffer);
      
      if (calculatedChecksum !== encryptedData.checksum) {
        throw new Error('Data integrity check failed');
      }
      
      const key = await this.keyManager.getUserEncryptionKey(context);
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const salt = Buffer.from(encryptedData.salt, 'base64');
      
      // Derive key
      const derivedKey = await this.deriveKey(key, salt, {
        algorithm: encryptedData.algorithm as any
      });
      
      // Create decipher
      const decipher = crypto.createDecipheriv(encryptedData.algorithm, derivedKey, iv);
      
      // Set auth tag for GCM
      if (encryptedData.algorithm.includes('gcm') && encryptedData.tag) {
        decipher.setAuthTag(Buffer.from(encryptedData.tag, 'base64'));
      }
      
      // Decrypt data
      const decrypted = Buffer.concat([
        decipher.update(dataBuffer),
        decipher.final()
      ]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      logger.error('String decryption failed', {
        context,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Decryption failed');
    }
  }

  /**
   * Encrypt JSON object
   */
  public async encryptObject(
    obj: any,
    context: string,
    options: EncryptionOptions = {}
  ): Promise<EncryptedData> {
    const jsonString = JSON.stringify(obj);
    return this.encryptString(jsonString, context, options);
  }

  /**
   * Decrypt JSON object
   */
  public async decryptObject<T = any>(
    encryptedData: EncryptedData,
    context: string
  ): Promise<T> {
    const jsonString = await this.decryptString(encryptedData, context);
    return JSON.parse(jsonString);
  }

  /**
   * Encrypt specific fields in an object
   */
  public async encryptFields(
    obj: any,
    fields: string[],
    context: string
  ): Promise<any> {
    const encrypted = { ...obj };
    
    for (const field of fields) {
      if (obj[field] !== undefined && obj[field] !== null) {
        const value = typeof obj[field] === 'string' 
          ? obj[field] 
          : JSON.stringify(obj[field]);
        
        const encryptedValue = await this.encryptString(value, `${context}:${field}`);
        encrypted[field] = {
          __encrypted: true,
          data: encryptedValue
        };
      }
    }
    
    return encrypted;
  }

  /**
   * Decrypt specific fields in an object
   */
  public async decryptFields(
    obj: any,
    context: string
  ): Promise<any> {
    const decrypted = { ...obj };
    
    for (const field in obj) {
      if (obj[field]?.__encrypted && obj[field]?.data) {
        try {
          const decryptedValue = await this.decryptString(
            obj[field].data,
            `${context}:${field}`
          );
          
          // Try to parse as JSON, otherwise keep as string
          try {
            decrypted[field] = JSON.parse(decryptedValue);
          } catch {
            decrypted[field] = decryptedValue;
          }
        } catch (error) {
          logger.error('Field decryption failed', {
            field,
            context,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Keep encrypted value if decryption fails
          decrypted[field] = obj[field];
        }
      }
    }
    
    return decrypted;
  }

  /**
   * Encrypt database field (for field-level encryption)
   */
  public async encryptDatabaseField(
    value: string,
    tableName: string,
    fieldName: string
  ): Promise<string> {
    const key = await this.keyManager.getFieldEncryptionKey(tableName, fieldName);
    const encrypted = CryptoJS.AES.encrypt(value, key).toString();
    
    // Add prefix to identify encrypted fields
    return `ENC:${encrypted}`;
  }

  /**
   * Decrypt database field
   */
  public async decryptDatabaseField(
    encryptedValue: string,
    tableName: string,
    fieldName: string
  ): Promise<string> {
    if (!encryptedValue.startsWith('ENC:')) {
      return encryptedValue; // Not encrypted
    }
    
    const encrypted = encryptedValue.substring(4);
    const key = await this.keyManager.getFieldEncryptionKey(tableName, fieldName);
    const decrypted = CryptoJS.AES.decrypt(encrypted, key);
    
    return decrypted.toString(CryptoJS.enc.Utf8);
  }

  /**
   * Tokenize sensitive data (for PCI compliance)
   */
  public async tokenizeSensitiveData(
    sensitiveData: string,
    tokenType: 'credit_card' | 'ssn' | 'phone' | 'email'
  ): Promise<string> {
    // Generate unique token
    const token = `TOK_${tokenType.toUpperCase()}_${crypto.randomBytes(16).toString('hex')}`;
    
    // Store mapping securely (in production, use dedicated tokenization service)
    const encryptedData = await this.encryptString(
      sensitiveData,
      `token:${token}`,
      { algorithm: 'aes-256-gcm' }
    );
    
    // Store encrypted data with token mapping
    // This would be stored in a secure token vault
    await this.storeTokenMapping(token, encryptedData);
    
    return token;
  }

  /**
   * Detokenize data
   */
  public async detokenizeSensitiveData(token: string): Promise<string | null> {
    if (!token.startsWith('TOK_')) {
      return null;
    }
    
    // Retrieve encrypted data from token vault
    const encryptedData = await this.retrieveTokenMapping(token);
    if (!encryptedData) {
      return null;
    }
    
    return this.decryptString(encryptedData, `token:${token}`);
  }

  /**
   * Format-preserving encryption (FPE) for maintaining data format
   */
  public async encryptWithFormatPreservation(
    value: string,
    format: 'phone' | 'ssn' | 'credit_card'
  ): Promise<string> {
    // Simple FPE implementation - in production use FF3-1 algorithm
    const digits = value.replace(/\D/g, '');
    const encrypted = await this.encryptString(digits, `fpe:${format}`);
    
    // Preserve format
    let result = '';
    let digitIndex = 0;
    
    for (const char of value) {
      if (/\d/.test(char)) {
        // Replace with encrypted digit (simplified)
        const encChar = encrypted.data.charCodeAt(digitIndex % encrypted.data.length) % 10;
        result += encChar;
        digitIndex++;
      } else {
        result += char; // Keep non-digit characters
      }
    }
    
    return result;
  }

  /**
   * Derive encryption key
   */
  private async deriveKey(
    password: string,
    salt: Buffer,
    options: EncryptionOptions
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const iterations = options.iterations || this.DEFAULT_ITERATIONS;
      const keyLength = 32; // 256 bits
      
      crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }

  /**
   * Calculate checksum for integrity
   */
  private calculateChecksum(data: Buffer): string {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');
  }

  /**
   * Store token mapping (placeholder - use secure token vault in production)
   */
  private async storeTokenMapping(token: string, encryptedData: EncryptedData): Promise<void> {
    // In production, this would store in a secure token vault
    logger.info('Token mapping stored', { token });
  }

  /**
   * Retrieve token mapping (placeholder)
   */
  private async retrieveTokenMapping(token: string): Promise<EncryptedData | null> {
    // In production, retrieve from secure token vault
    logger.info('Token mapping retrieved', { token });
    return null;
  }

  /**
   * Encrypt file
   */
  public async encryptFile(
    filePath: string,
    outputPath: string,
    context: string
  ): Promise<void> {
    const fs = require('fs').promises;
    const fileContent = await fs.readFile(filePath);
    
    // Encrypt file content
    const encrypted = await this.encryptString(
      fileContent.toString('base64'),
      context,
      { algorithm: 'aes-256-gcm' }
    );
    
    // Write encrypted file
    await fs.writeFile(outputPath, JSON.stringify(encrypted));
    
    logger.info('File encrypted', {
      inputPath: filePath,
      outputPath,
      size: fileContent.length
    });
  }

  /**
   * Decrypt file
   */
  public async decryptFile(
    encryptedPath: string,
    outputPath: string,
    context: string
  ): Promise<void> {
    const fs = require('fs').promises;
    const encryptedContent = await fs.readFile(encryptedPath, 'utf8');
    const encryptedData = JSON.parse(encryptedContent) as EncryptedData;
    
    // Decrypt content
    const decryptedBase64 = await this.decryptString(encryptedData, context);
    const decryptedContent = Buffer.from(decryptedBase64, 'base64');
    
    // Write decrypted file
    await fs.writeFile(outputPath, decryptedContent);
    
    logger.info('File decrypted', {
      inputPath: encryptedPath,
      outputPath,
      size: decryptedContent.length
    });
  }
}