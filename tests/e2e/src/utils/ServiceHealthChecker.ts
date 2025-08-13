/**
 * Service Health Checker and Dependency Detection
 * 
 * Provides comprehensive service health monitoring and dependency management:
 * - Health check endpoints validation
 * - Service dependency mapping and validation
 * - Startup sequence orchestration
 * - Readiness and liveness probes
 * - Service discovery integration
 * - Failure detection and recovery suggestions
 */

import { TestApiClient } from './TestApiClient';
import { performance } from 'perf_hooks';

export interface ServiceHealthStatus {
  serviceName: string;
  healthy: boolean;
  status: 'starting' | 'healthy' | 'unhealthy' | 'unknown';
  responseTime: number;
  timestamp: string;
  version?: string;
  dependencies?: ServiceDependency[];
  checks: HealthCheck[];
  error?: string;
  uptime?: number;
}

export interface ServiceDependency {
  name: string;
  type: 'database' | 'cache' | 'external_api' | 'message_queue' | 'storage';
  required: boolean;
  healthy: boolean;
  responseTime: number;
  error?: string;
  metadata?: any;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  responseTime: number;
  details?: any;
  error?: string;
}

export interface ServiceDependencyMap {
  [serviceName: string]: {
    dependencies: string[];
    startupOrder: number;
    healthEndpoint: string;
    readinessEndpoint?: string;
    criticalDependencies: string[];
  };
}

export interface HealthCheckConfig {
  timeout: number;
  retries: number;
  interval: number;
  startupTimeout: number;
  healthCheckPaths: {
    health: string;
    ready: string;
    live: string;
  };
  dependencyValidation: {
    enabled: boolean;
    failFast: boolean;
    skipOptional: boolean;
  };
}

export class ServiceHealthChecker {
  private apiClient: TestApiClient;
  private config: HealthCheckConfig;
  private dependencyMap: ServiceDependencyMap;
  private healthHistory: Map<string, ServiceHealthStatus[]> = new Map();

  constructor(apiClient: TestApiClient, config?: Partial<HealthCheckConfig>) {
    this.apiClient = apiClient;
    this.config = {
      timeout: 10000,
      retries: 3,
      interval: 5000,
      startupTimeout: 120000,
      healthCheckPaths: {
        health: '/health',
        ready: '/ready',
        live: '/live'
      },
      dependencyValidation: {
        enabled: true,
        failFast: true,
        skipOptional: false
      },
      ...config
    };

    this.dependencyMap = this.buildDependencyMap();
  }

  /**
   * Check health of a single service
   */
  async checkServiceHealth(serviceName: string): Promise<ServiceHealthStatus> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    try {
      // Get service URL from API client
      const serviceUrl = this.getServiceUrl(serviceName);
      if (!serviceUrl) {
        throw new Error(`Service URL not found for: ${serviceName}`);
      }

      // Perform health check
      const healthResponse = await this.apiClient.get(
        `${serviceUrl}${this.config.healthCheckPaths.health}`,
        { timeout: this.config.timeout }
      );

      const responseTime = performance.now() - startTime;

      // Parse health check response
      const healthData = healthResponse.data;
      const checks: HealthCheck[] = [];
      const dependencies: ServiceDependency[] = [];

      // Process standard health check format
      if (healthData.checks) {
        for (const [checkName, checkData] of Object.entries(healthData.checks)) {
          checks.push({
            name: checkName,
            status: (checkData as any).status || 'unknown',
            responseTime: (checkData as any).responseTime || 0,
            details: (checkData as any).details,
            error: (checkData as any).error
          });
        }
      }

      // Process dependencies
      if (healthData.dependencies) {
        for (const [depName, depData] of Object.entries(healthData.dependencies)) {
          dependencies.push({
            name: depName,
            type: (depData as any).type || 'external_api',
            required: (depData as any).required || false,
            healthy: (depData as any).healthy || false,
            responseTime: (depData as any).responseTime || 0,
            error: (depData as any).error,
            metadata: (depData as any).metadata
          });
        }
      }

      // Determine overall health
      const unhealthyChecks = checks.filter(c => c.status === 'fail');
      const unhealthyRequiredDeps = dependencies.filter(d => d.required && !d.healthy);
      const isHealthy = unhealthyChecks.length === 0 && unhealthyRequiredDeps.length === 0;

      const status: ServiceHealthStatus = {
        serviceName,
        healthy: isHealthy,
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime: Math.round(responseTime),
        timestamp,
        version: healthData.version,
        dependencies,
        checks,
        uptime: healthData.uptime
      };

      // Store in history
      this.addToHistory(serviceName, status);

      return status;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      const status: ServiceHealthStatus = {
        serviceName,
        healthy: false,
        status: 'unhealthy',
        responseTime: Math.round(responseTime),
        timestamp,
        checks: [],
        error: error instanceof Error ? error.message : String(error)
      };

      this.addToHistory(serviceName, status);
      return status;
    }
  }

  /**
   * Check health of all services
   */
  async checkAllServicesHealth(): Promise<Map<string, ServiceHealthStatus>> {
    const services = Object.keys(this.dependencyMap);
    const healthPromises = services.map(service => 
      this.checkServiceHealth(service)
    );

    const healthResults = await Promise.all(healthPromises);
    const healthMap = new Map<string, ServiceHealthStatus>();

    healthResults.forEach(status => {
      healthMap.set(status.serviceName, status);
    });

    return healthMap;
  }

  /**
   * Wait for all services to be healthy with dependency ordering
   */
  async waitForServicesReady(timeout: number = this.config.startupTimeout): Promise<{
    success: boolean;
    healthyServices: string[];
    unhealthyServices: string[];
    startupTime: number;
  }> {
    const startTime = performance.now();
    const endTime = startTime + timeout;
    
    // Get services in dependency order
    const servicesInOrder = this.getServicesInStartupOrder();
    const readyServices = new Set<string>();
    const failedServices = new Set<string>();

    console.log(`🚀 Starting service health checks in dependency order: ${servicesInOrder.join(' → ')}`);

    while (performance.now() < endTime && readyServices.size + failedServices.size < servicesInOrder.length) {
      for (const service of servicesInOrder) {
        if (readyServices.has(service) || failedServices.has(service)) {
          continue;
        }

        // Check if dependencies are ready
        const serviceDeps = this.dependencyMap[service];
        const depsReady = serviceDeps.dependencies.every(dep => readyServices.has(dep));

        if (!depsReady) {
          continue; // Wait for dependencies
        }

        // Check service health
        try {
          const healthStatus = await this.checkServiceHealth(service);
          
          if (healthStatus.healthy) {
            readyServices.add(service);
            console.log(`✅ Service ${service} is ready (${Math.round(healthStatus.responseTime)}ms)`);
          } else if (this.config.dependencyValidation.failFast && serviceDeps.criticalDependencies.length > 0) {
            failedServices.add(service);
            console.log(`❌ Critical service ${service} failed: ${healthStatus.error}`);
          }
        } catch (error) {
          if (this.config.dependencyValidation.failFast) {
            failedServices.add(service);
            console.log(`❌ Service ${service} failed health check: ${error}`);
          }
        }
      }

      // Wait before next check
      if (readyServices.size + failedServices.size < servicesInOrder.length) {
        await new Promise(resolve => setTimeout(resolve, this.config.interval));
      }
    }

    const startupTime = performance.now() - startTime;
    const success = readyServices.size === servicesInOrder.length;

    return {
      success,
      healthyServices: Array.from(readyServices),
      unhealthyServices: Array.from(failedServices),
      startupTime: Math.round(startupTime)
    };
  }

  /**
   * Validate service dependencies
   */
  async validateDependencies(serviceName: string): Promise<{
    valid: boolean;
    missingDependencies: string[];
    unhealthyDependencies: string[];
    details: ServiceDependency[];
  }> {
    const serviceConfig = this.dependencyMap[serviceName];
    if (!serviceConfig) {
      return {
        valid: false,
        missingDependencies: [serviceName],
        unhealthyDependencies: [],
        details: []
      };
    }

    const dependencyChecks = await Promise.all(
      serviceConfig.dependencies.map(async (depName) => {
        try {
          const depHealth = await this.checkServiceHealth(depName);
          return {
            name: depName,
            healthy: depHealth.healthy,
            status: depHealth.status,
            responseTime: depHealth.responseTime,
            error: depHealth.error
          };
        } catch (error) {
          return {
            name: depName,
            healthy: false,
            status: 'unhealthy',
            responseTime: 0,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );

    const missingDependencies = dependencyChecks
      .filter(dep => dep.status === 'unknown')
      .map(dep => dep.name);

    const unhealthyDependencies = dependencyChecks
      .filter(dep => !dep.healthy && dep.status !== 'unknown')
      .map(dep => dep.name);

    const details: ServiceDependency[] = dependencyChecks.map(dep => ({
      name: dep.name,
      type: this.getDependencyType(dep.name),
      required: serviceConfig.criticalDependencies.includes(dep.name),
      healthy: dep.healthy,
      responseTime: dep.responseTime,
      error: dep.error
    }));

    return {
      valid: missingDependencies.length === 0 && unhealthyDependencies.length === 0,
      missingDependencies,
      unhealthyDependencies,
      details
    };
  }

  /**
   * Generate health report for all services
   */
  async generateHealthReport(): Promise<{
    timestamp: string;
    overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    services: ServiceHealthStatus[];
    summary: {
      totalServices: number;
      healthyServices: number;
      unhealthyServices: number;
      averageResponseTime: number;
    };
    recommendations: string[];
  }> {
    const healthMap = await this.checkAllServicesHealth();
    const services = Array.from(healthMap.values());
    
    const healthyServices = services.filter(s => s.healthy);
    const unhealthyServices = services.filter(s => !s.healthy);
    
    const averageResponseTime = services.length > 0 
      ? services.reduce((sum, s) => sum + s.responseTime, 0) / services.length 
      : 0;

    let overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyServices.length === 0) {
      overallHealth = 'healthy';
    } else if (unhealthyServices.length <= services.length * 0.3) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'unhealthy';
    }

    const recommendations = this.generateRecommendations(services);

    return {
      timestamp: new Date().toISOString(),
      overallHealth,
      services,
      summary: {
        totalServices: services.length,
        healthyServices: healthyServices.length,
        unhealthyServices: unhealthyServices.length,
        averageResponseTime: Math.round(averageResponseTime)
      },
      recommendations
    };
  }

  /**
   * Monitor service health continuously
   */
  startHealthMonitoring(callback?: (report: any) => void): () => void {
    const intervalId = setInterval(async () => {
      try {
        const report = await this.generateHealthReport();
        callback?.(report);
        
        // Log unhealthy services
        const unhealthyServices = report.services.filter(s => !s.healthy);
        if (unhealthyServices.length > 0) {
          console.warn(`⚠️ Unhealthy services detected:`, 
            unhealthyServices.map(s => `${s.serviceName} (${s.error})`).join(', ')
          );
        }
      } catch (error) {
        console.error('Health monitoring error:', error);
      }
    }, this.config.interval);

    return () => clearInterval(intervalId);
  }

  /**
   * Get service health history
   */
  getHealthHistory(serviceName: string, limit: number = 10): ServiceHealthStatus[] {
    const history = this.healthHistory.get(serviceName) || [];
    return history.slice(-limit);
  }

  /**
   * Clear health history
   */
  clearHealthHistory(): void {
    this.healthHistory.clear();
  }

  // Private helper methods

  private buildDependencyMap(): ServiceDependencyMap {
    return {
      'userManagement': {
        dependencies: [],
        startupOrder: 1,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: []
      },
      'smartWhitelist': {
        dependencies: ['userManagement'],
        startupOrder: 2,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready', 
        criticalDependencies: ['userManagement']
      },
      'conversationEngine': {
        dependencies: ['userManagement'],
        startupOrder: 2,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: ['userManagement']
      },
      'realtimeProcessor': {
        dependencies: ['conversationEngine'],
        startupOrder: 3,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: ['conversationEngine']
      },
      'profileAnalytics': {
        dependencies: ['userManagement'],
        startupOrder: 2,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: ['userManagement']
      },
      'phoneGateway': {
        dependencies: ['userManagement', 'smartWhitelist', 'realtimeProcessor'],
        startupOrder: 4,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: ['userManagement', 'realtimeProcessor']
      },
      'configurationService': {
        dependencies: [],
        startupOrder: 1,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: []
      },
      'storageService': {
        dependencies: [],
        startupOrder: 1,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: []
      },
      'monitoringService': {
        dependencies: [],
        startupOrder: 1,
        healthEndpoint: '/health',
        readinessEndpoint: '/ready',
        criticalDependencies: []
      }
    };
  }

  private getServicesInStartupOrder(): string[] {
    const services = Object.entries(this.dependencyMap);
    services.sort((a, b) => a[1].startupOrder - b[1].startupOrder);
    return services.map(([name, _]) => name);
  }

  private getServiceUrl(serviceName: string): string | undefined {
    const services = (this.apiClient as any).services;
    return services[serviceName];
  }

  private getDependencyType(depName: string): ServiceDependency['type'] {
    const typeMap: { [key: string]: ServiceDependency['type'] } = {
      'postgres': 'database',
      'redis': 'cache',
      'azure': 'external_api',
      'rabbitmq': 'message_queue',
      'storage': 'storage'
    };

    for (const [key, type] of Object.entries(typeMap)) {
      if (depName.toLowerCase().includes(key)) {
        return type;
      }
    }

    return 'external_api';
  }

  private addToHistory(serviceName: string, status: ServiceHealthStatus): void {
    if (!this.healthHistory.has(serviceName)) {
      this.healthHistory.set(serviceName, []);
    }

    const history = this.healthHistory.get(serviceName)!;
    history.push(status);

    // Keep only last 100 entries
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
  }

  private generateRecommendations(services: ServiceHealthStatus[]): string[] {
    const recommendations: string[] = [];
    const unhealthyServices = services.filter(s => !s.healthy);

    if (unhealthyServices.length > 0) {
      recommendations.push(
        `${unhealthyServices.length} service(s) are unhealthy: ${unhealthyServices.map(s => s.serviceName).join(', ')}`
      );

      // Check for dependency issues
      for (const service of unhealthyServices) {
        const deps = this.dependencyMap[service.serviceName];
        if (deps && deps.criticalDependencies.length > 0) {
          const unhealthyDeps = deps.criticalDependencies.filter(dep =>
            services.find(s => s.serviceName === dep && !s.healthy)
          );
          
          if (unhealthyDeps.length > 0) {
            recommendations.push(
              `Service ${service.serviceName} depends on unhealthy services: ${unhealthyDeps.join(', ')}`
            );
          }
        }
      }
    }

    // Performance recommendations
    const slowServices = services.filter(s => s.responseTime > 5000);
    if (slowServices.length > 0) {
      recommendations.push(
        `Slow response times detected: ${slowServices.map(s => `${s.serviceName} (${s.responseTime}ms)`).join(', ')}`
      );
    }

    // General recommendations
    if (services.length === 0) {
      recommendations.push('No services detected - check service discovery configuration');
    } else if (unhealthyServices.length === 0) {
      recommendations.push('All services are healthy - system is operating normally');
    }

    return recommendations;
  }
}

export default ServiceHealthChecker;