/**
 * Service Registry for managing service endpoints
 * Supports both local development and containerized deployments
 */

import { ServiceEndpoint, ServiceRegistry as ServiceRegistryType } from '../types';

export class ServiceRegistry {
  private services: ServiceRegistryType = {};
  private environment: 'development' | 'docker' | 'kubernetes';

  constructor() {
    this.environment = this.detectEnvironment();
    this.initializeDefaults();
  }

  private detectEnvironment(): 'development' | 'docker' | 'kubernetes' {
    if (process.env.KUBERNETES_SERVICE_HOST) {
      return 'kubernetes';
    } else if (process.env.NODE_ENV === 'development' && !process.env.DOCKER_CONTAINER) {
      return 'development';
    } else {
      return 'docker';
    }
  }

  private initializeDefaults(): void {
    const baseServices = {
      'realtime-processor': {
        name: 'realtime-processor',
        port: 3002,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'conversation-engine': {
        name: 'conversation-engine',
        port: 3003,
        protocol: 'http' as const,
        healthPath: '/api/v1/health'
      },
      'user-management': {
        name: 'user-management',
        port: 3005,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'smart-whitelist': {
        name: 'smart-whitelist',
        port: 3006,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'phone-gateway': {
        name: 'phone-gateway',
        port: 3001,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'profile-analytics': {
        name: 'profile-analytics',
        port: 3004,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'configuration': {
        name: 'configuration',
        port: 3007,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'storage': {
        name: 'storage',
        port: 3008,
        protocol: 'http' as const,
        healthPath: '/health'
      },
      'monitoring': {
        name: 'monitoring',
        port: 3009,
        protocol: 'http' as const,
        healthPath: '/health'
      }
    };

    // Set hosts based on environment
    Object.entries(baseServices).forEach(([serviceName, config]) => {
      this.services[serviceName] = {
        ...config,
        host: this.getHostForService(serviceName),
        timeout: 30000 // 30 second default timeout
      };
    });
  }

  private getHostForService(serviceName: string): string {
    switch (this.environment) {
      case 'development':
        return 'localhost';
      case 'docker':
        return serviceName; // Docker compose service name
      case 'kubernetes':
        return `${serviceName}.ai-ninja.svc.cluster.local`;
      default:
        return 'localhost';
    }
  }

  /**
   * Register a service endpoint
   */
  register(service: ServiceEndpoint): void {
    this.services[service.name] = service;
  }

  /**
   * Get service endpoint by name
   */
  get(serviceName: string): ServiceEndpoint | null {
    return this.services[serviceName] || null;
  }

  /**
   * Get all registered services
   */
  getAll(): ServiceRegistryType {
    return { ...this.services };
  }

  /**
   * Get service URL
   */
  getUrl(serviceName: string, path: string = ''): string {
    const service = this.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found in registry`);
    }

    const url = `${service.protocol}://${service.host}:${service.port}`;
    return path ? `${url}${path.startsWith('/') ? path : '/' + path}` : url;
  }

  /**
   * Check if service is registered
   */
  has(serviceName: string): boolean {
    return serviceName in this.services;
  }

  /**
   * Remove service from registry
   */
  unregister(serviceName: string): boolean {
    if (serviceName in this.services) {
      delete this.services[serviceName];
      return true;
    }
    return false;
  }

  /**
   * Update service endpoint
   */
  update(serviceName: string, updates: Partial<ServiceEndpoint>): boolean {
    if (serviceName in this.services) {
      this.services[serviceName] = {
        ...this.services[serviceName],
        ...updates
      };
      return true;
    }
    return false;
  }

  /**
   * Get current environment
   */
  getEnvironment(): string {
    return this.environment;
  }

  /**
   * Get service health check URL
   */
  getHealthCheckUrl(serviceName: string): string {
    const service = this.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found in registry`);
    }

    const healthPath = service.healthPath || '/health';
    return this.getUrl(serviceName, healthPath);
  }

  /**
   * Bulk register services
   */
  registerMany(services: ServiceEndpoint[]): void {
    services.forEach(service => this.register(service));
  }

  /**
   * Export configuration for debugging
   */
  exportConfig(): { environment: string; services: ServiceRegistryType } {
    return {
      environment: this.environment,
      services: this.getAll()
    };
  }
}

// Singleton instance
export const serviceRegistry = new ServiceRegistry();