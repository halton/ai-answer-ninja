import { Request, Response, NextFunction } from 'express';
import { AzureCommunicationService } from '../services/AzureCommunicationService';
import { CallRoutingService } from '../services/CallRoutingService';
import { CallFilteringService } from '../services/CallFilteringService';
import { WebRTCService } from '../services/WebRTCService';
import { logger } from '@shared/utils/logger';
import { EventEmitter } from 'events';

export class PhoneGatewayController {
  private eventEmitter: EventEmitter;

  constructor(
    private azureService: AzureCommunicationService,
    private routingService: CallRoutingService,
    private filteringService: CallFilteringService,
    private webrtcService: WebRTCService
  ) {
    this.eventEmitter = new EventEmitter();
  }

  async handleIncomingCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { 
        callId, 
        from, 
        to, 
        callbackUri,
        incomingCallContext 
      } = req.body;

      logger.info('Incoming call received', { callId, from, to });

      const userId = await this.routingService.getUserIdByPhone(to);
      
      if (!userId) {
        logger.warn('No user found for phone number', { to });
        return res.json({ action: 'reject' });
      }

      const filterResult = await this.filteringService.filterIncomingCall({
        userId,
        callerPhone: from,
        callId
      });

      if (filterResult.action === 'whitelist') {
        const transferResult = await this.azureService.transferCall(
          callId,
          filterResult.targetPhone
        );
        
        return res.json({ 
          action: 'transfer',
          targetPhone: filterResult.targetPhone,
          transferId: transferResult.id
        });
      }

      if (filterResult.action === 'block') {
        logger.info('Call blocked', { callId, reason: filterResult.reason });
        return res.json({ action: 'reject', reason: filterResult.reason });
      }

      const answerResult = await this.azureService.answerCall(
        callId,
        incomingCallContext,
        callbackUri
      );

      this.eventEmitter.emit('call:answered', {
        callId,
        from,
        to,
        userId,
        timestamp: new Date()
      });

      res.json({ 
        action: 'answer',
        sessionId: answerResult.sessionId,
        mediaEndpoint: answerResult.mediaEndpoint
      });
    } catch (error) {
      logger.error('Error handling incoming call:', error);
      next(error);
    }
  }

  async answerCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      const { context, mediaSettings } = req.body;

      const result = await this.azureService.answerCall(callId, context, mediaSettings);
      
      await this.routingService.updateCallStatus(callId, 'answered');

      res.json({
        success: true,
        sessionId: result.sessionId,
        mediaEndpoint: result.mediaEndpoint
      });
    } catch (error) {
      logger.error('Error answering call:', error);
      next(error);
    }
  }

  async transferCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      const { targetPhone, transferMode = 'blind' } = req.body;

      const result = await this.azureService.transferCall(
        callId,
        targetPhone,
        transferMode
      );

      await this.routingService.updateCallStatus(callId, 'transferred');

      res.json({
        success: true,
        transferId: result.id,
        targetPhone
      });
    } catch (error) {
      logger.error('Error transferring call:', error);
      next(error);
    }
  }

  async getCallStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      
      const status = await this.routingService.getCallStatus(callId);
      
      if (!status) {
        return res.status(404).json({ error: 'Call not found' });
      }

      res.json(status);
    } catch (error) {
      logger.error('Error getting call status:', error);
      next(error);
    }
  }

  async hangupCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      
      await this.azureService.hangupCall(callId);
      await this.routingService.updateCallStatus(callId, 'ended');

      this.eventEmitter.emit('call:ended', {
        callId,
        timestamp: new Date()
      });

      res.json({ success: true, message: 'Call ended' });
    } catch (error) {
      logger.error('Error hanging up call:', error);
      next(error);
    }
  }

  async filterCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      const { userId, callerPhone } = req.body;

      const result = await this.filteringService.filterIncomingCall({
        userId,
        callerPhone,
        callId
      });

      res.json(result);
    } catch (error) {
      logger.error('Error filtering call:', error);
      next(error);
    }
  }

  async startRecording(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      
      const recordingId = await this.azureService.startRecording(callId);
      
      await this.routingService.updateCallRecording(callId, recordingId, 'recording');

      res.json({ 
        success: true, 
        recordingId,
        message: 'Recording started' 
      });
    } catch (error) {
      logger.error('Error starting recording:', error);
      next(error);
    }
  }

  async stopRecording(req: Request, res: Response, next: NextFunction) {
    try {
      const { callId } = req.params;
      
      const recordingUrl = await this.azureService.stopRecording(callId);
      
      await this.routingService.updateCallRecording(callId, null, 'completed', recordingUrl);

      res.json({ 
        success: true,
        recordingUrl,
        message: 'Recording stopped' 
      });
    } catch (error) {
      logger.error('Error stopping recording:', error);
      next(error);
    }
  }
}