/**
 * Comprehensive Health Check System
 * Monitors system health, service availability, and performance metrics
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import { RedisService } from '../services/user-management/src/services/redis';
import { DatabaseService } from '../shared/service-communication/src/clients';

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded' | 'unknown';
  responseTime: number;
  details: Record<string, any>;
  timestamp: Date;
  error?: string;
}

export interface ServiceEndpoint {
  name: string;
  url: string;
  method: 'GET' | 'POST';
  timeout: number;
  expectedStatus: number[];
  headers?: Record<string, string>;
  body?: any;
  critical: boolean;
}

export interface HealthCheckConfig {
  interval: number; // milliseconds
  timeout: number; // milliseconds
  retryAttempts: number;
  retryDelay: number;
  alertThresholds: {
    responseTime: number;
    errorRate: number;
    consecutiveFailures: number;
  };
}

export class HealthCheckSystem extends EventEmitter {
  private checkInterval: NodeJS.Timer | null = null;
  private serviceEndpoints: ServiceEndpoint[] = [];
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private isRunning: boolean = false;
  
  private redisService: RedisService;
  private databaseService: DatabaseService;

  constructor(private config: HealthCheckConfig) {
    super();
    this.redisService = new RedisService();
    this.databaseService = new DatabaseService();
    this.initializeServiceEndpoints();
  }

  /**
   * Initialize service endpoints for health checks
   */
  private initializeServiceEndpoints(): void {
    this.serviceEndpoints = [
      {
        name: 'user-management',
        url: 'http://user-management:3005/health',
        method: 'GET',
        timeout: 5000,
        expectedStatus: [200],
        critical: true
      },
      {
        name: 'smart-whitelist',
        url: 'http://smart-whitelist:3006/health',
        method: 'GET',
        timeout: 5000,
        expectedStatus: [200],
        critical: true
      },
      {
        name: 'realtime-processor',
        url: 'http://realtime-processor:3002/health',
        method: 'GET',
        timeout: 3000,
        expectedStatus: [200],
        critical: true
      },
      {
        name: 'conversation-engine',
        url: 'http://conversation-engine:3003/health',
        method: 'GET',
        timeout: 5000,
        expectedStatus: [200],
        critical: true
      },
      {
        name: 'profile-analytics',
        url: 'http://profile-analytics:3004/health',
        method: 'GET',
        timeout: 10000,
        expectedStatus: [200],
        critical: false
      },
      {
        name: 'conversation-analyzer',
        url: 'http://conversation-analyzer:3007/health',
        method: 'GET',
        timeout: 10000,
        expectedStatus: [200],
        critical: false
      }
    ];
  }

  /**
   * Start health check monitoring
   */
  public async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Health check monitoring is already running');
    }

    console.log('🏥 Starting health check monitoring...');
    
    try {
      // Initialize external service connections
      await this.initializeExternalServices();

      this.isRunning = true;
      
      // Run initial health check
      await this.runHealthChecks();

      // Schedule periodic health checks
      this.checkInterval = setInterval(async () => {
        try {
          await this.runHealthChecks();
        } catch (error) {
          console.error('Error during scheduled health check:', error);
          this.emit('error', error);
        }
      }, this.config.interval);

      console.log(`✅ Health check monitoring started (interval: ${this.config.interval}ms)`);
    } catch (error) {
      console.error('❌ Failed to start health check monitoring:', error);
      throw error;
    }
  }

  /**
   * Stop health check monitoring
   */
  public async stopMonitoring(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping health check monitoring...');

    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Close external service connections
    await this.closeExternalServices();

    console.log('✅ Health check monitoring stopped');
  }

  /**
   * Run health checks for all services
   */
  private async runHealthChecks(): Promise<void> {
    const startTime = Date.now();
    const results: HealthCheckResult[] = [];

    try {
      // Check external dependencies first
      const externalChecks = await Promise.allSettled([
        this.checkDatabase(),
        this.checkRedis(),
        this.checkAzureServices()
      ]);

      results.push(...externalChecks.map((result, index) => {
        const services = ['database', 'redis', 'azure-services'];
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            service: services[index],
            status: 'unhealthy' as const,
            responseTime: 0,
            details: {},
            timestamp: new Date(),
            error: result.reason?.message || 'Unknown error'
          };
        }
      }));

      // Check microservices
      const serviceChecks = await Promise.allSettled(
        this.serviceEndpoints.map(endpoint => this.checkServiceEndpoint(endpoint))
      );

      results.push(...serviceChecks.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            service: this.serviceEndpoints[index].name,
            status: 'unhealthy' as const,
            responseTime: 0,
            details: {},
            timestamp: new Date(),
            error: result.reason?.message || 'Unknown error'
          };
        }
      }));

      // Process results and trigger alerts if needed
      this.processHealthCheckResults(results);

      const totalTime = Date.now() - startTime;
      console.log(`🏥 Health check completed in ${totalTime}ms`);

    } catch (error) {
      console.error('Error during health check execution:', error);
      this.emit('error', error);
    }
  }

  /**
   * Check database health
   */
  private async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      const connectResult = await this.databaseService.query('SELECT 1 as health_check');
      
      // Test write capability
      const writeTest = await this.databaseService.query(
        'INSERT INTO health_checks (timestamp, service) VALUES ($1, $2) RETURNING id',
        [new Date(), 'health-check-system']
      );

      // Clean up test data
      if (writeTest.rows?.[0]?.id) {
        await this.databaseService.query('DELETE FROM health_checks WHERE id = $1', [writeTest.rows[0].id]);
      }

      // Get additional database metrics
      const [activeConnections, dbSize] = await Promise.all([
        this.getDatabaseActiveConnections(),
        this.getDatabaseSize()
      ]);

      const responseTime = Date.now() - startTime;

      return {
        service: 'database',
        status: 'healthy',
        responseTime,
        details: {
          connectivity: 'ok',
          writeCapability: 'ok',
          activeConnections,
          databaseSize: dbSize,
          version: await this.getDatabaseVersion()
        },
        timestamp: new Date()
      };

    } catch (error) {
      return {
        service: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: {},
        timestamp: new Date(),
        error: error.message || 'Database connection failed'
      };
    }
  }

  /**
   * Check Redis health
   */
  private async checkRedis(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      await this.redisService.ping();
      
      // Test read/write operations
      const testKey = `health_check_${Date.now()}`;
      const testValue = 'health_check_value';
      
      await this.redisService.set(testKey, testValue, 60); // 60 seconds TTL
      const retrievedValue = await this.redisService.get(testKey);
      
      if (retrievedValue !== testValue) {
        throw new Error('Redis read/write test failed');
      }

      // Clean up test data
      await this.redisService.del(testKey);

      // Get Redis info
      const info = await this.getRedisInfo();
      const responseTime = Date.now() - startTime;

      return {
        service: 'redis',
        status: 'healthy',
        responseTime,
        details: {
          connectivity: 'ok',
          readWrite: 'ok',
          ...info
        },
        timestamp: new Date()
      };

    } catch (error) {
      return {
        service: 'redis',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: {},
        timestamp: new Date(),
        error: error.message || 'Redis connection failed'
      };
    }
  }

  /**
   * Check Azure services health
   */
  private async checkAzureServices(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const details: Record<string, any> = {};
    let overallStatus: HealthCheckResult['status'] = 'healthy';
    const errors: string[] = [];

    try {
      // Check Azure Speech Service
      try {
        const speechCheck = await this.checkAzureSpeechService();
        details.speechService = speechCheck;
      } catch (error) {
        details.speechService = { status: 'unhealthy', error: error.message };
        overallStatus = 'degraded';
        errors.push(`Speech Service: ${error.message}`);
      }

      // Check Azure OpenAI Service  
      try {
        const openAICheck = await this.checkAzureOpenAIService();
        details.openAIService = openAICheck;
      } catch (error) {
        details.openAIService = { status: 'unhealthy', error: error.message };
        overallStatus = 'degraded';
        errors.push(`OpenAI Service: ${error.message}`);
      }

      // Check Azure Communication Service
      try {
        const communicationCheck = await this.checkAzureCommunicationService();
        details.communicationService = communicationCheck;
      } catch (error) {
        details.communicationService = { status: 'unhealthy', error: error.message };
        overallStatus = 'degraded';
        errors.push(`Communication Service: ${error.message}`);
      }

      return {
        service: 'azure-services',
        status: overallStatus,
        responseTime: Date.now() - startTime,
        details,
        timestamp: new Date(),
        error: errors.length > 0 ? errors.join('; ') : undefined
      };

    } catch (error) {
      return {
        service: 'azure-services',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details,
        timestamp: new Date(),
        error: error.message || 'Azure services check failed'
      };
    }
  }

  /**
   * Check individual service endpoint
   */
  private async checkServiceEndpoint(endpoint: ServiceEndpoint): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const response = await axios({
          method: endpoint.method,
          url: endpoint.url,
          timeout: endpoint.timeout,
          headers: endpoint.headers,
          data: endpoint.body,
          validateStatus: (status) => endpoint.expectedStatus.includes(status)
        });

        const responseTime = Date.now() - startTime;
        
        // Determine status based on response time
        let status: HealthCheckResult['status'] = 'healthy';
        if (responseTime > this.config.alertThresholds.responseTime) {
          status = 'degraded';
        }

        return {
          service: endpoint.name,
          status,
          responseTime,
          details: {
            httpStatus: response.status,
            attempt: attempt + 1,
            endpoint: endpoint.url,
            responseData: response.data
          },
          timestamp: new Date()
        };

      } catch (error) {
        if (attempt < this.config.retryAttempts) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
          continue;
        }

        // Final attempt failed
        return {
          service: endpoint.name,
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          details: {
            attempt: attempt + 1,
            endpoint: endpoint.url,
            maxRetries: this.config.retryAttempts
          },
          timestamp: new Date(),
          error: error.message || 'HTTP request failed'
        };
      }
    }

    // Should never reach here, but TypeScript requires a return
    throw new Error('Unexpected end of function');
  }

  /**
   * Process health check results and trigger alerts
   */
  private processHealthCheckResults(results: HealthCheckResult[]): void {
    for (const result of results) {
      // Store health history
      if (!this.healthHistory.has(result.service)) {
        this.healthHistory.set(result.service, []);
      }
      
      const history = this.healthHistory.get(result.service)!;
      history.push(result);
      
      // Keep only last 100 results
      if (history.length > 100) {
        history.shift();
      }

      // Track consecutive failures
      if (result.status === 'unhealthy') {
        const currentFailures = this.consecutiveFailures.get(result.service) || 0;
        this.consecutiveFailures.set(result.service, currentFailures + 1);
        
        // Check if we should trigger an alert
        if (currentFailures + 1 >= this.config.alertThresholds.consecutiveFailures) {
          this.triggerAlert(result, currentFailures + 1);
        }
      } else {
        // Reset failure count on success
        this.consecutiveFailures.set(result.service, 0);
        
        // Emit recovery event if service was previously failing
        const history = this.healthHistory.get(result.service)!;
        const previousResult = history.length > 1 ? history[history.length - 2] : null;
        if (previousResult && previousResult.status === 'unhealthy') {
          this.emit('service-recovered', result);
        }
      }

      // Check response time threshold
      if (result.responseTime > this.config.alertThresholds.responseTime) {
        this.emit('slow-response', result);
      }
    }

    // Emit overall health status
    this.emit('health-check-complete', {
      timestamp: new Date(),
      results,
      overallHealth: this.calculateOverallHealth(results)
    });
  }

  /**
   * Calculate overall system health
   */
  private calculateOverallHealth(results: HealthCheckResult[]): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    healthyServices: number;
    totalServices: number;
    criticalServicesDown: number;
  } {
    const criticalServices = this.serviceEndpoints.filter(s => s.critical).map(s => s.name);
    criticalServices.push('database', 'redis'); // Always critical
    
    const criticalResults = results.filter(r => criticalServices.includes(r.service));
    const criticalServicesDown = criticalResults.filter(r => r.status === 'unhealthy').length;
    
    const healthyServices = results.filter(r => r.status === 'healthy').length;
    const totalServices = results.length;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (criticalServicesDown > 0) {
      status = 'unhealthy';
    } else if (healthyServices < totalServices) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      healthyServices,
      totalServices,
      criticalServicesDown
    };
  }

  /**
   * Trigger alert for service failure
   */
  private triggerAlert(result: HealthCheckResult, consecutiveFailures: number): void {
    const alertData = {
      service: result.service,
      status: result.status,
      consecutiveFailures,
      lastError: result.error,
      responseTime: result.responseTime,
      timestamp: result.timestamp,
      details: result.details
    };

    console.error(`🚨 HEALTH ALERT: Service ${result.service} has failed ${consecutiveFailures} times consecutively`);
    this.emit('service-alert', alertData);

    // Also emit critical alert if it's a critical service
    const endpoint = this.serviceEndpoints.find(e => e.name === result.service);
    if (endpoint?.critical || ['database', 'redis'].includes(result.service)) {
      console.error(`🔥 CRITICAL ALERT: Critical service ${result.service} is down!`);
      this.emit('critical-service-down', alertData);
    }
  }

  /**
   * Get current health status for all services
   */
  public getCurrentHealthStatus(): Record<string, HealthCheckResult | null> {
    const status: Record<string, HealthCheckResult | null> = {};
    
    for (const [service, history] of this.healthHistory.entries()) {
      status[service] = history.length > 0 ? history[history.length - 1] : null;
    }
    
    return status;
  }

  /**
   * Get health history for a specific service
   */
  public getServiceHealthHistory(serviceName: string, limit: number = 50): HealthCheckResult[] {
    const history = this.healthHistory.get(serviceName) || [];
    return history.slice(-limit);
  }

  /**
   * Get system health metrics
   */
  public getHealthMetrics(): {
    uptime: number;
    totalChecks: number;
    averageResponseTime: Record<string, number>;
    errorRates: Record<string, number>;
    availability: Record<string, number>;
  } {
    const metrics = {
      uptime: this.isRunning ? Date.now() - (this.checkInterval ? Date.now() : 0) : 0,
      totalChecks: 0,
      averageResponseTime: {} as Record<string, number>,
      errorRates: {} as Record<string, number>,
      availability: {} as Record<string, number>
    };

    for (const [service, history] of this.healthHistory.entries()) {
      if (history.length === 0) continue;

      metrics.totalChecks += history.length;
      
      // Calculate average response time
      const totalResponseTime = history.reduce((sum, result) => sum + result.responseTime, 0);
      metrics.averageResponseTime[service] = totalResponseTime / history.length;
      
      // Calculate error rate
      const errorCount = history.filter(result => result.status === 'unhealthy').length;
      metrics.errorRates[service] = (errorCount / history.length) * 100;
      
      // Calculate availability
      const healthyCount = history.filter(result => result.status === 'healthy').length;
      metrics.availability[service] = (healthyCount / history.length) * 100;
    }

    return metrics;
  }

  // Helper methods for external service checks
  private async initializeExternalServices(): Promise<void> {
    try {
      await this.databaseService.initialize();
      await this.redisService.initialize();
    } catch (error) {
      console.error('Error initializing external services for health checks:', error);
      throw error;
    }
  }

  private async closeExternalServices(): Promise<void> {
    try {
      await this.databaseService.close();
      await this.redisService.close();
    } catch (error) {
      console.error('Error closing external services:', error);
    }
  }

  private async getDatabaseActiveConnections(): Promise<number> {
    try {
      const result = await this.databaseService.query(
        'SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = $1',
        ['active']
      );
      return parseInt(result.rows?.[0]?.active_connections || '0');
    } catch {
      return 0;
    }
  }

  private async getDatabaseSize(): Promise<string> {
    try {
      const result = await this.databaseService.query(
        'SELECT pg_size_pretty(pg_database_size(current_database())) as size'
      );
      return result.rows?.[0]?.size || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async getDatabaseVersion(): Promise<string> {
    try {
      const result = await this.databaseService.query('SELECT version()');
      return result.rows?.[0]?.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async getRedisInfo(): Promise<Record<string, any>> {
    try {
      const info = await this.redisService.info();
      return {
        memory: info.used_memory_human || 'unknown',
        connections: info.connected_clients || 'unknown',
        uptime: info.uptime_in_seconds || 'unknown',
        version: info.redis_version || 'unknown'
      };
    } catch {
      return {};
    }
  }

  private async checkAzureSpeechService(): Promise<Record<string, any>> {
    // Placeholder for Azure Speech Service health check
    // In real implementation, you'd make actual API calls
    return { status: 'healthy', lastCheck: new Date() };
  }

  private async checkAzureOpenAIService(): Promise<Record<string, any>> {
    // Placeholder for Azure OpenAI Service health check
    // In real implementation, you'd make actual API calls
    return { status: 'healthy', lastCheck: new Date() };
  }

  private async checkAzureCommunicationService(): Promise<Record<string, any>> {
    // Placeholder for Azure Communication Service health check
    // In real implementation, you'd make actual API calls
    return { status: 'healthy', lastCheck: new Date() };
  }
}