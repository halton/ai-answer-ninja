/**
 * 统一服务间通信客户端库
 * 支持服务发现、负载均衡、断路器、重试机制
 */

const axios = require('axios');
const CircuitBreaker = require('opossum');

class ServiceClient {
  constructor(options = {}) {
    this.services = {
      'user-management': process.env.USER_MANAGEMENT_URL || 'http://user-management:3005',
      'smart-whitelist': process.env.WHITELIST_SERVICE_URL || 'http://smart-whitelist:3006',
      'conversation-engine': process.env.CONVERSATION_ENGINE_URL || 'http://conversation-engine:3003',
      'realtime-processor': process.env.REALTIME_PROCESSOR_URL || 'http://realtime-processor:3002',
      'profile-analytics': process.env.PROFILE_ANALYTICS_URL || 'http://profile-analytics:3004',
      'configuration': process.env.CONFIGURATION_URL || 'http://configuration:3007',
      'storage': process.env.STORAGE_URL || 'http://storage:3008',
      'monitoring': process.env.MONITORING_URL || 'http://monitoring:3009'
    };

    this.defaultTimeout = options.timeout || 5000;
    this.defaultRetries = options.retries || 3;
    this.circuitBreakerOptions = {
      timeout: 3000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      ...options.circuitBreaker
    };

    // Initialize circuit breakers for each service
    this.circuitBreakers = {};
    this.initializeCircuitBreakers();
  }

  initializeCircuitBreakers() {
    Object.keys(this.services).forEach(serviceName => {
      const makeRequest = async (config) => {
        return axios(config);
      };

      this.circuitBreakers[serviceName] = new CircuitBreaker(makeRequest, {
        ...this.circuitBreakerOptions,
        name: serviceName
      });

      // Circuit breaker event listeners
      this.circuitBreakers[serviceName].on('open', () => {
        console.warn(`Circuit breaker opened for service: ${serviceName}`);
      });

      this.circuitBreakers[serviceName].on('halfOpen', () => {
        console.info(`Circuit breaker half-open for service: ${serviceName}`);
      });

      this.circuitBreakers[serviceName].on('close', () => {
        console.info(`Circuit breaker closed for service: ${serviceName}`);
      });
    });
  }

  /**
   * 获取服务的完整URL
   */
  getServiceUrl(serviceName, path = '') {
    const baseUrl = this.services[serviceName];
    if (!baseUrl) {
      throw new Error(`Unknown service: ${serviceName}`);
    }
    return path ? `${baseUrl}${path}` : baseUrl;
  }

  /**
   * 发起HTTP请求到指定服务
   */
  async request(serviceName, config = {}) {
    if (!this.services[serviceName]) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const requestConfig = {
      method: 'GET',
      timeout: this.defaultTimeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Ninja-ServiceClient/1.0',
        'X-Request-ID': this.generateRequestId(),
        ...config.headers
      },
      ...config,
      baseURL: this.services[serviceName]
    };

    const circuitBreaker = this.circuitBreakers[serviceName];
    
    try {
      const response = await circuitBreaker.fire(requestConfig);
      return {
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers,
        service: serviceName
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.response?.status,
        service: serviceName,
        circuitBreakerState: circuitBreaker.stats
      };
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(serviceName) {
    return this.request(serviceName, {
      url: '/health',
      method: 'GET',
      timeout: 2000
    });
  }

  /**
   * 就绪检查
   */
  async readinessCheck(serviceName) {
    return this.request(serviceName, {
      url: '/health/ready',
      method: 'GET',
      timeout: 3000
    });
  }

  /**
   * 检查所有服务健康状态
   */
  async checkAllServices() {
    const results = {};
    const promises = Object.keys(this.services).map(async serviceName => {
      try {
        const health = await this.healthCheck(serviceName);
        const ready = await this.readinessCheck(serviceName);
        
        results[serviceName] = {
          available: health.success,
          healthy: health.success,
          ready: ready.success,
          health: health.data,
          readiness: ready.data,
          circuitBreakerState: this.circuitBreakers[serviceName].stats
        };
      } catch (error) {
        results[serviceName] = {
          available: false,
          healthy: false,
          ready: false,
          error: error.message
        };
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * User Management Service APIs
   */
  async authenticateUser(credentials) {
    return this.request('user-management', {
      url: '/api/v1/auth/login',
      method: 'POST',
      data: credentials
    });
  }

  async getUserProfile(userId, token) {
    return this.request('user-management', {
      url: `/api/v1/users/${userId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /**
   * Smart Whitelist Service APIs
   */
  async getWhitelist(userId, phone = null) {
    const params = phone ? { phone } : {};
    return this.request('smart-whitelist', {
      url: `/api/v1/whitelist/${userId}`,
      method: 'GET',
      params
    });
  }

  async evaluatePhone(phone, userId = null) {
    const params = userId ? { user_id: userId } : {};
    return this.request('smart-whitelist', {
      url: `/api/v1/whitelist/evaluate/${phone}`,
      method: 'GET',
      params
    });
  }

  async smartAddToWhitelist(userId, contactData) {
    return this.request('smart-whitelist', {
      url: `/api/v1/whitelist/${userId}/smart-add`,
      method: 'POST',
      data: contactData
    });
  }

  /**
   * Conversation Engine APIs
   */
  async startConversation(callData) {
    return this.request('conversation-engine', {
      url: '/api/v1/conversations',
      method: 'POST',
      data: callData
    });
  }

  async continueConversation(conversationId, messageData) {
    return this.request('conversation-engine', {
      url: `/api/v1/conversations/${conversationId}/messages`,
      method: 'POST',
      data: messageData
    });
  }

  /**
   * Realtime Processor APIs
   */
  async processAudio(audioData, context = {}) {
    return this.request('realtime-processor', {
      url: '/api/v1/audio/process',
      method: 'POST',
      data: { audioData, context },
      timeout: 10000 // Audio processing may take longer
    });
  }

  /**
   * 生成请求ID用于链路追踪
   */
  generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取所有断路器状态
   */
  getCircuitBreakerStats() {
    const stats = {};
    Object.keys(this.circuitBreakers).forEach(serviceName => {
      stats[serviceName] = this.circuitBreakers[serviceName].stats;
    });
    return stats;
  }
}

module.exports = ServiceClient;