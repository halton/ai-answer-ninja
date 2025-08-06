import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { 
  AudioChunk, 
  ConnectionContext, 
  WebSocketMessage,
  MessageType,
  AudioFormat,
  ConnectionError,
  ValidationError 
} from '../types';
import logger from '../utils/logger';

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  enableAudioProcessing: boolean;
  audioConstraints: MediaStreamConstraints['audio'];
  bitrateLimit: number;
  latencyTarget: number;
}

export interface PeerConnectionContext {
  id: string;
  userId: string;
  callId: string;
  peerConnection: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  startTime: number;
  stats: ConnectionStats;
  isInitiator: boolean;
}

export interface ConnectionStats {
  audioPacketsSent: number;
  audioPacketsReceived: number;
  bytesSent: number;
  bytesReceived: number;
  roundTripTime: number;
  jitter: number;
  packetsLost: number;
  bitrate: number;
  codecName: string;
}

export interface ICECandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface WebRTCMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'ready' | 'close';
  data: any;
  callId: string;
  timestamp: number;
}

export class WebRTCManager extends EventEmitter {
  private peerConnections: Map<string, PeerConnectionContext> = new Map();
  private config: WebRTCConfig;
  private statsInterval: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<WebRTCConfig> = {}) {
    super();
    
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      enableAudioProcessing: true,
      audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
        channelCount: 1,
      },
      bitrateLimit: 32000, // 32 kbps for voice
      latencyTarget: 100, // 100ms target latency
      ...config,
    };
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing WebRTC manager');
    
    // Start periodic stats collection
    this.startStatsCollection();
    
    logger.info('WebRTC manager initialized successfully');
  }

  public async createPeerConnection(
    userId: string, 
    callId: string, 
    isInitiator: boolean = false
  ): Promise<string> {
    const connectionId = uuidv4();
    
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: this.config.iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      const context: PeerConnectionContext = {
        id: connectionId,
        userId,
        callId,
        peerConnection,
        connectionState: 'new',
        iceConnectionState: 'new',
        startTime: Date.now(),
        isInitiator,
        stats: {
          audioPacketsSent: 0,
          audioPacketsReceived: 0,
          bytesSent: 0,
          bytesReceived: 0,
          roundTripTime: 0,
          jitter: 0,
          packetsLost: 0,
          bitrate: 0,
          codecName: 'unknown',
        },
      };

      // Set up event handlers
      this.setupPeerConnectionEventHandlers(context);
      
      // Create data channel for audio metadata and control messages
      if (isInitiator) {
        context.dataChannel = peerConnection.createDataChannel('audioControl', {
          ordered: true,
          maxRetransmits: 3,
        });
        this.setupDataChannelHandlers(context);
      }

      this.peerConnections.set(connectionId, context);
      
      logger.info({ 
        connectionId, 
        userId, 
        callId, 
        isInitiator 
      }, 'WebRTC peer connection created');
      
      return connectionId;
      
    } catch (error) {
      logger.error({ error, userId, callId }, 'Failed to create peer connection');
      throw new ConnectionError(`Failed to create peer connection: ${error.message}`);
    }
  }

  private setupPeerConnectionEventHandlers(context: PeerConnectionContext): void {
    const { peerConnection, id, userId, callId } = context;

    // Connection state changes
    peerConnection.onconnectionstatechange = () => {
      context.connectionState = peerConnection.connectionState;
      
      logger.info({
        connectionId: id,
        userId,
        callId,
        state: peerConnection.connectionState,
      }, 'WebRTC connection state changed');

      this.emit('connectionStateChange', {
        connectionId: id,
        userId,
        callId,
        state: peerConnection.connectionState,
      });

      // Handle connection failures
      if (peerConnection.connectionState === 'failed') {
        this.handleConnectionFailure(context);
      }
    };

    // ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      context.iceConnectionState = peerConnection.iceConnectionState;
      
      logger.debug({
        connectionId: id,
        iceState: peerConnection.iceConnectionState,
      }, 'ICE connection state changed');

      if (peerConnection.iceConnectionState === 'failed') {
        this.handleICEFailure(context);
      }
    };

    // ICE candidate gathering
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('iceCandidate', {
          connectionId: id,
          callId,
          candidate: event.candidate,
        });
        
        logger.debug({
          connectionId: id,
          candidateType: event.candidate.type,
        }, 'ICE candidate generated');
      }
    };

    // Remote stream handling
    peerConnection.ontrack = (event) => {
      logger.info({
        connectionId: id,
        streamId: event.streams[0]?.id,
      }, 'Remote track received');

      if (event.streams[0]) {
        context.remoteStream = event.streams[0];
        this.emit('remoteStream', {
          connectionId: id,
          callId,
          stream: event.streams[0],
        });
        
        // Start audio processing
        this.startAudioProcessing(context);
      }
    };

    // Data channel from remote peer
    peerConnection.ondatachannel = (event) => {
      if (!context.dataChannel) {
        context.dataChannel = event.channel;
        this.setupDataChannelHandlers(context);
        
        logger.info({
          connectionId: id,
          channelLabel: event.channel.label,
        }, 'Data channel received from remote peer');
      }
    };
  }

  private setupDataChannelHandlers(context: PeerConnectionContext): void {
    if (!context.dataChannel) return;

    const { dataChannel, id, callId } = context;

    dataChannel.onopen = () => {
      logger.info({
        connectionId: id,
        callId,
      }, 'WebRTC data channel opened');
      
      this.emit('dataChannelOpen', {
        connectionId: id,
        callId,
      });
    };

    dataChannel.onclose = () => {
      logger.info({
        connectionId: id,
        callId,
      }, 'WebRTC data channel closed');
    };

    dataChannel.onerror = (error) => {
      logger.error({
        error,
        connectionId: id,
        callId,
      }, 'WebRTC data channel error');
    };

    dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleDataChannelMessage(context, message);
      } catch (error) {
        logger.warn({
          error,
          connectionId: id,
          data: event.data,
        }, 'Invalid data channel message received');
      }
    };
  }

  private handleDataChannelMessage(context: PeerConnectionContext, message: any): void {
    const { id, callId } = context;
    
    logger.debug({
      connectionId: id,
      messageType: message.type,
    }, 'Data channel message received');

    switch (message.type) {
      case 'audio_chunk':
        this.handleRemoteAudioChunk(context, message.data);
        break;
      case 'audio_metadata':
        this.handleAudioMetadata(context, message.data);
        break;
      case 'quality_update':
        this.handleQualityUpdate(context, message.data);
        break;
      default:
        logger.debug({
          messageType: message.type,
        }, 'Unknown data channel message type');
    }
  }

  public async createOffer(connectionId: string): Promise<SessionDescription> {
    const context = this.peerConnections.get(connectionId);
    if (!context) {
      throw new ValidationError('Peer connection not found');
    }

    try {
      // Add audio transceiver for better control
      if (context.isInitiator) {
        const transceiver = context.peerConnection.addTransceiver('audio', {
          direction: 'sendrecv',
        });
        
        // Configure audio encoding parameters
        const sender = transceiver.sender;
        if (sender) {
          this.configureAudioSender(sender);
        }
      }

      const offer = await context.peerConnection.createOffer({
        offerToReceiveAudio: true,
        voiceActivityDetection: true,
      });

      await context.peerConnection.setLocalDescription(offer);

      logger.info({
        connectionId,
        callId: context.callId,
      }, 'WebRTC offer created');

      return {
        type: offer.type as 'offer',
        sdp: offer.sdp!,
      };
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
      }, 'Failed to create offer');
      throw new ConnectionError(`Failed to create offer: ${error.message}`);
    }
  }

  public async createAnswer(connectionId: string): Promise<SessionDescription> {
    const context = this.peerConnections.get(connectionId);
    if (!context) {
      throw new ValidationError('Peer connection not found');
    }

    try {
      const answer = await context.peerConnection.createAnswer({
        voiceActivityDetection: true,
      });

      await context.peerConnection.setLocalDescription(answer);

      logger.info({
        connectionId,
        callId: context.callId,
      }, 'WebRTC answer created');

      return {
        type: answer.type as 'answer',
        sdp: answer.sdp!,
      };
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
      }, 'Failed to create answer');
      throw new ConnectionError(`Failed to create answer: ${error.message}`);
    }
  }

  public async setRemoteDescription(
    connectionId: string, 
    description: SessionDescription
  ): Promise<void> {
    const context = this.peerConnections.get(connectionId);
    if (!context) {
      throw new ValidationError('Peer connection not found');
    }

    try {
      await context.peerConnection.setRemoteDescription({
        type: description.type,
        sdp: description.sdp,
      });

      logger.info({
        connectionId,
        descriptionType: description.type,
        callId: context.callId,
      }, 'Remote description set');
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
        descriptionType: description.type,
      }, 'Failed to set remote description');
      throw new ConnectionError(`Failed to set remote description: ${error.message}`);
    }
  }

  public async addIceCandidate(
    connectionId: string, 
    candidate: ICECandidate
  ): Promise<void> {
    const context = this.peerConnections.get(connectionId);
    if (!context) {
      throw new ValidationError('Peer connection not found');
    }

    try {
      await context.peerConnection.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });

      logger.debug({
        connectionId,
        candidateType: candidate.candidate.split(' ')[7],
      }, 'ICE candidate added');
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
        candidate: candidate.candidate.substring(0, 50),
      }, 'Failed to add ICE candidate');
      // Don't throw - ICE candidates can fail and that's normal
    }
  }

  public async setLocalStream(connectionId: string, stream: MediaStream): Promise<void> {
    const context = this.peerConnections.get(connectionId);
    if (!context) {
      throw new ValidationError('Peer connection not found');
    }

    try {
      context.localStream = stream;
      
      // Add tracks to peer connection
      stream.getTracks().forEach(track => {
        context.peerConnection.addTrack(track, stream);
      });

      // Configure audio sender
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const sender = context.peerConnection.getSenders().find(s => 
          s.track?.kind === 'audio'
        );
        if (sender) {
          this.configureAudioSender(sender);
        }
      }

      logger.info({
        connectionId,
        trackCount: stream.getTracks().length,
        audioTracks: stream.getAudioTracks().length,
      }, 'Local stream set');
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
      }, 'Failed to set local stream');
      throw new ConnectionError(`Failed to set local stream: ${error.message}`);
    }
  }

  private configureAudioSender(sender: RTCRtpSender): void {
    const params = sender.getParameters();
    
    if (params.encodings && params.encodings.length > 0) {
      params.encodings[0].maxBitrate = this.config.bitrateLimit;
      params.encodings[0].priority = 'high';
      
      sender.setParameters(params).catch(error => {
        logger.warn({ error }, 'Failed to configure audio sender parameters');
      });
    }
  }

  private async startAudioProcessing(context: PeerConnectionContext): Promise<void> {
    if (!context.remoteStream) return;

    const audioTrack = context.remoteStream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      // Create audio context for processing
      const audioContext = new AudioContext({
        sampleRate: 16000,
        latencyHint: 'interactive',
      });

      const source = audioContext.createMediaStreamSource(context.remoteStream);
      
      // Create audio processor for real-time audio chunks
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer;
        const audioData = inputBuffer.getChannelData(0);
        
        // Convert to audio chunk format
        const audioChunk: AudioChunk = {
          id: uuidv4(),
          callId: context.callId,
          timestamp: Date.now(),
          audioData: Buffer.from(audioData.buffer),
          sequenceNumber: Date.now(), // Use timestamp as sequence
          sampleRate: audioContext.sampleRate,
          channels: 1,
          format: AudioFormat.PCM,
        };

        this.emit('audioChunk', {
          connectionId: context.id,
          audioChunk,
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      logger.info({
        connectionId: context.id,
        sampleRate: audioContext.sampleRate,
      }, 'Audio processing started');
      
    } catch (error) {
      logger.error({
        error,
        connectionId: context.id,
      }, 'Failed to start audio processing');
    }
  }

  public async sendAudioData(
    connectionId: string, 
    audioData: Buffer, 
    metadata: any = {}
  ): Promise<void> {
    const context = this.peerConnections.get(connectionId);
    if (!context?.dataChannel || context.dataChannel.readyState !== 'open') {
      throw new ConnectionError('Data channel not available');
    }

    try {
      const message = {
        type: 'audio_chunk',
        data: {
          audio: audioData.toString('base64'),
          metadata,
          timestamp: Date.now(),
        },
      };

      context.dataChannel.send(JSON.stringify(message));
      context.stats.bytesSent += audioData.length;
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
      }, 'Failed to send audio data');
      throw new ConnectionError(`Failed to send audio data: ${error.message}`);
    }
  }

  private handleRemoteAudioChunk(context: PeerConnectionContext, data: any): void {
    try {
      const audioBuffer = Buffer.from(data.audio, 'base64');
      
      const audioChunk: AudioChunk = {
        id: uuidv4(),
        callId: context.callId,
        timestamp: data.timestamp,
        audioData: audioBuffer,
        sequenceNumber: data.timestamp,
        sampleRate: data.metadata?.sampleRate || 16000,
        channels: data.metadata?.channels || 1,
        format: AudioFormat.PCM,
      };

      context.stats.audioPacketsReceived++;
      context.stats.bytesReceived += audioBuffer.length;

      this.emit('audioChunk', {
        connectionId: context.id,
        audioChunk,
      });
      
    } catch (error) {
      logger.error({
        error,
        connectionId: context.id,
      }, 'Failed to handle remote audio chunk');
    }
  }

  private handleAudioMetadata(context: PeerConnectionContext, metadata: any): void {
    logger.debug({
      connectionId: context.id,
      metadata,
    }, 'Audio metadata received');
  }

  private handleQualityUpdate(context: PeerConnectionContext, qualityData: any): void {
    logger.debug({
      connectionId: context.id,
      quality: qualityData,
    }, 'Quality update received');
    
    // Adjust encoding parameters based on quality feedback
    if (qualityData.bitrate && context.localStream) {
      const audioTrack = context.localStream.getAudioTracks()[0];
      if (audioTrack) {
        const sender = context.peerConnection.getSenders().find(s => 
          s.track === audioTrack
        );
        if (sender) {
          this.adjustBitrate(sender, qualityData.bitrate);
        }
      }
    }
  }

  private adjustBitrate(sender: RTCRtpSender, targetBitrate: number): void {
    const params = sender.getParameters();
    if (params.encodings && params.encodings.length > 0) {
      params.encodings[0].maxBitrate = Math.min(targetBitrate, this.config.bitrateLimit);
      sender.setParameters(params).catch(error => {
        logger.warn({ error }, 'Failed to adjust bitrate');
      });
    }
  }

  private handleConnectionFailure(context: PeerConnectionContext): void {
    logger.error({
      connectionId: context.id,
      callId: context.callId,
      duration: Date.now() - context.startTime,
    }, 'WebRTC connection failed');

    this.emit('connectionFailed', {
      connectionId: context.id,
      callId: context.callId,
      userId: context.userId,
    });
  }

  private handleICEFailure(context: PeerConnectionContext): void {
    logger.error({
      connectionId: context.id,
      callId: context.callId,
    }, 'ICE connection failed');

    // Attempt ICE restart
    this.restartICE(context.id).catch(error => {
      logger.error({ error }, 'Failed to restart ICE');
    });
  }

  public async restartICE(connectionId: string): Promise<void> {
    const context = this.peerConnections.get(connectionId);
    if (!context) {
      throw new ValidationError('Peer connection not found');
    }

    try {
      await context.peerConnection.restartIce();
      logger.info({ connectionId }, 'ICE restart initiated');
    } catch (error) {
      logger.error({ error, connectionId }, 'Failed to restart ICE');
      throw new ConnectionError(`Failed to restart ICE: ${error.message}`);
    }
  }

  private startStatsCollection(): void {
    this.statsInterval = setInterval(async () => {
      for (const context of this.peerConnections.values()) {
        try {
          await this.collectStats(context);
        } catch (error) {
          logger.warn({
            error,
            connectionId: context.id,
          }, 'Failed to collect stats');
        }
      }
    }, 5000); // Collect stats every 5 seconds
  }

  private async collectStats(context: PeerConnectionContext): Promise<void> {
    const stats = await context.peerConnection.getStats();
    
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        context.stats.audioPacketsReceived = report.packetsReceived || 0;
        context.stats.bytesReceived = report.bytesReceived || 0;
        context.stats.jitter = report.jitter || 0;
        context.stats.packetsLost = report.packetsLost || 0;
      } else if (report.type === 'outbound-rtp' && report.kind === 'audio') {
        context.stats.audioPacketsSent = report.packetsSent || 0;
        context.stats.bytesSent = report.bytesSent || 0;
      } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        context.stats.roundTripTime = report.currentRoundTripTime || 0;
      }
    });

    this.emit('statsUpdate', {
      connectionId: context.id,
      callId: context.callId,
      stats: context.stats,
    });
  }

  public async getConnectionStats(connectionId: string): Promise<ConnectionStats | null> {
    const context = this.peerConnections.get(connectionId);
    return context ? context.stats : null;
  }

  public async getAllConnectionStats(): Promise<Map<string, ConnectionStats>> {
    const allStats = new Map<string, ConnectionStats>();
    
    for (const [connectionId, context] of this.peerConnections) {
      allStats.set(connectionId, { ...context.stats });
    }
    
    return allStats;
  }

  public async closePeerConnection(connectionId: string): Promise<void> {
    const context = this.peerConnections.get(connectionId);
    if (!context) return;

    try {
      // Close data channel
      if (context.dataChannel) {
        context.dataChannel.close();
      }

      // Close local stream
      if (context.localStream) {
        context.localStream.getTracks().forEach(track => track.stop());
      }

      // Close peer connection
      context.peerConnection.close();
      
      this.peerConnections.delete(connectionId);

      logger.info({
        connectionId,
        callId: context.callId,
        duration: Date.now() - context.startTime,
      }, 'WebRTC peer connection closed');
      
    } catch (error) {
      logger.error({
        error,
        connectionId,
      }, 'Error closing peer connection');
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down WebRTC manager');

    // Stop stats collection
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Close all peer connections
    const closePromises = Array.from(this.peerConnections.keys()).map(
      connectionId => this.closePeerConnection(connectionId)
    );

    await Promise.allSettled(closePromises);

    this.peerConnections.clear();
    this.removeAllListeners();

    logger.info('WebRTC manager shutdown complete');
  }
}

export default WebRTCManager;