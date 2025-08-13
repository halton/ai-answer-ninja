import { config } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from '@/services/database';
import { RedisService } from '@/services/redis';
import { AuditService } from '@/services/audit';
import {
  User,
  UserRole,
  Permission,
  RolePermissions,
  AuthenticatedRequest,
  SecurityEvent
} from '@/types';

/**
 * Role-Based Access Control (RBAC) Permission Manager
 * Handles permission validation, role management, and access control
 */
export class PermissionManager {
  private db: DatabaseService;
  private redis: RedisService;
  private audit: AuditService;

  // Static role-permission mapping
  private static readonly ROLE_PERMISSIONS: RolePermissions = {
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

  // Resource ownership mapping for fine-grained access control
  private static readonly RESOURCE_OWNERSHIP_RULES = {
    'user_profile': (userId: string, resourceId: string) => userId === resourceId,
    'call_record': async (userId: string, resourceId: string, db: DatabaseService) => {
      const callRecord = await db.getCallRecord(resourceId);
      return callRecord?.userId === userId;
    },
    'whitelist_entry': async (userId: string, resourceId: string, db: DatabaseService) => {
      const whitelistEntry = await db.getWhitelistEntry(resourceId);
      return whitelistEntry?.userId === userId;
    },
    'conversation': async (userId: string, resourceId: string, db: DatabaseService) => {
      const conversation = await db.getConversation(resourceId);
      const callRecord = await db.getCallRecord(conversation?.callRecordId || '');
      return callRecord?.userId === userId;
    }
  };

  constructor() {
    this.db = new DatabaseService();
    this.redis = new RedisService();
    this.audit = new AuditService();
  }

  // ==========================================
  // Permission Validation Methods
  // ==========================================

  /**
   * Check if user has specific permission
   */
  async hasPermission(
    userId: string,
    permission: Permission,
    resourceId?: string,
    resourceType?: string
  ): Promise<boolean> {
    try {
      // Get user with role information
      const user = await this.getUserWithRole(userId);
      if (!user || !user.isActive) {
        return false;
      }

      // Check if user role has the required permission
      const rolePermissions = this.getRolePermissions(user.role);
      if (!rolePermissions.includes(permission)) {
        await this.logAccessDenied(userId, permission, resourceId, 'insufficient_role_permissions');
        return false;
      }

      // For resource-specific permissions, check ownership
      if (resourceId && resourceType && permission.includes('own_')) {
        const hasOwnership = await this.checkResourceOwnership(userId, resourceId, resourceType);
        if (!hasOwnership) {
          await this.logAccessDenied(userId, permission, resourceId, 'not_resource_owner');
          return false;
        }
      }

      // Check for any specific permission overrides or restrictions
      const hasOverride = await this.checkPermissionOverrides(userId, permission);
      if (hasOverride !== null) {
        return hasOverride;
      }

      await this.logAccessGranted(userId, permission, resourceId);
      return true;

    } catch (error) {
      logger.error('Permission check failed', {
        userId,
        permission,
        resourceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check multiple permissions at once
   */
  async hasAllPermissions(
    userId: string,
    permissions: Permission[],
    resourceId?: string,
    resourceType?: string
  ): Promise<boolean> {
    try {
      const results = await Promise.all(
        permissions.map(permission => 
          this.hasPermission(userId, permission, resourceId, resourceType)
        )
      );

      return results.every(result => result === true);
    } catch (error) {
      logger.error('Multiple permission check failed', {
        userId,
        permissions,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(
    userId: string,
    permissions: Permission[],
    resourceId?: string,
    resourceType?: string
  ): Promise<boolean> {
    try {
      const results = await Promise.all(
        permissions.map(permission => 
          this.hasPermission(userId, permission, resourceId, resourceType)
        )
      );

      return results.some(result => result === true);
    } catch (error) {
      logger.error('Any permission check failed', {
        userId,
        permissions,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  // ==========================================
  // Role Management Methods
  // ==========================================

  /**
   * Get permissions for a specific role
   */
  getRolePermissions(role: UserRole): Permission[] {
    return PermissionManager.ROLE_PERMISSIONS[role] || PermissionManager.ROLE_PERMISSIONS.user;
  }

  /**
   * Get all permissions for a user
   */
  async getUserPermissions(userId: string): Promise<Permission[]> {
    try {
      const user = await this.getUserWithRole(userId);
      if (!user) {
        return [];
      }

      const basePermissions = this.getRolePermissions(user.role);
      
      // Add any additional permissions from overrides
      const additionalPermissions = await this.getPermissionOverrides(userId);
      
      // Combine and deduplicate permissions
      const allPermissions = [...new Set([...basePermissions, ...additionalPermissions])];
      
      return allPermissions;
    } catch (error) {
      logger.error('Failed to get user permissions', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Change user role (admin only)
   */
  async changeUserRole(
    adminUserId: string,
    targetUserId: string,
    newRole: UserRole,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      // Verify admin has permission to change roles
      const hasPermission = await this.hasPermission(adminUserId, 'manage:users');
      if (!hasPermission) {
        throw new Error('Insufficient permissions to change user role');
      }

      // Get target user
      const targetUser = await this.db.getUserById(targetUserId);
      if (!targetUser) {
        throw new Error('Target user not found');
      }

      // Prevent role escalation beyond admin's level
      const adminUser = await this.getUserWithRole(adminUserId);
      if (!this.canAssignRole(adminUser!.role, newRole)) {
        throw new Error('Cannot assign role higher than your own');
      }

      const oldRole = targetUser.role;

      // Update user role
      await this.db.updateUserRole(targetUserId, newRole);

      // Invalidate cached permissions
      await this.invalidateUserPermissions(targetUserId);

      // Log role change
      await this.audit.log({
        userId: adminUserId,
        action: 'permissions_change',
        resource: 'user',
        details: {
          targetUserId,
          oldRole,
          newRole,
          reason
        },
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        success: true
      });

      // Log security event
      await this.audit.logSecurityEvent({
        type: 'permissions_change',
        severity: 'medium',
        userId: targetUserId,
        details: {
          changedBy: adminUserId,
          oldRole,
          newRole,
          reason
        },
        timestamp: new Date()
      });

      logger.info('User role changed successfully', {
        adminUserId,
        targetUserId,
        oldRole,
        newRole,
        reason
      });

    } catch (error) {
      logger.error('Failed to change user role', {
        adminUserId,
        targetUserId,
        newRole,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Grant temporary permission to user
   */
  async grantTemporaryPermission(
    adminUserId: string,
    targetUserId: string,
    permission: Permission,
    expiresAt: Date,
    reason?: string
  ): Promise<void> {
    try {
      // Verify admin has permission to grant permissions
      const hasPermission = await this.hasPermission(adminUserId, 'manage:users');
      if (!hasPermission) {
        throw new Error('Insufficient permissions to grant temporary permissions');
      }

      // Store temporary permission in database
      await this.db.createTemporaryPermission({
        userId: targetUserId,
        permission,
        grantedBy: adminUserId,
        expiresAt,
        reason: reason || 'Administrative grant'
      });

      // Invalidate cached permissions
      await this.invalidateUserPermissions(targetUserId);

      // Log permission grant
      await this.audit.log({
        userId: adminUserId,
        action: 'permissions_change',
        resource: 'user',
        details: {
          targetUserId,
          permission,
          expiresAt,
          reason,
          type: 'temporary_grant'
        },
        ipAddress: '',
        userAgent: '',
        success: true
      });

      logger.info('Temporary permission granted', {
        adminUserId,
        targetUserId,
        permission,
        expiresAt,
        reason
      });

    } catch (error) {
      logger.error('Failed to grant temporary permission', {
        adminUserId,
        targetUserId,
        permission,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // Resource Ownership Methods
  // ==========================================

  /**
   * Check if user owns a specific resource
   */
  private async checkResourceOwnership(
    userId: string,
    resourceId: string,
    resourceType: string
  ): Promise<boolean> {
    try {
      const ownershipRule = PermissionManager.RESOURCE_OWNERSHIP_RULES[resourceType];
      if (!ownershipRule) {
        // If no specific rule exists, default to allowing access
        return true;
      }

      if (typeof ownershipRule === 'function') {
        if (ownershipRule.constructor.name === 'AsyncFunction') {
          return await (ownershipRule as any)(userId, resourceId, this.db);
        } else {
          return (ownershipRule as any)(userId, resourceId);
        }
      }

      return false;
    } catch (error) {
      logger.error('Resource ownership check failed', {
        userId,
        resourceId,
        resourceType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  // ==========================================
  // Permission Override Methods
  // ==========================================

  /**
   * Check for user-specific permission overrides
   */
  private async checkPermissionOverrides(
    userId: string,
    permission: Permission
  ): Promise<boolean | null> {
    try {
      // Check for temporary permissions
      const tempPermission = await this.db.getTemporaryPermission(userId, permission);
      if (tempPermission && tempPermission.expiresAt > new Date()) {
        return true;
      }

      // Check for explicit permission denials
      const permissionDenial = await this.db.getPermissionDenial(userId, permission);
      if (permissionDenial && permissionDenial.isActive) {
        return false;
      }

      return null; // No override found
    } catch (error) {
      logger.error('Permission override check failed', {
        userId,
        permission,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get additional permissions from overrides
   */
  private async getPermissionOverrides(userId: string): Promise<Permission[]> {
    try {
      const tempPermissions = await this.db.getActiveTemporaryPermissions(userId);
      return tempPermissions.map(tp => tp.permission as Permission);
    } catch (error) {
      logger.error('Failed to get permission overrides', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Check if admin can assign a specific role
   */
  private canAssignRole(adminRole: UserRole, targetRole: UserRole): boolean {
    const roleHierarchy = {
      system: 4,
      admin: 3,
      moderator: 2,
      user: 1
    };

    const adminLevel = roleHierarchy[adminRole] || 0;
    const targetLevel = roleHierarchy[targetRole] || 0;

    return adminLevel >= targetLevel;
  }

  /**
   * Get user with role information
   */
  private async getUserWithRole(userId: string): Promise<User | null> {
    try {
      // Check cache first
      const cachedUser = await this.redis.getJSON(`user:${userId}`);
      if (cachedUser) {
        return cachedUser as User;
      }

      // Get from database
      const user = await this.db.getUserById(userId);
      if (user) {
        // Cache for 15 minutes
        await this.redis.setex(`user:${userId}`, 900, user);
      }

      return user;
    } catch (error) {
      logger.error('Failed to get user with role', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Invalidate user permissions cache
   */
  private async invalidateUserPermissions(userId: string): Promise<void> {
    try {
      await this.redis.delete(`user:${userId}`);
      await this.redis.delete(`permissions:${userId}`);
      
      logger.debug('User permissions cache invalidated', { userId });
    } catch (error) {
      logger.error('Failed to invalidate user permissions cache', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Logging Methods
  // ==========================================

  /**
   * Log successful access grant
   */
  private async logAccessGranted(
    userId: string,
    permission: Permission,
    resourceId?: string
  ): Promise<void> {
    try {
      await this.audit.log({
        userId,
        action: 'permission_check',
        resource: 'access_control',
        details: {
          permission,
          resourceId,
          result: 'granted'
        },
        ipAddress: '',
        userAgent: '',
        success: true
      });
    } catch (error) {
      logger.error('Failed to log access granted', {
        userId,
        permission,
        resourceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Log access denial
   */
  private async logAccessDenied(
    userId: string,
    permission: Permission,
    resourceId: string | undefined,
    reason: string
  ): Promise<void> {
    try {
      await this.audit.log({
        userId,
        action: 'permission_check',
        resource: 'access_control',
        details: {
          permission,
          resourceId,
          result: 'denied',
          reason
        },
        ipAddress: '',
        userAgent: '',
        success: false
      });

      // Log security event for repeated access denials
      const recentDenials = await this.redis.incr(`access_denials:${userId}`);
      await this.redis.expire(`access_denials:${userId}`, 3600); // 1 hour window

      if (recentDenials >= 10) {
        await this.audit.logSecurityEvent({
          type: 'repeated_access_denied',
          severity: 'medium',
          userId,
          details: {
            permission,
            resourceId,
            reason,
            denialCount: recentDenials
          },
          timestamp: new Date()
        });
      }

    } catch (error) {
      logger.error('Failed to log access denied', {
        userId,
        permission,
        resourceId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Express Middleware
  // ==========================================

  /**
   * Create permission middleware for Express routes
   */
  requirePermission(permission: Permission, resourceType?: string) {
    return async (req: AuthenticatedRequest, res: any, next: any) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'UNAUTHORIZED'
          });
        }

        const resourceId = resourceType ? req.params.id || req.params.resourceId : undefined;
        
        const hasPermission = await this.hasPermission(
          req.user.id,
          permission,
          resourceId,
          resourceType
        );

        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient permissions',
            code: 'FORBIDDEN',
            details: {
              requiredPermission: permission,
              resourceType,
              resourceId
            }
          });
        }

        next();
      } catch (error) {
        logger.error('Permission middleware failed', {
          userId: req.user?.id,
          permission,
          resourceType,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(500).json({
          success: false,
          message: 'Permission check failed',
          code: 'INTERNAL_ERROR'
        });
      }
    };
  }

  /**
   * Create role middleware for Express routes
   */
  requireRole(role: UserRole | UserRole[]) {
    const requiredRoles = Array.isArray(role) ? role : [role];
    
    return async (req: AuthenticatedRequest, res: any, next: any) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'UNAUTHORIZED'
          });
        }

        if (!requiredRoles.includes(req.user.role)) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient role privileges',
            code: 'FORBIDDEN',
            details: {
              requiredRoles,
              userRole: req.user.role
            }
          });
        }

        next();
      } catch (error) {
        logger.error('Role middleware failed', {
          userId: req.user?.id,
          requiredRoles,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(500).json({
          success: false,
          message: 'Role check failed',
          code: 'INTERNAL_ERROR'
        });
      }
    };
  }
}

// Export singleton instance
export const permissionManager = new PermissionManager();