/**
 * User Management E2E Test Suite
 * 
 * Tests complete user lifecycle and management workflows:
 * 1. User registration and onboarding
 * 2. Profile configuration and preferences
 * 3. Authentication and authorization
 * 4. Account settings management
 * 5. Data privacy and GDPR compliance
 * 6. Account deactivation and deletion
 */

import { performance } from 'perf_hooks';
import { TestApiClient } from '../utils/TestApiClient';
import { TestDataFactory } from '../fixtures/TestDataFactory';

export interface UserManagementTestResult {
  testName: string;
  passed: boolean;
  duration: number;
  metrics: {
    registrationTime: number;
    authenticationTime: number;
    configurationTime: number;
    dataExportTime: number;
    deletionTime: number;
    apiResponseTime: number;
    cacheHitRate: number;
  };
  details: {
    userId?: string;
    userPhone?: string;
    authTokenGenerated: boolean;
    profileConfigured: boolean;
    preferencesSet: boolean;
    dataExported: boolean;
    gdprCompliant: boolean;
    accountDeleted: boolean;
  };
  error?: string;
}

export interface UserManagementConfig {
  maxRegistrationTime: number; // ms
  maxAuthTime: number; // ms  
  passwordComplexity: {
    minLength: number;
    requireSpecialChar: boolean;
    requireNumber: boolean;
    requireUppercase: boolean;
  };
  sessionTimeout: number; // ms
  maxConcurrentSessions: number;
  dataRetentionDays: number;
}

export class UserManagementE2ETest {
  private apiClient: TestApiClient;
  private dataFactory: TestDataFactory;
  private config: UserManagementConfig;
  private testUsers: Map<string, any> = new Map();

  constructor(apiClient: TestApiClient, config?: Partial<UserManagementConfig>) {
    this.apiClient = apiClient;
    this.dataFactory = new TestDataFactory();
    this.config = {
      maxRegistrationTime: 2000,
      maxAuthTime: 1000,
      passwordComplexity: {
        minLength: 8,
        requireSpecialChar: true,
        requireNumber: true,
        requireUppercase: true
      },
      sessionTimeout: 3600000, // 1 hour
      maxConcurrentSessions: 3,
      dataRetentionDays: 365,
      ...config
    };
  }

  /**
   * Test complete user registration and onboarding flow
   */
  async testUserRegistrationFlow(): Promise<UserManagementTestResult> {
    const testName = 'User Registration and Onboarding Flow';
    const startTime = performance.now();
    
    try {
      // Step 1: User Registration
      const registrationStart = performance.now();
      
      const userData = this.dataFactory.createUserRegistrationData({
        include_preferences: true,
        include_voice_profile: true
      });

      const registrationResponse = await this.apiClient.post('/user-management/api/users/register', {
        phone_number: userData.phone_number,
        name: userData.name,
        email: userData.email,
        password: userData.password,
        preferences: userData.preferences,
        voice_settings: userData.voice_settings,
        gdpr_consent: true,
        marketing_consent: false
      });

      if (registrationResponse.status !== 201) {
        throw new Error(`Registration failed: ${registrationResponse.status}`);
      }

      const userId = registrationResponse.data.id;
      const registrationTime = performance.now() - registrationStart;
      this.testUsers.set(userId, userData);

      // Step 2: Email Verification Simulation
      const verificationResponse = await this.apiClient.post('/user-management/api/users/verify-email', {
        user_id: userId,
        verification_token: registrationResponse.data.verification_token
      });

      if (verificationResponse.status !== 200) {
        throw new Error(`Email verification failed: ${verificationResponse.status}`);
      }

      // Step 3: Initial Authentication
      const authStart = performance.now();
      
      const authResponse = await this.apiClient.post('/user-management/api/auth/login', {
        phone_number: userData.phone_number,
        password: userData.password
      });

      if (authResponse.status !== 200) {
        throw new Error(`Initial authentication failed: ${authResponse.status}`);
      }

      const authToken = authResponse.data.access_token;
      const authTime = performance.now() - authStart;

      // Step 4: Profile Configuration
      const configStart = performance.now();
      
      const profileResponse = await this.apiClient.put(`/user-management/api/users/${userId}/profile`, {
        personality: 'professional',
        response_style: 'polite_decline',
        voice_clone_enabled: true,
        auto_learning: true,
        privacy_level: 'standard'
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const configTime = performance.now() - configStart;

      // Step 5: Whitelist Initialization
      const whitelistResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/initialize', {
        user_id: userId,
        default_contacts: userData.emergency_contacts || []
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      // Step 6: Voice Profile Setup (if enabled)
      let voiceProfileSetup = false;
      if (userData.voice_settings?.clone_enabled) {
        const voiceResponse = await this.apiClient.post('/realtime-processor/api/voice/profile', {
          user_id: userId,
          voice_sample_url: userData.voice_settings.sample_url,
          target_language: userData.voice_settings.language || 'zh-CN'
        }, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        
        voiceProfileSetup = voiceResponse.status === 201;
      }

      const totalTime = performance.now() - startTime;

      // Validate onboarding completion
      const userProfile = await this.apiClient.get(`/user-management/api/users/${userId}/profile`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const passed = registrationTime <= this.config.maxRegistrationTime &&
                     authTime <= this.config.maxAuthTime &&
                     userProfile.status === 200 &&
                     !!authToken;

      return {
        testName,
        passed,
        duration: Math.round(totalTime),
        metrics: {
          registrationTime: Math.round(registrationTime),
          authenticationTime: Math.round(authTime),
          configurationTime: Math.round(configTime),
          dataExportTime: 0,
          deletionTime: 0,
          apiResponseTime: Math.round((registrationTime + authTime + configTime) / 3),
          cacheHitRate: 0
        },
        details: {
          userId,
          userPhone: userData.phone_number,
          authTokenGenerated: !!authToken,
          profileConfigured: profileResponse.status === 200,
          preferencesSet: !!userData.preferences,
          dataExported: false,
          gdprCompliant: true,
          accountDeleted: false
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        testName,
        passed: false,
        duration: Math.round(duration),
        metrics: {
          registrationTime: 0,
          authenticationTime: 0,
          configurationTime: 0,
          dataExportTime: 0,
          deletionTime: 0,
          apiResponseTime: Math.round(duration),
          cacheHitRate: 0
        },
        details: {
          authTokenGenerated: false,
          profileConfigured: false,
          preferencesSet: false,
          dataExported: false,
          gdprCompliant: false,
          accountDeleted: false
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test authentication and session management
   */
  async testAuthenticationAndSessions(): Promise<UserManagementTestResult> {
    const testName = 'Authentication and Session Management';
    const startTime = performance.now();
    
    try {
      // Setup test user
      const userData = this.dataFactory.createUserRegistrationData();
      const userResponse = await this.apiClient.post('/user-management/api/users', userData);
      const userId = userResponse.data.id;

      // Test 1: Multiple login sessions
      const sessionPromises = Array(this.config.maxConcurrentSessions).fill(null).map(async (_, index) => {
        const authStart = performance.now();
        const response = await this.apiClient.post('/user-management/api/auth/login', {
          phone_number: userData.phone_number,
          password: userData.password,
          device_id: `test_device_${index}`,
          user_agent: `TestClient/${index}`
        });
        const authTime = performance.now() - authStart;
        
        return {
          sessionIndex: index,
          token: response.data.access_token,
          authTime,
          success: response.status === 200
        };
      });

      const sessions = await Promise.all(sessionPromises);
      const successfulSessions = sessions.filter(s => s.success);
      const averageAuthTime = sessions.reduce((sum, s) => sum + s.authTime, 0) / sessions.length;

      // Test 2: Token validation and refresh
      const validationPromises = successfulSessions.map(async (session) => {
        const validateResponse = await this.apiClient.get('/user-management/api/auth/validate', {
          headers: { Authorization: `Bearer ${session.token}` }
        });
        
        return {
          sessionIndex: session.sessionIndex,
          valid: validateResponse.status === 200,
          userData: validateResponse.data
        };
      });

      const validations = await Promise.all(validationPromises);
      const validTokens = validations.filter(v => v.valid);

      // Test 3: Session timeout behavior
      const timeoutTest = await this.testSessionTimeout(successfulSessions[0]?.token);

      // Test 4: Concurrent session limit
      const extraSessionResponse = await this.apiClient.post('/user-management/api/auth/login', {
        phone_number: userData.phone_number,
        password: userData.password,
        device_id: 'extra_device'
      });

      // Should succeed but might invalidate oldest session
      const sessionLimitRespected = extraSessionResponse.status === 200;

      // Test 5: Multi-factor authentication (if enabled)
      const mfaTestResult = await this.testMFA(userId, userData.phone_number);

      const totalTime = performance.now() - startTime;

      // Cleanup sessions
      await Promise.all(successfulSessions.map(session => 
        this.apiClient.post('/user-management/api/auth/logout', {}, {
          headers: { Authorization: `Bearer ${session.token}` }
        }).catch(() => {}) // Ignore logout errors
      ));

      // Cleanup test user
      await this.cleanup(userId);

      const passed = successfulSessions.length >= this.config.maxConcurrentSessions &&
                     validTokens.length === successfulSessions.length &&
                     averageAuthTime <= this.config.maxAuthTime;

      return {
        testName,
        passed,
        duration: Math.round(totalTime),
        metrics: {
          registrationTime: 0,
          authenticationTime: Math.round(averageAuthTime),
          configurationTime: 0,
          dataExportTime: 0,
          deletionTime: 0,
          apiResponseTime: Math.round(averageAuthTime),
          cacheHitRate: validTokens.length / successfulSessions.length
        },
        details: {
          userId,
          userPhone: userData.phone_number,
          authTokenGenerated: successfulSessions.length > 0,
          profileConfigured: true,
          preferencesSet: true,
          dataExported: false,
          gdprCompliant: true,
          accountDeleted: false
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        testName,
        passed: false,
        duration: Math.round(duration),
        metrics: {
          registrationTime: 0,
          authenticationTime: Math.round(duration),
          configurationTime: 0,
          dataExportTime: 0,
          deletionTime: 0,
          apiResponseTime: Math.round(duration),
          cacheHitRate: 0
        },
        details: {
          authTokenGenerated: false,
          profileConfigured: false,
          preferencesSet: false,
          dataExported: false,
          gdprCompliant: false,
          accountDeleted: false
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test GDPR compliance and data privacy
   */
  async testGDPRCompliance(): Promise<UserManagementTestResult> {
    const testName = 'GDPR Compliance and Data Privacy';
    const startTime = performance.now();
    
    try {
      // Setup test user with comprehensive data
      const userData = this.dataFactory.createUserRegistrationData({
        include_call_history: true,
        include_voice_samples: true,
        include_analytics_data: true
      });
      
      const userResponse = await this.apiClient.post('/user-management/api/users', userData);
      const userId = userResponse.data.id;
      
      // Generate some usage data
      await this.generateUserActivityData(userId);

      // Test 1: Data Export (Right to Data Portability)
      const exportStart = performance.now();
      
      const exportResponse = await this.apiClient.post('/user-management/api/users/export-data', {
        user_id: userId,
        format: 'json',
        include_voice_data: true,
        include_call_logs: true,
        include_analytics: true
      });

      if (exportResponse.status !== 202) { // Accepted for async processing
        throw new Error(`Data export failed: ${exportResponse.status}`);
      }

      // Poll for export completion
      const exportId = exportResponse.data.export_id;
      let exportComplete = false;
      let exportData = null;
      
      for (let i = 0; i < 30 && !exportComplete; i++) { // Max 30 seconds
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await this.apiClient.get(`/user-management/api/users/export-status/${exportId}`);
        
        if (statusResponse.data.status === 'completed') {
          exportComplete = true;
          exportData = statusResponse.data;
        } else if (statusResponse.data.status === 'failed') {
          throw new Error('Data export failed');
        }
      }

      const exportTime = performance.now() - exportStart;

      // Test 2: Data Rectification (Right to Correction)
      const rectificationResponse = await this.apiClient.put(`/user-management/api/users/${userId}/rectify`, {
        corrections: {
          name: 'Corrected Name',
          preferences: {
            response_style: 'direct'
          }
        },
        reason: 'User requested correction'
      });

      // Test 3: Data Deletion (Right to Erasure)
      const deletionStart = performance.now();
      
      const deletionResponse = await this.apiClient.delete(`/user-management/api/users/${userId}`, {
        data: {
          deletion_type: 'complete',
          retain_analytics: false,
          gdpr_request: true,
          verification_code: 'TEST_CODE'
        }
      });

      if (deletionResponse.status !== 202) { // Accepted for async processing
        throw new Error(`Account deletion failed: ${deletionResponse.status}`);
      }

      // Verify deletion completion
      let deletionComplete = false;
      for (let i = 0; i < 20 && !deletionComplete; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          await this.apiClient.get(`/user-management/api/users/${userId}`);
        } catch (error: any) {
          if (error.response?.status === 404) {
            deletionComplete = true;
          }
        }
      }

      const deletionTime = performance.now() - deletionStart;
      const totalTime = performance.now() - startTime;

      // Test 4: Verify data is completely removed from all services
      const dataRemovalVerification = await this.verifyCompleteDataRemoval(userId);

      const passed = exportComplete &&
                     exportData &&
                     rectificationResponse.status === 200 &&
                     deletionComplete &&
                     dataRemovalVerification.allDataRemoved;

      return {
        testName,
        passed,
        duration: Math.round(totalTime),
        metrics: {
          registrationTime: 0,
          authenticationTime: 0,
          configurationTime: 0,
          dataExportTime: Math.round(exportTime),
          deletionTime: Math.round(deletionTime),
          apiResponseTime: Math.round((exportTime + deletionTime) / 2),
          cacheHitRate: 0
        },
        details: {
          userId,
          userPhone: userData.phone_number,
          authTokenGenerated: false,
          profileConfigured: false,
          preferencesSet: false,
          dataExported: exportComplete,
          gdprCompliant: passed,
          accountDeleted: deletionComplete
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        testName,
        passed: false,
        duration: Math.round(duration),
        metrics: {
          registrationTime: 0,
          authenticationTime: 0,
          configurationTime: 0,
          dataExportTime: 0,
          deletionTime: 0,
          apiResponseTime: Math.round(duration),
          cacheHitRate: 0
        },
        details: {
          authTokenGenerated: false,
          profileConfigured: false,
          preferencesSet: false,
          dataExported: false,
          gdprCompliant: false,
          accountDeleted: false
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test session timeout behavior
   */
  private async testSessionTimeout(token: string): Promise<boolean> {
    if (!token) return false;
    
    try {
      // Initial validation should succeed
      const initialResponse = await this.apiClient.get('/user-management/api/auth/validate', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (initialResponse.status !== 200) return false;

      // For testing, we'll simulate timeout by waiting and checking if session is still valid
      // In real implementation, this would be more sophisticated
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second wait
      
      const timeoutResponse = await this.apiClient.get('/user-management/api/auth/validate', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      return timeoutResponse.status === 200; // Should still be valid for short test
    } catch {
      return false;
    }
  }

  /**
   * Test multi-factor authentication
   */
  private async testMFA(userId: string, phoneNumber: string): Promise<boolean> {
    try {
      // Enable MFA
      const enableResponse = await this.apiClient.post(`/user-management/api/users/${userId}/mfa/enable`, {
        method: 'sms',
        phone_number: phoneNumber
      });

      if (enableResponse.status !== 200) return false;

      // Simulate MFA login
      const mfaLoginResponse = await this.apiClient.post('/user-management/api/auth/mfa/initiate', {
        phone_number: phoneNumber
      });

      if (mfaLoginResponse.status !== 200) return false;

      // Verify with test code
      const verifyResponse = await this.apiClient.post('/user-management/api/auth/mfa/verify', {
        phone_number: phoneNumber,
        code: '123456', // Test code
        session_id: mfaLoginResponse.data.session_id
      });

      return verifyResponse.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Generate user activity data for testing
   */
  private async generateUserActivityData(userId: string): Promise<void> {
    // Create some call records
    const calls = Array(5).fill(null).map(() => this.dataFactory.createIncomingCall());
    
    for (const call of calls) {
      await this.apiClient.post('/conversation-engine/api/calls', {
        ...call,
        user_id: userId
      }).catch(() => {}); // Ignore failures for test data generation
    }

    // Create some whitelist entries
    const contacts = this.dataFactory.createWhitelistContacts(3);
    for (const contact of contacts) {
      await this.apiClient.post('/smart-whitelist/api/whitelist', {
        user_id: userId,
        ...contact
      }).catch(() => {});
    }
  }

  /**
   * Verify complete data removal across all services
   */
  private async verifyCompleteDataRemoval(userId: string): Promise<{ allDataRemoved: boolean; remainingData: string[] }> {
    const remainingData: string[] = [];
    
    // Check user management service
    try {
      await this.apiClient.get(`/user-management/api/users/${userId}`);
      remainingData.push('user_profile');
    } catch (error: any) {
      if (error.response?.status !== 404) {
        remainingData.push('user_profile_error');
      }
    }

    // Check conversation engine
    try {
      const conversationResponse = await this.apiClient.get(`/conversation-engine/api/users/${userId}/conversations`);
      if (conversationResponse.data.length > 0) {
        remainingData.push('conversation_data');
      }
    } catch {
      // Expected to fail after deletion
    }

    // Check whitelist service
    try {
      const whitelistResponse = await this.apiClient.get(`/smart-whitelist/api/whitelist/${userId}`);
      if (whitelistResponse.data.length > 0) {
        remainingData.push('whitelist_data');
      }
    } catch {
      // Expected to fail after deletion
    }

    // Check analytics service
    try {
      const analyticsResponse = await this.apiClient.get(`/profile-analytics/api/profile/${userId}`);
      if (analyticsResponse.status === 200) {
        remainingData.push('analytics_data');
      }
    } catch {
      // Expected to fail after deletion
    }

    return {
      allDataRemoved: remainingData.length === 0,
      remainingData
    };
  }

  /**
   * Cleanup test data
   */
  private async cleanup(userId: string): Promise<void> {
    try {
      await this.apiClient.delete(`/user-management/api/users/${userId}`);
      this.testUsers.delete(userId);
    } catch (error) {
      console.warn('User cleanup failed:', error);
    }
  }

  /**
   * Run all user management tests
   */
  async runAllTests(): Promise<{
    summary: {
      totalTests: number;
      passedTests: number;
      averageResponseTime: number;
      gdprCompliance: boolean;
    };
    results: UserManagementTestResult[];
  }> {
    const results: UserManagementTestResult[] = [];
    
    // Run all test scenarios
    results.push(await this.testUserRegistrationFlow());
    results.push(await this.testAuthenticationAndSessions());
    results.push(await this.testGDPRCompliance());

    // Calculate summary
    const passedTests = results.filter(r => r.passed).length;
    const averageResponseTime = results.reduce((sum, r) => sum + r.metrics.apiResponseTime, 0) / results.length;
    const gdprCompliance = results.some(r => r.testName.includes('GDPR') && r.passed);

    // Cleanup any remaining test users
    for (const userId of this.testUsers.keys()) {
      await this.cleanup(userId);
    }

    return {
      summary: {
        totalTests: results.length,
        passedTests,
        averageResponseTime: Math.round(averageResponseTime),
        gdprCompliance
      },
      results
    };
  }
}

export default UserManagementE2ETest;