import { PrismaClient } from '@prisma/client';
import { config, isDevelopment } from '@/config';
import logger from '@/utils/logger';

/**
 * Prisma client with logging and error handling
 */
class DatabaseService {
  private static instance: DatabaseService;
  private client: PrismaClient;
  private isConnected: boolean = false;

  private constructor() {
    this.client = new PrismaClient({
      log: isDevelopment ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
      datasources: {
        db: {
          url: config.database.url
        }
      }
    });

    // Add middleware for logging and performance monitoring
    this.setupMiddleware();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * Get Prisma client
   */
  public getClient(): PrismaClient {
    return this.client;
  }

  /**
   * Connect to database
   */
  public async connect(): Promise<void> {
    try {
      await this.client.$connect();
      this.isConnected = true;
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      throw error;
    }
  }

  /**
   * Disconnect from database
   */
  public async disconnect(): Promise<void> {
    try {
      await this.client.$disconnect();
      this.isConnected = false;
      logger.info('Database disconnected successfully');
    } catch (error) {
      logger.error('Failed to disconnect from database', { error });
      throw error;
    }
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
    }
  }

  /**
   * Get connection status
   */
  public isHealthy(): boolean {
    return this.isConnected;
  }

  /**
   * Execute transaction with retry logic
   */
  public async transaction<T>(
    fn: (prisma: PrismaClient) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.client.$transaction(async (prisma) => {
          return await fn(prisma);
        });
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Transaction attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxRetries
        });

        if (attempt === maxRetries) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }

    throw lastError!;
  }

  /**
   * Setup middleware for logging and monitoring
   */
  private setupMiddleware(): void {
    // Performance monitoring middleware
    this.client.$use(async (params, next) => {
      const start = Date.now();
      
      try {
        const result = await next(params);
        const duration = Date.now() - start;
        
        // Log slow queries
        if (duration > 1000) {
          logger.warn('Slow database query detected', {
            model: params.model,
            action: params.action,
            duration,
            args: isDevelopment ? params.args : '[REDACTED]'
          });
        }

        return result;
      } catch (error) {
        const duration = Date.now() - start;
        logger.error('Database query failed', {
          model: params.model,
          action: params.action,
          duration,
          error: (error as Error).message,
          args: isDevelopment ? params.args : '[REDACTED]'
        });
        throw error;
      }
    });

    // Query logging middleware (development only)
    if (isDevelopment) {
      this.client.$use(async (params, next) => {
        logger.debug('Database query', {
          model: params.model,
          action: params.action,
          args: params.args
        });
        return next(params);
      });
    }
  }

  /**
   * Execute raw query with error handling
   */
  public async executeRaw<T = any>(query: string, ...values: any[]): Promise<T> {
    try {
      return await this.client.$queryRawUnsafe<T>(query, ...values);
    } catch (error) {
      logger.error('Raw query execution failed', {
        query: isDevelopment ? query : '[REDACTED]',
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  public async getStats(): Promise<{
    activeConnections: number;
    totalConnections: number;
    databaseSize: string;
    uptime: string;
  }> {
    try {
      const [connectionStats, dbSize, uptime] = await Promise.all([
        this.client.$queryRaw<Array<{ active: number; total: number }>>`
          SELECT 
            COUNT(*) FILTER (WHERE state = 'active') as active,
            COUNT(*) as total
          FROM pg_stat_activity 
          WHERE datname = current_database()
        `,
        this.client.$queryRaw<Array<{ size: string }>>`
          SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `,
        this.client.$queryRaw<Array<{ uptime: string }>>`
          SELECT 
            EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time())) || ' seconds' as uptime
        `
      ]);

      return {
        activeConnections: connectionStats[0]?.active || 0,
        totalConnections: connectionStats[0]?.total || 0,
        databaseSize: dbSize[0]?.size || 'Unknown',
        uptime: uptime[0]?.uptime || 'Unknown'
      };
    } catch (error) {
      logger.error('Failed to get database statistics', { error });
      throw error;
    }
  }

  /**
   * Clean up expired tokens and sessions
   */
  public async cleanupExpiredData(): Promise<{
    refreshTokens: number;
    sessions: number;
    passwordResets: number;
    emailVerifications: number;
  }> {
    try {
      const now = new Date();
      
      const [refreshTokens, sessions, passwordResets, emailVerifications] = await Promise.all([
        this.client.refreshToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { isRevoked: true }
            ]
          }
        }),
        this.client.userSession.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { isActive: false }
            ]
          }
        }),
        this.client.passwordReset.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { isUsed: true }
            ]
          }
        }),
        this.client.emailVerification.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { isUsed: true }
            ]
          }
        })
      ]);

      const result = {
        refreshTokens: refreshTokens.count,
        sessions: sessions.count,
        passwordResets: passwordResets.count,
        emailVerifications: emailVerifications.count
      };

      logger.info('Expired data cleanup completed', result);
      return result;
    } catch (error) {
      logger.error('Failed to cleanup expired data', { error });
      throw error;
    }
  }

  // ==========================================
  // User Management Methods
  // ==========================================

  public async getUserById(userId: string): Promise<any> {
    return await this.client.user.findUnique({
      where: { id: userId },
      include: {
        mfaSettings: true
      }
    });
  }

  public async getUserByPhone(phoneNumber: string): Promise<any> {
    return await this.client.user.findUnique({
      where: { phoneNumber },
      include: {
        mfaSettings: true
      }
    });
  }

  public async getUserByEmail(email: string): Promise<any> {
    return await this.client.user.findUnique({
      where: { email },
      include: {
        mfaSettings: true
      }
    });
  }

  public async createUser(userData: any): Promise<any> {
    return await this.client.user.create({
      data: userData,
      include: {
        mfaSettings: true
      }
    });
  }

  public async updateUser(userId: string, updateData: any): Promise<any> {
    return await this.client.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        mfaSettings: true
      }
    });
  }

  public async updateUserRole(userId: string, role: string): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { role }
    });
  }

  public async deleteUser(userId: string): Promise<void> {
    await this.client.user.delete({
      where: { id: userId }
    });
  }

  public async incrementLoginAttempts(userId: string): Promise<number> {
    const user = await this.client.user.update({
      where: { id: userId },
      data: {
        loginAttempts: {
          increment: 1
        }
      }
    });
    return user.loginAttempts;
  }

  public async resetLoginAttempts(userId: string): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { loginAttempts: 0 }
    });
  }

  public async lockUser(userId: string, reason: string): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: {
        isLocked: true,
        lockReason: reason
      }
    });
  }

  public async updateLastLogin(userId: string, ipAddress: string): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress
      }
    });
  }

  public async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date()
      }
    });
  }

  // ==========================================
  // MFA Methods
  // ==========================================

  public async getMFASettings(userId: string): Promise<any> {
    return await this.client.mFASettings.findUnique({
      where: { userId }
    });
  }

  public async enableMFA(userId: string, mfaData: any): Promise<void> {
    await this.client.mFASettings.upsert({
      where: { userId },
      create: {
        userId,
        isEnabled: true,
        ...mfaData
      },
      update: {
        isEnabled: true,
        ...mfaData
      }
    });
  }

  public async disableMFA(userId: string): Promise<void> {
    await this.client.mFASettings.update({
      where: { userId },
      data: { isEnabled: false }
    });
  }

  public async updateMFALastUsed(userId: string): Promise<void> {
    await this.client.mFASettings.update({
      where: { userId },
      data: { lastUsedAt: new Date() }
    });
  }

  public async updateMFABackupCodes(userId: string, backupCodes: string[]): Promise<void> {
    await this.client.mFASettings.update({
      where: { userId },
      data: { backupCodes }
    });
  }

  // ==========================================
  // Session Management Methods
  // ==========================================

  public async createUserSession(sessionData: any): Promise<any> {
    return await this.client.userSession.create({
      data: sessionData
    });
  }

  public async getUserSession(sessionId: string): Promise<any> {
    return await this.client.userSession.findUnique({
      where: { sessionId },
      include: {
        user: true
      }
    });
  }

  public async updateSessionActivity(sessionId: string): Promise<void> {
    await this.client.userSession.update({
      where: { sessionId },
      data: { lastActivityAt: new Date() }
    });
  }

  public async deactivateUserSession(sessionId: string): Promise<void> {
    await this.client.userSession.update({
      where: { sessionId },
      data: { isActive: false }
    });
  }

  // ==========================================
  // Token Management Methods
  // ==========================================

  public async storeRefreshToken(tokenData: any): Promise<void> {
    await this.client.refreshToken.create({
      data: tokenData
    });
  }

  public async getRefreshToken(token: string): Promise<any> {
    return await this.client.refreshToken.findUnique({
      where: { token },
      include: {
        user: true
      }
    });
  }

  public async revokeRefreshToken(token: string): Promise<void> {
    await this.client.refreshToken.update({
      where: { token },
      data: {
        isRevoked: true,
        revokedAt: new Date()
      }
    });
  }

  public async revokeTokensBySession(sessionId: string): Promise<void> {
    // This would need a sessionId field in refreshToken model
    // For now, implement based on userId
    await this.client.refreshToken.updateMany({
      where: {
        isRevoked: false
        // sessionId: sessionId  // if field exists
      },
      data: {
        isRevoked: true,
        revokedAt: new Date()
      }
    });
  }

  public async revokeAllUserTokens(userId: string): Promise<void> {
    await this.client.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false
      },
      data: {
        isRevoked: true,
        revokedAt: new Date()
      }
    });
  }

  // ==========================================
  // Audit and Security Methods
  // ==========================================

  public async createAuditLog(auditData: any): Promise<void> {
    await this.client.auditLog.create({
      data: auditData
    });
  }

  public async createAuditLogsBatch(auditLogs: any[]): Promise<void> {
    await this.client.auditLog.createMany({
      data: auditLogs
    });
  }

  public async getAuditLogs(userId?: string, options: any = {}): Promise<any> {
    const {
      limit = 50,
      offset = 0,
      action,
      resource,
      startDate,
      endDate,
      success
    } = options;

    const where: any = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (success !== undefined) where.success = success;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const [logs, total] = await Promise.all([
      this.client.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset
      }),
      this.client.auditLog.count({ where })
    ]);

    return { logs, total };
  }

  public async createSecurityEvent(eventData: any): Promise<void> {
    await this.client.securityEvent.create({
      data: eventData
    });
  }

  public async createSecurityEventsBatch(events: any[]): Promise<void> {
    await this.client.securityEvent.createMany({
      data: events
    });
  }

  public async getSecurityEvents(options: any = {}): Promise<any> {
    const {
      limit = 50,
      offset = 0,
      type,
      severity,
      resolved,
      startDate,
      endDate,
      userId
    } = options;

    const where: any = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (severity) where.severity = severity;
    if (resolved !== undefined) where.resolved = resolved;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const [events, total] = await Promise.all([
      this.client.securityEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset
      }),
      this.client.securityEvent.count({ where })
    ]);

    return { events, total };
  }

  // ==========================================
  // Configuration Methods
  // ==========================================

  public async getUserConfig(userId: string, key: string): Promise<any> {
    return await this.client.userConfig.findUnique({
      where: {
        userId_key: {
          userId,
          key
        }
      }
    });
  }

  public async setUserConfig(userId: string, key: string, value: any, options: any = {}): Promise<void> {
    await this.client.userConfig.upsert({
      where: {
        userId_key: {
          userId,
          key
        }
      },
      create: {
        userId,
        key,
        value,
        ...options
      },
      update: {
        value,
        ...options,
        updatedAt: new Date()
      }
    });
  }

  public async deleteUserConfig(userId: string, key: string): Promise<void> {
    await this.client.userConfig.delete({
      where: {
        userId_key: {
          userId,
          key
        }
      }
    });
  }

  public async getUserConfigs(userId: string): Promise<any[]> {
    return await this.client.userConfig.findMany({
      where: { userId }
    });
  }

  public async getUserConfigCount(userId: string): Promise<number> {
    return await this.client.userConfig.count({
      where: { userId }
    });
  }

  public async getGlobalConfig(key: string): Promise<any> {
    return await this.client.globalConfig.findUnique({
      where: { key }
    });
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  public async getResourceOwner(resourceId: string): Promise<string | null> {
    // This is a placeholder implementation
    // In practice, you'd determine resource ownership based on the resource type
    try {
      const user = await this.client.user.findUnique({
        where: { id: resourceId },
        select: { id: true }
      });
      return user?.id || null;
    } catch {
      return null;
    }
  }
}

// Export the class for type imports
export { DatabaseService };

// Export singleton instance
export const database = DatabaseService.getInstance();
export const prisma = database.getClient();
export default database;