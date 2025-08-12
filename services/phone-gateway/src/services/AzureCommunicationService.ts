import { CallAutomationClient, CallConnection } from '@azure/communication-call-automation';
import { CommunicationIdentifier, PhoneNumberIdentifier } from '@azure/communication-common';
import { EventGridClient } from '@azure/eventgrid';
import logger from '../utils/logger';
import config from '../config';
import { IncomingCallEvent, CallControlOptions, AzureCommunicationEvent } from '../types';

export class AzureCommunicationService {
  private callAutomationClient: CallAutomationClient;
  private eventGridClient: EventGridClient;
  private activeConnections: Map<string, CallConnection> = new Map();

  constructor() {
    this.callAutomationClient = new CallAutomationClient(
      config.azure.communicationServices.connectionString
    );
    
    this.eventGridClient = new EventGridClient(
      config.azure.eventGrid.endpoint,
      'EventGrid',
      { key: config.azure.eventGrid.accessKey }
    );
    
    logger.info('Azure Communication Service initialized');
  }

  /**
   * Answer an incoming call
   */
  async answerCall(
    callId: string, 
    callbackUri: string, 
    options: CallControlOptions = {}
  ): Promise<CallConnection> {
    try {
      logger.info({ callId, callbackUri }, 'Answering incoming call');
      
      const answerCallResult = await this.callAutomationClient.answerCall(
        callId,
        callbackUri,
        {
          operationContext: `answer-${callId}`,
          mediaStreamingOptions: {
            transportUrl: `${callbackUri}/media-streaming`,
            transportType: 'websocket',
            contentType: 'audio',
            audioChannelType: 'mixed'
          }
        }
      );

      if (answerCallResult.callConnection) {
        this.activeConnections.set(callId, answerCallResult.callConnection);
        
        logger.info({ 
          callId, 
          connectionId: answerCallResult.callConnectionId 
        }, 'Call answered successfully');
        
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
   * Start recording a call
   */
  async startRecording(
    callId: string, 
    recordingStorageUri: string
  ): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error(`No active connection found for call ${callId}`);
      }

      logger.info({ callId, recordingStorageUri }, 'Starting call recording');
      
      await connection.getCallRecording().start({
        recordingStorageType: 'azureBlob',
        recordingDestination: {
          storageType: 'azureBlob',
          containerUrl: recordingStorageUri
        }
      });

      logger.info({ callId }, 'Call recording started');
    } catch (error: any) {
      logger.error({ error, callId }, 'Failed to start recording');
      throw error;
    }
  }

  /**
   * Stop recording a call
   */
  async stopRecording(callId: string): Promise<void> {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        logger.warn({ callId }, 'No active connection found for stop recording');
        return;
      }

      logger.info({ callId }, 'Stopping call recording');
      
      await connection.getCallRecording().stop();
      
      logger.info({ callId }, 'Call recording stopped');
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
   * Get call connection information
   */
  async getCallConnection(callId: string): Promise<CallConnection | null> {
    return this.activeConnections.get(callId) || null;
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
    const { recordingId, recordingStatus } = event.data;
    logger.info({ recordingId, recordingStatus }, 'Recording status updated');
    
    // Handle recording completion, storage, etc.
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
   * Health check for Azure Communication Services
   */
  async healthCheck(): Promise<{ status: string; latency?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      // Simple connectivity test
      await this.callAutomationClient.getCallRecording().downloadStreaming('test');
      
      return {
        status: 'healthy',
        latency: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Azure Communication Service resources');
    
    // Hang up all active calls
    const hangupPromises = Array.from(this.activeConnections.keys()).map(callId =>
      this.hangupCall(callId, 'Service shutdown')
    );
    
    try {
      await Promise.allSettled(hangupPromises);
      this.activeConnections.clear();
      logger.info('Azure Communication Service cleanup completed');
    } catch (error: any) {
      logger.error({ error }, 'Error during Azure Communication Service cleanup');
    }
  }
}