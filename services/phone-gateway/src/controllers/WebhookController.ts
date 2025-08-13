import { Request, Response, NextFunction } from 'express';
import { AzureEventHandlers } from '../azure/EventHandlers';
import { AzureCommunicationService } from '../services/AzureCommunicationService';
import { CallRecordingService } from '../services/CallRecordingService';
import logger from '../utils/logger';
import { AzureCommunicationEvent } from '../types';

export class WebhookController {
  private eventHandlers: AzureEventHandlers;
  private communicationService: AzureCommunicationService;
  private recordingService: CallRecordingService;

  constructor(
    communicationService: AzureCommunicationService,
    recordingService: CallRecordingService
  ) {
    this.communicationService = communicationService;
    this.recordingService = recordingService;
    
    this.eventHandlers = new AzureEventHandlers({
      communicationService,
      recordingService,
      validateSignature: true,
      retryAttempts: 3,
      retryDelay: 1000
    });

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for Azure events
   */
  private setupEventListeners(): void {
    // Handle incoming call events
    this.eventHandlers.on('incomingCall', async (data) => {
      logger.info({ data }, 'Incoming call event received');
      // Handle incoming call logic here
    });

    // Handle call connected events
    this.eventHandlers.on('callConnected', async (data) => {
      logger.info({ data }, 'Call connected event received');
      // Update call state, start monitoring, etc.
    });

    // Handle call disconnected events
    this.eventHandlers.on('callDisconnected', async (data) => {
      logger.info({ data }, 'Call disconnected event received');
      // Clean up resources, save call record, etc.
    });

    // Handle recording status updates
    this.eventHandlers.on('recordingStatusUpdated', async (data) => {
      logger.info({ data }, 'Recording status updated');
      // Process recording completion, update database, etc.
    });

    // Handle transcription updates
    this.eventHandlers.on('transcriptionUpdated', async (data) => {
      logger.info({ data }, 'Transcription updated');
      // Process transcription results
    });

    // Handle quality metrics
    this.eventHandlers.on('qualityMetrics', async (data) => {
      logger.debug({ data }, 'Quality metrics received');
      // Store or process quality metrics
    });
  }

  /**
   * Handle Azure Communication Services webhook
   */
  async handleAzureWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const startTime = Date.now();
      
      logger.info({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodySize: JSON.stringify(req.body).length
      }, 'Received Azure webhook');

      // Process the webhook events
      const results = await this.eventHandlers.processWebhookEvent(
        req.body,
        req.headers as Record<string, string>
      );

      // Log processing results
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      logger.info({
        totalEvents: results.length,
        successCount,
        failureCount,
        processingTime: Date.now() - startTime
      }, 'Webhook processing completed');

      // Return response
      res.status(200).json({
        success: true,
        processed: results.length,
        successful: successCount,
        failed: failureCount,
        results: results.map(r => ({
          eventId: r.eventId,
          eventType: r.eventType,
          success: r.success,
          error: r.error
        }))
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to process Azure webhook');
      
      if (error.message === 'Invalid webhook signature') {
        res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid signature'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  }

  /**
   * Handle Event Grid validation
   */
  async handleEventGridValidation(req: Request, res: Response): Promise<void> {
    try {
      const events = Array.isArray(req.body) ? req.body : [req.body];
      
      for (const event of events) {
        // Check if this is a validation event
        if (event.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
          const validationCode = event.data.validationCode;
          
          logger.info({ validationCode }, 'Event Grid validation request received');
          
          res.status(200).json({
            validationResponse: validationCode
          });
          return;
        }
      }

      // Not a validation event, process normally
      await this.handleAzureWebhook(req, res, () => {});
    } catch (error) {
      logger.error({ error }, 'Failed to handle Event Grid validation');
      res.status(500).json({
        success: false,
        error: 'Validation failed'
      });
    }
  }

  /**
   * Handle media streaming webhook
   */
  async handleMediaStreamingWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { callId } = req.params;
      const mediaData = req.body;

      logger.debug({ 
        callId, 
        dataSize: mediaData.length 
      }, 'Received media streaming data');

      // Process media streaming data
      // This would typically be forwarded to the real-time processor service

      res.status(200).json({
        success: true,
        message: 'Media data received'
      });
    } catch (error) {
      logger.error({ error }, 'Failed to process media streaming webhook');
      res.status(500).json({
        success: false,
        error: 'Failed to process media data'
      });
    }
  }

  /**
   * Handle transcription webhook
   */
  async handleTranscriptionWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { callId } = req.params;
      const transcriptionData = req.body;

      logger.info({ 
        callId, 
        transcriptionSegments: transcriptionData.segments?.length 
      }, 'Received transcription data');

      // Process transcription data
      // Store in database, forward to analytics, etc.

      res.status(200).json({
        success: true,
        message: 'Transcription data received'
      });
    } catch (error) {
      logger.error({ error }, 'Failed to process transcription webhook');
      res.status(500).json({
        success: false,
        error: 'Failed to process transcription data'
      });
    }
  }

  /**
   * Get webhook metrics
   */
  async getWebhookMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = this.eventHandlers.getMetrics();
      
      res.status(200).json({
        success: true,
        metrics: {
          totalEvents: metrics.totalEvents,
          successfulEvents: metrics.successfulEvents,
          failedEvents: metrics.failedEvents,
          successRate: metrics.totalEvents > 0 
            ? (metrics.successfulEvents / metrics.totalEvents * 100).toFixed(2) + '%'
            : '0%',
          averageProcessingTime: metrics.averageProcessingTime.toFixed(2) + 'ms',
          eventTypeDistribution: Array.from(metrics.eventTypeDistribution.entries()).map(
            ([type, count]) => ({ type, count })
          )
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get webhook metrics');
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics'
      });
    }
  }

  /**
   * Reset webhook metrics
   */
  async resetWebhookMetrics(req: Request, res: Response): Promise<void> {
    try {
      this.eventHandlers.resetMetrics();
      
      res.status(200).json({
        success: true,
        message: 'Metrics reset successfully'
      });
    } catch (error) {
      logger.error({ error }, 'Failed to reset webhook metrics');
      res.status(500).json({
        success: false,
        error: 'Failed to reset metrics'
      });
    }
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(req: Request, res: Response): Promise<void> {
    try {
      const testEvent: AzureCommunicationEvent = {
        id: 'test-' + Date.now(),
        topic: 'test',
        subject: 'test',
        eventType: 'Test.Event',
        eventTime: new Date().toISOString(),
        data: {
          message: 'This is a test event',
          timestamp: Date.now()
        },
        dataVersion: '1.0',
        metadataVersion: '1'
      };

      const results = await this.eventHandlers.processWebhookEvent(
        [testEvent],
        {}
      );

      res.status(200).json({
        success: true,
        message: 'Test webhook processed successfully',
        results
      });
    } catch (error) {
      logger.error({ error }, 'Failed to process test webhook');
      res.status(500).json({
        success: false,
        error: 'Test webhook failed'
      });
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.eventHandlers.cleanup();
  }
}