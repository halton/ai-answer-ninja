import { Router } from 'express';
import { PhoneGatewayController } from '../controllers/PhoneGatewayController';
import { asyncHandler } from '../middleware/asyncHandler';
import { auth } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { webhookValidation } from '../middleware/webhookValidation';

const router = Router();
const phoneGatewayController = new PhoneGatewayController();

// Public webhook endpoints (no auth required)
router.post('/webhook/incoming-call', 
  rateLimiter,
  webhookValidation,
  asyncHandler(phoneGatewayController.handleIncomingCall)
);

// Protected call management endpoints
router.post('/calls/:callId/answer', 
  auth,
  asyncHandler(phoneGatewayController.answerCall)
);

router.post('/calls/:callId/transfer', 
  auth,
  asyncHandler(phoneGatewayController.transferCall)
);

router.get('/calls/:callId/status', 
  auth,
  asyncHandler(phoneGatewayController.getCallStatus)
);

router.post('/calls/:callId/hangup', 
  auth,
  asyncHandler(phoneGatewayController.hangupCall)
);

router.post('/calls/:callId/filter', 
  auth,
  asyncHandler(phoneGatewayController.filterCall)
);

// Health check endpoint
router.get('/health', asyncHandler(phoneGatewayController.healthCheck));

export { router as phoneGatewayRoutes };