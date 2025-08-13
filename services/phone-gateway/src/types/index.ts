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

export interface WhitelistCheckResult {
  isWhitelisted: boolean;
  confidence: number;
  source: 'manual' | 'auto' | 'temporary';
  reason?: string;
}

export interface UserProfile {
  id: string;
  phoneNumber: string;
  name: string;
  personality?: string;
  preferences?: any;
  isActive: boolean;
}

export interface CallRecord {
  id: string;
  userId: string;
  callerPhone: string;
  callType: 'incoming' | 'outgoing';
  callStatus: 'answered' | 'missed' | 'rejected' | 'transferred' | 'ai_handled';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  azureCallId: string;
  routingDecision?: CallRoutingDecision;
}

export interface ServiceHealthStatus {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency?: number;
  error?: string;
  timestamp: Date;
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

export interface ServiceClient {
  get<T>(endpoint: string, params?: any): Promise<T>;
  post<T>(endpoint: string, data?: any): Promise<T>;
  put<T>(endpoint: string, data?: any): Promise<T>;
  delete<T>(endpoint: string): Promise<T>;
}

export interface PhoneGatewayError extends Error {
  code: string;
  statusCode: number;
  details?: any;
}

export interface CallProcessingContext {
  callId: string;
  userId: string;
  callerPhone: string;
  userProfile: UserProfile;
  whitelistResult: WhitelistCheckResult;
  timestamp: Date;
  metadata?: any;
}

export interface AzureCommunicationEvent {
  id: string;
  topic: string;
  subject: string;
  eventType: string;
  eventTime: string;
  data: any;
  dataVersion: string;
  metadataVersion: string;
}

export interface CallControlOptions {
  recordCall?: boolean;
  recordingStorageUrl?: string;
  enableTranscription?: boolean;
  transcriptionLocale?: string;
  enableMediaStreaming?: boolean;
  customHeaders?: { [key: string]: string };
  timeout?: number;
  metadata?: any;
}

export interface QueuedCallJob {
  id: string;
  callId: string;
  action: string;
  data: any;
  priority: number;
  attempts: number;
  delay?: number;
  createdAt: Date;
}

export interface CallState {
  callId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'failed' | 'on-hold';
  startTime: Date;
  endTime?: Date;
  connectionId?: string;
  participants: any[];
  isRecording: boolean;
  recordingId?: string;
  metadata: any;
}

export interface CallMetrics {
  callId: string;
  startTime: number;
  endTime?: number;
  audioPacketsReceived: number;
  audioPacketsSent: number;
  audioQuality: number; // 0-1 scale
  latency: number; // ms
  jitter: number; // ms
  packetLoss: number; // percentage
}

export interface RecordingInfo {
  recordingId: string;
  status: 'active' | 'stopped' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  storageUrl: string;
  recordingUrl?: string;
  duration?: number;
  fileSize?: number;
}

export interface TranscriptionSegment {
  text: string;
  speaker: string;
  timestamp: number;
  confidence: number;
  language?: string;
}

export interface MediaStreamingEvent {
  eventType: 'audio' | 'transcription' | 'metadata';
  timestamp: number;
  data: any;
  sequenceNumber: number;
}

export interface WebhookValidation {
  isValid: boolean;
  signature?: string;
  timestamp?: number;
  reason?: string;
}