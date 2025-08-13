import { Router } from 'express';
import { body, param, query } from 'express-validator';

import { userController, UserController } from '@/controllers/UserController';
import { passwordController, PasswordController } from '@/controllers/PasswordController';
import { 
  authenticateJWT, 
  optionalAuth, 
  requireAdmin, 
  rateLimit, 
  securityHeaders, 
  anomalyDetection 
} from '@/middleware/authMiddleware';

/**
 * Authentication Routes
 * Handles user registration, login, MFA, password management
 */
export class AuthRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Apply security headers to all routes
    this.router.use(securityHeaders);

    // ==========================================
    // Public Authentication Routes
    // ==========================================

    /**
     * User Registration
     * POST /auth/register
     */
    this.router.post('/register',
      rateLimit('register'),
      UserController.getValidationRules().register,
      userController.register.bind(userController)
    );

    /**
     * User Login
     * POST /auth/login
     */
    this.router.post('/login',
      rateLimit('login'),
      UserController.getValidationRules().login,
      userController.login.bind(userController)
    );

    /**
     * MFA Verification
     * POST /auth/verify-mfa
     */
    this.router.post('/verify-mfa',
      rateLimit('mfa', (req) => req.body.tempToken || req.ip || 'unknown'),
      UserController.getValidationRules().verifyMFA,
      userController.verifyMFA.bind(userController)
    );

    /**
     * Refresh Access Token
     * POST /auth/refresh
     */
    this.router.post('/refresh',
      rateLimit('api'),
      userController.refreshToken.bind(userController)
    );

    /**
     * Email Verification
     * GET /auth/verify-email/:token
     */
    this.router.get('/verify-email/:token',
      param('token').isLength({ min: 32, max: 64 }).withMessage('Valid verification token required'),
      passwordController.verifyEmail.bind(passwordController)
    );

    /**
     * Password Reset Request
     * POST /auth/forgot-password
     */
    this.router.post('/forgot-password',
      rateLimit('password_reset'),
      PasswordController.getValidationRules().forgotPassword,
      passwordController.forgotPassword.bind(passwordController)
    );

    /**
     * Password Reset Verification
     * POST /auth/reset-password
     */
    this.router.post('/reset-password',
      rateLimit('password_reset'),
      PasswordController.getValidationRules().resetPassword,
      passwordController.resetPassword.bind(passwordController)
    );

    /**
     * Check Password Reset Token Validity
     * GET /auth/reset-password/:token
     */
    this.router.get('/reset-password/:token',
      param('token').isLength({ min: 32, max: 64 }).withMessage('Valid reset token required'),
      passwordController.validateResetToken.bind(passwordController)
    );

    // ==========================================
    // Protected Authentication Routes
    // ==========================================

    /**
     * User Logout
     * POST /auth/logout
     */
    this.router.post('/logout',
      authenticateJWT,
      rateLimit('api'),
      userController.logout.bind(userController)
    );

    /**
     * Logout from All Devices
     * POST /auth/logout-all
     */
    this.router.post('/logout-all',
      authenticateJWT,
      rateLimit('api'),
      userController.logoutAll.bind(userController)
    );

    /**
     * Get Current User Profile
     * GET /auth/profile
     */
    this.router.get('/profile',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      userController.getProfile.bind(userController)
    );

    /**
     * Update User Profile
     * PUT /auth/profile
     */
    this.router.put('/profile',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      UserController.getValidationRules().updateProfile,
      userController.updateProfile.bind(userController)
    );

    /**
     * Update User Preferences
     * PUT /auth/preferences
     */
    this.router.put('/preferences',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      this.getPreferencesValidationRules(),
      userController.updatePreferences.bind(userController)
    );

    /**
     * Change Password
     * POST /auth/change-password
     */
    this.router.post('/change-password',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      PasswordController.getValidationRules().changePassword,
      passwordController.changePassword.bind(passwordController)
    );

    // ==========================================
    // MFA Management Routes
    // ==========================================

    /**
     * Setup MFA (TOTP)
     * POST /auth/mfa/setup
     */
    this.router.post('/mfa/setup',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      userController.setupMFA.bind(userController)
    );

    /**
     * Enable MFA
     * POST /auth/mfa/enable
     */
    this.router.post('/mfa/enable',
      authenticateJWT,
      anomalyDetection,
      rateLimit('mfa', (req) => req.user?.id || req.ip || 'unknown'),
      UserController.getValidationRules().enableMFA,
      userController.enableMFA.bind(userController)
    );

    /**
     * Disable MFA
     * POST /auth/mfa/disable
     */
    this.router.post('/mfa/disable',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      UserController.getValidationRules().disableMFA,
      userController.disableMFA.bind(userController)
    );

    /**
     * Get MFA Status
     * GET /auth/mfa/status
     */
    this.router.get('/mfa/status',
      authenticateJWT,
      rateLimit('api'),
      userController.getMFAStatus.bind(userController)
    );

    /**
     * Regenerate MFA Backup Codes
     * POST /auth/mfa/regenerate-backup-codes
     */
    this.router.post('/mfa/regenerate-backup-codes',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      body('currentPassword').notEmpty().withMessage('Current password is required'),
      passwordController.regenerateMFABackupCodes.bind(passwordController)
    );

    /**
     * Send MFA Token via Email
     * POST /auth/mfa/send-email-token
     */
    this.router.post('/mfa/send-email-token',
      authenticateJWT,
      rateLimit('mfa', (req) => req.user?.id || req.ip || 'unknown'),
      passwordController.sendMFAEmailToken.bind(passwordController)
    );

    // ==========================================
    // Session Management Routes
    // ==========================================

    /**
     * Get Active Sessions
     * GET /auth/sessions
     */
    this.router.get('/sessions',
      authenticateJWT,
      rateLimit('api'),
      passwordController.getActiveSessions.bind(passwordController)
    );

    /**
     * Revoke Specific Session
     * DELETE /auth/sessions/:sessionId
     */
    this.router.delete('/sessions/:sessionId',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      param('sessionId').isUUID().withMessage('Valid session ID required'),
      passwordController.revokeSession.bind(passwordController)
    );

    // ==========================================
    // Account Security Routes
    // ==========================================

    /**
     * Get Security Events
     * GET /auth/security/events
     */
    this.router.get('/security/events',
      authenticateJWT,
      rateLimit('api'),
      query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
      query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
      query('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level'),
      passwordController.getSecurityEvents.bind(passwordController)
    );

    /**
     * Get Account Activity Log
     * GET /auth/activity
     */
    this.router.get('/activity',
      authenticateJWT,
      rateLimit('api'),
      query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
      query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
      query('action').optional().isString().withMessage('Action must be a string'),
      passwordController.getAccountActivity.bind(passwordController)
    );

    /**
     * Export User Data (GDPR)
     * POST /auth/export-data
     */
    this.router.post('/export-data',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      body('currentPassword').notEmpty().withMessage('Current password is required'),
      body('includePersonalData').optional().isBoolean().withMessage('Include personal data must be boolean'),
      body('includeActivityLogs').optional().isBoolean().withMessage('Include activity logs must be boolean'),
      passwordController.exportUserData.bind(passwordController)
    );

    /**
     * Delete Account (GDPR)
     * DELETE /auth/account
     */
    this.router.delete('/account',
      authenticateJWT,
      anomalyDetection,
      rateLimit('api'),
      body('currentPassword').notEmpty().withMessage('Current password is required'),
      body('confirmDeletion').equals('DELETE_MY_ACCOUNT').withMessage('Confirmation text must be "DELETE_MY_ACCOUNT"'),
      body('reason').optional().isString().withMessage('Reason must be a string'),
      passwordController.deleteAccount.bind(passwordController)
    );

    // ==========================================
    // Admin Routes
    // ==========================================

    /**
     * Get All Users (Admin)
     * GET /auth/admin/users
     */
    this.router.get('/admin/users',
      authenticateJWT,
      requireAdmin,
      rateLimit('api'),
      query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
      query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
      query('search').optional().isString().withMessage('Search must be a string'),
      query('role').optional().isIn(['user', 'moderator', 'admin', 'system']).withMessage('Invalid role'),
      query('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
      userController.getAllUsers.bind(userController)
    );

    /**
     * Get User by ID (Admin)
     * GET /auth/admin/users/:userId
     */
    this.router.get('/admin/users/:userId',
      authenticateJWT,
      requireAdmin,
      rateLimit('api'),
      param('userId').isUUID().withMessage('Valid user ID required'),
      userController.getUserById.bind(userController)
    );

    /**
     * Update User Role (Admin)
     * PUT /auth/admin/users/:userId/role
     */
    this.router.put('/admin/users/:userId/role',
      authenticateJWT,
      requireAdmin,
      anomalyDetection,
      rateLimit('api'),
      UserController.getValidationRules().updateUserRole,
      userController.updateUserRole.bind(userController)
    );

    /**
     * Lock/Unlock User Account (Admin)
     * PUT /auth/admin/users/:userId/lock
     */
    this.router.put('/admin/users/:userId/lock',
      authenticateJWT,
      requireAdmin,
      anomalyDetection,
      rateLimit('api'),
      param('userId').isUUID().withMessage('Valid user ID required'),
      body('isLocked').isBoolean().withMessage('isLocked must be boolean'),
      body('reason').optional().isString().withMessage('Reason must be a string'),
      passwordController.lockUnlockUser.bind(passwordController)
    );

    /**
     * Reset User Password (Admin)
     * POST /auth/admin/users/:userId/reset-password
     */
    this.router.post('/admin/users/:userId/reset-password',
      authenticateJWT,
      requireAdmin,
      anomalyDetection,
      rateLimit('api'),
      param('userId').isUUID().withMessage('Valid user ID required'),
      body('temporaryPassword').isLength({ min: 8 }).withMessage('Temporary password must be at least 8 characters'),
      body('requirePasswordChange').optional().isBoolean().withMessage('Require password change must be boolean'),
      passwordController.adminResetPassword.bind(passwordController)
    );

    /**
     * Get System Security Events (Admin)
     * GET /auth/admin/security/events
     */
    this.router.get('/admin/security/events',
      authenticateJWT,
      requireAdmin,
      rateLimit('api'),
      query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
      query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
      query('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level'),
      query('type').optional().isString().withMessage('Type must be a string'),
      query('userId').optional().isUUID().withMessage('Valid user ID required'),
      passwordController.getSystemSecurityEvents.bind(passwordController)
    );
  }

  /**
   * Get user preferences validation rules
   */
  private getPreferencesValidationRules() {
    return [
      // Notification preferences
      body('notifications.email').optional().isBoolean().withMessage('Email notifications must be boolean'),
      body('notifications.sms').optional().isBoolean().withMessage('SMS notifications must be boolean'),
      body('notifications.push').optional().isBoolean().withMessage('Push notifications must be boolean'),
      body('notifications.callSummary').optional().isBoolean().withMessage('Call summary notifications must be boolean'),
      body('notifications.securityAlerts').optional().isBoolean().withMessage('Security alerts must be boolean'),
      body('notifications.weeklyReport').optional().isBoolean().withMessage('Weekly report must be boolean'),

      // Privacy preferences
      body('privacy.recordCalls').optional().isBoolean().withMessage('Record calls must be boolean'),
      body('privacy.shareAnalytics').optional().isBoolean().withMessage('Share analytics must be boolean'),
      body('privacy.dataRetentionDays').optional().isInt({ min: 1, max: 365 }).withMessage('Data retention days must be between 1 and 365'),
      body('privacy.allowPersonalization').optional().isBoolean().withMessage('Allow personalization must be boolean'),

      // Call handling preferences
      body('callHandling.maxDuration').optional().isInt({ min: 30, max: 600 }).withMessage('Max duration must be between 30 and 600 seconds'),
      body('callHandling.autoTerminate').optional().isBoolean().withMessage('Auto terminate must be boolean'),
      body('callHandling.whitelistMode').optional().isIn(['strict', 'moderate', 'permissive']).withMessage('Invalid whitelist mode'),
      body('callHandling.blockUnknown').optional().isBoolean().withMessage('Block unknown must be boolean'),

      // AI preferences
      body('ai.personality').optional().isIn(['polite', 'direct', 'humorous', 'professional', 'custom']).withMessage('Invalid AI personality'),
      body('ai.responseStyle').optional().isIn(['formal', 'casual', 'friendly', 'business']).withMessage('Invalid response style'),
      body('ai.aggressiveness').optional().isIn(['passive', 'moderate', 'assertive']).withMessage('Invalid aggressiveness level'),
      body('ai.learningEnabled').optional().isBoolean().withMessage('Learning enabled must be boolean'),

      // Security preferences
      body('security.mfaEnabled').optional().isBoolean().withMessage('MFA enabled must be boolean'),
      body('security.sessionTimeout').optional().isInt({ min: 300000, max: 86400000 }).withMessage('Session timeout must be between 5 minutes and 24 hours'),
      body('security.loginNotifications').optional().isBoolean().withMessage('Login notifications must be boolean'),
      body('security.deviceTracking').optional().isBoolean().withMessage('Device tracking must be boolean')
    ];
  }

  /**
   * Get the router instance
   */
  public getRouter(): Router {
    return this.router;
  }
}

// Export singleton instance
export const authRoutes = new AuthRoutes();
export default authRoutes.getRouter();