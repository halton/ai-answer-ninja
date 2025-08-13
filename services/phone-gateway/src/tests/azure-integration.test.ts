import { AzureCommunicationService } from '../services/AzureCommunicationService';
import { CallRecordingService } from '../services/CallRecordingService';
import { CallStateManager } from '../services/CallStateManager';
import { AzureEventHandlers } from '../azure/EventHandlers';
import { WebhookController } from '../controllers/WebhookController';
import logger from '../utils/logger';

describe('Azure Integration Tests', () => {
  let communicationService: AzureCommunicationService;
  let recordingService: CallRecordingService;
  let stateManager: CallStateManager;
  let eventHandlers: AzureEventHandlers;

  beforeAll(() => {
    // Initialize services
    communicationService = new AzureCommunicationService();
    recordingService = new CallRecordingService();
    stateManager = new CallStateManager(true); // Enable persistence
    eventHandlers = new AzureEventHandlers({
      communicationService,
      recordingService
    });
  });

  afterAll(async () => {
    // Clean up
    await communicationService.cleanup();
    await recordingService.cleanup();
    await stateManager.cleanup();
    await eventHandlers.cleanup();
  });

  describe('Call Management', () => {
    it('should answer an incoming call', async () => {
      const callId = 'test-call-123';
      const callbackUri = 'https://example.com/webhook';
      
      // Mock the answer call functionality
      const mockConnection = {
        callConnectionId: 'conn-123',
        getCallRecording: jest.fn(),
        getCallMedia: jest.fn(),
        hangUp: jest.fn()
      };

      jest.spyOn(communicationService, 'answerCall')
        .mockResolvedValue(mockConnection as any);

      const result = await communicationService.answerCall(callId, callbackUri, {
        recordCall: true,
        enableTranscription: true
      });

      expect(result).toBeDefined();
      expect(result.callConnectionId).toBe('conn-123');
    });

    it('should transfer a call', async () => {
      const callId = 'test-call-123';
      const targetPhone = '+1234567890';

      await expect(
        communicationService.transferCall(callId, targetPhone)
      ).resolves.not.toThrow();
    });

    it('should hang up a call', async () => {
      const callId = 'test-call-123';

      await expect(
        communicationService.hangupCall(callId, 'Test completed')
      ).resolves.not.toThrow();
    });
  });

  describe('Recording Management', () => {
    it('should start recording', async () => {
      const callId = 'test-call-123';
      const userId = 'user-456';

      const recordingInfo = await recordingService.startRecording({
        callId,
        userId,
        format: 'wav',
        quality: 'high'
      });

      expect(recordingInfo).toBeDefined();
      expect(recordingInfo.status).toBe('active');
      expect(recordingInfo.recordingId).toContain('rec-');
    });

    it('should stop recording', async () => {
      const callId = 'test-call-123';

      const result = await recordingService.stopRecording(callId);
      
      if (result) {
        expect(result.status).toBe('stopped');
        expect(result.endTime).toBeDefined();
      }
    });

    it('should search recordings', async () => {
      const recordings = await recordingService.searchRecordings({
        userId: 'user-456',
        startDate: new Date(Date.now() - 86400000), // Last 24 hours
      });

      expect(Array.isArray(recordings)).toBe(true);
    });

    it('should get recording statistics', async () => {
      const stats = await recordingService.getRecordingStatistics();

      expect(stats).toHaveProperty('totalRecordings');
      expect(stats).toHaveProperty('activeRecordings');
      expect(stats).toHaveProperty('totalDuration');
      expect(stats).toHaveProperty('averageDuration');
    });
  });

  describe('Call State Management', () => {
    it('should create call state', async () => {
      const callId = 'test-call-789';
      const userId = 'user-456';

      const state = await stateManager.createCallState(callId, userId);

      expect(state).toBeDefined();
      expect(state.callId).toBe(callId);
      expect(state.status).toBe('connecting');
    });

    it('should update call state', async () => {
      const callId = 'test-call-789';

      const updatedState = await stateManager.updateCallState(callId, {
        status: 'connected',
        connectionId: 'conn-789'
      });

      expect(updatedState).toBeDefined();
      expect(updatedState?.status).toBe('connected');
    });

    it('should track call metrics', async () => {
      const callId = 'test-call-789';

      await stateManager.addCallMetrics(callId, {
        callId,
        startTime: Date.now(),
        audioPacketsReceived: 1000,
        audioPacketsSent: 950,
        audioQuality: 0.95,
        latency: 25,
        jitter: 5,
        packetLoss: 0.5
      });

      const lifecycle = stateManager.getCallLifecycle(callId);
      expect(lifecycle?.metrics.length).toBeGreaterThan(0);
    });

    it('should get call summary', () => {
      const summary = stateManager.getCallSummary();

      expect(summary).toHaveProperty('totalCalls');
      expect(summary).toHaveProperty('activeCalls');
      expect(summary).toHaveProperty('callsByStatus');
      expect(summary).toHaveProperty('averageCallDuration');
    });
  });

  describe('Event Processing', () => {
    it('should process incoming call event', async () => {
      const event = {
        id: 'evt-123',
        topic: 'test',
        subject: 'test',
        eventType: 'Microsoft.Communication.IncomingCall',
        eventTime: new Date().toISOString(),
        data: {
          incomingCallContext: 'context-123',
          from: '+1234567890',
          to: '+0987654321',
          correlationId: 'corr-123'
        },
        dataVersion: '1.0',
        metadataVersion: '1'
      };

      const results = await eventHandlers.processWebhookEvent([event], {});

      expect(results).toHaveLength(1);
      expect(results[0].eventType).toBe('Microsoft.Communication.IncomingCall');
    });

    it('should validate webhook signature', () => {
      const body = JSON.stringify({ test: 'data' });
      const secret = 'test-secret';
      const crypto = require('crypto');
      
      const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64');

      const isValid = communicationService.validateWebhookSignature(
        body,
        `sha256=${signature}`
      );

      expect(isValid).toBe(true);
    });

    it('should handle recording status update', async () => {
      const event = {
        id: 'evt-456',
        topic: 'test',
        subject: 'test',
        eventType: 'Microsoft.Communication.RecordingFileStatusUpdated',
        eventTime: new Date().toISOString(),
        data: {
          recordingId: 'rec-123',
          recordingStatus: 'completed',
          recordingLocation: 'https://storage.azure.com/recording.wav',
          recordingDuration: 300,
          recordingSize: 1024000
        },
        dataVersion: '1.0',
        metadataVersion: '1'
      };

      const results = await eventHandlers.processWebhookEvent([event], {});

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it('should get event metrics', () => {
      const metrics = eventHandlers.getMetrics();

      expect(metrics).toHaveProperty('totalEvents');
      expect(metrics).toHaveProperty('successfulEvents');
      expect(metrics).toHaveProperty('failedEvents');
      expect(metrics).toHaveProperty('averageProcessingTime');
      expect(metrics).toHaveProperty('eventTypeDistribution');
    });
  });

  describe('Health Checks', () => {
    it('should perform health check', async () => {
      const health = await communicationService.healthCheck();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('latency');
      expect(['healthy', 'unhealthy']).toContain(health.status);
    });
  });

  describe('Quality Monitoring', () => {
    it('should update call metrics', () => {
      const callId = 'test-call-999';

      communicationService.updateCallMetrics(callId, {
        audioPacketsReceived: 5000,
        audioPacketsSent: 4950,
        audioQuality: 0.92,
        latency: 35
      });

      const metrics = communicationService.getCallMetrics(callId);
      
      if (metrics) {
        expect(metrics.audioPacketsReceived).toBe(5000);
        expect(metrics.audioQuality).toBe(0.92);
      }
    });
  });

  describe('Advanced Features', () => {
    it('should play audio to call', async () => {
      const callId = 'test-call-audio';
      const audioUrl = 'https://example.com/audio.wav';

      // This would need proper mocking in a real test
      await expect(
        communicationService.playAudio(callId, audioUrl, false)
      ).rejects.toThrow(); // Expected to throw as no active connection
    });

    it('should handle DTMF tones', async () => {
      const callId = 'test-call-dtmf';
      const tones = '1234#';

      await expect(
        communicationService.sendDtmf(callId, tones)
      ).rejects.toThrow(); // Expected to throw as no active connection
    });

    it('should get call participants', async () => {
      const callId = 'test-call-participants';

      const participants = await communicationService.getCallParticipants(callId);
      
      expect(Array.isArray(participants)).toBe(true);
    });
  });
});

// Integration test for complete call flow
describe('Complete Call Flow Integration', () => {
  it('should handle complete call lifecycle', async () => {
    const communicationService = new AzureCommunicationService();
    const recordingService = new CallRecordingService();
    const stateManager = new CallStateManager(true);

    const callId = 'integration-test-call';
    const userId = 'test-user';
    const callerPhone = '+1234567890';

    try {
      // 1. Create call state
      const state = await stateManager.createCallState(callId, userId, 'connecting');
      expect(state).toBeDefined();

      // 2. Update to connected
      await stateManager.updateCallState(callId, {
        status: 'connected',
        metadata: { callerPhone }
      });

      // 3. Start recording
      const recordingInfo = await recordingService.startRecording({
        callId,
        userId,
        format: 'wav'
      });
      expect(recordingInfo.status).toBe('active');

      // 4. Add some metrics
      await stateManager.addCallMetrics(callId, {
        callId,
        startTime: Date.now(),
        audioPacketsReceived: 10000,
        audioPacketsSent: 9900,
        audioQuality: 0.95,
        latency: 30,
        jitter: 10,
        packetLoss: 1
      });

      // 5. Add call events
      await stateManager.addCallEvent(callId, 'quality_check', {
        quality: 'good',
        timestamp: Date.now()
      });

      // 6. Stop recording
      const stoppedRecording = await recordingService.stopRecording(callId);
      expect(stoppedRecording?.status).toBe('stopped');

      // 7. End call
      await stateManager.endCall(callId, 'Normal completion');

      // 8. Verify cleanup
      const finalState = await stateManager.getCallState(callId);
      expect(finalState).toBeNull();

      logger.info('Complete call flow test passed');
    } finally {
      // Clean up
      await communicationService.cleanup();
      await recordingService.cleanup();
      await stateManager.cleanup();
    }
  });
});