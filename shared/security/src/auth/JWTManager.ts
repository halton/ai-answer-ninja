/**
 * JWT Manager
 * Handles JWT token generation, validation, and refresh
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { JWTPayload, User, UserSession } from '../types';
import { KeyManagement } from '../encryption/KeyManagement';
import { logger } from '../utils/Logger';

export class JWTManager {
  private static instance: JWTManager;
  private keyManager: KeyManagement;
  private readonly DEFAULT_EXPIRY = '1h';
  private readonly REFRESH_EXPIRY = '7d';
  private readonly ISSUER = 'ai-answer-ninja';
  private readonly AUDIENCE = 'ai-answer-ninja-api';
  
  // Token blacklist for revoked tokens (in production, use Redis)
  private blacklist: Set<string> = new Set();
  
  private constructor() {
    this.keyManager = KeyManagement.getInstance();
  }
  
  public static getInstance(): JWTManager {
    if (!JWTManager.instance) {
      JWTManager.instance = new JWTManager();
    }
    return JWTManager.instance;
  }
  
  /**
   * Generate access token
   */
  public async generateAccessToken(
    user: User,
    sessionId: string,
    deviceFingerprint?: string
  ): Promise<string> {
    try {
      const payload: JWTPayload = {
        userId: user.id,
        sessionId,
        permissions: user.permissions,
        roles: user.roles,
        deviceFingerprint,
        iss: this.ISSUER,
        aud: this.AUDIENCE
      };
      
      const secret = await this.keyManager.getJWTSecret();
      
      const token = jwt.sign(payload, secret, {
        expiresIn: this.DEFAULT_EXPIRY,
        algorithm: 'HS256',
        jwtid: this.generateJTI()
      });
      
      logger.info('Access token generated', {
        userId: user.id,
        sessionId,
        expiresIn: this.DEFAULT_EXPIRY
      });
      
      return token;
    } catch (error) {
      logger.error('Failed to generate access token', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Token generation failed');
    }
  }
  
  /**
   * Generate refresh token
   */
  public async generateRefreshToken(
    userId: string,
    sessionId: string
  ): Promise<string> {
    try {
      const payload = {
        userId,
        sessionId,
        type: 'refresh',
        iss: this.ISSUER,
        aud: this.AUDIENCE
      };
      
      const secret = await this.keyManager.getJWTRefreshSecret();
      
      const token = jwt.sign(payload, secret, {
        expiresIn: this.REFRESH_EXPIRY,
        algorithm: 'HS256',
        jwtid: this.generateJTI()
      });
      
      logger.info('Refresh token generated', {
        userId,
        sessionId,
        expiresIn: this.REFRESH_EXPIRY
      });
      
      return token;
    } catch (error) {
      logger.error('Failed to generate refresh token', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Refresh token generation failed');
    }
  }
  
  /**
   * Verify access token
   */
  public async verifyAccessToken(token: string): Promise<JWTPayload> {
    try {
      // Check if token is blacklisted
      if (this.isTokenBlacklisted(token)) {
        throw new Error('Token has been revoked');
      }
      
      const secret = await this.keyManager.getJWTSecret();
      
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: this.ISSUER,
        audience: this.AUDIENCE
      }) as JWTPayload;
      
      logger.debug('Access token verified', {
        userId: decoded.userId,
        sessionId: decoded.sessionId
      });
      
      return decoded;
    } catch (error) {
      logger.warn('Access token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      
      throw error;
    }
  }
  
  /**
   * Verify refresh token
   */
  public async verifyRefreshToken(token: string): Promise<any> {
    try {
      // Check if token is blacklisted
      if (this.isTokenBlacklisted(token)) {
        throw new Error('Token has been revoked');
      }
      
      const secret = await this.keyManager.getJWTRefreshSecret();
      
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: this.ISSUER,
        audience: this.AUDIENCE
      });
      
      if ((decoded as any).type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      
      logger.debug('Refresh token verified', {
        userId: (decoded as any).userId,
        sessionId: (decoded as any).sessionId
      });
      
      return decoded;
    } catch (error) {
      logger.warn('Refresh token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      
      throw error;
    }
  }
  
  /**
   * Refresh access token using refresh token
   */
  public async refreshAccessToken(
    refreshToken: string,
    user: User,
    deviceFingerprint?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const decoded = await this.verifyRefreshToken(refreshToken);
      
      // Verify user ID matches
      if (decoded.userId !== user.id) {
        throw new Error('User mismatch');
      }
      
      // Generate new tokens
      const newAccessToken = await this.generateAccessToken(
        user,
        decoded.sessionId,
        deviceFingerprint
      );
      
      const newRefreshToken = await this.generateRefreshToken(
        user.id,
        decoded.sessionId
      );
      
      // Revoke old refresh token
      this.revokeToken(refreshToken);
      
      logger.info('Tokens refreshed', {
        userId: user.id,
        sessionId: decoded.sessionId
      });
      
      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      logger.error('Token refresh failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Revoke token
   */
  public revokeToken(token: string): void {
    try {
      const decoded = jwt.decode(token) as any;
      if (decoded?.jti) {
        this.blacklist.add(decoded.jti);
        
        logger.info('Token revoked', {
          jti: decoded.jti,
          userId: decoded.userId
        });
      }
    } catch (error) {
      logger.error('Failed to revoke token', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * Revoke all tokens for a user
   */
  public async revokeAllUserTokens(userId: string): Promise<void> {
    // In production, this would clear all tokens from Redis/database
    logger.info('All user tokens revoked', { userId });
  }
  
  /**
   * Check if token is blacklisted
   */
  private isTokenBlacklisted(token: string): boolean {
    try {
      const decoded = jwt.decode(token) as any;
      return decoded?.jti ? this.blacklist.has(decoded.jti) : false;
    } catch {
      return false;
    }
  }
  
  /**
   * Generate JWT ID
   */
  private generateJTI(): string {
    return crypto.randomBytes(16).toString('hex');
  }
  
  /**
   * Extract token from Authorization header
   */
  public extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) return null;
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }
    
    return parts[1];
  }
  
  /**
   * Decode token without verification (for debugging)
   */
  public decodeToken(token: string): any {
    return jwt.decode(token);
  }
  
  /**
   * Generate short-lived token for specific actions
   */
  public async generateActionToken(
    userId: string,
    action: string,
    data?: any,
    expiresIn: string = '15m'
  ): Promise<string> {
    try {
      const payload = {
        userId,
        action,
        data,
        type: 'action',
        iss: this.ISSUER,
        aud: this.AUDIENCE
      };
      
      const secret = await this.keyManager.getJWTSecret();
      
      const token = jwt.sign(payload, secret, {
        expiresIn,
        algorithm: 'HS256',
        jwtid: this.generateJTI()
      });
      
      logger.info('Action token generated', {
        userId,
        action,
        expiresIn
      });
      
      return token;
    } catch (error) {
      logger.error('Failed to generate action token', {
        userId,
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Action token generation failed');
    }
  }
  
  /**
   * Verify action token
   */
  public async verifyActionToken(
    token: string,
    expectedAction: string
  ): Promise<any> {
    try {
      const secret = await this.keyManager.getJWTSecret();
      
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: this.ISSUER,
        audience: this.AUDIENCE
      }) as any;
      
      if (decoded.type !== 'action') {
        throw new Error('Invalid token type');
      }
      
      if (decoded.action !== expectedAction) {
        throw new Error('Action mismatch');
      }
      
      logger.debug('Action token verified', {
        userId: decoded.userId,
        action: decoded.action
      });
      
      return decoded;
    } catch (error) {
      logger.warn('Action token verification failed', {
        expectedAction,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Clean up expired tokens from blacklist
   */
  public cleanupBlacklist(): void {
    // In production, this would be handled by Redis TTL
    // For now, clear the in-memory set periodically
    if (this.blacklist.size > 10000) {
      this.blacklist.clear();
      logger.info('Token blacklist cleared');
    }
  }
}