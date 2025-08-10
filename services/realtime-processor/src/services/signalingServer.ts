import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  WebSocketMessage,
  MessageType,
  ConnectionContext,
  ValidationError,
  ConnectionError,
} from '../types';
import { RedisService } from './redis';
import { MetricsService } from './metrics';
import logger from '../utils/logger';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join-room' | 'leave-room' | 'peer-joined' | 'peer-left';
  roomId: string;
  peerId: string;
  targetPeerId?: string;
  data?: any;
  timestamp: number;
}

export interface SignalingRoom {
  id: string;
  callId: string;
  peers: Map<string, SignalingPeer>;
  createdAt: number;
  lastActivity: number;
  maxPeers: number;
  isActive: boolean;
}

export interface SignalingPeer {
  id: string;
  userId: string;
  callId: string;
  ws: WebSocket;
  joinedAt: number;
  lastActivity: number;
  isInitiator: boolean;
  metadata: {
    userAgent?: string;
    clientVersion?: string;
    capabilities?: string[];
  };
}

export interface SignalingServerConfig {
  redis: RedisService;
  metrics: MetricsService;
  maxRoomsPerUser: number;
  peerTimeout: number;
  roomCleanupInterval: number;
  enableRoomBroadcast: boolean;
}

/**
 * WebRTC Signaling Server
 * Handles peer-to-peer connection establishment and signaling
 */
export class SignalingServer extends EventEmitter {
  private rooms: Map<string, SignalingRoom> = new Map();
  private peerToRoom: Map<string, string> = new Map(); // peerId -> roomId
  private userRooms: Map<string, Set<string>> = new Map(); // userId -> roomIds
  
  private readonly redis: RedisService;
  private readonly metrics: MetricsService;
  private readonly config: SignalingServerConfig;
  
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(config: SignalingServerConfig) {
    super();
    this.config = config;
    this.redis = config.redis;
    this.metrics = config.metrics;
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing WebRTC signaling server');

    // Start room cleanup task
    this.startRoomCleanup();

    // Subscribe to Redis for cross-instance coordination
    await this.setupRedisSubscriptions();

    logger.info('WebRTC signaling server initialized successfully');
  }

  /**
   * Handle new WebSocket connection for signaling
   */
  public async handleConnection(
    ws: WebSocket, 
    userId: string, 
    callId: string,
    metadata: any = {}
  ): Promise<string> {
    const peerId = uuidv4();
    
    try {
      // Validate user limits
      await this.validateUserLimits(userId);

      // Set up WebSocket handlers
      this.setupWebSocketHandlers(ws, peerId, userId, callId, metadata);

      // Track metrics
      this.metrics.incrementCounter('signaling_connections_total');
      this.metrics.setGauge('signaling_active_peers', this.getTotalPeerCount());

      logger.info({
        peerId,
        userId,
        callId,
        metadata: {
          userAgent: metadata.userAgent,
          clientVersion: metadata.clientVersion,
        },
      }, 'Signaling connection established');

      return peerId;

    } catch (error) {
      logger.error({ error, userId, callId }, 'Failed to establish signaling connection');
      ws.close(1008, 'Connection setup failed');
      throw error;
    }
  }

  private setupWebSocketHandlers(
    ws: WebSocket,
    peerId: string,
    userId: string,
    callId: string,
    metadata: any
  ): void {
    ws.on('message', async (data: Buffer) => {
      try {
        const message: SignalingMessage = JSON.parse(data.toString());
        await this.handleSignalingMessage(ws, peerId, userId, message);
      } catch (error) {
        logger.error({ error, peerId }, 'Failed to handle signaling message');
        await this.sendError(ws, peerId, 'Invalid message format');
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.handlePeerDisconnection(peerId, code, reason.toString());
    });

    ws.on('error', (error: Error) => {
      logger.error({ error, peerId }, 'Signaling WebSocket error');
      this.handlePeerDisconnection(peerId, 1011, 'WebSocket error');
    });

    // Set up ping/pong for connection health
    ws.on('pong', () => {
      this.updatePeerActivity(peerId);
    });
  }

  private async validateUserLimits(userId: string): Promise<void> {
    const userRoomCount = this.userRooms.get(userId)?.size || 0;
    
    if (userRoomCount >= this.config.maxRoomsPerUser) {
      throw new ValidationError(`User ${userId} has exceeded maximum room limit`);
    }
  }

  private async handleSignalingMessage(
    ws: WebSocket,
    peerId: string,
    userId: string,
    message: SignalingMessage
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate message
      this.validateSignalingMessage(message);

      // Update peer activity
      this.updatePeerActivity(peerId);

      switch (message.type) {
        case 'join-room':
          await this.handleJoinRoom(ws, peerId, userId, message);
          break;

        case 'leave-room':
          await this.handleLeaveRoom(peerId, message.roomId);
          break;

        case 'offer':
          await this.handleOffer(peerId, message);
          break;

        case 'answer':
          await this.handleAnswer(peerId, message);
          break;

        case 'ice-candidate':
          await this.handleICECandidate(peerId, message);
          break;

        default:
          logger.warn({
            peerId,
            messageType: message.type,
          }, 'Unknown signaling message type');
      }

      // Record processing latency
      const processingTime = Date.now() - startTime;
      this.metrics.recordHistogram('signaling_message_processing_duration_ms', processingTime);

    } catch (error) {
      logger.error({
        error,
        peerId,
        messageType: message.type,
      }, 'Signaling message processing failed');
      
      await this.sendError(ws, peerId, error.message);
    }
  }

  private validateSignalingMessage(message: SignalingMessage): void {
    if (!message.type || !message.roomId || !message.peerId || !message.timestamp) {
      throw new ValidationError('Invalid signaling message: missing required fields');
    }

    // Validate message-specific fields
    switch (message.type) {
      case 'offer':
      case 'answer':
        if (!message.targetPeerId || !message.data?.sdp) {
          throw new ValidationError('Offer/Answer must include targetPeerId and SDP data');
        }
        break;

      case 'ice-candidate':
        if (!message.targetPeerId || !message.data?.candidate) {
          throw new ValidationError('ICE candidate must include targetPeerId and candidate data');
        }
        break;
    }
  }

  private async handleJoinRoom(
    ws: WebSocket,
    peerId: string,
    userId: string,
    message: SignalingMessage
  ): Promise<void> {
    const { roomId, data: metadata } = message;

    // Get or create room
    let room = this.rooms.get(roomId);
    if (!room) {
      room = await this.createRoom(roomId, message.data?.callId || 'unknown');
    }

    // Check room capacity
    if (room.peers.size >= room.maxPeers) {
      throw new ValidationError('Room is at maximum capacity');
    }

    // Check if peer already in a different room
    const existingRoomId = this.peerToRoom.get(peerId);
    if (existingRoomId && existingRoomId !== roomId) {
      await this.handleLeaveRoom(peerId, existingRoomId);
    }

    // Create peer
    const peer: SignalingPeer = {
      id: peerId,
      userId,
      callId: message.data?.callId || 'unknown',
      ws,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      isInitiator: room.peers.size === 0, // First peer is initiator
      metadata: {
        userAgent: metadata?.userAgent,
        clientVersion: metadata?.clientVersion,
        capabilities: metadata?.capabilities || [],
      },
    };

    // Add peer to room
    room.peers.set(peerId, peer);
    room.lastActivity = Date.now();
    this.peerToRoom.set(peerId, roomId);

    // Track user rooms
    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    this.userRooms.get(userId)!.add(roomId);

    // Notify existing peers about new peer
    await this.notifyPeersInRoom(roomId, {
      type: 'peer-joined',
      roomId,
      peerId: peer.id,
      targetPeerId: '', // Broadcast to all
      data: {
        userId: peer.userId,
        isInitiator: peer.isInitiator,
        metadata: peer.metadata,
      },
      timestamp: Date.now(),
    }, peerId); // Exclude the joining peer

    // Send current peers list to new peer
    const existingPeers = Array.from(room.peers.values())
      .filter(p => p.id !== peerId)
      .map(p => ({
        id: p.id,
        userId: p.userId,
        isInitiator: p.isInitiator,
        metadata: p.metadata,
      }));

    await this.sendMessage(ws, {
      type: 'peer-joined',
      roomId,
      peerId: 'server',
      data: {
        currentPeers: existingPeers,
        yourPeerId: peerId,
        isInitiator: peer.isInitiator,
      },
      timestamp: Date.now(),
    });

    // Publish to Redis for cross-instance coordination
    if (this.config.enableRoomBroadcast) {
      await this.redis.publish(`signaling:room:${roomId}`, {
        type: 'peer-joined',
        peerId,
        userId,
        roomId,
        timestamp: Date.now(),
      });
    }

    logger.info({
      peerId,
      userId,
      roomId,
      roomSize: room.peers.size,
      isInitiator: peer.isInitiator,
    }, 'Peer joined signaling room');

    this.metrics.incrementCounter('signaling_room_joins_total');
    this.metrics.setGauge('signaling_active_rooms', this.rooms.size);
  }

  private async handleLeaveRoom(peerId: string, roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    // Remove peer from room
    room.peers.delete(peerId);
    this.peerToRoom.delete(peerId);

    // Update user rooms tracking
    const userRooms = this.userRooms.get(peer.userId);
    if (userRooms) {
      userRooms.delete(roomId);
      if (userRooms.size === 0) {
        this.userRooms.delete(peer.userId);
      }
    }

    // Notify remaining peers
    await this.notifyPeersInRoom(roomId, {
      type: 'peer-left',
      roomId,
      peerId: peer.id,
      targetPeerId: '', // Broadcast to all
      data: {
        userId: peer.userId,
        reason: 'left',
      },
      timestamp: Date.now(),
    });

    // Clean up empty room
    if (room.peers.size === 0) {
      await this.deleteRoom(roomId);
    } else {
      room.lastActivity = Date.now();
    }

    // Publish to Redis
    if (this.config.enableRoomBroadcast) {
      await this.redis.publish(`signaling:room:${roomId}`, {
        type: 'peer-left',
        peerId,
        roomId,
        timestamp: Date.now(),
      });
    }

    logger.info({
      peerId,
      userId: peer.userId,
      roomId,
      remainingPeers: room.peers.size,
    }, 'Peer left signaling room');

    this.metrics.incrementCounter('signaling_room_leaves_total');
    this.metrics.setGauge('signaling_active_rooms', this.rooms.size);
  }

  private async handleOffer(peerId: string, message: SignalingMessage): Promise<void> {
    const { roomId, targetPeerId, data } = message;
    
    await this.forwardMessageToPeer(roomId, peerId, targetPeerId!, {
      ...message,
      data: {
        ...data,
        fromPeerId: peerId,
      },
    });

    this.metrics.incrementCounter('signaling_offers_forwarded_total');
    logger.debug({ peerId, targetPeerId, roomId }, 'WebRTC offer forwarded');
  }

  private async handleAnswer(peerId: string, message: SignalingMessage): Promise<void> {
    const { roomId, targetPeerId, data } = message;
    
    await this.forwardMessageToPeer(roomId, peerId, targetPeerId!, {
      ...message,
      data: {
        ...data,
        fromPeerId: peerId,
      },
    });

    this.metrics.incrementCounter('signaling_answers_forwarded_total');
    logger.debug({ peerId, targetPeerId, roomId }, 'WebRTC answer forwarded');
  }

  private async handleICECandidate(peerId: string, message: SignalingMessage): Promise<void> {
    const { roomId, targetPeerId, data } = message;
    
    await this.forwardMessageToPeer(roomId, peerId, targetPeerId!, {
      ...message,
      data: {
        ...data,
        fromPeerId: peerId,
      },
    });

    this.metrics.incrementCounter('signaling_ice_candidates_forwarded_total');
    logger.debug({ peerId, targetPeerId, roomId }, 'ICE candidate forwarded');
  }

  private async forwardMessageToPeer(
    roomId: string,
    fromPeerId: string,
    targetPeerId: string,
    message: SignalingMessage
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new ValidationError('Room not found');
    }

    const targetPeer = room.peers.get(targetPeerId);
    if (!targetPeer) {
      throw new ValidationError('Target peer not found');
    }

    const fromPeer = room.peers.get(fromPeerId);
    if (!fromPeer) {
      throw new ValidationError('Source peer not found in room');
    }

    await this.sendMessage(targetPeer.ws, message);

    // Update activity
    room.lastActivity = Date.now();
    targetPeer.lastActivity = Date.now();
    fromPeer.lastActivity = Date.now();
  }

  private async notifyPeersInRoom(
    roomId: string,
    message: SignalingMessage,
    excludePeerId?: string
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const notificationPromises = Array.from(room.peers.values())
      .filter(peer => peer.id !== excludePeerId)
      .map(peer => this.sendMessage(peer.ws, message));

    await Promise.allSettled(notificationPromises);
  }

  private async sendMessage(ws: WebSocket, message: SignalingMessage): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) {
      const serialized = JSON.stringify(message);
      ws.send(serialized);
    }
  }

  private async sendError(ws: WebSocket, peerId: string, error: string): Promise<void> {
    const errorMessage: SignalingMessage = {
      type: 'error' as any,
      roomId: 'system',
      peerId: 'server',
      targetPeerId: peerId,
      data: { error },
      timestamp: Date.now(),
    };

    await this.sendMessage(ws, errorMessage);
  }

  private async createRoom(roomId: string, callId: string): Promise<SignalingRoom> {
    const room: SignalingRoom = {
      id: roomId,
      callId,
      peers: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      maxPeers: 10, // Configurable limit
      isActive: true,
    };

    this.rooms.set(roomId, room);

    logger.info({
      roomId,
      callId,
      maxPeers: room.maxPeers,
    }, 'Signaling room created');

    return room;
  }

  private async deleteRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Ensure all peers are disconnected
    for (const peer of room.peers.values()) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.close(1000, 'Room closed');
      }
      this.peerToRoom.delete(peer.id);
      
      // Clean up user rooms tracking
      const userRooms = this.userRooms.get(peer.userId);
      if (userRooms) {
        userRooms.delete(roomId);
        if (userRooms.size === 0) {
          this.userRooms.delete(peer.userId);
        }
      }
    }

    this.rooms.delete(roomId);

    logger.info({
      roomId,
      callId: room.callId,
      duration: Date.now() - room.createdAt,
    }, 'Signaling room deleted');
  }

  private handlePeerDisconnection(peerId: string, code: number, reason: string): void {
    const roomId = this.peerToRoom.get(peerId);
    if (roomId) {
      this.handleLeaveRoom(peerId, roomId).catch(error => {
        logger.error({ error, peerId, roomId }, 'Failed to handle peer disconnection');
      });
    }

    logger.info({
      peerId,
      code,
      reason,
      roomId,
    }, 'Signaling peer disconnected');

    this.metrics.decrementGauge('signaling_active_peers', 1);
  }

  private updatePeerActivity(peerId: string): void {
    const roomId = this.peerToRoom.get(peerId);
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) {
        const peer = room.peers.get(peerId);
        if (peer) {
          peer.lastActivity = Date.now();
          room.lastActivity = Date.now();
        }
      }
    }
  }

  private startRoomCleanup(): void {
    this.cleanupInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      await this.cleanupInactiveRooms();
      await this.cleanupInactivePeers();
    }, this.config.roomCleanupInterval);
  }

  private async cleanupInactiveRooms(): Promise<void> {
    const now = Date.now();
    const roomTimeout = 30 * 60 * 1000; // 30 minutes

    for (const [roomId, room] of this.rooms) {
      if (now - room.lastActivity > roomTimeout && room.peers.size === 0) {
        await this.deleteRoom(roomId);
        this.metrics.incrementCounter('signaling_rooms_cleaned_up_total');
      }
    }
  }

  private async cleanupInactivePeers(): Promise<void> {
    const now = Date.now();

    for (const [roomId, room] of this.rooms) {
      for (const [peerId, peer] of room.peers) {
        if (now - peer.lastActivity > this.config.peerTimeout) {
          logger.warn({
            peerId,
            roomId,
            lastActivity: peer.lastActivity,
            inactiveTime: now - peer.lastActivity,
          }, 'Cleaning up inactive peer');

          if (peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.ping();
            
            // Give peer a chance to respond
            setTimeout(() => {
              if (now - peer.lastActivity > this.config.peerTimeout + 5000) {
                peer.ws.close(1001, 'Peer timeout');
              }
            }, 5000);
          }
        }
      }
    }
  }

  private async setupRedisSubscriptions(): Promise<void> {
    // Subscribe to cross-instance signaling events
    await this.redis.subscribe('signaling:broadcast', (message) => {
      this.handleBroadcastMessage(message);
    });

    // Subscribe to system events
    await this.redis.subscribe('system:shutdown', () => {
      logger.info('Received system shutdown signal for signaling server');
      this.shutdown();
    });
  }

  private handleBroadcastMessage(message: any): void {
    logger.debug({
      messageType: message.type,
      roomId: message.roomId,
    }, 'Received broadcast signaling message');

    // Handle cross-instance coordination messages
    switch (message.type) {
      case 'room-closed':
        if (this.rooms.has(message.roomId)) {
          this.deleteRoom(message.roomId);
        }
        break;
    }
  }

  private getTotalPeerCount(): number {
    return Array.from(this.rooms.values()).reduce(
      (total, room) => total + room.peers.size,
      0
    );
  }

  // Public API methods

  public getRoomStats(roomId: string): any {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: room.id,
      callId: room.callId,
      peerCount: room.peers.size,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      isActive: room.isActive,
      peers: Array.from(room.peers.values()).map(peer => ({
        id: peer.id,
        userId: peer.userId,
        isInitiator: peer.isInitiator,
        joinedAt: peer.joinedAt,
        lastActivity: peer.lastActivity,
        metadata: peer.metadata,
      })),
    };
  }

  public getAllRoomsStats(): any {
    return {
      totalRooms: this.rooms.size,
      totalPeers: this.getTotalPeerCount(),
      rooms: Array.from(this.rooms.keys()).map(roomId => this.getRoomStats(roomId)),
    };
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Shutting down signaling server');

    // Stop cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all rooms gracefully
    const closePromises = Array.from(this.rooms.keys()).map(
      roomId => this.deleteRoom(roomId)
    );

    await Promise.allSettled(closePromises);

    // Clear all data structures
    this.rooms.clear();
    this.peerToRoom.clear();
    this.userRooms.clear();

    this.removeAllListeners();

    logger.info('Signaling server shutdown complete');
  }
}

export default SignalingServer;