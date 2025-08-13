/**
 * Comprehensive Jest Setup for AI Answer Ninja Test Suite
 * 
 * This file configures global test utilities, mocks, and extensions
 * for the entire test suite across unit, integration, and E2E tests.
 */

import { config } from 'dotenv';
import { performance } from 'perf_hooks';

// Load environment variables for testing
config({ path: '.env.test' });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.TEST_MODE = 'true';
process.env.REDIS_URL = 'redis://localhost:6380';
process.env.DATABASE_URL = 'postgresql://test_user:test_password@localhost:5433/ai_ninja_test';

// Global test timeout
jest.setTimeout(30000);

// Mock external services globally
jest.mock('axios');
jest.mock('ws');
jest.mock('ioredis');
jest.mock('pg');

// Azure services mocks
jest.mock('@azure/communication-call-automation');
jest.mock('@azure/communication-common');
jest.mock('@azure/storage-blob');
jest.mock('microsoft-cognitiveservices-speech-sdk');

// Performance tracking
const testStartTimes = new Map<string, number>();
const testMetrics = {
  tests: [] as Array<{
    name: string;
    duration: number;
    status: 'passed' | 'failed';
    memoryUsage: number;
  }>
};

// Custom Jest matchers for AI-specific testing
expect.extend({
  // Performance assertion matcher
  toCompleteWithinMs(received: Promise<any>, expectedMs: number) {
    const start = performance.now();
    
    return received
      .then(() => {
        const duration = performance.now() - start;
        const pass = duration <= expectedMs;
        
        return {
          pass,
          message: () =>
            pass
              ? `Expected operation to take longer than ${expectedMs}ms, but completed in ${duration.toFixed(2)}ms`
              : `Expected operation to complete within ${expectedMs}ms, but took ${duration.toFixed(2)}ms`,
        };
      })
      .catch((error) => {
        return {
          pass: false,
          message: () => `Operation failed with error: ${error.message}`,
        };
      });
  },
  
  // Audio quality assertion matcher
  toHaveAudioQuality(received: any, expectedQuality: number) {
    const quality = received.audioQuality || 0;
    const pass = quality >= expectedQuality;
    
    return {
      pass,
      message: () =>
        pass
          ? `Expected audio quality to be less than ${expectedQuality}, but was ${quality}`
          : `Expected audio quality to be at least ${expectedQuality}, but was ${quality}`,
    };
  },
  
  // Intent recognition accuracy matcher
  toRecognizeIntentWithConfidence(received: any, expectedIntent: string, minConfidence: number) {
    const intent = received.intent;
    const confidence = received.confidence || 0;
    
    const intentMatch = intent === expectedIntent;
    const confidencePass = confidence >= minConfidence;
    const pass = intentMatch && confidencePass;
    
    return {
      pass,
      message: () => {
        if (!intentMatch) {
          return `Expected intent '${expectedIntent}', but got '${intent}'`;
        }
        if (!confidencePass) {
          return `Expected confidence >= ${minConfidence}, but got ${confidence}`;
        }
        return `Intent recognition passed: '${intent}' with confidence ${confidence}`;
      },
    };
  },
  
  // Service health matcher
  toBeHealthy(received: any) {
    const status = received.status || 'unknown';
    const pass = status === 'healthy' || status === 'ok';
    
    return {
      pass,
      message: () =>
        pass
          ? `Expected service to be unhealthy, but status was '${status}'`
          : `Expected service to be healthy, but status was '${status}'`,
    };
  }
});

// Global test setup
beforeAll(async () => {
  console.log('🧪 Starting AI Answer Ninja test suite');
  
  // Setup global test state
  (global as any).testStartTime = Date.now();
});

beforeEach(() => {
  // Clear all mocks between tests
  jest.clearAllMocks();
  
  // Track test start time
  const testName = expect.getState().currentTestName || 'unknown';
  testStartTimes.set(testName, performance.now());
});

afterEach(() => {
  // Record test metrics
  const testName = expect.getState().currentTestName || 'unknown';
  const startTime = testStartTimes.get(testName);
  
  if (startTime) {
    const duration = performance.now() - startTime;
    const memoryUsage = process.memoryUsage().heapUsed;
    
    testMetrics.tests.push({
      name: testName,
      duration,
      status: 'passed', // Will be updated if test fails
      memoryUsage
    });
    
    testStartTimes.delete(testName);
  }
});

afterAll(async () => {
  // Generate test metrics report
  const totalDuration = Date.now() - (global as any).testStartTime;
  const avgDuration = testMetrics.tests.reduce((sum, test) => sum + test.duration, 0) / testMetrics.tests.length;
  const maxMemory = Math.max(...testMetrics.tests.map(test => test.memoryUsage));
  
  console.log(`
📊 Test Suite Metrics:
   Total Duration: ${totalDuration}ms
   Average Test Duration: ${avgDuration.toFixed(2)}ms
   Peak Memory Usage: ${(maxMemory / 1024 / 1024).toFixed(2)}MB
   Total Tests: ${testMetrics.tests.length}
  `);
  
  console.log('✅ AI Answer Ninja test suite completed');
});

// Global test utilities
(global as any).testUtils = {
  // Utility for creating test data
  createTestUser: (overrides: any = {}) => ({
    id: 'test-user-123',
    name: 'Test User',
    phone: '+1234567890',
    personality: 'polite',
    ...overrides
  }),
  
  createTestCall: (overrides: any = {}) => ({
    id: 'test-call-456',
    userId: 'test-user-123',
    callerPhone: '+0987654321',
    status: 'active',
    startTime: new Date().toISOString(),
    ...overrides
  }),
  
  createTestConversation: (overrides: any = {}) => ({
    id: 'test-conv-789',
    callId: 'test-call-456',
    intent: 'sales_call',
    confidence: 0.85,
    audioQuality: 0.9,
    ...overrides
  }),
  
  // Utility for waiting with timeout
  waitFor: async (condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<boolean> => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await condition();
        if (result) return true;
      } catch (error) {
        // Continue checking
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }
};

// TypeScript declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toCompleteWithinMs(expectedMs: number): Promise<R>;
      toHaveAudioQuality(expectedQuality: number): R;
      toRecognizeIntentWithConfidence(expectedIntent: string, minConfidence: number): R;
      toBeHealthy(): R;
    }
  }
}

export {};