/**
 * Profile Analytics Service Client
 */

import { HttpClient } from '../client/HttpClient';
import { serviceRegistry } from '../discovery/ServiceRegistry';
import { ApiRequestOptions, ApiResponse } from '../types';

export class ProfileAnalyticsClient {
  private httpClient: HttpClient;

  constructor() {
    const serviceUrl = serviceRegistry.getUrl('profile-analytics');
    this.httpClient = new HttpClient(serviceUrl, 'profile-analytics');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck();
  }

  /**
   * Get caller profile by phone number
   */
  async getCallerProfile(
    phoneNumber: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    phone_hash: string;
    spam_category: string;
    risk_score: number;
    confidence_level: number;
    behavioral_patterns: Record<string, any>;
    total_reports: number;
    last_activity: string;
    created_at: string;
    updated_at: string;
  }>> {
    return this.httpClient.get(`/api/v1/analytics/profile/${encodeURIComponent(phoneNumber)}`, options);
  }

  /**
   * Update caller profile
   */
  async updateCallerProfile(
    phoneNumber: string,
    updates: {
      spam_category?: string;
      risk_score?: number;
      confidence_level?: number;
      behavioral_patterns?: Record<string, any>;
      user_feedback?: string;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    success: boolean;
    updated_profile: any;
    processing_time_ms: number;
  }>> {
    return this.httpClient.post('/api/v1/analytics/profile/update', {
      phone_number: phoneNumber,
      ...updates
    }, options);
  }

  /**
   * Analyze call for profiling
   */
  async analyzeCall(
    callAnalysis: {
      call_id: string;
      user_id: string;
      caller_phone: string;
      duration_seconds: number;
      conversation_transcript: string;
      detected_intent: string;
      emotional_state: string;
      outcome: 'completed' | 'transferred' | 'hung_up';
      effectiveness_score: number;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    analysis_id: string;
    spam_indicators: {
      keyword_matches: string[];
      pattern_matches: string[];
      behavioral_flags: string[];
    };
    risk_assessment: {
      risk_score: number;
      confidence: number;
      recommendation: string;
    };
    profile_updates: {
      updated_fields: string[];
      previous_risk_score: number;
      new_risk_score: number;
    };
    processing_time_ms: number;
  }>> {
    return this.httpClient.post('/api/v1/analytics/call/analyze', callAnalysis, options);
  }

  /**
   * Get user-specific trends
   */
  async getUserTrends(
    userId: string,
    params?: {
      timeframe?: '24h' | '7d' | '30d' | '90d';
      metrics?: string[];
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    user_id: string;
    timeframe: string;
    trends: {
      call_volume: {
        current_period: number;
        previous_period: number;
        change_percent: number;
        trend_direction: 'up' | 'down' | 'stable';
      };
      spam_detection: {
        spam_calls_blocked: number;
        false_positives: number;
        accuracy_rate: number;
      };
      response_effectiveness: {
        avg_call_duration: number;
        successful_terminations: number;
        user_satisfaction_score: number;
      };
    };
    top_spam_categories: Array<{
      category: string;
      count: number;
      percentage: number;
    }>;
  }>> {
    const query = new URLSearchParams();
    if (params?.timeframe) query.append('timeframe', params.timeframe);
    if (params?.metrics) params.metrics.forEach(metric => query.append('metrics', metric));

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/api/v1/analytics/trends/${userId}${queryString}`, options);
  }

  /**
   * Machine learning optimization
   */
  async submitLearningData(
    learningData: {
      user_id: string;
      caller_phone: string;
      predicted_category: string;
      actual_outcome: string;
      confidence_score: number;
      user_feedback?: 'correct' | 'incorrect' | 'partial';
      context: Record<string, any>;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    learning_id: string;
    model_impact: {
      weight_adjustment: number;
      confidence_impact: number;
      category_update: boolean;
    };
    processing_time_ms: number;
  }>> {
    return this.httpClient.post('/api/v1/analytics/learning', learningData, options);
  }

  /**
   * Get global spam statistics
   */
  async getGlobalStats(
    params?: {
      timeframe?: '24h' | '7d' | '30d';
      category?: string;
    },
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    timeframe: string;
    global_metrics: {
      total_calls_analyzed: number;
      spam_detection_rate: number;
      false_positive_rate: number;
      model_accuracy: number;
    };
    category_breakdown: Array<{
      category: string;
      count: number;
      percentage: number;
      avg_risk_score: number;
    }>;
    geographic_distribution: Array<{
      region: string;
      call_count: number;
      spam_rate: number;
    }>;
    trending_patterns: Array<{
      pattern: string;
      growth_rate: number;
      risk_level: 'low' | 'medium' | 'high';
    }>;
  }>> {
    const query = new URLSearchParams();
    if (params?.timeframe) query.append('timeframe', params.timeframe);
    if (params?.category) query.append('category', params.category);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/api/v1/analytics/global-stats${queryString}`, options);
  }

  /**
   * Export user data (GDPR compliance)
   */
  async exportUserData(
    userId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    export_id: string;
    user_data: {
      profiles_created: any[];
      calls_analyzed: any[];
      learning_contributions: any[];
      trends_data: any;
    };
    export_timestamp: string;
    data_retention_info: {
      oldest_record: string;
      newest_record: string;
      total_records: number;
    };
  }>> {
    return this.httpClient.get(`/api/v1/analytics/export/${userId}`, options);
  }

  /**
   * Delete user analytics data
   */
  async deleteUserData(
    userId: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<{
    deletion_id: string;
    deleted_records: {
      profiles: number;
      call_analyses: number;
      learning_data: number;
      trends: number;
    };
    anonymized_records: {
      aggregated_stats: number;
      model_training_data: number;
    };
    deletion_timestamp: string;
    verification_hash: string;
  }>> {
    return this.httpClient.delete(`/api/v1/analytics/user-data/${userId}`, options);
  }

  /**
   * Get model performance metrics
   */
  async getModelMetrics(options?: ApiRequestOptions): Promise<ApiResponse<{
    model_version: string;
    last_training_date: string;
    performance_metrics: {
      accuracy: number;
      precision: number;
      recall: number;
      f1_score: number;
    };
    feature_importance: Array<{
      feature: string;
      importance_score: number;
    }>;
    training_data_stats: {
      total_samples: number;
      positive_samples: number;
      negative_samples: number;
      data_quality_score: number;
    };
  }>> {
    return this.httpClient.get('/api/v1/analytics/model/metrics', options);
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