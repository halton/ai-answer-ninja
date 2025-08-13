import { Router } from 'express';
import { WebhookController } from '../controllers/WebhookController';
import { AzureCommunicationService } from '../services/AzureCommunicationService';
import { CallRecordingService } from '../services/CallRecordingService';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/auth';
import { validateWebhook } from '../middleware/webhookValidation';

export function createWebhookRoutes(
  communicationService: AzureCommunicationService,
  recordingService: CallRecordingService
): Router {
  const router = Router();
  const webhookController = new WebhookController(communicationService, recordingService);

  // Azure Communication Services webhook endpoint
  router.post(
    '/azure/events',
    validateWebhook,
    asyncHandler(async (req, res, next) => {
      await webhookController.handleAzureWebhook(req, res, next);
    })
  );

  // Event Grid validation endpoint
  router.post(
    '/eventgrid/validate',
    asyncHandler(async (req, res) => {
      await webhookController.handleEventGridValidation(req, res);
    })
  );

  // Media streaming webhook endpoint
  router.post(
    '/media-streaming/:callId',
    validateWebhook,
    asyncHandler(async (req, res) => {
      await webhookController.handleMediaStreamingWebhook(req, res);
    })
  );

  // Transcription webhook endpoint
  router.post(
    '/transcription/:callId',
    validateWebhook,
    asyncHandler(async (req, res) => {
      await webhookController.handleTranscriptionWebhook(req, res);
    })
  );

  // Webhook metrics endpoints
  router.get(
    '/metrics',
    authenticate,
    asyncHandler(async (req, res) => {
      await webhookController.getWebhookMetrics(req, res);
    })
  );

  router.post(
    '/metrics/reset',
    authenticate,
    asyncHandler(async (req, res) => {
      await webhookController.resetWebhookMetrics(req, res);
    })
  );

  // Test webhook endpoint (development only)
  if (process.env.NODE_ENV !== 'production') {
    router.post(
      '/test',
      authenticate,
      asyncHandler(async (req, res) => {
        await webhookController.testWebhook(req, res);
      })
    );
  }

  return router;
}

// Export middleware creators
export function asyncHandler(fn: Function) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}