import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { CallState, CallMetrics, CallRecord } from '../types';
import { RedisClient } from '../utils/redis';

export interface CallStateTransition {
  from: string;
  to: string;
  timestamp: Date;
  reason?: string;
  metadata?: any;
}

export interface CallLifecycle {
  callId: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  states: CallStateTransition[];
  metrics: CallMetrics[];
  events: CallEvent[];
}

export interface CallEvent {
  type: string;
  timestamp: Date;
  data: any;
}

export interface CallStateSummary {
  totalCalls: number;
  activeCalls: number;
  callsByStatus: Map<string, number>;
  averageCallDuration: number;
  longestCall: number;
  shortestCall: number;
}

/**
 * Manages call state lifecycle and tracking
 */
export class CallStateManager extends EventEmitter {
  private callStates: Map<string, CallState> = new Map();
  private callLifecycles: Map<string, CallLifecycle> = new Map();
  private callMetrics: Map<string, CallMetrics[]> = new Map();
  private redisClient: RedisClient | null = null;
  private persistenceEnabled: boolean = false;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor(enablePersistence: boolean = false) {
    super();
    this.persistenceEnabled = enablePersistence;
    
    if (enablePersistence) {
      this.initializeRedis();
    }

    this.startMetricsCollection();
    logger.info('Call State Manager initialized');
  }

  /**
   * Initialize Redis for state persistence
   */
  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = new RedisClient();
      await this.redisClient.connect();
      logger.info('Redis persistence enabled for call states');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis for call state persistence');
      this.persistenceEnabled = false;
    }
  }

  /**
   * Start metrics collection interval
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectAndEmitMetrics();
    }, 10000); // Every 10 seconds
  }

  /**
   * Create a new call state
   */
  async createCallState(
    callId: string,
    userId: string,
    initialStatus: string = 'connecting'
  ): Promise<CallState> {
    try {
      const callState: CallState = {
        callId,
        status: initialStatus as any,
        startTime: new Date(),
        participants: [],
        isRecording: false,
        metadata: { userId }
      };

      this.callStates.set(callId, callState);

      // Initialize lifecycle tracking
      const lifecycle: CallLifecycle = {
        callId,
        userId,
        startTime: callState.startTime,
        states: [{
          from: 'none',
          to: initialStatus,
          timestamp: callState.startTime
        }],
        metrics: [],
        events: []
      };
      this.callLifecycles.set(callId, lifecycle);

      // Persist to Redis if enabled
      if (this.persistenceEnabled && this.redisClient) {
        await this.redisClient.set(
          `call:state:${callId}`,
          JSON.stringify(callState),
          300 // 5 minutes TTL
        );
      }

      // Emit event
      this.emit('callStateCreated', { callId, userId, callState });

      logger.info({ callId, userId, status: initialStatus }, 'Call state created');

      return callState;
    } catch (error) {
      logger.error({ error, callId }, 'Failed to create call state');
      throw error;
    }
  }

  /**
   * Update call state
   */
  async updateCallState(
    callId: string,
    updates: Partial<CallState>,
    reason?: string
  ): Promise<CallState | null> {
    try {
      const currentState = this.callStates.get(callId);
      if (!currentState) {
        logger.warn({ callId }, 'Call state not found for update');
        return null;
      }

      const previousStatus = currentState.status;
      const updatedState: CallState = {
        ...currentState,
        ...updates
      };

      this.callStates.set(callId, updatedState);

      // Track state transition
      if (updates.status && updates.status !== previousStatus) {
        const lifecycle = this.callLifecycles.get(callId);
        if (lifecycle) {
          lifecycle.states.push({
            from: previousStatus,
            to: updates.status,
            timestamp: new Date(),
            reason,
            metadata: updates.metadata
          });
        }

        // Emit state transition event
        this.emit('callStateTransition', {
          callId,
          from: previousStatus,
          to: updates.status,
          reason
        });
      }

      // Persist to Redis if enabled
      if (this.persistenceEnabled && this.redisClient) {
        await this.redisClient.set(
          `call:state:${callId}`,
          JSON.stringify(updatedState),
          300
        );
      }

      // Emit update event
      this.emit('callStateUpdated', { callId, updates, state: updatedState });

      logger.debug({ callId, updates }, 'Call state updated');

      return updatedState;
    } catch (error) {
      logger.error({ error, callId }, 'Failed to update call state');
      throw error;
    }
  }

  /**
   * Get call state
   */
  async getCallState(callId: string): Promise<CallState | null> {
    try {
      // Check memory first
      let state = this.callStates.get(callId);
      
      // Try Redis if not in memory and persistence is enabled
      if (!state && this.persistenceEnabled && this.redisClient) {
        const redisData = await this.redisClient.get(`call:state:${callId}`);
        if (redisData) {
          state = JSON.parse(redisData);
          // Restore to memory
          this.callStates.set(callId, state);
        }
      }

      return state || null;
    } catch (error) {
      logger.error({ error, callId }, 'Failed to get call state');
      return null;
    }
  }

  /**
   * End call and finalize state
   */
  async endCall(callId: string, reason?: string): Promise<void> {
    try {
      const state = this.callStates.get(callId);
      if (!state) {
        logger.warn({ callId }, 'Call state not found for ending');
        return;
      }

      // Update state to disconnected
      state.status = 'disconnected';
      state.endTime = new Date();

      // Update lifecycle
      const lifecycle = this.callLifecycles.get(callId);
      if (lifecycle) {
        lifecycle.endTime = state.endTime;
        lifecycle.states.push({
          from: state.status,
          to: 'disconnected',
          timestamp: state.endTime,
          reason
        });

        // Calculate and store final metrics
        const duration = state.endTime.getTime() - state.startTime.getTime();
        lifecycle.events.push({
          type: 'call_ended',
          timestamp: state.endTime,
          data: { reason, duration }
        });
      }

      // Emit call ended event
      this.emit('callEnded', {
        callId,
        state,
        lifecycle,
        reason
      });

      // Archive to persistent storage before removing from memory
      await this.archiveCallState(callId, state, lifecycle);

      // Clean up from memory
      this.callStates.delete(callId);
      this.callLifecycles.delete(callId);
      this.callMetrics.delete(callId);

      // Clean up from Redis
      if (this.persistenceEnabled && this.redisClient) {
        await this.redisClient.delete(`call:state:${callId}`);
      }

      logger.info({ callId, reason }, 'Call ended and state cleaned up');
    } catch (error) {
      logger.error({ error, callId }, 'Failed to end call');
      throw error;
    }
  }

  /**
   * Add call metrics
   */
  async addCallMetrics(callId: string, metrics: CallMetrics): Promise<void> {
    try {
      const metricsArray = this.callMetrics.get(callId) || [];
      metricsArray.push(metrics);
      this.callMetrics.set(callId, metricsArray);

      // Update lifecycle
      const lifecycle = this.callLifecycles.get(callId);
      if (lifecycle) {
        lifecycle.metrics.push(metrics);
      }

      // Check for quality issues
      this.checkQualityThresholds(callId, metrics);

      logger.debug({ callId, metrics }, 'Call metrics added');
    } catch (error) {
      logger.error({ error, callId }, 'Failed to add call metrics');
    }
  }

  /**
   * Add call event
   */
  async addCallEvent(callId: string, eventType: string, data: any): Promise<void> {
    try {
      const lifecycle = this.callLifecycles.get(callId);
      if (lifecycle) {
        const event: CallEvent = {
          type: eventType,
          timestamp: new Date(),
          data
        };
        lifecycle.events.push(event);

        // Emit specific event
        this.emit('callEvent', {
          callId,
          event
        });

        logger.debug({ callId, eventType }, 'Call event added');
      }
    } catch (error) {
      logger.error({ error, callId, eventType }, 'Failed to add call event');
    }
  }

  /**
   * Get call lifecycle
   */
  getCallLifecycle(callId: string): CallLifecycle | null {
    return this.callLifecycles.get(callId) || null;
  }

  /**
   * Get active calls
   */
  getActiveCalls(): CallState[] {
    return Array.from(this.callStates.values()).filter(
      state => state.status === 'connected' || state.status === 'connecting'
    );
  }

  /**
   * Get call summary statistics
   */
  getCallSummary(): CallStateSummary {
    const calls = Array.from(this.callStates.values());
    const callsByStatus = new Map<string, number>();
    let totalDuration = 0;
    let longestCall = 0;
    let shortestCall = Infinity;
    let completedCalls = 0;

    for (const call of calls) {
      // Count by status
      const count = callsByStatus.get(call.status) || 0;
      callsByStatus.set(call.status, count + 1);

      // Calculate durations for completed calls
      if (call.endTime) {
        const duration = call.endTime.getTime() - call.startTime.getTime();
        totalDuration += duration;
        completedCalls++;
        longestCall = Math.max(longestCall, duration);
        shortestCall = Math.min(shortestCall, duration);
      }
    }

    return {
      totalCalls: calls.length,
      activeCalls: this.getActiveCalls().length,
      callsByStatus,
      averageCallDuration: completedCalls > 0 ? totalDuration / completedCalls : 0,
      longestCall,
      shortestCall: shortestCall === Infinity ? 0 : shortestCall
    };
  }

  /**
   * Check quality thresholds and emit alerts
   */
  private checkQualityThresholds(callId: string, metrics: CallMetrics): void {
    const thresholds = {
      minAudioQuality: 0.5,
      maxLatency: 200,
      maxJitter: 50,
      maxPacketLoss: 5
    };

    const issues: string[] = [];

    if (metrics.audioQuality < thresholds.minAudioQuality) {
      issues.push(`Low audio quality: ${metrics.audioQuality}`);
    }

    if (metrics.latency > thresholds.maxLatency) {
      issues.push(`High latency: ${metrics.latency}ms`);
    }

    if (metrics.jitter > thresholds.maxJitter) {
      issues.push(`High jitter: ${metrics.jitter}ms`);
    }

    if (metrics.packetLoss > thresholds.maxPacketLoss) {
      issues.push(`High packet loss: ${metrics.packetLoss}%`);
    }

    if (issues.length > 0) {
      logger.warn({ callId, issues }, 'Call quality issues detected');
      
      this.emit('qualityAlert', {
        callId,
        issues,
        metrics,
        timestamp: new Date()
      });
    }
  }

  /**
   * Collect and emit metrics
   */
  private collectAndEmitMetrics(): void {
    const summary = this.getCallSummary();
    
    this.emit('metricsUpdate', {
      summary,
      timestamp: new Date()
    });

    logger.debug({ summary }, 'Call state metrics collected');
  }

  /**
   * Archive call state to persistent storage
   */
  private async archiveCallState(
    callId: string,
    state: CallState,
    lifecycle: CallLifecycle | null
  ): Promise<void> {
    try {
      // Create call record for database
      const callRecord: Partial<CallRecord> = {
        id: callId,
        userId: state.metadata?.userId,
        callerPhone: state.metadata?.callerPhone,
        callType: 'incoming',
        callStatus: this.mapStatusToCallStatus(state.status),
        startTime: state.startTime,
        endTime: state.endTime,
        duration: state.endTime 
          ? Math.floor((state.endTime.getTime() - state.startTime.getTime()) / 1000)
          : undefined,
        azureCallId: state.connectionId || callId
      };

      // Emit archive event for database service to handle
      this.emit('archiveCallRecord', {
        callRecord,
        lifecycle
      });

      logger.debug({ callId }, 'Call state archived');
    } catch (error) {
      logger.error({ error, callId }, 'Failed to archive call state');
    }
  }

  /**
   * Map internal status to call record status
   */
  private mapStatusToCallStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'connected': 'answered',
      'disconnected': 'answered',
      'failed': 'missed',
      'connecting': 'missed'
    };

    return statusMap[status] || 'missed';
  }

  /**
   * Restore call states from persistence
   */
  async restoreCallStates(): Promise<number> {
    if (!this.persistenceEnabled || !this.redisClient) {
      return 0;
    }

    try {
      const keys = await this.redisClient.keys('call:state:*');
      let restoredCount = 0;

      for (const key of keys) {
        const data = await this.redisClient.get(key);
        if (data) {
          const state = JSON.parse(data);
          const callId = key.replace('call:state:', '');
          this.callStates.set(callId, state);
          restoredCount++;
        }
      }

      logger.info({ restoredCount }, 'Call states restored from persistence');
      return restoredCount;
    } catch (error) {
      logger.error({ error }, 'Failed to restore call states');
      return 0;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Call State Manager');

    // Stop metrics collection
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    // Archive all active calls
    const activeCalls = this.getActiveCalls();
    for (const call of activeCalls) {
      await this.endCall(call.callId, 'Service shutdown');
    }

    // Clear maps
    this.callStates.clear();
    this.callLifecycles.clear();
    this.callMetrics.clear();

    // Disconnect Redis
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }

    logger.info('Call State Manager cleanup completed');
  }
}