import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import argon2 from 'argon2';
import zxcvbn from 'zxcvbn';
import crypto from 'crypto';

import { config } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from '@/services/database';
import { EmailService } from '@/services/email';
import { AuditService } from '@/services/audit';
import { MFAService } from '@/services/mfa';
import { RedisService } from '@/services/redis';
import {
  User,
  AuthenticatedRequest,
  AdminRequest,
  PasswordResetRequest,
  EmailVerificationRequest,
  UserSession,
  AuditLog,
  SecurityEvent,
  ValidationError,
  ApiResponse
} from '@/types';

/**
 * Password and Security Management Controller
 * Handles password operations, security events, session management
 */
export class PasswordController {
  private db: DatabaseService;
  private emailService: EmailService;
  private auditService: AuditService;
  private mfaService: MFAService;
  private redis: RedisService;

  constructor() {
    this.db = new DatabaseService();
    this.emailService = new EmailService();
    this.auditService = new AuditService();
    this.mfaService = new MFAService();
    this.redis = new RedisService();
  }

  // ==========================================
  // Password Management
  // ==========================================

  /**
   * Change user password
   */
  async changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { currentPassword, newPassword } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Get user with current password
      const user = await this.db.getUserById(req.user.id);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      // Verify current password
      const isCurrentPasswordValid = await argon2.verify(user.passwordHash, currentPassword);
      if (!isCurrentPasswordValid) {
        await this.auditService.log({
          userId: req.user.id,
          action: 'password_change',
          resource: 'user',
          details: { success: false, reason: 'invalid_current_password' },
          ipAddress,
          userAgent,
          success: false
        });

        res.status(400).json({
          success: false,
          message: 'Current password is incorrect',
          code: 'INVALID_CURRENT_PASSWORD'
        });
        return;
      }

      // Check if new password is same as current
      const isSamePassword = await argon2.verify(user.passwordHash, newPassword);
      if (isSamePassword) {
        res.status(400).json({
          success: false,
          message: 'New password must be different from current password',
          code: 'SAME_PASSWORD'
        });
        return;
      }

      // Validate new password strength
      const passwordStrength = zxcvbn(newPassword);
      if (passwordStrength.score < 2) {
        res.status(400).json({
          success: false,
          message: 'New password is too weak',
          code: 'WEAK_PASSWORD',
          details: {
            suggestions: passwordStrength.feedback.suggestions,
            warning: passwordStrength.feedback.warning
          }
        });
        return;
      }

      // Hash new password
      const newPasswordHash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });

      // Update password in database
      await this.db.updateUserPassword(req.user.id, newPasswordHash);

      // Revoke all existing sessions except current one
      if (req.session) {
        await this.db.revokeUserSessionsExcept(req.user.id, req.session.id);
      }

      // Log password change
      await this.auditService.log({
        userId: req.user.id,
        action: 'password_change',
        resource: 'user',
        details: { success: true },
        ipAddress,
        userAgent,
        success: true
      });

      // Send notification email
      if (user.email) {
        await this.emailService.sendPasswordChangeNotification(user);
      }

      logger.info('Password changed successfully', {
        userId: req.user.id,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Password change failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to change password',
        code: 'PASSWORD_CHANGE_ERROR'
      });
    }
  }

  /**
   * Forgot password - send reset email
   */
  async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { emailOrPhone } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Find user by email or phone
      const user = await this.db.getUserByEmailOrPhone(emailOrPhone);
      
      // Always return success to prevent user enumeration
      const successResponse = {
        success: true,
        message: 'If an account with that email/phone exists, a password reset link has been sent.'
      };

      if (!user) {
        // Log attempt for security monitoring
        await this.auditService.logSecurityEvent({
          type: 'password_reset_attempt',
          severity: 'low',
          details: {
            emailOrPhone: emailOrPhone.includes('@') ? 'email' : 'phone',
            found: false,
            ipAddress
          },
          timestamp: new Date()
        });

        res.status(200).json(successResponse);
        return;
      }

      if (!user.email) {
        res.status(400).json({
          success: false,
          message: 'Password reset is only available for accounts with email addresses',
          code: 'NO_EMAIL_CONFIGURED'
        });
        return;
      }

      // Check for existing reset request
      const existingRequest = await this.db.getActivePasswordResetRequest(user.id);
      if (existingRequest) {
        const timeSinceLastRequest = Date.now() - existingRequest.createdAt.getTime();
        if (timeSinceLastRequest < 300000) { // 5 minutes
          res.status(429).json({
            success: false,
            message: 'Please wait before requesting another password reset',
            code: 'RESET_REQUEST_TOO_SOON'
          });
          return;
        }
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
      
      // Save reset request to database
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour
      await this.db.createPasswordResetRequest({
        userId: user.id,
        token: hashedToken,
        expiresAt
      });

      // Send reset email
      await this.emailService.sendPasswordResetEmail(user, resetToken);

      // Log password reset request
      await this.auditService.log({
        userId: user.id,
        action: 'password_reset',
        resource: 'user',
        details: { requested: true },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('Password reset requested', {
        userId: user.id,
        ipAddress
      });

      res.status(200).json(successResponse);

    } catch (error) {
      logger.error('Forgot password failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to process password reset request',
        code: 'PASSWORD_RESET_ERROR'
      });
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { token, newPassword } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Hash the provided token
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Find reset request
      const resetRequest = await this.db.getPasswordResetRequest(hashedToken);
      if (!resetRequest || resetRequest.isUsed || resetRequest.expiresAt < new Date()) {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired password reset token',
          code: 'INVALID_RESET_TOKEN'
        });
        return;
      }

      // Get user
      const user = await this.db.getUserById(resetRequest.userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      // Validate new password strength
      const passwordStrength = zxcvbn(newPassword);
      if (passwordStrength.score < 2) {
        res.status(400).json({
          success: false,
          message: 'Password is too weak',
          code: 'WEAK_PASSWORD',
          details: {
            suggestions: passwordStrength.feedback.suggestions,
            warning: passwordStrength.feedback.warning
          }
        });
        return;
      }

      // Check if new password is same as current
      const isSamePassword = await argon2.verify(user.passwordHash, newPassword);
      if (isSamePassword) {
        res.status(400).json({
          success: false,
          message: 'New password must be different from current password',
          code: 'SAME_PASSWORD'
        });
        return;
      }

      // Hash new password
      const newPasswordHash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });

      // Update password and mark reset request as used
      await Promise.all([
        this.db.updateUserPassword(user.id, newPasswordHash),
        this.db.markPasswordResetRequestAsUsed(resetRequest.id),
        this.db.revokeAllUserSessions(user.id) // Revoke all sessions for security
      ]);

      // Log password reset completion
      await this.auditService.log({
        userId: user.id,
        action: 'password_reset',
        resource: 'user',
        details: { completed: true },
        ipAddress,
        userAgent,
        success: true
      });

      // Send notification email
      if (user.email) {
        await this.emailService.sendPasswordResetConfirmation(user);
      }

      logger.info('Password reset completed', {
        userId: user.id,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Password has been reset successfully'
      });

    } catch (error) {
      logger.error('Password reset failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to reset password',
        code: 'PASSWORD_RESET_ERROR'
      });
    }
  }

  /**
   * Validate password reset token
   */
  async validateResetToken(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      
      // Hash the provided token
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Find reset request
      const resetRequest = await this.db.getPasswordResetRequest(hashedToken);
      const isValid = resetRequest && !resetRequest.isUsed && resetRequest.expiresAt > new Date();

      res.status(200).json({
        success: true,
        data: {
          isValid,
          expiresAt: resetRequest?.expiresAt
        }
      });

    } catch (error) {
      logger.error('Reset token validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to validate reset token',
        code: 'TOKEN_VALIDATION_ERROR'
      });
    }
  }

  // ==========================================
  // Email Verification
  // ==========================================

  /**
   * Verify email address
   */
  async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Hash the provided token
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Find verification request
      const verificationRequest = await this.db.getEmailVerificationRequest(hashedToken);
      if (!verificationRequest || verificationRequest.isUsed || verificationRequest.expiresAt < new Date()) {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired email verification token',
          code: 'INVALID_VERIFICATION_TOKEN'
        });
        return;
      }

      // Update user email verification status
      await Promise.all([
        this.db.markEmailAsVerified(verificationRequest.userId),
        this.db.markEmailVerificationAsUsed(verificationRequest.id)
      ]);

      // Log email verification
      await this.auditService.log({
        userId: verificationRequest.userId,
        action: 'email_verification',
        resource: 'user',
        details: { verified: true },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('Email verified successfully', {
        userId: verificationRequest.userId,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Email verified successfully'
      });

    } catch (error) {
      logger.error('Email verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to verify email',
        code: 'EMAIL_VERIFICATION_ERROR'
      });
    }
  }

  // ==========================================
  // MFA Management
  // ==========================================

  /**
   * Regenerate MFA backup codes
   */
  async regenerateMFABackupCodes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { currentPassword } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const backupCodes = await this.mfaService.regenerateBackupCodes(
        req.user.id,
        currentPassword,
        ipAddress,
        userAgent
      );

      res.status(200).json({
        success: true,
        message: 'Backup codes regenerated successfully',
        data: {
          backupCodes
        }
      });

    } catch (error) {
      logger.error('MFA backup codes regeneration failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to regenerate backup codes',
        code: 'MFA_BACKUP_CODES_ERROR'
      });
    }
  }

  /**
   * Send MFA token via email
   */
  async sendMFAEmailToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      await this.mfaService.sendEmailToken(req.user.id);

      res.status(200).json({
        success: true,
        message: 'MFA token sent to your email'
      });

    } catch (error) {
      logger.error('Send MFA email token failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to send MFA token',
        code: 'MFA_EMAIL_TOKEN_ERROR'
      });
    }
  }

  // ==========================================
  // Session Management
  // ==========================================

  /**
   * Get active sessions
   */
  async getActiveSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const sessions = await this.db.getActiveUserSessions(req.user.id);

      // Sanitize session data
      const sanitizedSessions = sessions.map(session => ({
        id: session.id,
        deviceInfo: session.deviceInfo,
        ipAddress: session.ipAddress,
        lastActivityAt: session.lastActivityAt,
        createdAt: session.createdAt,
        isCurrent: session.id === req.session?.id
      }));

      res.status(200).json({
        success: true,
        data: {
          sessions: sanitizedSessions
        }
      });

    } catch (error) {
      logger.error('Get active sessions failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get active sessions',
        code: 'GET_SESSIONS_ERROR'
      });
    }
  }

  /**
   * Revoke specific session
   */
  async revokeSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Verify session belongs to user
      const session = await this.db.getUserSession(sessionId);
      if (!session || session.userId !== req.user.id) {
        res.status(404).json({
          success: false,
          message: 'Session not found',
          code: 'SESSION_NOT_FOUND'
        });
        return;
      }

      // Revoke session
      await this.db.revokeUserSession(sessionId);

      // Log session revocation
      await this.auditService.log({
        userId: req.user.id,
        action: 'session_revoked',
        resource: 'session',
        details: { sessionId, targetSessionId: sessionId },
        ipAddress,
        userAgent,
        success: true
      });

      res.status(200).json({
        success: true,
        message: 'Session revoked successfully'
      });

    } catch (error) {
      logger.error('Revoke session failed', {
        userId: req.user?.id,
        sessionId: req.params.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to revoke session',
        code: 'REVOKE_SESSION_ERROR'
      });
    }
  }

  // ==========================================
  // Security and Activity Logs
  // ==========================================

  /**
   * Get security events for user
   */
  async getSecurityEvents(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const severity = req.query.severity as string;

      const result = await this.auditService.getSecurityEvents(req.user.id, {
        page,
        limit,
        severity
      });

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get security events failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get security events',
        code: 'GET_SECURITY_EVENTS_ERROR'
      });
    }
  }

  /**
   * Get account activity log
   */
  async getAccountActivity(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const action = req.query.action as string;

      const result = await this.auditService.getAuditLogs(req.user.id, {
        page,
        limit,
        action
      });

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get account activity failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get account activity',
        code: 'GET_ACTIVITY_ERROR'
      });
    }
  }

  // ==========================================
  // GDPR and Data Management
  // ==========================================

  /**
   * Export user data
   */
  async exportUserData(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { currentPassword, includePersonalData = true, includeActivityLogs = true } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Verify current password
      const user = await this.db.getUserById(req.user.id);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      const isPasswordValid = await argon2.verify(user.passwordHash, currentPassword);
      if (!isPasswordValid) {
        res.status(400).json({
          success: false,
          message: 'Current password is incorrect',
          code: 'INVALID_PASSWORD'
        });
        return;
      }

      // Generate export data
      const exportData = await this.generateUserDataExport(req.user.id, includePersonalData, includeActivityLogs);

      // Log data export
      await this.auditService.log({
        userId: req.user.id,
        action: 'data_export',
        resource: 'user',
        details: { includePersonalData, includeActivityLogs },
        ipAddress,
        userAgent,
        success: true
      });

      res.status(200).json({
        success: true,
        message: 'User data exported successfully',
        data: exportData
      });

    } catch (error) {
      logger.error('Export user data failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to export user data',
        code: 'DATA_EXPORT_ERROR'
      });
    }
  }

  /**
   * Delete user account
   */
  async deleteAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { currentPassword, reason } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Verify current password
      const user = await this.db.getUserById(req.user.id);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      const isPasswordValid = await argon2.verify(user.passwordHash, currentPassword);
      if (!isPasswordValid) {
        res.status(400).json({
          success: false,
          message: 'Current password is incorrect',
          code: 'INVALID_PASSWORD'
        });
        return;
      }

      // Log account deletion request
      await this.auditService.log({
        userId: req.user.id,
        action: 'data_deletion',
        resource: 'user',
        details: { reason },
        ipAddress,
        userAgent,
        success: true
      });

      // Schedule account deletion (GDPR compliance)
      await this.db.scheduleAccountDeletion(req.user.id, reason);

      // Send confirmation email
      if (user.email) {
        await this.emailService.sendAccountDeletionConfirmation(user);
      }

      logger.info('Account deletion requested', {
        userId: req.user.id,
        reason,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Account deletion has been scheduled. You will receive a confirmation email.'
      });

    } catch (error) {
      logger.error('Delete account failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to delete account',
        code: 'ACCOUNT_DELETION_ERROR'
      });
    }
  }

  // ==========================================
  // Admin Operations
  // ==========================================

  /**
   * Lock/unlock user account (admin)
   */
  async lockUnlockUser(req: AdminRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { userId } = req.params;
      const { isLocked, reason } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Update user lock status
      await this.db.updateUserLockStatus(userId, isLocked, reason);

      // If locking, revoke all user sessions
      if (isLocked) {
        await this.db.revokeAllUserSessions(userId);
      }

      // Log admin action
      await this.auditService.log({
        userId: req.user.id,
        action: isLocked ? 'account_lock' : 'account_unlock',
        resource: 'user',
        details: { targetUserId: userId, reason },
        ipAddress,
        userAgent,
        success: true
      });

      res.status(200).json({
        success: true,
        message: `Account ${isLocked ? 'locked' : 'unlocked'} successfully`
      });

    } catch (error) {
      logger.error('Lock/unlock user failed', {
        adminId: req.user?.id,
        targetUserId: req.params.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to update account lock status',
        code: 'LOCK_UNLOCK_ERROR'
      });
    }
  }

  /**
   * Admin password reset
   */
  async adminResetPassword(req: AdminRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array() as ValidationError[]
        });
        return;
      }

      const { userId } = req.params;
      const { temporaryPassword, requirePasswordChange = true } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Hash temporary password
      const passwordHash = await argon2.hash(temporaryPassword, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });

      // Update user password
      await this.db.adminResetUserPassword(userId, passwordHash, requirePasswordChange);

      // Revoke all user sessions
      await this.db.revokeAllUserSessions(userId);

      // Log admin action
      await this.auditService.log({
        userId: req.user.id,
        action: 'admin_password_reset',
        resource: 'user',
        details: { targetUserId: userId, requirePasswordChange },
        ipAddress,
        userAgent,
        success: true
      });

      // Send notification to user
      const user = await this.db.getUserById(userId);
      if (user?.email) {
        await this.emailService.sendAdminPasswordResetNotification(user, temporaryPassword);
      }

      res.status(200).json({
        success: true,
        message: 'Password reset successfully'
      });

    } catch (error) {
      logger.error('Admin password reset failed', {
        adminId: req.user?.id,
        targetUserId: req.params.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to reset password',
        code: 'ADMIN_PASSWORD_RESET_ERROR'
      });
    }
  }

  /**
   * Get system security events (admin)
   */
  async getSystemSecurityEvents(req: AdminRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const severity = req.query.severity as string;
      const type = req.query.type as string;
      const userId = req.query.userId as string;

      const result = await this.auditService.getSystemSecurityEvents({
        page,
        limit,
        severity,
        type,
        userId
      });

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get system security events failed', {
        adminId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get system security events',
        code: 'GET_SYSTEM_SECURITY_EVENTS_ERROR'
      });
    }
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Generate user data export
   */
  private async generateUserDataExport(
    userId: string, 
    includePersonalData: boolean, 
    includeActivityLogs: boolean
  ): Promise<any> {
    const exportData: any = {
      exportedAt: new Date().toISOString(),
      userId
    };

    if (includePersonalData) {
      const user = await this.db.getUserById(userId);
      if (user) {
        exportData.personalData = {
          phoneNumber: user.phoneNumber,
          name: user.name,
          email: user.email,
          personality: user.personality,
          languagePreference: user.languagePreference,
          timezone: user.timezone,
          preferences: user.preferences,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt
        };
      }

      // Get MFA settings
      const mfaStatus = await this.mfaService.getMFAStatus(userId);
      exportData.securitySettings = {
        mfaEnabled: mfaStatus.isEnabled,
        mfaMethod: mfaStatus.method,
        lastMFAUsed: mfaStatus.lastUsedAt
      };
    }

    if (includeActivityLogs) {
      // Get recent audit logs
      const auditLogs = await this.auditService.getAuditLogs(userId, { page: 1, limit: 1000 });
      exportData.activityLogs = auditLogs.logs;

      // Get security events
      const securityEvents = await this.auditService.getSecurityEvents(userId, { page: 1, limit: 1000 });
      exportData.securityEvents = securityEvents.events;

      // Get session history
      const sessions = await this.db.getRecentUserSessions(userId, 30); // Last 30 days
      exportData.sessionHistory = sessions.map(session => ({
        deviceInfo: session.deviceInfo,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt
      }));
    }

    return exportData;
  }

  // ==========================================
  // Validation Rules
  // ==========================================

  static getValidationRules() {
    return {
      changePassword: [
        body('currentPassword')
          .notEmpty()
          .withMessage('Current password is required'),
        body('newPassword')
          .isLength({ min: 8 })
          .withMessage('New password must be at least 8 characters long')
      ],

      forgotPassword: [
        body('emailOrPhone')
          .notEmpty()
          .withMessage('Email or phone number is required')
      ],

      resetPassword: [
        body('token')
          .isLength({ min: 32, max: 64 })
          .withMessage('Valid reset token is required'),
        body('newPassword')
          .isLength({ min: 8 })
          .withMessage('New password must be at least 8 characters long')
      ]
    };
  }
}

// Export singleton instance
export const passwordController = new PasswordController();