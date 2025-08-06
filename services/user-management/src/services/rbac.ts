import { config, rolePermissions } from '@/config';
import { logger } from '@/utils/logger';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { AuditService } from './audit';
import {
  User,
  UserRole,
  Permission,
  RolePermissions,
  AuthenticatedRequest,
  AuditAction
} from '@/types';

/**
 * Role-Based Access Control Service
 * Handles permissions, role management, and access control
 */
export class RBACService {
  private db: DatabaseService;
  private redis: RedisService;
  private audit: AuditService;
  private roleHierarchy: Record<UserRole, UserRole[]>;

  constructor() {
    this.db = new DatabaseService();
    this.redis = new RedisService();
    this.audit = new AuditService();

    // Define role hierarchy (higher roles inherit lower role permissions)
    this.roleHierarchy = {
      user: [],
      moderator: ['user'],
      admin: ['moderator', 'user'],
      system: ['admin', 'moderator', 'user']
    };
  }

  // ==========================================
  // Permission Checking Methods
  // ==========================================

  /**
   * Check if user has specific permission
   */
  async hasPermission(
    userId: string,
    permission: Permission,
    resourceId?: string
  ): Promise<boolean> {
    try {
      // Get user permissions from cache or database
      const userPermissions = await this.getUserPermissions(userId);
      
      // Check basic permission
      if (!userPermissions.includes(permission)) {
        return false;
      }

      // Check resource-specific permissions
      if (resourceId && permission.includes('own_')) {
        return await this.checkResourceOwnership(userId, permission, resourceId);
      }

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
   * Check multiple permissions (user must have ALL permissions)
   */
  async hasAllPermissions(
    userId: string,
    permissions: Permission[],
    resourceId?: string
  ): Promise<boolean> {
    try {
      for (const permission of permissions) {
        const hasPermission = await this.hasPermission(userId, permission, resourceId);
        if (!hasPermission) {
          return false;
        }
      }
      return true;
    } catch (error) {
      logger.error('Multiple permissions check failed', {
        userId,
        permissions,
        resourceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check any permissions (user must have AT LEAST ONE permission)
   */
  async hasAnyPermission(
    userId: string,
    permissions: Permission[],
    resourceId?: string
  ): Promise<boolean> {
    try {
      for (const permission of permissions) {
        const hasPermission = await this.hasPermission(userId, permission, resourceId);
        if (hasPermission) {
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.error('Any permissions check failed', {
        userId,
        permissions,
        resourceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check if user has role
   */
  async hasRole(userId: string, role: UserRole): Promise<boolean> {
    try {
      const user = await this.getUserFromCache(userId);
      if (!user) {
        return false;
      }

      // Direct role match
      if (user.role === role) {
        return true;
      }

      // Check role hierarchy
      const userRoleHierarchy = this.roleHierarchy[user.role] || [];
      return userRoleHierarchy.includes(role);
    } catch (error) {
      logger.error('Role check failed', {
        userId,
        role,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check if user has any of the specified roles
   */
  async hasAnyRole(userId: string, roles: UserRole[]): Promise<boolean> {
    try {
      for (const role of roles) {
        const hasRole = await this.hasRole(userId, role);
        if (hasRole) {
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.error('Any roles check failed', {
        userId,
        roles,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  // ==========================================
  // Permission Management Methods
  // ==========================================

  /**
   * Get user permissions (with caching)
   */
  async getUserPermissions(userId: string): Promise<Permission[]> {
    try {
      // Try cache first
      const cacheKey = `permissions:${userId}`;
      const cachedPermissions = await this.redis.getJSON<Permission[]>(cacheKey);
      
      if (cachedPermissions) {
        return cachedPermissions;
      }

      // Get user from database
      const user = await this.db.getUserById(userId);
      if (!user) {
        return [];
      }

      // Get base permissions for user role
      const basePermissions = this.getRolePermissions(user.role);
      
      // Get inherited permissions from role hierarchy
      const inheritedPermissions = this.getInheritedPermissions(user.role);
      
      // Combine and deduplicate permissions
      const allPermissions = [...new Set([...basePermissions, ...inheritedPermissions])];

      // Cache permissions
      await this.redis.setex(cacheKey, 1800, allPermissions); // 30 minutes

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
   * Get permissions for a specific role
   */
  getRolePermissions(role: UserRole): Permission[] {
    return rolePermissions[role] || rolePermissions.user;
  }

  /**
   * Get inherited permissions from role hierarchy
   */
  getInheritedPermissions(role: UserRole): Permission[] {
    const inherited: Permission[] = [];
    const hierarchy = this.roleHierarchy[role] || [];
    
    for (const inheritedRole of hierarchy) {
      const rolePerms = this.getRolePermissions(inheritedRole);
      inherited.push(...rolePerms);
    }
    
    return [...new Set(inherited)]; // Remove duplicates
  }

  /**
   * Clear user permissions cache
   */
  async clearUserPermissionsCache(userId: string): Promise<void> {
    try {
      await this.redis.delete(`permissions:${userId}`);
      await this.redis.delete(`user:${userId}`);
    } catch (error) {
      logger.error('Failed to clear user permissions cache', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Role Management Methods
  // ==========================================

  /**
   * Change user role (admin only)
   */
  async changeUserRole(
    targetUserId: string,
    newRole: UserRole,
    adminUserId: string,
    reason: string,
    ipAddress: string,
    userAgent: string
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

      // Get admin user
      const adminUser = await this.db.getUserById(adminUserId);
      if (!adminUser) {
        throw new Error('Admin user not found');
      }

      // Prevent role escalation above admin level (unless system admin)
      if (newRole === 'system' && adminUser.role !== 'system') {
        throw new Error('Only system administrators can assign system role');
      }

      // Prevent self-role modification to lower level
      if (targetUserId === adminUserId && this.isRoleLower(newRole, adminUser.role)) {
        throw new Error('Cannot demote your own role');
      }

      const oldRole = targetUser.role;

      // Update user role in database
      await this.db.updateUserRole(targetUserId, newRole);

      // Clear permissions cache
      await this.clearUserPermissionsCache(targetUserId);

      // Log role change
      await this.audit.log({
        userId: adminUserId,
        action: 'permissions_change',
        resource: 'user',
        details: {
          targetUserId,
          targetUserPhone: targetUser.phoneNumber,
          oldRole,
          newRole,
          reason
        },
        ipAddress,
        userAgent,
        success: true
      });

      // Log security event for role elevation
      if (this.isRoleHigher(newRole, oldRole)) {
        await this.audit.logSecurityEvent({
          type: 'privilege_escalation',
          severity: 'high',
          userId: targetUserId,
          details: {
            adminUserId,
            oldRole,
            newRole,
            reason
          },
          timestamp: new Date()
        });
      }

      logger.info('User role changed', {
        targetUserId,
        oldRole,
        newRole,
        adminUserId,
        reason
      });
    } catch (error) {
      logger.error('Role change failed', {
        targetUserId,
        newRole,
        adminUserId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Bulk role assignment (system admin only)
   */
  async bulkRoleAssignment(
    assignments: Array<{ userId: string; role: UserRole; reason: string }>,
    adminUserId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ success: string[]; failed: Array<{ userId: string; error: string }> }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ userId: string; error: string }>
    };

    // Verify admin is system admin
    const hasPermission = await this.hasRole(adminUserId, 'system');
    if (!hasPermission) {
      throw new Error('Only system administrators can perform bulk role assignments');
    }

    for (const assignment of assignments) {
      try {
        await this.changeUserRole(
          assignment.userId,
          assignment.role,
          adminUserId,
          assignment.reason,
          ipAddress,
          userAgent
        );
        results.success.push(assignment.userId);
      } catch (error) {
        results.failed.push({
          userId: assignment.userId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    logger.info('Bulk role assignment completed', {
      adminUserId,
      totalAssignments: assignments.length,
      successful: results.success.length,
      failed: results.failed.length
    });

    return results;
  }

  // ==========================================
  // Access Control Middleware Helpers
  // ==========================================

  /**
   * Create permission middleware
   */
  requirePermission(permission: Permission) {
    return async (req: AuthenticatedRequest, res: any, next: any) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required'
          });
        }

        const hasPermission = await this.hasPermission(userId, permission);
        if (!hasPermission) {
          // Log unauthorized access attempt
          await this.audit.log({
            userId,
            action: 'unauthorized_access',
            resource: req.route?.path || req.path,
            details: { 
              requiredPermission: permission,
              method: req.method
            },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || '',
            success: false
          });

          return res.status(403).json({
            success: false,
            message: 'Insufficient permissions'
          });
        }

        next();
      } catch (error) {
        logger.error('Permission middleware error', {
          permission,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(500).json({
          success: false,
          message: 'Permission check failed'
        });
      }
    };
  }

  /**
   * Create role middleware
   */
  requireRole(role: UserRole) {
    return async (req: AuthenticatedRequest, res: any, next: any) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required'
          });
        }

        const hasRole = await this.hasRole(userId, role);
        if (!hasRole) {
          // Log unauthorized access attempt
          await this.audit.log({
            userId,
            action: 'unauthorized_access',
            resource: req.route?.path || req.path,
            details: { 
              requiredRole: role,
              userRole: req.user.role,
              method: req.method
            },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || '',
            success: false
          });

          return res.status(403).json({
            success: false,
            message: 'Insufficient role'
          });
        }

        next();
      } catch (error) {
        logger.error('Role middleware error', {
          role,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(500).json({
          success: false,
          message: 'Role check failed'
        });
      }
    };
  }

  /**
   * Create resource ownership middleware
   */
  requireOwnership(resourceParam = 'id', allowAdmins = true) {
    return async (req: AuthenticatedRequest, res: any, next: any) => {
      try {
        const userId = req.user?.id;
        const resourceId = req.params[resourceParam];

        if (!userId || !resourceId) {
          return res.status(400).json({
            success: false,
            message: 'Invalid request parameters'
          });
        }

        // Admins can access any resource
        if (allowAdmins && await this.hasRole(userId, 'admin')) {
          return next();
        }

        // Check ownership
        const isOwner = await this.checkResourceOwnership(userId, 'read:own_data', resourceId);
        if (!isOwner) {
          await this.audit.log({
            userId,
            action: 'unauthorized_access',
            resource: req.route?.path || req.path,
            details: { 
              resourceId,
              resourceParam,
              method: req.method
            },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || '',
            success: false
          });

          return res.status(403).json({
            success: false,
            message: 'Access denied: Resource not owned by user'
          });
        }

        next();
      } catch (error) {
        logger.error('Ownership middleware error', {
          resourceParam,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(500).json({
          success: false,
          message: 'Ownership check failed'
        });
      }
    };
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Check resource ownership
   */
  private async checkResourceOwnership(
    userId: string,
    permission: Permission,
    resourceId: string
  ): Promise<boolean> {
    try {
      // For 'own_data' permissions, check if resource belongs to user
      if (permission.includes('own_')) {
        // Simple check: if resourceId matches userId
        if (resourceId === userId) {
          return true;
        }

        // For other resources, you might need to query the database
        // This is a placeholder - implement based on your resource structure
        const resourceOwner = await this.db.getResourceOwner(resourceId);
        return resourceOwner === userId;
      }

      return true;
    } catch (error) {
      logger.error('Resource ownership check failed', {
        userId,
        permission,
        resourceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get user from cache or database
   */
  private async getUserFromCache(userId: string): Promise<User | null> {
    try {
      // Try cache first
      const cachedUser = await this.redis.getCachedUser<User>(userId);
      if (cachedUser) {
        return cachedUser;
      }

      // Get from database and cache
      const user = await this.db.getUserById(userId);
      if (user) {
        await this.redis.cacheUser(userId, user, 1800); // 30 minutes
      }

      return user;
    } catch (error) {
      logger.error('Failed to get user from cache', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Check if role is higher in hierarchy
   */
  private isRoleHigher(role1: UserRole, role2: UserRole): boolean {
    const hierarchy: UserRole[] = ['user', 'moderator', 'admin', 'system'];
    return hierarchy.indexOf(role1) > hierarchy.indexOf(role2);
  }

  /**
   * Check if role is lower in hierarchy
   */
  private isRoleLower(role1: UserRole, role2: UserRole): boolean {
    const hierarchy: UserRole[] = ['user', 'moderator', 'admin', 'system'];
    return hierarchy.indexOf(role1) < hierarchy.indexOf(role2);
  }

  /**
   * Get all available permissions
   */
  getAllPermissions(): Permission[] {
    const allPermissions = new Set<Permission>();
    
    Object.values(rolePermissions).forEach(permissions => {
      permissions.forEach(permission => allPermissions.add(permission));
    });

    return Array.from(allPermissions);
  }

  /**
   * Get role hierarchy
   */
  getRoleHierarchy(): Record<UserRole, UserRole[]> {
    return { ...this.roleHierarchy };
  }
}

// Export singleton instance
export const rbacService = new RBACService();