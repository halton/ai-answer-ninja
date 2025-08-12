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
  enableTranscription?: boolean;
  customHeaders?: { [key: string]: string };
  timeout?: number;
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