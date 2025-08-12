import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { AzureCommunicationService } from './services/AzureCommunicationService';
import { CallRoutingService } from './services/CallRoutingService';
import { DatabaseService } from './services/DatabaseService';
import { ServiceClientManager } from './services/ServiceClientManager';
import { CallQueueService } from './services/CallQueueService';
import { MetricsService } from './services/MetricsService';
import { HealthCheckService } from './services/HealthCheckService';
import config from './config';
import logger from './utils/logger';
import { PhoneGatewayError, IncomingCallEvent, AzureCommunicationEvent } from './types';

export class PhoneGatewayServer {
  private app: express.Application;
  private server: any;
  private azureComm: AzureCommunicationService;
  private callRouting: CallRoutingService;
  private database: DatabaseService;
  private serviceClient: ServiceClientManager;
  private callQueue: CallQueueService;
  private metrics: MetricsService;
  private healthCheck: HealthCheckService;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    
    // Initialize services
    this.database = new DatabaseService(config.database);
    this.serviceClient = new ServiceClientManager(config.services);
    this.azureComm = new AzureCommunicationService();
    this.callRouting = new CallRoutingService(this.database, this.serviceClient);
    this.callQueue = new CallQueueService();
    this.metrics = new MetricsService();
    this.healthCheck = new HealthCheckService({
      database: this.database,
      azureComm: this.azureComm,
      services: this.serviceClient,
      metrics: this.metrics
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }));

    // Compression
    if (config.performance.compressionEnabled) {
      this.app.use(compression());
    }

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.security.rateLimiting.windowMs,
      max: config.security.rateLimiting.max,
      message: {
        error: 'Too many requests from this IP',
        retryAfter: Math.ceil(config.security.rateLimiting.windowMs / 1000)
      }
    });
    this.app.use(limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info({
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }, 'Incoming request');
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const healthStatus = await this.healthCheck.getHealthStatus();
        const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(healthStatus);
      } catch (error) {
        logger.error({ error }, 'Health check failed');
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed'
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.metrics.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error({ error }, 'Failed to retrieve metrics');
        res.status(500).json({ error: 'Failed to retrieve metrics' });
      }
    });

    // Azure Communication Services webhook endpoint
    this.app.post('/webhook/incoming-call', async (req, res) => {
      try {
        await this.handleIncomingCallWebhook(req, res);
      } catch (error: any) {
        logger.error({ error, body: req.body }, 'Failed to handle incoming call webhook');
        res.status(500).json({ error: 'Failed to process incoming call' });
      }
    });

    // Azure Event Grid webhook endpoint
    this.app.post('/webhook/azure-events', async (req, res) => {
      try {
        await this.handleAzureEventWebhook(req, res);
      } catch (error: any) {
        logger.error({ error, body: req.body }, 'Failed to handle Azure event webhook');
        res.status(500).json({ error: 'Failed to process Azure event' });
      }
    });

    // Manual call control endpoints
    this.app.post('/calls/:callId/answer', async (req, res) => {
      try {
        const { callId } = req.params;
        const { callbackUri } = req.body;
        
        const connection = await this.azureComm.answerCall(
          callId, 
          callbackUri || `${req.protocol}://${req.get('host')}/webhook/call-events`
        );
        
        res.json({ 
          success: true, 
          callConnectionId: connection.callConnectionId 
        });
      } catch (error: any) {
        logger.error({ error, callId: req.params.callId }, 'Failed to answer call');
        res.status(500).json({ error: 'Failed to answer call' });
      }
    });

    this.app.post('/calls/:callId/transfer', async (req, res) => {
      try {
        const { callId } = req.params;
        const { targetNumber } = req.body;
        
        await this.azureComm.transferCall(callId, targetNumber);
        
        res.json({ success: true, message: 'Call transferred' });
      } catch (error: any) {
        logger.error({ error, callId: req.params.callId }, 'Failed to transfer call');
        res.status(500).json({ error: 'Failed to transfer call' });
      }
    });

    this.app.post('/calls/:callId/hangup', async (req, res) => {
      try {
        const { callId } = req.params;
        const { reason } = req.body;
        
        await this.azureComm.hangupCall(callId, reason);
        
        res.json({ success: true, message: 'Call hung up' });
      } catch (error: any) {
        logger.error({ error, callId: req.params.callId }, 'Failed to hang up call');
        res.status(500).json({ error: 'Failed to hang up call' });
      }
    });

    this.app.get('/calls/:callId/status', async (req, res) => {
      try {
        const { callId } = req.params;
        const connection = await this.azureComm.getCallConnection(callId);
        
        if (!connection) {
          return res.status(404).json({ error: 'Call not found' });
        }
        
        res.json({
          callId,
          callConnectionId: connection.callConnectionId,
          status: 'active'
        });
      } catch (error: any) {
        logger.error({ error, callId: req.params.callId }, 'Failed to get call status');
        res.status(500).json({ error: 'Failed to get call status' });
      }
    });

    // Routing statistics
    this.app.get('/routing/stats', async (req, res) => {
      try {
        const timeframe = req.query.timeframe as 'hour' | 'day' | 'week' || 'day';
        const stats = await this.callRouting.getRoutingStats(timeframe);
        res.json(stats);
      } catch (error: any) {
        logger.error({ error }, 'Failed to get routing stats');
        res.status(500).json({ error: 'Failed to get routing stats' });
      }
    });

    // Service info endpoint
    this.app.get('/', (req, res) => {
      res.json({
        service: 'Phone Gateway',
        version: '1.0.0',
        description: 'Phone gateway service for AI Answer Ninja',
        endpoints: {
          health: 'GET /health',
          metrics: 'GET /metrics',
          incomingCallWebhook: 'POST /webhook/incoming-call',
          azureEventsWebhook: 'POST /webhook/azure-events',
          answerCall: 'POST /calls/:callId/answer',
          transferCall: 'POST /calls/:callId/transfer',
          hangupCall: 'POST /calls/:callId/hangup',
          callStatus: 'GET /calls/:callId/status',
          routingStats: 'GET /routing/stats'
        }
      });
    });
  }

  private async handleIncomingCallWebhook(req: express.Request, res: express.Response): Promise<void> {
    const callEvent: IncomingCallEvent = {
      eventType: req.body.eventType || 'IncomingCall',
      from: req.body.from?.phoneNumber || req.body.from,
      to: req.body.to?.phoneNumber || req.body.to,
      callId: req.body.callId || req.body.incomingCallId,
      serverCallId: req.body.serverCallId,
      timestamp: req.body.timestamp || new Date().toISOString(),
      data: req.body
    };

    logger.info({ callEvent }, 'Incoming call webhook received');

    // Acknowledge webhook immediately
    res.status(200).json({ 
      status: 'received',
      callId: callEvent.callId
    });

    // Process call asynchronously
    this.processIncomingCall(callEvent).catch(error => {
      logger.error({ error, callEvent }, 'Failed to process incoming call');
    });
  }

  private async processIncomingCall(callEvent: IncomingCallEvent): Promise<void> {
    try {
      this.metrics.incrementCounter('incoming_calls_total');
      
      // Get routing decision
      const decision = await this.callRouting.routeCall(callEvent);
      
      logger.info({ 
        callId: callEvent.callId, 
        action: decision.action,
        reason: decision.reason
      }, 'Call routing decision made');

      // Execute routing decision
      switch (decision.action) {
        case 'transfer':
          await this.handleTransferCall(callEvent, decision);
          break;
        case 'ai_handle':
          await this.handleAICall(callEvent, decision);
          break;
        case 'reject':
          await this.handleRejectCall(callEvent, decision);
          break;
        default:
          logger.warn({ decision }, 'Unknown routing action');
          await this.handleAICall(callEvent, decision); // Default fallback
      }

    } catch (error: any) {
      logger.error({ error, callEvent }, 'Failed to process incoming call');
      this.metrics.incrementCounter('call_processing_errors_total');
    }
  }

  private async handleTransferCall(callEvent: IncomingCallEvent, decision: any): Promise<void> {
    try {
      if (!decision.targetNumber) {
        throw new Error('No target number provided for transfer');
      }

      await this.azureComm.transferCall(callEvent.callId, decision.targetNumber);
      
      this.metrics.incrementCounter('calls_transferred_total');
      logger.info({ 
        callId: callEvent.callId, 
        targetNumber: decision.targetNumber 
      }, 'Call transferred successfully');

    } catch (error: any) {
      logger.error({ error, callEvent, decision }, 'Failed to transfer call');
      
      // Fallback to AI handling
      await this.handleAICall(callEvent, {
        ...decision,
        action: 'ai_handle',
        reason: 'Transfer failed - fallback to AI'
      });
    }
  }

  private async handleAICall(callEvent: IncomingCallEvent, decision: any): Promise<void> {
    try {
      // Answer the call
      const callbackUri = `${process.env.PUBLIC_URL || 'http://localhost:3001'}/webhook/call-events`;
      const connection = await this.azureComm.answerCall(callEvent.callId, callbackUri);
      
      // Notify realtime processor to start AI handling
      await this.serviceClient.post('realtime-processor', '/start-ai-session', {
        callId: callEvent.callId,
        callConnectionId: connection.callConnectionId,
        callerPhone: callEvent.from,
        userMetadata: decision.metadata
      });
      
      this.metrics.incrementCounter('calls_ai_handled_total');
      logger.info({ 
        callId: callEvent.callId,
        callConnectionId: connection.callConnectionId
      }, 'AI call handling initiated');

    } catch (error: any) {
      logger.error({ error, callEvent, decision }, 'Failed to initiate AI handling');
      
      // Last resort - hang up
      await this.azureComm.hangupCall(callEvent.callId, 'AI handling failed');
    }
  }

  private async handleRejectCall(callEvent: IncomingCallEvent, decision: any): Promise<void> {
    try {
      // For rejection, we might answer and immediately hang up,
      // or let it ring out, depending on configuration
      await this.azureComm.hangupCall(callEvent.callId, decision.reason);
      
      this.metrics.incrementCounter('calls_rejected_total');
      logger.info({ 
        callId: callEvent.callId, 
        reason: decision.reason 
      }, 'Call rejected');

    } catch (error: any) {
      logger.error({ error, callEvent, decision }, 'Failed to reject call');
    }
  }

  private async handleAzureEventWebhook(req: express.Request, res: express.Response): Promise<void> {
    const events: AzureCommunicationEvent[] = req.body;
    
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'Expected array of events' });
    }

    // Acknowledge webhook immediately
    res.status(200).json({ status: 'received', eventCount: events.length });

    // Process events asynchronously
    for (const event of events) {
      try {
        await this.azureComm.handleEvent(event);
        logger.debug({ eventType: event.eventType }, 'Azure event processed');
      } catch (error: any) {
        logger.error({ error, event }, 'Failed to process Azure event');
      }
    }
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
      });
    });

    // Global error handler
    this.app.use((
      error: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      logger.error({
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        },
        request: {
          method: req.method,
          url: req.url,
          body: req.body
        }
      }, 'Unhandled error');

      if (error instanceof PhoneGatewayError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: config.server.environment === 'development' ? error.message : 'Something went wrong'
      });
    });

    // Process-level error handling
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      this.gracefulShutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled promise rejection');
      this.gracefulShutdown();
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, starting graceful shutdown');
      this.gracefulShutdown();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, starting graceful shutdown');
      this.gracefulShutdown();
    });
  }

  public async start(): Promise<void> {
    try {
      // Initialize services
      await this.database.connect();
      await this.serviceClient.initialize();
      await this.callQueue.initialize();
      await this.metrics.start();
      
      // Start HTTP server
      this.server.listen(config.server.port, config.server.host, () => {
        logger.info({
          port: config.server.port,
          host: config.server.host,
          environment: config.server.environment
        }, 'Phone Gateway Server started');
      });

      // Start health monitoring
      this.healthCheck.start();

    } catch (error) {
      logger.fatal({ error }, 'Failed to start server');
      process.exit(1);
    }
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown...');

    try {
      // Stop accepting new connections
      this.server.close(() => {
        logger.info('HTTP server closed');
      });

      // Cleanup Azure Communication Services
      await this.azureComm.cleanup();
      
      // Stop services
      await this.callQueue.cleanup();
      await this.metrics.stop();
      await this.database.disconnect();
      this.healthCheck.stop();

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  }
}

// Start the server
const server = new PhoneGatewayServer();

if (require.main === module) {
  server.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  });
}

export default server;