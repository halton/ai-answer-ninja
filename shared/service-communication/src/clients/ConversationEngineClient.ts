/**
 * Conversation Engine Service Client
 */

import { HttpClient } from '../client/HttpClient';
import { serviceRegistry } from '../discovery/ServiceRegistry';
import { 
  ApiRequestOptions, 
  ApiResponse, 
  ConversationRequest,
  ConversationResponse,
  ConversationContext,
  ConversationMessage
} from '../types';

export class ConversationEngineClient {
  private httpClient: HttpClient;

  constructor() {
    const serviceUrl = serviceRegistry.getUrl('conversation-engine');
    this.httpClient = new HttpClient(serviceUrl, 'conversation-engine');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck('/api/v1/health');
  }

  /**
   * Detailed health check
   */
  async detailedHealthCheck(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    overall_status: string;
    timestamp: string;
    version: string;
    components: Record<string, {
      status: string;
      error?: string;
      response_time_ms?: number;
      total_requests?: number;
      avg_response_time_ms?: number;
      cache_hit_rate?: number;
    }>;
  }>> {
    return this.httpClient.get('/api/v1/health/detailed', options);
  }

  /**
   * Readiness check
   */
  async readinessCheck(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    ready: boolean;
    timestamp: string;
    checks: Record<string, {
      ready: boolean;
      error?: string;
    }>;
  }>> {
    return this.httpClient.get('/api/v1/health/readiness', options);
  }

  /**
   * Liveness check
   */
  async livenessCheck(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    alive: boolean;
    timestamp: string;
    uptime_seconds: number;
    memory_usage: number;
    active_conversations: number;
  }>> {
    return this.httpClient.get('/api/v1/health/liveness', options);
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(options?: ApiRequestOptions): Promise<ApiResponse<{
    timestamp: string;
    service: string;
    performance: {
      active_conversations: number;
      total_conversations: number;
      avg_conversation_duration: number;
      cache_performance: any;
      ai_service_performance: any;
      sentiment_analysis_performance: any;
    };
    system_resources: {
      memory_usage_mb: number;
      uptime_seconds: number;
    };
  }>> {
    return this.httpClient.get('/api/v1/health/metrics/performance', options);
  }

  /**
   * Manage conversation (main conversation endpoint)
   */
  async manageConversation(
    request: ConversationRequest,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<ConversationResponse>> {
    return this.httpClient.post('/api/v1/conversation/manage', request, options);
  }

  /**
   * Personalize response
   */
  async personalizeResponse(
    callId: string,
    userId: string,
    personalizationContext: Record<string, any>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    personalized_response: string;
    personalization_applied: boolean;
    confidence: number;
    emotional_tone: string;
    strategy: string;
    processing_time_ms: number;
  }>> {
    return this.httpClient.post('/api/v1/conversation/personalize', {
      call_id: callId,
      user_id: userId,
      personalization_context: personalizationContext
    }, options);
  }

  /**
   * Analyze emotion
   */
  async analyzeEmotion(
    text: string,
    callId?: string,
    conversationHistory?: Array<Record<string, any>>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    emotional_state: string;
    confidence: number;
    persistence_score?: number;
    frustration_level?: number;
    response_recommendations?: string[];
  }>> {
    return this.httpClient.post('/api/v1/conversation/emotion/analyze', {
      text,
      call_id: callId,
      conversation_history: conversationHistory
    }, options);
  }

  /**
   * Get conversation state
   */
  async getConversationState(
    callId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    call_id: string;
    user_id: string;
    current_stage: string;
    emotional_state: string;
    turn_count: number;
    start_time: string;
    duration_seconds: number;
    conversation_history: ConversationMessage[];
    analytics: any;
  }>> {
    return this.httpClient.get(`/api/v1/conversation/state/${callId}`, options);
  }

  /**
   * Terminate conversation
   */
  async terminateConversation(
    callId: string,
    reason?: string,
    summary?: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    success: boolean;
    reason?: string;
    call_id: string;
    termination_time: string;
    final_summary?: string;
  }>> {
    const data: any = {};
    if (reason) data.reason = reason;
    if (summary) data.summary = summary;

    return this.httpClient.post(`/api/v1/conversation/terminate/${callId}`, data, options);
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(
    callId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<ConversationMessage[]>> {
    return this.httpClient.get(`/api/v1/conversation/history/${callId}`, options);
  }

  /**
   * Batch terminate conversations
   */
  async batchTerminateConversations(
    callIds: string[],
    reason: string = 'batch_termination',
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    total: number;
    successful: number;
    failed: number;
    results: Array<{
      call_id: string;
      success: boolean;
      reason?: string;
      error?: string;
    }>;
  }>> {
    return this.httpClient.post('/api/v1/conversation/batch/terminate', {
      call_ids: callIds,
      reason
    }, options);
  }

  /**
   * Analytics endpoints
   */

  /**
   * Get conversation analytics
   */
  async getAnalytics(
    params?: {
      user_id?: string;
      date_from?: string;
      date_to?: string;
      limit?: number;
      offset?: number;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    total_conversations: number;
    avg_duration: number;
    success_rate: number;
    top_intents: Array<{ intent: string; count: number }>;
    emotional_distribution: Record<string, number>;
    performance_metrics: {
      avg_response_time_ms: number;
      cache_hit_rate: number;
    };
  }>> {
    const query = new URLSearchParams();
    if (params?.user_id) query.append('user_id', params.user_id);
    if (params?.date_from) query.append('date_from', params.date_from);
    if (params?.date_to) query.append('date_to', params.date_to);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/api/v1/analytics${queryString}`, options);
  }

  /**
   * Get trending topics
   */
  async getTrendingTopics(
    timeframe: 'hour' | 'day' | 'week' = 'day',
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    topics: Array<{
      topic: string;
      count: number;
      sentiment: string;
      trend_direction: 'up' | 'down' | 'stable';
    }>;
    timeframe: string;
    generated_at: string;
  }>> {
    return this.httpClient.get(`/api/v1/analytics/trending/${timeframe}`, options);
  }

  /**
   * Get service info
   */
  async getServiceInfo(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    version: string;
    status: string;
    timestamp: string;
    endpoints: Record<string, string>;
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