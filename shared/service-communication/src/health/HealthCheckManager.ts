/**
 * Centralized Health Check Manager
 */

import * as winston from 'winston';
import { serviceRegistry } from '../discovery/ServiceRegistry';
import { HealthCheckResult } from '../types';
import { HttpClient } from '../client/HttpClient';

export interface HealthCheckManagerOptions {
  checkInterval: number; // ms
  timeout: number; // ms
  retries: number;
  parallelChecks: boolean;
}

export class HealthCheckManager {
  private logger: winston.Logger;
  private checkIntervalId?: NodeJS.Timeout;
  private healthStatus: Map<string, HealthCheckResult> = new Map();
  private clients: Map<string, HttpClient> = new Map();
  
  private readonly options: HealthCheckManagerOptions;

  constructor(options?: Partial<HealthCheckManagerOptions>) {
    this.options = {
      checkInterval: options?.checkInterval || 30000, // 30 seconds
      timeout: options?.timeout || 5000, // 5 seconds
      retries: options?.retries || 2,
      parallelChecks: options?.parallelChecks || true
    };

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'health-check-manager' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.initializeClients();
  }

  private initializeClients(): void {
    const services = serviceRegistry.getAll();
    
    Object.keys(services).forEach(serviceName => {
      const serviceUrl = serviceRegistry.getUrl(serviceName);
      const client = new HttpClient(serviceUrl, serviceName, {
        timeout: this.options.timeout,
        circuitBreakerOptions: {
          threshold: 3,
          timeout: 10000,
          resetTimeout: 30000
        }
      });
      this.clients.set(serviceName, client);
    });
  }

  /**
   * Perform health check for a single service
   */
  async checkService(serviceName: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const client = this.clients.get(serviceName);
      if (!client) {
        throw new Error(`No client found for service: ${serviceName}`);
      }

      const service = serviceRegistry.get(serviceName);
      if (!service) {
        throw new Error(`Service not found in registry: ${serviceName}`);
      }

      const healthPath = service.healthPath || '/health';
      const isHealthy = await client.healthCheck(healthPath);
      
      const responseTime = Date.now() - startTime;

      const result: HealthCheckResult = {
        service: serviceName,
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        responseTime,
        details: {
          endpoint: `${serviceRegistry.getUrl(serviceName)}${healthPath}`,
          circuitBreakerStatus: client.getCircuitBreakerStatus()
        }
      };

      this.healthStatus.set(serviceName, result);
      
      if (isHealthy) {
        this.logger.debug('Health check passed', {
          service: serviceName,
          responseTime,
          endpoint: result.details.endpoint
        });
      } else {
        this.logger.warn('Health check failed', {
          service: serviceName,
          responseTime,
          endpoint: result.details.endpoint
        });
      }

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      const result: HealthCheckResult = {
        service: serviceName,
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        responseTime,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          endpoint: serviceRegistry.getUrl(serviceName),
          circuitBreakerStatus: this.clients.get(serviceName)?.getCircuitBreakerStatus()
        }
      };

      this.healthStatus.set(serviceName, result);

      this.logger.error('Health check failed with error', {
        service: serviceName,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime
      });

      return result;
    }
  }

  /**
   * Perform health checks for all registered services
   */
  async checkAllServices(): Promise<HealthCheckResult[]> {
    const serviceNames = Object.keys(serviceRegistry.getAll());
    
    if (this.options.parallelChecks) {
      // Parallel execution
      const promises = serviceNames.map(serviceName => 
        this.checkService(serviceName).catch(error => {
          this.logger.error('Health check promise failed', {
            service: serviceName,
            error: error.message
          });
          return {
            service: serviceName,
            status: 'unhealthy' as const,
            timestamp: new Date().toISOString(),
            details: { error: error.message }
          };
        })
      );

      return Promise.all(promises);
    } else {
      // Sequential execution
      const results: HealthCheckResult[] = [];
      for (const serviceName of serviceNames) {
        const result = await this.checkService(serviceName);
        results.push(result);
      }
      return results;
    }
  }

  /**
   * Get the current health status for a service
   */
  getServiceHealth(serviceName: string): HealthCheckResult | null {
    return this.healthStatus.get(serviceName) || null;
  }

  /**
   * Get the current health status for all services
   */
  getAllServiceHealth(): Record<string, HealthCheckResult> {
    const result: Record<string, HealthCheckResult> = {};
    this.healthStatus.forEach((health, serviceName) => {
      result[serviceName] = health;
    });
    return result;
  }

  /**
   * Get overall system health summary
   */
  getSystemHealthSummary(): {
    overall_status: 'healthy' | 'degraded' | 'unhealthy';
    healthy_services: number;
    unhealthy_services: number;
    total_services: number;
    last_check: string;
    services: Record<string, HealthCheckResult>;
  } {
    const services = this.getAllServiceHealth();
    const serviceCount = Object.keys(services).length;
    const healthyCount = Object.values(services).filter(s => s.status === 'healthy').length;
    const unhealthyCount = serviceCount - healthyCount;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (healthyCount === serviceCount) {
      overallStatus = 'healthy';
    } else if (healthyCount > serviceCount / 2) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    const lastCheck = Object.values(services).reduce((latest, service) => {
      return service.timestamp > latest ? service.timestamp : latest;
    }, '');

    return {
      overall_status: overallStatus,
      healthy_services: healthyCount,
      unhealthy_services: unhealthyCount,
      total_services: serviceCount,
      last_check: lastCheck,
      services
    };
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(): void {
    if (this.checkIntervalId) {
      this.logger.warn('Periodic health checks already running');
      return;
    }

    this.logger.info('Starting periodic health checks', {
      interval: this.options.checkInterval,
      parallelChecks: this.options.parallelChecks
    });

    // Perform initial check
    this.checkAllServices().catch(error => {
      this.logger.error('Initial health check failed', { error: error.message });
    });

    // Set up periodic checks
    this.checkIntervalId = setInterval(async () => {
      try {
        await this.checkAllServices();
      } catch (error) {
        this.logger.error('Periodic health check failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.options.checkInterval);
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = undefined;
      this.logger.info('Stopped periodic health checks');
    }
  }

  /**
   * Wait for all services to be healthy
   */
  async waitForHealthyServices(
    timeoutMs: number = 60000,
    serviceNames?: string[]
  ): Promise<boolean> {
    const targetServices = serviceNames || Object.keys(serviceRegistry.getAll());
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const results = await this.checkAllServices();
      const targetResults = results.filter(r => targetServices.includes(r.service));
      const healthyServices = targetResults.filter(r => r.status === 'healthy');

      if (healthyServices.length === targetServices.length) {
        this.logger.info('All target services are healthy', {
          services: targetServices,
          waitTime: Date.now() - startTime
        });
        return true;
      }

      this.logger.debug('Waiting for services to become healthy', {
        healthyServices: healthyServices.length,
        totalServices: targetServices.length,
        unhealthyServices: targetResults
          .filter(r => r.status !== 'healthy')
          .map(r => r.service)
      });

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    this.logger.error('Timeout waiting for services to become healthy', {
      timeoutMs,
      targetServices
    });
    return false;
  }

  /**
   * Reset circuit breaker for a service
   */
  resetServiceCircuitBreaker(serviceName: string): boolean {
    const client = this.clients.get(serviceName);
    if (client) {
      client.resetCircuitBreaker();
      this.logger.info('Circuit breaker reset', { service: serviceName });
      return true;
    }
    return false;
  }

  /**
   * Reset circuit breakers for all services
   */
  resetAllCircuitBreakers(): void {
    this.clients.forEach((client, serviceName) => {
      client.resetCircuitBreaker();
      this.logger.info('Circuit breaker reset', { service: serviceName });
    });
  }

  /**
   * Get configuration
   */
  getConfiguration(): HealthCheckManagerOptions {
    return { ...this.options };
  }

  /**
   * Update configuration
   */
  updateConfiguration(newOptions: Partial<HealthCheckManagerOptions>): void {
    Object.assign(this.options, newOptions);
    
    // Restart periodic checks if they're running
    if (this.checkIntervalId) {
      this.stopPeriodicChecks();
      this.startPeriodicChecks();
    }

    this.logger.info('Health check configuration updated', this.options);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopPeriodicChecks();
    this.clients.clear();
    this.healthStatus.clear();
  }
}

// Singleton instance
export const healthCheckManager = new HealthCheckManager();