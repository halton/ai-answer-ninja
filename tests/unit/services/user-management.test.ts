/**
 * Unit Tests for User Management Service
 * 
 * Tests user authentication, authorization, profile management,
 * and security features with comprehensive mocking.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// Mock external dependencies
jest.mock('jsonwebtoken');
jest.mock('bcrypt');
jest.mock('pg');

describe('User Management Service', () => {
  let app: any;
  let mockDatabase: any;

  beforeEach(async () => {
    // Setup database mock
    mockDatabase = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Mock JWT
    (jwt.sign as jest.Mock).mockReturnValue('mock-jwt-token');
    (jwt.verify as jest.Mock).mockReturnValue({ userId: 'test-user-123', email: 'test@example.com' });

    // Mock bcrypt
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    // Reset all mocks
    jest.clearAllMocks();

    // Import app after mocks
    const userMgmtModule = await import('../../../services/user-management/src/server');
    app = userMgmtModule.default || userMgmtModule.app;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toBeHealthy();
      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'user-management',
        timestamp: expect.any(String)
      });
    });

    it('should check database connection health', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [{ now: '2023-12-01T10:00:00Z' }] });

      const response = await request(app)
        .get('/health/detailed')
        .expect(200);

      expect(response.body.dependencies).toContainEqual(
        expect.objectContaining({
          name: 'database',
          status: 'healthy'
        })
      );
    });
  });

  describe('User Registration', () => {
    it('should register new user successfully', async () => {
      const newUser = {
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        name: 'New User',
        phone: '+1234567890'
      };

      mockDatabase.query
        .mockResolvedValueOnce({ rows: [] }) // Check if user exists - returns empty
        .mockResolvedValueOnce({ // Insert new user
          rows: [{
            id: 'new-user-456',
            email: newUser.email,
            name: newUser.name,
            phone: newUser.phone,
            created_at: new Date().toISOString()
          }]
        });

      const response = await request(app)
        .post('/auth/register')
        .send(newUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.user).toMatchObject({
        id: 'new-user-456',
        email: newUser.email,
        name: newUser.name,
        phone: newUser.phone
      });
      expect(response.body.user).not.toHaveProperty('password');
      expect(response.body.token).toBe('mock-jwt-token');

      // Verify password was hashed
      expect(bcrypt.hash).toHaveBeenCalledWith(newUser.password, 10);
    });

    it('should reject registration with existing email', async () => {
      const existingUser = {
        email: 'existing@example.com',
        password: 'password123',
        name: 'Existing User',
        phone: '+1234567891'
      };

      mockDatabase.query.mockResolvedValue({
        rows: [{ id: 'existing-user-123', email: existingUser.email }]
      });

      const response = await request(app)
        .post('/auth/register')
        .send(existingUser)
        .expect(400);

      expect(response.body.error).toContain('Email already registered');
    });

    it('should validate password strength', async () => {
      const weakPasswordUser = {
        email: 'test@example.com',
        password: '123', // Too weak
        name: 'Test User',
        phone: '+1234567890'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(weakPasswordUser)
        .expect(400);

      expect(response.body.error).toContain('Password does not meet security requirements');
    });

    it('should validate email format', async () => {
      const invalidEmailUser = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
        name: 'Test User',
        phone: '+1234567890'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidEmailUser)
        .expect(400);

      expect(response.body.error).toContain('Invalid email format');
    });

    it('should validate phone number format', async () => {
      const invalidPhoneUser = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        name: 'Test User',
        phone: 'invalid-phone'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidPhoneUser)
        .expect(400);

      expect(response.body.error).toContain('Invalid phone number format');
    });
  });

  describe('User Authentication', () => {
    const testUser = {
      id: 'test-user-123',
      email: 'test@example.com',
      name: 'Test User',
      phone: '+1234567890',
      password_hash: 'hashed-password',
      is_active: true,
      failed_login_attempts: 0,
      last_login: null
    };

    it('should authenticate user with valid credentials', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [testUser] });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'correct-password'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user).toMatchObject({
        id: testUser.id,
        email: testUser.email,
        name: testUser.name
      });
      expect(response.body.token).toBe('mock-jwt-token');
      expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', testUser.password_hash);
    });

    it('should reject authentication with invalid password', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [testUser] });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrong-password'
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should reject authentication for non-existent user', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'any-password'
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should handle account lockout after failed attempts', async () => {
      const lockedUser = { ...testUser, failed_login_attempts: 5, is_active: false };
      mockDatabase.query.mockResolvedValue({ rows: [lockedUser] });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'any-password'
        })
        .expect(423); // Locked

      expect(response.body.error).toContain('Account locked');
    });

    it('should increment failed login attempts on wrong password', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({ rows: [testUser] }) // Get user
        .mockResolvedValueOnce({ rows: [] }); // Update failed attempts

      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrong-password'
        })
        .expect(401);

      // Verify that failed attempts were incremented
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET failed_login_attempts'),
        expect.arrayContaining([testUser.id])
      );
    });
  });

  describe('Multi-Factor Authentication', () => {
    const testUser = {
      id: 'test-user-mfa',
      email: 'mfa@example.com',
      mfa_enabled: true,
      mfa_secret: 'base32-encoded-secret'
    };

    it('should require MFA for enabled users', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [testUser] });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'mfa@example.com',
          password: 'correct-password'
        })
        .expect(200);

      expect(response.body.mfaRequired).toBe(true);
      expect(response.body.tempToken).toBeTruthy();
      expect(response.body.user).toBeUndefined(); // User data not returned until MFA
    });

    it('should verify MFA token', async () => {
      // Mock TOTP verification
      const mockTOTP = {
        verify: jest.fn().mockReturnValue(true)
      };

      jest.doMock('otplib', () => ({
        authenticator: mockTOTP
      }));

      const response = await request(app)
        .post('/auth/verify-mfa')
        .send({
          tempToken: 'valid-temp-token',
          mfaCode: '123456'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeTruthy();
    });

    it('should reject invalid MFA token', async () => {
      const mockTOTP = {
        verify: jest.fn().mockReturnValue(false)
      };

      jest.doMock('otplib', () => ({
        authenticator: mockTOTP
      }));

      const response = await request(app)
        .post('/auth/verify-mfa')
        .send({
          tempToken: 'valid-temp-token',
          mfaCode: '000000'
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid MFA code');
    });

    it('should enable MFA for user', async () => {
      const mockSecret = 'JBSWY3DPEHPK3PXP';
      const mockQRCode = 'data:image/png;base64,mock-qr-code';

      const mockTOTP = {
        generateSecret: jest.fn().mockReturnValue(mockSecret)
      };

      const mockQRCodeLib = {
        toDataURL: jest.fn().mockResolvedValue(mockQRCode)
      };

      jest.doMock('otplib', () => ({ authenticator: mockTOTP }));
      jest.doMock('qrcode', () => mockQRCodeLib);

      const response = await request(app)
        .post('/auth/enable-mfa')
        .set('Authorization', 'Bearer mock-jwt-token')
        .expect(200);

      expect(response.body.secret).toBe(mockSecret);
      expect(response.body.qrCode).toBe(mockQRCode);
    });
  });

  describe('User Profile Management', () => {
    const testUser = {
      id: 'test-user-profile',
      email: 'profile@example.com',
      name: 'Profile User',
      phone: '+1234567890',
      personality: 'polite',
      voice_profile_id: 'voice-123',
      preferences: JSON.stringify({ theme: 'dark', notifications: true })
    };

    beforeEach(() => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: testUser.id });
    });

    it('should get user profile', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [testUser] });

      const response = await request(app)
        .get('/users/profile')
        .set('Authorization', 'Bearer valid-jwt-token')
        .expect(200);

      expect(response.body.user).toMatchObject({
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        phone: testUser.phone,
        personality: testUser.personality
      });
      expect(response.body.user.preferences).toEqual({ theme: 'dark', notifications: true });
    });

    it('should update user profile', async () => {
      const updatedData = {
        name: 'Updated Name',
        personality: 'direct',
        preferences: { theme: 'light', notifications: false }
      };

      mockDatabase.query.mockResolvedValue({
        rows: [{
          ...testUser,
          ...updatedData,
          preferences: JSON.stringify(updatedData.preferences)
        }]
      });

      const response = await request(app)
        .put('/users/profile')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send(updatedData)
        .expect(200);

      expect(response.body.user.name).toBe(updatedData.name);
      expect(response.body.user.personality).toBe(updatedData.personality);
      expect(response.body.user.preferences).toEqual(updatedData.preferences);
    });

    it('should update user password', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({ rows: [testUser] }) // Get current user
        .mockResolvedValueOnce({ rows: [testUser] }); // Update password

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');

      const response = await request(app)
        .put('/users/password')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send({
          currentPassword: 'current-password',
          newPassword: 'NewSecurePassword123!'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('current-password', testUser.password_hash);
      expect(bcrypt.hash).toHaveBeenCalledWith('NewSecurePassword123!', 10);
    });

    it('should reject password update with wrong current password', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [testUser] });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .put('/users/password')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send({
          currentPassword: 'wrong-password',
          newPassword: 'NewPassword123!'
        })
        .expect(400);

      expect(response.body.error).toContain('Current password is incorrect');
    });

    it('should delete user account', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .delete('/users/account')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send({ confirmPassword: 'correct-password' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Account deleted successfully');
    });
  });

  describe('Authorization and Permissions', () => {
    it('should protect endpoints with JWT middleware', async () => {
      const response = await request(app)
        .get('/users/profile')
        .expect(401);

      expect(response.body.error).toContain('No token provided');
    });

    it('should reject invalid JWT tokens', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .get('/users/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toContain('Invalid token');
    });

    it('should refresh JWT token', async () => {
      const oldToken = 'old-jwt-token';
      const newToken = 'new-jwt-token';

      (jwt.verify as jest.Mock)
        .mockReturnValueOnce({ userId: 'test-user-123', exp: Math.floor(Date.now() / 1000) + 300 })
        .mockReturnValueOnce({ userId: 'test-user-123' });
      
      (jwt.sign as jest.Mock).mockReturnValue(newToken);

      mockDatabase.query.mockResolvedValue({
        rows: [{
          id: 'test-user-123',
          email: 'test@example.com',
          is_active: true
        }]
      });

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(200);

      expect(response.body.token).toBe(newToken);
    });

    it('should validate user permissions for admin endpoints', async () => {
      const regularUser = {
        userId: 'regular-user-123',
        role: 'user'
      };

      (jwt.verify as jest.Mock).mockReturnValue(regularUser);

      const response = await request(app)
        .get('/users/admin/all-users')
        .set('Authorization', 'Bearer regular-user-token')
        .expect(403);

      expect(response.body.error).toContain('Admin privileges required');
    });
  });

  describe('Rate Limiting and Security', () => {
    it('should implement rate limiting on login endpoint', async () => {
      const requests = [];
      
      // Attempt many login requests
      for (let i = 0; i < 10; i++) {
        const request = request(app)
          .post('/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password'
          });
        
        requests.push(request);
      }

      const responses = await Promise.allSettled(
        requests.map(req => req.catch(err => err.response))
      );

      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        (response: any) => response.value?.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should log security events', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockDatabase.query.mockResolvedValue({ rows: [] });

      await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password'
        });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed login attempt')
      );

      consoleSpy.mockRestore();
    });

    it('should validate input sanitization', async () => {
      const maliciousInput = {
        email: 'test@example.com',
        password: 'password',
        name: '<script>alert("xss")</script>',
        phone: '+1234567890'
      };

      mockDatabase.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .post('/auth/register')
        .send(maliciousInput)
        .expect(201);

      // Name should be sanitized
      expect(response.body.user.name).not.toContain('<script>');
    });
  });

  describe('Performance Tests', () => {
    it('should handle authentication within performance requirements', async () => {
      const testUser = {
        id: 'perf-user-123',
        email: 'perf@example.com',
        password_hash: 'hashed-password',
        is_active: true
      };

      mockDatabase.query.mockResolvedValue({ rows: [testUser] });

      const authRequest = request(app)
        .post('/auth/login')
        .send({
          email: 'perf@example.com',
          password: 'password'
        });

      await expect(authRequest).toCompleteWithinMs(200);
    });

    it('should handle concurrent authentication requests', async () => {
      const testUser = {
        id: 'concurrent-user',
        email: 'concurrent@example.com',
        password_hash: 'hashed-password',
        is_active: true
      };

      mockDatabase.query.mockResolvedValue({ rows: [testUser] });

      const concurrentRequests = 20;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        const promise = request(app)
          .post('/auth/login')
          .send({
            email: 'concurrent@example.com',
            password: 'password'
          });

        promises.push(promise);
      }

      const results = await Promise.allSettled(promises);
      const successfulRequests = results.filter(
        (result: any) => result.value?.status === 200
      );

      // Most requests should succeed (allowing for some rate limiting)
      expect(successfulRequests.length).toBeGreaterThan(concurrentRequests * 0.7);
    });
  });

  describe('Data Privacy and GDPR Compliance', () => {
    it('should export user data for GDPR compliance', async () => {
      const userData = {
        id: 'gdpr-user-123',
        email: 'gdpr@example.com',
        name: 'GDPR User',
        phone: '+1234567890',
        created_at: '2023-01-01T00:00:00Z',
        last_login: '2023-12-01T10:00:00Z'
      };

      mockDatabase.query.mockResolvedValue({ rows: [userData] });

      const response = await request(app)
        .get('/users/export-data')
        .set('Authorization', 'Bearer valid-jwt-token')
        .expect(200);

      expect(response.body.userData).toMatchObject(userData);
      expect(response.body.exportDate).toBeTruthy();
      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should anonymize user data on request', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .post('/users/anonymize')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send({ confirmAction: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('anonymized');
    });

    it('should handle data retention policies', async () => {
      mockDatabase.query.mockResolvedValue({
        rowCount: 5 // Number of inactive accounts cleaned up
      });

      const response = await request(app)
        .post('/users/admin/cleanup-inactive')
        .set('Authorization', 'Bearer admin-jwt-token')
        .send({ 
          inactiveDays: 365,
          dryRun: false
        })
        .expect(200);

      expect(response.body.cleanedUpAccounts).toBe(5);
    });
  });
});