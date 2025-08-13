/**
 * Unit Tests for Phone Gateway Service
 * 
 * Tests core functionality including call routing, Azure integration,
 * and error handling with comprehensive mocking.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { AzureServicesMockFactory } from '../../mocks/azure-services.mock';

// Mock the Phone Gateway Service
jest.mock('../../../services/phone-gateway/src/services/AzureCommunicationService');

describe('Phone Gateway Service', () => {
  let app: any;
  let mockAzureComm: any;
  
  beforeEach(async () => {
    // Setup mocks
    mockAzureComm = AzureServicesMockFactory.getCommunicationService();
    
    // Reset all mocks
    jest.clearAllMocks();
    AzureServicesMockFactory.resetAll();
    
    // Import app after mocks are set up
    const phoneGatewayModule = await import('../../../services/phone-gateway/src/server');
    app = phoneGatewayModule.default || phoneGatewayModule.app;
  });
  
  afterEach(() => {
    AzureServicesMockFactory.clearAll();
  });
  
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toBeHealthy();
      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'phone-gateway',
        timestamp: expect.any(String)
      });
    });
    
    it('should include service dependencies in health check', async () => {
      const response = await request(app)
        .get('/health/detailed')
        .expect(200);
      
      expect(response.body.dependencies).toContainEqual(
        expect.objectContaining({
          name: 'azure-communication-service',
          status: 'healthy'
        })
      );
    });
  });
  
  describe('Incoming Call Webhook', () => {
    const mockIncomingCallPayload = {
      eventType: 'Microsoft.Communication.CallConnected',
      data: {
        callLegId: 'test-call-123',
        from: {
          phoneNumber: '+1234567890'
        },
        to: {
          phoneNumber: '+0987654321'
        },
        callConnectionId: 'test-connection-123'
      }
    };
    
    it('should handle incoming call webhook successfully', async () => {
      mockAzureComm.answerCall = jest.fn().mockResolvedValue({ 
        success: true, 
        call: { id: 'test-call-123', status: 'connected' } 
      });
      
      const response = await request(app)
        .post('/webhook/incoming-call')
        .send(mockIncomingCallPayload)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(mockAzureComm.answerCall).toHaveBeenCalledWith(\n        'test-call-123',\n        expect.stringContaining('/webhook/callback')\n      );\n    });\n    \n    it('should perform whitelist check before processing call', async () => {\n      const mockWhitelistCheck = jest.fn().mockResolvedValue({ isWhitelisted: false });\n      \n      // Mock the whitelist service\n      jest.doMock('../../../services/phone-gateway/src/services/WhitelistService', () => ({\n        checkWhitelist: mockWhitelistCheck\n      }));\n      \n      await request(app)\n        .post('/webhook/incoming-call')\n        .send(mockIncomingCallPayload)\n        .expect(200);\n      \n      expect(mockWhitelistCheck).toHaveBeenCalledWith({\n        callerPhone: '+1234567890',\n        userPhone: '+0987654321'\n      });\n    });\n    \n    it('should route to AI processor for non-whitelisted calls', async () => {\n      const mockAIProcessor = jest.fn().mockResolvedValue({ success: true });\n      \n      jest.doMock('../../../services/phone-gateway/src/services/AIProcessorService', () => ({\n        startAIConversation: mockAIProcessor\n      }));\n      \n      await request(app)\n        .post('/webhook/incoming-call')\n        .send(mockIncomingCallPayload)\n        .expect(200);\n      \n      expect(mockAIProcessor).toHaveBeenCalledWith({\n        callId: 'test-call-123',\n        callerPhone: '+1234567890',\n        userPhone: '+0987654321'\n      });\n    });\n    \n    it('should transfer whitelisted calls directly', async () => {\n      const mockWhitelistCheck = jest.fn().mockResolvedValue({ isWhitelisted: true });\n      mockAzureComm.transferCall = jest.fn().mockResolvedValue({ success: true });\n      \n      jest.doMock('../../../services/phone-gateway/src/services/WhitelistService', () => ({\n        checkWhitelist: mockWhitelistCheck\n      }));\n      \n      await request(app)\n        .post('/webhook/incoming-call')\n        .send(mockIncomingCallPayload)\n        .expect(200);\n      \n      expect(mockAzureComm.transferCall).toHaveBeenCalledWith(\n        'test-call-123',\n        '+0987654321' // User's real phone\n      );\n    });\n  });\n  \n  describe('Call Management', () => {\n    it('should answer call successfully', async () => {\n      const callId = 'test-call-456';\n      \n      mockAzureComm.answerCall = jest.fn().mockResolvedValue({\n        success: true,\n        call: { id: callId, status: 'connected' }\n      });\n      \n      const response = await request(app)\n        .post(`/calls/${callId}/answer`)\n        .send({ callbackUri: 'https://example.com/callback' })\n        .expect(200);\n      \n      expect(response.body.success).toBe(true);\n      expect(mockAzureComm.answerCall).toHaveBeenCalledWith(\n        callId,\n        'https://example.com/callback'\n      );\n    });\n    \n    it('should handle call answer failure', async () => {\n      const callId = 'test-call-fail';\n      \n      mockAzureComm.answerCall = jest.fn().mockRejectedValue(\n        new Error('Azure service unavailable')\n      );\n      \n      const response = await request(app)\n        .post(`/calls/${callId}/answer`)\n        .send({ callbackUri: 'https://example.com/callback' })\n        .expect(500);\n      \n      expect(response.body.error).toContain('Azure service unavailable');\n    });\n    \n    it('should hangup call successfully', async () => {\n      const callId = 'test-call-789';\n      \n      mockAzureComm.hangupCall = jest.fn().mockResolvedValue({ success: true });\n      \n      const response = await request(app)\n        .post(`/calls/${callId}/hangup`)\n        .expect(200);\n      \n      expect(response.body.success).toBe(true);\n      expect(mockAzureComm.hangupCall).toHaveBeenCalledWith(callId);\n    });\n    \n    it('should get call status', async () => {\n      const callId = 'test-call-status';\n      \n      mockAzureComm.getCall = jest.fn().mockReturnValue({\n        id: callId,\n        status: 'connected',\n        startTime: '2023-12-01T10:00:00Z',\n        participants: ['caller', 'ai-assistant']\n      });\n      \n      const response = await request(app)\n        .get(`/calls/${callId}/status`)\n        .expect(200);\n      \n      expect(response.body.call).toMatchObject({\n        id: callId,\n        status: 'connected'\n      });\n    });\n  });\n  \n  describe('Performance Tests', () => {\n    it('should process incoming call within performance threshold', async () => {\n      mockAzureComm.answerCall = jest.fn().mockResolvedValue({ \n        success: true, \n        call: { id: 'perf-test', status: 'connected' } \n      });\n      \n      const callProcessing = request(app)\n        .post('/webhook/incoming-call')\n        .send({\n          eventType: 'Microsoft.Communication.CallConnected',\n          data: {\n            callLegId: 'perf-test',\n            from: { phoneNumber: '+1111111111' },\n            to: { phoneNumber: '+2222222222' },\n            callConnectionId: 'perf-connection'\n          }\n        });\n      \n      await expect(callProcessing).toCompleteWithinMs(1000);\n    });\n    \n    it('should handle high concurrency of incoming calls', async () => {\n      const callCount = 10;\n      const promises = [];\n      \n      mockAzureComm.answerCall = jest.fn().mockResolvedValue({\n        success: true,\n        call: { status: 'connected' }\n      });\n      \n      for (let i = 0; i < callCount; i++) {\n        const promise = request(app)\n          .post('/webhook/incoming-call')\n          .send({\n            eventType: 'Microsoft.Communication.CallConnected',\n            data: {\n              callLegId: `concurrent-call-${i}`,\n              from: { phoneNumber: `+111111111${i}` },\n              to: { phoneNumber: '+2222222222' },\n              callConnectionId: `concurrent-conn-${i}`\n            }\n          });\n        \n        promises.push(promise);\n      }\n      \n      const responses = await Promise.all(promises);\n      \n      responses.forEach(response => {\n        expect(response.status).toBe(200);\n        expect(response.body.success).toBe(true);\n      });\n      \n      expect(mockAzureComm.answerCall).toHaveBeenCalledTimes(callCount);\n    });\n  });\n  \n  describe('Error Handling', () => {\n    it('should handle malformed webhook payload', async () => {\n      const response = await request(app)\n        .post('/webhook/incoming-call')\n        .send({ invalid: 'payload' })\n        .expect(400);\n      \n      expect(response.body.error).toContain('Invalid payload');\n    });\n    \n    it('should handle Azure service timeout', async () => {\n      mockAzureComm.answerCall = jest.fn().mockImplementation(() => {\n        return new Promise((_, reject) => {\n          setTimeout(() => reject(new Error('Request timeout')), 5000);\n        });\n      });\n      \n      const response = await request(app)\n        .post('/webhook/incoming-call')\n        .send({\n          eventType: 'Microsoft.Communication.CallConnected',\n          data: {\n            callLegId: 'timeout-test',\n            from: { phoneNumber: '+1111111111' },\n            to: { phoneNumber: '+2222222222' },\n            callConnectionId: 'timeout-conn'\n          }\n        })\n        .expect(500);\n      \n      expect(response.body.error).toContain('Request timeout');\n    });\n    \n    it('should implement circuit breaker for Azure services', async () => {\n      // Simulate multiple failures to trigger circuit breaker\n      mockAzureComm.answerCall = jest.fn().mockRejectedValue(\n        new Error('Service unavailable')\n      );\n      \n      const failureCount = 5;\n      const promises = [];\n      \n      for (let i = 0; i < failureCount; i++) {\n        const promise = request(app)\n          .post('/webhook/incoming-call')\n          .send({\n            eventType: 'Microsoft.Communication.CallConnected',\n            data: {\n              callLegId: `circuit-test-${i}`,\n              from: { phoneNumber: `+111111111${i}` },\n              to: { phoneNumber: '+2222222222' },\n              callConnectionId: `circuit-conn-${i}`\n            }\n          });\n        \n        promises.push(promise);\n      }\n      \n      const responses = await Promise.all(promises);\n      \n      // All should fail initially\n      responses.forEach(response => {\n        expect(response.status).toBe(500);\n      });\n      \n      // Circuit breaker should be open, subsequent calls should fail fast\n      const circuitBreakerResponse = await request(app)\n        .post('/webhook/incoming-call')\n        .send({\n          eventType: 'Microsoft.Communication.CallConnected',\n          data: {\n            callLegId: 'circuit-test-fast-fail',\n            from: { phoneNumber: '+9999999999' },\n            to: { phoneNumber: '+2222222222' },\n            callConnectionId: 'circuit-conn-fast-fail'\n          }\n        });\n      \n      expect(circuitBreakerResponse.status).toBe(503);\n      expect(circuitBreakerResponse.body.error).toContain('Circuit breaker open');\n    });\n  });\n  \n  describe('Security Tests', () => {\n    it('should validate webhook signature', async () => {\n      const response = await request(app)\n        .post('/webhook/incoming-call')\n        .set('X-Signature', 'invalid-signature')\n        .send({\n          eventType: 'Microsoft.Communication.CallConnected',\n          data: { callLegId: 'security-test' }\n        })\n        .expect(401);\n      \n      expect(response.body.error).toContain('Invalid signature');\n    });\n    \n    it('should implement rate limiting', async () => {\n      const requests = [];\n      \n      // Send more requests than rate limit allows\n      for (let i = 0; i < 20; i++) {\n        const request = request(app)\n          .post('/webhook/incoming-call')\n          .send({\n            eventType: 'Microsoft.Communication.CallConnected',\n            data: {\n              callLegId: `rate-limit-test-${i}`,\n              from: { phoneNumber: '+1111111111' },\n              to: { phoneNumber: '+2222222222' },\n              callConnectionId: `rate-limit-conn-${i}`\n            }\n          });\n        \n        requests.push(request);\n      }\n      \n      const responses = await Promise.allSettled(\n        requests.map(req => req.catch(err => err.response))\n      );\n      \n      // Some requests should be rate limited\n      const rateLimitedResponses = responses.filter(\n        (response: any) => response.value?.status === 429\n      );\n      \n      expect(rateLimitedResponses.length).toBeGreaterThan(0);\n    });\n  });\n});\n\n// Performance benchmark tests\ndescribe('Phone Gateway Performance Benchmarks', () => {\n  let app: any;\n  let mockAzureComm: any;\n  \n  beforeEach(async () => {\n    mockAzureComm = AzureServicesMockFactory.getCommunicationService();\n    \n    const phoneGatewayModule = await import('../../../services/phone-gateway/src/server');\n    app = phoneGatewayModule.default || phoneGatewayModule.app;\n  });\n  \n  it('should meet response time SLA for call routing', async () => {\n    const slaThreshold = 500; // 500ms SLA\n    const testRuns = 10;\n    const responseTimes = [];\n    \n    mockAzureComm.answerCall = jest.fn().mockResolvedValue({\n      success: true,\n      call: { status: 'connected' }\n    });\n    \n    for (let i = 0; i < testRuns; i++) {\n      const startTime = performance.now();\n      \n      await request(app)\n        .post('/webhook/incoming-call')\n        .send({\n          eventType: 'Microsoft.Communication.CallConnected',\n          data: {\n            callLegId: `benchmark-${i}`,\n            from: { phoneNumber: '+1111111111' },\n            to: { phoneNumber: '+2222222222' },\n            callConnectionId: `benchmark-conn-${i}`\n          }\n        })\n        .expect(200);\n      \n      const responseTime = performance.now() - startTime;\n      responseTimes.push(responseTime);\n    }\n    \n    const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / testRuns;\n    const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(testRuns * 0.95)];\n    \n    console.log(`Average response time: ${averageResponseTime.toFixed(2)}ms`);\n    console.log(`P95 response time: ${p95ResponseTime.toFixed(2)}ms`);\n    \n    expect(p95ResponseTime).toBeLessThan(slaThreshold);\n  });\n});\n\n// Memory leak detection tests\ndescribe('Phone Gateway Memory Management', () => {\n  it('should not have memory leaks during sustained operation', async () => {\n    const initialMemory = process.memoryUsage();\n    const iterations = 100;\n    \n    const mockAzureComm = AzureServicesMockFactory.getCommunicationService();\n    mockAzureComm.answerCall = jest.fn().mockResolvedValue({\n      success: true,\n      call: { status: 'connected' }\n    });\n    \n    const phoneGatewayModule = await import('../../../services/phone-gateway/src/server');\n    const app = phoneGatewayModule.default || phoneGatewayModule.app;\n    \n    // Simulate sustained operation\n    for (let i = 0; i < iterations; i++) {\n      await request(app)\n        .post('/webhook/incoming-call')\n        .send({\n          eventType: 'Microsoft.Communication.CallConnected',\n          data: {\n            callLegId: `memory-test-${i}`,\n            from: { phoneNumber: '+1111111111' },\n            to: { phoneNumber: '+2222222222' },\n            callConnectionId: `memory-conn-${i}`\n          }\n        });\n      \n      // Trigger garbage collection every 10 iterations\n      if (i % 10 === 0 && global.gc) {\n        global.gc();\n      }\n    }\n    \n    const finalMemory = process.memoryUsage();\n    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;\n    const memoryIncreasePercentage = (memoryIncrease / initialMemory.heapUsed) * 100;\n    \n    console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB (${memoryIncreasePercentage.toFixed(2)}%)`);\n    \n    // Memory increase should be reasonable\n    expect(memoryIncreasePercentage).toBeLessThan(50);\n  });\n});\n"}