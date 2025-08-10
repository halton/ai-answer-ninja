/**
 * Multi-Factor Authentication Service
 * Handles TOTP, SMS, Email, and Backup Codes
 */

import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { MFASettings, MFAMethod, MFAMethodType, User } from '../types';
import { logger } from '../utils/Logger';

export class MFAService {
  private static instance: MFAService;
  private readonly APP_NAME = 'AI Answer Ninja';
  private readonly BACKUP_CODES_COUNT = 10;
  private readonly TOTP_WINDOW = 2; // Time window for TOTP validation
  
  private constructor() {}
  
  public static getInstance(): MFAService {
    if (!MFAService.instance) {
      MFAService.instance = new MFAService();
    }
    return MFAService.instance;
  }
  
  /**
   * Enable MFA for user
   */
  public async enableMFA(
    userId: string,
    method: MFAMethodType
  ): Promise<MFASettings> {
    try {
      const settings = await this.getUserMFASettings(userId);
      
      // Add or update method
      const methodIndex = settings.methods.findIndex(m => m.type === method);
      if (methodIndex >= 0) {
        settings.methods[methodIndex].isConfigured = true;
      } else {
        settings.methods.push({
          type: method,
          isConfigured: true,
          isVerified: false,
          configuredAt: new Date()
        });
      }
      
      settings.isEnabled = true;
      settings.preferredMethod = settings.preferredMethod || method;
      
      logger.info('MFA enabled', { userId, method });
      
      return settings;
    } catch (error) {
      logger.error('Failed to enable MFA', {
        userId,
        method,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to enable MFA');
    }
  }
  
  /**
   * Disable MFA for user
   */
  public async disableMFA(userId: string): Promise<void> {
    try {
      const settings = await this.getUserMFASettings(userId);
      settings.isEnabled = false;
      settings.methods = [];
      settings.backupCodes = [];
      settings.preferredMethod = undefined;
      
      logger.info('MFA disabled', { userId });
    } catch (error) {
      logger.error('Failed to disable MFA', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to disable MFA');
    }
  }
  
  /**
   * Generate TOTP secret
   */
  public async generateTOTPSecret(
    userId: string,
    userEmail: string
  ): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
    try {
      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `${this.APP_NAME} (${userEmail})`,
        issuer: this.APP_NAME,
        length: 32
      });
      
      // Generate QR code
      const otpauthUrl = speakeasy.otpauthURL({
        secret: secret.base32,
        label: userEmail,
        issuer: this.APP_NAME,
        encoding: 'base32'
      });
      
      const qrCode = await qrcode.toDataURL(otpauthUrl);
      
      // Generate backup codes
      const backupCodes = this.generateBackupCodes();
      
      logger.info('TOTP secret generated', { userId });
      
      return {
        secret: secret.base32,
        qrCode,
        backupCodes
      };
    } catch (error) {
      logger.error('Failed to generate TOTP secret', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to generate TOTP secret');
    }
  }
  
  /**
   * Verify TOTP token
   */
  public verifyTOTPToken(secret: string, token: string): boolean {
    try {
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: this.TOTP_WINDOW
      });
      
      logger.debug('TOTP token verification', { verified });
      
      return verified;
    } catch (error) {
      logger.error('TOTP verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Generate SMS OTP
   */
  public async generateSMSOTP(userId: string, phoneNumber: string): Promise<string> {
    try {
      // Generate 6-digit OTP
      const otp = this.generateOTP(6);
      
      // Store OTP with expiration (in production, use Redis)
      await this.storeOTP(userId, otp, 'sms', 300); // 5 minutes expiry
      
      // Send SMS (integrate with SMS service)
      await this.sendSMS(phoneNumber, `Your ${this.APP_NAME} verification code is: ${otp}`);
      
      logger.info('SMS OTP generated', { userId, phoneNumber: this.maskPhone(phoneNumber) });
      
      return otp;
    } catch (error) {
      logger.error('Failed to generate SMS OTP', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to generate SMS OTP');
    }
  }
  
  /**
   * Generate Email OTP
   */
  public async generateEmailOTP(userId: string, email: string): Promise<string> {
    try {
      // Generate 6-digit OTP
      const otp = this.generateOTP(6);
      
      // Store OTP with expiration
      await this.storeOTP(userId, otp, 'email', 600); // 10 minutes expiry
      
      // Send email (integrate with email service)
      await this.sendEmail(email, 'Verification Code', `Your ${this.APP_NAME} verification code is: ${otp}`);
      
      logger.info('Email OTP generated', { userId, email: this.maskEmail(email) });
      
      return otp;
    } catch (error) {
      logger.error('Failed to generate email OTP', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to generate email OTP');
    }
  }
  
  /**
   * Verify OTP
   */
  public async verifyOTP(
    userId: string,
    otp: string,
    type: 'sms' | 'email'
  ): Promise<boolean> {
    try {
      const storedOTP = await this.getStoredOTP(userId, type);
      
      if (!storedOTP) {
        logger.warn('OTP not found or expired', { userId, type });
        return false;
      }
      
      const isValid = storedOTP === otp;
      
      if (isValid) {
        await this.deleteStoredOTP(userId, type);
        logger.info('OTP verified successfully', { userId, type });
      } else {
        logger.warn('Invalid OTP', { userId, type });
      }
      
      return isValid;
    } catch (error) {
      logger.error('OTP verification failed', {
        userId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Generate backup codes
   */
  public generateBackupCodes(count: number = this.BACKUP_CODES_COUNT): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const code = this.generateSecureCode();
      codes.push(code);
    }
    
    logger.info('Backup codes generated', { count });
    
    return codes;
  }
  
  /**
   * Verify backup code
   */
  public async verifyBackupCode(
    userId: string,
    code: string,
    backupCodes: string[]
  ): Promise<{ valid: boolean; remainingCodes: string[] }> {
    try {
      const index = backupCodes.indexOf(code);
      
      if (index === -1) {
        logger.warn('Invalid backup code', { userId });
        return { valid: false, remainingCodes: backupCodes };
      }
      
      // Remove used code
      const remainingCodes = backupCodes.filter((_, i) => i !== index);
      
      logger.info('Backup code used', {
        userId,
        remainingCodes: remainingCodes.length
      });
      
      return { valid: true, remainingCodes };
    } catch (error) {
      logger.error('Backup code verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { valid: false, remainingCodes: backupCodes };
    }
  }
  
  /**
   * Require second factor authentication
   */
  public async requireSecondFactor(
    userId: string,
    preferredMethod?: MFAMethodType
  ): Promise<{ method: MFAMethodType; challenge?: string }> {
    try {
      const settings = await this.getUserMFASettings(userId);
      
      if (!settings.isEnabled) {
        throw new Error('MFA not enabled for user');
      }
      
      const method = preferredMethod || settings.preferredMethod || 'totp';
      const availableMethod = settings.methods.find(m => m.type === method && m.isConfigured);
      
      if (!availableMethod) {
        throw new Error('Preferred MFA method not configured');
      }
      
      let challenge: string | undefined;
      
      switch (method) {
        case 'sms':
          if (availableMethod.phoneNumber) {
            challenge = await this.generateSMSOTP(userId, availableMethod.phoneNumber);
          }
          break;
        case 'email':
          if (availableMethod.email) {
            challenge = await this.generateEmailOTP(userId, availableMethod.email);
          }
          break;
        case 'totp':
          // No challenge needed for TOTP
          break;
        case 'backup_codes':
          // No challenge needed for backup codes
          break;
      }
      
      logger.info('Second factor required', { userId, method });
      
      return { method, challenge };
    } catch (error) {
      logger.error('Failed to require second factor', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Verify second factor
   */
  public async verifySecondFactor(
    userId: string,
    method: MFAMethodType,
    code: string,
    settings: MFASettings
  ): Promise<boolean> {
    try {
      let verified = false;
      
      switch (method) {
        case 'totp':
          const totpMethod = settings.methods.find(m => m.type === 'totp');
          if (totpMethod?.secret) {
            verified = this.verifyTOTPToken(totpMethod.secret, code);
          }
          break;
          
        case 'sms':
          verified = await this.verifyOTP(userId, code, 'sms');
          break;
          
        case 'email':
          verified = await this.verifyOTP(userId, code, 'email');
          break;
          
        case 'backup_codes':
          if (settings.backupCodes) {
            const result = await this.verifyBackupCode(userId, code, settings.backupCodes);
            verified = result.valid;
            if (verified) {
              settings.backupCodes = result.remainingCodes;
            }
          }
          break;
      }
      
      if (verified) {
        logger.info('Second factor verified', { userId, method });
      } else {
        logger.warn('Second factor verification failed', { userId, method });
      }
      
      return verified;
    } catch (error) {
      logger.error('Second factor verification error', {
        userId,
        method,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Get user MFA settings (placeholder)
   */
  private async getUserMFASettings(userId: string): Promise<MFASettings> {
    // In production, fetch from database
    return {
      userId,
      isEnabled: false,
      methods: [],
      backupCodes: []
    };
  }
  
  /**
   * Generate OTP
   */
  private generateOTP(length: number): string {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    
    return otp;
  }
  
  /**
   * Generate secure backup code
   */
  private generateSecureCode(): string {
    const bytes = crypto.randomBytes(4);
    const code = bytes.toString('hex').toUpperCase();
    return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
  }
  
  /**
   * Store OTP (placeholder)
   */
  private async storeOTP(
    userId: string,
    otp: string,
    type: string,
    ttl: number
  ): Promise<void> {
    // In production, store in Redis with TTL
    logger.debug('OTP stored', { userId, type, ttl });
  }
  
  /**
   * Get stored OTP (placeholder)
   */
  private async getStoredOTP(userId: string, type: string): Promise<string | null> {
    // In production, retrieve from Redis
    return null;
  }
  
  /**
   * Delete stored OTP (placeholder)
   */
  private async deleteStoredOTP(userId: string, type: string): Promise<void> {
    // In production, delete from Redis
    logger.debug('OTP deleted', { userId, type });
  }
  
  /**
   * Send SMS (placeholder)
   */
  private async sendSMS(phoneNumber: string, message: string): Promise<void> {
    // In production, integrate with SMS service (Twilio, AWS SNS, etc.)
    logger.debug('SMS sent', { phoneNumber: this.maskPhone(phoneNumber) });
  }
  
  /**
   * Send email (placeholder)
   */
  private async sendEmail(email: string, subject: string, body: string): Promise<void> {
    // In production, integrate with email service (SendGrid, AWS SES, etc.)
    logger.debug('Email sent', { email: this.maskEmail(email), subject });
  }
  
  /**
   * Mask phone number for logging
   */
  private maskPhone(phone: string): string {
    if (phone.length <= 4) return '****';
    return phone.slice(0, 3) + '****' + phone.slice(-2);
  }
  
  /**
   * Mask email for logging
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '****';
    const maskedLocal = local.length > 2 
      ? local[0] + '***' + local[local.length - 1]
      : '****';
    return `${maskedLocal}@${domain}`;
  }
}