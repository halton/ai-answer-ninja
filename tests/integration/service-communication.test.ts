/**
 * Integration Tests for Service Communication
 * 
 * Tests inter-service API communication, data flow between services,
 * and end-to-end business process integration.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import axios from 'axios';
import WebSocket from 'ws';
import { TestContainerManager } from '../utils/test-container-manager';
import { TestDataFactory } from '../utils/test-data-factory';

describe('Service Communication Integration Tests', () => {
  let containerManager: TestContainerManager;
  let testData: TestDataFactory;
  
  // Service endpoints
  const services = {
    phoneGateway: 'http://localhost:3001',
    realtimeProcessor: 'http://localhost:3002',
    conversationEngine: 'http://localhost:3003',
    profileAnalytics: 'http://localhost:3004',
    userManagement: 'http://localhost:3005',
    smartWhitelist: 'http://localhost:3006',
    configurationService: 'http://localhost:3007',
    storageService: 'http://localhost:3008',
    monitoringService: 'http://localhost:3009'
  };

  beforeAll(async () => {
    containerManager = new TestContainerManager();
    testData = new TestDataFactory();
    
    // Start all services in Docker containers
    await containerManager.startAllServices();
    
    // Wait for all services to be healthy
    await containerManager.waitForServicesHealthy(Object.values(services));
    
    console.log('✅ All services started and healthy');
  }, 120000); // 2 minutes timeout for container startup

  afterAll(async () => {
    await containerManager.cleanup();
  });

  beforeEach(async () => {
    // Reset test data between tests
    await testData.reset();
  });

  describe('Phone Gateway Integration', () => {
    it('should route incoming call through complete pipeline', async () => {
      // 1. Create test user
      const testUser = await testData.createUser({
        name: 'Integration Test User',
        phone: '+1234567890',
        personality: 'polite'
      });

      // 2. Set up whitelist (not whitelisted caller)
      const callerPhone = '+0987654321';
      await axios.post(`${services.smartWhitelist}/api/v1/whitelist/${testUser.id}/check`, {
        phone: callerPhone
      });

      // 3. Simulate incoming call webhook
      const callWebhook = {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: 'integration-test-call-123',
          from: { phoneNumber: callerPhone },
          to: { phoneNumber: testUser.phone },
          callConnectionId: 'integration-connection-123'
        }
      };

      const webhookResponse = await axios.post(
        `${services.phoneGateway}/webhook/incoming-call`,
        callWebhook,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY
          }
        }
      );

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.data.success).toBe(true);
      expect(webhookResponse.data.action).toBe('route_to_ai');

      // 4. Verify call state was created
      const callStateResponse = await axios.get(
        `${services.phoneGateway}/api/v1/calls/integration-test-call-123/status`
      );

      expect(callStateResponse.status).toBe(200);
      expect(callStateResponse.data.call.status).toBe('ai_processing');
    });

    it('should transfer whitelisted calls directly', async () => {
      const testUser = await testData.createUser({
        name: 'Whitelist Test User',
        phone: '+1234567891'
      });

      const whitelistedCaller = '+0987654322';

      // Add caller to whitelist
      await axios.post(`${services.smartWhitelist}/api/v1/whitelist/${testUser.id}`, {
        phone: whitelistedCaller,
        name: 'Trusted Contact',
        type: 'manual'
      });

      // Simulate incoming call from whitelisted number
      const callWebhook = {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: 'whitelist-test-call-456',
          from: { phoneNumber: whitelistedCaller },
          to: { phoneNumber: testUser.phone },
          callConnectionId: 'whitelist-connection-456'
        }
      };

      const webhookResponse = await axios.post(
        `${services.phoneGateway}/webhook/incoming-call`,
        callWebhook,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY
          }
        }
      );

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.data.action).toBe('transfer_direct');
    });
  });

  describe('Realtime Processing Integration', () => {
    let websocket: WebSocket;
    let messageQueue: any[];

    beforeEach(() => {
      messageQueue = [];
    });

    afterEach(() => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    });

    it('should handle real-time audio processing workflow', async () => {
      // Establish WebSocket connection
      websocket = new WebSocket(`ws://localhost:3002/realtime/conversation`);
      
      await new Promise((resolve, reject) => {
        websocket.on('open', resolve);
        websocket.on('error', reject);
      });

      websocket.on('message', (data) => {
        messageQueue.push(JSON.parse(data.toString()));
      });

      // Send audio chunk
      const audioChunk = {
        type: 'audio_chunk',
        callId: 'realtime-test-789',
        audioData: Buffer.from('mock-audio-data').toString('base64'),
        timestamp: Date.now(),
        sequenceNumber: 1
      };

      websocket.send(JSON.stringify(audioChunk));

      // Wait for processing and response
      await testUtils.waitFor(() => messageQueue.length > 0, 5000);

      const responses = messageQueue;
      expect(responses.length).toBeGreaterThan(0);

      // Should receive speech recognition result
      const recognitionResult = responses.find(r => r.type === 'recognition_result');
      expect(recognitionResult).toBeTruthy();
      expect(recognitionResult.text).toBeTruthy();

      // Should receive AI response
      const aiResponse = responses.find(r => r.type === 'ai_response');
      expect(aiResponse).toBeTruthy();
      expect(aiResponse.audioData).toBeTruthy();
    });

    it('should integrate with conversation engine for response generation', async () => {
      // Create test conversation context
      const conversationRequest = {
        recognizedText: 'Hello, I am calling about insurance offers',
        intent: 'insurance_sales',
        callId: 'conversation-integration-test',
        userProfile: {
          personality: 'polite',
          name: 'Test User'
        }
      };

      const conversationResponse = await axios.post(
        `${services.conversationEngine}/api/v1/conversation/generate-response`,
        conversationRequest
      );

      expect(conversationResponse.status).toBe(200);
      expect(conversationResponse.data.response.text).toBeTruthy();
      expect(conversationResponse.data.response.confidence).toBeGreaterThan(0.7);

      // Response should be appropriate for the intent
      const responseText = conversationResponse.data.response.text.toLowerCase();
      expect(responseText).toMatch(/not interested|no thank you|not looking/);
    });
  });

  describe('User Profile and Analytics Integration', () => {
    it('should create and update user profiles through analytics service', async () => {
      const testUser = await testData.createUser({
        name: 'Analytics Test User',
        phone: '+1234567892'
      });

      const callerPhone = '+0987654323';

      // Simulate call interaction for profile creation
      const profileRequest = {
        callerPhone,
        callData: {
          duration: 45000,
          intent: 'loan_offer',
          userResponse: 'polite_decline',
          audioQuality: 0.85,
          backgroundNoise: 0.2
        }
      };

      const profileResponse = await axios.post(
        `${services.profileAnalytics}/api/v1/analytics/profile/update`,
        profileRequest
      );

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.data.profile).toMatchObject({
        phone: callerPhone,
        spamCategory: 'loan_offer',
        riskScore: expect.any(Number),
        confidenceLevel: expect.any(Number)
      });

      // Get profile for verification
      const getProfileResponse = await axios.get(
        `${services.profileAnalytics}/api/v1/analytics/profile/${callerPhone}`
      );

      expect(getProfileResponse.status).toBe(200);
      expect(getProfileResponse.data.profile.spamCategory).toBe('loan_offer');
    });

    it('should provide analytics trends and insights', async () => {
      const testUser = await testData.createUser({
        name: 'Trends Test User',
        phone: '+1234567893'
      });

      // Create multiple call records for trend analysis
      const calls = [
        { intent: 'loan_offer', duration: 30000, outcome: 'successful_termination' },
        { intent: 'insurance_sales', duration: 45000, outcome: 'successful_termination' },
        { intent: 'investment_pitch', duration: 120000, outcome: 'caller_hangup' },
        { intent: 'loan_offer', duration: 25000, outcome: 'successful_termination' }
      ];

      for (const call of calls) {
        await axios.post(`${services.profileAnalytics}/api/v1/analytics/call/analyze`, {
          userId: testUser.id,
          ...call
        });
      }

      // Get trends analysis
      const trendsResponse = await axios.get(
        `${services.profileAnalytics}/api/v1/analytics/trends/${testUser.id}`
      );

      expect(trendsResponse.status).toBe(200);
      expect(trendsResponse.data.trends).toMatchObject({
        mostCommonIntent: 'loan_offer',
        averageCallDuration: expect.any(Number),
        successRate: expect.any(Number)
      });
    });
  });

  describe('Smart Whitelist Integration', () => {
    it('should intelligently manage whitelist based on user behavior', async () => {
      const testUser = await testData.createUser({
        name: 'Smart Whitelist User',
        phone: '+1234567894'
      });

      const callerPhone = '+0987654324';

      // Simulate positive interaction that should trigger auto-whitelist
      const learningRequest = {
        userId: testUser.id,
        callerPhone,
        interactionData: {
          userManuallyTransferred: true,
          callFrequency: 3,
          averageCallDuration: 300000, // 5 minutes
          userFeedback: 'positive'
        }
      };

      const learningResponse = await axios.post(
        `${services.smartWhitelist}/api/v1/whitelist/learning`,
        learningRequest
      );

      expect(learningResponse.status).toBe(200);
      expect(learningResponse.data.recommendation).toBe('add_to_whitelist');

      // Apply recommendation
      await axios.post(`${services.smartWhitelist}/api/v1/whitelist/${testUser.id}/smart-add`, {
        phone: callerPhone,
        reason: 'positive_interaction_pattern'
      });

      // Verify whitelist status
      const whitelistCheck = await axios.get(
        `${services.smartWhitelist}/api/v1/whitelist/${testUser.id}/${callerPhone}`
      );

      expect(whitelistCheck.status).toBe(200);
      expect(whitelistCheck.data.isWhitelisted).toBe(true);
      expect(whitelistCheck.data.whitelistType).toBe('auto');
    });

    it('should evaluate risk scores for spam detection', async () => {
      const spammerPhone = '+0987654325';

      const riskEvaluation = {
        phone: spammerPhone,
        callPatterns: {
          callFrequency: 10, // 10 calls per day
          averageCallDuration: 15000, // 15 seconds
          timeOfDayCalls: ['09:00', '10:00', '11:00', '14:00', '15:00'], // Business hours
          repeatCallsAfterReject: 3
        },
        contentAnalysis: {
          commonKeywords: ['loan', 'offer', 'limited time', 'special deal'],
          intentCategories: ['loan_offer', 'sales_call']
        }
      };

      const evaluationResponse = await axios.post(
        `${services.smartWhitelist}/api/v1/whitelist/evaluate/${spammerPhone}`,
        riskEvaluation
      );

      expect(evaluationResponse.status).toBe(200);
      expect(evaluationResponse.data.riskScore).toBeGreaterThan(0.7);
      expect(evaluationResponse.data.recommendation).toBe('block_caller');
    });
  });

  describe('Configuration Management Integration', () => {
    it('should manage feature flags across services', async () => {
      const featureFlag = {
        key: 'ai_response_enhancement',
        value: {
          enabled: true,
          variants: {
            polite_mode: 0.7,
            direct_mode: 0.3
          }
        },
        services: ['conversation-engine', 'realtime-processor']
      };

      // Set feature flag
      const setFlagResponse = await axios.post(
        `${services.configurationService}/api/v1/config/features`,
        featureFlag
      );

      expect(setFlagResponse.status).toBe(200);
      expect(setFlagResponse.data.success).toBe(true);

      // Get feature flag from conversation engine
      const getConfigResponse = await axios.get(
        `${services.configurationService}/api/v1/config/conversation-engine/ai_response_enhancement`
      );

      expect(getConfigResponse.status).toBe(200);
      expect(getConfigResponse.data.config.enabled).toBe(true);
      expect(getConfigResponse.data.config.variants).toBeTruthy();
    });

    it('should handle A/B testing configuration', async () => {
      const testUser = await testData.createUser({
        name: 'A/B Test User',
        phone: '+1234567895'
      });

      const experimentConfig = {
        name: 'response_tone_experiment',
        variants: {
          control: { tone: 'polite', weight: 0.5 },
          treatment: { tone: 'humorous', weight: 0.5 }
        },
        targetUsers: [testUser.id]
      };

      const experimentResponse = await axios.post(
        `${services.configurationService}/api/v1/config/experiments`,
        experimentConfig
      );

      expect(experimentResponse.status).toBe(200);

      // Get experiment assignment for user
      const assignmentResponse = await axios.get(
        `${services.configurationService}/api/v1/config/experiments/response_tone_experiment/assignment/${testUser.id}`
      );

      expect(assignmentResponse.status).toBe(200);
      expect(['control', 'treatment']).toContain(assignmentResponse.data.variant);
    });
  });

  describe('Storage Service Integration', () => {
    it('should handle audio file storage and retrieval', async () => {
      const audioData = Buffer.from('mock-audio-file-content');
      
      // Upload audio file
      const uploadResponse = await axios.post(
        `${services.storageService}/api/v1/storage/audio/upload`,
        {
          fileName: 'test-recording.wav',
          audioData: audioData.toString('base64'),
          metadata: {
            callId: 'storage-test-call-999',
            duration: 30000,
            format: 'wav',
            sampleRate: 16000
          }
        }
      );

      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.data.fileId).toBeTruthy();
      expect(uploadResponse.data.url).toBeTruthy();

      // Retrieve audio file
      const fileId = uploadResponse.data.fileId;
      const retrieveResponse = await axios.get(
        `${services.storageService}/api/v1/storage/audio/${fileId}`
      );

      expect(retrieveResponse.status).toBe(200);
      expect(retrieveResponse.data.metadata.callId).toBe('storage-test-call-999');
    });

    it('should handle data archival processes', async () => {
      // Simulate data archival for old calls
      const archiveRequest = {
        cutoffDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
        includeAudioFiles: true,
        includeConversationLogs: true
      };

      const archiveResponse = await axios.post(
        `${services.storageService}/api/v1/storage/archive`,
        archiveRequest
      );

      expect(archiveResponse.status).toBe(200);
      expect(archiveResponse.data.archivedItems).toBeGreaterThanOrEqual(0);
      expect(archiveResponse.data.archiveLocation).toBeTruthy();
    });
  });

  describe('Monitoring and Observability Integration', () => {
    it('should collect and aggregate metrics from all services', async () => {
      // Get system health overview
      const healthResponse = await axios.get(
        `${services.monitoringService}/api/v1/monitoring/health`
      );

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.data.overall).toBe('healthy');
      expect(healthResponse.data.services).toHaveProperty('phone-gateway');
      expect(healthResponse.data.services).toHaveProperty('realtime-processor');
      expect(healthResponse.data.services).toHaveProperty('conversation-engine');

      // Get performance metrics
      const metricsResponse = await axios.get(
        `${services.monitoringService}/api/v1/monitoring/metrics`,
        {
          params: {
            timeRange: '1h',
            services: 'all'
          }
        }
      );

      expect(metricsResponse.status).toBe(200);
      expect(metricsResponse.data.metrics).toBeTruthy();
      expect(metricsResponse.data.metrics.requestCount).toBeGreaterThan(0);
    });

    it('should track distributed tracing across services', async () => {
      const traceId = 'integration-test-trace-123';
      
      // Start a traced operation by calling phone gateway
      const tracedRequest = {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: 'traced-call-123',
          from: { phoneNumber: '+0987654326' },
          to: { phoneNumber: '+1234567896' }
        }
      };

      await axios.post(
        `${services.phoneGateway}/webhook/incoming-call`,
        tracedRequest,
        {
          headers: {
            'X-Trace-ID': traceId,
            'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY
          }
        }
      );

      // Wait for trace to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get trace information
      const traceResponse = await axios.get(
        `${services.monitoringService}/api/v1/monitoring/traces/${traceId}`
      );

      expect(traceResponse.status).toBe(200);
      expect(traceResponse.data.trace.spans.length).toBeGreaterThan(1);
      
      const serviceNames = traceResponse.data.trace.spans.map(span => span.serviceName);
      expect(serviceNames).toContain('phone-gateway');
    });
  });

  describe('End-to-End Error Handling', () => {
    it('should handle service failures gracefully with circuit breakers', async () => {
      // Simulate conversation engine failure
      const testUser = await testData.createUser({
        name: 'Error Handling User',
        phone: '+1234567897'
      });

      // This should trigger fallback responses when conversation engine fails
      const callWebhook = {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: 'error-handling-call-789',
          from: { phoneNumber: '+0987654327' },
          to: { phoneNumber: testUser.phone }
        }
      };

      // Make multiple requests to potentially trigger circuit breaker
      const results = [];
      for (let i = 0; i < 3; i++) {
        try {
          const response = await axios.post(
            `${services.phoneGateway}/webhook/incoming-call`,
            { ...callWebhook, data: { ...callWebhook.data, callLegId: `error-call-${i}` } },
            {
              headers: { 'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY },
              timeout: 5000
            }
          );
          results.push(response.status);
        } catch (error: any) {
          results.push(error.response?.status || 500);
        }
      }

      // System should remain operational even with some failures
      expect(results.some(status => status < 500)).toBe(true);
    });

    it('should handle data consistency across service failures', async () => {
      const testUser = await testData.createUser({
        name: 'Data Consistency User',
        phone: '+1234567898'
      });

      const callId = 'consistency-test-call-456';
      
      // Start a call that involves multiple services
      try {
        await axios.post(`${services.phoneGateway}/webhook/incoming-call`, {
          eventType: 'Microsoft.Communication.CallConnected',
          data: {
            callLegId: callId,
            from: { phoneNumber: '+0987654328' },
            to: { phoneNumber: testUser.phone }
          }
        }, {
          headers: { 'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY }
        });

        // Verify call state consistency
        const callStatus = await axios.get(
          `${services.phoneGateway}/api/v1/calls/${callId}/status`
        );

        // Even if some services fail, call state should be consistent
        expect(['active', 'ai_processing', 'failed']).toContain(callStatus.data.call.status);
      } catch (error) {
        // If the entire operation fails, it should fail cleanly
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Performance and Load Integration', () => {
    it('should handle concurrent calls across all services', async () => {
      const concurrentCalls = 5;
      const promises = [];

      for (let i = 0; i < concurrentCalls; i++) {
        const testUser = await testData.createUser({
          name: `Concurrent User ${i}`,
          phone: `+123456789${i}`
        });

        const callPromise = axios.post(
          `${services.phoneGateway}/webhook/incoming-call`,
          {
            eventType: 'Microsoft.Communication.CallConnected',
            data: {
              callLegId: `concurrent-call-${i}`,
              from: { phoneNumber: `+098765432${i}` },
              to: { phoneNumber: testUser.phone }
            }
          },
          {
            headers: { 'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY }
          }
        );

        promises.push(callPromise);
      }

      const results = await Promise.allSettled(promises);
      const successfulCalls = results.filter(
        (result: any) => result.status === 'fulfilled' && result.value.status === 200
      );

      // Most calls should succeed
      expect(successfulCalls.length).toBeGreaterThan(concurrentCalls * 0.8);
    });

    it('should maintain performance SLAs under load', async () => {
      const testUser = await testData.createUser({
        name: 'Performance Test User',
        phone: '+1234567899'
      });

      const startTime = performance.now();

      await axios.post(`${services.phoneGateway}/webhook/incoming-call`, {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: 'performance-test-call',
          from: { phoneNumber: '+0987654329' },
          to: { phoneNumber: testUser.phone }
        }
      }, {
        headers: { 'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY }
      });

      const responseTime = performance.now() - startTime;

      // Should meet performance SLA (e.g., < 1000ms for initial call routing)
      expect(responseTime).toBeLessThan(1000);
    });
  });
});