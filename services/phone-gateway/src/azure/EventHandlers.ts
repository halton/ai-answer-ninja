import { EventGridClient, EventGridEvent } from '@azure/eventgrid';
import { EventProcessor } from '@azure/event-hubs';
import logger from '../utils/logger';
import config from '../config';
import { AzureCommunicationEvent, CallState, CallMetrics } from '../types';
import { AzureCommunicationService } from '../services/AzureCommunicationService';
import { CallRecordingService } from '../services/CallRecordingService';
import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface EventHandlerOptions {
  communicationService: AzureCommunicationService;
  recordingService: CallRecordingService;
  validateSignature?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface EventProcessingResult {
  success: boolean;
  eventId: string;
  eventType: string;
  processingTime: number;
  error?: string;
}

export interface EventMetrics {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  averageProcessingTime: number;
  eventTypeDistribution: Map<string, number>;
}

/**
 * Azure Event Handlers for processing Communication Services events
 */
export class AzureEventHandlers extends EventEmitter {
  private communicationService: AzureCommunicationService;
  private recordingService: CallRecordingService;
  private eventGridClient: EventGridClient;
  private eventMetrics: EventMetrics;
  private eventProcessors: Map<string, Function>;
  private webhookSecret: string;
  private validateSignature: boolean;
  private retryAttempts: number;
  private retryDelay: number;

  constructor(options: EventHandlerOptions) {
    super();
    
    this.communicationService = options.communicationService;
    this.recordingService = options.recordingService;
    this.validateSignature = options.validateSignature ?? true;
    this.retryAttempts = options.retryAttempts ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;

    // Initialize Event Grid client
    this.eventGridClient = new EventGridClient(
      config.azure.eventGrid.endpoint,
      'EventGrid',
      { key: config.azure.eventGrid.accessKey }
    );

    // Initialize metrics
    this.eventMetrics = {
      totalEvents: 0,
      successfulEvents: 0,
      failedEvents: 0,
      averageProcessingTime: 0,
      eventTypeDistribution: new Map()
    };

    // Register event processors
    this.eventProcessors = new Map([
      ['Microsoft.Communication.IncomingCall', this.handleIncomingCall.bind(this)],
      ['Microsoft.Communication.CallConnected', this.handleCallConnected.bind(this)],
      ['Microsoft.Communication.CallDisconnected', this.handleCallDisconnected.bind(this)],
      ['Microsoft.Communication.CallTransferAccepted', this.handleCallTransferAccepted.bind(this)],
      ['Microsoft.Communication.CallTransferFailed', this.handleCallTransferFailed.bind(this)],
      ['Microsoft.Communication.RecordingFileStatusUpdated', this.handleRecordingStatusUpdated.bind(this)],
      ['Microsoft.Communication.TranscriptionUpdated', this.handleTranscriptionUpdated.bind(this)],
      ['Microsoft.Communication.PlayCompleted', this.handlePlayCompleted.bind(this)],
      ['Microsoft.Communication.PlayFailed', this.handlePlayFailed.bind(this)],
      ['Microsoft.Communication.ParticipantsUpdated', this.handleParticipantsUpdated.bind(this)],
      ['Microsoft.Communication.DtmfReceived', this.handleDtmfReceived.bind(this)]
    ]);

    this.webhookSecret = config.azure.communicationServices.webhookSecret || '';

    logger.info('Azure Event Handlers initialized');
  }

  /**
   * Process incoming webhook event
   */
  async processWebhookEvent(
    body: string | any,
    headers: Record<string, string>
  ): Promise<EventProcessingResult[]> {
    const startTime = Date.now();
    const results: EventProcessingResult[] = [];

    try {
      // Validate webhook signature if enabled
      if (this.validateSignature && this.webhookSecret) {
        const signature = headers['x-azure-signature'] || headers['X-Azure-Signature'];
        if (!this.validateWebhookSignature(body, signature)) {
          throw new Error('Invalid webhook signature');
        }
      }

      // Parse events
      const events = this.parseEvents(body);
      logger.info({ eventCount: events.length }, 'Processing webhook events');

      // Process each event
      for (const event of events) {
        const result = await this.processEvent(event);
        results.push(result);
      }

      // Update metrics
      this.updateMetrics(results, Date.now() - startTime);

      return results;
    } catch (error) {
      logger.error({ error, body }, 'Failed to process webhook event');
      throw error;
    }
  }

  /**
   * Process a single event
   */
  private async processEvent(event: AzureCommunicationEvent): Promise<EventProcessingResult> {
    const startTime = Date.now();
    const eventType = event.eventType;
    const eventId = event.id;

    try {
      logger.debug({ eventId, eventType }, 'Processing event');

      // Get appropriate processor
      const processor = this.eventProcessors.get(eventType);
      if (!processor) {
        logger.warn({ eventType }, 'No processor found for event type');
        return {
          success: false,
          eventId,
          eventType,
          processingTime: Date.now() - startTime,
          error: 'No processor found'
        };
      }

      // Process with retry logic
      await this.executeWithRetry(async () => await processor(event));

      logger.debug({ eventId, eventType }, 'Event processed successfully');

      return {
        success: true,
        eventId,
        eventType,
        processingTime: Date.now() - startTime
      };
    } catch (error: any) {
      logger.error({ error, eventId, eventType }, 'Failed to process event');
      
      return {
        success: false,
        eventId,
        eventType,
        processingTime: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Handle incoming call event
   */
  private async handleIncomingCall(event: AzureCommunicationEvent): Promise<void> {
    const { incomingCallContext, from, to, correlationId } = event.data;
    
    logger.info({ from, to, correlationId }, 'Handling incoming call event');

    // Emit event for the main application to handle
    this.emit('incomingCall', {
      callContext: incomingCallContext,
      from,
      to,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle call connected event
   */
  private async handleCallConnected(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, serverCallId, correlationId } = event.data;
    
    logger.info({ callConnectionId, serverCallId }, 'Call connected');

    // Update call state
    const callState: Partial<CallState> = {
      status: 'connected',
      connectionId: callConnectionId
    };

    // Emit event
    this.emit('callConnected', {
      callConnectionId,
      serverCallId,
      correlationId,
      timestamp: new Date(event.eventTime)
    });

    // Start quality monitoring
    this.startQualityMonitoring(serverCallId);
  }

  /**
   * Handle call disconnected event
   */
  private async handleCallDisconnected(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, serverCallId, correlationId } = event.data;
    
    logger.info({ callConnectionId, serverCallId }, 'Call disconnected');

    // Stop quality monitoring
    this.stopQualityMonitoring(serverCallId);

    // Emit event
    this.emit('callDisconnected', {
      callConnectionId,
      serverCallId,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle call transfer accepted event
   */
  private async handleCallTransferAccepted(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, transferTarget, correlationId } = event.data;
    
    logger.info({ callConnectionId, transferTarget }, 'Call transfer accepted');

    this.emit('callTransferAccepted', {
      callConnectionId,
      transferTarget,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle call transfer failed event
   */
  private async handleCallTransferFailed(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, resultInformation, correlationId } = event.data;
    
    logger.warn({ 
      callConnectionId, 
      resultInformation 
    }, 'Call transfer failed');

    this.emit('callTransferFailed', {
      callConnectionId,
      resultInformation,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle recording status updated event
   */
  private async handleRecordingStatusUpdated(event: AzureCommunicationEvent): Promise<void> {
    const { 
      recordingId, 
      recordingStatus, 
      recordingLocation,
      recordingDuration,
      recordingSize,
      correlationId 
    } = event.data;
    
    logger.info({ 
      recordingId, 
      recordingStatus 
    }, 'Recording status updated');

    if (recordingStatus === 'completed' && recordingLocation) {
      // Process completed recording
      await this.recordingService.processCompletedRecording(
        recordingId,
        recordingLocation,
        recordingSize
      );
    }

    this.emit('recordingStatusUpdated', {
      recordingId,
      recordingStatus,
      recordingLocation,
      recordingDuration,
      recordingSize,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle transcription updated event
   */
  private async handleTranscriptionUpdated(event: AzureCommunicationEvent): Promise<void> {
    const { 
      transcriptionId,
      transcriptionStatus,
      transcriptionResult,
      correlationId 
    } = event.data;
    
    logger.info({ 
      transcriptionId, 
      transcriptionStatus 
    }, 'Transcription updated');

    this.emit('transcriptionUpdated', {
      transcriptionId,
      transcriptionStatus,
      transcriptionResult,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle play completed event
   */
  private async handlePlayCompleted(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, playId, correlationId } = event.data;
    
    logger.debug({ callConnectionId, playId }, 'Play completed');

    this.emit('playCompleted', {
      callConnectionId,
      playId,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle play failed event
   */
  private async handlePlayFailed(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, playId, resultInformation, correlationId } = event.data;
    
    logger.warn({ 
      callConnectionId, 
      playId, 
      resultInformation 
    }, 'Play failed');

    this.emit('playFailed', {
      callConnectionId,
      playId,
      resultInformation,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle participants updated event
   */
  private async handleParticipantsUpdated(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, participants, correlationId } = event.data;
    
    logger.info({ 
      callConnectionId, 
      participantCount: participants.length 
    }, 'Participants updated');

    this.emit('participantsUpdated', {
      callConnectionId,
      participants,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Handle DTMF received event
   */
  private async handleDtmfReceived(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, dtmfTones, participant, correlationId } = event.data;
    
    logger.info({ 
      callConnectionId, 
      dtmfTones 
    }, 'DTMF tones received');

    this.emit('dtmfReceived', {
      callConnectionId,
      dtmfTones,
      participant,
      correlationId,
      timestamp: new Date(event.eventTime)
    });
  }

  /**
   * Validate webhook signature
   */
  private validateWebhookSignature(body: string, signature: string): boolean {
    if (!this.webhookSecret) {
      return true; // Skip validation if no secret configured
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('base64');

    return signature === `sha256=${expectedSignature}`;
  }

  /**
   * Parse events from webhook body
   */
  private parseEvents(body: string | any): AzureCommunicationEvent[] {
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    // Handle both single event and array of events
    if (Array.isArray(body)) {
      return body;
    } else if (body.value && Array.isArray(body.value)) {
      return body.value;
    } else {
      return [body];
    }
  }

  /**
   * Execute function with retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    attempts: number = this.retryAttempts
  ): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) {
          throw error;
        }
        
        logger.warn({ 
          attempt: i + 1, 
          maxAttempts: attempts,
          error 
        }, 'Retrying operation');
        
        await this.delay(this.retryDelay * Math.pow(2, i)); // Exponential backoff
      }
    }
    
    throw new Error('Max retry attempts reached');
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start quality monitoring for a call
   */
  private startQualityMonitoring(serverCallId: string): void {
    // Implementation for quality monitoring
    logger.debug({ serverCallId }, 'Starting quality monitoring');
    
    // Set up periodic quality checks
    const intervalId = setInterval(async () => {
      try {
        // Collect and emit quality metrics
        const metrics = await this.collectQualityMetrics(serverCallId);
        this.emit('qualityMetrics', {
          serverCallId,
          metrics,
          timestamp: new Date()
        });
      } catch (error) {
        logger.error({ error, serverCallId }, 'Failed to collect quality metrics');
      }
    }, 5000); // Every 5 seconds

    // Store interval ID for cleanup
    this.qualityMonitoringIntervals.set(serverCallId, intervalId);
  }

  /**
   * Stop quality monitoring for a call
   */
  private stopQualityMonitoring(serverCallId: string): void {
    const intervalId = this.qualityMonitoringIntervals.get(serverCallId);
    if (intervalId) {
      clearInterval(intervalId);
      this.qualityMonitoringIntervals.delete(serverCallId);
      logger.debug({ serverCallId }, 'Stopped quality monitoring');
    }
  }

  /**
   * Collect quality metrics for a call
   */
  private async collectQualityMetrics(serverCallId: string): Promise<CallMetrics> {
    // Placeholder for actual metrics collection
    return {
      callId: serverCallId,
      startTime: Date.now(),
      audioPacketsReceived: Math.floor(Math.random() * 10000),
      audioPacketsSent: Math.floor(Math.random() * 10000),
      audioQuality: 0.85 + Math.random() * 0.15,
      latency: 20 + Math.random() * 30,
      jitter: 5 + Math.random() * 10,
      packetLoss: Math.random() * 2
    };
  }

  /**
   * Update event metrics
   */
  private updateMetrics(results: EventProcessingResult[], totalProcessingTime: number): void {
    this.eventMetrics.totalEvents += results.length;
    
    for (const result of results) {
      if (result.success) {
        this.eventMetrics.successfulEvents++;
      } else {
        this.eventMetrics.failedEvents++;
      }

      // Update event type distribution
      const count = this.eventMetrics.eventTypeDistribution.get(result.eventType) || 0;
      this.eventMetrics.eventTypeDistribution.set(result.eventType, count + 1);
    }

    // Update average processing time
    const currentAverage = this.eventMetrics.averageProcessingTime;
    const currentTotal = this.eventMetrics.totalEvents - results.length;
    this.eventMetrics.averageProcessingTime = 
      (currentAverage * currentTotal + totalProcessingTime) / this.eventMetrics.totalEvents;
  }

  /**
   * Get event metrics
   */
  getMetrics(): EventMetrics {
    return { ...this.eventMetrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.eventMetrics = {
      totalEvents: 0,
      successfulEvents: 0,
      failedEvents: 0,
      averageProcessingTime: 0,
      eventTypeDistribution: new Map()
    };
  }

  /**
   * Publish custom event to Event Grid
   */
  async publishEvent(eventType: string, data: any): Promise<void> {
    try {
      const event: EventGridEvent = {
        id: crypto.randomUUID(),
        eventType: `PhoneGateway.${eventType}`,
        subject: 'phone-gateway',
        eventTime: new Date(),
        data,
        dataVersion: '1.0'
      };

      await this.eventGridClient.publishEvents(
        config.azure.eventGrid.topicName || 'phone-gateway-events',
        [event]
      );

      logger.debug({ eventType, eventId: event.id }, 'Published event to Event Grid');
    } catch (error) {
      logger.error({ error, eventType }, 'Failed to publish event');
      throw error;
    }
  }

  private qualityMonitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure Event Handlers');

    // Stop all quality monitoring
    for (const [serverCallId, intervalId] of this.qualityMonitoringIntervals.entries()) {
      clearInterval(intervalId);
    }
    this.qualityMonitoringIntervals.clear();

    logger.info('Azure Event Handlers cleanup completed');
  }
}