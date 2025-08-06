/**
 * Realtime Processor Service Client
 */

import { HttpClient } from '../client/HttpClient';
import { serviceRegistry } from '../discovery/ServiceRegistry';
import { 
  ApiRequestOptions, 
  ApiResponse,
  AudioProcessingRequest,
  AudioProcessingResult
} from '../types';

export class RealtimeProcessorClient {
  private httpClient: HttpClient;

  constructor() {
    const serviceUrl = serviceRegistry.getUrl('realtime-processor');
    this.httpClient = new HttpClient(serviceUrl, 'realtime-processor');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck();
  }

  /**
   * Get service metrics
   */
  async getMetrics(options?: ApiRequestOptions): Promise<ApiResponse<{
    timestamp: string;
    service: string;
    metrics: {
      active_connections: number;
      total_connections: number;
      messages_processed: number;
      avg_processing_time_ms: number;
      error_rate: number;
      cache_hit_rate: number;
    };
    system: {
      memory_usage_mb: number;
      cpu_usage_percent: number;
      uptime_seconds: number;
    };
  }>> {
    return this.httpClient.get('/metrics', options);
  }

  /**
   * Get WebSocket connections info
   */
  async getConnections(options?: ApiRequestOptions): Promise<ApiResponse<{
    total_connections: number;
    active_connections: number;
    connections_by_user: Record<string, number>;
    connections_by_call: Record<string, {
      user_id: string;
      connected_at: string;
      last_activity: string;
      messages_sent: number;
      messages_received: number;
    }>;
  }>> {
    return this.httpClient.get('/connections', options);
  }

  /**
   * Process audio (for testing/debugging)
   */
  async processAudio(
    request: AudioProcessingRequest,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<AudioProcessingResult>> {
    return this.httpClient.post('/process/audio', request, options);
  }

  /**
   * Get processing status for a call
   */
  async getProcessingStatus(
    callId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    call_id: string;
    status: 'active' | 'inactive' | 'completed' | 'error';
    connected_at?: string;
    last_activity?: string;
    messages_processed: number;
    avg_processing_time_ms: number;
    current_stage?: string;
    error_count: number;
    last_error?: {
      timestamp: string;
      error: string;
      stack?: string;
    };
  }>> {
    return this.httpClient.get(`/process/status/${callId}`, options);
  }

  /**
   * Start audio processing session (HTTP-based setup)
   */
  async startProcessingSession(
    sessionRequest: {
      call_id: string;
      user_id: string;
      caller_phone: string;
      audio_config?: {
        sample_rate?: number;
        channels?: number;
        encoding?: string;
      };
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    session_id: string;
    websocket_url: string;
    protocols: string[];
    authentication_token: string;
    expires_at: string;
  }>> {
    return this.httpClient.post('/process/start-session', sessionRequest, options);
  }

  /**
   * End audio processing session
   */
  async endProcessingSession(
    sessionId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    session_id: string;
    ended_at: string;
    duration_ms: number;
    total_messages: number;
    total_audio_seconds: number;
    final_summary?: string;
  }>> {
    return this.httpClient.post(`/process/end-session/${sessionId}`, {}, options);
  }

  /**
   * Get audio processing configuration
   */
  async getProcessingConfig(options?: ApiRequestOptions): Promise<ApiResponse<{
    supported_formats: string[];
    max_audio_duration_seconds: number;
    max_message_size_bytes: number;
    timeout_settings: {
      connection_timeout_ms: number;
      processing_timeout_ms: number;
      idle_timeout_ms: number;
    };
    performance_settings: {
      max_concurrent_connections: number;
      rate_limit_per_minute: number;
      circuit_breaker_threshold: number;
    };
  }>> {
    return this.httpClient.get('/process/config', options);
  }

  /**
   * Update processing configuration (admin)
   */
  async updateProcessingConfig(
    config: Record<string, any>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    success: boolean;
    updated_config: Record<string, any>;
    restart_required: boolean;
  }>> {
    return this.httpClient.put('/process/config', config, options);
  }

  /**
   * Get audio analytics
   */
  async getAudioAnalytics(
    params?: {
      call_id?: string;
      user_id?: string;
      date_from?: string;
      date_to?: string;
      limit?: number;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    total_sessions: number;
    avg_session_duration_ms: number;
    avg_processing_latency_ms: number;
    audio_quality_metrics: {
      avg_clarity_score: number;
      noise_level_avg: number;
      speech_recognition_accuracy: number;
    };
    performance_metrics: {
      throughput_messages_per_second: number;
      error_rate_percent: number;
      cache_hit_rate_percent: number;
    };
    top_intents: Array<{
      intent: string;
      count: number;
      avg_confidence: number;
    }>;
  }>> {
    const query = new URLSearchParams();
    if (params?.call_id) query.append('call_id', params.call_id);
    if (params?.user_id) query.append('user_id', params.user_id);
    if (params?.date_from) query.append('date_from', params.date_from);
    if (params?.date_to) query.append('date_to', params.date_to);
    if (params?.limit) query.append('limit', params.limit.toString());

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/analytics/audio${queryString}`, options);
  }

  /**
   * Test WebSocket connection
   */
  async testWebSocketConnection(options?: ApiRequestOptions): Promise<ApiResponse<{
    websocket_url: string;
    test_token: string;
    connection_test_passed: boolean;
    latency_ms?: number;
    error?: string;
  }>> {
    return this.httpClient.post('/test/websocket', {}, options);
  }

  /**
   * Get service info
   */
  async getServiceInfo(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    version: string;
    description: string;
    endpoints: Record<string, string>;
    websocket: {
      endpoint: string;
      protocols: string[];
      authentication: string;
    };
  }>> {
    return this.httpClient.get('/', options);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.httpClient.getCircuitBreakerStatus();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.httpClient.resetCircuitBreaker();
  }
}