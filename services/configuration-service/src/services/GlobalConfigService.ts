import { ConfigDatabase } from '../database/ConfigDatabase';
import { logger } from '@shared/utils/logger';
import { RedisCache } from '@shared/cache/RedisCache';

interface GlobalConfig {
  key: string;
  value: any;
  type: string;
  description?: string;
  isActive: boolean;
  updatedAt: Date;
}

export class GlobalConfigService {
  private cache: RedisCache;
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(private db: ConfigDatabase) {
    this.cache = new RedisCache('config:global');
  }

  async getConfig(key: string): Promise<GlobalConfig | null> {
    try {
      const cached = await this.cache.get(key);
      if (cached) {
        return JSON.parse(cached);
      }

      const config = await this.db.getGlobalConfig(key);
      
      if (config) {
        await this.cache.set(key, JSON.stringify(config), this.CACHE_TTL);
      }

      return config;
    } catch (error) {
      logger.error('Error getting global config:', error);
      throw error;
    }
  }

  async setConfig(
    key: string, 
    value: any, 
    type: string = 'system',
    description?: string
  ): Promise<GlobalConfig> {
    try {
      const config = await this.db.setGlobalConfig({
        key,
        value,
        type,
        description,
        isActive: true,
        updatedAt: new Date()
      });

      await this.cache.delete(key);
      await this.cache.set(key, JSON.stringify(config), this.CACHE_TTL);

      logger.info('Global config updated', { key, type });
      
      return config;
    } catch (error) {
      logger.error('Error setting global config:', error);
      throw error;
    }
  }

  async deleteConfig(key: string): Promise<boolean> {
    try {
      const result = await this.db.deleteGlobalConfig(key);
      await this.cache.delete(key);
      
      logger.info('Global config deleted', { key });
      
      return result;
    } catch (error) {
      logger.error('Error deleting global config:', error);
      throw error;
    }
  }

  async getConfigsByType(type: string): Promise<GlobalConfig[]> {
    try {
      return await this.db.getGlobalConfigsByType(type);
    } catch (error) {
      logger.error('Error getting configs by type:', error);
      throw error;
    }
  }

  async exportAllConfigs(): Promise<GlobalConfig[]> {
    try {
      return await this.db.getAllGlobalConfigs();
    } catch (error) {
      logger.error('Error exporting configs:', error);
      throw error;
    }
  }

  async importConfigs(configs: GlobalConfig[], overwrite: boolean = false) {
    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[]
    };

    for (const config of configs) {
      try {
        const existing = await this.getConfig(config.key);
        
        if (existing && !overwrite) {
          results.skipped++;
          continue;
        }

        await this.setConfig(
          config.key,
          config.value,
          config.type,
          config.description
        );
        
        results.imported++;
      } catch (error) {
        results.errors.push(`Failed to import ${config.key}: ${error.message}`);
      }
    }

    return results;
  }

  async validateConfig(key: string, value: any): Promise<boolean> {
    try {
      const schema = await this.getConfigSchema(key);
      
      if (!schema) {
        return true;
      }

      // TODO: Implement JSON schema validation
      return true;
    } catch (error) {
      logger.error('Error validating config:', error);
      return false;
    }
  }

  private async getConfigSchema(key: string): Promise<any> {
    // TODO: Implement schema retrieval
    return null;
  }
}