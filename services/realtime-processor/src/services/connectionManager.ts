import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  ConnectionContext,
  ConnectionStatus,
  ConnectionError,
  WebSocketMessage,
  MessageType,
} from '../types';
import { RedisService } from './redis';
import { MetricsService } from './metrics';
import logger from '../utils/logger';

export interface ConnectionManagerConfig {
  redis: RedisService;
  metrics: MetricsService;
  maxConnectionsPerUser: number;
  connectionTimeout: number;
  heartbeatInterval: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  sessionRecoveryTimeout: number;
  enableFailover: boolean;
  enableLoadBalancing: boolean;
}

export interface ReconnectionInfo {
  attempts: number;
  lastAttempt: number;
  backoffDelay: number;
  maxDelay: number;
  sessionData?: any;
}

export interface SessionState {
  id: string;
  userId: string;
  callId: string;
  connectionId?: string;
  createdAt: number;
  lastActivity: number;
  state: any;
  recoverable: boolean;
}

export interface FailoverTarget {
  serverId: string;
  endpoint: string;
  load: number;
  available: boolean;
  latency: number;
}

export interface ConnectionHealth {
  connectionId: string;
  status: ConnectionStatus;
  uptime: number;
  lastHeartbeat: number;
  latency: number;
  packetLoss: number;
  reconnections: number;
  errorCount: number;
}

/**
 * Advanced Connection Manager
 * Handles reconnection, failover, session recovery, and load balancing
 */
export class ConnectionManager extends EventEmitter {
  private connections: Map<string, ConnectionContext> = new Map();
  private wsConnections: Map<string, WebSocket> = new Map();
  private sessionStates: Map<string, SessionState> = new Map(); // sessionId -> state
  private userSessions: Map<string, Set<string>> = new Map(); // userId -> sessionIds
  private reconnections: Map<string, ReconnectionInfo> = new Map();
  private failoverTargets: Map<string, FailoverTarget> = new Map();
  
  private readonly config: ConnectionManagerConfig;
  private readonly redis: RedisService;
  private readonly metrics: MetricsService;
  
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private sessionCleanupInterval: NodeJS.Timeout | null = null;
  
  private isShuttingDown = false;
  private serverId: string;

  constructor(config: ConnectionManagerConfig) {
    super();
    
    this.config = config;
    this.redis = config.redis;
    this.metrics = config.metrics;
    this.serverId = process.env.HOSTNAME || `server-${uuidv4()}`;
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing connection manager');

    // Start background tasks
    this.startHeartbeatMonitoring();
    this.startHealthChecks();
    this.startSessionCleanup();
    
    // Setup Redis subscriptions for cluster coordination
    await this.setupRedisSubscriptions();
    
    // Register this server as available for failover
    if (this.config.enableFailover) {
      await this.registerFailoverTarget();
    }

    logger.info({ serverId: this.serverId }, 'Connection manager initialized');
  }

  /**
   * Register a new connection with session recovery support
   */
  public async registerConnection(
    ws: WebSocket,
    userId: string,
    callId: string,
    sessionId?: string,
    reconnectionToken?: string
  ): Promise<{ connectionId: string; sessionId: string; recovered: boolean }> {
    const connectionId = uuidv4();
    let recovered = false;
    let finalSessionId = sessionId;

    try {
      // Check user connection limits
      await this.validateUserLimits(userId);

      // Handle session recovery
      if (reconnectionToken) {
        const recovery = await this.attemptSessionRecovery(reconnectionToken, userId, callId);
        if (recovery) {
          finalSessionId = recovery.sessionId;
          recovered = true;
          logger.info({
            connectionId,
            sessionId: finalSessionId,
            userId,
            callId,
          }, 'Session recovered successfully');
        }
      }

      // Create new session if not recovered
      if (!finalSessionId) {
        finalSessionId = uuidv4();
        await this.createNewSession(finalSessionId, userId, callId);
      }

      // Create connection context
      const context: ConnectionContext = {
        id: connectionId,
        userId,
        callId,
        startTime: Date.now(),
        lastActivity: Date.now(),
        isActive: true,
        rateLimitInfo: {
          requestCount: 0,
          connectionTime: Date.now(),
          lastRequest: Date.now(),
          isLimited: false,
        },
        audioBuffer: {
          chunks: [],
          totalDuration: 0,
          lastChunkTime: 0,
          isProcessing: false,
        },
        processingQueue: {
          pending: [],
          processing: [],
          completed: [],
          maxSize: 50,
        },
      };

      // Store connection and WebSocket
      this.connections.set(connectionId, context);
      this.wsConnections.set(connectionId, ws);

      // Update session with connection
      const session = this.sessionStates.get(finalSessionId);
      if (session) {
        session.connectionId = connectionId;
        session.lastActivity = Date.now();
      }

      // Setup WebSocket handlers
      this.setupConnectionHandlers(ws, connectionId, finalSessionId);

      // Store in Redis for cluster awareness
      await this.storeConnectionInCluster(connectionId, userId, callId, finalSessionId);

      // Track user sessions
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId)!.add(finalSessionId);

      // Clear any existing reconnection info
      this.reconnections.delete(connectionId);

      // Emit connection event
      this.emit('connectionRegistered', {
        connectionId,
        sessionId: finalSessionId,
        userId,
        callId,
        recovered,
      });

      // Update metrics
      this.metrics.incrementCounter('connections_registered_total');
      this.metrics.setGauge('active_connections', this.connections.size);
      
      if (recovered) {
        this.metrics.incrementCounter('sessions_recovered_total');
      }

      return { connectionId, sessionId: finalSessionId, recovered };

    } catch (error) {
      logger.error({ error, userId, callId }, 'Failed to register connection');
      ws.close(1008, 'Connection registration failed');
      throw error;
    }
  }

  private setupConnectionHandlers(
    ws: WebSocket, 
    connectionId: string, 
    sessionId: string
  ): void {
    const context = this.connections.get(connectionId);
    if (!context) return;

    ws.on('close', (code: number, reason: Buffer) => {
      this.handleConnectionClose(connectionId, sessionId, code, reason.toString());
    });

    ws.on('error', (error: Error) => {
      logger.error({ error, connectionId }, 'WebSocket error');
      this.handleConnectionError(connectionId, sessionId, error);
    });

    ws.on('pong', () => {
      context.lastActivity = Date.now();
      const session = this.sessionStates.get(sessionId);
      if (session) {
        session.lastActivity = Date.now();
      }
    });

    // Setup reconnection handling
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'reconnection_request') {
          this.handleReconnectionRequest(connectionId, sessionId, message);
        }
      } catch (error) {
        // Ignore non-JSON messages, they'll be handled by the main message handler
      }
    });
  }

  private async validateUserLimits(userId: string): Promise<void> {
    const userSessionCount = this.userSessions.get(userId)?.size || 0;
    
    if (userSessionCount >= this.config.maxConnectionsPerUser) {
      throw new ConnectionError(`User ${userId} has exceeded maximum connection limit`);
    }
  }

  private async createNewSession(sessionId: string, userId: string, callId: string): Promise<void> {
    const session: SessionState = {
      id: sessionId,
      userId,
      callId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      state: {},
      recoverable: true,
    };

    this.sessionStates.set(sessionId, session);

    // Store in Redis with TTL
    await this.redis.setex(
      `session:${sessionId}`,
      this.config.sessionRecoveryTimeout / 1000,
      JSON.stringify(session)
    );

    logger.info({ sessionId, userId, callId }, 'New session created');
  }

  private async attemptSessionRecovery(
    reconnectionToken: string,
    userId: string,
    callId: string
  ): Promise<{ sessionId: string } | null> {
    try {
      // Decode reconnection token (simplified - in production use proper JWT)
      const tokenParts = reconnectionToken.split('_');
      if (tokenParts.length < 3 || tokenParts[0] !== 'recon') {
        return null;
      }

      const sessionId = tokenParts[1];
      const tokenUserId = tokenParts[2];

      // Validate token
      if (tokenUserId !== userId) {
        logger.warn({ tokenUserId, userId }, 'Session recovery token user mismatch');
        return null;
      }

      // Try to recover from local memory first
      let session = this.sessionStates.get(sessionId);
      
      // If not found locally, try Redis
      if (!session) {
        const redisSession = await this.redis.get(`session:${sessionId}`);
        if (redisSession) {
          session = JSON.parse(redisSession);
          this.sessionStates.set(sessionId, session);
        }
      }

      if (!session || !session.recoverable) {
        logger.info({ sessionId, userId }, 'Session not recoverable');
        return null;
      }

      // Validate session
      if (session.userId !== userId || session.callId !== callId) {
        logger.warn({
          sessionId,
          sessionUserId: session.userId,
          sessionCallId: session.callId,
          userId,
          callId,
        }, 'Session validation failed');
        return null;
      }

      // Check if session hasn't expired
      const age = Date.now() - session.lastActivity;
      if (age > this.config.sessionRecoveryTimeout) {
        logger.info({ sessionId, age }, 'Session recovery timeout expired');
        await this.cleanupSession(sessionId);
        return null;
      }

      return { sessionId };

    } catch (error) {
      logger.error({ error, reconnectionToken }, 'Session recovery failed');
      return null;
    }
  }

  private async handleConnectionClose(
    connectionId: string,
    sessionId: string,
    code: number,
    reason: string
  ): Promise<void> {
    const context = this.connections.get(connectionId);
    if (!context) return;

    logger.info({
      connectionId,
      sessionId,
      userId: context.userId,
      callId: context.callId,
      code,
      reason,
      duration: Date.now() - context.startTime,
    }, 'Connection closed');

    // Mark connection as inactive
    context.isActive = false;

    // Update session
    const session = this.sessionStates.get(sessionId);
    if (session) {
      session.connectionId = undefined;
      session.lastActivity = Date.now();
      
      // Store updated session in Redis
      await this.redis.setex(
        `session:${sessionId}`,
        this.config.sessionRecoveryTimeout / 1000,
        JSON.stringify(session)
      );
    }

    // Setup auto-reconnection for unexpected disconnects
    if (this.shouldAttemptReconnection(code, reason)) {
      await this.initiatereconnection(connectionId, sessionId, context);
    } else {
      // Clean disconnect - cleanup session
      await this.cleanupConnection(connectionId, sessionId);
    }

    this.emit('connectionClosed', {
      connectionId,
      sessionId,
      userId: context.userId,
      callId: context.callId,
      code,
      reason,
    });

    this.metrics.decrementGauge('active_connections', 1);
    this.metrics.recordHistogram('connection_duration_ms', Date.now() - context.startTime);
  }

  private async handleConnectionError(
    connectionId: string,
    sessionId: string,
    error: Error
  ): Promise<void> {
    const context = this.connections.get(connectionId);
    if (!context) return;

    logger.error({
      error,
      connectionId,
      sessionId,
      userId: context.userId,
    }, 'Connection error occurred');

    // Try failover if enabled
    if (this.config.enableFailover) {
      await this.attemptFailover(connectionId, sessionId, context);
    }

    this.emit('connectionError', {
      connectionId,
      sessionId,
      userId: context.userId,
      error: error.message,
    });

    this.metrics.incrementCounter('connection_errors_total');
  }

  private shouldAttemptReconnection(code: number, reason: string): boolean {
    // Don't reconnect for normal closures or client-initiated closes
    if (code === 1000 || code === 1001) return false;
    
    // Don't reconnect if shutting down
    if (this.isShuttingDown) return false;
    
    // Reconnect for unexpected disconnects
    return code >= 1006;
  }

  private async initiatereconnection(
    connectionId: string,
    sessionId: string,
    context: ConnectionContext
  ): Promise<void> {
    const reconnectionInfo: ReconnectionInfo = {
      attempts: 0,
      lastAttempt: Date.now(),
      backoffDelay: this.config.reconnectDelay,
      maxDelay: 30000, // 30 seconds max
      sessionData: {
        sessionId,
        userId: context.userId,
        callId: context.callId,
      },
    };

    this.reconnections.set(connectionId, reconnectionInfo);

    // Send reconnection token to client via Redis pub/sub
    const reconnectionToken = `recon_${sessionId}_${context.userId}_${Date.now()}`;
    
    await this.redis.publish(`user:${context.userId}:reconnect`, {
      type: 'reconnection_required',
      connectionId,
      sessionId,
      token: reconnectionToken,
      serverId: this.serverId,
      timestamp: Date.now(),
    });

    logger.info({
      connectionId,
      sessionId,
      userId: context.userId,
      token: reconnectionToken,
    }, 'Reconnection initiated');

    this.metrics.incrementCounter('reconnections_initiated_total');
  }

  private async handleReconnectionRequest(
    connectionId: string,
    sessionId: string,
    message: any
  ): Promise<void> {
    const reconnectionInfo = this.reconnections.get(connectionId);
    if (!reconnectionInfo) return;

    reconnectionInfo.attempts++;
    reconnectionInfo.lastAttempt = Date.now();

    if (reconnectionInfo.attempts >= this.config.maxReconnectAttempts) {
      logger.warn({
        connectionId,
        sessionId,
        attempts: reconnectionInfo.attempts,
      }, 'Max reconnection attempts exceeded');
      
      await this.cleanupConnection(connectionId, sessionId);
      return;
    }

    // Calculate backoff delay
    const backoffMultiplier = Math.pow(2, reconnectionInfo.attempts - 1);
    reconnectionInfo.backoffDelay = Math.min(
      this.config.reconnectDelay * backoffMultiplier,
      reconnectionInfo.maxDelay
    );

    logger.info({
      connectionId,
      sessionId,
      attempts: reconnectionInfo.attempts,
      backoffDelay: reconnectionInfo.backoffDelay,
    }, 'Processing reconnection request');

    this.metrics.incrementCounter('reconnection_attempts_total');
  }

  private async attemptFailover(
    connectionId: string,
    sessionId: string,
    context: ConnectionContext
  ): Promise<void> {
    const availableTargets = Array.from(this.failoverTargets.values())
      .filter(target => target.available && target.serverId !== this.serverId)
      .sort((a, b) => a.load - b.load || a.latency - b.latency);

    if (availableTargets.length === 0) {
      logger.warn({ connectionId, sessionId }, 'No failover targets available');
      return;
    }

    const target = availableTargets[0];

    logger.info({
      connectionId,
      sessionId,
      targetServer: target.serverId,
      targetEndpoint: target.endpoint,
    }, 'Attempting failover');

    // Notify client about failover
    await this.redis.publish(`user:${context.userId}:failover`, {
      type: 'failover_required',
      connectionId,
      sessionId,
      targetEndpoint: target.endpoint,
      targetServerId: target.serverId,
      timestamp: Date.now(),
    });

    this.metrics.incrementCounter('failover_attempts_total');
  }

  private startHeartbeatMonitoring(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isShuttingDown) return;

      const now = Date.now();
      
      for (const [connectionId, context] of this.connections) {
        const timeSinceLastActivity = now - context.lastActivity;
        
        if (timeSinceLastActivity > this.config.connectionTimeout) {
          const ws = this.wsConnections.get(connectionId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            // Send ping
            ws.ping();
            
            // If still no response after additional timeout, close
            setTimeout(() => {
              const stillInactive = now - context.lastActivity > this.config.connectionTimeout + 5000;
              if (stillInactive && ws.readyState === WebSocket.OPEN) {
                logger.warn({ connectionId, timeSinceLastActivity }, 'Connection timeout, closing');
                ws.close(1001, 'Connection timeout');
              }
            }, 5000);
          }
        }
      }
    }, this.config.heartbeatInterval);
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      await this.updateServerHealth();
      await this.checkFailoverTargets();
    }, 30000); // Every 30 seconds
  }

  private startSessionCleanup(): void {
    this.sessionCleanupInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      await this.cleanupExpiredSessions();
    }, 60000); // Every minute
  }

  private async setupRedisSubscriptions(): Promise<void> {
    // Subscribe to cluster coordination messages
    await this.redis.subscribe('cluster:failover', (message) => {
      this.handleClusterFailover(message);
    });

    await this.redis.subscribe('cluster:health', (message) => {
      this.handleClusterHealth(message);
    });

    await this.redis.subscribe('system:shutdown', () => {
      this.shutdown();
    });
  }

  private async registerFailoverTarget(): Promise<void> {
    const target: FailoverTarget = {
      serverId: this.serverId,
      endpoint: `ws://${process.env.HOST || 'localhost'}:${process.env.PORT || 3002}`,
      load: this.connections.size,
      available: true,
      latency: 0,
    };

    await this.redis.hset('cluster:failover:targets', this.serverId, JSON.stringify(target));
    await this.redis.expire('cluster:failover:targets', 300); // 5 minute TTL

    logger.info({ serverId: this.serverId, target }, 'Registered as failover target');
  }

  private async updateServerHealth(): Promise<void> {
    const health = {
      serverId: this.serverId,
      timestamp: Date.now(),
      connections: this.connections.size,
      sessions: this.sessionStates.size,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
    };

    await this.redis.publish('cluster:health', health);
    
    // Update failover target info
    if (this.config.enableFailover) {
      const target: FailoverTarget = {
        serverId: this.serverId,
        endpoint: `ws://${process.env.HOST || 'localhost'}:${process.env.PORT || 3002}`,
        load: this.connections.size,
        available: true,
        latency: 0, // Would measure actual latency in production
      };

      await this.redis.hset('cluster:failover:targets', this.serverId, JSON.stringify(target));
    }
  }

  private async checkFailoverTargets(): Promise<void> {
    if (!this.config.enableFailover) return;

    const targets = await this.redis.hgetall('cluster:failover:targets');
    
    this.failoverTargets.clear();
    
    for (const [serverId, targetData] of Object.entries(targets)) {
      try {
        const target: FailoverTarget = JSON.parse(targetData);
        this.failoverTargets.set(serverId, target);
      } catch (error) {
        logger.warn({ error, serverId }, 'Failed to parse failover target data');
      }
    }
  }

  private handleClusterFailover(message: any): void {
    logger.info({ message }, 'Received cluster failover message');
    // Handle failover coordination between cluster nodes
  }

  private handleClusterHealth(message: any): void {
    logger.debug({ serverId: message.serverId, connections: message.connections }, 'Cluster health update');
    // Update cluster health information
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessionStates) {
      const age = now - session.lastActivity;
      if (age > this.config.sessionRecoveryTimeout) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      await this.cleanupSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.info({ count: expiredSessions.length }, 'Cleaned up expired sessions');
    }
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.sessionStates.get(sessionId);
    if (!session) return;

    // Remove from user sessions tracking
    const userSessions = this.userSessions.get(session.userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    // Remove from local storage
    this.sessionStates.delete(sessionId);

    // Remove from Redis
    await this.redis.del(`session:${sessionId}`);

    logger.debug({ sessionId, userId: session.userId }, 'Session cleaned up');
  }

  private async cleanupConnection(connectionId: string, sessionId: string): Promise<void> {
    // Remove connection
    this.connections.delete(connectionId);
    this.wsConnections.delete(connectionId);
    this.reconnections.delete(connectionId);

    // Remove from Redis
    await this.redis.hdel(`cluster:connections`, connectionId);

    // Cleanup session if no active connection
    const session = this.sessionStates.get(sessionId);
    if (session && !session.connectionId) {
      await this.cleanupSession(sessionId);
    }
  }

  private async storeConnectionInCluster(
    connectionId: string,
    userId: string,
    callId: string,
    sessionId: string
  ): Promise<void> {
    const connectionInfo = {
      serverId: this.serverId,
      userId,
      callId,
      sessionId,
      timestamp: Date.now(),
    };

    await this.redis.hset(
      'cluster:connections',
      connectionId,
      JSON.stringify(connectionInfo)
    );
  }

  // Public API methods

  public getConnectionHealth(connectionId: string): ConnectionHealth | null {
    const context = this.connections.get(connectionId);
    if (!context) return null;

    const reconnectionInfo = this.reconnections.get(connectionId);

    return {
      connectionId,
      status: context.isActive ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED,
      uptime: Date.now() - context.startTime,
      lastHeartbeat: context.lastActivity,
      latency: 0, // Would calculate from ping/pong
      packetLoss: 0, // Would track from network stats
      reconnections: reconnectionInfo?.attempts || 0,
      errorCount: 0, // Would track error count
    };
  }

  public getAllConnectionsHealth(): ConnectionHealth[] {
    return Array.from(this.connections.keys())
      .map(connectionId => this.getConnectionHealth(connectionId))
      .filter((health): health is ConnectionHealth => health !== null);
  }

  public getSessionInfo(sessionId: string): SessionState | null {
    return this.sessionStates.get(sessionId) || null;
  }

  public getConnectionStats(): any {
    return {
      totalConnections: this.connections.size,
      activeSessions: this.sessionStates.size,
      reconnectionsInProgress: this.reconnections.size,
      failoverTargets: this.failoverTargets.size,
      userSessions: Array.from(this.userSessions.entries()).map(([userId, sessions]) => ({
        userId,
        sessionCount: sessions.size,
      })),
    };
  }

  public async forceReconnection(connectionId: string): Promise<boolean> {
    const context = this.connections.get(connectionId);
    const ws = this.wsConnections.get(connectionId);
    
    if (!context || !ws) return false;

    logger.info({ connectionId, userId: context.userId }, 'Forcing reconnection');
    
    // Close current connection to trigger reconnection
    ws.close(1001, 'Forced reconnection');
    
    return true;
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Shutting down connection manager');

    // Stop background tasks
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }

    // Close all connections gracefully
    const closePromises = Array.from(this.wsConnections.entries()).map(
      async ([connectionId, ws]) => {
        return new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1001, 'Server shutdown');
            ws.on('close', () => resolve());
            setTimeout(() => resolve(), 5000); // Force timeout
          } else {
            resolve();
          }
        });
      }
    );

    await Promise.allSettled(closePromises);

    // Cleanup data structures
    this.connections.clear();
    this.wsConnections.clear();
    this.sessionStates.clear();
    this.userSessions.clear();
    this.reconnections.clear();
    this.failoverTargets.clear();

    // Remove from cluster
    await this.redis.hdel('cluster:failover:targets', this.serverId);

    this.removeAllListeners();

    logger.info('Connection manager shutdown complete');
  }
}

export default ConnectionManager;