import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { LRUCache } from 'lru-cache';

import { 
  ConnectionContext, 
  ConnectionStatus, 
  RealtimeProcessorError,
  ConnectionError,
  ValidationError 
} from '../types';
import logger from '../utils/logger';

export interface PoolConfig {
  maxConnections: number;
  maxConnectionsPerUser: number;
  connectionTimeout: number;
  idleTimeout: number;
  cleanupInterval: number;
  enableConnectionReuse: boolean;
  priorityLevels: number;
}

export interface PooledConnection {
  id: string;
  userId: string;
  callId: string;
  connectionType: 'websocket' | 'webrtc';
  connection: any; // WebSocket or RTCPeerConnection
  context: ConnectionContext;
  priority: number;
  lastUsed: number;
  createdAt: number;
  isActive: boolean;
  metadata: ConnectionMetadata;
}

export interface ConnectionMetadata {
  userAgent?: string;
  clientIP?: string;
  region?: string;
  quality?: 'high' | 'medium' | 'low';
  capabilities?: string[];
  bandwidth?: number;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  connectionsByType: {
    websocket: number;
    webrtc: number;
  };
  connectionsByUser: Map<string, number>;
  avgConnectionDuration: number;
  poolUtilization: number;
  waitingQueue: number;
}

export interface ConnectionRequest {
  userId: string;
  callId: string;
  connectionType: 'websocket' | 'webrtc';
  priority: number;
  metadata: ConnectionMetadata;
  timeout?: number;
}

export class ConnectionPool extends EventEmitter {
  private config: PoolConfig;
  private connections: Map<string, PooledConnection> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private waitingQueue: Array<{
    request: ConnectionRequest;
    resolve: (connection: PooledConnection) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];
  
  private reusableConnections: LRUCache<string, PooledConnection>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private poolStats: PoolStats;

  constructor(config: Partial<PoolConfig> = {}) {
    super();
    
    this.config = {
      maxConnections: 1000,
      maxConnectionsPerUser: 5,
      connectionTimeout: 30000,
      idleTimeout: 300000, // 5 minutes
      cleanupInterval: 60000, // 1 minute
      enableConnectionReuse: true,
      priorityLevels: 3,
      ...config,
    };
    
    this.reusableConnections = new LRUCache<string, PooledConnection>({
      max: Math.floor(this.config.maxConnections * 0.1), // 10% for reuse
      ttl: this.config.idleTimeout,
    });
    
    this.poolStats = this.initializeStats();
  }

  private initializeStats(): PoolStats {
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      connectionsByType: { websocket: 0, webrtc: 0 },
      connectionsByUser: new Map(),
      avgConnectionDuration: 0,
      poolUtilization: 0,
      waitingQueue: 0,
    };
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing Connection Pool');
    
    this.startCleanupProcess();
    this.startMetricsCollection();
    
    logger.info({
      maxConnections: this.config.maxConnections,
      maxConnectionsPerUser: this.config.maxConnectionsPerUser,
    }, 'Connection Pool initialized');
  }

  public async acquireConnection(request: ConnectionRequest): Promise<PooledConnection> {
    const { userId, callId, connectionType, priority, metadata, timeout } = request;
    
    logger.debug({
      userId,
      callId,
      connectionType,
      priority,
    }, 'Acquiring connection from pool');
    
    try {
      // Validate request
      this.validateConnectionRequest(request);
      
      // Check user connection limits
      if (!this.canUserAcquireConnection(userId)) {
        throw new ConnectionError(
          `User ${userId} has reached maximum connection limit`
        );
      }
      
      // Try to get reusable connection first
      if (this.config.enableConnectionReuse) {
        const reusableConnection = this.findReusableConnection(request);
        if (reusableConnection) {
          return this.activateConnection(reusableConnection, request);
        }
      }
      
      // Check if pool has capacity
      if (this.connections.size >= this.config.maxConnections) {
        return await this.handlePoolCapacityExceeded(request);
      }
      
      // Create new connection
      return await this.createNewConnection(request);
      
    } catch (error) {
      logger.error({
        error,
        userId,
        callId,
        connectionType,
      }, 'Failed to acquire connection');
      
      throw error;
    }
  }

  private validateConnectionRequest(request: ConnectionRequest): void {
    const { userId, callId, connectionType, priority } = request;
    
    if (!userId || !callId) {
      throw new ValidationError('userId and callId are required');
    }
    
    if (!['websocket', 'webrtc'].includes(connectionType)) {
      throw new ValidationError('Invalid connection type');
    }
    
    if (priority < 0 || priority >= this.config.priorityLevels) {
      throw new ValidationError(`Priority must be between 0 and ${this.config.priorityLevels - 1}`);
    }
  }

  private canUserAcquireConnection(userId: string): boolean {
    const userConnections = this.userConnections.get(userId);
    return !userConnections || userConnections.size < this.config.maxConnectionsPerUser;
  }

  private findReusableConnection(request: ConnectionRequest): PooledConnection | null {
    const { userId, connectionType } = request;
    
    // Try to find a reusable connection for the same user and type
    const cacheKey = `${userId}:${connectionType}`;
    const cached = this.reusableConnections.get(cacheKey);
    
    if (cached && !cached.isActive) {
      logger.debug({
        connectionId: cached.id,
        userId,
        connectionType,
      }, 'Found reusable connection');
      
      return cached;
    }
    
    return null;
  }

  private activateConnection(
    connection: PooledConnection, 
    request: ConnectionRequest
  ): PooledConnection {
    // Update connection with new request details
    connection.callId = request.callId;
    connection.isActive = true;
    connection.lastUsed = Date.now();
    connection.metadata = { ...connection.metadata, ...request.metadata };
    
    // Remove from reusable cache
    const cacheKey = `${connection.userId}:${connection.connectionType}`;
    this.reusableConnections.delete(cacheKey);
    
    // Update context
    connection.context.callId = request.callId;
    connection.context.lastActivity = Date.now();
    connection.context.isActive = true;
    
    this.updateStats();
    
    logger.info({
      connectionId: connection.id,
      userId: request.userId,
      callId: request.callId,
    }, 'Connection activated from pool');
    
    this.emit('connectionActivated', connection);
    
    return connection;
  }

  private async handlePoolCapacityExceeded(request: ConnectionRequest): Promise<PooledConnection> {
    const { priority, timeout = this.config.connectionTimeout } = request;
    
    logger.warn({
      currentConnections: this.connections.size,
      maxConnections: this.config.maxConnections,
      priority,
    }, 'Pool capacity exceeded');
    
    // Try to evict lower priority connections
    if (priority > 0) {
      const evicted = this.evictLowerPriorityConnections(priority);
      if (evicted > 0) {
        logger.info({ evicted, priority }, 'Evicted lower priority connections');
        return await this.createNewConnection(request);
      }
    }
    
    // Add to waiting queue
    return new Promise((resolve, reject) => {
      const queueItem = {
        request,
        resolve,
        reject,
        timestamp: Date.now(),
      };
      
      this.waitingQueue.push(queueItem);
      this.waitingQueue.sort((a, b) => b.request.priority - a.request.priority);
      
      this.updateStats();
      
      logger.debug({
        userId: request.userId,
        priority: request.priority,
        queuePosition: this.waitingQueue.length,
      }, 'Added to waiting queue');
      
      // Set timeout for waiting
      setTimeout(() => {
        const index = this.waitingQueue.indexOf(queueItem);
        if (index >= 0) {
          this.waitingQueue.splice(index, 1);
          this.updateStats();
          reject(new ConnectionError('Connection request timeout'));
        }
      }, timeout);
    });
  }

  private evictLowerPriorityConnections(requiredPriority: number): number {
    const candidates = Array.from(this.connections.values())
      .filter(conn => conn.priority < requiredPriority && !this.isConnectionCritical(conn))
      .sort((a, b) => a.priority - b.priority || a.lastUsed - b.lastUsed);
    
    let evicted = 0;
    const neededSlots = Math.min(candidates.length, 5); // Evict up to 5 connections
    
    for (let i = 0; i < neededSlots; i++) {
      const connection = candidates[i];
      this.releaseConnection(connection.id, 'evicted_for_higher_priority');
      evicted++;
    }
    
    return evicted;
  }

  private isConnectionCritical(connection: PooledConnection): boolean {
    // Define critical connections that shouldn't be evicted
    const criticalDuration = 10000; // 10 seconds
    const timeSinceCreation = Date.now() - connection.createdAt;
    
    return timeSinceCreation < criticalDuration || 
           connection.priority === this.config.priorityLevels - 1;
  }

  private async createNewConnection(request: ConnectionRequest): Promise<PooledConnection> {
    const connectionId = uuidv4();
    const { userId, callId, connectionType, priority, metadata } = request;
    
    try {
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
      
      const connection: PooledConnection = {
        id: connectionId,
        userId,
        callId,
        connectionType,
        connection: null, // Will be set by the connection manager
        context,
        priority,
        lastUsed: Date.now(),
        createdAt: Date.now(),
        isActive: true,
        metadata,
      };
      
      // Add to pool
      this.connections.set(connectionId, connection);
      
      // Add to user connections
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(connectionId);
      
      this.updateStats();
      
      logger.info({
        connectionId,
        userId,
        callId,
        connectionType,
        priority,
      }, 'New connection created in pool');
      
      this.emit('connectionCreated', connection);
      
      return connection;
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
        userId,
        callId,
      }, 'Failed to create connection');
      
      throw new ConnectionError(`Failed to create connection: ${error.message}`);
    }
  }

  public async releaseConnection(connectionId: string, reason: string = 'released'): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn({ connectionId, reason }, 'Attempted to release unknown connection');
      return;
    }
    
    logger.debug({
      connectionId,
      userId: connection.userId,
      reason,
      duration: Date.now() - connection.createdAt,
    }, 'Releasing connection');
    
    try {
      // Mark as inactive
      connection.isActive = false;
      connection.context.isActive = false;
      
      // Check if connection can be reused
      if (this.config.enableConnectionReuse && this.canConnectionBeReused(connection)) {
        this.addToReusablePool(connection);
      } else {
        this.removeConnectionCompletely(connection);
      }
      
      // Process waiting queue
      this.processWaitingQueue();
      
      this.updateStats();
      
      this.emit('connectionReleased', { connection, reason });
      
    } catch (error) {
      logger.error({ error, connectionId }, 'Error releasing connection');
    }
  }

  private canConnectionBeReused(connection: PooledConnection): boolean {
    // Don't reuse connections that had errors or were forced to close
    const nonReusableReasons = ['error', 'evicted_for_higher_priority', 'timeout', 'failed'];
    return !nonReusableReasons.some(reason => 
      connection.context.isActive === false && reason === 'error'
    );
  }

  private addToReusablePool(connection: PooledConnection): void {
    const cacheKey = `${connection.userId}:${connection.connectionType}`;
    this.reusableConnections.set(cacheKey, connection);
    
    logger.debug({
      connectionId: connection.id,
      userId: connection.userId,
      connectionType: connection.connectionType,
    }, 'Connection added to reusable pool');
  }

  private removeConnectionCompletely(connection: PooledConnection): void {
    // Remove from main connections
    this.connections.delete(connection.id);
    
    // Remove from user connections
    const userConns = this.userConnections.get(connection.userId);
    if (userConns) {
      userConns.delete(connection.id);
      if (userConns.size === 0) {
        this.userConnections.delete(connection.userId);
      }
    }
    
    // Remove from reusable cache if present
    const cacheKey = `${connection.userId}:${connection.connectionType}`;
    this.reusableConnections.delete(cacheKey);
    
    logger.debug({
      connectionId: connection.id,
      userId: connection.userId,
    }, 'Connection completely removed from pool');
  }

  private processWaitingQueue(): void {
    while (this.waitingQueue.length > 0 && this.connections.size < this.config.maxConnections) {
      const queueItem = this.waitingQueue.shift()!;
      
      logger.debug({
        userId: queueItem.request.userId,
        queueWaitTime: Date.now() - queueItem.timestamp,
      }, 'Processing waiting queue item');
      
      this.createNewConnection(queueItem.request)
        .then(connection => {
          queueItem.resolve(connection);
        })
        .catch(error => {
          queueItem.reject(error);
        });
    }
    
    this.updateStats();
  }

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
      this.cleanupExpiredQueueItems();
    }, this.config.cleanupInterval);
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    const idleThreshold = this.config.idleTimeout;
    
    for (const [connectionId, connection] of this.connections.entries()) {
      const idleTime = now - connection.lastUsed;
      
      if (!connection.isActive && idleTime > idleThreshold) {
        logger.debug({
          connectionId,
          idleTime,
          userId: connection.userId,
        }, 'Cleaning up idle connection');
        
        this.removeConnectionCompletely(connection);
      }
    }
    
    // Clean up reusable connections cache (LRU handles TTL automatically)
    this.reusableConnections.purgeStale();
    
    this.updateStats();
  }

  private cleanupExpiredQueueItems(): void {
    const now = Date.now();
    const timeoutThreshold = this.config.connectionTimeout;
    
    this.waitingQueue = this.waitingQueue.filter(item => {
      const waitTime = now - item.timestamp;
      if (waitTime > timeoutThreshold) {
        item.reject(new ConnectionError('Queue wait timeout'));
        return false;
      }
      return true;
    });
    
    this.updateStats();
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.updateStats();
      this.emitMetrics();
    }, 30000); // Every 30 seconds
  }

  private updateStats(): void {
    this.poolStats.totalConnections = this.connections.size;
    this.poolStats.activeConnections = Array.from(this.connections.values())
      .filter(conn => conn.isActive).length;
    this.poolStats.idleConnections = this.poolStats.totalConnections - this.poolStats.activeConnections;
    
    // Count by type
    this.poolStats.connectionsByType = { websocket: 0, webrtc: 0 };
    for (const connection of this.connections.values()) {
      this.poolStats.connectionsByType[connection.connectionType]++;
    }
    
    // Count by user
    this.poolStats.connectionsByUser = new Map(this.userConnections);
    
    // Calculate utilization
    this.poolStats.poolUtilization = this.connections.size / this.config.maxConnections;
    
    // Update waiting queue count
    this.poolStats.waitingQueue = this.waitingQueue.length;
    
    // Calculate average connection duration
    const totalDuration = Array.from(this.connections.values())
      .reduce((sum, conn) => sum + (Date.now() - conn.createdAt), 0);
    this.poolStats.avgConnectionDuration = this.connections.size > 0 
      ? totalDuration / this.connections.size 
      : 0;
  }

  private emitMetrics(): void {
    this.emit('poolMetrics', { ...this.poolStats });
    
    if (this.poolStats.poolUtilization > 0.9) {
      logger.warn({
        utilization: this.poolStats.poolUtilization,
        totalConnections: this.poolStats.totalConnections,
        maxConnections: this.config.maxConnections,
      }, 'Connection pool utilization is high');
    }
  }

  // Public API Methods

  public getConnection(connectionId: string): PooledConnection | null {
    return this.connections.get(connectionId) || null;
  }

  public getConnectionsByUser(userId: string): PooledConnection[] {
    const userConnectionIds = this.userConnections.get(userId);
    if (!userConnectionIds) return [];
    
    return Array.from(userConnectionIds)
      .map(id => this.connections.get(id))
      .filter((conn): conn is PooledConnection => conn !== undefined);
  }

  public getPoolStats(): PoolStats {
    this.updateStats();
    return { ...this.poolStats };
  }

  public async setConnectionPriority(connectionId: string, priority: number): Promise<boolean> {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;
    
    const oldPriority = connection.priority;
    connection.priority = Math.max(0, Math.min(priority, this.config.priorityLevels - 1));
    
    logger.debug({
      connectionId,
      oldPriority,
      newPriority: connection.priority,
    }, 'Connection priority updated');
    
    this.emit('priorityChanged', { connection, oldPriority, newPriority: connection.priority });
    
    return true;
  }

  public async forceEvictConnections(count: number = 1): Promise<number> {
    const candidates = Array.from(this.connections.values())
      .filter(conn => !this.isConnectionCritical(conn))
      .sort((a, b) => a.priority - b.priority || a.lastUsed - b.lastUsed);
    
    const toEvict = Math.min(count, candidates.length);
    let evicted = 0;
    
    for (let i = 0; i < toEvict; i++) {
      const connection = candidates[i];
      this.releaseConnection(connection.id, 'force_evicted');
      evicted++;
    }
    
    logger.info({ requested: count, evicted }, 'Force evicted connections');
    
    return evicted;
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down Connection Pool');
    
    // Stop intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    // Reject all waiting queue items
    for (const item of this.waitingQueue) {
      item.reject(new ConnectionError('Pool shutdown'));
    }
    this.waitingQueue.clear();
    
    // Release all connections
    const connectionIds = Array.from(this.connections.keys());
    for (const connectionId of connectionIds) {
      await this.releaseConnection(connectionId, 'pool_shutdown');
    }
    
    // Clear all data structures
    this.connections.clear();
    this.userConnections.clear();
    this.reusableConnections.clear();
    
    this.removeAllListeners();
    
    logger.info('Connection Pool shutdown complete');
  }
}

export default ConnectionPool;