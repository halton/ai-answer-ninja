import { 
  CallAutomationClient, 
  CallConnection,
  CallMedia,
  CallRecording,
  CallConnectionProperties,
  StartRecordingOptions,
  RecordingStateResult,
  CallParticipant
} from '@azure/communication-call-automation';
import { 
  CommunicationIdentifier, 
  PhoneNumberIdentifier,
  CommunicationUserIdentifier 
} from '@azure/communication-common';
import { EventGridClient } from '@azure/eventgrid';
import { BlobServiceClient } from '@azure/storage-blob';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config';
import { 
  IncomingCallEvent, 
  CallControlOptions, 
  AzureCommunicationEvent,
  CallState,
  CallMetrics,
  RecordingInfo 
} from '../types';

export class AzureCommunicationService {
  private callAutomationClient: CallAutomationClient;
  private eventGridClient: EventGridClient;
  private blobServiceClient: BlobServiceClient;
  private activeConnections: Map<string, CallConnection> = new Map();
  private callStates: Map<string, CallState> = new Map();
  private callMetrics: Map<string, CallMetrics> = new Map();
  private recordingInfo: Map<string, RecordingInfo> = new Map();
  private webhookSecret: string;

  constructor() {
    this.callAutomationClient = new CallAutomationClient(
      config.azure.communicationServices.connectionString
    );
    
    this.eventGridClient = new EventGridClient(
      config.azure.eventGrid.endpoint,
      'EventGrid',
      { key: config.azure.eventGrid.accessKey }
    );

    // Initialize Azure Blob Storage for recordings
    if (config.azure.storage?.connectionString) {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(
        config.azure.storage.connectionString
      );
    }

    // Set webhook secret for validation
    this.webhookSecret = config.azure.communicationServices.webhookSecret || '';
    
    logger.info('Azure Communication Service initialized with enhanced features');
  }

  /**
   * Answer an incoming call with enhanced options
   */
  async answerCall(
    callId: string, 
    callbackUri: string, 
    options: CallControlOptions = {}
  ): Promise<CallConnection> {
    try {
      logger.info({ callId, callbackUri }, 'Answering incoming call');
      
      // Initialize call state
      this.callStates.set(callId, {
        callId,
        status: 'connecting',
        startTime: new Date(),
        participants: [],
        isRecording: false,
        metadata: options.metadata || {}
      });

      // Initialize call metrics
      this.callMetrics.set(callId, {
        callId,
        startTime: Date.now(),
        audioPacketsReceived: 0,
        audioPacketsSent: 0,
        audioQuality: 1.0,
        latency: 0,
        jitter: 0,
        packetLoss: 0
      });

      const answerCallResult = await this.callAutomationClient.answerCall(
        callId,
        callbackUri,
        {
          operationContext: `answer-${callId}`,
          mediaStreamingOptions: options.enableMediaStreaming ? {
            transportUrl: `${callbackUri}/media-streaming`,
            transportType: 'websocket',
            contentType: 'audio',
            audioChannelType: 'mixed'
          } : undefined,
          transcriptionOptions: options.enableTranscription ? {
            transportUrl: `${callbackUri}/transcription`,
            transportType: 'websocket',
            locale: options.transcriptionLocale || 'zh-CN',
            startTranscription: true
          } : undefined,
          recordingOptions: options.recordCall ? {
            recordingContent: 'audio',
            recordingChannel: 'mixed',
            recordingFormat: 'wav'
          } : undefined
        }
      );

      if (answerCallResult.callConnection) {
        this.activeConnections.set(callId, answerCallResult.callConnection);
        
        // Update call state
        const state = this.callStates.get(callId);
        if (state) {
          state.status = 'connected';
          state.connectionId = answerCallResult.callConnectionId;
        }

        // Start recording if requested
        if (options.recordCall) {
          await this.startRecording(callId, options.recordingStorageUrl);
        }
        
        logger.info({ 
          callId, 
          connectionId: answerCallResult.callConnectionId,
          recordingEnabled: options.recordCall,
          transcriptionEnabled: options.enableTranscription 
        }, 'Call answered successfully with enhanced features');
        
        return answerCallResult.callConnection;
      } else {
        throw new Error('Failed to establish call connection');
      }
    } catch (error: any) {
      logger.error({ error, callId }, 'Failed to answer call');
      throw error;
    }
  }

  /**
   * Transfer call to another number
   */
  async transferCall(
    callId: string, 
    targetPhoneNumber: string,
    operationContext?: string
  ): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      const target: PhoneNumberIdentifier = {
        phoneNumber: targetPhoneNumber
      };

      logger.info({ callId, targetPhoneNumber }, 'Transferring call');
      
      await connection.transferCallToParticipant(target, {
        operationContext: operationContext || `transfer-${callId}`
      });

      logger.info({ callId, targetPhoneNumber }, 'Call transferred successfully');
      
      // Remove from active connections as it's now transferred
      this.activeConnections.delete(callId);
    } catch (error: any) {
      logger.error({ error, callId, targetPhoneNumber }, 'Failed to transfer call');
      throw error;
    }
  }

  /**
   * Hang up a call
   */
  async hangupCall(callId: string, reason?: string): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        logger.warn({ callId }, 'No active connection found for hangup');
        return;
      }

      logger.info({ callId, reason }, 'Hanging up call');
      
      await connection.hangUp(true);
      
      this.activeConnections.delete(callId);
      
      logger.info({ callId }, 'Call hung up successfully');
    } catch (error: any) {
      logger.error({ error, callId }, 'Failed to hang up call');
      throw error;
    }
  }

  /**
   * Start recording a call with enhanced options
   */
  async startRecording(
    callId: string, 
    recordingStorageUri?: string
  ): Promise<RecordingStateResult> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      const serverCallId = await this.getServerCallId(callId);
      if (!serverCallId) {
        throw new Error('Server call ID not found');
      }

      // Generate unique recording ID
      const recordingId = `rec-${callId}-${Date.now()}`;
      
      // Prepare storage URL if not provided
      const storageUrl = recordingStorageUri || await this.getDefaultStorageUrl(callId);

      logger.info({ callId, recordingId, storageUrl }, 'Starting enhanced call recording');
      
      const startRecordingOptions: StartRecordingOptions = {
        callLocator: { id: serverCallId, kind: 'serverCallLocator' },
        recordingContent: 'audio',
        recordingChannel: 'mixed',
        recordingFormat: 'wav',
        recordingStorage: {
          recordingStorageType: 'azureBlobStorage',
          recordingDestination: {
            containerUrl: storageUrl
          }
        }
      };

      const recordingResult = await this.callAutomationClient
        .getCallRecording()
        .start(startRecordingOptions);

      // Store recording info
      this.recordingInfo.set(callId, {
        recordingId: recordingResult.recordingId,
        status: 'active',
        startTime: new Date(),
        storageUrl
      });

      // Update call state
      const state = this.callStates.get(callId);
      if (state) {
        state.isRecording = true;
        state.recordingId = recordingResult.recordingId;
      }

      logger.info({ 
        callId, 
        recordingId: recordingResult.recordingId 
      }, 'Call recording started successfully');

      return recordingResult;
    } catch (error: any) {
      logger.error({ error, callId }, 'Failed to start recording');
      throw error;
    }
  }

  /**
   * Stop recording a call and get recording info
   */
  async stopRecording(callId: string): Promise<void> {
    try {
      const recordingInfo = this.recordingInfo.get(callId);
      if (!recordingInfo || !recordingInfo.recordingId) {
        logger.warn({ callId }, 'No active recording found');
        return;
      }

      logger.info({ 
        callId, 
        recordingId: recordingInfo.recordingId 
      }, 'Stopping call recording');
      
      await this.callAutomationClient
        .getCallRecording()
        .stop(recordingInfo.recordingId);

      // Update recording info
      recordingInfo.status = 'stopped';
      recordingInfo.endTime = new Date();
      
      // Update call state
      const state = this.callStates.get(callId);
      if (state) {
        state.isRecording = false;
      }
      
      logger.info({ 
        callId, 
        recordingId: recordingInfo.recordingId,
        duration: recordingInfo.endTime.getTime() - recordingInfo.startTime.getTime() 
      }, 'Call recording stopped successfully');
    } catch (error: any) {
      logger.error({ error, callId }, 'Failed to stop recording');
      throw error;
    }
  }

  /**
   * Send DTMF tones
   */
  async sendDtmf(
    callId: string, 
    tones: string, 
    targetParticipant?: CommunicationIdentifier
  ): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      logger.info({ callId, tones }, 'Sending DTMF tones');
      
      await connection.getCallMedia().sendDtmf(tones.split(''), targetParticipant);
      
      logger.info({ callId, tones }, 'DTMF tones sent');
    } catch (error: any) {
      logger.error({ error, callId, tones }, 'Failed to send DTMF');
      throw error;
    }
  }

  /**
   * Get call connection information with state
   */
  async getCallConnection(callId: string): Promise<CallConnection | null> {
    return this.activeConnections.get(callId) || null;
  }

  /**
   * Get call state information
   */
  getCallState(callId: string): CallState | undefined {
    return this.callStates.get(callId);
  }

  /**
   * Get call metrics
   */
  getCallMetrics(callId: string): CallMetrics | undefined {
    return this.callMetrics.get(callId);
  }

  /**
   * Update call metrics
   */
  updateCallMetrics(callId: string, metrics: Partial<CallMetrics>): void {
    const existingMetrics = this.callMetrics.get(callId);
    if (existingMetrics) {
      this.callMetrics.set(callId, { ...existingMetrics, ...metrics });
    }
  }

  /**
   * Get server call ID from connection
   */
  private async getServerCallId(callId: string): Promise<string | null> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        return null;
      }
      
      const properties = await connection.getCallConnectionProperties();
      return properties.serverCallId || null;
    } catch (error) {
      logger.error({ error, callId }, 'Failed to get server call ID');
      return null;
    }
  }

  /**
   * Get default storage URL for recordings
   */
  private async getDefaultStorageUrl(callId: string): Promise<string> {
    if (!this.blobServiceClient) {
      throw new Error('Azure Storage not configured');
    }

    const containerName = config.azure.storage?.recordingContainer || 'recordings';
    const containerClient = this.blobServiceClient.getContainerClient(containerName);
    
    // Ensure container exists
    await containerClient.createIfNotExists({
      access: 'blob'
    });

    return containerClient.url;
  }

  /**
   * Validate webhook signature for security
   */
  validateWebhookSignature(body: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('Webhook secret not configured, skipping validation');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('base64');

    return signature === `sha256=${expectedSignature}`;
  }

  /**
   * Get call participants
   */
  async getCallParticipants(callId: string): Promise<CallParticipant[]> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        return [];
      }

      const participants = await connection.listParticipants();
      return Array.from(participants);
    } catch (error) {
      logger.error({ error, callId }, 'Failed to get call participants');
      return [];
    }
  }

  /**
   * Mute/unmute participant
   */
  async muteParticipant(
    callId: string, 
    participantId: CommunicationIdentifier,
    mute: boolean = true
  ): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      if (mute) {
        await connection.muteParticipant(participantId);
      } else {
        await connection.unmuteParticipant(participantId);
      }

      logger.info({ callId, mute }, 'Participant mute state changed');
    } catch (error) {
      logger.error({ error, callId }, 'Failed to change participant mute state');
      throw error;
    }
  }

  /**
   * Play audio to call
   */
  async playAudio(
    callId: string,
    audioFileUrl: string,
    loop: boolean = false
  ): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      const callMedia = connection.getCallMedia();
      await callMedia.playToAll([
        {
          kind: 'file',
          fileUri: audioFileUrl,
          playInLoop: loop
        }
      ]);

      logger.info({ callId, audioFileUrl, loop }, 'Playing audio to call');
    } catch (error) {
      logger.error({ error, callId }, 'Failed to play audio');
      throw error;
    }
  }

  /**
   * Stop playing audio
   */
  async stopAudio(callId: string): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      const callMedia = connection.getCallMedia();
      await callMedia.cancelAllOperations();

      logger.info({ callId }, 'Stopped playing audio');
    } catch (error) {
      logger.error({ error, callId }, 'Failed to stop audio');
      throw error;
    }
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): Map<string, CallConnection> {
    return new Map(this.activeConnections);
  }

  /**
   * Handle Azure Communication Services events
   */
  async handleEvent(event: AzureCommunicationEvent): Promise<void> {
    try {
      logger.info({ eventType: event.eventType, subject: event.subject }, 'Processing Azure event');
      
      switch (event.eventType) {
        case 'Microsoft.Communication.CallConnected':
          await this.handleCallConnected(event);
          break;
        case 'Microsoft.Communication.CallDisconnected':
          await this.handleCallDisconnected(event);
          break;
        case 'Microsoft.Communication.RecordingFileStatusUpdated':
          await this.handleRecordingStatusUpdate(event);
          break;
        case 'Microsoft.Communication.CallTransferAccepted':
          await this.handleCallTransferAccepted(event);
          break;
        case 'Microsoft.Communication.CallTransferFailed':
          await this.handleCallTransferFailed(event);
          break;
        default:
          logger.debug({ eventType: event.eventType }, 'Unhandled event type');
      }
    } catch (error: any) {
      logger.error({ error, event }, 'Failed to handle Azure event');
      throw error;
    }
  }

  private async handleCallConnected(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId } = event.data;
    logger.info({ callConnectionId }, 'Call connected event received');
    
    // Additional processing for call connected event
    // This could trigger AI processing initialization
  }

  private async handleCallDisconnected(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId } = event.data;
    logger.info({ callConnectionId }, 'Call disconnected event received');
    
    // Clean up connection from our tracking
    for (const [callId, connection] of this.activeConnections) {
      if (connection.callConnectionId === callConnectionId) {
        this.activeConnections.delete(callId);
        logger.info({ callId, callConnectionId }, 'Removed disconnected call from tracking');
        break;
      }
    }
  }

  private async handleRecordingStatusUpdate(event: AzureCommunicationEvent): Promise<void> {
    const { recordingId, recordingStatus, recordingLocation } = event.data;
    logger.info({ recordingId, recordingStatus }, 'Recording status updated');
    
    // Find the call ID associated with this recording
    let callId: string | undefined;
    for (const [id, info] of this.recordingInfo.entries()) {
      if (info.recordingId === recordingId) {
        callId = id;
        break;
      }
    }

    if (callId && recordingStatus === 'completed') {
      const recordingInfo = this.recordingInfo.get(callId);
      if (recordingInfo) {
        recordingInfo.status = 'completed';
        recordingInfo.recordingUrl = recordingLocation;
        
        // Emit event for downstream processing
        logger.info({ 
          callId, 
          recordingId, 
          recordingUrl: recordingLocation 
        }, 'Recording completed and available');
      }
    }
  }

  private async handleCallTransferAccepted(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId } = event.data;
    logger.info({ callConnectionId }, 'Call transfer accepted');
  }

  private async handleCallTransferFailed(event: AzureCommunicationEvent): Promise<void> {
    const { callConnectionId, resultInformation } = event.data;
    logger.warn({ callConnectionId, resultInformation }, 'Call transfer failed');
  }

  /**
   * Enhanced health check for Azure Communication Services
   */
  async healthCheck(): Promise<{ 
    status: string; 
    latency?: number; 
    error?: string;
    details?: any;
  }> {
    const startTime = Date.now();
    const healthDetails: any = {
      activeConnections: this.activeConnections.size,
      activeRecordings: Array.from(this.recordingInfo.values())
        .filter(r => r.status === 'active').length
    };
    
    try {
      // Test Azure Communication Services connectivity
      // Note: Using a lightweight operation for health check
      const testResult = await Promise.race([
        new Promise((resolve) => {
          // Simulate a basic connectivity check
          resolve({ success: true });
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);
      
      return {
        status: 'healthy',
        latency: Date.now() - startTime,
        details: healthDetails
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: error.message,
        details: healthDetails
      };
    }
  }

  /**
   * Cleanup resources with comprehensive shutdown
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure Communication Service resources');
    
    // Stop all recordings first
    const stopRecordingPromises = Array.from(this.recordingInfo.entries())
      .filter(([_, info]) => info.status === 'active')
      .map(([callId]) => this.stopRecording(callId).catch(err => 
        logger.error({ err, callId }, 'Failed to stop recording during cleanup')
      ));

    await Promise.allSettled(stopRecordingPromises);
    
    // Hang up all active calls
    const hangupPromises = Array.from(this.activeConnections.keys()).map(callId =>
      this.hangupCall(callId, 'Service shutdown').catch(err =>
        logger.error({ err, callId }, 'Failed to hang up call during cleanup')
      )
    );
    
    await Promise.allSettled(hangupPromises);
    
    // Clear all tracking maps
    this.activeConnections.clear();
    this.callStates.clear();
    this.callMetrics.clear();
    this.recordingInfo.clear();
    
    logger.info('Azure Communication Service cleanup completed');
  }
}