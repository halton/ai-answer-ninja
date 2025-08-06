/**
 * User Management Service Client
 */

import { HttpClient } from '../client/HttpClient';
import { serviceRegistry } from '../discovery/ServiceRegistry';
import { ApiRequestOptions, ApiResponse, UserProfile } from '../types';

export class UserManagementClient {
  private httpClient: HttpClient;

  constructor() {
    const serviceUrl = serviceRegistry.getUrl('user-management');
    this.httpClient = new HttpClient(serviceUrl, 'user-management');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck();
  }

  /**
   * Deep health check
   */
  async deepHealthCheck(options?: ApiRequestOptions): Promise<ApiResponse<any>> {
    return this.httpClient.get('/health/deep', options);
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string, options?: ApiRequestOptions): Promise<ApiResponse<UserProfile>> {
    return this.httpClient.get(`/api/users/${userId}`, options);
  }

  /**
   * Get user by phone number
   */
  async getUserByPhone(phoneNumber: string, options?: ApiRequestOptions): Promise<ApiResponse<UserProfile>> {
    return this.httpClient.get(`/api/users/phone/${encodeURIComponent(phoneNumber)}`, options);
  }

  /**
   * Create new user
   */
  async createUser(userData: Partial<UserProfile>, options?: ApiRequestOptions): Promise<ApiResponse<UserProfile>> {
    return this.httpClient.post('/api/users', userData, options);
  }

  /**
   * Update user
   */
  async updateUser(userId: string, updates: Partial<UserProfile>, options?: ApiRequestOptions): Promise<ApiResponse<UserProfile>> {
    return this.httpClient.put(`/api/users/${userId}`, updates, options);
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(userId: string, preferences: Record<string, any>, options?: ApiRequestOptions): Promise<ApiResponse<{ success: boolean }>> {
    return this.httpClient.put(`/api/users/${userId}/preferences`, { preferences }, options);
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(userId: string, options?: ApiRequestOptions): Promise<ApiResponse<Record<string, any>>> {
    return this.httpClient.get(`/api/users/${userId}/preferences`, options);
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string, options?: ApiRequestOptions): Promise<ApiResponse<{ success: boolean }>> {
    return this.httpClient.delete(`/api/users/${userId}`, options);
  }

  /**
   * Authenticate user
   */
  async authenticate(credentials: { phone_number: string; password?: string }, options?: ApiRequestOptions): Promise<ApiResponse<{ token: string; user: UserProfile }>> {
    return this.httpClient.post('/api/auth/login', credentials, options);
  }

  /**
   * Verify token
   */
  async verifyToken(token: string, options?: ApiRequestOptions): Promise<ApiResponse<{ valid: boolean; user?: UserProfile }>> {
    return this.httpClient.post('/api/auth/verify', { token }, options);
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId: string, options?: ApiRequestOptions): Promise<ApiResponse<string[]>> {
    return this.httpClient.get(`/api/users/${userId}/permissions`, options);
  }

  /**
   * List users (admin only)
   */
  async listUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }, options?: ApiRequestOptions): Promise<ApiResponse<{
    users: UserProfile[];
    total: number;
    page: number;
    limit: number;
  }>> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.search) query.append('search', params.search);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.httpClient.get(`/api/admin/users${queryString}`, options);
  }

  /**
   * Get service info
   */
  async getServiceInfo(options?: ApiRequestOptions): Promise<ApiResponse<{
    service: string;
    version: string;
    environment: string;
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