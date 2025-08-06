import { config, constants } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { AuditService } from './audit';
import { EmailService } from './email';
import {
  User,
  CreateUserData,
  UpdateUserData,
  UserPreferences,
  PersonalityType,
  UserConfig,
  NotificationPreferences,
  PrivacyPreferences,
  CallHandlingPreferences,
  AIPreferences,
  SecurityPreferences
} from '@/types';

/**
 * User Profile Service
 * Handles user profile management, preferences, and configurations
 */
export class UserProfileService {
  private db: DatabaseService;
  private redis: RedisService;
  private audit: AuditService;
  private email: EmailService;

  constructor() {
    this.db = new DatabaseService();
    this.redis = new RedisService();
    this.audit = new AuditService();
    this.email = new EmailService();
  }

  // ==========================================
  // User Profile Management
  // ==========================================

  /**
   * Create new user profile
   */
  async createUser(
    userData: CreateUserData,
    ipAddress: string,
    userAgent: string
  ): Promise<User> {
    try {
      // Validate user data
      await this.validateUserData(userData);

      // Set default preferences
      const defaultPreferences = this.getDefaultPreferences();
      const userPreferences = {
        ...defaultPreferences,
        ...userData.preferences
      };

      // Create user with default preferences
      const user = await this.db.createUser({
        ...userData,
        preferences: userPreferences
      });

      // Cache user data
      await this.cacheUserProfile(user);

      // Log user creation
      await this.audit.log({
        userId: user.id,
        action: 'register',
        resource: 'user_profile',
        details: {
          phoneNumber: user.phoneNumber,
          hasEmail: !!user.email,
          personality: user.personality
        },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('User profile created', {
        userId: user.id,
        phoneNumber: user.phoneNumber
      });

      return user;
    } catch (error) {
      logger.error('User profile creation failed', {
        phoneNumber: userData.phoneNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string): Promise<User | null> {
    try {
      // Try cache first
      const cachedUser = await this.redis.getCachedUser<User>(userId);
      if (cachedUser) {
        return cachedUser;
      }

      // Get from database
      const user = await this.db.getUserById(userId);
      if (user) {
        await this.cacheUserProfile(user);
      }

      return user;
    } catch (error) {
      logger.error('Failed to get user profile', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(
    userId: string,
    updateData: UpdateUserData,
    ipAddress: string,
    userAgent: string
  ): Promise<User> {
    try {
      const existingUser = await this.db.getUserById(userId);
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Validate update data
      await this.validateUpdateData(updateData, existingUser);

      // Update user profile
      const updatedUser = await this.db.updateUser(userId, updateData);

      // Clear cache
      await this.redis.clearUserCache(userId);

      // Cache updated profile
      await this.cacheUserProfile(updatedUser);

      // Log profile update
      await this.audit.log({
        userId,
        action: 'profile_update',
        resource: 'user_profile',
        details: {
          updatedFields: Object.keys(updateData),
          changes: this.getProfileChanges(existingUser, updateData)
        },
        ipAddress,
        userAgent,
        success: true
      });

      // Send notification if email changed
      if (updateData.email && updateData.email !== existingUser.email) {
        await this.handleEmailChange(updatedUser, existingUser.email);
      }

      logger.info('User profile updated', {
        userId,
        updatedFields: Object.keys(updateData)
      });

      return updatedUser;
    } catch (error) {
      logger.error('User profile update failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Delete user profile (GDPR compliance)
   */
  async deleteUserProfile(
    userId: string,
    reason: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Log deletion before actual deletion
      await this.audit.log({
        userId,
        action: 'data_deletion',
        resource: 'user_profile',
        details: {
          reason,
          phoneNumber: user.phoneNumber,
          email: user.email
        },
        ipAddress,
        userAgent,
        success: true
      });

      // Delete user data
      await this.db.deleteUser(userId);

      // Clear all cached data
      await this.redis.clearUserCache(userId);

      // Send confirmation email if email exists
      if (user.email) {
        await this.email.sendDataExportReady(user, '', new Date());
      }

      logger.info('User profile deleted', {
        userId,
        phoneNumber: user.phoneNumber,
        reason
      });
    } catch (error) {
      logger.error('User profile deletion failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // Preferences Management
  // ==========================================

  /**
   * Get user preferences
   */
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    try {
      const user = await this.getUserProfile(userId);
      if (!user) {
        throw new Error('User not found');
      }

      return user.preferences as UserPreferences;
    } catch (error) {
      logger.error('Failed to get user preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>,
    ipAddress: string,
    userAgent: string
  ): Promise<UserPreferences> {
    try {
      const user = await this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Merge with existing preferences
      const currentPreferences = user.preferences as UserPreferences;
      const updatedPreferences = this.mergePreferences(currentPreferences, preferences);

      // Validate preferences
      await this.validatePreferences(updatedPreferences);

      // Update in database
      await this.db.updateUser(userId, { preferences: updatedPreferences });

      // Clear cache
      await this.redis.clearUserCache(userId);

      // Log preferences update
      await this.audit.log({
        userId,
        action: 'profile_update',
        resource: 'user_preferences',
        details: {
          updatedCategories: Object.keys(preferences),
          changes: this.getPreferencesChanges(currentPreferences, preferences)
        },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('User preferences updated', {
        userId,
        updatedCategories: Object.keys(preferences)
      });

      return updatedPreferences;
    } catch (error) {
      logger.error('User preferences update failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Reset preferences to default
   */
  async resetPreferencesToDefault(
    userId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<UserPreferences> {
    try {
      const defaultPreferences = this.getDefaultPreferences();
      
      await this.db.updateUser(userId, { preferences: defaultPreferences });
      await this.redis.clearUserCache(userId);

      await this.audit.log({
        userId,
        action: 'profile_update',
        resource: 'user_preferences',
        details: { action: 'reset_to_default' },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('User preferences reset to default', { userId });

      return defaultPreferences;
    } catch (error) {
      logger.error('Failed to reset user preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // User Configuration Management
  // ==========================================

  /**
   * Get user configuration
   */
  async getUserConfig(userId: string, key: string): Promise<any> {
    try {
      // Try cache first
      const cacheKey = `user_config:${userId}:${key}`;
      const cached = await this.redis.getJSON(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Get from database
      const config = await this.db.getUserConfig(userId, key);
      if (config) {
        await this.redis.setex(cacheKey, 3600, config.value);
        return config.value;
      }

      // Check if there's a global default
      const globalConfig = await this.db.getGlobalConfig(key);
      if (globalConfig) {
        return globalConfig.value;
      }

      return null;
    } catch (error) {
      logger.error('Failed to get user config', {
        userId,
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Set user configuration
   */
  async setUserConfig(
    userId: string,
    key: string,
    value: any,
    options: {
      inheritsGlobal?: boolean;
      overrideReason?: string;
      autoLearned?: boolean;
      learningConfidence?: number;
    } = {},
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      await this.db.setUserConfig(userId, key, value, options);

      // Clear cache
      const cacheKey = `user_config:${userId}:${key}`;
      await this.redis.delete(cacheKey);

      // Log config change
      await this.audit.log({
        userId,
        action: 'config_change',
        resource: 'user_config',
        details: {
          key,
          autoLearned: options.autoLearned || false,
          inheritsGlobal: options.inheritsGlobal || false
        },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('User config updated', { userId, key });
    } catch (error) {
      logger.error('Failed to set user config', {
        userId,
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Delete user configuration
   */
  async deleteUserConfig(
    userId: string,
    key: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      await this.db.deleteUserConfig(userId, key);

      // Clear cache
      const cacheKey = `user_config:${userId}:${key}`;
      await this.redis.delete(cacheKey);

      // Log config deletion
      await this.audit.log({
        userId,
        action: 'config_change',
        resource: 'user_config',
        details: { key, action: 'delete' },
        ipAddress,
        userAgent,
        success: true
      });

      logger.info('User config deleted', { userId, key });
    } catch (error) {
      logger.error('Failed to delete user config', {
        userId,
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // Profile Analytics
  // ==========================================

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(userId: string): Promise<{
    profileCompleteness: number;
    lastUpdated: Date | null;
    preferencesSet: number;
    totalPreferences: number;
    configsOverridden: number;
    recentActivity: Array<{ action: string; timestamp: Date }>;
  }> {
    try {
      const user = await this.getUserProfile(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const preferences = user.preferences as UserPreferences;
      const auditSummary = await this.audit.getUserActivitySummary(userId, 7);

      return {
        profileCompleteness: this.calculateProfileCompleteness(user),
        lastUpdated: user.updatedAt,
        preferencesSet: this.countSetPreferences(preferences),
        totalPreferences: this.getTotalPreferencesCount(),
        configsOverridden: await this.db.getUserConfigCount(userId),
        recentActivity: auditSummary.topActions.map(action => ({
          action: action.action,
          timestamp: new Date() // Simplified - would need actual timestamps
        }))
      };
    } catch (error) {
      logger.error('Failed to get user activity summary', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Export user data (GDPR compliance)
   */
  async exportUserData(userId: string): Promise<{
    profile: User;
    preferences: UserPreferences;
    configs: UserConfig[];
    auditLogs: any[];
  }> {
    try {
      const [profile, configs, auditLogs] = await Promise.all([
        this.getUserProfile(userId),
        this.db.getUserConfigs(userId),
        this.audit.getUserAuditLogs(userId, { limit: 1000 })
      ]);

      if (!profile) {
        throw new Error('User not found');
      }

      return {
        profile,
        preferences: profile.preferences as UserPreferences,
        configs,
        auditLogs: auditLogs.logs
      };
    } catch (error) {
      logger.error('Failed to export user data', {
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
   * Cache user profile
   */
  private async cacheUserProfile(user: User): Promise<void> {
    try {
      await this.redis.cacheUser(user.id, user, 1800); // 30 minutes
    } catch (error) {
      logger.error('Failed to cache user profile', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Validate user data
   */
  private async validateUserData(userData: CreateUserData): Promise<void> {
    if (!userData.phoneNumber) {
      throw new Error('Phone number is required');
    }

    if (!userData.name || userData.name.trim().length < 2) {
      throw new Error('Name must be at least 2 characters long');
    }

    if (userData.email && !this.isValidEmail(userData.email)) {
      throw new Error('Invalid email format');
    }

    if (!userData.password || userData.password.length < config.security.passwordMinLength) {
      throw new Error(`Password must be at least ${config.security.passwordMinLength} characters long`);
    }

    // Check if phone number is already taken
    const existingUser = await this.db.getUserByPhone(userData.phoneNumber);
    if (existingUser) {
      throw new Error('Phone number is already registered');
    }

    // Check if email is already taken
    if (userData.email) {
      const existingEmail = await this.db.getUserByEmail(userData.email);
      if (existingEmail) {
        throw new Error('Email is already registered');
      }
    }
  }

  /**
   * Validate update data
   */
  private async validateUpdateData(updateData: UpdateUserData, existingUser: User): Promise<void> {
    if (updateData.name && updateData.name.trim().length < 2) {
      throw new Error('Name must be at least 2 characters long');
    }

    if (updateData.email && !this.isValidEmail(updateData.email)) {
      throw new Error('Invalid email format');
    }

    // Check if email is already taken (by another user)
    if (updateData.email && updateData.email !== existingUser.email) {
      const existingEmail = await this.db.getUserByEmail(updateData.email);
      if (existingEmail && existingEmail.id !== existingUser.id) {
        throw new Error('Email is already registered by another user');
      }
    }

    if (updateData.maxCallDuration && (updateData.maxCallDuration < 30 || updateData.maxCallDuration > 1800)) {
      throw new Error('Call duration must be between 30 seconds and 30 minutes');
    }
  }

  /**
   * Validate preferences
   */
  private async validatePreferences(preferences: UserPreferences): Promise<void> {
    if (preferences.privacy.dataRetentionDays < 1 || preferences.privacy.dataRetentionDays > 365) {
      throw new Error('Data retention days must be between 1 and 365');
    }

    if (preferences.callHandling.maxDuration < 30 || preferences.callHandling.maxDuration > 1800) {
      throw new Error('Max call duration must be between 30 seconds and 30 minutes');
    }

    if (preferences.security.sessionTimeout < 300 || preferences.security.sessionTimeout > 86400) {
      throw new Error('Session timeout must be between 5 minutes and 24 hours');
    }
  }

  /**
   * Get default preferences
   */
  private getDefaultPreferences(): UserPreferences {
    return {
      notifications: {
        email: true,
        sms: false,
        push: true,
        callSummary: true,
        securityAlerts: true,
        weeklyReport: false
      },
      privacy: {
        recordCalls: true,
        shareAnalytics: false,
        dataRetentionDays: 90,
        allowPersonalization: true
      },
      callHandling: {
        maxDuration: constants.DEFAULT_CALL_DURATION,
        autoTerminate: true,
        whitelistMode: 'moderate',
        blockUnknown: false,
        customResponses: []
      },
      ai: {
        personality: constants.DEFAULT_PERSONALITY,
        responseStyle: 'friendly',
        aggressiveness: 'moderate',
        learningEnabled: true
      },
      security: {
        mfaEnabled: false,
        sessionTimeout: 3600,
        loginNotifications: true,
        deviceTracking: true
      }
    };
  }

  /**
   * Merge preferences
   */
  private mergePreferences(
    current: UserPreferences,
    updates: Partial<UserPreferences>
  ): UserPreferences {
    return {
      notifications: { ...current.notifications, ...updates.notifications },
      privacy: { ...current.privacy, ...updates.privacy },
      callHandling: { ...current.callHandling, ...updates.callHandling },
      ai: { ...current.ai, ...updates.ai },
      security: { ...current.security, ...updates.security }
    };
  }

  /**
   * Get profile changes for audit log
   */
  private getProfileChanges(existing: User, updates: UpdateUserData): Record<string, any> {
    const changes: Record<string, any> = {};

    Object.keys(updates).forEach(key => {
      const existingValue = (existing as any)[key];
      const newValue = (updates as any)[key];
      
      if (existingValue !== newValue) {
        changes[key] = {
          from: existingValue,
          to: newValue
        };
      }
    });

    return changes;
  }

  /**
   * Get preferences changes for audit log
   */
  private getPreferencesChanges(
    current: UserPreferences,
    updates: Partial<UserPreferences>
  ): Record<string, any> {
    const changes: Record<string, any> = {};

    Object.keys(updates).forEach(category => {
      const currentCat = (current as any)[category];
      const updateCat = (updates as any)[category];
      
      if (currentCat && updateCat) {
        Object.keys(updateCat).forEach(key => {
          if (currentCat[key] !== updateCat[key]) {
            changes[`${category}.${key}`] = {
              from: currentCat[key],
              to: updateCat[key]
            };
          }
        });
      }
    });

    return changes;
  }

  /**
   * Calculate profile completeness percentage
   */
  private calculateProfileCompleteness(user: User): number {
    let completed = 0;
    let total = 0;

    // Basic profile fields
    const profileFields = ['name', 'email', 'personality', 'voiceProfileId', 'languagePreference', 'timezone'];
    profileFields.forEach(field => {
      total++;
      if ((user as any)[field]) completed++;
    });

    // Preferences completeness
    const preferences = user.preferences as UserPreferences;
    const preferencesSet = this.countSetPreferences(preferences);
    const totalPreferences = this.getTotalPreferencesCount();
    
    total += totalPreferences;
    completed += preferencesSet;

    return Math.round((completed / total) * 100);
  }

  /**
   * Count set preferences
   */
  private countSetPreferences(preferences: UserPreferences): number {
    let count = 0;
    
    // Count non-default preferences
    Object.values(preferences).forEach(category => {
      if (typeof category === 'object') {
        count += Object.keys(category).length;
      }
    });
    
    return count;
  }

  /**
   * Get total preferences count
   */
  private getTotalPreferencesCount(): number {
    const defaultPrefs = this.getDefaultPreferences();
    let count = 0;
    
    Object.values(defaultPrefs).forEach(category => {
      if (typeof category === 'object') {
        count += Object.keys(category).length;
      }
    });
    
    return count;
  }

  /**
   * Handle email change
   */
  private async handleEmailChange(user: User, oldEmail?: string): Promise<void> {
    try {
      if (user.email) {
        // Send verification email to new address
        // This would typically generate a verification token and send email
        logger.info('Email change detected, verification email sent', {
          userId: user.id,
          newEmail: user.email
        });
      }

      if (oldEmail) {
        // Notify old email about the change
        logger.info('Email change notification sent to old address', {
          userId: user.id,
          oldEmail
        });
      }
    } catch (error) {
      logger.error('Failed to handle email change', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

// Export singleton instance
export const userProfileService = new UserProfileService();