/**
 * HTTP Client with retry logic, circuit breaker, and comprehensive error handling
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { backOff } from 'exponential-backoff';
import { v4 as uuidv4 } from 'uuid';
import * as winston from 'winston';

import { ApiRequestOptions, ApiResponse, ApiError, RetryOptions } from '../types';
import { CircuitBreaker } from './CircuitBreaker';

export class HttpClient {
  private axiosInstance: AxiosInstance;
  private circuitBreaker: CircuitBreaker;
  private logger: winston.Logger;
  private defaultRetryOptions: RetryOptions = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  };

  constructor(
    baseURL?: string,
    private serviceName?: string,
    options?: {
      timeout?: number;
      headers?: Record<string, string>;
      circuitBreakerOptions?: any;
    }
  ) {
    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: serviceName || 'http-client' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    // Create axios instance
    this.axiosInstance = axios.create({
      baseURL,
      timeout: options?.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': serviceName || 'unknown',
        ...options?.headers
      }
    });

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      serviceName || 'http-client',
      options?.circuitBreakerOptions
    );

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        // Add request ID for tracing
        const requestId = uuidv4();
        config.headers['X-Request-ID'] = requestId;
        config.metadata = { requestId, startTime: Date.now() };

        this.logger.debug('Making HTTP request', {
          requestId,
          method: config.method?.toUpperCase(),
          url: config.url,
          service: this.serviceName
        });

        return config;
      },
      (error) => {
        this.logger.error('Request interceptor error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        const duration = Date.now() - (response.config.metadata?.startTime || Date.now());
        const requestId = response.config.metadata?.requestId;

        this.logger.debug('HTTP request completed', {
          requestId,
          status: response.status,
          duration,
          service: this.serviceName
        });

        // Record successful response in circuit breaker
        this.circuitBreaker.recordSuccess();

        return response;
      },
      (error: AxiosError) => {
        const duration = Date.now() - (error.config?.metadata?.startTime || Date.now());
        const requestId = error.config?.metadata?.requestId;

        this.logger.error('HTTP request failed', {
          requestId,
          status: error.response?.status,
          duration,
          service: this.serviceName,
          error: error.message,
          url: error.config?.url
        });

        // Record failure in circuit breaker
        this.circuitBreaker.recordFailure();

        return Promise.reject(this.createApiError(error));
      }
    );
  }

  private createApiError(axiosError: AxiosError): ApiError {
    const apiError = new Error(axiosError.message) as ApiError;
    apiError.name = 'ApiError';
    apiError.status = axiosError.response?.status;
    apiError.code = axiosError.code;
    apiError.service = this.serviceName;
    apiError.endpoint = axiosError.config?.url;
    apiError.details = {
      response: axiosError.response?.data,
      config: {
        method: axiosError.config?.method,
        url: axiosError.config?.url,
        timeout: axiosError.config?.timeout
      }
    };
    return apiError;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<AxiosResponse<T>>,
    retryOptions: RetryOptions
  ): Promise<AxiosResponse<T>> {
    return backOff(operation, {
      numOfAttempts: retryOptions.maxRetries + 1,
      startingDelay: retryOptions.initialDelay,
      maxDelay: retryOptions.maxDelay,
      delayFirstAttempt: false,
      jitter: 'full',
      retry: (error: any, attemptNumber: number) => {
        // Don't retry on client errors (4xx), but do retry on server errors (5xx) and network errors
        if (error.response?.status >= 400 && error.response?.status < 500) {
          return false;
        }

        this.logger.warn('Request failed, retrying', {
          service: this.serviceName,
          attempt: attemptNumber,
          maxAttempts: retryOptions.maxRetries + 1,
          error: error.message,
          status: error.response?.status
        });

        return true;
      }
    });
  }

  private async executeRequest<T>(
    requestConfig: AxiosRequestConfig,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const startTime = Date.now();

    try {
      // Check circuit breaker
      if (options.circuitBreaker !== false) {
        await this.circuitBreaker.execute(() => Promise.resolve());
      }

      // Apply timeout from options
      if (options.timeout) {
        requestConfig.timeout = options.timeout;
      }

      // Add headers from options
      if (options.headers) {
        requestConfig.headers = { ...requestConfig.headers, ...options.headers };
      }

      // Execute request with retry if configured
      let response: AxiosResponse<T>;
      if (options.retries) {
        response = await this.executeWithRetry(
          () => this.axiosInstance.request<T>(requestConfig),
          options.retries
        );
      } else {
        response = await this.executeWithRetry(
          () => this.axiosInstance.request<T>(requestConfig),
          this.defaultRetryOptions
        );
      }

      const duration = Date.now() - startTime;

      return {
        data: response.data,
        status: response.status,
        headers: response.headers as Record<string, string>,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof Error) {
        const apiError = error as ApiError;
        apiError.service = this.serviceName;
        throw apiError;
      }
      
      throw error;
    }
  }

  /**
   * GET request
   */
  async get<T = any>(
    url: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.executeRequest<T>({ method: 'GET', url }, options);
  }

  /**
   * POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.executeRequest<T>({ method: 'POST', url, data }, options);
  }

  /**
   * PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.executeRequest<T>({ method: 'PUT', url, data }, options);
  }

  /**
   * DELETE request
   */
  async delete<T = any>(
    url: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.executeRequest<T>({ method: 'DELETE', url }, options);
  }

  /**
   * PATCH request
   */
  async patch<T = any>(
    url: string,
    data?: any,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.executeRequest<T>({ method: 'PATCH', url, data }, options);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Get axios instance (for advanced usage)
   */
  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  /**
   * Update base URL
   */
  setBaseURL(baseURL: string): void {
    this.axiosInstance.defaults.baseURL = baseURL;
  }

  /**
   * Set default headers
   */
  setDefaultHeaders(headers: Record<string, string>): void {
    Object.assign(this.axiosInstance.defaults.headers, headers);
  }

  /**
   * Health check method
   */
  async healthCheck(path: string = '/health'): Promise<boolean> {
    try {
      const response = await this.get(path, { 
        timeout: 5000, 
        circuitBreaker: false,
        retries: { maxRetries: 1, initialDelay: 500, maxDelay: 1000, backoffFactor: 1 }
      });
      return response.status === 200;
    } catch (error) {
      this.logger.warn('Health check failed', {
        service: this.serviceName,
        path,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}