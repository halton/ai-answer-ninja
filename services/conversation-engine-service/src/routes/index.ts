import { Router } from 'express';
import { ConversationController } from '../controllers/ConversationController';
import { asyncHandler } from '../middleware/asyncHandler';
import { auth } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { conversationSchemas } from '../schemas/conversationSchemas';

const router = Router();
const conversationController = new ConversationController();

// Conversation management endpoints
router.post('/conversation/manage',
  auth,
  validateRequest(conversationSchemas.manageConversation),
  asyncHandler(conversationController.manageConversation)
);

router.post('/conversation/personalize',
  auth,
  validateRequest(conversationSchemas.personalizeResponse),
  asyncHandler(conversationController.personalizeResponse)
);

router.post('/conversation/emotion',
  auth,
  validateRequest(conversationSchemas.analyzeEmotion),
  asyncHandler(conversationController.analyzeEmotion)
);

router.post('/conversation/terminate',
  auth,
  validateRequest(conversationSchemas.terminateDecision),
  asyncHandler(conversationController.shouldTerminate)
);

router.get('/conversation/history/:callId',
  auth,
  asyncHandler(conversationController.getConversationHistory)
);

// Context management
router.post('/context/update',
  auth,
  validateRequest(conversationSchemas.updateContext),
  asyncHandler(conversationController.updateContext)
);

router.get('/context/:callId',
  auth,
  asyncHandler(conversationController.getContext)
);

// Response generation
router.post('/response/generate',
  auth,
  validateRequest(conversationSchemas.generateResponse),
  asyncHandler(conversationController.generateResponse)
);

router.post('/response/evaluate',
  auth,
  validateRequest(conversationSchemas.evaluateResponse),
  asyncHandler(conversationController.evaluateResponse)
);

// Health check endpoint
router.get('/health', asyncHandler(conversationController.healthCheck));

export { router as conversationEngineRoutes };