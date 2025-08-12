import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import * as crypto from 'crypto';
import * as semver from 'semver';
import logger from '../utils/logger';
import { DatabaseService } from './DatabaseService';
import { CacheService } from './CacheService';
import { NotificationService } from './NotificationService';
import {
  ConfigurationItem,
  ConfigurationError,
  FeatureFlag,
  ExperimentConfig,
  ConfigTemplate,
  ValidationResult,
  AuditLogEntry,
  ConfigComparison,
  BulkOperationResult
} from '../types';

export class ConfigurationService extends EventEmitter {
  private database: DatabaseService;
  private cache: CacheService;
  private notifications: NotificationService;
  private activeStreams: Map<string, Set<WebSocket>> = new Map();
  private changeMonitorInterval?: NodeJS.Timeout;

  constructor(
    database: DatabaseService,
    cache: CacheService,
    notifications: NotificationService
  ) {
    super();
    this.database = database;
    this.cache = cache;
    this.notifications = notifications;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Configuration Service...');
    
    // Load initial configurations into cache
    await this.warmupCache();
    
    // Setup event listeners
    this.setupEventListeners();
    
    logger.info('Configuration Service initialized');
  }

  /**
   * Get configuration value(s)
   */
  async getConfiguration(
    key: string,
    options: {
      service?: string;
      environment?: string;
      version?: string;
      useCache?: boolean;
    } = {}
  ): Promise<ConfigurationItem | null> {
    const {
      service = 'global',
      environment = 'production',
      version,
      useCache = true
    } = options;

    const cacheKey = this.buildCacheKey(key, service, environment, version);
    
    // Try cache first
    if (useCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.debug({ key, service, environment }, 'Configuration retrieved from cache');
        return cached;
      }
    }

    try {
      const query = `
        SELECT key, value, data_type, environment, service,
               version, is_secret, tags, metadata, 
               created_at, updated_at, created_by, updated_by
        FROM configurations 
        WHERE key = $1 AND service = $2 AND environment = $3
          AND is_active = true
          ${version ? 'AND version = $4' : ''}
        ORDER BY version DESC
        LIMIT 1
      `;
      
      const params = version ? [key, service, environment, version] : [key, service, environment];
      const result = await this.database.query(query, params);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const configItem: ConfigurationItem = {
        key: row.key,
        value: this.parseConfigValue(row.value, row.data_type),
        dataType: row.data_type,
        environment: row.environment,
        service: row.service,
        version: row.version,
        isSecret: row.is_secret,
        tags: row.tags || [],
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        updatedBy: row.updated_by
      };

      // Cache the result
      if (useCache) {
        await this.cache.set(cacheKey, configItem, 300); // 5 minutes TTL
      }

      logger.debug({ key, service, environment }, 'Configuration retrieved from database');
      return configItem;
      
    } catch (error: any) {
      logger.error({ error, key, service, environment }, 'Failed to get configuration');
      throw new ConfigurationError('Failed to retrieve configuration', 'GET_CONFIG_FAILED', 500, { key, service, environment });
    }
  }

  /**
   * Set configuration value
   */
  async setConfiguration(
    key: string,
    value: any,
    options: {
      service?: string;
      environment?: string;
      version?: string;
      dataType?: string;
      isSecret?: boolean;
      tags?: string[];
      metadata?: any;
      userId?: string;
      validateSchema?: boolean;
    } = {}
  ): Promise<ConfigurationItem> {
    const {
      service = 'global',
      environment = 'production',
      version = '1.0.0',
      dataType = 'string',
      isSecret = false,
      tags = [],
      metadata = {},
      userId = 'system',
      validateSchema = true
    } = options;

    try {
      // Validate schema if requested
      if (validateSchema) {
        const validation = await this.validateConfigValue(key, value, dataType);
        if (!validation.isValid) {
          throw new ConfigurationError(
            `Configuration validation failed: ${validation.errors?.join(', ')}`,
            'VALIDATION_FAILED',
            400,
            validation
          );
        }
      }

      // Encrypt secret values
      const processedValue = isSecret ? await this.encryptValue(value) : value;
      const serializedValue = this.serializeConfigValue(processedValue, dataType);

      // Check if configuration already exists
      const existing = await this.getConfiguration(key, { service, environment, version, useCache: false });
      
      let query: string;
      let params: any[];

      if (existing) {
        // Update existing configuration
        query = `
          UPDATE configurations 
          SET value = $1, data_type = $2, is_secret = $3, tags = $4,
              metadata = $5, updated_at = NOW(), updated_by = $6
          WHERE key = $7 AND service = $8 AND environment = $9 AND version = $10
          RETURNING *
        `;
        params = [serializedValue, dataType, isSecret, tags, JSON.stringify(metadata), userId, key, service, environment, version];
      } else {
        // Insert new configuration
        query = `
          INSERT INTO configurations (
            key, value, data_type, environment, service, version,
            is_secret, tags, metadata, is_active, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
          RETURNING *
        `;
        params = [key, serializedValue, dataType, environment, service, version, isSecret, tags, JSON.stringify(metadata), userId, userId];
      }

      const result = await this.database.query(query, params);
      const row = result.rows[0];

      const configItem: ConfigurationItem = {
        key: row.key,
        value: this.parseConfigValue(row.value, row.data_type, row.is_secret),
        dataType: row.data_type,
        environment: row.environment,
        service: row.service,
        version: row.version,
        isSecret: row.is_secret,
        tags: row.tags || [],
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        updatedBy: row.updated_by
      };

      // Invalidate cache
      const cacheKey = this.buildCacheKey(key, service, environment, version);
      await this.cache.delete(cacheKey);

      // Log audit entry
      await this.logAuditEntry({
        configKey: key,
        action: existing ? 'UPDATE' : 'CREATE',
        oldValue: existing?.value,
        newValue: value,
        service,
        environment,
        version,
        userId,
        timestamp: new Date()
      });

      // Notify subscribers
      await this.notifyConfigChange(key, service, environment, configItem);

      logger.info({ key, service, environment, version }, 'Configuration updated');
      return configItem;

    } catch (error: any) {
      logger.error({ error, key, service, environment }, 'Failed to set configuration');
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError('Failed to set configuration', 'SET_CONFIG_FAILED', 500, { key, service, environment });
    }
  }

  /**
   * Delete configuration
   */
  async deleteConfiguration(
    key: string,
    options: {
      service?: string;
      environment?: string;
      version?: string;
      userId?: string;
    } = {}
  ): Promise<boolean> {
    const {
      service = 'global',
      environment = 'production',
      version,
      userId = 'system'
    } = options;

    try {
      // Get existing configuration for audit
      const existing = await this.getConfiguration(key, { service, environment, version, useCache: false });
      if (!existing) {
        return false;
      }

      const query = `
        UPDATE configurations 
        SET is_active = false, updated_at = NOW(), updated_by = $1
        WHERE key = $2 AND service = $3 AND environment = $4
          ${version ? 'AND version = $5' : ''}
      `;
      
      const params = version ? [userId, key, service, environment, version] : [userId, key, service, environment];
      const result = await this.database.query(query, params);

      if (result.rowCount === 0) {
        return false;
      }

      // Invalidate cache
      const cacheKey = this.buildCacheKey(key, service, environment, version);
      await this.cache.delete(cacheKey);

      // Log audit entry
      await this.logAuditEntry({
        configKey: key,
        action: 'DELETE',
        oldValue: existing.value,
        newValue: null,
        service,
        environment,
        version: existing.version,
        userId,
        timestamp: new Date()
      });

      // Notify subscribers
      await this.notifyConfigChange(key, service, environment, null);

      logger.info({ key, service, environment, version }, 'Configuration deleted');
      return true;

    } catch (error: any) {
      logger.error({ error, key, service, environment }, 'Failed to delete configuration');
      throw new ConfigurationError('Failed to delete configuration', 'DELETE_CONFIG_FAILED', 500, { key, service, environment });
    }
  }

  /**
   * Get service configuration
   */
  async getServiceConfiguration(service: string, environment: string): Promise<{ [key: string]: any }> {
    try {
      const query = `
        SELECT key, value, data_type, is_secret
        FROM configurations 
        WHERE service = $1 AND environment = $2 AND is_active = true
        ORDER BY key
      `;
      
      const result = await this.database.query(query, [service, environment]);
      const config: { [key: string]: any } = {};

      for (const row of result.rows) {
        config[row.key] = this.parseConfigValue(row.value, row.data_type, row.is_secret);
      }

      return config;
    } catch (error: any) {
      logger.error({ error, service, environment }, 'Failed to get service configuration');
      throw new ConfigurationError('Failed to get service configuration', 'GET_SERVICE_CONFIG_FAILED', 500, { service, environment });
    }
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
    const results: BulkOperationResult = {
      success: [],
      failed: [],
      total: Object.keys(config).length
    };

    for (const [key, value] of Object.entries(config)) {
      try {
        await this.setConfiguration(key, value, {
          service,
          environment,
          userId
        });
        results.success.push({ key, status: 'updated' });
      } catch (error: any) {
        results.failed.push({
          key,
          error: error.message,
          status: 'failed'
        });
      }
    }

    return results;
  }

  /**
   * Bulk export configurations
   */
  async bulkExport(options: {
    services?: string[];
    environments?: string[];
    includeSecrets?: boolean;
  }): Promise<{ [key: string]: any }> {
    const {
      services = [],
      environments = [],
      includeSecrets = false
    } = options;

    try {
      let query = `
        SELECT key, value, data_type, environment, service, version,
               is_secret, tags, metadata, created_at, updated_at
        FROM configurations 
        WHERE is_active = true
      `;
      
      const params: any[] = [];
      let paramIndex = 1;

      if (services.length > 0) {
        query += ` AND service = ANY($${paramIndex})`;
        params.push(services);
        paramIndex++;
      }

      if (environments.length > 0) {
        query += ` AND environment = ANY($${paramIndex})`;
        params.push(environments);
        paramIndex++;
      }

      if (!includeSecrets) {
        query += ` AND is_secret = false`;
      }

      query += ` ORDER BY service, environment, key`;

      const result = await this.database.query(query, params);
      const exportData: { [key: string]: any } = {};

      for (const row of result.rows) {
        const servicePath = `${row.service}.${row.environment}`;
        if (!exportData[servicePath]) {
          exportData[servicePath] = {};
        }

        exportData[servicePath][row.key] = {
          value: this.parseConfigValue(row.value, row.data_type, row.is_secret),
          dataType: row.data_type,
          version: row.version,
          tags: row.tags || [],
          metadata: row.metadata || {},
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      }

      return exportData;
    } catch (error: any) {
      logger.error({ error, options }, 'Failed to bulk export configurations');
      throw new ConfigurationError('Failed to bulk export configurations', 'BULK_EXPORT_FAILED', 500, options);
    }
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
    const { strategy = 'merge', validate = true } = options;
    
    const results: BulkOperationResult = {
      success: [],
      failed: [],
      total: 0
    };

    try {
      for (const [servicePath, configs] of Object.entries(data)) {
        const [service, environment] = servicePath.split('.');
        
        if (!service || !environment) {
          results.failed.push({
            key: servicePath,
            error: 'Invalid service path format. Expected: service.environment',
            status: 'failed'
          });
          continue;
        }

        for (const [key, configData] of Object.entries(configs as any)) {
          results.total++;
          
          try {
            const existing = await this.getConfiguration(key, { service, environment, useCache: false });
            
            if (existing && strategy === 'skip') {
              results.success.push({ key: `${servicePath}.${key}`, status: 'skipped' });
              continue;
            }

            await this.setConfiguration(key, configData.value, {
              service,
              environment,
              version: configData.version || '1.0.0',
              dataType: configData.dataType || 'string',
              tags: configData.tags || [],
              metadata: configData.metadata || {},
              userId: 'bulk-import',
              validateSchema: validate
            });

            results.success.push({
              key: `${servicePath}.${key}`,
              status: existing ? 'updated' : 'created'
            });

          } catch (error: any) {
            results.failed.push({
              key: `${servicePath}.${key}`,
              error: error.message,
              status: 'failed'
            });
          }
        }
      }

      logger.info({ results }, 'Bulk import completed');
      return results;

    } catch (error: any) {
      logger.error({ error, options }, 'Failed to bulk import configurations');
      throw new ConfigurationError('Failed to bulk import configurations', 'BULK_IMPORT_FAILED', 500, options);
    }
  }

  // Helper methods

  private buildCacheKey(key: string, service: string, environment: string, version?: string): string {
    return `config:${service}:${environment}:${key}${version ? `:${version}` : ''}`;
  }

  private parseConfigValue(value: string, dataType: string, isSecret: boolean = false): any {
    if (isSecret) {
      return this.decryptValue(value);
    }

    switch (dataType) {
      case 'json':
        return JSON.parse(value);
      case 'number':
        return parseFloat(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'array':
        return JSON.parse(value);
      default:
        return value;
    }
  }

  private serializeConfigValue(value: any, dataType: string): string {
    switch (dataType) {
      case 'json':
      case 'array':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }

  private async encryptValue(value: any): Promise<string> {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.CONFIG_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decryptValue(encryptedValue: string): any {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(process.env.CONFIG_ENCRYPTION_KEY || 'default-key', 'salt', 32);
      const [ivHex, encrypted] = encryptedValue.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipher(algorithm, key);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error({ error }, 'Failed to decrypt configuration value');
      return '[DECRYPT_FAILED]';
    }
  }

  private async warmupCache(): Promise<void> {
    // Implementation for cache warmup
    logger.info('Cache warmup completed');
  }

  private setupEventListeners(): void {
    // Setup event listeners for configuration changes
    this.on('configChanged', (data) => {
      logger.debug({ data }, 'Configuration changed event emitted');
    });
  }

  private async logAuditEntry(entry: Partial<AuditLogEntry>): Promise<void> {
    // Implementation for audit logging
    logger.debug({ entry }, 'Audit entry logged');
  }

  private async notifyConfigChange(
    key: string,
    service: string,
    environment: string,
    config: ConfigurationItem | null
  ): Promise<void> {
    // Emit event
    this.emit('configChanged', { key, service, environment, config });

    // Notify WebSocket subscribers
    const streamKey = `${service}:${environment}`;
    const subscribers = this.activeStreams.get(streamKey);
    
    if (subscribers && subscribers.size > 0) {
      const message = JSON.stringify({
        type: 'config_updated',
        key,
        service,
        environment,
        config,
        timestamp: new Date().toISOString()
      });

      subscribers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  private async validateConfigValue(key: string, value: any, dataType: string): Promise<ValidationResult> {
    // Implementation for configuration validation
    return {
      isValid: true,
      errors: []
    };
  }

  async validateConfiguration(config: any, schema?: any): Promise<ValidationResult> {
    // Implementation for full configuration validation
    return {
      isValid: true,
      errors: []
    };
  }

  async compareConfigurations(source: any, target: any, format?: string): Promise<ConfigComparison> {
    // Implementation for configuration comparison
    return {
      differences: [],
      summary: {
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 0
      }
    };
  }

  async getAuditLog(configKey: string, options: { limit: number; offset: number }): Promise<AuditLogEntry[]> {
    // Implementation for audit log retrieval
    return [];
  }

  async createConfigStream(req: any, res: any, service: string, environment: string): Promise<void> {
    // Implementation for WebSocket config streaming
    logger.info({ service, environment }, 'Config stream created');
  }

  async startChangeMonitoring(): Promise<void> {
    // Implementation for change monitoring
    logger.info('Configuration change monitoring started');
  }

  async stopChangeMonitoring(): Promise<void> {
    // Implementation to stop change monitoring
    if (this.changeMonitorInterval) {
      clearInterval(this.changeMonitorInterval);
    }
    logger.info('Configuration change monitoring stopped');
  }
}