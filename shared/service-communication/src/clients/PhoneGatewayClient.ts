import { HttpClient } from '../client/HttpClient';
import { ServiceConfig } from '../types';

export interface IncomingCallEvent {
  eventType: string;
  from: string;
  to: string;
  callId: string;
  serverCallId: string;
  timestamp: string;
  data?: any;
}

export interface CallRoutingDecision {
  action: 'transfer' | 'ai_handle' | 'reject';
  reason: string;
  targetNumber?: string;
  confidence?: number;
  metadata?: any;
}

export interface CallStatusResponse {
  callId: string;
  callConnectionId?: string;
  status: string;
}

export interface CallControlRequest {
  callId: string;
  targetNumber?: string;
  reason?: string;
  callbackUri?: string;
}

export interface PhoneGatewayMetrics {
  totalCalls: number;
  activeCalls: number;
  callsPerMinute: number;
  averageProcessingTime: number;
  whitelistHitRate: number;
  aiHandledCalls: number;
  transferredCalls: number;
  rejectedCalls: number;
}

export class PhoneGatewayClient extends HttpClient {
  constructor(config: ServiceConfig) {
    super('phone-gateway', config);
  }

  /**
   * Get phone gateway service health status
   */
  async getHealth(): Promise<any> {
    return this.get('/health');
  }

  /**
   * Get service metrics
   */
  async getMetrics(): Promise<PhoneGatewayMetrics> {
    return this.get('/metrics');
  }

  /**
   * Handle incoming call webhook (for testing)
   */
  async handleIncomingCall(callEvent: IncomingCallEvent): Promise<{ status: string; callId: string }> {
    return this.post('/webhook/incoming-call', callEvent);
  }

  /**
   * Handle Azure events webhook (for testing)
   */
  async handleAzureEvent(events: any[]): Promise<{ status: string; eventCount: number }> {
    return this.post('/webhook/azure-events', events);
  }

  /**
   * Answer a call
   */
  async answerCall(callId: string, callbackUri?: string): Promise<{ success: boolean; callConnectionId?: string }> {
    return this.post(`/calls/${callId}/answer`, { callbackUri });
  }

  /**
   * Transfer a call
   */
  async transferCall(callId: string, targetNumber: string): Promise<{ success: boolean; message: string }> {
    return this.post(`/calls/${callId}/transfer`, { targetNumber });
  }

  /**
   * Hang up a call
   */
  async hangupCall(callId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    return this.post(`/calls/${callId}/hangup`, { reason });
  }

  /**
   * Get call status
   */
  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    return this.get(`/calls/${callId}/status`);
  }

  /**
   * Get routing statistics
   */
  async getRoutingStats(timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<any[]> {
    return this.get('/routing/stats', { timeframe });
  }

  /**
   * Process audio data (for testing)
   */
  async processAudio(data: {
    callId: string;
    audioData: string;
    userId?: string;
  }): Promise<any> {
    return this.post('/process/audio', data);
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(callId: string): Promise<any> {
    return this.get(`/process/status/${callId}`);
  }
}