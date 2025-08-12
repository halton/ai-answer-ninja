import { HttpClient } from '../client/HttpClient';
import { ServiceConfig } from '../types';

export interface ConfigurationItem {
  key: string;
  value: any;
  dataType: string;
  environment: string;
  service: string;
  version: string;
  isSecret: boolean;
  tags: string[];
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface ConfigSetOptions {
  service?: string;
  environment?: string;
  version?: string;
  dataType?: string;
  isSecret?: boolean;
  tags?: string[];
  metadata?: any;
  userId?: string;
  validateSchema?: boolean;
}

export interface ConfigGetOptions {
  service?: string;
  environment?: string;
  version?: string;
  useCache?: boolean;
}

export interface BulkOperationResult {
  success: Array<{ key: string; status: string }>;
  failed: Array<{ key: string; error: string; status: string }>;
  total: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface AuditLogEntry {
  id: string;
  configKey: string;
  action: string;
  oldValue: any;
  newValue: any;
  service: string;
  environment: string;
  version?: string;
  userId: string;
  timestamp: Date;
  metadata?: any;
}

export class ConfigurationServiceClient extends HttpClient {
  constructor(config: ServiceConfig) {
    super('configuration-service', config);
  }

  /**
   * Get configuration service health status
   */
  async getHealth(): Promise<any> {
    return this.get('/health');
  }

  /**
   * Get service metrics
   */
  async getMetrics(): Promise<string> {
    const response = await this.client.get('/metrics');
    return response.data;
  }

  /**
   * Get a configuration value
   */
  async getConfiguration(
    key: string,
    options: ConfigGetOptions = {}
  ): Promise<ConfigurationItem | null> {
    const params = new URLSearchParams();
    if (options.service) params.append('service', options.service);
    if (options.environment) params.append('environment', options.environment);
    if (options.version) params.append('version', options.version);
    if (options.useCache !== undefined) params.append('useCache', String(options.useCache));

    return this.get(`/api/v1/config/${key}?${params.toString()}`);
  }

  /**
   * Set a configuration value
   */
  async setConfiguration(
    key: string,
    value: any,
    options: ConfigSetOptions = {}
  ): Promise<ConfigurationItem> {
    return this.put(`/api/v1/config/${key}`, {
      value,
      ...options
    });
  }

  /**
   * Delete a configuration
   */
  async deleteConfiguration(
    key: string,
    options: {
      service?: string;
      environment?: string;
      version?: string;
      userId?: string;
    } = {}
  ): Promise<{ success: boolean }> {
    const params = new URLSearchParams();
    if (options.service) params.append('service', options.service);
    if (options.environment) params.append('environment', options.environment);
    if (options.version) params.append('version', options.version);
    if (options.userId) params.append('userId', options.userId);

    await this.delete(`/api/v1/config/${key}?${params.toString()}`);
    return { success: true };
  }

  /**
   * Get all configurations for a service
   */
  async getServiceConfiguration(
    service: string,
    environment: string = 'production'
  ): Promise<{ [key: string]: any }> {
    return this.get(`/api/v1/services/${service}/config?environment=${environment}`);
  }

  /**
   * Update service configuration
   */
  async updateServiceConfiguration(
    service: string,
    environment: string,
    config: { [key: string]: any },
    userId: string = 'system'
  ): Promise<BulkOperationResult> {
    return this.put(`/api/v1/services/${service}/config`, {
      environment,
      config,
      userId
    });
  }

  /**
   * List configurations with filters
   */
  async listConfigurations(options: {
    service?: string;
    environment?: string;
    tags?: string[];
    keyPattern?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{
    items: ConfigurationItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const params = new URLSearchParams();
    if (options.service) params.append('service', options.service);
    if (options.environment) params.append('environment', options.environment);
    if (options.keyPattern) params.append('keyPattern', options.keyPattern);
    if (options.limit) params.append('limit', String(options.limit));
    if (options.offset) params.append('offset', String(options.offset));
    if (options.tags) {
      options.tags.forEach(tag => params.append('tags', tag));
    }

    return this.get(`/api/v1/config?${params.toString()}`);
  }

  /**
   * Validate configuration
   */
  async validateConfiguration(
    config: any,
    schema?: any
  ): Promise<ValidationResult> {
    return this.post('/api/v1/validate', { config, schema });
  }

  /**
   * Compare configurations
   */
  async compareConfigurations(
    source: any,
    target: any,
    format?: string
  ): Promise<any> {
    return this.post('/api/v1/compare', { source, target, format });
  }

  /**
   * Get audit log for a configuration
   */
  async getAuditLog(
    configKey: string,
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', String(options.limit));
    if (options.offset) params.append('offset', String(options.offset));

    return this.get(`/api/v1/audit/${configKey}?${params.toString()}`);
  }

  /**
   * Bulk export configurations
   */
  async bulkExport(options: {
    services?: string[];
    environments?: string[];
    includeSecrets?: boolean;
  } = {}): Promise<{ [key: string]: any }> {
    return this.post('/api/v1/bulk/export', options);
  }

  /**
   * Bulk import configurations
   */
  async bulkImport(
    data: { [key: string]: any },
    options: {
      strategy?: 'merge' | 'replace' | 'skip';
      validate?: boolean;
    } = {}
  ): Promise<BulkOperationResult> {
    return this.post('/api/v1/bulk/import', { data, ...options });
  }

  /**
   * Get feature flag value
   */
  async getFeatureFlag(
    flagName: string,
    options: {
      userId?: string;
      environment?: string;
      defaultValue?: boolean;
    } = {}
  ): Promise<{
    enabled: boolean;
    variant?: string;
    reason?: string;
  }> {
    const params = new URLSearchParams();
    if (options.userId) params.append('userId', options.userId);
    if (options.environment) params.append('environment', options.environment);
    if (options.defaultValue !== undefined) params.append('defaultValue', String(options.defaultValue));

    return this.get(`/api/v1/features/${flagName}?${params.toString()}`);
  }

  /**
   * Set feature flag
   */
  async setFeatureFlag(
    flagName: string,
    config: {
      enabled: boolean;
      variants?: any;
      conditions?: any;
      environment?: string;
    }
  ): Promise<any> {
    return this.put(`/api/v1/features/${flagName}`, config);
  }

  /**
   * Get experiment configuration
   */
  async getExperiment(
    experimentName: string,
    options: {
      userId?: string;
      environment?: string;
    } = {}
  ): Promise<{
    variant: string;
    config: any;
    reason?: string;
  }> {
    const params = new URLSearchParams();
    if (options.userId) params.append('userId', options.userId);
    if (options.environment) params.append('environment', options.environment);

    return this.get(`/api/v1/experiments/${experimentName}?${params.toString()}`);
  }

  /**
   * Create configuration template
   */
  async createTemplate(
    templateName: string,
    template: {
      schema: any;
      defaults: any;
      description?: string;
      tags?: string[];
    }
  ): Promise<any> {
    return this.post(`/api/v1/templates/${templateName}`, template);
  }

  /**
   * Apply configuration template
   */
  async applyTemplate(
    templateName: string,
    service: string,
    environment: string,
    overrides: any = {}
  ): Promise<BulkOperationResult> {
    return this.post(`/api/v1/templates/${templateName}/apply`, {
      service,
      environment,
      overrides
    });
  }

  /**
   * Get template list
   */
  async listTemplates(): Promise<Array<{
    name: string;
    description?: string;
    tags?: string[];
    createdAt: Date;
    updatedAt: Date;
  }>> {
    return this.get('/api/v1/templates');
  }

  /**
   * Watch configuration changes (returns a promise that resolves with WebSocket)
   */
  async watchConfigurations(
    service: string,
    environment: string,
    callback: (change: {
      type: 'config_updated' | 'config_deleted';
      key: string;
      service: string;
      environment: string;
      config?: ConfigurationItem;
      timestamp: string;
    }) => void
  ): Promise<WebSocket> {
    // This would typically create a WebSocket connection
    // For now, return a mock promise
    return new Promise((resolve, reject) => {
      try {
        const protocol = this.config.baseURL.startsWith('https') ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${this.config.host}:${this.config.port}/api/v1/stream/${service}?environment=${environment}`;
        
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          resolve(ws);
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            callback(data);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };
        
        ws.onerror = (error) => {
          reject(error);
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }
}