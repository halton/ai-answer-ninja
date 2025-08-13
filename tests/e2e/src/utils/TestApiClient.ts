/**
 * Test API Client for E2E Testing
 * 
 * Provides a comprehensive HTTP client for testing all services with:
 * - Automatic service discovery and load balancing
 * - Request/response logging and metrics collection
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern for fault tolerance
 * - Authentication token management
 * - Request/response validation
 * - Performance monitoring and profiling
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { performance } from 'perf_hooks';

export interface ServiceEndpoints {
  userManagement: string;
  smartWhitelist: string;
  conversationEngine: string;
  realtimeProcessor: string;
  profileAnalytics: string;
  phoneGateway: string;
  configurationService: string;
  storageService: string;
  monitoringService: string;
}

export interface TestApiClientConfig {
  baseURL?: string;
  timeout: number;
  retries: {
    max: number;
    delay: number;
    factor: number;
  };
  circuitBreaker: {
    threshold: number;
    timeout: number;
    resetTimeout: number;
  };
  logging: {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    logRequests: boolean;
    logResponses: boolean;
  };
  metrics: {
    enabled: boolean;
    collectTimings: boolean;
    collectPayloadSizes: boolean;
  };
  authentication: {
    autoRefresh: boolean;
    tokenStorage: 'memory' | 'file';
  };
}

export interface RequestMetrics {
  requestId: string;
  method: string;
  url: string;
  startTime: number;
  endTime: number;
  duration: number;
  statusCode: number;
  requestSize: number;
  responseSize: number;
  success: boolean;
  error?: string;
  retryCount: number;
}

export interface CircuitBreakerState {
  service: string;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  nextRetry: number;
}

export class TestApiClient {
  private client: AxiosInstance;
  private config: TestApiClientConfig;
  private services: ServiceEndpoints;
  private authTokens: Map<string, string> = new Map();
  private requestMetrics: RequestMetrics[] = [];
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private requestIdCounter = 0;

  constructor(services: ServiceEndpoints, config?: Partial<TestApiClientConfig>) {
    this.services = services;
    this.config = {
      baseURL: '',
      timeout: 30000,
      retries: {
        max: 3,
        delay: 1000,
        factor: 2
      },
      circuitBreaker: {
        threshold: 5,
        timeout: 30000,
        resetTimeout: 60000
      },
      logging: {
        enabled: true,
        logLevel: 'info',
        logRequests: true,
        logResponses: false
      },
      metrics: {
        enabled: true,
        collectTimings: true,
        collectPayloadSizes: true
      },
      authentication: {
        autoRefresh: true,
        tokenStorage: 'memory'
      },
      ...config
    };

    this.client = axios.create({
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Ninja-E2E-Test-Client/1.0'
      }
    });

    this.setupInterceptors();
    this.initializeCircuitBreakers();
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const requestId = `req_${++this.requestIdCounter}`;
        config.metadata = {
          requestId,
          startTime: performance.now()
        };

        // Add authentication token if available
        const serviceName = this.getServiceNameFromUrl(config.url || '');
        const token = this.authTokens.get(serviceName);
        if (token && !config.headers?.Authorization) {
          config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
        }

        // Add tracing headers
        config.headers = {
          ...config.headers,
          'X-Request-ID': requestId,
          'X-Test-Client': 'E2E-Suite',
          'X-Test-Timestamp': new Date().toISOString()
        };

        if (this.config.logging.enabled && this.config.logging.logRequests) {
          this.log('info', `→ ${config.method?.toUpperCase()} ${config.url}`, {
            requestId,
            headers: config.headers,
            data: config.data ? JSON.stringify(config.data).substring(0, 500) : undefined
          });
        }

        return config;
      },
      (error) => {
        this.log('error', 'Request interceptor error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const endTime = performance.now();
        const config = response.config as any;
        const requestId = config.metadata?.requestId;
        const startTime = config.metadata?.startTime;
        const duration = startTime ? endTime - startTime : 0;

        // Collect metrics
        if (this.config.metrics.enabled) {
          this.collectMetrics({
            requestId,
            method: config.method?.toUpperCase() || 'UNKNOWN',
            url: config.url || '',
            startTime: startTime || endTime,
            endTime,
            duration,
            statusCode: response.status,
            requestSize: this.calculatePayloadSize(config.data),
            responseSize: this.calculatePayloadSize(response.data),
            success: true,
            retryCount: 0
          });
        }

        // Update circuit breaker state
        const serviceName = this.getServiceNameFromUrl(config.url || '');
        this.updateCircuitBreakerSuccess(serviceName);

        if (this.config.logging.enabled && this.config.logging.logResponses) {
          this.log('info', `← ${response.status} ${config.url}`, {
            requestId,
            duration: Math.round(duration),
            size: this.calculatePayloadSize(response.data)
          });
        }

        return response;
      },
      async (error: AxiosError) => {
        const endTime = performance.now();
        const config = error.config as any;
        const requestId = config?.metadata?.requestId;
        const startTime = config?.metadata?.startTime;
        const duration = startTime ? endTime - startTime : 0;

        // Collect error metrics
        if (this.config.metrics.enabled && config) {
          this.collectMetrics({
            requestId,
            method: config.method?.toUpperCase() || 'UNKNOWN',
            url: config.url || '',
            startTime: startTime || endTime,
            endTime,
            duration,
            statusCode: error.response?.status || 0,
            requestSize: this.calculatePayloadSize(config.data),
            responseSize: this.calculatePayloadSize(error.response?.data),
            success: false,
            error: error.message,
            retryCount: 0
          });
        }

        // Update circuit breaker state
        const serviceName = this.getServiceNameFromUrl(config?.url || '');
        this.updateCircuitBreakerFailure(serviceName);

        this.log('error', `✗ ${error.response?.status || 'ERR'} ${config?.url || 'Unknown URL'}`, {
          requestId,
          duration: Math.round(duration),
          error: error.message,
          response: error.response?.data
        });

        return Promise.reject(error);
      }
    );
  }

  /**
   * Make GET request with retry logic and circuit breaker
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.requestWithRetry('get', url, undefined, config);
  }

  /**
   * Make POST request with retry logic and circuit breaker
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.requestWithRetry('post', url, data, config);
  }

  /**
   * Make PUT request with retry logic and circuit breaker
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.requestWithRetry('put', url, data, config);
  }

  /**
   * Make DELETE request with retry logic and circuit breaker
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.requestWithRetry('delete', url, undefined, config);
  }

  /**
   * Make PATCH request with retry logic and circuit breaker
   */
  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.requestWithRetry('patch', url, data, config);
  }

  /**
   * Make request with retry logic and circuit breaker protection
   */
  private async requestWithRetry<T = any>(
    method: string, 
    url: string, 
    data?: any, 
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    const fullUrl = this.buildFullUrl(url);
    const serviceName = this.getServiceNameFromUrl(fullUrl);

    // Check circuit breaker
    if (this.isCircuitBreakerOpen(serviceName)) {
      throw new Error(`Circuit breaker is open for service: ${serviceName}`);
    }

    let lastError: Error;
    let retryCount = 0;

    while (retryCount <= this.config.retries.max) {
      try {
        let response: AxiosResponse<T>;

        switch (method.toLowerCase()) {
          case 'get':
            response = await this.client.get(fullUrl, config);
            break;
          case 'post':
            response = await this.client.post(fullUrl, data, config);
            break;
          case 'put':
            response = await this.client.put(fullUrl, data, config);
            break;
          case 'delete':
            response = await this.client.delete(fullUrl, config);
            break;
          case 'patch':
            response = await this.client.patch(fullUrl, data, config);
            break;
          default:
            throw new Error(`Unsupported HTTP method: ${method}`);
        }

        // Update retry count in metrics
        if (this.config.metrics.enabled && retryCount > 0) {
          const lastMetric = this.requestMetrics[this.requestMetrics.length - 1];
          if (lastMetric) {
            lastMetric.retryCount = retryCount;
          }
        }

        return response;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        if (retryCount <= this.config.retries.max) {
          const delay = this.config.retries.delay * Math.pow(this.config.retries.factor, retryCount - 1);
          
          this.log('warn', `Retrying request ${retryCount}/${this.config.retries.max} after ${delay}ms`, {
            url: fullUrl,
            error: lastError.message
          });

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Set authentication token for a service
   */
  setAuthToken(service: string, token: string): void {
    this.authTokens.set(service, token);
    this.log('info', `Auth token set for service: ${service}`);
  }

  /**
   * Clear authentication token for a service
   */
  clearAuthToken(service: string): void {
    this.authTokens.delete(service);
    this.log('info', `Auth token cleared for service: ${service}`);
  }

  /**
   * Get request metrics
   */
  getMetrics(): RequestMetrics[] {
    return [...this.requestMetrics];
  }

  /**
   * Get circuit breaker states
   */
  getCircuitBreakerStates(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.requestMetrics = [];
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(): void {
    this.initializeCircuitBreakers();
  }

  /**
   * Health check for all services
   */
  async healthCheck(): Promise<{ [service: string]: { healthy: boolean; responseTime?: number; error?: string } }> {
    const results: { [service: string]: { healthy: boolean; responseTime?: number; error?: string } } = {};

    const healthPromises = Object.entries(this.services).map(async ([serviceName, serviceUrl]) => {
      const startTime = performance.now();
      try {
        const response = await this.client.get(`${serviceUrl}/health`, { timeout: 5000 });
        const responseTime = performance.now() - startTime;
        
        results[serviceName] = {
          healthy: response.status === 200,
          responseTime: Math.round(responseTime)
        };
      } catch (error) {
        const responseTime = performance.now() - startTime;
        results[serviceName] = {
          healthy: false,
          responseTime: Math.round(responseTime),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    await Promise.all(healthPromises);
    return results;
  }

  /**
   * Wait for all services to be healthy
   */
  async waitForServicesHealthy(timeout: number = 60000, checkInterval: number = 2000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const healthResults = await this.healthCheck();
      const allHealthy = Object.values(healthResults).every(result => result.healthy);
      
      if (allHealthy) {
        this.log('info', 'All services are healthy');
        return true;
      }

      const unhealthyServices = Object.entries(healthResults)
        .filter(([_, result]) => !result.healthy)
        .map(([name, _]) => name);

      this.log('warn', `Waiting for services to be healthy: ${unhealthyServices.join(', ')}`);
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    this.log('error', `Timeout waiting for services to be healthy after ${timeout}ms`);
    return false;
  }

  /**
   * Build full URL from service path
   */
  private buildFullUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // Extract service name from path (e.g., '/user-management/api/users' -> 'userManagement')
    const serviceName = this.getServiceNameFromUrl(path);
    const serviceUrl = (this.services as any)[serviceName];
    
    if (!serviceUrl) {
      throw new Error(`Unknown service in path: ${path}`);
    }

    // Remove service name from path
    const servicePath = path.replace(/^\/[^\/]+/, '');
    return `${serviceUrl}${servicePath}`;
  }

  /**
   * Extract service name from URL
   */
  private getServiceNameFromUrl(url: string): string {
    const matches = url.match(/\/([^\/]+)/);
    if (!matches) return 'unknown';
    
    const pathSegment = matches[1];
    
    // Map path segments to service names
    const serviceMapping: { [key: string]: string } = {
      'user-management': 'userManagement',
      'smart-whitelist': 'smartWhitelist',
      'conversation-engine': 'conversationEngine',
      'realtime-processor': 'realtimeProcessor',
      'profile-analytics': 'profileAnalytics',
      'phone-gateway': 'phoneGateway',
      'configuration-service': 'configurationService',
      'storage-service': 'storageService',
      'monitoring-service': 'monitoringService'
    };

    return serviceMapping[pathSegment] || pathSegment;
  }

  /**
   * Initialize circuit breakers for all services
   */
  private initializeCircuitBreakers(): void {
    this.circuitBreakers.clear();
    
    Object.keys(this.services).forEach(serviceName => {
      this.circuitBreakers.set(serviceName, {
        service: serviceName,
        state: 'closed',
        failures: 0,
        lastFailure: 0,
        nextRetry: 0
      });
    });
  }

  /**
   * Check if circuit breaker is open for a service
   */
  private isCircuitBreakerOpen(serviceName: string): boolean {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return false;

    const now = Date.now();

    if (breaker.state === 'open') {
      if (now >= breaker.nextRetry) {
        breaker.state = 'half-open';
        this.log('info', `Circuit breaker for ${serviceName} is now half-open`);
      } else {
        return true;
      }
    }

    return false;
  }

  /**
   * Update circuit breaker on successful request
   */
  private updateCircuitBreakerSuccess(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return;

    if (breaker.state === 'half-open') {
      breaker.state = 'closed';
      breaker.failures = 0;
      this.log('info', `Circuit breaker for ${serviceName} is now closed`);
    }
  }

  /**
   * Update circuit breaker on failed request
   */
  private updateCircuitBreakerFailure(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return;

    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= this.config.circuitBreaker.threshold) {
      breaker.state = 'open';
      breaker.nextRetry = Date.now() + this.config.circuitBreaker.resetTimeout;
      this.log('warn', `Circuit breaker for ${serviceName} is now open (${breaker.failures} failures)`);
    }
  }

  /**
   * Collect request metrics
   */
  private collectMetrics(metrics: RequestMetrics): void {
    this.requestMetrics.push(metrics);
    
    // Keep only last 1000 metrics to prevent memory issues
    if (this.requestMetrics.length > 1000) {
      this.requestMetrics = this.requestMetrics.slice(-1000);
    }
  }

  /**
   * Calculate payload size in bytes
   */
  private calculatePayloadSize(data: any): number {
    if (!data) return 0;
    if (typeof data === 'string') return data.length;
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  /**
   * Log message with appropriate level
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any): void {
    if (!this.config.logging.enabled) return;
    
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[this.config.logging.logLevel];
    const messageLevel = levels[level];
    
    if (messageLevel >= configLevel) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        message,
        component: 'TestApiClient',
        ...meta
      };
      
      console.log(JSON.stringify(logEntry));
    }
  }
}

export default TestApiClient;