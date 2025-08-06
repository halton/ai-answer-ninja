import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'crypto';
import { config, constants } from '@/config';
import { prisma } from '@/services/database';
import { 
  JWTPayload, 
  AuthTokens, 
  LoginCredentials, 
  User, 
  RefreshTokenData,
  DeviceInfo 
} from '@/types';
import logger, { logAuthEvent, logSecurityEvent } from '@/utils/logger';
import { CacheService } from '@/services/cache';
import { SecurityService } from '@/services/security';

export class AuthService {
  private cacheService: CacheService;
  private securityService: SecurityService;

  constructor() {
    this.cacheService = new CacheService();
    this.securityService = new SecurityService();
  }

  /**
   * Authenticate user with credentials
   */
  async login(
    credentials: LoginCredentials,
    ipAddress: string,
    userAgent: string
  ): Promise<{ user: User; tokens: AuthTokens; requiresMFA: boolean }> {
    const { phoneNumber, password, deviceFingerprint, rememberMe } = credentials;

    try {
      // Find user by phone number
      const user = await prisma.user.findUnique({
        where: { phoneNumber },
        include: { mfaSettings: true }
      });

      if (!user) {
        await this.handleFailedLogin(phoneNumber, ipAddress, 'user_not_found');
        throw new Error('Invalid credentials');
      }

      // Check if account is locked
      if (user.isLocked) {
        await this.handleFailedLogin(phoneNumber, ipAddress, 'account_locked');
        throw new Error('Account is locked');
      }

      // Check if account is active
      if (!user.isActive) {
        await this.handleFailedLogin(phoneNumber, ipAddress, 'account_inactive');
        throw new Error('Account is inactive');
      }

      // Verify password
      const isPasswordValid = await argon2.verify(user.passwordHash, password);
      if (!isPasswordValid) {
        await this.handleFailedLogin(phoneNumber, ipAddress, 'invalid_password');
        throw new Error('Invalid credentials');
      }

      // Check if MFA is required
      const requiresMFA = user.mfaSettings?.isEnabled || false;
      
      if (requiresMFA) {
        // Generate temporary session for MFA verification
        const tempSession = await this.createTempSession(user.id, ipAddress, userAgent);
        
        logAuthEvent({
          action: 'login',
          userId: user.id,
          success: false,
          ipAddress,
          userAgent,
          details: { requiresMFA: true }
        });

        return {
          user: this.sanitizeUser(user),
          tokens: {
            accessToken: tempSession.token,
            refreshToken: '',
            expiresIn: 300, // 5 minutes for MFA completion
            tokenType: 'Bearer'
          },
          requiresMFA: true
        };
      }

      // Generate tokens
      const tokens = await this.generateTokens(user, ipAddress, userAgent, deviceFingerprint, rememberMe);

      // Update user login information
      await this.updateLoginInfo(user.id, ipAddress);

      // Reset login attempts
      await this.resetLoginAttempts(user.id);

      // Create user session
      await this.createUserSession(user.id, tokens.refreshToken, {
        fingerprint: deviceFingerprint || 'unknown',
        platform: this.extractPlatform(userAgent),
        browser: this.extractBrowser(userAgent),
        version: this.extractVersion(userAgent),
        isMobile: this.isMobileDevice(userAgent),
        isTrusted: await this.isDeviceTrusted(user.id, deviceFingerprint)
      }, ipAddress, userAgent);

      logAuthEvent({
        action: 'login',
        userId: user.id,
        success: true,
        ipAddress,
        userAgent
      });

      return {
        user: this.sanitizeUser(user),
        tokens,
        requiresMFA: false
      };

    } catch (error) {
      logger.error('Login failed', { 
        phoneNumber: phoneNumber.substring(0, 3) + '***',
        error: (error as Error).message,
        ipAddress
      });
      throw error;
    }
  }

  /**
   * Verify MFA and complete login
   */
  async verifyMFAAndCompleteLogin(
    tempToken: string,
    mfaCode: string,
    ipAddress: string,
    userAgent: string,
    deviceFingerprint?: string,
    rememberMe?: boolean
  ): Promise<{ user: User; tokens: AuthTokens }> {
    try {
      // Verify temp token
      const decoded = jwt.verify(tempToken, config.jwt.accessSecret) as JWTPayload;
      
      if (!decoded.sessionId || decoded.sessionId !== 'mfa-temp') {
        throw new Error('Invalid temporary session');
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { mfaSettings: true }
      });

      if (!user || !user.mfaSettings) {
        throw new Error('User not found or MFA not configured');
      }

      // Verify MFA code
      const isValidMFA = await this.securityService.verifyMFACode(
        user.mfaSettings.secret!,
        mfaCode
      );

      if (!isValidMFA) {
        await this.handleFailedLogin(user.phoneNumber, ipAddress, 'invalid_mfa');
        throw new Error('Invalid MFA code');
      }

      // Generate full tokens
      const tokens = await this.generateTokens(user, ipAddress, userAgent, deviceFingerprint, rememberMe);

      // Update user login information
      await this.updateLoginInfo(user.id, ipAddress);

      // Create user session
      await this.createUserSession(user.id, tokens.refreshToken, {
        fingerprint: deviceFingerprint || 'unknown',
        platform: this.extractPlatform(userAgent),
        browser: this.extractBrowser(userAgent),
        version: this.extractVersion(userAgent),
        isMobile: this.isMobileDevice(userAgent),
        isTrusted: await this.isDeviceTrusted(user.id, deviceFingerprint)
      }, ipAddress, userAgent);

      // Update MFA last used
      await prisma.mFASettings.update({
        where: { userId: user.id },
        data: { lastUsedAt: new Date() }
      });

      logAuthEvent({
        action: 'login',
        userId: user.id,
        success: true,
        ipAddress,
        userAgent,
        details: { mfaVerified: true }
      });

      return {
        user: this.sanitizeUser(user),
        tokens
      };

    } catch (error) {
      logger.error('MFA verification failed', { 
        error: (error as Error).message,
        ipAddress
      });
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    refreshToken: string,
    ipAddress: string,
    userAgent: string
  ): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as JWTPayload;

      // Check if token exists in database
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true }
      });

      if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.expiresAt < new Date()) {
        throw new Error('Invalid or expired refresh token');
      }

      // Check if user is still active
      if (!tokenRecord.user.isActive || tokenRecord.user.isLocked) {
        throw new Error('User account is not active');
      }

      // Generate new tokens
      const newTokens = await this.generateTokens(
        tokenRecord.user,
        ipAddress,
        userAgent,
        undefined,
        true // Preserve remember me
      );

      // Revoke old refresh token
      await prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { 
          isRevoked: true,
          revokedAt: new Date(),
          revokedBy: 'token_refresh'
        }
      });

      logAuthEvent({
        action: 'login',
        userId: tokenRecord.user.id,
        success: true,
        ipAddress,
        userAgent,
        details: { tokenRefresh: true }
      });

      return newTokens;

    } catch (error) {
      logger.error('Token refresh failed', { 
        error: (error as Error).message,
        ipAddress
      });
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(
    refreshToken: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      // Find and revoke refresh token
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true }
      });

      if (tokenRecord) {
        // Revoke refresh token
        await prisma.refreshToken.update({
          where: { id: tokenRecord.id },
          data: { 
            isRevoked: true,
            revokedAt: new Date(),
            revokedBy: 'user_logout'
          }
        });

        // Deactivate user session
        await prisma.userSession.updateMany({
          where: { 
            userId: tokenRecord.userId,
            ipAddress,
            isActive: true
          },
          data: { isActive: false }
        });

        logAuthEvent({
          action: 'logout',
          userId: tokenRecord.user.id,
          success: true,
          ipAddress,
          userAgent
        });
      }

    } catch (error) {
      logger.error('Logout failed', { 
        error: (error as Error).message,
        ipAddress
      });
      throw error;
    }
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId: string, ipAddress: string, userAgent: string): Promise<void> {
    try {
      // Revoke all refresh tokens
      await prisma.refreshToken.updateMany({
        where: { 
          userId,
          isRevoked: false
        },
        data: { 
          isRevoked: true,
          revokedAt: new Date(),
          revokedBy: 'user_logout_all'
        }
      });

      // Deactivate all user sessions
      await prisma.userSession.updateMany({
        where: { 
          userId,
          isActive: true
        },
        data: { isActive: false }
      });

      logAuthEvent({
        action: 'logout',
        userId,
        success: true,
        ipAddress,
        userAgent,
        details: { logoutAll: true }
      });

    } catch (error) {
      logger.error('Logout all failed', { 
        userId,
        error: (error as Error).message,
        ipAddress
      });
      throw error;
    }
  }

  /**
   * Generate JWT tokens
   */
  private async generateTokens(
    user: any,
    ipAddress: string,
    userAgent: string,
    deviceFingerprint?: string,
    rememberMe: boolean = false
  ): Promise<AuthTokens> {
    const sessionId = crypto.randomUUID();
    const permissions = await this.getUserPermissions(user.role);

    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
      sessionId,
      permissions
    };

    // Generate access token
    const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiry,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });

    // Generate refresh token
    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: rememberMe ? '30d' : config.jwt.refreshExpiry,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + (rememberMe ? 30 * 24 * 60 * 60 * 1000 : constants.REFRESH_TOKEN_EXPIRY));

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        deviceInfo: deviceFingerprint ? {
          fingerprint: deviceFingerprint,
          platform: this.extractPlatform(userAgent),
          browser: this.extractBrowser(userAgent),
          version: this.extractVersion(userAgent),
          isMobile: this.isMobileDevice(userAgent),
          isTrusted: await this.isDeviceTrusted(user.id, deviceFingerprint)
        } : null,
        ipAddress,
        userAgent,
        expiresAt
      }
    });

    // Get token expiry time
    const decoded = jwt.decode(accessToken) as JWTPayload;
    const expiresIn = decoded.exp - decoded.iat;

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer'
    };
  }

  /**
   * Create temporary session for MFA
   */
  private async createTempSession(
    userId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ token: string }> {
    const payload = {
      userId,
      sessionId: 'mfa-temp',
      permissions: []
    };

    const token = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: '5m',
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });

    return { token };
  }

  /**
   * Handle failed login attempts
   */
  private async handleFailedLogin(
    phoneNumber: string,
    ipAddress: string,
    reason: string
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { phoneNumber }
      });

      if (user) {
        const newAttempts = user.loginAttempts + 1;
        
        // Check if should lock account
        if (newAttempts >= config.security.maxLoginAttempts) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              isLocked: true,
              lockReason: 'too_many_failed_attempts',
              loginAttempts: newAttempts
            }
          });

          logSecurityEvent({
            type: 'account_locked',
            severity: 'high',
            userId: user.id,
            ipAddress,
            details: { reason, attempts: newAttempts }
          });
        } else {
          await prisma.user.update({
            where: { id: user.id },
            data: { loginAttempts: newAttempts }
          });
        }

        logAuthEvent({
          action: 'login',
          userId: user.id,
          success: false,
          ipAddress,
          details: { reason, attempts: newAttempts }
        });
      }

      // Log failed attempt even if user doesn't exist (security)
      logSecurityEvent({
        type: 'failed_login',
        severity: 'medium',
        ipAddress,
        details: { 
          phoneNumber: phoneNumber.substring(0, 3) + '***',
          reason 
        }
      });

    } catch (error) {
      logger.error('Failed to handle failed login', { error, phoneNumber, ipAddress });
    }
  }

  /**
   * Reset login attempts
   */
  private async resetLoginAttempts(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { loginAttempts: 0 }
    });
  }

  /**
   * Update user login information
   */
  private async updateLoginInfo(userId: string, ipAddress: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress
      }
    });
  }

  /**
   * Create user session
   */
  private async createUserSession(
    userId: string,
    refreshToken: string,
    deviceInfo: DeviceInfo,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + config.security.sessionTimeout);

    await prisma.userSession.create({
      data: {
        userId,
        sessionId,
        deviceInfo,
        ipAddress,
        userAgent,
        expiresAt
      }
    });
  }

  /**
   * Get user permissions based on role
   */
  private async getUserPermissions(role: string): Promise<string[]> {
    const rolePermissions = {
      user: [
        'read:own_data',
        'update:own_profile',
        'delete:own_account',
        'manage:own_whitelist',
        'view:own_calls'
      ],
      moderator: [
        'read:own_data',
        'update:own_profile',
        'delete:own_account',
        'manage:own_whitelist',
        'view:own_calls',
        'view:analytics',
        'manage:spam_profiles'
      ],
      admin: [
        'read:own_data',
        'update:own_profile',
        'delete:own_account',
        'manage:own_whitelist',
        'view:own_calls',
        'read:all_data',
        'update:system_config',
        'manage:users',
        'view:analytics',
        'manage:spam_profiles'
      ],
      system: [
        'read:own_data',
        'update:own_profile',
        'delete:own_account',
        'manage:own_whitelist',
        'view:own_calls',
        'read:all_data',
        'update:system_config',
        'manage:users',
        'view:analytics',
        'manage:spam_profiles',
        'system:admin'
      ]
    };

    return rolePermissions[role as keyof typeof rolePermissions] || rolePermissions.user;
  }

  /**
   * Check if device is trusted
   */
  private async isDeviceTrusted(userId: string, deviceFingerprint?: string): Promise<boolean> {
    if (!deviceFingerprint) return false;

    const trustedDevice = await prisma.userSession.findFirst({
      where: {
        userId,
        deviceInfo: {
          path: ['fingerprint'],
          equals: deviceFingerprint
        },
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      }
    });

    return !!trustedDevice;
  }

  /**
   * Sanitize user data for response
   */
  private sanitizeUser(user: any): User {
    const {
      passwordHash,
      loginAttempts,
      ...sanitized
    } = user;

    return sanitized;
  }

  // Device/User Agent parsing helpers
  private extractPlatform(userAgent: string): string {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS')) return 'iOS';
    return 'Unknown';
  }

  private extractBrowser(userAgent: string): string {
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  }

  private extractVersion(userAgent: string): string {
    const match = userAgent.match(/(?:Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/);
    return match ? match[1] : 'Unknown';
  }

  private isMobileDevice(userAgent: string): boolean {
    return /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  }
}