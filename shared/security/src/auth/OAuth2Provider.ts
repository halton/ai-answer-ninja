/**
 * OAuth2 Provider
 * Handles OAuth2 authentication flows
 */

import crypto from 'crypto';
import { User } from '../types';
import { JWTManager } from './JWTManager';
import { logger } from '../utils/Logger';

interface OAuth2Client {
  id: string;
  secret: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string[];
  isActive: boolean;
}

interface AuthorizationCode {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: Date;
  used: boolean;
}

interface AccessToken {
  token: string;
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
}

interface RefreshToken {
  token: string;
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
}

export class OAuth2Provider {
  private static instance: OAuth2Provider;
  private jwtManager: JWTManager;
  
  // In-memory storage (use database in production)
  private clients: Map<string, OAuth2Client> = new Map();
  private authCodes: Map<string, AuthorizationCode> = new Map();
  private accessTokens: Map<string, AccessToken> = new Map();
  private refreshTokens: Map<string, RefreshToken> = new Map();
  
  private readonly CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes
  private readonly ACCESS_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
  private readonly REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
  
  private constructor() {
    this.jwtManager = JWTManager.getInstance();
    this.initializeDefaultClients();
  }
  
  public static getInstance(): OAuth2Provider {
    if (!OAuth2Provider.instance) {
      OAuth2Provider.instance = new OAuth2Provider();
    }
    return OAuth2Provider.instance;
  }
  
  /**
   * Initialize default OAuth2 clients
   */
  private initializeDefaultClients(): void {
    // Web application client
    this.clients.set('web-client', {
      id: 'web-client',
      secret: this.generateClientSecret(),
      name: 'Web Application',
      redirectUris: [
        'http://localhost:3000/callback',
        'https://app.ai-answer-ninja.com/callback'
      ],
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['profile', 'calls', 'whitelist'],
      isActive: true
    });
    
    // Mobile application client
    this.clients.set('mobile-client', {
      id: 'mobile-client',
      secret: this.generateClientSecret(),
      name: 'Mobile Application',
      redirectUris: [
        'com.aininja://callback',
        'ai-ninja://callback'
      ],
      grantTypes: ['authorization_code', 'refresh_token', 'password'],
      scopes: ['profile', 'calls', 'whitelist'],
      isActive: true
    });
    
    // Service-to-service client
    this.clients.set('service-client', {
      id: 'service-client',
      secret: this.generateClientSecret(),
      name: 'Internal Services',
      redirectUris: [],
      grantTypes: ['client_credentials'],
      scopes: ['api', 'data:read', 'data:write'],
      isActive: true
    });
    
    logger.info('OAuth2 clients initialized', {
      clients: Array.from(this.clients.keys())
    });
  }
  
  /**
   * Register new OAuth2 client
   */
  public async registerClient(
    name: string,
    redirectUris: string[],
    grantTypes: string[],
    scopes: string[]
  ): Promise<OAuth2Client> {
    try {
      const clientId = this.generateClientId();
      const clientSecret = this.generateClientSecret();
      
      const client: OAuth2Client = {
        id: clientId,
        secret: clientSecret,
        name,
        redirectUris,
        grantTypes,
        scopes,
        isActive: true
      };
      
      this.clients.set(clientId, client);
      
      logger.info('OAuth2 client registered', {
        clientId,
        name,
        grantTypes,
        scopes
      });
      
      return client;
    } catch (error) {
      logger.error('Failed to register OAuth2 client', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Validate client credentials
   */
  public validateClient(clientId: string, clientSecret?: string): OAuth2Client | null {
    const client = this.clients.get(clientId);
    
    if (!client || !client.isActive) {
      logger.warn('Invalid or inactive client', { clientId });
      return null;
    }
    
    if (clientSecret && client.secret !== clientSecret) {
      logger.warn('Invalid client secret', { clientId });
      return null;
    }
    
    return client;
  }
  
  /**
   * Generate authorization code
   */
  public async generateAuthorizationCode(
    clientId: string,
    userId: string,
    redirectUri: string,
    scopes: string[],
    state?: string
  ): Promise<string> {
    try {
      const client = this.validateClient(clientId);
      if (!client) {
        throw new Error('Invalid client');
      }
      
      // Validate redirect URI
      if (!client.redirectUris.includes(redirectUri)) {
        throw new Error('Invalid redirect URI');
      }
      
      // Validate scopes
      const validScopes = scopes.filter(scope => client.scopes.includes(scope));
      if (validScopes.length !== scopes.length) {
        throw new Error('Invalid scopes');
      }
      
      const code = this.generateSecureToken();
      
      const authCode: AuthorizationCode = {
        code,
        clientId,
        userId,
        redirectUri,
        scopes: validScopes,
        expiresAt: new Date(Date.now() + this.CODE_EXPIRY),
        used: false
      };
      
      this.authCodes.set(code, authCode);
      
      logger.info('Authorization code generated', {
        clientId,
        userId,
        scopes: validScopes
      });
      
      return code;
    } catch (error) {
      logger.error('Failed to generate authorization code', {
        clientId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Exchange authorization code for tokens
   */
  public async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      // Validate client
      const client = this.validateClient(clientId, clientSecret);
      if (!client) {
        throw new Error('Invalid client credentials');
      }
      
      // Get authorization code
      const authCode = this.authCodes.get(code);
      if (!authCode) {
        throw new Error('Invalid authorization code');
      }
      
      // Validate code
      if (authCode.used) {
        throw new Error('Authorization code already used');
      }
      
      if (authCode.expiresAt < new Date()) {
        throw new Error('Authorization code expired');
      }
      
      if (authCode.clientId !== clientId) {
        throw new Error('Client mismatch');
      }
      
      if (authCode.redirectUri !== redirectUri) {
        throw new Error('Redirect URI mismatch');
      }
      
      // Mark code as used
      authCode.used = true;
      
      // Generate tokens
      const accessToken = await this.generateAccessToken(
        clientId,
        authCode.userId,
        authCode.scopes
      );
      
      const refreshToken = await this.generateRefreshToken(
        clientId,
        authCode.userId,
        authCode.scopes
      );
      
      logger.info('Code exchanged for tokens', {
        clientId,
        userId: authCode.userId,
        scopes: authCode.scopes
      });
      
      return {
        accessToken,
        refreshToken,
        expiresIn: this.ACCESS_TOKEN_EXPIRY / 1000
      };
    } catch (error) {
      logger.error('Failed to exchange code for tokens', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Generate access token
   */
  private async generateAccessToken(
    clientId: string,
    userId: string,
    scopes: string[]
  ): Promise<string> {
    const token = this.generateSecureToken();
    
    const accessToken: AccessToken = {
      token,
      clientId,
      userId,
      scopes,
      expiresAt: new Date(Date.now() + this.ACCESS_TOKEN_EXPIRY)
    };
    
    this.accessTokens.set(token, accessToken);
    
    return token;
  }
  
  /**
   * Generate refresh token
   */
  private async generateRefreshToken(
    clientId: string,
    userId: string,
    scopes: string[]
  ): Promise<string> {
    const token = this.generateSecureToken();
    
    const refreshToken: RefreshToken = {
      token,
      clientId,
      userId,
      scopes,
      expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY)
    };
    
    this.refreshTokens.set(token, refreshToken);
    
    return token;
  }
  
  /**
   * Refresh access token
   */
  public async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      // Validate client
      const client = this.validateClient(clientId, clientSecret);
      if (!client) {
        throw new Error('Invalid client credentials');
      }
      
      // Get refresh token
      const storedToken = this.refreshTokens.get(refreshToken);
      if (!storedToken) {
        throw new Error('Invalid refresh token');
      }
      
      // Validate token
      if (storedToken.expiresAt < new Date()) {
        throw new Error('Refresh token expired');
      }
      
      if (storedToken.clientId !== clientId) {
        throw new Error('Client mismatch');
      }
      
      // Generate new access token
      const accessToken = await this.generateAccessToken(
        clientId,
        storedToken.userId,
        storedToken.scopes
      );
      
      logger.info('Access token refreshed', {
        clientId,
        userId: storedToken.userId
      });
      
      return {
        accessToken,
        expiresIn: this.ACCESS_TOKEN_EXPIRY / 1000
      };
    } catch (error) {
      logger.error('Failed to refresh access token', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Validate access token
   */
  public validateAccessToken(token: string): AccessToken | null {
    const accessToken = this.accessTokens.get(token);
    
    if (!accessToken) {
      logger.warn('Invalid access token');
      return null;
    }
    
    if (accessToken.expiresAt < new Date()) {
      logger.warn('Access token expired');
      this.accessTokens.delete(token);
      return null;
    }
    
    return accessToken;
  }
  
  /**
   * Revoke token
   */
  public revokeToken(token: string, tokenType: 'access' | 'refresh'): boolean {
    try {
      if (tokenType === 'access') {
        const deleted = this.accessTokens.delete(token);
        if (deleted) {
          logger.info('Access token revoked');
        }
        return deleted;
      } else {
        const deleted = this.refreshTokens.delete(token);
        if (deleted) {
          logger.info('Refresh token revoked');
        }
        return deleted;
      }
    } catch (error) {
      logger.error('Failed to revoke token', {
        tokenType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
  
  /**
   * Client credentials grant
   */
  public async clientCredentialsGrant(
    clientId: string,
    clientSecret: string,
    scopes: string[]
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      // Validate client
      const client = this.validateClient(clientId, clientSecret);
      if (!client) {
        throw new Error('Invalid client credentials');
      }
      
      // Check grant type
      if (!client.grantTypes.includes('client_credentials')) {
        throw new Error('Grant type not allowed');
      }
      
      // Validate scopes
      const validScopes = scopes.filter(scope => client.scopes.includes(scope));
      if (validScopes.length !== scopes.length) {
        throw new Error('Invalid scopes');
      }
      
      // Generate service token (no user ID)
      const accessToken = await this.generateAccessToken(
        clientId,
        'service',
        validScopes
      );
      
      logger.info('Client credentials token issued', {
        clientId,
        scopes: validScopes
      });
      
      return {
        accessToken,
        expiresIn: this.ACCESS_TOKEN_EXPIRY / 1000
      };
    } catch (error) {
      logger.error('Client credentials grant failed', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Resource owner password grant (should be avoided in production)
   */
  public async passwordGrant(
    clientId: string,
    clientSecret: string,
    username: string,
    password: string,
    scopes: string[]
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      // Validate client
      const client = this.validateClient(clientId, clientSecret);
      if (!client) {
        throw new Error('Invalid client credentials');
      }
      
      // Check grant type
      if (!client.grantTypes.includes('password')) {
        throw new Error('Grant type not allowed');
      }
      
      // Validate user credentials (placeholder)
      const userId = await this.validateUserCredentials(username, password);
      if (!userId) {
        throw new Error('Invalid user credentials');
      }
      
      // Validate scopes
      const validScopes = scopes.filter(scope => client.scopes.includes(scope));
      
      // Generate tokens
      const accessToken = await this.generateAccessToken(clientId, userId, validScopes);
      const refreshToken = await this.generateRefreshToken(clientId, userId, validScopes);
      
      logger.info('Password grant tokens issued', {
        clientId,
        userId,
        scopes: validScopes
      });
      
      return {
        accessToken,
        refreshToken,
        expiresIn: this.ACCESS_TOKEN_EXPIRY / 1000
      };
    } catch (error) {
      logger.error('Password grant failed', {
        clientId,
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Validate user credentials (placeholder)
   */
  private async validateUserCredentials(username: string, password: string): Promise<string | null> {
    // In production, validate against database
    logger.debug('User credentials validation', { username });
    return 'user-id';
  }
  
  /**
   * Generate client ID
   */
  private generateClientId(): string {
    return `client_${crypto.randomBytes(16).toString('hex')}`;
  }
  
  /**
   * Generate client secret
   */
  private generateClientSecret(): string {
    return crypto.randomBytes(32).toString('base64');
  }
  
  /**
   * Generate secure token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
  
  /**
   * Clean up expired tokens
   */
  public cleanupExpiredTokens(): void {
    const now = new Date();
    
    // Clean authorization codes
    for (const [code, authCode] of this.authCodes.entries()) {
      if (authCode.expiresAt < now || authCode.used) {
        this.authCodes.delete(code);
      }
    }
    
    // Clean access tokens
    for (const [token, accessToken] of this.accessTokens.entries()) {
      if (accessToken.expiresAt < now) {
        this.accessTokens.delete(token);
      }
    }
    
    // Clean refresh tokens
    for (const [token, refreshToken] of this.refreshTokens.entries()) {
      if (refreshToken.expiresAt < now) {
        this.refreshTokens.delete(token);
      }
    }
    
    logger.debug('Expired tokens cleaned up');
  }
}