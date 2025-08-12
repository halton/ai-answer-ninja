import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PhoneGatewayController } from './controllers/PhoneGatewayController';
import { CallRoutingService } from './services/CallRoutingService';
import { AzureCommunicationService } from './services/AzureCommunicationService';
import { CallFilteringService } from './services/CallFilteringService';
import { WebRTCService } from './services/WebRTCService';
import { errorHandler } from '@shared/middleware/errorHandler';
import { requestLogger } from '@shared/middleware/requestLogger';
import { authMiddleware } from '@shared/middleware/authMiddleware';
import { logger } from '@shared/utils/logger';
import { PhoneDatabase } from './database/PhoneDatabase';
import { SmartWhitelistServiceClient } from '@shared/service-communication/clients/SmartWhitelistServiceClient';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

const PORT = process.env.PHONE_GATEWAY_PORT || 3001;

async function initialize() {
  try {
    const db = new PhoneDatabase();
    await db.initialize();

    const whitelistClient = new SmartWhitelistServiceClient();
    const azureService = new AzureCommunicationService();
    const routingService = new CallRoutingService(db, whitelistClient);
    const filteringService = new CallFilteringService(db, whitelistClient);
    const webrtcService = new WebRTCService(io);

    const controller = new PhoneGatewayController(
      azureService,
      routingService,
      filteringService,
      webrtcService
    );

    app.use(helmet());
    app.use(cors());
    app.use(express.json());
    app.use(requestLogger);

    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'phone-gateway', timestamp: new Date() });
    });

    app.post('/webhook/incoming-call', controller.handleIncomingCall.bind(controller));
    app.post('/calls/:callId/answer', authMiddleware, controller.answerCall.bind(controller));
    app.post('/calls/:callId/transfer', authMiddleware, controller.transferCall.bind(controller));
    app.get('/calls/:callId/status', authMiddleware, controller.getCallStatus.bind(controller));
    app.post('/calls/:callId/hangup', authMiddleware, controller.hangupCall.bind(controller));
    app.post('/calls/:callId/filter', authMiddleware, controller.filterCall.bind(controller));
    app.post('/calls/:callId/record', authMiddleware, controller.startRecording.bind(controller));
    app.post('/calls/:callId/stop-record', authMiddleware, controller.stopRecording.bind(controller));

    app.use(errorHandler);

    webrtcService.initialize();

    server.listen(PORT, () => {
      logger.info(`Phone Gateway Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Phone Gateway Service:', error);
    process.exit(1);
  }
}

initialize();