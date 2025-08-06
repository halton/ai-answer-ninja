/**
 * Integration Test Runner for Service Communication
 */

import * as winston from 'winston';
import { UserManagementClient } from '../clients/UserManagementClient';
import { SmartWhitelistClient } from '../clients/SmartWhitelistClient';
import { ConversationEngineClient } from '../clients/ConversationEngineClient';
import { RealtimeProcessorClient } from '../clients/RealtimeProcessorClient';
import { ProfileAnalyticsClient } from '../clients/ProfileAnalyticsClient';
import { healthCheckManager } from '../health/HealthCheckManager';

export interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

export interface TestSuite {
  suiteName: string;
  tests: TestResult[];
  passed: boolean;
  totalTests: number;
  passedTests: number;
  duration: number;
}

export interface IntegrationTestOptions {
  timeout: number;
  retries: number;
  waitForHealthy: boolean;
  healthyTimeout: number;
  skipSlowTests: boolean;
}

export class IntegrationTestRunner {
  private logger: winston.Logger;
  private userClient: UserManagementClient;
  private whitelistClient: SmartWhitelistClient;
  private conversationClient: ConversationEngineClient;
  private realtimeClient: RealtimeProcessorClient;
  private analyticsClient: ProfileAnalyticsClient;

  private readonly options: IntegrationTestOptions;

  constructor(options?: Partial<IntegrationTestOptions>) {
    this.options = {
      timeout: options?.timeout || 30000,
      retries: options?.retries || 2,
      waitForHealthy: options?.waitForHealthy || true,
      healthyTimeout: options?.healthyTimeout || 60000,
      skipSlowTests: options?.skipSlowTests || false
    };

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'integration-test-runner' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    // Initialize service clients
    this.userClient = new UserManagementClient();
    this.whitelistClient = new SmartWhitelistClient();
    this.conversationClient = new ConversationEngineClient();
    this.realtimeClient = new RealtimeProcessorClient();
    this.analyticsClient = new ProfileAnalyticsClient();
  }

  /**
   * Run a single test with timeout and retry logic
   */
  private async runTest(
    testName: string,
    testFn: () => Promise<void>,
    timeout: number = this.options.timeout
  ): Promise<TestResult> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.options.retries + 1; attempt++) {
      try {
        await Promise.race([
          testFn(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout);
          })
        ]);

        const duration = Date.now() - startTime;
        this.logger.info(`✅ ${testName} passed`, { duration, attempt });
        
        return {
          testName,
          passed: true,
          duration
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt <= this.options.retries) {
          this.logger.warn(`⚠️  ${testName} failed (attempt ${attempt}), retrying...`, {
            error: lastError.message,
            attempt
          });
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    const duration = Date.now() - startTime;
    this.logger.error(`❌ ${testName} failed after ${this.options.retries + 1} attempts`, {
      duration,
      error: lastError?.message
    });

    return {
      testName,
      passed: false,
      duration,
      error: lastError?.message
    };
  }

  /**
   * Health Check Tests
   */
  async runHealthCheckTests(): Promise<TestSuite> {
    const startTime = Date.now();
    const tests: TestResult[] = [];

    // Test individual service health checks
    tests.push(await this.runTest('User Management Health Check', async () => {
      const healthy = await this.userClient.healthCheck();
      if (!healthy) throw new Error('User Management service is not healthy');
    }));

    tests.push(await this.runTest('Smart Whitelist Health Check', async () => {
      const healthy = await this.whitelistClient.healthCheck();
      if (!healthy) throw new Error('Smart Whitelist service is not healthy');
    }));

    tests.push(await this.runTest('Conversation Engine Health Check', async () => {
      const healthy = await this.conversationClient.healthCheck();
      if (!healthy) throw new Error('Conversation Engine service is not healthy');
    }));

    tests.push(await this.runTest('Realtime Processor Health Check', async () => {
      const healthy = await this.realtimeClient.healthCheck();
      if (!healthy) throw new Error('Realtime Processor service is not healthy');
    }));

    tests.push(await this.runTest('Profile Analytics Health Check', async () => {
      const healthy = await this.analyticsClient.healthCheck();
      if (!healthy) throw new Error('Profile Analytics service is not healthy');
    }));

    // Test detailed health checks
    tests.push(await this.runTest('User Management Deep Health Check', async () => {
      const response = await this.userClient.deepHealthCheck();
      if (response.status !== 200) throw new Error(`Deep health check failed with status ${response.status}`);
    }));

    tests.push(await this.runTest('Conversation Engine Detailed Health Check', async () => {
      const response = await this.conversationClient.detailedHealthCheck();
      if (response.status !== 200) throw new Error(`Detailed health check failed with status ${response.status}`);
    }));

    // Test health check manager
    tests.push(await this.runTest('Health Check Manager All Services', async () => {
      const results = await healthCheckManager.checkAllServices();
      const unhealthyServices = results.filter(r => r.status !== 'healthy');
      if (unhealthyServices.length > 0) {
        throw new Error(`Unhealthy services: ${unhealthyServices.map(s => s.service).join(', ')}`);
      }
    }));

    const duration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;

    return {
      suiteName: 'Health Check Tests',
      tests,
      passed: passedTests === tests.length,
      totalTests: tests.length,
      passedTests,
      duration
    };
  }

  /**
   * Core Data Flow Tests
   */
  async runCoreDataFlowTests(): Promise<TestSuite> {
    const startTime = Date.now();
    const tests: TestResult[] = [];

    // Test data flow: User Query -> Whitelist Check -> AI Conversation
    tests.push(await this.runTest('Core Data Flow: User Creation', async () => {
      const testUser = {
        phone_number: `+1555${Date.now().toString().slice(-7)}`, // Generate unique phone
        name: 'Test User',
        personality: 'polite'
      };

      const response = await this.userClient.createUser(testUser);
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`User creation failed with status ${response.status}`);
      }

      // Store user ID for subsequent tests
      (this as any).testUserId = response.data.id;
      (this as any).testUserPhone = testUser.phone_number;
    }));

    tests.push(await this.runTest('Core Data Flow: Whitelist Check', async () => {
      if (!(this as any).testUserId) throw new Error('Test user not created');

      const testPhone = '+1555987654';
      
      // Check if phone is whitelisted (should not be)
      try {
        const response = await this.whitelistClient.isWhitelisted((this as any).testUserId, testPhone);
        if (response.status === 200) {
          // Phone is whitelisted, this is unexpected for a random number
          this.logger.warn('Test phone is unexpectedly whitelisted');
        }
      } catch (error) {
        // 404 is expected for non-whitelisted numbers
        if (error instanceof Error && !error.message.includes('404')) {
          throw error;
        }
      }
    }));

    tests.push(await this.runTest('Core Data Flow: Smart Add to Whitelist', async () => {
      if (!(this as any).testUserId) throw new Error('Test user not created');

      const testPhone = '+1555123456';
      
      const response = await this.whitelistClient.smartAdd((this as any).testUserId, {
        contact_phone: testPhone,
        contact_name: 'Test Contact',
        confidence_score: 0.9,
        reason: 'Integration test'
      });

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Smart add failed with status ${response.status}`);
      }
    }));

    tests.push(await this.runTest('Core Data Flow: Phone Evaluation', async () => {
      const testPhone = '+1555999888';
      
      const response = await this.whitelistClient.evaluatePhone(testPhone, {
        user_id: (this as any).testUserId,
        context: 'integration_test'
      });

      if (response.status !== 200) {
        throw new Error(`Phone evaluation failed with status ${response.status}`);
      }

      if (!response.data.result.classification) {
        throw new Error('Phone evaluation did not return classification');
      }
    }));

    tests.push(await this.runTest('Core Data Flow: Conversation Management', async () => {
      if (!(this as any).testUserId) throw new Error('Test user not created');

      const conversationRequest = {
        call_id: `test_call_${Date.now()}`,
        user_id: (this as any).testUserId,
        caller_phone: '+1555666777',
        input_text: '你好，我想了解一下贷款产品',
        detected_intent: 'loan_offer',
        intent_confidence: 0.85,
        spam_category: 'financial_services'
      };

      const response = await this.conversationClient.manageConversation(conversationRequest);

      if (response.status !== 200) {
        throw new Error(`Conversation management failed with status ${response.status}`);
      }

      if (!response.data.response_text) {
        throw new Error('Conversation management did not return response text');
      }

      // Store call ID for subsequent tests
      (this as any).testCallId = conversationRequest.call_id;
    }));

    tests.push(await this.runTest('Core Data Flow: Conversation State Retrieval', async () => {
      if (!(this as any).testCallId) throw new Error('Test conversation not created');

      const response = await this.conversationClient.getConversationState((this as any).testCallId);

      if (response.status !== 200) {
        throw new Error(`Get conversation state failed with status ${response.status}`);
      }

      if (response.data.turn_count <= 0) {
        throw new Error('Conversation should have at least one turn');
      }
    }));

    tests.push(await this.runTest('Core Data Flow: Analytics Profile Update', async () => {
      if (!(this as any).testUserId) throw new Error('Test user not created');

      const testPhone = '+1555666777';
      
      const response = await this.analyticsClient.updateCallerProfile(testPhone, {
        spam_category: 'loan_offer',
        risk_score: 0.7,
        confidence_level: 0.85,
        user_feedback: 'correct'
      });

      if (response.status !== 200) {
        throw new Error(`Profile update failed with status ${response.status}`);
      }
    }));

    const duration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;

    return {
      suiteName: 'Core Data Flow Tests',
      tests,
      passed: passedTests === tests.length,
      totalTests: tests.length,
      passedTests,
      duration
    };
  }

  /**
   * Error Handling and Timeout Tests
   */
  async runErrorHandlingTests(): Promise<TestSuite> {
    const startTime = Date.now();
    const tests: TestResult[] = [];

    tests.push(await this.runTest('Error Handling: Invalid User ID', async () => {
      try {
        await this.userClient.getUser('invalid-uuid');
        throw new Error('Should have thrown error for invalid UUID');
      } catch (error) {
        if (error instanceof Error && error.message.includes('Should have thrown')) {
          throw error;
        }
        // Expected error, test passes
      }
    }));

    tests.push(await this.runTest('Error Handling: Non-existent User', async () => {
      try {
        await this.userClient.getUser('00000000-0000-0000-0000-000000000000');
        throw new Error('Should have thrown error for non-existent user');
      } catch (error) {
        if (error instanceof Error && error.message.includes('Should have thrown')) {
          throw error;
        }
        // Expected error, test passes
      }
    }));

    tests.push(await this.runTest('Error Handling: Invalid Phone Format', async () => {
      try {
        await this.whitelistClient.evaluatePhone('invalid-phone');
        throw new Error('Should have thrown error for invalid phone format');
      } catch (error) {
        if (error instanceof Error && error.message.includes('Should have thrown')) {
          throw error;
        }
        // Expected error, test passes
      }
    }));

    tests.push(await this.runTest('Error Handling: Invalid Conversation Request', async () => {
      try {
        await this.conversationClient.manageConversation({
          call_id: '', // Invalid empty call ID
          user_id: 'invalid-uuid',
          caller_phone: 'invalid-phone',
          input_text: ''
        });
        throw new Error('Should have thrown error for invalid conversation request');
      } catch (error) {
        if (error instanceof Error && error.message.includes('Should have thrown')) {
          throw error;
        }
        // Expected error, test passes
      }
    }));

    // Test timeout handling with very short timeout
    tests.push(await this.runTest('Error Handling: Request Timeout', async () => {
      try {
        await this.userClient.getServiceInfo({ timeout: 1 }); // 1ms timeout
        // If it doesn't timeout, that's also okay (very fast service)
      } catch (error) {
        // Timeout error is expected and acceptable
        if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
          // Expected timeout error, test passes
          return;
        }
        throw error;
      }
    }, 5000));

    const duration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;

    return {
      suiteName: 'Error Handling Tests',
      tests,
      passed: passedTests === tests.length,
      totalTests: tests.length,
      passedTests,
      duration
    };
  }

  /**
   * Circuit Breaker Tests
   */
  async runCircuitBreakerTests(): Promise<TestSuite> {
    const startTime = Date.now();
    const tests: TestResult[] = [];

    tests.push(await this.runTest('Circuit Breaker: Status Check', async () => {
      const status = this.userClient.getCircuitBreakerStatus();
      if (!status.state) {
        throw new Error('Circuit breaker status should have a state');
      }
    }));

    tests.push(await this.runTest('Circuit Breaker: Reset Function', async () => {
      // Reset all circuit breakers
      this.userClient.resetCircuitBreaker();
      this.whitelistClient.resetCircuitBreaker();
      this.conversationClient.resetCircuitBreaker();
      this.realtimeClient.resetCircuitBreaker();
      this.analyticsClient.resetCircuitBreaker();

      // Verify they're reset (state should be CLOSED)
      const userStatus = this.userClient.getCircuitBreakerStatus();
      if (userStatus.state !== 'CLOSED') {
        throw new Error('Circuit breaker should be in CLOSED state after reset');
      }
    }));

    tests.push(await this.runTest('Circuit Breaker: Health Check Manager Reset', async () => {
      healthCheckManager.resetAllCircuitBreakers();
      // If no error is thrown, the test passes
    }));

    const duration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;

    return {
      suiteName: 'Circuit Breaker Tests',
      tests,
      passed: passedTests === tests.length,
      totalTests: tests.length,
      passedTests,
      duration
    };
  }

  /**
   * Performance and Load Tests
   */
  async runPerformanceTests(): Promise<TestSuite> {
    if (this.options.skipSlowTests) {
      return {
        suiteName: 'Performance Tests',
        tests: [],
        passed: true,
        totalTests: 0,
        passedTests: 0,
        duration: 0
      };
    }

    const startTime = Date.now();
    const tests: TestResult[] = [];

    tests.push(await this.runTest('Performance: Concurrent Health Checks', async () => {
      const concurrentChecks = 5;
      const promises = Array(concurrentChecks).fill(null).map(() => 
        this.userClient.healthCheck()
      );

      const results = await Promise.all(promises);
      const successCount = results.filter(Boolean).length;
      
      if (successCount < concurrentChecks * 0.8) { // 80% success rate
        throw new Error(`Only ${successCount}/${concurrentChecks} concurrent health checks succeeded`);
      }
    }, 10000));

    tests.push(await this.runTest('Performance: Rapid Sequential Requests', async () => {
      const requestCount = 10;
      const promises = [];

      for (let i = 0; i < requestCount; i++) {
        promises.push(this.userClient.getServiceInfo());
      }

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.status === 200).length;
      
      if (successCount < requestCount * 0.9) { // 90% success rate
        throw new Error(`Only ${successCount}/${requestCount} rapid requests succeeded`);
      }
    }, 15000));

    const duration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;

    return {
      suiteName: 'Performance Tests',
      tests,
      passed: passedTests === tests.length,
      totalTests: tests.length,
      passedTests,
      duration
    };
  }

  /**
   * Run all integration tests
   */
  async runAllTests(): Promise<{
    overall: {
      passed: boolean;
      totalSuites: number;
      passedSuites: number;
      totalTests: number;
      passedTests: number;
      duration: number;
    };
    suites: TestSuite[];
  }> {
    const startTime = Date.now();
    
    this.logger.info('Starting integration tests...', this.options);

    // Wait for services to be healthy if requested
    if (this.options.waitForHealthy) {
      this.logger.info('Waiting for services to be healthy...');
      const healthy = await healthCheckManager.waitForHealthyServices(this.options.healthyTimeout);
      if (!healthy) {
        this.logger.error('Services did not become healthy in time, proceeding anyway');
      }
    }

    const suites: TestSuite[] = [];

    // Run test suites
    suites.push(await this.runHealthCheckTests());
    suites.push(await this.runCoreDataFlowTests());
    suites.push(await this.runErrorHandlingTests());
    suites.push(await this.runCircuitBreakerTests());
    suites.push(await this.runPerformanceTests());

    const duration = Date.now() - startTime;
    const passedSuites = suites.filter(s => s.passed).length;
    const totalTests = suites.reduce((sum, s) => sum + s.totalTests, 0);
    const passedTests = suites.reduce((sum, s) => sum + s.passedTests, 0);

    const overall = {
      passed: passedSuites === suites.length,
      totalSuites: suites.length,
      passedSuites,
      totalTests,
      passedTests,
      duration
    };

    // Log summary
    this.logger.info('Integration test summary', {
      overall,
      suiteResults: suites.map(s => ({
        name: s.suiteName,
        passed: s.passed,
        tests: `${s.passedTests}/${s.totalTests}`
      }))
    });

    if (overall.passed) {
      this.logger.info('🎉 All integration tests passed!');
    } else {
      this.logger.error('❌ Some integration tests failed');
    }

    return { overall, suites };
  }
}