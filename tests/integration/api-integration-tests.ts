/**
 * Microservices API Integration Tests
 * 
 * Comprehensive tests for service-to-service communication,
 * data consistency, and API contract compliance.
 */

import axios, { AxiosResponse, AxiosError } from 'axios';
import * as winston from 'winston';
import { performance } from 'perf_hooks';

export interface APITestConfig {
  baseUrls: {
    userManagement: string;
    smartWhitelist: string;
    conversationEngine: string;
    realtimeProcessor: string;
    profileAnalytics: string;
  };
  timeout: number;
  retries: number;
  expectedLatency: number;
}

export interface APITestResult {
  serviceName: string;
  endpoint: string;
  method: string;
  passed: boolean;
  duration: number;
  statusCode?: number;
  responseSize?: number;
  error?: string;
  contractCompliant?: boolean;
  dataConsistent?: boolean;
}

export interface APITestSuite {
  suiteName: string;
  results: APITestResult[];
  passed: boolean;
  totalTests: number;
  passedTests: number;
  averageLatency: number;
  contractComplianceRate: number;
  dataConsistencyRate: number;
}

export class APIIntegrationTestRunner {
  private logger: winston.Logger;
  private config: APITestConfig;
  private testData: Map<string, any> = new Map();

  constructor(config: APITestConfig) {
    this.config = config;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  /**
   * Execute API test with retry logic and performance monitoring
   */
  private async executeAPITest(
    serviceName: string,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: any,
    headers?: any
  ): Promise<APITestResult> {
    const startTime = performance.now();
    let lastError: Error | undefined;
    let response: AxiosResponse | undefined;

    const fullUrl = `${this.config.baseUrls[serviceName as keyof APITestConfig['baseUrls']]}${endpoint}`;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const requestConfig = {
          method,
          url: fullUrl,
          data,
          headers: {
            'Content-Type': 'application/json',
            'X-Test-Source': 'api-integration-test',
            ...headers
          },
          timeout: this.config.timeout,
          validateStatus: () => true // Don't throw for 4xx/5xx status codes
        };

        response = await axios(requestConfig);
        break;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    const duration = performance.now() - startTime;

    if (!response) {
      return {
        serviceName,
        endpoint,
        method,
        passed: false,
        duration: Math.round(duration),
        error: lastError?.message || 'Request failed'
      };
    }

    const passed = response.status >= 200 && response.status < 300;
    const contractCompliant = this.validateResponseContract(serviceName, endpoint, response);
    const dataConsistent = await this.validateDataConsistency(serviceName, response.data);

    return {
      serviceName,
      endpoint,
      method,
      passed,
      duration: Math.round(duration),
      statusCode: response.status,
      responseSize: JSON.stringify(response.data).length,
      contractCompliant,
      dataConsistent
    };
  }

  /**
   * User Management Service Tests
   */
  async testUserManagementService(): Promise<APITestSuite> {
    const results: APITestResult[] = [];
    const serviceName = 'userManagement';

    // Test 1: Health Check
    results.push(await this.executeAPITest(
      serviceName,
      '/health',
      'GET'
    ));

    // Test 2: Service Info
    results.push(await this.executeAPITest(
      serviceName,
      '/api/info',
      'GET'
    ));

    // Test 3: Create User
    const newUser = {
      phone_number: `+1555${Date.now().toString().slice(-7)}`,
      name: 'API Test User',
      personality: 'professional',
      preferences: {
        response_style: 'polite_decline',
        auto_hang_up: true
      }
    };

    const createResult = await this.executeAPITest(
      serviceName,
      '/api/users',
      'POST',
      newUser
    );
    results.push(createResult);

    // Store user ID for subsequent tests
    if (createResult.passed && createResult.statusCode === 201) {
      // In a real implementation, we'd parse the response to get the user ID
      this.testData.set('testUserId', 'test-user-id');
    }

    // Test 4: Get User (if creation succeeded)
    if (this.testData.has('testUserId')) {
      results.push(await this.executeAPITest(
        serviceName,
        `/api/users/${this.testData.get('testUserId')}`,
        'GET'
      ));

      // Test 5: Update User
      results.push(await this.executeAPITest(
        serviceName,
        `/api/users/${this.testData.get('testUserId')}`,
        'PUT',
        { name: 'Updated API Test User' }
      ));

      // Test 6: Get User List
      results.push(await this.executeAPITest(
        serviceName,
        '/api/users?limit=10&offset=0',
        'GET'
      ));
    }

    // Test 7: Authentication Test
    results.push(await this.executeAPITest(
      serviceName,
      '/api/auth/login',
      'POST',
      {
        phone_number: newUser.phone_number,
        verification_code: '123456'
      }
    ));

    return this.calculateSuiteMetrics('User Management API Tests', results);
  }

  /**
   * Smart Whitelist Service Tests
   */
  async testSmartWhitelistService(): Promise<APITestSuite> {
    const results: APITestResult[] = [];
    const serviceName = 'smartWhitelist';

    // Test 1: Health Check
    results.push(await this.executeAPITest(
      serviceName,
      '/health',
      'GET'
    ));

    const userId = this.testData.get('testUserId') || 'test-user-id';

    // Test 2: Get Whitelist
    results.push(await this.executeAPITest(
      serviceName,
      `/api/whitelist/${userId}`,
      'GET'
    ));

    // Test 3: Check if Phone is Whitelisted
    const testPhone = '+1555123456';
    results.push(await this.executeAPITest(
      serviceName,
      `/api/whitelist/${userId}/check/${testPhone}`,
      'GET'
    ));

    // Test 4: Smart Add to Whitelist
    results.push(await this.executeAPITest(
      serviceName,
      `/api/whitelist/${userId}/smart-add`,
      'POST',
      {
        contact_phone: testPhone,
        contact_name: 'API Test Contact',
        confidence_score: 0.9,
        reason: 'integration_test'
      }
    ));

    // Test 5: Evaluate Phone
    results.push(await this.executeAPITest(
      serviceName,
      '/api/evaluate',
      'POST',
      {
        phone: '+1555999888',
        user_id: userId,
        context: {
          time_of_day: 'business_hours',
          call_frequency: 'first_time'
        }
      }
    ));

    // Test 6: Update Whitelist Rules
    results.push(await this.executeAPITest(
      serviceName,
      `/api/whitelist/rules/${userId}`,
      'PUT',
      {
        auto_add_threshold: 0.8,
        learning_enabled: true,
        max_auto_entries: 1000
      }
    ));

    // Test 7: Get Learning Insights
    results.push(await this.executeAPITest(
      serviceName,
      `/api/learning/insights/${userId}`,
      'GET'
    ));

    return this.calculateSuiteMetrics('Smart Whitelist API Tests', results);
  }

  /**
   * Conversation Engine Service Tests
   */
  async testConversationEngineService(): Promise<APITestSuite> {
    const results: APITestResult[] = [];
    const serviceName = 'conversationEngine';

    // Test 1: Health Check
    results.push(await this.executeAPITest(
      serviceName,
      '/health',
      'GET'
    ));

    // Test 2: Detailed Health Check
    results.push(await this.executeAPITest(
      serviceName,
      '/health/detailed',
      'GET'
    ));

    const userId = this.testData.get('testUserId') || 'test-user-id';
    const callId = `api_test_call_${Date.now()}`;

    // Test 3: Manage Conversation
    const conversationRequest = {
      call_id: callId,
      user_id: userId,
      caller_phone: '+1555777888',
      input_text: '你好，我是XX保险公司的，想了解一下您的保险需求',
      detected_intent: 'insurance_sales',
      intent_confidence: 0.88,
      spam_category: 'insurance'
    };

    const conversationResult = await this.executeAPITest(
      serviceName,
      '/api/conversation/manage',
      'POST',
      conversationRequest
    );
    results.push(conversationResult);

    if (conversationResult.passed) {
      // Test 4: Get Conversation State
      results.push(await this.executeAPITest(
        serviceName,
        `/api/conversation/state/${callId}`,
        'GET'
      ));

      // Test 5: Update Conversation State
      results.push(await this.executeAPITest(
        serviceName,
        `/api/conversation/state/${callId}`,
        'PUT',
        {
          stage: 'handling_persistence',
          emotion: 'frustrated',
          should_terminate: true
        }
      ));

      // Test 6: Personalize Response
      results.push(await this.executeAPITest(
        serviceName,
        '/api/conversation/personalize',
        'POST',
        {
          user_id: userId,
          base_response: '我不需要保险服务',
          context: {
            personality: 'professional',
            call_history: []
          }
        }
      ));

      // Test 7: Analyze Emotion
      results.push(await this.executeAPITest(
        serviceName,
        '/api/conversation/emotion',
        'POST',
        {
          text: '我已经说了很多次了，我不需要保险！',
          speaker: 'user'
        }
      ));
    }

    // Test 8: Learning Optimization
    results.push(await this.executeAPITest(
      serviceName,
      '/api/learning/optimize',
      'POST',
      {
        user_id: userId,
        call_data: {
          call_id: callId,
          effectiveness_score: 0.85,
          response_quality: 0.9
        }
      }
    ));

    return this.calculateSuiteMetrics('Conversation Engine API Tests', results);
  }

  /**
   * Profile Analytics Service Tests
   */
  async testProfileAnalyticsService(): Promise<APITestSuite> {
    const results: APITestResult[] = [];
    const serviceName = 'profileAnalytics';

    // Test 1: Health Check
    results.push(await this.executeAPITest(
      serviceName,
      '/health',
      'GET'
    ));

    const testPhone = '+1555777888';

    // Test 2: Get Caller Profile
    results.push(await this.executeAPITest(
      serviceName,
      `/api/profile/${testPhone}`,
      'GET'
    ));

    // Test 3: Update Caller Profile
    results.push(await this.executeAPITest(
      serviceName,
      '/api/profile/update',
      'PUT',
      {
        phone: testPhone,
        spam_category: 'insurance',
        risk_score: 0.75,
        confidence_level: 0.88,
        behavioral_patterns: {
          persistence_level: 'high',
          typical_call_duration: 120,
          response_to_decline: 'persistent'
        }
      }
    ));

    // Test 4: Analyze Call Effectiveness
    results.push(await this.executeAPITest(
      serviceName,
      '/api/analysis/call-effectiveness',
      'POST',
      {
        call_id: 'api_test_call_' + Date.now(),
        user_feedback: 'effective',
        call_outcome: 'caller_hung_up',
        duration_seconds: 67,
        turn_count: 4,
        ai_responses_used: ['polite_decline', 'firm_refusal']
      }
    ));

    const userId = this.testData.get('testUserId') || 'test-user-id';

    // Test 5: Get User Analytics
    results.push(await this.executeAPITest(
      serviceName,
      `/api/analytics/user/${userId}`,
      'GET'
    ));

    // Test 6: Get Trends Analysis
    results.push(await this.executeAPITest(
      serviceName,
      `/api/analytics/trends/${userId}?period=30d`,
      'GET'
    ));

    // Test 7: Machine Learning Training
    results.push(await this.executeAPITest(
      serviceName,
      '/api/ml/train',
      'POST',
      {
        model_type: 'spam_classifier',
        training_data_period: '7d',
        force_retrain: false
      }
    ));

    // Test 8: Get ML Model Status
    results.push(await this.executeAPITest(
      serviceName,
      '/api/ml/models/status',
      'GET'
    ));

    return this.calculateSuiteMetrics('Profile Analytics API Tests', results);
  }

  /**
   * Realtime Processor Service Tests
   */
  async testRealtimeProcessorService(): Promise<APITestSuite> {
    const results: APITestResult[] = [];
    const serviceName = 'realtimeProcessor';

    // Test 1: Health Check
    results.push(await this.executeAPITest(
      serviceName,
      '/health',
      'GET'
    ));

    // Test 2: Service Status
    results.push(await this.executeAPITest(
      serviceName,
      '/api/status',
      'GET'
    ));

    const callId = `realtime_test_${Date.now()}`;

    // Test 3: Initialize Call Session
    results.push(await this.executeAPITest(
      serviceName,
      '/api/session/init',
      'POST',
      {
        call_id: callId,
        user_id: this.testData.get('testUserId') || 'test-user-id',
        caller_phone: '+1555666777',
        audio_config: {
          sample_rate: 16000,
          channels: 1,
          format: 'wav'
        }
      }
    ));

    // Test 4: Process Audio Chunk
    results.push(await this.executeAPITest(
      serviceName,
      '/api/audio/process',
      'POST',
      {
        call_id: callId,
        audio_data: 'base64_encoded_audio_chunk',
        sequence_number: 1,
        timestamp: Date.now()
      }
    ));

    // Test 5: Get Session Status
    results.push(await this.executeAPITest(
      serviceName,
      `/api/session/${callId}/status`,
      'GET'
    ));

    // Test 6: Update Session Config
    results.push(await this.executeAPITest(
      serviceName,
      `/api/session/${callId}/config`,
      'PUT',
      {
        vad_sensitivity: 0.7,
        response_delay: 500,
        auto_terminate: true
      }
    ));

    // Test 7: End Session
    results.push(await this.executeAPITest(
      serviceName,
      `/api/session/${callId}/end`,
      'POST',
      {
        reason: 'test_complete',
        final_metrics: {
          total_audio_processed: 1024,
          average_latency: 250
        }
      }
    ));

    // Test 8: Get Performance Metrics
    results.push(await this.executeAPITest(
      serviceName,
      '/api/metrics/performance',
      'GET'
    ));

    return this.calculateSuiteMetrics('Realtime Processor API Tests', results);
  }

  /**
   * Cross-Service Integration Tests
   */
  async testCrossServiceIntegration(): Promise<APITestSuite> {
    const results: APITestResult[] = [];

    // Test 1: User Creation -> Whitelist Initialization Flow
    const newUser = {
      phone_number: `+1555${Date.now().toString().slice(-7)}`,
      name: 'Cross Integration Test User',
      personality: 'direct'
    };

    const userCreation = await this.executeAPITest(
      'userManagement',
      '/api/users',
      'POST',
      newUser
    );
    results.push({
      ...userCreation,
      endpoint: '/api/users (Cross-Service Flow)',
      serviceName: 'Cross-Service'
    });

    if (userCreation.passed) {
      const userId = 'cross-test-user-id'; // In real implementation, extract from response
      
      // Verify whitelist service can access the user
      const whitelistCheck = await this.executeAPITest(
        'smartWhitelist',
        `/api/whitelist/${userId}`,
        'GET'
      );
      results.push({
        ...whitelistCheck,
        endpoint: '/api/whitelist/{userId} (After User Creation)',
        serviceName: 'Cross-Service'
      });

      // Test 2: Complete Call Flow Integration
      const callFlow = await this.testCompleteCallFlow(userId);
      results.push(...callFlow);
    }

    return this.calculateSuiteMetrics('Cross-Service Integration Tests', results);
  }

  /**
   * Test complete call flow across multiple services
   */
  private async testCompleteCallFlow(userId: string): Promise<APITestResult[]> {
    const results: APITestResult[] = [];
    const callId = `cross_test_call_${Date.now()}`;
    const callerPhone = '+1555888999';

    // Step 1: Check whitelist (Smart Whitelist Service)
    const whitelistResult = await this.executeAPITest(
      'smartWhitelist',
      `/api/whitelist/${userId}/check/${callerPhone}`,
      'GET'
    );
    results.push({
      ...whitelistResult,
      endpoint: 'Whitelist Check (Call Flow)',
      serviceName: 'Cross-Service'
    });

    // Step 2: Get/Create caller profile (Profile Analytics Service)
    const profileResult = await this.executeAPITest(
      'profileAnalytics',
      `/api/profile/${callerPhone}`,
      'GET'
    );
    results.push({
      ...profileResult,
      endpoint: 'Profile Lookup (Call Flow)',
      serviceName: 'Cross-Service'
    });

    // Step 3: Initialize realtime session (Realtime Processor Service)
    const sessionResult = await this.executeAPITest(
      'realtimeProcessor',
      '/api/session/init',
      'POST',
      {
        call_id: callId,
        user_id: userId,
        caller_phone: callerPhone
      }
    );
    results.push({
      ...sessionResult,
      endpoint: 'Session Init (Call Flow)',
      serviceName: 'Cross-Service'
    });

    // Step 4: Process conversation (Conversation Engine Service)
    const conversationResult = await this.executeAPITest(
      'conversationEngine',
      '/api/conversation/manage',
      'POST',
      {
        call_id: callId,
        user_id: userId,
        caller_phone: callerPhone,
        input_text: '您好，这里是XX银行客服',
        detected_intent: 'banking_services',
        intent_confidence: 0.85
      }
    );
    results.push({
      ...conversationResult,
      endpoint: 'Conversation Management (Call Flow)',
      serviceName: 'Cross-Service'
    });

    // Step 5: Update analytics (Profile Analytics Service)
    const analyticsResult = await this.executeAPITest(
      'profileAnalytics',
      '/api/analysis/call-effectiveness',
      'POST',
      {
        call_id: callId,
        user_feedback: 'effective',
        call_outcome: 'ai_handled',
        duration_seconds: 30
      }
    );
    results.push({
      ...analyticsResult,
      endpoint: 'Analytics Update (Call Flow)',
      serviceName: 'Cross-Service'
    });

    return results;
  }

  /**
   * Validate API response contract compliance
   */
  private validateResponseContract(
    serviceName: string,
    endpoint: string,
    response: AxiosResponse
  ): boolean {
    // Basic contract validation
    if (response.status >= 400) {
      // For error responses, check if error format is consistent
      return !!(response.data && typeof response.data.error === 'string');
    }

    // For successful responses, check basic structure
    if (endpoint === '/health') {
      return !!(response.data && response.data.status);
    }

    if (endpoint.includes('/api/')) {
      // API responses should be JSON objects
      return typeof response.data === 'object' && response.data !== null;
    }

    return true;
  }

  /**
   * Validate data consistency across services
   */
  private async validateDataConsistency(
    serviceName: string,
    responseData: any
  ): Promise<boolean> {
    // Basic data validation
    if (!responseData) return false;

    // Check for common required fields based on service
    switch (serviceName) {
      case 'userManagement':
        if (responseData.id && responseData.phone_number) {
          return this.isValidPhoneNumber(responseData.phone_number);
        }
        break;
      case 'smartWhitelist':
        if (responseData.contacts) {
          return Array.isArray(responseData.contacts);
        }
        break;
      case 'conversationEngine':
        if (responseData.response_text) {
          return typeof responseData.response_text === 'string';
        }
        break;
    }

    return true;
  }

  private isValidPhoneNumber(phone: string): boolean {
    return /^\+1\d{10}$/.test(phone);
  }

  /**
   * Calculate suite metrics from test results
   */
  private calculateSuiteMetrics(suiteName: string, results: APITestResult[]): APITestSuite {
    const passedTests = results.filter(r => r.passed).length;
    const totalLatency = results.reduce((sum, r) => sum + r.duration, 0);
    const contractCompliantTests = results.filter(r => r.contractCompliant).length;
    const dataConsistentTests = results.filter(r => r.dataConsistent).length;

    return {
      suiteName,
      results,
      passed: passedTests === results.length,
      totalTests: results.length,
      passedTests,
      averageLatency: Math.round(totalLatency / results.length) || 0,
      contractComplianceRate: Math.round((contractCompliantTests / results.length) * 100) / 100,
      dataConsistencyRate: Math.round((dataConsistentTests / results.length) * 100) / 100
    };
  }

  /**
   * Run all API integration tests
   */
  async runAllTests(): Promise<{
    overall: {
      passed: boolean;
      totalSuites: number;
      passedSuites: number;
      totalTests: number;
      passedTests: number;
      averageLatency: number;
      contractComplianceRate: number;
    };
    suites: APITestSuite[];
  }> {
    this.logger.info('🔌 Starting API Integration Tests');

    const suites: APITestSuite[] = [];

    try {
      // Run individual service tests
      suites.push(await this.testUserManagementService());
      suites.push(await this.testSmartWhitelistService());
      suites.push(await this.testConversationEngineService());
      suites.push(await this.testProfileAnalyticsService());
      suites.push(await this.testRealtimeProcessorService());

      // Run cross-service integration tests
      suites.push(await this.testCrossServiceIntegration());

      const passedSuites = suites.filter(s => s.passed).length;
      const totalTests = suites.reduce((sum, s) => sum + s.totalTests, 0);
      const passedTests = suites.reduce((sum, s) => sum + s.passedTests, 0);
      const totalLatency = suites.reduce((sum, s) => sum + (s.averageLatency * s.totalTests), 0);
      const contractCompliance = suites.reduce((sum, s) => sum + (s.contractComplianceRate * s.totalTests), 0);

      const overall = {
        passed: passedSuites === suites.length,
        totalSuites: suites.length,
        passedSuites,
        totalTests,
        passedTests,
        averageLatency: Math.round(totalLatency / totalTests) || 0,
        contractComplianceRate: Math.round((contractCompliance / totalTests) * 100) / 100
      };

      this.logger.info('📊 API Integration Test Summary', {
        overall,
        suiteResults: suites.map(s => ({
          name: s.suiteName,
          passed: s.passed,
          tests: `${s.passedTests}/${s.totalTests}`,
          avgLatency: `${s.averageLatency}ms`,
          contractCompliance: `${Math.round(s.contractComplianceRate * 100)}%`
        }))
      });

      return { overall, suites };

    } catch (error) {
      this.logger.error('💥 API Integration test execution failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Cleanup test data
   */
  async cleanup(): Promise<void> {
    this.logger.info('🧹 Cleaning up API test data...');
    
    const userId = this.testData.get('testUserId');
    if (userId) {
      try {
        await this.executeAPITest('userManagement', `/api/users/${userId}`, 'DELETE');
      } catch (error) {
        this.logger.warn('Failed to cleanup test user', { error: (error as Error).message });
      }
    }

    this.testData.clear();
    this.logger.info('✅ API test cleanup completed');
  }
}

export default APIIntegrationTestRunner;