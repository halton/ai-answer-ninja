/**
 * End-to-End Test Runner for AI Phone Answering System
 * 
 * This test runner validates complete business workflows:
 * 1. Incoming call -> Whitelist check -> AI response -> Call logging
 * 2. User management -> Configuration -> Real-time processing
 * 3. Profile analytics -> ML processing -> Response optimization
 */

import * as winston from 'winston';
import { performance } from 'perf_hooks';
import WebSocket from 'ws';
import axios, { AxiosResponse } from 'axios';

export interface E2ETestConfig {
  services: {
    userManagement: string;
    smartWhitelist: string;
    conversationEngine: string;
    realtimeProcessor: string;
    profileAnalytics: string;
    adminPanel: string;
  };
  timeouts: {
    short: number;
    medium: number;
    long: number;
    realtime: number;
  };
  retries: {
    default: number;
    websocket: number;
    database: number;
  };
  thresholds: {
    responseTime: number;
    accuracy: number;
    availability: number;
  };
}

export interface E2ETestResult {
  testName: string;
  category: string;
  passed: boolean;
  duration: number;
  metrics?: {
    responseTime?: number;
    accuracy?: number;
    throughput?: number;
    errorRate?: number;
  };
  error?: string;
  details?: any;
}

export interface E2ETestSuite {
  suiteName: string;
  category: string;
  tests: E2ETestResult[];
  passed: boolean;
  duration: number;
  metrics: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    averageResponseTime: number;
    overallAccuracy: number;
  };
}

export class E2ETestRunner {
  private logger: winston.Logger;
  private config: E2ETestConfig;
  private testContext: Map<string, any> = new Map();

  constructor(config: E2ETestConfig) {
    this.config = config;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { 
        service: 'e2e-test-runner',
        version: '1.0.0'
      },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              return `${timestamp} [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            })
          )
        }),
        new winston.transports.File({
          filename: 'logs/e2e-tests.log',
          format: winston.format.json()
        })
      ]
    });
  }

  /**
   * Execute a single test with comprehensive error handling and metrics collection
   */
  private async executeTest(
    testName: string,
    category: string,
    testFn: () => Promise<{ metrics?: any; details?: any }>,
    timeout: number = this.config.timeouts.medium
  ): Promise<E2ETestResult> {
    const startTime = performance.now();
    let attempt = 0;
    let lastError: Error | undefined;
    const maxRetries = this.config.retries.default;

    this.logger.info(`🧪 Starting test: ${testName}`, { category, timeout });

    while (attempt <= maxRetries) {
      try {
        const testPromise = testFn();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout);
        });

        const result = await Promise.race([testPromise, timeoutPromise]) as { metrics?: any; details?: any };
        const duration = performance.now() - startTime;

        this.logger.info(`✅ Test passed: ${testName}`, {
          category,
          duration: Math.round(duration),
          attempt: attempt + 1,
          metrics: result.metrics
        });

        return {
          testName,
          category,
          passed: true,
          duration: Math.round(duration),
          metrics: result.metrics,
          details: result.details
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt <= maxRetries) {
          this.logger.warn(`⚠️ Test failed (attempt ${attempt}/${maxRetries + 1}): ${testName}`, {
            category,
            error: lastError.message,
            retryDelay: attempt * 1000
          });
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    const duration = performance.now() - startTime;
    this.logger.error(`❌ Test failed: ${testName}`, {
      category,
      duration: Math.round(duration),
      attempts: attempt,
      error: lastError?.message
    });

    return {
      testName,
      category,
      passed: false,
      duration: Math.round(duration),
      error: lastError?.message
    };
  }

  /**
   * Complete Business Workflow Tests
   */
  async runCompleteWorkflowTests(): Promise<E2ETestSuite> {
    const startTime = performance.now();
    const tests: E2ETestResult[] = [];
    const category = 'Complete Workflow';

    // Test 1: New User Registration and Setup
    tests.push(await this.executeTest(
      'Complete User Onboarding Flow',
      category,
      async () => {
        const testUser = {
          phone_number: `+1555${Date.now().toString().slice(-7)}`,
          name: 'E2E Test User',
          personality: 'professional',
          preferences: {
            response_style: 'polite_decline',
            max_call_duration: 180,
            auto_hang_up: true
          }
        };

        // Step 1: Create user
        const userResponse = await axios.post(
          `${this.config.services.userManagement}/api/users`,
          testUser,
          { timeout: this.config.timeouts.short }
        );

        if (userResponse.status !== 201) {
          throw new Error(`User creation failed: ${userResponse.status}`);
        }

        const userId = userResponse.data.id;
        this.testContext.set('testUserId', userId);
        this.testContext.set('testUserPhone', testUser.phone_number);

        // Step 2: Verify user profile in analytics service
        const profileResponse = await axios.get(
          `${this.config.services.profileAnalytics}/api/profile/${testUser.phone_number}`,
          { timeout: this.config.timeouts.short }
        );

        // Profile might not exist yet for new user - this is expected
        if (profileResponse.status !== 200 && profileResponse.status !== 404) {
          throw new Error(`Unexpected profile response: ${profileResponse.status}`);
        }

        // Step 3: Initialize whitelist
        const whitelistResponse = await axios.get(
          `${this.config.services.smartWhitelist}/api/whitelist/${userId}`,
          { timeout: this.config.timeouts.short }
        );

        if (whitelistResponse.status !== 200) {
          throw new Error(`Whitelist initialization failed: ${whitelistResponse.status}`);
        }

        return {
          metrics: {
            responseTime: userResponse.headers['x-response-time'] || 0,
            userId: userId
          },
          details: {
            userCreated: true,
            whitelistInitialized: true
          }
        };
      },
      this.config.timeouts.medium
    ));

    // Test 2: Incoming Call Processing Workflow
    tests.push(await this.executeTest(
      'Complete Incoming Call Processing',
      category,
      async () => {
        const userId = this.testContext.get('testUserId');
        if (!userId) throw new Error('Test user not created');

        const incomingCall = {
          call_id: `e2e_call_${Date.now()}`,
          caller_phone: '+1555987654',
          called_phone: this.testContext.get('testUserPhone'),
          timestamp: new Date().toISOString()
        };

        // Step 1: Check if caller is whitelisted
        const whitelistCheckStart = performance.now();
        let isWhitelisted = false;
        
        try {
          const whitelistResponse = await axios.get(
            `${this.config.services.smartWhitelist}/api/whitelist/${userId}/check/${incomingCall.caller_phone}`,
            { timeout: this.config.timeouts.short }
          );
          isWhitelisted = whitelistResponse.data.is_whitelisted || false;
        } catch (error) {
          // Not whitelisted - expected for random number
          isWhitelisted = false;
        }

        const whitelistCheckTime = performance.now() - whitelistCheckStart;

        // Step 2: If not whitelisted, get caller profile
        let callerProfile = null;
        const profileCheckStart = performance.now();
        
        if (!isWhitelisted) {
          try {
            const profileResponse = await axios.get(
              `${this.config.services.profileAnalytics}/api/profile/${incomingCall.caller_phone}`,
              { timeout: this.config.timeouts.short }
            );
            callerProfile = profileResponse.data;
          } catch (error) {
            // Profile doesn't exist - will be created
          }
        }

        const profileCheckTime = performance.now() - profileCheckStart;

        // Step 3: Process through conversation engine
        const conversationStart = performance.now();
        
        const conversationRequest = {
          call_id: incomingCall.call_id,
          user_id: userId,
          caller_phone: incomingCall.caller_phone,
          input_text: '你好，我是XX银行的客服，想向您推荐我们的信用卡产品',
          detected_intent: 'credit_card_sales',
          intent_confidence: 0.92,
          spam_category: 'financial_services',
          is_whitelisted: isWhitelisted
        };

        const conversationResponse = await axios.post(
          `${this.config.services.conversationEngine}/api/conversation/manage`,
          conversationRequest,
          { timeout: this.config.timeouts.medium }
        );

        if (conversationResponse.status !== 200) {
          throw new Error(`Conversation processing failed: ${conversationResponse.status}`);
        }

        const conversationTime = performance.now() - conversationStart;

        this.testContext.set('testCallId', incomingCall.call_id);

        return {
          metrics: {
            responseTime: whitelistCheckTime + profileCheckTime + conversationTime,
            whitelistCheckTime: Math.round(whitelistCheckTime),
            profileCheckTime: Math.round(profileCheckTime),
            conversationTime: Math.round(conversationTime),
            accuracy: conversationResponse.data.confidence || 0
          },
          details: {
            isWhitelisted,
            callerProfileExists: !!callerProfile,
            responseGenerated: !!conversationResponse.data.response_text,
            shouldTerminate: conversationResponse.data.should_terminate
          }
        };
      },
      this.config.timeouts.long
    ));

    // Test 3: Real-time Audio Processing Simulation
    tests.push(await this.executeTest(
      'Real-time Audio Processing Workflow',
      category,
      async () => {
        const callId = this.testContext.get('testCallId');
        if (!callId) throw new Error('Test call not created');

        const wsUrl = `ws://${this.config.services.realtimeProcessor.replace('http://', '')}/ws/audio/${callId}`;
        
        return new Promise((resolve, reject) => {
          let websocket: WebSocket;
          let processingLatencies: number[] = [];
          let messagesReceived = 0;
          const targetMessages = 3;

          const timeout = setTimeout(() => {
            websocket?.close();
            reject(new Error('WebSocket test timeout'));
          }, this.config.timeouts.realtime);

          try {
            websocket = new WebSocket(wsUrl);

            websocket.on('open', () => {
              this.logger.info('WebSocket connected for audio processing test');

              // Simulate audio chunks
              const audioChunks = [
                { type: 'audio_chunk', data: 'mock_audio_data_1', sequence: 1 },
                { type: 'audio_chunk', data: 'mock_audio_data_2', sequence: 2 },
                { type: 'audio_chunk', data: 'audio_end', sequence: 3 }
              ];

              audioChunks.forEach((chunk, index) => {
                setTimeout(() => {
                  const sendTime = performance.now();
                  websocket.send(JSON.stringify({
                    ...chunk,
                    timestamp: sendTime,
                    call_id: callId
                  }));
                }, index * 500);
              });
            });

            websocket.on('message', (data) => {
              const receiveTime = performance.now();
              const message = JSON.parse(data.toString());
              
              if (message.type === 'audio_response' || message.type === 'processing_complete') {
                const latency = receiveTime - (message.original_timestamp || receiveTime);
                processingLatencies.push(latency);
                messagesReceived++;

                if (messagesReceived >= targetMessages || message.type === 'processing_complete') {
                  clearTimeout(timeout);
                  websocket.close();
                  
                  const averageLatency = processingLatencies.reduce((a, b) => a + b, 0) / processingLatencies.length;
                  
                  resolve({
                    metrics: {
                      responseTime: Math.round(averageLatency),
                      throughput: messagesReceived,
                      accuracy: message.confidence || 0.8
                    },
                    details: {
                      messagesProcessed: messagesReceived,
                      latencies: processingLatencies.map(l => Math.round(l)),
                      finalMessage: message
                    }
                  });
                }
              }
            });

            websocket.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });

          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      },
      this.config.timeouts.realtime
    ));

    // Test 4: Analytics and Learning Loop
    tests.push(await this.executeTest(
      'Analytics and Learning Workflow',
      category,
      async () => {
        const userId = this.testContext.get('testUserId');
        const callId = this.testContext.get('testCallId');
        
        if (!userId || !callId) throw new Error('Test context missing');

        // Step 1: Analyze call effectiveness
        const analysisStart = performance.now();
        
        const analysisRequest = {
          call_id: callId,
          user_feedback: 'effective',
          call_outcome: 'caller_hung_up',
          duration_seconds: 45,
          turn_count: 3
        };

        const analysisResponse = await axios.post(
          `${this.config.services.profileAnalytics}/api/analysis/call-effectiveness`,
          analysisRequest,
          { timeout: this.config.timeouts.medium }
        );

        if (analysisResponse.status !== 200) {
          throw new Error(`Call analysis failed: ${analysisResponse.status}`);
        }

        const analysisTime = performance.now() - analysisStart;

        // Step 2: Update caller profile based on interaction
        const updateStart = performance.now();
        
        const profileUpdate = {
          phone: '+1555987654',
          spam_category: 'financial_services',
          risk_score: 0.85,
          confidence_level: 0.92,
          behavioral_patterns: {
            persistence_level: 'medium',
            response_to_polite_decline: 'continued_calling',
            typical_call_duration: 45
          }
        };

        const updateResponse = await axios.put(
          `${this.config.services.profileAnalytics}/api/profile/update`,
          profileUpdate,
          { timeout: this.config.timeouts.medium }
        );

        if (updateResponse.status !== 200) {
          throw new Error(`Profile update failed: ${updateResponse.status}`);
        }

        const updateTime = performance.now() - updateStart;

        // Step 3: Trigger learning optimization
        const learningStart = performance.now();
        
        const learningResponse = await axios.post(
          `${this.config.services.conversationEngine}/api/learning/optimize`,
          {
            user_id: userId,
            call_data: {
              call_id: callId,
              effectiveness_score: analysisResponse.data.effectiveness_score,
              response_quality: analysisResponse.data.response_quality
            }
          },
          { timeout: this.config.timeouts.long }
        );

        if (learningResponse.status !== 200) {
          throw new Error(`Learning optimization failed: ${learningResponse.status}`);
        }

        const learningTime = performance.now() - learningStart;

        return {
          metrics: {
            responseTime: analysisTime + updateTime + learningTime,
            analysisTime: Math.round(analysisTime),
            updateTime: Math.round(updateTime),
            learningTime: Math.round(learningTime),
            accuracy: analysisResponse.data.effectiveness_score || 0
          },
          details: {
            analysisComplete: true,
            profileUpdated: true,
            learningTriggered: true,
            effectivenessScore: analysisResponse.data.effectiveness_score
          }
        };
      },
      this.config.timeouts.long
    ));

    const duration = performance.now() - startTime;
    const passedTests = tests.filter(t => t.passed);
    const failedTests = tests.filter(t => !t.passed);
    const averageResponseTime = tests
      .filter(t => t.metrics?.responseTime)
      .reduce((sum, t) => sum + (t.metrics?.responseTime || 0), 0) / 
      tests.filter(t => t.metrics?.responseTime).length || 0;
    const overallAccuracy = tests
      .filter(t => t.metrics?.accuracy)
      .reduce((sum, t) => sum + (t.metrics?.accuracy || 0), 0) / 
      tests.filter(t => t.metrics?.accuracy).length || 0;

    return {
      suiteName: 'Complete Business Workflow Tests',
      category,
      tests,
      passed: failedTests.length === 0,
      duration: Math.round(duration),
      metrics: {
        totalTests: tests.length,
        passedTests: passedTests.length,
        failedTests: failedTests.length,
        averageResponseTime: Math.round(averageResponseTime),
        overallAccuracy: Math.round(overallAccuracy * 100) / 100
      }
    };
  }

  /**
   * System Resilience and Fault Tolerance Tests
   */
  async runResilienceTests(): Promise<E2ETestSuite> {
    const startTime = performance.now();
    const tests: E2ETestResult[] = [];
    const category = 'System Resilience';

    // Test database connection resilience
    tests.push(await this.executeTest(
      'Database Connection Resilience',
      category,
      async () => {
        const userId = this.testContext.get('testUserId');
        if (!userId) throw new Error('Test user not created');

        // Simulate high load with concurrent requests
        const concurrentRequests = 10;
        const promises = Array(concurrentRequests).fill(null).map(async (_, index) => {
          const start = performance.now();
          const response = await axios.get(
            `${this.config.services.userManagement}/api/users/${userId}`,
            { 
              timeout: this.config.timeouts.short,
              headers: { 'X-Test-Request': `concurrent-${index}` }
            }
          );
          const duration = performance.now() - start;
          return { response, duration, index };
        });

        const results = await Promise.all(promises);
        const successful = results.filter(r => r.response.status === 200);
        const averageResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

        if (successful.length < concurrentRequests * 0.9) {
          throw new Error(`Only ${successful.length}/${concurrentRequests} concurrent requests succeeded`);
        }

        return {
          metrics: {
            responseTime: Math.round(averageResponseTime),
            throughput: successful.length,
            accuracy: successful.length / concurrentRequests
          },
          details: {
            concurrentRequests,
            successfulRequests: successful.length,
            failedRequests: concurrentRequests - successful.length
          }
        };
      },
      this.config.timeouts.long
    ));

    // Test service failover and recovery
    tests.push(await this.executeTest(
      'Service Failover and Recovery',
      category,
      async () => {
        // Test circuit breaker behavior
        const invalidRequests = 5;
        const failedRequests = [];

        // Generate some failures to trigger circuit breaker
        for (let i = 0; i < invalidRequests; i++) {
          try {
            await axios.get(
              `${this.config.services.userManagement}/api/users/invalid-uuid-${i}`,
              { timeout: this.config.timeouts.short }
            );
          } catch (error) {
            failedRequests.push(error);
          }
        }

        // Now test if service still responds to valid requests
        const userId = this.testContext.get('testUserId');
        const recoveryStart = performance.now();
        
        const recoveryResponse = await axios.get(
          `${this.config.services.userManagement}/api/users/${userId}`,
          { timeout: this.config.timeouts.short }
        );

        const recoveryTime = performance.now() - recoveryStart;

        if (recoveryResponse.status !== 200) {
          throw new Error('Service did not recover from circuit breaker state');
        }

        return {
          metrics: {
            responseTime: Math.round(recoveryTime),
            errorRate: failedRequests.length / invalidRequests
          },
          details: {
            failuresGenerated: failedRequests.length,
            recoverySuccessful: true,
            circuitBreakerTested: true
          }
        };
      },
      this.config.timeouts.medium
    ));

    const duration = performance.now() - startTime;
    const passedTests = tests.filter(t => t.passed);

    return {
      suiteName: 'System Resilience Tests',
      category,
      tests,
      passed: tests.every(t => t.passed),
      duration: Math.round(duration),
      metrics: {
        totalTests: tests.length,
        passedTests: passedTests.length,
        failedTests: tests.length - passedTests.length,
        averageResponseTime: tests.reduce((sum, t) => sum + (t.metrics?.responseTime || 0), 0) / tests.length,
        overallAccuracy: tests.reduce((sum, t) => sum + (t.metrics?.accuracy || 0), 0) / tests.length
      }
    };
  }

  /**
   * Run all E2E test suites
   */
  async runAllTests(): Promise<{
    summary: {
      passed: boolean;
      totalSuites: number;
      passedSuites: number;
      totalTests: number;
      passedTests: number;
      duration: number;
      overallMetrics: {
        averageResponseTime: number;
        systemAvailability: number;
        accuracy: number;
      };
    };
    suites: E2ETestSuite[];
  }> {
    const startTime = performance.now();
    
    this.logger.info('🚀 Starting End-to-End Tests', {
      config: {
        services: Object.keys(this.config.services),
        timeouts: this.config.timeouts,
        thresholds: this.config.thresholds
      }
    });

    // Wait for all services to be healthy
    await this.waitForServicesHealthy();

    const suites: E2ETestSuite[] = [];

    try {
      // Run test suites
      suites.push(await this.runCompleteWorkflowTests());
      suites.push(await this.runResilienceTests());

      const duration = performance.now() - startTime;
      const passedSuites = suites.filter(s => s.passed);
      const totalTests = suites.reduce((sum, s) => sum + s.metrics.totalTests, 0);
      const passedTests = suites.reduce((sum, s) => sum + s.metrics.passedTests, 0);

      const overallMetrics = this.calculateOverallMetrics(suites);

      const summary = {
        passed: passedSuites.length === suites.length,
        totalSuites: suites.length,
        passedSuites: passedSuites.length,
        totalTests,
        passedTests,
        duration: Math.round(duration),
        overallMetrics
      };

      // Log comprehensive summary
      this.logger.info('🎯 E2E Test Summary', {
        summary,
        suiteBreakdown: suites.map(s => ({
          name: s.suiteName,
          passed: s.passed,
          tests: `${s.metrics.passedTests}/${s.metrics.totalTests}`,
          avgResponseTime: `${s.metrics.averageResponseTime}ms`,
          accuracy: `${Math.round(s.metrics.overallAccuracy * 100)}%`
        }))
      });

      if (summary.passed) {
        this.logger.info('🎉 All E2E tests passed!');
      } else {
        this.logger.error('❌ Some E2E tests failed');
      }

      return { summary, suites };

    } catch (error) {
      this.logger.error('💥 E2E test execution failed', { error: (error as Error).message });
      throw error;
    }
  }

  private async waitForServicesHealthy(): Promise<void> {
    this.logger.info('⏳ Waiting for services to be healthy...');
    
    const healthChecks = Object.entries(this.config.services).map(async ([name, url]) => {
      const maxAttempts = 30;
      const delay = 2000;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await axios.get(`${url}/health`, {
            timeout: this.config.timeouts.short
          });
          
          if (response.status === 200) {
            this.logger.info(`✅ Service ${name} is healthy`);
            return true;
          }
        } catch (error) {
          if (attempt < maxAttempts) {
            this.logger.warn(`⏰ Service ${name} not ready (attempt ${attempt}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            this.logger.error(`❌ Service ${name} failed to become healthy`);
            return false;
          }
        }
      }
      return false;
    });

    const results = await Promise.all(healthChecks);
    const healthyServices = results.filter(Boolean).length;
    
    this.logger.info(`📊 Service Health Status: ${healthyServices}/${results.length} services healthy`);
    
    if (healthyServices < results.length) {
      throw new Error(`Only ${healthyServices}/${results.length} services are healthy`);
    }
  }

  private calculateOverallMetrics(suites: E2ETestSuite[]) {
    const allResponseTimes = suites.flatMap(s => 
      s.tests.filter(t => t.metrics?.responseTime).map(t => t.metrics!.responseTime!)
    );
    const allAccuracies = suites.flatMap(s => 
      s.tests.filter(t => t.metrics?.accuracy).map(t => t.metrics!.accuracy!)
    );
    const allTests = suites.flatMap(s => s.tests);

    return {
      averageResponseTime: allResponseTimes.length > 0 
        ? Math.round(allResponseTimes.reduce((a, b) => a + b) / allResponseTimes.length)
        : 0,
      systemAvailability: Math.round((allTests.filter(t => t.passed).length / allTests.length) * 100) / 100,
      accuracy: allAccuracies.length > 0 
        ? Math.round((allAccuracies.reduce((a, b) => a + b) / allAccuracies.length) * 100) / 100
        : 0
    };
  }

  /**
   * Clean up test data after tests complete
   */
  async cleanup(): Promise<void> {
    this.logger.info('🧹 Cleaning up test data...');
    
    try {
      const userId = this.testContext.get('testUserId');
      const callId = this.testContext.get('testCallId');

      if (userId) {
        // Delete test user
        await axios.delete(
          `${this.config.services.userManagement}/api/users/${userId}`,
          { timeout: this.config.timeouts.short }
        ).catch(error => {
          this.logger.warn('Failed to delete test user', { error: error.message });
        });
      }

      if (callId) {
        // Clean up call records
        await axios.delete(
          `${this.config.services.conversationEngine}/api/conversation/${callId}`,
          { timeout: this.config.timeouts.short }
        ).catch(error => {
          this.logger.warn('Failed to delete test call', { error: error.message });
        });
      }

      this.testContext.clear();
      this.logger.info('✅ Test cleanup completed');
      
    } catch (error) {
      this.logger.error('❌ Test cleanup failed', { error: (error as Error).message });
    }
  }
}

export default E2ETestRunner;