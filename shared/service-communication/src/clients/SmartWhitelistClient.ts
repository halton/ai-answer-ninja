/**
 * Smart Whitelist Service Client
 */

import { HttpClient } from '../client/HttpClient';
import { serviceRegistry } from '../discovery/ServiceRegistry';
import { 
  ApiRequestOptions, 
  ApiResponse, 
  WhitelistEntry, 
  WhitelistEvaluationRequest,
  WhitelistEvaluationResult,
  SmartAddRequest 
} from '../types';

export class SmartWhitelistClient {
  private httpClient: HttpClient;

  constructor() {
    const serviceUrl = serviceRegistry.getUrl('smart-whitelist');
    this.httpClient = new HttpClient(serviceUrl, 'smart-whitelist');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck();
  }

  /**
   * Get whitelist entries for user
   */
  async getWhitelist(
    userId: string, 
    params?: {
      phone?: string;
      limit?: number;
      offset?: number;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    entries?: WhitelistEntry[];
    entry?: WhitelistEntry;
    meta: {
      processing_time_ms: number;
      source?: string;
      limit?: number;
      offset?: number;
      total?: number;
    };
  }>> {
    const query = new URLSearchParams();
    if (params?.phone) query.append('phone', params.phone);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/api/v1/whitelist/${userId}${queryString}`, options);
  }

  /**
   * Check if phone number is whitelisted
   */
  async isWhitelisted(
    userId: string, 
    phone: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    entry?: WhitelistEntry;
    meta: {
      processing_time_ms: number;
      source: string;
    };
  }>> {
    return this.getWhitelist(userId, { phone }, options);
  }

  /**
   * Smart add phone number to whitelist
   */
  async smartAdd(
    userId: string,
    request: Omit<SmartAddRequest, 'user_id'>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    entry: WhitelistEntry;
    meta: {
      processing_time_ms: number;
      operation: string;
    };
  }>> {
    return this.httpClient.post(`/api/v1/whitelist/${userId}/smart-add`, request, options);
  }

  /**
   * Remove phone number from whitelist
   */
  async remove(
    userId: string,
    phone: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    message: string;
    meta: {
      processing_time_ms: number;
      operation: string;
    };
  }>> {
    return this.httpClient.delete(`/api/v1/whitelist/${userId}/${encodeURIComponent(phone)}`, options);
  }

  /**
   * Evaluate phone number using ML
   */
  async evaluatePhone(
    phone: string,
    params?: {
      user_id?: string;
      context?: string;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    result: WhitelistEvaluationResult;
    meta: {
      processing_time_ms: number;
      operation: string;
    };
  }>> {
    const query = new URLSearchParams();
    if (params?.user_id) query.append('user_id', params.user_id);
    if (params?.context) query.append('context', params.context);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/api/v1/whitelist/evaluate/${encodeURIComponent(phone)}${queryString}`, options);
  }

  /**
   * Record learning feedback
   */
  async recordLearning(
    learningEvent: {
      user_id: string;
      phone: string;
      event_type: string;
      outcome: string;
      confidence?: number;
      context?: Record<string, any>;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    message: string;
    meta: {
      processing_time_ms: number;
      operation: string;
    };
  }>> {
    return this.httpClient.post('/api/v1/whitelist/learning', learningEvent, options);
  }

  /**
   * Update user-specific rules
   */
  async updateRules(
    userId: string,
    rules: Record<string, any>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    message: string;
    meta: {
      processing_time_ms: number;
      operation: string;
    };
  }>> {
    return this.httpClient.put(`/api/v1/whitelist/rules/${userId}`, rules, options);
  }

  /**
   * Get whitelist statistics
   */
  async getStats(
    userId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    whitelist: {
      total_entries: number;
      manual_entries: number;
      auto_entries: number;
      temporary_entries: number;
      active_entries: number;
    };
    learning: {
      total_events: number;
      accuracy_rate: number;
      confidence_avg: number;
    };
    meta: {
      processing_time_ms: number;
      operation: string;
    };
  }>> {
    return this.httpClient.get(`/api/v1/whitelist/stats/${userId}`, options);
  }

  /**
   * Bulk operations
   */
  async bulkAdd(
    userId: string,
    entries: Array<Omit<SmartAddRequest, 'user_id'>>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    success: number;
    failed: number;
    results: Array<{
      phone: string;
      success: boolean;
      entry?: WhitelistEntry;
      error?: string;
    }>;
  }>> {
    return this.httpClient.post(`/api/v1/whitelist/${userId}/bulk-add`, { entries }, options);
  }

  /**
   * Bulk remove
   */
  async bulkRemove(
    userId: string,
    phones: string[],
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    success: number;
    failed: number;
    results: Array<{
      phone: string;
      success: boolean;
      error?: string;
    }>;
  }>> {
    return this.httpClient.post(`/api/v1/whitelist/${userId}/bulk-remove`, { phones }, options);
  }

  /**
   * Get service info
   */
  async getServiceInfo(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    status: string;
    timestamp: string;
    version: string;
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