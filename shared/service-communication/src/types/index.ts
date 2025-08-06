/**
 * Core types for service communication
 */

export interface ServiceEndpoint {
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  healthPath?: string;
  timeout?: number;
}

export interface ServiceRegistry {
  [serviceName: string]: ServiceEndpoint;
}

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  timestamp: string;
  responseTime?: number;
  details?: any;
}

export interface CircuitBreakerOptions {
  threshold: number;
  timeout: number;
  monitoringPeriod: number;
  resetTimeout: number;
}

export interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export interface ApiRequestOptions {
  timeout?: number;
  retries?: RetryOptions;
  headers?: Record<string, string>;
  circuitBreaker?: boolean;
}

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
  duration: number;
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: any;
  service?: string;
  endpoint?: string;
}

// Service-specific types
export interface UserProfile {
  id: string;
  phone_number: string;
  name: string;
  personality?: string;
  voice_profile_id?: string;
  preferences?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface WhitelistEntry {
  id: string;
  user_id: string;
  contact_phone: string;
  contact_name?: string;
  whitelist_type: 'manual' | 'auto' | 'temporary';
  confidence_score: number;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationContext {
  call_id: string;
  user_id: string;
  caller_phone: string;
  current_stage: string;
  emotional_state: string;
  turn_count: number;
  start_time: string;
  conversation_history: ConversationMessage[];
}

export interface ConversationMessage {
  speaker: 'user' | 'ai';
  text: string;
  timestamp: string;
  intent?: string;
  intent_confidence?: number;
  emotion?: string;
  emotion_confidence?: number;
  processing_time_ms?: number;
  cached?: boolean;
}

export interface ConversationRequest {
  call_id: string;
  user_id: string;
  caller_phone: string;
  input_text: string;
  detected_intent?: string;
  intent_confidence?: number;
  spam_category?: string;
}

export interface ConversationResponse {
  response_text: string;
  intent: string;
  emotional_tone: string;
  confidence: number;
  should_terminate: boolean;
  next_stage: string;
  processing_time_ms: number;
  cached: boolean;
  turn_number: number;
  conversation_id: string;
  response_strategy?: string;
  cache_key?: string;
  suggested_cache_ttl?: number;
}

export interface WhitelistEvaluationRequest {
  phone: string;
  user_id?: string;
  context?: Record<string, any>;
}

export interface WhitelistEvaluationResult {
  classification: 'trusted' | 'spam' | 'unknown';
  confidence: number;
  should_whitelist: boolean;
  reason: string;
  risk_score: number;
}

export interface SmartAddRequest {
  user_id: string;
  contact_phone: string;
  contact_name?: string;
  confidence_score?: number;
  reason?: string;
  context?: Record<string, any>;
}

// Audio processing types
export interface AudioProcessingRequest {
  call_id: string;
  user_id: string;
  audio_data: string; // base64 encoded
  sequence_number: number;
  timestamp: number;
}

export interface AudioProcessingResult {
  transcript?: string;
  confidence?: number;
  intent?: string;
  emotion?: string;
  response_audio?: string; // base64 encoded
  processing_time_ms: number;
}