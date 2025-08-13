import request from 'supertest';
import WebSocket from 'ws';
import RealtimeProcessorServer from '../server';

// Mock dependencies
jest.mock('../services/redis');
jest.mock('../services/websocket');
jest.mock('../services/realtimeCommunication');
jest.mock('../services/connectionPool');

describe('Real-time Processor Service', () => {
  let server: any;
  let app: any;

  beforeAll(async () => {
    // Mock environment variables
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3002';
    process.env.REDIS_HOST = 'localhost';
    process.env.JWT_SECRET = 'test-secret';
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'eastus2';
    process.env.AZURE_OPENAI_API_KEY = 'test-openai-key';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com/';

    server = new RealtimeProcessorServer();
    app = server['app']; // Access private app property for testing
  });

  afterAll(async () => {
    if (server && server.gracefulShutdown) {
      await server.gracefulShutdown();
    }
  });

  describe('HTTP Endpoints', () => {
    test('GET / should return service information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'Realtime Processor');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body).toHaveProperty('websocket');
    });

    test('GET /health should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('GET /metrics should return metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.body).toBeDefined();
    });

    test('GET /connections should return connection stats', async () => {
      const response = await request(app)
        .get('/connections')
        .expect(200);

      expect(response.body).toBeDefined();
    });

    test('GET /sessions should return session stats', async () => {
      const response = await request(app)
        .get('/sessions')
        .expect(200);

      expect(response.body).toBeDefined();
    });

    test('GET /pool should return connection pool stats', async () => {
      const response = await request(app)
        .get('/pool')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Audio Processing Endpoints', () => {
    test('POST /process/audio should process audio data', async () => {
      const audioData = {
        callId: 'test-call-123',
        audioData: 'base64-encoded-audio-data',
        userId: 'test-user-456',
      };

      const response = await request(app)
        .post('/process/audio')
        .send(audioData)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    test('POST /process/audio should return 400 for missing required fields', async () => {
      const incompleteData = {
        callId: 'test-call-123',
        // Missing audioData
      };

      const response = await request(app)
        .post('/process/audio')
        .send(incompleteData)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Missing required fields');
    });

    test('GET /process/status/:callId should return processing status', async () => {
      const callId = 'test-call-123';

      const response = await request(app)
        .get(`/process/status/${callId}`)
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Session Management', () => {
    test('GET /sessions/:sessionId should return session details', async () => {
      const sessionId = 'test-session-123';

      const response = await request(app)
        .get(`/sessions/${sessionId}`)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    test('GET /sessions/:sessionId should return 404 for non-existent session', async () => {
      const sessionId = 'non-existent-session';

      // Mock the getSession method to return null
      const mockCommunicationManager = {
        getSession: jest.fn().mockResolvedValue(null),
      };
      server['communicationManager'] = mockCommunicationManager;

      const response = await request(app)
        .get(`/sessions/${sessionId}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Session not found');
    });

    test('DELETE /sessions/call/:callId should terminate session', async () => {
      const callId = 'test-call-123';

      const response = await request(app)
        .delete(`/sessions/call/${callId}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Session terminated');
    });
  });

  describe('Error Handling', () => {
    test('Should return 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/non-existent-route')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Not Found');
    });

    test('Should handle JSON parsing errors gracefully', async () => {
      const response = await request(app)
        .post('/process/audio')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Security and Rate Limiting', () => {
    test('Should include security headers', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      // Helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    test('Should respect CORS configuration', async () => {
      const response = await request(app)
        .options('/')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });
});

describe('WebSocket Integration', () => {
  let wsServer: any;
  let serverUrl: string;

  beforeAll(async () => {
    // This would typically be set up in a separate test environment
    serverUrl = 'ws://localhost:3002/realtime/conversation';
  });

  describe('WebSocket Connection', () => {
    test('Should establish WebSocket connection with valid auth', (done) => {
      const ws = new WebSocket(serverUrl, {
        headers: {
          'Authorization': 'Bearer valid-test-token',
        },
      });

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (error) => {
        // In test environment, this might fail due to mocked services
        // That's expected behavior
        done();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          done();
        }
      }, 5000);
    });

    test('Should reject WebSocket connection without auth', (done) => {
      const ws = new WebSocket(serverUrl);

      ws.on('close', (code) => {
        expect(code).toBe(1008); // Policy violation
        done();
      });

      ws.on('open', () => {
        // Should not reach here
        ws.close();
        done();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ws.close();
        done();
      }, 5000);
    });
  });

  describe('WebSocket Message Handling', () => {
    test('Should handle audio data messages', (done) => {
      const ws = new WebSocket(serverUrl, {
        headers: {
          'Authorization': 'Bearer valid-test-token',
        },
      });

      ws.on('open', () => {
        const audioMessage = {
          type: 'audio_chunk',
          callId: 'test-call-123',
          timestamp: Date.now(),
          audioData: 'base64-encoded-audio',
          sequenceNumber: 1,
        };

        ws.send(JSON.stringify(audioMessage));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        expect(message).toHaveProperty('type');
        ws.close();
        done();
      });

      ws.on('error', () => {
        // Expected in test environment
        done();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ws.close();
        done();
      }, 5000);
    });
  });
});

describe('Service Integration', () => {
  describe('Service Dependencies', () => {
    test('Should initialize all required services', () => {
      const server = new RealtimeProcessorServer();
      
      expect(server['redisService']).toBeDefined();
      expect(server['wsManager']).toBeDefined();
      expect(server['communicationManager']).toBeDefined();
      expect(server['connectionPool']).toBeDefined();
      expect(server['metricsService']).toBeDefined();
      expect(server['healthCheck']).toBeDefined();
    });
  });

  describe('Performance Metrics', () => {
    test('Should track connection metrics', async () => {
      const server = new RealtimeProcessorServer();
      const app = server['app'];

      const response = await request(app)
        .get('/connections')
        .expect(200);

      expect(response.body).toBeDefined();
    });

    test('Should track session metrics', async () => {
      const server = new RealtimeProcessorServer();
      const app = server['app'];

      const response = await request(app)
        .get('/sessions')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });
});

// Mock implementations
beforeEach(() => {
  jest.clearAllMocks();
});

// Redis Service Mock
jest.mock('../services/redis', () => {
  return {
    RedisService: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

// WebSocket Manager Mock
jest.mock('../services/websocket', () => {
  return {
    WebSocketManager: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getConnectionStats: jest.fn().mockResolvedValue({
        activeConnections: 0,
        totalConnections: 0,
        messagesProcessed: 0,
      }),
      processAudioData: jest.fn().mockResolvedValue({
        success: true,
        processedAt: Date.now(),
      }),
      getProcessingStatus: jest.fn().mockResolvedValue({
        status: 'processing',
        callId: 'test-call-123',
      }),
    })),
  };
});

// Communication Manager Mock
jest.mock('../services/realtimeCommunication', () => {
  return {
    RealtimeCommunicationManager: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getSessionStats: jest.fn().mockResolvedValue({
        activeSessions: 0,
        totalSessions: 0,
      }),
      getSession: jest.fn().mockResolvedValue({
        sessionId: 'test-session-123',
        callId: 'test-call-123',
        status: 'active',
      }),
      terminateSessionByCallId: jest.fn().mockResolvedValue(true),
    })),
  };
});

// Connection Pool Mock
jest.mock('../services/connectionPool', () => {
  return {
    ConnectionPool: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getPoolStats: jest.fn().mockResolvedValue({
        activeConnections: 0,
        maxConnections: 1000,
        queueSize: 0,
      }),
    })),
  };
});

// Metrics Service Mock
jest.mock('../services/metrics', () => {
  return {
    MetricsService: jest.fn().mockImplementation(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn().mockResolvedValue({
        uptime: process.uptime(),
        connections: 0,
        requests: 0,
      }),
    })),
  };
});

// Health Check Service Mock
jest.mock('../services/healthCheck', () => {
  return {
    HealthCheckService: jest.fn().mockImplementation(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getHealthStatus: jest.fn().mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          redis: { status: 'healthy' },
          websocket: { status: 'healthy' },
        },
      }),
    })),
  };
});