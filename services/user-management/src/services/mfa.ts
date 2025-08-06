import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';

import { config, constants } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { AuditService } from './audit';
import { EmailService } from './email';
import {
  MFASettings,
  MFASetupData,
  MFAVerificationData,
  MFAMethod,
  User,
  SecurityEvent
} from '@/types';

/**
 * Multi-Factor Authentication Service
 * Handles TOTP, SMS, and Email-based MFA
 */
export class MFAService {
  private db: DatabaseService;
  private redis: RedisService;
  private audit: AuditService;
  private email: EmailService;

  constructor() {
    this.db = new DatabaseService();
    this.redis = new RedisService();
    this.audit = new AuditService();
    this.email = new EmailService();

    // Configure otplib
    authenticator.options = {
      window: config.security.mfaWindowSize,
      step: 30 // 30 seconds
    };
  }

  // ==========================================
  // MFA Setup Methods
  // ==========================================

  /**
   * Setup TOTP MFA for user
   */
  async setupTOTP(userId: string, serviceName = 'AI Answer Ninja'): Promise<MFASetupData> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if MFA is already enabled
      const existingMFA = await this.db.getMFASettings(userId);
      if (existingMFA?.isEnabled) {
        throw new Error('MFA is already enabled for this user');
      }

      // Generate secret
      const secret = authenticator.generateSecret();
      
      // Create service name for QR code
      const label = `${serviceName} (${user.phoneNumber})`;
      const issuer = serviceName;
      
      // Generate TOTP URL
      const otpAuthUrl = authenticator.keyuri(
        user.phoneNumber,
        issuer,
        secret
      );

      // Generate QR code
      const qrCodeUrl = await qrcode.toDataURL(otpAuthUrl);

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Store temporary MFA setup data (not enabled yet)
      await this.redis.setex(
        `mfa_setup:${userId}`,
        600, // 10 minutes
        {
          secret,
          backupCodes: backupCodes.map(code => this.hashBackupCode(code)),
          method: 'totp' as MFAMethod,
          setupAt: new Date().toISOString()
        }
      );

      logger.info('TOTP MFA setup initiated', { userId });

      return {
        secret,
        qrCodeUrl,
        backupCodes
      };
    } catch (error) {
      logger.error('TOTP MFA setup failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Verify TOTP setup and enable MFA
   */
  async verifyAndEnableTOTP(
    userId: string,
    token: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ backupCodes: string[] }> {
    try {
      // Get temporary setup data
      const setupData = await this.redis.getJSON(`mfa_setup:${userId}`);
      if (!setupData) {
        throw new Error('MFA setup session not found or expired');
      }

      // Verify TOTP token
      const isValid = authenticator.verify({
        token,
        secret: setupData.secret
      });

      if (!isValid) {
        throw new Error('Invalid TOTP token');
      }

      // Generate unhashed backup codes for user
      const backupCodes = this.generateBackupCodes();
      const hashedBackupCodes = backupCodes.map(code => this.hashBackupCode(code));

      // Enable MFA in database
      await this.db.enableMFA(userId, {
        secret: this.encryptSecret(setupData.secret),
        backupCodes: hashedBackupCodes,
        method: 'totp' as MFAMethod
      });

      // Clean up temporary setup data
      await this.redis.delete(`mfa_setup:${userId}`);

      // Log MFA enablement
      await this.audit.log({
        userId,
        action: 'mfa_enable',
        resource: 'security',
        details: { method: 'totp' },
        ipAddress,
        userAgent,
        success: true
      });

      // Send notification email
      const user = await this.db.getUserById(userId);
      if (user?.email) {
        await this.email.sendMFAEnabled(user);
      }

      logger.info('TOTP MFA enabled successfully', { userId });

      return { backupCodes };
    } catch (error) {
      logger.error('TOTP MFA verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Disable MFA for user
   */
  async disableMFA(
    userId: string,
    currentPassword: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password for security
      const isValidPassword = await this.verifyPassword(currentPassword, user.passwordHash);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Disable MFA in database
      await this.db.disableMFA(userId);

      // Log MFA disablement
      await this.audit.log({
        userId,
        action: 'mfa_disable',
        resource: 'security',
        details: {},
        ipAddress,
        userAgent,
        success: true
      });

      // Log security event
      await this.audit.logSecurityEvent({
        type: 'mfa_disable',
        severity: 'medium',
        userId,
        details: { disabledBy: 'user' },
        timestamp: new Date()
      });

      // Send notification email
      if (user.email) {
        await this.email.sendMFADisabled(user);
      }

      logger.info('MFA disabled successfully', { userId });
    } catch (error) {
      logger.error('MFA disable failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // MFA Verification Methods
  // ==========================================

  /**
   * Verify MFA token
   */
  async verifyMFA(
    userId: string,
    verificationData: MFAVerificationData,
    ipAddress: string,
    userAgent: string
  ): Promise<boolean> {
    try {
      const mfaSettings = await this.db.getMFASettings(userId);
      if (!mfaSettings?.isEnabled) {
        throw new Error('MFA is not enabled for this user');
      }

      const { token, method } = verificationData;
      let isValid = false;

      switch (method) {
        case 'totp':
          isValid = await this.verifyTOTP(userId, token, mfaSettings);
          break;
        case 'sms':
          isValid = await this.verifySMS(userId, token);
          break;
        case 'email':
          isValid = await this.verifyEmail(userId, token);
          break;
        default:
          throw new Error('Unsupported MFA method');
      }

      if (isValid) {
        // Update last used timestamp
        await this.db.updateMFALastUsed(userId);

        // Log successful MFA verification
        await this.audit.log({
          userId,
          action: 'login',
          resource: 'auth',
          details: { mfaMethod: method, mfaVerified: true },
          ipAddress,
          userAgent,
          success: true
        });

        logger.info('MFA verification successful', { userId, method });
      } else {
        // Log failed MFA attempt
        await this.audit.log({
          userId,
          action: 'login',
          resource: 'auth',
          details: { mfaMethod: method, mfaVerified: false },
          ipAddress,
          userAgent,
          success: false
        });

        // Log security event
        await this.audit.logSecurityEvent({
          type: 'mfa_bypass_attempt',
          severity: 'high',
          userId,
          details: { method, ipAddress },
          timestamp: new Date()
        });

        logger.warn('MFA verification failed', { userId, method });
      }

      return isValid;
    } catch (error) {
      logger.error('MFA verification error', {
        userId,
        method: verificationData.method,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Verify TOTP token
   */
  private async verifyTOTP(
    userId: string,
    token: string,
    mfaSettings: MFASettings
  ): Promise<boolean> {
    try {
      if (!mfaSettings.secret) {
        throw new Error('TOTP secret not found');
      }

      const decryptedSecret = this.decryptSecret(mfaSettings.secret);
      
      // First try regular TOTP verification
      const isValidTOTP = authenticator.verify({
        token,
        secret: decryptedSecret
      });

      if (isValidTOTP) {
        return true;
      }

      // If TOTP fails, check backup codes
      return await this.verifyBackupCode(userId, token, mfaSettings);
    } catch (error) {
      logger.error('TOTP verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Verify backup code
   */
  private async verifyBackupCode(
    userId: string,
    code: string,
    mfaSettings: MFASettings
  ): Promise<boolean> {
    try {
      const hashedCode = this.hashBackupCode(code);
      const backupCodes = mfaSettings.backupCodes as string[];

      // Check if code exists in backup codes
      const codeIndex = backupCodes.findIndex(stored => stored === hashedCode);
      
      if (codeIndex === -1) {
        return false;
      }

      // Remove used backup code
      const updatedBackupCodes = backupCodes.filter((_, index) => index !== codeIndex);
      await this.db.updateMFABackupCodes(userId, updatedBackupCodes);

      // Log backup code usage
      await this.audit.log({
        userId,
        action: 'mfa_backup_code_used',
        resource: 'security',
        details: { remainingCodes: updatedBackupCodes.length },
        ipAddress: '',
        userAgent: '',
        success: true
      });

      // Warn user if running low on backup codes
      if (updatedBackupCodes.length <= 2) {
        const user = await this.db.getUserById(userId);
        if (user?.email) {
          await this.email.sendLowBackupCodesWarning(user, updatedBackupCodes.length);
        }
      }

      logger.info('Backup code used successfully', { 
        userId, 
        remainingCodes: updatedBackupCodes.length 
      });

      return true;
    } catch (error) {
      logger.error('Backup code verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Verify SMS token (placeholder - requires SMS service integration)
   */
  private async verifySMS(userId: string, token: string): Promise<boolean> {
    try {
      // Check stored SMS token in Redis
      const storedToken = await this.redis.get(`sms_token:${userId}`);
      
      if (!storedToken || storedToken !== token) {
        return false;
      }

      // Remove used token
      await this.redis.delete(`sms_token:${userId}`);
      return true;
    } catch (error) {
      logger.error('SMS token verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Verify email token
   */
  private async verifyEmail(userId: string, token: string): Promise<boolean> {
    try {
      // Check stored email token in Redis
      const storedToken = await this.redis.get(`email_token:${userId}`);
      
      if (!storedToken || storedToken !== token) {
        return false;
      }

      // Remove used token
      await this.redis.delete(`email_token:${userId}`);
      return true;
    } catch (error) {
      logger.error('Email token verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  // ==========================================
  // MFA Management Methods
  // ==========================================

  /**
   * Get MFA status for user
   */
  async getMFAStatus(userId: string): Promise<{
    isEnabled: boolean;
    method?: MFAMethod;
    backupCodesRemaining?: number;
    lastUsedAt?: Date;
  }> {
    try {
      const mfaSettings = await this.db.getMFASettings(userId);
      
      if (!mfaSettings || !mfaSettings.isEnabled) {
        return { isEnabled: false };
      }

      return {
        isEnabled: true,
        method: mfaSettings.method,
        backupCodesRemaining: (mfaSettings.backupCodes as string[]).length,
        lastUsedAt: mfaSettings.lastUsedAt
      };
    } catch (error) {
      logger.error('Failed to get MFA status', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Regenerate backup codes
   */
  async regenerateBackupCodes(
    userId: string,
    currentPassword: string,
    ipAddress: string,
    userAgent: string
  ): Promise<string[]> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValidPassword = await this.verifyPassword(currentPassword, user.passwordHash);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      const mfaSettings = await this.db.getMFASettings(userId);
      if (!mfaSettings?.isEnabled) {
        throw new Error('MFA is not enabled for this user');
      }

      // Generate new backup codes
      const newBackupCodes = this.generateBackupCodes();
      const hashedBackupCodes = newBackupCodes.map(code => this.hashBackupCode(code));

      // Update backup codes in database
      await this.db.updateMFABackupCodes(userId, hashedBackupCodes);

      // Log backup codes regeneration
      await this.audit.log({
        userId,
        action: 'mfa_backup_codes_regenerated',
        resource: 'security',
        details: { newCodesCount: newBackupCodes.length },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('Backup codes regenerated', { userId });

      return newBackupCodes;
    } catch (error) {
      logger.error('Backup codes regeneration failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send MFA token via email
   */
  async sendEmailToken(userId: string): Promise<void> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user?.email) {
        throw new Error('User email not found');
      }

      // Generate 6-digit token
      const token = Math.floor(100000 + Math.random() * 900000).toString();

      // Store token in Redis (5 minutes expiration)
      await this.redis.setex(`email_token:${userId}`, 300, token);

      // Send email with token
      await this.email.sendMFAToken(user, token);

      logger.info('MFA email token sent', { userId });
    } catch (error) {
      logger.error('Failed to send MFA email token', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send MFA token via SMS (placeholder)
   */
  async sendSMSToken(userId: string): Promise<void> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Generate 6-digit token
      const token = Math.floor(100000 + Math.random() * 900000).toString();

      // Store token in Redis (5 minutes expiration)
      await this.redis.setex(`sms_token:${userId}`, 300, token);

      // TODO: Integrate with SMS service (Twilio, etc.)
      // await this.smsService.sendMFAToken(user.phoneNumber, token);

      logger.info('MFA SMS token sent', { userId });
    } catch (error) {
      logger.error('Failed to send MFA SMS token', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Generate backup codes
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < constants.BACKUP_CODES_COUNT; i++) {
      // Generate 8-character alphanumeric code
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    
    return codes;
  }

  /**
   * Hash backup code for secure storage
   */
  private hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code + config.jwt.accessSecret).digest('hex');
  }

  /**
   * Encrypt MFA secret for storage
   */
  private encryptSecret(secret: string): string {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(config.jwt.accessSecret, 'salt', 32);
      const iv = crypto.randomBytes(12);
      
      const cipher = crypto.createCipher(algorithm, key);
      const encrypted = Buffer.concat([
        cipher.update(secret, 'utf8'),
        cipher.final()
      ]);
      
      const tag = cipher.getAuthTag();
      
      return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
      logger.error('Secret encryption failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw new Error('Failed to encrypt secret');
    }
  }

  /**
   * Decrypt MFA secret
   */
  private decryptSecret(encryptedSecret: string): string {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(config.jwt.accessSecret, 'salt', 32);
      
      const [ivHex, tagHex, encryptedHex] = encryptedSecret.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');
      
      const decipher = crypto.createDecipher(algorithm, key);
      decipher.setAuthTag(tag);
      
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      logger.error('Secret decryption failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw new Error('Failed to decrypt secret');
    }
  }

  /**
   * Verify password (helper method)
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    // This should use the same password verification logic as AuthService
    // For now, simplified implementation
    const crypto = require('crypto');
    const bcrypt = require('bcryptjs');
    
    try {
      // Try Argon2 first (if hash starts with $argon2)
      if (hash.startsWith('$argon2')) {
        const argon2 = require('argon2');
        return await argon2.verify(hash, password);
      }
      // Fallback to bcrypt
      return await bcrypt.compare(password, hash);
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const mfaService = new MFAService();