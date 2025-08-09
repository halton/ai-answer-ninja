/**
 * WebSocket Real-time Communication Integration Tests
 * 
 * Tests for real-time audio processing, conversation state management,
 * and WebSocket connection reliability.
 */

import WebSocket from 'ws';
import * as winston from 'winston';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

export interface WebSocketTestConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  expectedLatency: number;
  connectionTimeout: number;
  messageTimeout: number;
}

export interface WebSocketTestResult {
  testName: string;
  category: string;
  passed: boolean;
  duration: number;
  metrics?: {
    connectionTime?: number;
    messageLatency?: number;
    throughput?: number;
    reliability?: number;
    dataIntegrity?: boolean;
  };
  error?: string;
  details?: any;
}

export interface WebSocketTestSuite {
  suiteName: string;
  results: WebSocketTestResult[];
  passed: boolean;
  totalTests: number;
  passedTests: number;
  averageLatency: number;
  connectionReliability: number;
}

export class WebSocketIntegrationTestRunner extends EventEmitter {
  private logger: winston.Logger;
  private config: WebSocketTestConfig;
  private activeConnections: Map<string, WebSocket> = new Map();
  private messageCounters: Map<string, number> = new Map();

  constructor(config: WebSocketTestConfig) {
    super();
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
   * Execute WebSocket test with comprehensive monitoring
   */
  private async executeWebSocketTest(
    testName: string,
    category: string,
    testFn: () => Promise<{ metrics?: any; details?: any }>,
    timeout: number = this.config.timeout
  ): Promise<WebSocketTestResult> {
    const startTime = performance.now();
    
    try {
      this.logger.info(`🔌 Starting WebSocket test: ${testName}`);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout);
      });

      const result = await Promise.race([testFn(), timeoutPromise]) as { metrics?: any; details?: any };
      const duration = performance.now() - startTime;

      this.logger.info(`✅ WebSocket test passed: ${testName}`, {
        duration: Math.round(duration),
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
      const duration = performance.now() - startTime;
      this.logger.error(`❌ WebSocket test failed: ${testName}`, {
        duration: Math.round(duration),
        error: (error as Error).message
      });

      return {
        testName,
        category,
        passed: false,
        duration: Math.round(duration),
        error: (error as Error).message
      };
    }
  }

  /**
   * Basic Connection Tests
   */
  async testBasicConnectivity(): Promise<WebSocketTestSuite> {
    const results: WebSocketTestResult[] = [];
    const category = 'Basic Connectivity';

    // Test 1: Simple Connection
    results.push(await this.executeWebSocketTest(
      'Basic WebSocket Connection',
      category,
      async () => {
        const connectionStart = performance.now();
        
        return new Promise((resolve, reject) => {
          const testUrl = `${this.config.baseUrl}/ws/test`;
          const ws = new WebSocket(testUrl);
          let connected = false;

          const timeout = setTimeout(() => {
            if (!connected) {
              ws.close();
              reject(new Error('Connection timeout'));
            }
          }, this.config.connectionTimeout);

          ws.on('open', () => {
            connected = true;
            clearTimeout(timeout);
            const connectionTime = performance.now() - connectionStart;
            
            ws.close();
            resolve({
              metrics: {
                connectionTime: Math.round(connectionTime)
              },
              details: {
                connected: true,
                url: testUrl
              }
            });
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.connectionTimeout
    ));

    // Test 2: Connection with Authentication
    results.push(await this.executeWebSocketTest(
      'Authenticated WebSocket Connection',
      category,
      async () => {
        return new Promise((resolve, reject) => {
          const testUrl = `${this.config.baseUrl}/ws/audio/test-call-id`;
          const ws = new WebSocket(testUrl, {
            headers: {
              'Authorization': 'Bearer test-token',
              'X-User-ID': 'test-user-id'
            }
          });

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Authenticated connection timeout'));
          }, this.config.connectionTimeout);

          ws.on('open', () => {
            clearTimeout(timeout);
            
            // Send authentication message
            ws.send(JSON.stringify({
              type: 'auth',
              token: 'test-token',
              user_id: 'test-user-id'
            }));
          });

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'auth_success') {
              ws.close();
              resolve({
                metrics: {
                  dataIntegrity: true
                },
                details: {
                  authenticated: true,
                  message: message
                }
              });
            } else if (message.type === 'auth_error') {
              ws.close();
              reject(new Error('Authentication failed'));
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.connectionTimeout
    ));

    // Test 3: Multiple Concurrent Connections
    results.push(await this.executeWebSocketTest(
      'Multiple Concurrent Connections',
      category,
      async () => {
        const connectionCount = 5;
        const connections: Promise<any>[] = [];

        for (let i = 0; i < connectionCount; i++) {
          connections.push(new Promise((resolve, reject) => {
            const connectionStart = performance.now();
            const testUrl = `${this.config.baseUrl}/ws/test-concurrent-${i}`;
            const ws = new WebSocket(testUrl);

            const timeout = setTimeout(() => {
              ws.close();
              reject(new Error(`Connection ${i} timeout`));
            }, this.config.connectionTimeout);

            ws.on('open', () => {
              clearTimeout(timeout);
              const connectionTime = performance.now() - connectionStart;
              
              // Send a test message
              ws.send(JSON.stringify({
                type: 'ping',
                connection_id: i,
                timestamp: Date.now()
              }));

              setTimeout(() => {
                ws.close();
                resolve({
                  connection_id: i,
                  connection_time: Math.round(connectionTime),
                  success: true
                });
              }, 1000);
            });

            ws.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          }));
        }

        const results = await Promise.allSettled(connections);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const avgConnectionTime = results
          .filter(r => r.status === 'fulfilled')
          .reduce((sum, r: any) => sum + r.value.connection_time, 0) / successful;

        return {
          metrics: {
            reliability: successful / connectionCount,
            connectionTime: Math.round(avgConnectionTime),
            throughput: successful
          },
          details: {
            totalConnections: connectionCount,
            successfulConnections: successful,
            failedConnections: connectionCount - successful
          }
        };
      },
      this.config.connectionTimeout * 2
    ));

    return this.calculateSuiteMetrics('Basic Connectivity Tests', results);
  }

  /**
   * Real-time Audio Processing Tests
   */
  async testRealTimeAudioProcessing(): Promise<WebSocketTestSuite> {
    const results: WebSocketTestResult[] = [];
    const category = 'Real-time Audio Processing';

    // Test 1: Audio Stream Processing
    results.push(await this.executeWebSocketTest(
      'Audio Stream Processing',
      category,
      async () => {
        const callId = `audio_test_${Date.now()}`;
        
        return new Promise((resolve, reject) => {
          const wsUrl = `${this.config.baseUrl}/ws/audio/${callId}`;
          const ws = new WebSocket(wsUrl);
          const messages: any[] = [];
          const latencies: number[] = [];

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Audio processing timeout'));
          }, this.config.timeout);

          ws.on('open', () => {
            // Send audio initialization
            ws.send(JSON.stringify({
              type: 'audio_init',
              call_id: callId,
              config: {
                sample_rate: 16000,
                channels: 1,
                format: 'wav'
              }
            }));

            // Simulate audio chunks
            const audioChunks = [
              'mock_audio_chunk_1',
              'mock_audio_chunk_2',
              'mock_audio_chunk_3'
            ];

            audioChunks.forEach((chunk, index) => {
              setTimeout(() => {
                const sendTime = performance.now();
                ws.send(JSON.stringify({
                  type: 'audio_chunk',
                  call_id: callId,
                  data: chunk,
                  sequence: index + 1,
                  timestamp: sendTime
                }));
              }, index * 500);
            });
          });

          ws.on('message', (data) => {
            const receiveTime = performance.now();
            const message = JSON.parse(data.toString());
            messages.push(message);

            if (message.type === 'audio_processed' || message.type === 'stt_result') {
              const latency = receiveTime - (message.original_timestamp || receiveTime);
              latencies.push(latency);
            }

            if (message.type === 'processing_complete' || messages.length >= 3) {
              clearTimeout(timeout);
              ws.close();

              const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length || 0;

              resolve({
                metrics: {
                  messageLatency: Math.round(avgLatency),
                  throughput: messages.length,
                  dataIntegrity: messages.every(m => m.call_id === callId)
                },
                details: {
                  messagesReceived: messages.length,
                  latencies: latencies.map(l => Math.round(l)),
                  messageTypes: messages.map(m => m.type)
                }
              });
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.timeout
    ));

    // Test 2: Voice Activity Detection
    results.push(await this.executeWebSocketTest(
      'Voice Activity Detection Processing',
      category,
      async () => {
        const callId = `vad_test_${Date.now()}`;
        
        return new Promise((resolve, reject) => {
          const wsUrl = `${this.config.baseUrl}/ws/audio/${callId}`;
          const ws = new WebSocket(wsUrl);
          let vadResults: any[] = [];

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('VAD processing timeout'));
          }, this.config.timeout);

          ws.on('open', () => {
            // Send VAD-specific audio data
            const audioData = [
              { type: 'silence', duration: 1000 },
              { type: 'speech', duration: 2000, content: 'hello world' },
              { type: 'silence', duration: 500 },
              { type: 'speech', duration: 1500, content: 'goodbye' }
            ];

            audioData.forEach((data, index) => {
              setTimeout(() => {
                ws.send(JSON.stringify({
                  type: 'audio_chunk',
                  call_id: callId,
                  vad_data: data,
                  timestamp: Date.now()
                }));
              }, index * 300);
            });
          });

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'vad_result') {
              vadResults.push(message);
            }

            if (message.type === 'vad_complete' || vadResults.length >= 4) {
              clearTimeout(timeout);
              ws.close();

              const speechDetected = vadResults.filter(r => r.is_speech).length;
              const silenceDetected = vadResults.filter(r => !r.is_speech).length;

              resolve({
                metrics: {
                  reliability: vadResults.length >= 4 ? 1.0 : vadResults.length / 4,
                  dataIntegrity: vadResults.every(r => r.call_id === callId)
                },
                details: {
                  totalVadResults: vadResults.length,
                  speechDetected,
                  silenceDetected,
                  results: vadResults
                }
              });
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.timeout
    ));

    // Test 3: Real-time Response Generation
    results.push(await this.executeWebSocketTest(
      'Real-time Response Generation',
      category,
      async () => {
        const callId = `response_test_${Date.now()}`;
        
        return new Promise((resolve, reject) => {
          const wsUrl = `${this.config.baseUrl}/ws/conversation/${callId}`;
          const ws = new WebSocket(wsUrl);
          const responses: any[] = [];
          const responseTimes: number[] = [];

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Response generation timeout'));
          }, this.config.timeout);

          ws.on('open', () => {
            // Send conversation inputs
            const inputs = [
              '你好，我是XX银行的客服',
              '想了解一下您的贷款需求',
              '我们有很优惠的利率'
            ];

            inputs.forEach((input, index) => {
              setTimeout(() => {
                const sendTime = performance.now();
                ws.send(JSON.stringify({
                  type: 'conversation_input',
                  call_id: callId,
                  text: input,
                  intent: 'banking_sales',
                  timestamp: sendTime
                }));
              }, index * 1000);
            });
          });

          ws.on('message', (data) => {
            const receiveTime = performance.now();
            const message = JSON.parse(data.toString());
            
            if (message.type === 'ai_response') {
              responses.push(message);
              
              if (message.original_timestamp) {
                const responseTime = receiveTime - message.original_timestamp;
                responseTimes.push(responseTime);
              }
            }

            if (responses.length >= 3 || message.type === 'conversation_complete') {
              clearTimeout(timeout);
              ws.close();

              const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length || 0;

              resolve({
                metrics: {
                  messageLatency: Math.round(avgResponseTime),
                  throughput: responses.length,
                  dataIntegrity: responses.every(r => r.response_text && r.call_id === callId)
                },
                details: {
                  responsesGenerated: responses.length,
                  avgResponseTime: Math.round(avgResponseTime),
                  responseQualities: responses.map(r => r.confidence || 0),
                  allResponsesValid: responses.every(r => r.response_text)
                }
              });
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.timeout
    ));

    return this.calculateSuiteMetrics('Real-time Audio Processing Tests', results);
  }

  /**
   * Connection Reliability and Fault Tolerance Tests
   */
  async testConnectionReliability(): Promise<WebSocketTestSuite> {
    const results: WebSocketTestResult[] = [];
    const category = 'Connection Reliability';

    // Test 1: Connection Recovery
    results.push(await this.executeWebSocketTest(
      'Connection Recovery After Disconnect',
      category,
      async () => {
        return new Promise((resolve, reject) => {
          const callId = `recovery_test_${Date.now()}`;
          const wsUrl = `${this.config.baseUrl}/ws/audio/${callId}`;
          let reconnectAttempts = 0;
          let messagesReceived = 0;
          let connectionEstablished = false;

          const createConnection = () => {
            const ws = new WebSocket(wsUrl);
            
            ws.on('open', () => {
              connectionEstablished = true;
              
              // Send a message to verify connection
              ws.send(JSON.stringify({
                type: 'ping',
                call_id: callId,
                attempt: reconnectAttempts + 1
              }));
            });

            ws.on('message', (data) => {
              const message = JSON.parse(data.toString());
              messagesReceived++;

              if (message.type === 'pong' && reconnectAttempts === 0) {
                // First connection established, now force disconnect
                reconnectAttempts++;
                ws.close(1000, 'Test disconnect');
                
                // Attempt reconnection after delay
                setTimeout(createConnection, 1000);
                
              } else if (message.type === 'pong' && reconnectAttempts > 0) {
                // Successfully reconnected
                resolve({
                  metrics: {
                    reliability: 1.0,
                    dataIntegrity: true
                  },
                  details: {
                    reconnectAttempts,
                    messagesReceived,
                    recoverySuccessful: true
                  }
                });
              }
            });

            ws.on('error', (error) => {
              if (reconnectAttempts === 0) {
                reject(error);
              }
              // Ignore errors during reconnection attempts
            });

            ws.on('close', (code) => {
              if (code === 1000 && reconnectAttempts === 1) {
                // Expected disconnect, connection will be re-established
                return;
              }
              
              if (!connectionEstablished && reconnectAttempts === 0) {
                reject(new Error('Initial connection failed'));
              }
            });
          };

          createConnection();

          // Overall timeout
          setTimeout(() => {
            reject(new Error('Recovery test timeout'));
          }, this.config.timeout);
        });
      },
      this.config.timeout
    ));

    // Test 2: Message Ordering and Delivery
    results.push(await this.executeWebSocketTest(
      'Message Ordering and Delivery',
      category,
      async () => {
        return new Promise((resolve, reject) => {
          const callId = `ordering_test_${Date.now()}`;
          const wsUrl = `${this.config.baseUrl}/ws/audio/${callId}`;
          const ws = new WebSocket(wsUrl);
          const receivedMessages: any[] = [];
          const totalMessages = 10;

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Message ordering test timeout'));
          }, this.config.timeout);

          ws.on('open', () => {
            // Send numbered messages rapidly
            for (let i = 1; i <= totalMessages; i++) {
              ws.send(JSON.stringify({
                type: 'sequenced_message',
                call_id: callId,
                sequence: i,
                timestamp: Date.now() + i
              }));
            }
          });

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'sequenced_response') {
              receivedMessages.push(message);
            }

            if (receivedMessages.length >= totalMessages) {
              clearTimeout(timeout);
              ws.close();

              // Check message ordering
              const ordered = receivedMessages.every((msg, index) => 
                msg.sequence === index + 1
              );

              const allReceived = receivedMessages.length === totalMessages;

              resolve({
                metrics: {
                  reliability: allReceived ? 1.0 : receivedMessages.length / totalMessages,
                  dataIntegrity: ordered
                },
                details: {
                  totalSent: totalMessages,
                  totalReceived: receivedMessages.length,
                  correctOrder: ordered,
                  sequences: receivedMessages.map(m => m.sequence)
                }
              });
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.timeout
    ));

    // Test 3: High-Frequency Message Handling
    results.push(await this.executeWebSocketTest(
      'High-Frequency Message Handling',
      category,
      async () => {
        return new Promise((resolve, reject) => {
          const callId = `highfreq_test_${Date.now()}`;
          const wsUrl = `${this.config.baseUrl}/ws/audio/${callId}`;
          const ws = new WebSocket(wsUrl);
          const startTime = performance.now();
          let messagesSent = 0;
          let messagesReceived = 0;
          const messageInterval = 50; // 50ms intervals
          const testDuration = 5000; // 5 seconds

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('High-frequency test timeout'));
          }, this.config.timeout);

          ws.on('open', () => {
            const sender = setInterval(() => {
              messagesSent++;
              
              ws.send(JSON.stringify({
                type: 'high_freq_message',
                call_id: callId,
                sequence: messagesSent,
                timestamp: performance.now()
              }));

              if (performance.now() - startTime > testDuration) {
                clearInterval(sender);
              }
            }, messageInterval);
          });

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'high_freq_response') {
              messagesReceived++;
            }

            // Check if test should complete
            if (performance.now() - startTime > testDuration && messagesSent > 0) {
              clearTimeout(timeout);
              ws.close();

              const throughput = messagesReceived / (testDuration / 1000); // messages per second
              const deliveryRate = messagesReceived / messagesSent;

              resolve({
                metrics: {
                  throughput: Math.round(throughput),
                  reliability: deliveryRate,
                  messageLatency: messageInterval
                },
                details: {
                  messagesSent,
                  messagesReceived,
                  deliveryRate: Math.round(deliveryRate * 100) / 100,
                  testDurationMs: testDuration
                }
              });
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      this.config.timeout
    ));

    return this.calculateSuiteMetrics('Connection Reliability Tests', results);
  }

  /**
   * Calculate suite metrics from test results
   */
  private calculateSuiteMetrics(suiteName: string, results: WebSocketTestResult[]): WebSocketTestSuite {
    const passedTests = results.filter(r => r.passed).length;
    const totalLatency = results.reduce((sum, r) => sum + (r.metrics?.messageLatency || r.duration), 0);
    const reliabilityScores = results
      .filter(r => r.metrics?.reliability !== undefined)
      .map(r => r.metrics!.reliability!);
    
    const avgReliability = reliabilityScores.length > 0 
      ? reliabilityScores.reduce((a, b) => a + b) / reliabilityScores.length 
      : 1.0;

    return {
      suiteName,
      results,
      passed: passedTests === results.length,
      totalTests: results.length,
      passedTests,
      averageLatency: Math.round(totalLatency / results.length) || 0,
      connectionReliability: Math.round(avgReliability * 100) / 100
    };
  }

  /**
   * Run all WebSocket integration tests
   */
  async runAllTests(): Promise<{
    overall: {
      passed: boolean;
      totalSuites: number;
      passedSuites: number;
      totalTests: number;
      passedTests: number;
      averageLatency: number;
      connectionReliability: number;
    };
    suites: WebSocketTestSuite[];
  }> {
    this.logger.info('🔌 Starting WebSocket Integration Tests');

    const suites: WebSocketTestSuite[] = [];

    try {
      // Run test suites
      suites.push(await this.testBasicConnectivity());
      suites.push(await this.testRealTimeAudioProcessing());
      suites.push(await this.testConnectionReliability());

      const passedSuites = suites.filter(s => s.passed).length;
      const totalTests = suites.reduce((sum, s) => sum + s.totalTests, 0);
      const passedTests = suites.reduce((sum, s) => sum + s.passedTests, 0);
      const totalLatency = suites.reduce((sum, s) => sum + (s.averageLatency * s.totalTests), 0);
      const reliabilityScores = suites.map(s => s.connectionReliability);
      const avgReliability = reliabilityScores.reduce((a, b) => a + b) / reliabilityScores.length;

      const overall = {
        passed: passedSuites === suites.length,
        totalSuites: suites.length,
        passedSuites,
        totalTests,
        passedTests,
        averageLatency: Math.round(totalLatency / totalTests) || 0,
        connectionReliability: Math.round(avgReliability * 100) / 100
      };

      this.logger.info('📊 WebSocket Integration Test Summary', {
        overall,
        suiteResults: suites.map(s => ({
          name: s.suiteName,
          passed: s.passed,
          tests: `${s.passedTests}/${s.totalTests}`,
          avgLatency: `${s.averageLatency}ms`,
          reliability: `${Math.round(s.connectionReliability * 100)}%`
        }))
      });

      return { overall, suites };

    } catch (error) {
      this.logger.error('💥 WebSocket Integration test execution failed', { error: (error as Error).message });
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Cleanup active connections
   */
  async cleanup(): Promise<void> {
    this.logger.info('🧹 Cleaning up WebSocket connections...');
    
    for (const [id, ws] of this.activeConnections.entries()) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Test cleanup');
        }
      } catch (error) {
        this.logger.warn(`Failed to close WebSocket ${id}`, { error: (error as Error).message });
      }
    }

    this.activeConnections.clear();
    this.messageCounters.clear();
    
    this.logger.info('✅ WebSocket test cleanup completed');
  }
}

export default WebSocketIntegrationTestRunner;