/**
 * Role-Based Access Control Manager
 * Manages roles, permissions, and access control policies
 */

import { Role, Permission, AccessControlPolicy, AccessRestriction, User } from '../types';
import { logger } from '../utils/Logger';

export class RBACManager {
  private static instance: RBACManager;
  private roles: Map<string, Role> = new Map();
  private policies: Map<string, AccessControlPolicy> = new Map();
  
  // Default system roles
  private readonly SYSTEM_ROLES = {
    SUPER_ADMIN: {
      id: 'super_admin',
      name: 'Super Administrator',
      description: 'Full system access',
      permissions: [
        { id: 'all', resource: '*', action: '*' }
      ],
      isSystem: true
    },
    ADMIN: {
      id: 'admin',
      name: 'Administrator',
      description: 'Administrative access',
      permissions: [
        { id: 'users_manage', resource: 'users', action: 'manage' },
        { id: 'system_config', resource: 'system', action: 'configure' },
        { id: 'audit_view', resource: 'audit', action: 'read' },
        { id: 'security_manage', resource: 'security', action: 'manage' }
      ],
      isSystem: true
    },
    USER: {
      id: 'user',
      name: 'Regular User',
      description: 'Standard user access',
      permissions: [
        { id: 'profile_read', resource: 'profile', action: 'read', conditions: { own: true } },
        { id: 'profile_update', resource: 'profile', action: 'update', conditions: { own: true } },
        { id: 'calls_read', resource: 'calls', action: 'read', conditions: { own: true } },
        { id: 'whitelist_manage', resource: 'whitelist', action: 'manage', conditions: { own: true } }
      ],
      isSystem: true
    },
    SERVICE_ACCOUNT: {
      id: 'service_account',
      name: 'Service Account',
      description: 'Internal service access',
      permissions: [
        { id: 'api_access', resource: 'api', action: 'access' },
        { id: 'data_read', resource: 'data', action: 'read' },
        { id: 'data_write', resource: 'data', action: 'write' }
      ],
      isSystem: true
    }
  };
  
  private constructor() {
    this.initializeSystemRoles();
  }
  
  public static getInstance(): RBACManager {
    if (!RBACManager.instance) {
      RBACManager.instance = new RBACManager();
    }
    return RBACManager.instance;
  }
  
  /**
   * Initialize system roles
   */
  private initializeSystemRoles(): void {
    Object.values(this.SYSTEM_ROLES).forEach(role => {
      this.roles.set(role.id, {
        ...role,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
    
    logger.info('System roles initialized', {
      roles: Object.keys(this.SYSTEM_ROLES)
    });
  }
  
  /**
   * Check if user has permission
   */
  public async hasPermission(
    user: User,
    resource: string,
    action: string,
    resourceOwnerId?: string
  ): Promise<boolean> {
    try {
      // Check user status
      if (!user.isActive || user.isLocked) {
        logger.warn('Permission denied - user inactive or locked', {
          userId: user.id,
          resource,
          action
        });
        return false;
      }
      
      // Get user's effective permissions
      const permissions = await this.getUserPermissions(user);
      
      // Check for wildcard permission (super admin)
      if (this.hasWildcardPermission(permissions)) {
        logger.debug('Permission granted - wildcard access', {
          userId: user.id,
          resource,
          action
        });
        return true;
      }
      
      // Check specific permission
      for (const permission of permissions) {
        if (this.matchesPermission(permission, resource, action, user.id, resourceOwnerId)) {
          logger.debug('Permission granted', {
            userId: user.id,
            resource,
            action,
            permission: permission.id
          });
          return true;
        }
      }
      
      logger.warn('Permission denied', {
        userId: user.id,
        resource,
        action
      });
      
      return false;
    } catch (error) {
      logger.error('Permission check failed', {
        userId: user.id,
        resource,
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Check if user has any of the required roles
   */
  public hasRole(user: User, requiredRoles: string[]): boolean {
    return requiredRoles.some(role => user.roles.includes(role));
  }
  
  /**
   * Check if user has all required roles
   */
  public hasAllRoles(user: User, requiredRoles: string[]): boolean {
    return requiredRoles.every(role => user.roles.includes(role));
  }
  
  /**
   * Get user's effective permissions
   */
  public async getUserPermissions(user: User): Promise<Permission[]> {
    const permissions: Permission[] = [];
    const addedPermissions = new Set<string>();
    
    // Collect permissions from all user roles
    for (const roleId of user.roles) {
      const role = this.roles.get(roleId);
      if (role) {
        for (const permission of role.permissions) {
          const permKey = `${permission.resource}:${permission.action}`;
          if (!addedPermissions.has(permKey)) {
            permissions.push(permission);
            addedPermissions.add(permKey);
          }
        }
      }
    }
    
    // Add direct user permissions
    for (const permission of user.permissions) {
      const [resource, action] = permission.split(':');
      const permKey = permission;
      if (!addedPermissions.has(permKey)) {
        permissions.push({
          id: permission,
          resource,
          action
        });
        addedPermissions.add(permKey);
      }
    }
    
    return permissions;
  }
  
  /**
   * Create new role
   */
  public async createRole(
    name: string,
    description: string,
    permissions: Permission[]
  ): Promise<Role> {
    try {
      const roleId = this.generateRoleId(name);
      
      if (this.roles.has(roleId)) {
        throw new Error('Role already exists');
      }
      
      const role: Role = {
        id: roleId,
        name,
        description,
        permissions,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.roles.set(roleId, role);
      
      logger.info('Role created', {
        roleId,
        name,
        permissions: permissions.length
      });
      
      return role;
    } catch (error) {
      logger.error('Failed to create role', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Update role permissions
   */
  public async updateRolePermissions(
    roleId: string,
    permissions: Permission[]
  ): Promise<Role> {
    try {
      const role = this.roles.get(roleId);
      
      if (!role) {
        throw new Error('Role not found');
      }
      
      if (role.isSystem) {
        throw new Error('Cannot modify system role');
      }
      
      role.permissions = permissions;
      role.updatedAt = new Date();
      
      logger.info('Role permissions updated', {
        roleId,
        permissions: permissions.length
      });
      
      return role;
    } catch (error) {
      logger.error('Failed to update role permissions', {
        roleId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Delete role
   */
  public async deleteRole(roleId: string): Promise<void> {
    try {
      const role = this.roles.get(roleId);
      
      if (!role) {
        throw new Error('Role not found');
      }
      
      if (role.isSystem) {
        throw new Error('Cannot delete system role');
      }
      
      this.roles.delete(roleId);
      
      logger.info('Role deleted', { roleId });
    } catch (error) {
      logger.error('Failed to delete role', {
        roleId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Create access control policy
   */
  public async createAccessPolicy(
    userId: string,
    roles: string[],
    permissions: string[],
    restrictions?: AccessRestriction[]
  ): Promise<AccessControlPolicy> {
    try {
      const policy: AccessControlPolicy = {
        userId,
        roles,
        permissions,
        restrictions,
        effectiveFrom: new Date()
      };
      
      this.policies.set(userId, policy);
      
      logger.info('Access policy created', {
        userId,
        roles: roles.length,
        permissions: permissions.length,
        restrictions: restrictions?.length || 0
      });
      
      return policy;
    } catch (error) {
      logger.error('Failed to create access policy', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Evaluate access restrictions
   */
  public async evaluateRestrictions(
    userId: string,
    context: {
      ipAddress?: string;
      deviceFingerprint?: string;
      location?: { lat: number; lng: number };
      timestamp?: Date;
    }
  ): Promise<boolean> {
    try {
      const policy = this.policies.get(userId);
      
      if (!policy || !policy.restrictions) {
        return true; // No restrictions
      }
      
      // Check time-based restrictions
      const now = context.timestamp || new Date();
      if (policy.effectiveUntil && now > policy.effectiveUntil) {
        logger.warn('Access denied - policy expired', { userId });
        return false;
      }
      
      // Evaluate each restriction
      for (const restriction of policy.restrictions) {
        const allowed = await this.evaluateRestriction(restriction, context);
        
        if (restriction.action === 'deny' && allowed) {
          logger.warn('Access denied by restriction', {
            userId,
            restriction: restriction.type
          });
          return false;
        }
        
        if (restriction.action === 'allow' && !allowed) {
          logger.warn('Access not allowed by restriction', {
            userId,
            restriction: restriction.type
          });
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to evaluate restrictions', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Evaluate single restriction
   */
  private async evaluateRestriction(
    restriction: AccessRestriction,
    context: any
  ): Promise<boolean> {
    switch (restriction.type) {
      case 'ip':
        return this.matchesIPPattern(context.ipAddress, restriction.value);
        
      case 'time':
        return this.matchesTimeWindow(new Date(), restriction.value);
        
      case 'location':
        return this.matchesLocation(context.location, restriction.value);
        
      case 'device':
        return context.deviceFingerprint === restriction.value;
        
      default:
        return false;
    }
  }
  
  /**
   * Check if permission matches request
   */
  private matchesPermission(
    permission: Permission,
    resource: string,
    action: string,
    userId: string,
    resourceOwnerId?: string
  ): boolean {
    // Check resource match
    if (permission.resource !== '*' && permission.resource !== resource) {
      return false;
    }
    
    // Check action match
    if (permission.action !== '*' && permission.action !== action) {
      return false;
    }
    
    // Check conditions
    if (permission.conditions) {
      if (permission.conditions.own && userId !== resourceOwnerId) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Check for wildcard permission
   */
  private hasWildcardPermission(permissions: Permission[]): boolean {
    return permissions.some(p => p.resource === '*' && p.action === '*');
  }
  
  /**
   * Generate role ID from name
   */
  private generateRoleId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }
  
  /**
   * Match IP pattern
   */
  private matchesIPPattern(ipAddress: string | undefined, pattern: string): boolean {
    if (!ipAddress) return false;
    
    // Simple IP matching - in production use proper IP range matching
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(ipAddress);
    }
    
    return ipAddress === pattern;
  }
  
  /**
   * Match time window
   */
  private matchesTimeWindow(time: Date, window: any): boolean {
    const hour = time.getHours();
    const day = time.getDay();
    
    if (window.startHour !== undefined && window.endHour !== undefined) {
      if (hour < window.startHour || hour > window.endHour) {
        return false;
      }
    }
    
    if (window.allowedDays && !window.allowedDays.includes(day)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Match location
   */
  private matchesLocation(location: any, allowedLocation: any): boolean {
    if (!location) return false;
    
    // Simple distance check - in production use proper geolocation
    const distance = this.calculateDistance(
      location.lat,
      location.lng,
      allowedLocation.lat,
      allowedLocation.lng
    );
    
    return distance <= (allowedLocation.radiusKm || 10);
  }
  
  /**
   * Calculate distance between coordinates
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    // Haversine formula
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }
  
  /**
   * Get all roles
   */
  public getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }
  
  /**
   * Get role by ID
   */
  public getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }
}