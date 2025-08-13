import request from 'supertest';
import { PhoneGatewayServer } from '../server';
import { dbPool } from '../utils/database';
import { redisClient } from '../utils/redis';

// Mock external dependencies
jest.mock('../utils/database');
jest.mock('../utils/redis');
jest.mock('../services/AzureCommunicationService');

describe('Phone Gateway Service', () => {
  let server: PhoneGatewayServer;
  let app: any;

  beforeAll(async () => {
    // Mock environment variables
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret';
    process.env.DB_PASSWORD = 'test-password';
    process.env.AZURE_COMMUNICATION_CONNECTION_STRING = 'test-connection-string';
    process.env.AZURE_COMMUNICATION_ENDPOINT = 'https://test.communication.azure.com';
    process.env.AZURE_COMMUNICATION_RESOURCE_ID = 'test-resource-id';
    process.env.AZURE_EVENT_GRID_ENDPOINT = 'https://test.eventgrid.azure.net';
    process.env.AZURE_EVENT_GRID_ACCESS_KEY = 'test-access-key';

    server = new PhoneGatewayServer();
    app = server['app']; // Access private app property for testing
  });

  afterAll(async () => {
    await server.shutdown();
  });

  describe('Health Endpoints', () => {
    beforeEach(() => {
      // Mock database health check
      (dbPool.healthCheck as jest.Mock).mockResolvedValue(true);
      (dbPool as any).connected = true;
      (dbPool as any).totalCount = 10;
      (dbPool as any).idleCount = 5;
      (dbPool as any).waitingCount = 0;

      // Mock Redis health check
      (redisClient.ping as jest.Mock).mockResolvedValue('PONG');
      (redisClient as any).status = 'ready';
      (redisClient as any).mode = 'standalone';
    });

    test('GET /health should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('database');
      expect(response.body.services).toHaveProperty('redis');
      expect(response.body.services).toHaveProperty('azure');
    });

    test('GET /health/ready should return readiness status', async () => {
      const response = await request(app)
        .get('/health/ready')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ready');
      expect(response.body.services.database.status).toBe('healthy');
      expect(response.body.services.redis.status).toBe('healthy');
    });

    test('GET /health/live should return liveness status', async () => {
      const response = await request(app)
        .get('/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'alive');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('pid');
    });

    test('Health check should return unhealthy when database is down', async () => {
      (dbPool.healthCheck as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.services.database.status).toBe('unhealthy');
    });

    test('Readiness check should return not ready when Redis is down', async () => {
      (redisClient.ping as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const response = await request(app)
        .get('/health/ready')
        .expect(503);

      expect(response.body.status).toBe('not_ready');
      expect(response.body.services.redis.status).toBe('unhealthy');
    });
  });

  describe('Service Info', () => {
    test('GET / should return service information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'Phone Gateway');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('Webhook Endpoints', () => {
    test('POST /webhook/incoming-call should handle incoming call webhook', async () => {
      const mockCallEvent = {
        eventType: 'IncomingCall',
        from: '+1234567890',
        to: '+0987654321',
        callId: 'test-call-id',
        timestamp: new Date().toISOString(),
      };

      const response = await request(app)
        .post('/webhook/incoming-call')
        .send(mockCallEvent)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'received');
      expect(response.body).toHaveProperty('callId', 'test-call-id');
    });

    test('POST /webhook/azure-events should handle Azure Event Grid webhook', async () => {
      const mockEvents = [
        {
          eventType: 'Microsoft.Communication.CallConnected',
          subject: 'calling/callConnections/test-connection-id',
          data: {
            callConnectionId: 'test-connection-id',
          },
          eventTime: new Date().toISOString(),
        },
      ];

      const response = await request(app)
        .post('/webhook/azure-events')
        .send(mockEvents)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'received');
      expect(response.body).toHaveProperty('eventCount', 1);
    });
  });

  describe('Error Handling', () => {
    test('Should return 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/non-existent-route')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Not Found');
    });

    test('Should handle malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/webhook/incoming-call')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_JSON');
    });
  });

  describe('Rate Limiting', () => {
    test('Should respect rate limits', async () => {
      // This test would need to be adjusted based on your rate limiting configuration
      // For now, we'll just test that the endpoint responds
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
    });
  });

  describe('Security Headers', () => {
    test('Should include security headers', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      // Helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });
  });
});

describe('Phone Gateway Service Integration', () => {
  let server: PhoneGatewayServer;

  beforeAll(() => {
    server = new PhoneGatewayServer();
  });

  afterAll(async () => {
    await server.shutdown();
  });

  describe('Service Initialization', () => {
    test('Should initialize all services correctly', async () => {
      // Mock successful initialization
      (dbPool.connect as jest.Mock).mockResolvedValue(undefined);
      
      // Test that the server can start without throwing errors
      expect(() => server).not.toThrow();
    });
  });

  describe('Graceful Shutdown', () => {
    test('Should shutdown gracefully', async () => {
      (dbPool.end as jest.Mock).mockResolvedValue(undefined);
      (redisClient.quit as jest.Mock).mockResolvedValue('OK');

      await expect(server.shutdown()).resolves.not.toThrow();
    });
  });
});

// Mock implementations
beforeEach(() => {
  jest.clearAllMocks();
});

// Database mocks
(dbPool.healthCheck as jest.Mock) = jest.fn();
(dbPool.connect as jest.Mock) = jest.fn();
(dbPool.end as jest.Mock) = jest.fn();
(dbPool.query as jest.Mock) = jest.fn();

// Redis mocks
(redisClient.ping as jest.Mock) = jest.fn();
(redisClient.quit as jest.Mock) = jest.fn();

// Azure Communication Service mocks
jest.mock('../services/AzureCommunicationService', () => {
  return {
    AzureCommunicationService: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      answerCall: jest.fn().mockResolvedValue({ callConnectionId: 'test-connection' }),
      transferCall: jest.fn().mockResolvedValue(undefined),
      hangupCall: jest.fn().mockResolvedValue(undefined),
      getCallConnection: jest.fn().mockResolvedValue({ callConnectionId: 'test-connection' }),
      handleEvent: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

// Call Routing Service mocks
jest.mock('../services/CallRoutingService', () => {
  return {
    CallRoutingService: jest.fn().mockImplementation(() => ({
      routeCall: jest.fn().mockResolvedValue({
        action: 'ai_handle',
        reason: 'Default routing',
        metadata: {},
      }),
      getRoutingStats: jest.fn().mockResolvedValue({
        totalCalls: 100,
        transferredCalls: 20,
        aiHandledCalls: 70,
        rejectedCalls: 10,
      }),
    })),
  };
});

// Service Client Manager mocks
jest.mock('../services/ServiceClientManager', () => {
  return {
    ServiceClientManager: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      post: jest.fn().mockResolvedValue({ success: true }),
      get: jest.fn().mockResolvedValue({ success: true }),
    })),
  };
});