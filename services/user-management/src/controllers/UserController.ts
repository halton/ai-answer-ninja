import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import argon2 from 'argon2';
import zxcvbn from 'zxcvbn';

import { config } from '@/config';
import { logger } from '@/utils/logger';
import { AuthService } from '@/services/auth';
import { MFAService } from '@/services/mfa';
import { DatabaseService } from '@/services/database';
import { EmailService } from '@/services/email';
import { AuditService } from '@/services/audit';
import { UserProfileService } from '@/services/userProfile';
import { permissionManager } from '@/auth/PermissionManager';
import {
  User,
  CreateUserData,
  UpdateUserData,
  LoginCredentials,
  AuthTokens,
  ApiResponse,
  AuthenticatedRequest,
  AdminRequest,
  MFAVerificationData,
  UserPreferences,
  ValidationError
} from '@/types';

/**
 * User Management Controller
 * Handles user registration, authentication, profile management, and admin operations
 */
export class UserController {
  private authService: AuthService;
  private mfaService: MFAService;
  private db: DatabaseService;
  private emailService: EmailService;
  private auditService: AuditService;
  private userProfileService: UserProfileService;

  constructor() {
    this.authService = new AuthService();
    this.mfaService = new MFAService();
    this.db = new DatabaseService();
    this.emailService = new EmailService();
    this.auditService = new AuditService();
    this.userProfileService = new UserProfileService();
  }

  // ==========================================
  // Authentication Endpoints
  // ==========================================

  /**
   * User registration
   */
  async register(req: Request, res: Response): Promise<void> {
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

      const {
        phoneNumber,
        name,
        email,
        password,
        personality,
        languagePreference,
        timezone,
        preferences
      }: CreateUserData = req.body;

      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Check if user already exists
      const existingUser = await this.db.getUserByPhoneNumber(phoneNumber);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: 'User already exists with this phone number',
          code: 'USER_EXISTS'
        });
        return;
      }

      // Check email if provided
      if (email) {
        const existingEmailUser = await this.db.getUserByEmail(email);
        if (existingEmailUser) {
          res.status(400).json({
            success: false,
            message: 'User already exists with this email',
            code: 'EMAIL_EXISTS'
          });
          return;
        }
      }

      // Validate password strength
      const passwordStrength = zxcvbn(password);
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

      // Hash password
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });

      // Create user
      const userData: CreateUserData & { passwordHash: string } = {
        phoneNumber,
        name,
        email,
        password, // Will be replaced with passwordHash
        passwordHash,
        personality: personality || 'polite',
        languagePreference: languagePreference || 'zh-CN',
        timezone: timezone || 'Asia/Shanghai',
        preferences: {
          notifications: {
            email: true,
            sms: false,
            push: true,
            callSummary: true,
            securityAlerts: true,
            weeklyReport: true
          },
          privacy: {
            recordCalls: true,
            shareAnalytics: false,
            dataRetentionDays: 30,
            allowPersonalization: true
          },
          callHandling: {
            maxDuration: 180,
            autoTerminate: true,
            whitelistMode: 'moderate',
            blockUnknown: false,
            customResponses: []
          },
          ai: {
            personality: personality || 'polite',
            responseStyle: 'friendly',
            aggressiveness: 'moderate',
            learningEnabled: true
          },
          security: {
            mfaEnabled: false,
            sessionTimeout: 3600000, // 1 hour
            loginNotifications: true,
            deviceTracking: true
          },
          ...preferences
        }
      };

      const user = await this.db.createUser(userData);

      // Send welcome email if email provided
      if (email) {
        await this.emailService.sendWelcomeEmail(user);
      }

      // Log registration
      await this.auditService.log({
        userId: user.id,
        action: 'register',
        resource: 'user',
        details: { phoneNumber: phoneNumber.substring(0, 3) + '***' },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('User registered successfully', {
        userId: user.id,
        phoneNumber: phoneNumber.substring(0, 3) + '***',
        ipAddress
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: this.sanitizeUser(user),
          requiresEmailVerification: !!email
        }
      });

    } catch (error) {
      logger.error('User registration failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        phoneNumber: req.body.phoneNumber?.substring(0, 3) + '***'
      });

      res.status(500).json({
        success: false,
        message: 'Registration failed',
        code: 'REGISTRATION_ERROR'
      });
    }
  }

  /**
   * User login
   */
  async login(req: Request, res: Response): Promise<void> {
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

      const credentials: LoginCredentials = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const result = await this.authService.login(credentials, ipAddress, userAgent);

      if (result.requiresMFA) {
        res.status(200).json({
          success: true,
          message: 'MFA verification required',
          data: {
            tempToken: result.tokens.accessToken,
            requiresMFA: true,
            user: result.user
          }
        });
        return;
      }

      // Set secure HTTP-only cookie for refresh token
      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: result.user,
          accessToken: result.tokens.accessToken,
          expiresIn: result.tokens.expiresIn
        }
      });

    } catch (error) {
      logger.error('Login failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        phoneNumber: req.body.phoneNumber?.substring(0, 3) + '***'
      });

      res.status(401).json({
        success: false,
        message: 'Login failed',
        code: 'AUTHENTICATION_FAILED'
      });
    }
  }

  /**
   * MFA verification
   */
  async verifyMFA(req: Request, res: Response): Promise<void> {
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

      const { tempToken, mfaCode, deviceFingerprint, rememberMe } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const result = await this.authService.verifyMFAAndCompleteLogin(
        tempToken,
        mfaCode,
        ipAddress,
        userAgent,
        deviceFingerprint,
        rememberMe
      );

      // Set secure HTTP-only cookie for refresh token
      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
      });

      res.status(200).json({
        success: true,
        message: 'MFA verification successful',
        data: {
          user: result.user,
          accessToken: result.tokens.accessToken,
          expiresIn: result.tokens.expiresIn
        }
      });

    } catch (error) {
      logger.error('MFA verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(401).json({
        success: false,
        message: 'MFA verification failed',
        code: 'MFA_VERIFICATION_FAILED'
      });
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
      
      if (!refreshToken) {
        res.status(401).json({
          success: false,
          message: 'Refresh token required',
          code: 'REFRESH_TOKEN_REQUIRED'
        });
        return;
      }

      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const tokens = await this.authService.refreshToken(refreshToken, ipAddress, userAgent);

      // Update refresh token cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000
      });

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn
        }
      });

    } catch (error) {
      logger.error('Token refresh failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(401).json({
        success: false,
        message: 'Token refresh failed',
        code: 'TOKEN_REFRESH_FAILED'
      });
    }
  }

  /**
   * User logout
   */
  async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const refreshToken = req.cookies.refreshToken;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (refreshToken) {
        await this.authService.logout(refreshToken, ipAddress, userAgent);
      }

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      logger.error('Logout failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Logout failed',
        code: 'LOGOUT_ERROR'
      });
    }
  }

  /**
   * Logout from all devices
   */
  async logoutAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      await this.authService.logoutAll(req.user.id, ipAddress, userAgent);

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      res.status(200).json({
        success: true,
        message: 'Logged out from all devices successfully'
      });

    } catch (error) {
      logger.error('Logout all failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Logout all failed',
        code: 'LOGOUT_ALL_ERROR'
      });
    }
  }

  // ==========================================
  // Profile Management Endpoints
  // ==========================================

  /**
   * Get current user profile
   */
  async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const user = await this.db.getUserById(req.user.id);
      
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          user: this.sanitizeUser(user)
        }
      });

    } catch (error) {
      logger.error('Get profile failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get profile',
        code: 'GET_PROFILE_ERROR'
      });
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
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

      const updateData: UpdateUserData = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Check if email is being changed and if it's already taken
      if (updateData.email) {
        const existingUser = await this.db.getUserByEmail(updateData.email);
        if (existingUser && existingUser.id !== req.user.id) {
          res.status(400).json({
            success: false,
            message: 'Email already in use',
            code: 'EMAIL_TAKEN'
          });
          return;
        }
      }

      const updatedUser = await this.db.updateUser(req.user.id, updateData);

      // Log profile update
      await this.auditService.log({
        userId: req.user.id,
        action: 'profile_update',
        resource: 'user',
        details: { updatedFields: Object.keys(updateData) },
        ipAddress,
        userAgent,
        success: true
      });

      // Send email notification if email was changed
      if (updateData.email && updateData.email !== req.user.email) {
        await this.emailService.sendEmailChangeNotification(updatedUser);
      }

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: this.sanitizeUser(updatedUser)
        }
      });

    } catch (error) {
      logger.error('Update profile failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        code: 'UPDATE_PROFILE_ERROR'
      });
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(req: AuthenticatedRequest, res: Response): Promise<void> {
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

      const preferences: Partial<UserPreferences> = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const updatedUser = await this.userProfileService.updatePreferences(req.user.id, preferences);

      // Log preferences update
      await this.auditService.log({
        userId: req.user.id,
        action: 'preferences_update',
        resource: 'user',
        details: { updatedSections: Object.keys(preferences) },
        ipAddress,
        userAgent,
        success: true
      });

      res.status(200).json({
        success: true,
        message: 'Preferences updated successfully',
        data: {
          preferences: updatedUser.preferences
        }
      });

    } catch (error) {
      logger.error('Update preferences failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to update preferences',
        code: 'UPDATE_PREFERENCES_ERROR'
      });
    }
  }

  // ==========================================
  // MFA Management Endpoints
  // ==========================================

  /**
   * Setup MFA
   */
  async setupMFA(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mfaSetup = await this.mfaService.setupTOTP(req.user.id);

      res.status(200).json({
        success: true,
        message: 'MFA setup initiated',
        data: mfaSetup
      });

    } catch (error) {
      logger.error('MFA setup failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'MFA setup failed',
        code: 'MFA_SETUP_ERROR'
      });
    }
  }

  /**
   * Verify and enable MFA
   */
  async enableMFA(req: AuthenticatedRequest, res: Response): Promise<void> {
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

      const { token } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const result = await this.mfaService.verifyAndEnableTOTP(
        req.user.id,
        token,
        ipAddress,
        userAgent
      );

      res.status(200).json({
        success: true,
        message: 'MFA enabled successfully',
        data: {
          backupCodes: result.backupCodes
        }
      });

    } catch (error) {
      logger.error('MFA enable failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'MFA enable failed',
        code: 'MFA_ENABLE_ERROR'
      });
    }
  }

  /**
   * Disable MFA
   */
  async disableMFA(req: AuthenticatedRequest, res: Response): Promise<void> {
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

      await this.mfaService.disableMFA(req.user.id, currentPassword, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: 'MFA disabled successfully'
      });

    } catch (error) {
      logger.error('MFA disable failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'MFA disable failed',
        code: 'MFA_DISABLE_ERROR'
      });
    }
  }

  /**
   * Get MFA status
   */
  async getMFAStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mfaStatus = await this.mfaService.getMFAStatus(req.user.id);

      res.status(200).json({
        success: true,
        data: mfaStatus
      });

    } catch (error) {
      logger.error('Get MFA status failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get MFA status',
        code: 'GET_MFA_STATUS_ERROR'
      });
    }
  }

  // ==========================================
  // Admin Endpoints
  // ==========================================

  /**
   * Get all users (admin only)
   */
  async getAllUsers(req: AdminRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const role = req.query.role as string;
      const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

      const result = await this.db.getAllUsers({
        page,
        limit,
        search,
        role,
        isActive
      });

      res.status(200).json({
        success: true,
        data: {
          users: result.users.map(user => this.sanitizeUser(user)),
          pagination: result.pagination
        }
      });

    } catch (error) {
      logger.error('Get all users failed', {
        adminId: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get users',
        code: 'GET_USERS_ERROR'
      });
    }
  }

  /**
   * Get user by ID (admin only)
   */
  async getUserById(req: AdminRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const user = await this.db.getUserById(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          user: this.sanitizeUser(user)
        }
      });

    } catch (error) {
      logger.error('Get user by ID failed', {
        adminId: req.user?.id,
        targetUserId: req.params.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get user',
        code: 'GET_USER_ERROR'
      });
    }
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(req: AdminRequest, res: Response): Promise<void> {
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
      const { newRole, reason } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      await permissionManager.changeUserRole(
        req.user.id,
        userId,
        newRole,
        reason,
        ipAddress,
        userAgent
      );

      res.status(200).json({
        success: true,
        message: 'User role updated successfully'
      });

    } catch (error) {
      logger.error('Update user role failed', {
        adminId: req.user?.id,
        targetUserId: req.params.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update user role',
        code: 'UPDATE_ROLE_ERROR'
      });
    }
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Sanitize user data for response
   */
  private sanitizeUser(user: any): User {
    const {
      passwordHash,
      loginAttempts,
      lockReason,
      verificationTokens,
      refreshTokens,
      ...sanitized
    } = user;

    return sanitized;
  }

  // ==========================================
  // Validation Rules
  // ==========================================

  static getValidationRules() {
    return {
      register: [
        body('phoneNumber')
          .isMobilePhone('zh-CN')
          .withMessage('Valid Chinese phone number required'),
        body('name')
          .trim()
          .isLength({ min: 2, max: 50 })
          .withMessage('Name must be between 2 and 50 characters'),
        body('email')
          .optional()
          .isEmail()
          .withMessage('Valid email required'),
        body('password')
          .isLength({ min: 8 })
          .withMessage('Password must be at least 8 characters long'),
        body('personality')
          .optional()
          .isIn(['polite', 'direct', 'humorous', 'professional', 'custom'])
          .withMessage('Invalid personality type'),
        body('languagePreference')
          .optional()
          .isIn(['zh-CN', 'en-US', 'zh-TW'])
          .withMessage('Invalid language preference'),
        body('timezone')
          .optional()
          .isIn(['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'UTC'])
          .withMessage('Invalid timezone')
      ],

      login: [
        body('phoneNumber')
          .isMobilePhone('zh-CN')
          .withMessage('Valid Chinese phone number required'),
        body('password')
          .notEmpty()
          .withMessage('Password is required'),
        body('deviceFingerprint')
          .optional()
          .isString()
          .withMessage('Device fingerprint must be a string'),
        body('rememberMe')
          .optional()
          .isBoolean()
          .withMessage('Remember me must be a boolean')
      ],

      verifyMFA: [
        body('tempToken')
          .notEmpty()
          .withMessage('Temporary token is required'),
        body('mfaCode')
          .isLength({ min: 6, max: 8 })
          .withMessage('MFA code must be 6-8 characters'),
        body('deviceFingerprint')
          .optional()
          .isString()
          .withMessage('Device fingerprint must be a string'),
        body('rememberMe')
          .optional()
          .isBoolean()
          .withMessage('Remember me must be a boolean')
      ],

      updateProfile: [
        body('name')
          .optional()
          .trim()
          .isLength({ min: 2, max: 50 })
          .withMessage('Name must be between 2 and 50 characters'),
        body('email')
          .optional()
          .isEmail()
          .withMessage('Valid email required'),
        body('personality')
          .optional()
          .isIn(['polite', 'direct', 'humorous', 'professional', 'custom'])
          .withMessage('Invalid personality type'),
        body('languagePreference')
          .optional()
          .isIn(['zh-CN', 'en-US', 'zh-TW'])
          .withMessage('Invalid language preference'),
        body('timezone')
          .optional()
          .isIn(['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'UTC'])
          .withMessage('Invalid timezone'),
        body('maxCallDuration')
          .optional()
          .isInt({ min: 30, max: 600 })
          .withMessage('Max call duration must be between 30 and 600 seconds')
      ],

      enableMFA: [
        body('token')
          .isLength({ min: 6, max: 6 })
          .withMessage('TOTP token must be 6 digits')
      ],

      disableMFA: [
        body('currentPassword')
          .notEmpty()
          .withMessage('Current password is required')
      ],

      updateUserRole: [
        param('userId')
          .isUUID()
          .withMessage('Valid user ID required'),
        body('newRole')
          .isIn(['user', 'moderator', 'admin', 'system'])
          .withMessage('Invalid role'),
        body('reason')
          .optional()
          .trim()
          .isLength({ max: 500 })
          .withMessage('Reason must not exceed 500 characters')
      ]
    };
  }
}

// Export singleton instance
export const userController = new UserController();