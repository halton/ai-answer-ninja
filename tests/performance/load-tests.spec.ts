/**
 * Performance and Load Testing Suite
 * 
 * Tests system performance under various load conditions:
 * - Concurrent call handling
 * - API response times under load  
 * - Memory usage patterns
 * - Database performance under load
 * - WebSocket connection limits
 * - Cache effectiveness under pressure
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { TestContainerManager } from '../utils/test-container-manager';
import { TestDataFactory } from '../utils/test-data-factory';
import { TestApiClient, ServiceEndpoints } from '../e2e/src/utils/TestApiClient';
import WebSocket from 'ws';
import axios from 'axios';

interface PerformanceMetrics {
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  throughput: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
  activeConnections: number;
}

interface LoadTestConfig {
  virtualUsers: number;
  duration: number; // seconds
  rampUpTime: number; // seconds
  scenarios: LoadTestScenario[];
}

interface LoadTestScenario {
  name: string;
  weight: number; // percentage
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  payload?: any;
  expectedStatus: number;
  expectedMaxResponseTime: number;
}

describe('Performance and Load Tests', () => {
  let containerManager: TestContainerManager;
  let testData: TestDataFactory;
  let apiClient: TestApiClient;

  const services: ServiceEndpoints = {
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
    apiClient = new TestApiClient(services, {
      timeout: 10000,
      retries: { max: 1, delay: 100, factor: 1 },
      metrics: { enabled: true, collectTimings: true, collectPayloadSizes: true }
    });

    await containerManager.startAll();
    await apiClient.waitForServicesHealthy(120000);
    
    console.log('🏋️ Performance test environment ready');
  }, 180000);

  afterAll(async () => {
    await containerManager.stopAll();
  });

  beforeEach(async () => {
    await testData.reset();
    apiClient.resetMetrics();
  });

  describe('API Endpoint Performance Tests', () => {
    it('should handle high load on phone gateway webhook endpoint', async () => {
      const concurrentRequests = 50;
      const testDuration = 30000; // 30 seconds

      // Create test users for load testing
      const testUsers = await Promise.all(
        Array.from({ length: 10 }, (_, i) => 
          testData.createUser({
            name: `Load Test User ${i + 1}`,
            phone: `+155500${String(i).padStart(4, '0')}`
          })
        )
      );

      console.log(`🚀 Starting load test: ${concurrentRequests} concurrent requests for ${testDuration}ms`);

      const startTime = Date.now();
      const results: any[] = [];
      const errors: any[] = [];
      
      // Function to simulate incoming call webhook
      const simulateWebhookCall = async (userIndex: number, callIndex: number) => {
        const testUser = testUsers[userIndex % testUsers.length];
        const requestStart = performance.now();

        try {
          const response = await apiClient.post('/phone-gateway/webhook/incoming-call', {
            eventType: 'Microsoft.Communication.CallConnected',
            data: {
              callLegId: `load-test-call-${userIndex}-${callIndex}-${Date.now()}`,
              from: { phoneNumber: `+0987654${String(callIndex).padStart(3, '0')}` },
              to: { phoneNumber: testUser.phone },
              callConnectionId: `load-connection-${userIndex}-${callIndex}`
            }
          });

          const duration = performance.now() - requestStart;
          results.push({
            duration,
            status: response.status,
            userIndex,
            callIndex,
            timestamp: Date.now()
          });

        } catch (error: any) {
          const duration = performance.now() - requestStart;
          errors.push({
            duration,
            error: error.message,
            status: error.response?.status || 0,
            userIndex,
            callIndex,
            timestamp: Date.now()
          });
        }
      };

      // Run concurrent load
      const workers: Promise<void>[] = [];
      let callCounter = 0;

      for (let i = 0; i < concurrentRequests; i++) {
        const worker = async () => {
          while (Date.now() - startTime < testDuration) {
            await simulateWebhookCall(i, callCounter++);
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms between requests per worker
          }
        };
        workers.push(worker());
      }

      await Promise.all(workers);

      // Analyze results
      const totalRequests = results.length + errors.length;
      const successfulRequests = results.length;
      const errorRate = (errors.length / totalRequests) * 100;

      const durations = results.map(r => r.duration);
      const avgResponseTime = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const sortedDurations = durations.sort((a, b) => a - b);
      const p95ResponseTime = sortedDurations[Math.floor(sortedDurations.length * 0.95)];
      const p99ResponseTime = sortedDurations[Math.floor(sortedDurations.length * 0.99)];
      const maxResponseTime = Math.max(...durations);
      const minResponseTime = Math.min(...durations);

      const actualDuration = Date.now() - startTime;
      const throughput = (successfulRequests / actualDuration) * 1000; // requests per second

      const metrics: PerformanceMetrics = {
        averageResponseTime: Math.round(avgResponseTime),
        p95ResponseTime: Math.round(p95ResponseTime),
        p99ResponseTime: Math.round(p99ResponseTime),
        maxResponseTime: Math.round(maxResponseTime),
        minResponseTime: Math.round(minResponseTime),
        throughput: Math.round(throughput * 10) / 10,
        errorRate: Math.round(errorRate * 10) / 10,
        memoryUsage: 0, // Would be collected from monitoring service
        cpuUsage: 0,
        activeConnections: concurrentRequests
      };

      console.log('📊 Load Test Results:', {
        totalRequests,
        successfulRequests,
        errors: errors.length,
        ...metrics
      });

      // Performance assertions
      expect(totalRequests).toBeGreaterThan(50);
      expect(errorRate).toBeLessThan(5); // Less than 5% error rate
      expect(avgResponseTime).toBeLessThan(2000); // Average response time under 2s
      expect(p95ResponseTime).toBeLessThan(3000); // 95th percentile under 3s
      expect(throughput).toBeGreaterThan(1); // At least 1 request per second
    }, 60000);

    it('should maintain performance under sustained realtime processing load', async () => {
      const concurrentConnections = 20;
      const messagesPerConnection = 50;
      const messageInterval = 100; // ms between messages

      console.log(`🎯 Testing WebSocket performance: ${concurrentConnections} connections, ${messagesPerConnection} messages each`);

      const connections: WebSocket[] = [];
      const results: any[] = [];
      const errors: any[] = [];

      // Establish WebSocket connections
      for (let i = 0; i < concurrentConnections; i++) {
        const ws = new WebSocket(`ws://localhost:3002/realtime/conversation?callId=perf-test-${i}`);
        
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'ai_response') {
            const latency = Date.now() - message.originalTimestamp;
            results.push({
              connectionId: i,
              latency,
              messageSize: data.length,
              timestamp: Date.now()
            });
          }
        });

        ws.on('error', (error) => {
          errors.push({
            connectionId: i,
            error: error.message,
            timestamp: Date.now()
          });
        });

        connections.push(ws);
      }

      // Wait for all connections to open
      await Promise.all(connections.map(ws => 
        new Promise((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
        })
      ));

      // Send messages concurrently
      const sendPromises = connections.map(async (ws, connectionId) => {
        for (let msgIndex = 0; msgIndex < messagesPerConnection; msgIndex++) {
          const message = {
            type: 'audio_chunk',
            callId: `perf-test-${connectionId}`,
            audioData: Buffer.from(`performance test audio data ${msgIndex}`).toString('base64'),
            timestamp: Date.now(),
            originalTimestamp: Date.now(),
            sequenceNumber: msgIndex + 1
          };

          ws.send(JSON.stringify(message));
          await new Promise(resolve => setTimeout(resolve, messageInterval));
        }
      });

      await Promise.all(sendPromises);

      // Wait for all responses
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Close connections
      connections.forEach(ws => ws.close());

      // Analyze WebSocket performance
      const totalExpectedMessages = concurrentConnections * messagesPerConnection;
      const totalReceivedResponses = results.length;
      const responseRate = (totalReceivedResponses / totalExpectedMessages) * 100;

      const latencies = results.map(r => r.latency);
      const avgLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      console.log('📊 WebSocket Performance Results:', {
        expectedMessages: totalExpectedMessages,
        receivedResponses: totalReceivedResponses,
        responseRate: Math.round(responseRate * 10) / 10,
        averageLatency: Math.round(avgLatency),
        p95Latency: Math.round(p95Latency),
        maxLatency: Math.round(maxLatency),
        errors: errors.length
      });

      // WebSocket performance assertions
      expect(responseRate).toBeGreaterThan(90); // At least 90% response rate
      expect(avgLatency).toBeLessThan(1000); // Average latency under 1s
      expect(p95Latency).toBeLessThan(1500); // 95th percentile under 1.5s
      expect(errors.length).toBeLessThan(totalExpectedMessages * 0.05); // Less than 5% errors
    }, 90000);
  });

  describe('Database Performance Tests', () => {
    it('should handle high volume user profile queries', async () => {
      const numberOfUsers = 1000;
      const concurrentQueries = 50;
      
      console.log(`📊 Creating ${numberOfUsers} test users for database performance test`);
      
      // Create large dataset
      const users = await testData.createUsersBatch(numberOfUsers);
      
      // Create call records for users to test complex queries
      const callPromises = users.slice(0, 100).map(async user => {
        for (let i = 0; i < 10; i++) {
          await testData.createCallRecord({
            userId: user.id,
            callerPhone: `+098765${String(i).padStart(4, '0')}`,
            callType: 'spam_suspected',
            callStatus: 'completed'
          });
        }
      });
      
      await Promise.all(callPromises);
      
      console.log('🔍 Running concurrent profile analytics queries');
      
      // Test concurrent user profile queries
      const queryPromises: Promise<any>[] = [];
      const queryResults: any[] = [];
      const queryErrors: any[] = [];
      
      for (let i = 0; i < concurrentQueries; i++) {
        const promise = (async () => {
          const randomUser = users[Math.floor(Math.random() * users.length)];
          const startTime = performance.now();
          
          try {
            const response = await apiClient.get(`/profile-analytics/api/v1/analytics/trends/${randomUser.id}`);
            const duration = performance.now() - startTime;
            
            queryResults.push({
              userId: randomUser.id,
              duration,
              dataSize: JSON.stringify(response.data).length,
              status: response.status
            });
          } catch (error: any) {
            const duration = performance.now() - startTime;
            queryErrors.push({
              userId: randomUser.id,
              duration,
              error: error.message,
              status: error.response?.status || 0
            });
          }
        })();
        
        queryPromises.push(promise);
        
        // Stagger requests slightly
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      await Promise.all(queryPromises);
      
      // Analyze database query performance
      const totalQueries = queryResults.length + queryErrors.length;
      const successfulQueries = queryResults.length;
      const dbErrorRate = (queryErrors.length / totalQueries) * 100;
      
      const queryDurations = queryResults.map(r => r.duration);
      const avgQueryTime = queryDurations.reduce((sum, d) => sum + d, 0) / queryDurations.length;
      const maxQueryTime = Math.max(...queryDurations);
      const p95QueryTime = queryDurations.sort((a, b) => a - b)[Math.floor(queryDurations.length * 0.95)];
      
      console.log('📊 Database Performance Results:', {
        totalUsers: numberOfUsers,
        totalQueries,
        successfulQueries,
        errorRate: Math.round(dbErrorRate * 10) / 10,
        averageQueryTime: Math.round(avgQueryTime),
        p95QueryTime: Math.round(p95QueryTime),
        maxQueryTime: Math.round(maxQueryTime)
      });
      
      // Database performance assertions
      expect(dbErrorRate).toBeLessThan(2); // Less than 2% database errors
      expect(avgQueryTime).toBeLessThan(500); // Average query under 500ms
      expect(p95QueryTime).toBeLessThan(1000); // 95th percentile under 1s
      expect(successfulQueries).toBeGreaterThan(concurrentQueries * 0.95); // At least 95% success
    }, 120000);

    it('should maintain cache effectiveness under load', async () => {
      const cacheTestUsers = 50;
      const queriesPerUser = 20;
      
      // Create test users and trigger cache population
      const users = await Promise.all(
        Array.from({ length: cacheTestUsers }, (_, i) =>
          testData.createUser({
            name: `Cache Test User ${i + 1}`,
            phone: `+155501${String(i).padStart(4, '0')}`
          })
        )
      );
      
      console.log('🔥 Testing cache performance with repeated queries');
      
      const cacheResults: any[] = [];
      
      // First round: Populate cache (should be slow)
      console.log('📈 Populating cache with initial queries');
      for (const user of users.slice(0, 10)) {
        const startTime = performance.now();
        await apiClient.get(`/smart-whitelist/api/v1/whitelist/${user.id}`);
        const duration = performance.now() - startTime;
        
        cacheResults.push({
          userId: user.id,
          round: 'cache_miss',
          duration,
          cached: false
        });
      }
      
      // Second round: Cache hits (should be fast)
      console.log('⚡ Testing cache hit performance');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
      
      for (const user of users.slice(0, 10)) {
        const startTime = performance.now();
        await apiClient.get(`/smart-whitelist/api/v1/whitelist/${user.id}`);
        const duration = performance.now() - startTime;
        
        cacheResults.push({
          userId: user.id,
          round: 'cache_hit',
          duration,
          cached: true
        });
      }
      
      // Analyze cache effectiveness
      const cacheMisses = cacheResults.filter(r => r.round === 'cache_miss');
      const cacheHits = cacheResults.filter(r => r.round === 'cache_hit');
      
      const avgCacheMissTime = cacheMisses.reduce((sum, r) => sum + r.duration, 0) / cacheMisses.length;
      const avgCacheHitTime = cacheHits.reduce((sum, r) => sum + r.duration, 0) / cacheHits.length;
      const cacheSpeedup = avgCacheMissTime / avgCacheHitTime;
      
      console.log('📊 Cache Performance Results:', {
        averageCacheMissTime: Math.round(avgCacheMissTime),
        averageCacheHitTime: Math.round(avgCacheHitTime),
        cacheSpeedup: Math.round(cacheSpeedup * 10) / 10,
        improvementPercent: Math.round((1 - (avgCacheHitTime / avgCacheMissTime)) * 100)
      });
      
      // Cache performance assertions
      expect(cacheSpeedup).toBeGreaterThan(2); // Cache should be at least 2x faster
      expect(avgCacheHitTime).toBeLessThan(100); // Cache hits should be very fast
      expect(avgCacheMissTime).toBeGreaterThan(avgCacheHitTime); // Cache misses should be slower
    }, 60000);
  });

  describe('Resource Usage Tests', () => {
    it('should monitor memory usage during extended operations', async () => {
      const testDurationMinutes = 2;
      const testDurationMs = testDurationMinutes * 60 * 1000;
      const sampleInterval = 5000; // Sample every 5 seconds
      
      console.log(`🔍 Monitoring resource usage for ${testDurationMinutes} minutes`);
      
      const resourceSamples: any[] = [];
      const startTime = Date.now();
      
      // Start background load
      const backgroundLoad = async () => {
        while (Date.now() - startTime < testDurationMs) {
          try {
            // Simulate realistic workload
            await Promise.all([
              apiClient.get('/monitoring-service/api/v1/monitoring/health'),
              apiClient.post('/phone-gateway/webhook/incoming-call', {
                eventType: 'Microsoft.Communication.CallConnected',
                data: {
                  callLegId: `memory-test-${Date.now()}`,
                  from: { phoneNumber: '+0123456789' },
                  to: { phoneNumber: '+1234567890' }
                }
              }).catch(() => {}), // Ignore errors for load testing
              new Promise(resolve => setTimeout(resolve, 100))
            ]);
          } catch (error) {
            // Continue load testing despite errors
          }
        }
      };
      
      // Start background load
      const loadPromise = backgroundLoad();
      
      // Monitor resources
      const monitoringPromise = (async () => {
        while (Date.now() - startTime < testDurationMs) {
          try {
            const healthResponse = await apiClient.get('/monitoring-service/api/v1/monitoring/metrics');
            const memoryUsage = process.memoryUsage();
            
            resourceSamples.push({
              timestamp: Date.now(),
              heapUsed: memoryUsage.heapUsed,
              heapTotal: memoryUsage.heapTotal,
              external: memoryUsage.external,
              rss: memoryUsage.rss,
              systemMetrics: healthResponse.data.metrics || {}
            });
          } catch (error) {
            // Continue monitoring despite API errors
            const memoryUsage = process.memoryUsage();
            resourceSamples.push({
              timestamp: Date.now(),
              heapUsed: memoryUsage.heapUsed,
              heapTotal: memoryUsage.heapTotal,
              external: memoryUsage.external,
              rss: memoryUsage.rss,
              systemMetrics: {}
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, sampleInterval));
        }
      })();
      
      await Promise.all([loadPromise, monitoringPromise]);
      
      // Analyze resource usage
      const initialMemory = resourceSamples[0];
      const finalMemory = resourceSamples[resourceSamples.length - 1];
      const maxHeapUsed = Math.max(...resourceSamples.map(s => s.heapUsed));
      const avgHeapUsed = resourceSamples.reduce((sum, s) => sum + s.heapUsed, 0) / resourceSamples.length;
      
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryGrowthMB = memoryGrowth / (1024 * 1024);
      const maxHeapMB = maxHeapUsed / (1024 * 1024);
      const avgHeapMB = avgHeapUsed / (1024 * 1024);
      
      console.log('📊 Resource Usage Results:', {
        testDurationMinutes,
        samples: resourceSamples.length,
        initialHeapMB: Math.round(initialMemory.heapUsed / (1024 * 1024)),
        finalHeapMB: Math.round(finalMemory.heapUsed / (1024 * 1024)),
        maxHeapMB: Math.round(maxHeapMB),
        avgHeapMB: Math.round(avgHeapMB),
        memoryGrowthMB: Math.round(memoryGrowthMB * 10) / 10
      });
      
      // Resource usage assertions
      expect(resourceSamples.length).toBeGreaterThan(10); // Should have multiple samples
      expect(maxHeapMB).toBeLessThan(512); // Max heap under 512MB
      expect(memoryGrowthMB).toBeLessThan(100); // Memory growth under 100MB
      expect(avgHeapMB).toBeLessThan(256); // Average heap under 256MB
    }, 150000); // 2.5 minutes timeout
  });

  describe('System Limits and Stress Tests', () => {
    it('should handle maximum concurrent WebSocket connections', async () => {
      const maxConnections = 100;
      const connectionTimeout = 5000;
      
      console.log(`🔌 Testing maximum WebSocket connections: ${maxConnections}`);
      
      const connections: WebSocket[] = [];
      const connectionResults: any[] = [];
      let successfulConnections = 0;
      let failedConnections = 0;
      
      // Attempt to create maximum connections
      const connectionPromises = Array.from({ length: maxConnections }, async (_, i) => {
        return new Promise<void>((resolve) => {
          const ws = new WebSocket(`ws://localhost:3002/realtime/conversation?callId=stress-test-${i}`);
          const timeout = setTimeout(() => {
            failedConnections++;
            connectionResults.push({
              connectionId: i,
              status: 'timeout',
              timestamp: Date.now()
            });
            ws.terminate();
            resolve();
          }, connectionTimeout);
          
          ws.on('open', () => {
            clearTimeout(timeout);
            successfulConnections++;
            connections.push(ws);
            connectionResults.push({
              connectionId: i,
              status: 'connected',
              timestamp: Date.now()
            });
            resolve();
          });
          
          ws.on('error', (error) => {
            clearTimeout(timeout);
            failedConnections++;
            connectionResults.push({
              connectionId: i,
              status: 'error',
              error: error.message,
              timestamp: Date.now()
            });
            resolve();
          });
        });
      });
      
      await Promise.all(connectionPromises);
      
      // Test message handling with all connections
      const messageTesting = connections.slice(0, Math.min(50, connections.length)).map(async (ws, index) => {
        return new Promise<boolean>((resolve) => {
          const testMessage = {
            type: 'audio_chunk',
            callId: `stress-message-test-${index}`,
            audioData: Buffer.from('stress test message').toString('base64'),
            timestamp: Date.now(),
            sequenceNumber: 1
          };
          
          const timeout = setTimeout(() => resolve(false), 3000);
          
          ws.on('message', () => {
            clearTimeout(timeout);
            resolve(true);
          });
          
          ws.send(JSON.stringify(testMessage));
        });
      });
      
      const messageResults = await Promise.all(messageTesting);
      const responsiveConnections = messageResults.filter(result => result).length;
      
      // Cleanup connections
      connections.forEach(ws => ws.close());
      
      const connectionSuccessRate = (successfulConnections / maxConnections) * 100;
      const responseRate = responsiveConnections > 0 ? (responsiveConnections / messageTesting.length) * 100 : 0;
      
      console.log('📊 Connection Stress Test Results:', {
        attemptedConnections: maxConnections,
        successfulConnections,
        failedConnections,
        connectionSuccessRate: Math.round(connectionSuccessRate * 10) / 10,
        responsiveConnections,
        responseRate: Math.round(responseRate * 10) / 10
      });
      
      // Connection stress test assertions
      expect(connectionSuccessRate).toBeGreaterThan(80); // At least 80% connection success
      expect(successfulConnections).toBeGreaterThan(50); // At least 50 concurrent connections
      expect(responseRate).toBeGreaterThan(90); // At least 90% response rate from active connections
    }, 120000);
  });
});