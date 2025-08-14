import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
  CreateCallConnectionRequest,
  CallConnectionResponse,
  AnswerCallRequest,
  TransferCallRequest,
  PlayAudioRequest,
  MockServiceConfig,
  MockStats
} from '../types';

interface MockCall {
  callConnectionId: string;
  serverCallId: string;
  state: 'connecting' | 'connected' | 'disconnected' | 'transferring';
  targetPhone: string;
  sourcePhone?: string;
  callbackUri: string;
  createdAt: Date;
  connectedAt?: Date;
  disconnectedAt?: Date;
}

export class AzureCommunicationMockService {
  private requestCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];
  private activeCalls = new Map<string, MockCall>();
  private config: MockServiceConfig = {
    latency: { min: 50, max: 200 },
    errorRate: 0,
    responses: {}
  };

  createCallConnection(request: CreateCallConnectionRequest): CallConnectionResponse {
    const startTime = Date.now();
    this.requestCount++;

    try {
      // 模拟处理延迟
      this.simulateLatency();

      // 模拟错误
      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock Communication service error');
      }

      const callConnectionId = uuidv4();
      const serverCallId = `server-${uuidv4()}`;

      // 创建模拟通话记录
      const mockCall: MockCall = {
        callConnectionId,
        serverCallId,
        state: 'connecting',
        targetPhone: request.targetParticipant.phoneNumber,
        sourcePhone: request.sourceCallerIdNumber?.phoneNumber,
        callbackUri: request.callbackUri,
        createdAt: new Date()
      };

      this.activeCalls.set(callConnectionId, mockCall);

      const response: CallConnectionResponse = {
        callConnectionId,
        serverCallId,
        targets: [{ phoneNumber: request.targetParticipant.phoneNumber }],
        callConnectionState: 'connecting',
        callbackUri: request.callbackUri,
        mediaStreamingConfiguration: request.mediaStreamingConfiguration
      };

      // 模拟异步状态变化
      setTimeout(() => {
        this.simulateCallProgression(callConnectionId);
      }, 1000);

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('Call Connection Created:', {
        callConnectionId,
        targetPhone: request.targetParticipant.phoneNumber,
        state: 'connecting'
      });

      return response;

    } catch (error) {
      logger.error('Create Call Connection Mock Error:', error);
      throw error;
    }
  }

  answerCall(callId: string, request: AnswerCallRequest): any {
    const startTime = Date.now();
    this.requestCount++;

    try {
      this.simulateLatency();

      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock answer call service error');
      }

      const call = this.activeCalls.get(callId);
      if (!call) {
        throw new Error(`Call ${callId} not found`);
      }

      // 更新通话状态
      call.state = 'connected';
      call.connectedAt = new Date();
      this.activeCalls.set(callId, call);

      const response = {
        callConnectionId: callId,
        serverCallId: call.serverCallId,
        callConnectionState: 'connected',
        callbackUri: request.callbackUri,
        mediaStreamingConfiguration: request.mediaStreamingConfiguration
      };

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('Call Answered:', {
        callConnectionId: callId,
        state: 'connected'
      });

      // 发送模拟webhook事件
      this.sendWebhookEvent(call, 'Microsoft.Communication.CallConnected');

      return response;

    } catch (error) {
      logger.error('Answer Call Mock Error:', error);
      throw error;
    }
  }

  hangupCall(callId: string): any {
    const startTime = Date.now();
    this.requestCount++;

    try {
      this.simulateLatency();

      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock hangup call service error');
      }

      const call = this.activeCalls.get(callId);
      if (!call) {
        throw new Error(`Call ${callId} not found`);
      }

      // 更新通话状态
      call.state = 'disconnected';
      call.disconnectedAt = new Date();
      this.activeCalls.set(callId, call);

      const response = {
        callConnectionId: callId,
        serverCallId: call.serverCallId,
        callConnectionState: 'disconnected'
      };

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('Call Hung Up:', {
        callConnectionId: callId,
        state: 'disconnected',
        duration: call.connectedAt ? Date.now() - call.connectedAt.getTime() : 0
      });

      // 发送模拟webhook事件
      this.sendWebhookEvent(call, 'Microsoft.Communication.CallDisconnected');

      // 清理已结束的通话（延迟清理以便查询）
      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, 60000); // 1分钟后清理

      return response;

    } catch (error) {
      logger.error('Hangup Call Mock Error:', error);
      throw error;
    }
  }

  transferCall(callId: string, request: TransferCallRequest): any {
    const startTime = Date.now();
    this.requestCount++;

    try {
      this.simulateLatency();

      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock transfer call service error');
      }

      const call = this.activeCalls.get(callId);
      if (!call) {
        throw new Error(`Call ${callId} not found`);
      }

      // 更新通话状态
      call.state = 'transferring';
      this.activeCalls.set(callId, call);

      const response = {
        callConnectionId: callId,
        serverCallId: call.serverCallId,
        callConnectionState: 'transferring',
        transferTarget: request.transferTarget
      };

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('Call Transfer Initiated:', {
        callConnectionId: callId,
        transferTarget: request.transferTarget.phoneNumber,
        state: 'transferring'
      });

      // 模拟转接完成
      setTimeout(() => {
        call.state = 'connected';
        this.activeCalls.set(callId, call);
        this.sendWebhookEvent(call, 'Microsoft.Communication.CallTransferAccepted');
      }, 2000);

      return response;

    } catch (error) {
      logger.error('Transfer Call Mock Error:', error);
      throw error;
    }
  }

  playAudio(callId: string, request: PlayAudioRequest): any {
    const startTime = Date.now();
    this.requestCount++;

    try {
      this.simulateLatency();

      if (this.shouldSimulateError()) {
        this.errorCount++;
        throw new Error('Mock play audio service error');
      }

      const call = this.activeCalls.get(callId);
      if (!call) {
        throw new Error(`Call ${callId} not found`);
      }

      const operationId = uuidv4();
      const response = {
        operationId,
        status: 'running',
        operationContext: request.playOptions?.operationContext,
        resultInfo: {
          code: 200,
          subCode: 0,
          message: 'Audio playback started'
        }
      };

      const latency = Date.now() - startTime;
      this.latencies.push(latency);

      logger.info('Audio Playback Started:', {
        callConnectionId: callId,
        operationId,
        sourceType: request.playSourceInfo.sourceType,
        text: request.playSourceInfo.text?.substring(0, 50) + '...'
      });

      // 模拟音频播放完成
      setTimeout(() => {
        this.sendWebhookEvent(call, 'Microsoft.Communication.PlayCompleted', {
          operationId,
          resultInfo: {
            code: 200,
            subCode: 0,
            message: 'Audio playback completed'
          }
        });
      }, 3000);

      return response;

    } catch (error) {
      logger.error('Play Audio Mock Error:', error);
      throw error;
    }
  }

  // 获取活跃通话列表
  getActiveCalls(): MockCall[] {
    return Array.from(this.activeCalls.values());
  }

  // 获取特定通话信息
  getCallInfo(callId: string): MockCall | undefined {
    return this.activeCalls.get(callId);
  }

  configure(config: MockServiceConfig) {
    this.config = { ...this.config, ...config };
    logger.info('Communication mock service configured:', this.config);
  }

  reset() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.latencies = [];
    this.activeCalls.clear();
    logger.info('Communication mock service reset');
  }

  getStats(): MockStats {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      averageLatency: this.latencies.length > 0 
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length 
        : 0,
      lastRequestTime: this.latencies.length > 0 ? new Date() : undefined,
      configuration: this.config
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  private simulateCallProgression(callId: string) {
    const call = this.activeCalls.get(callId);
    if (!call || call.state !== 'connecting') return;

    // 模拟通话建立过程
    const progressSteps = [
      { state: 'connecting', event: 'Microsoft.Communication.CallConnecting', delay: 0 },
      { state: 'connected', event: 'Microsoft.Communication.CallConnected', delay: 2000 }
    ];

    progressSteps.forEach(({ state, event, delay }) => {
      setTimeout(() => {
        const currentCall = this.activeCalls.get(callId);
        if (currentCall && currentCall.state === 'connecting') {
          currentCall.state = state as any;
          if (state === 'connected') {
            currentCall.connectedAt = new Date();
          }
          this.activeCalls.set(callId, currentCall);
          this.sendWebhookEvent(currentCall, event);
        }
      }, delay);
    });
  }

  private sendWebhookEvent(call: MockCall, eventType: string, additionalData: any = {}) {
    // 在实际实现中，这里会发送HTTP POST到callback URI
    // 在Mock中，我们只是记录事件
    const webhookData = {
      eventType,
      callConnectionId: call.callConnectionId,
      serverCallId: call.serverCallId,
      callConnectionState: call.state,
      timestamp: new Date().toISOString(),
      ...additionalData
    };

    logger.info('Webhook Event (Mock):', {
      callbackUri: call.callbackUri,
      eventType,
      callConnectionId: call.callConnectionId,
      state: call.state
    });

    // 如果配置了webhook回调，可以在这里实际发送
    // 现在只是模拟记录
  }

  private simulateLatency() {
    const { min, max } = this.config.latency!;
    const latency = min + Math.random() * (max - min);
    
    if (process.env.NODE_ENV !== 'test') {
      const start = Date.now();
      while (Date.now() - start < latency) {
        // 忙等待模拟延迟
      }
    }
  }

  private shouldSimulateError(): boolean {
    return Math.random() < (this.config.errorRate || 0);
  }
}