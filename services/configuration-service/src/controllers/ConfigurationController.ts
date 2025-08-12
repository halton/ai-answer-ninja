import { Request, Response, NextFunction } from 'express';
import { GlobalConfigService } from '../services/GlobalConfigService';
import { UserConfigService } from '../services/UserConfigService';
import { FeatureFlagsService } from '../services/FeatureFlagsService';
import { ExperimentService } from '../services/ExperimentService';
import { logger } from '@shared/utils/logger';

export class ConfigurationController {
  constructor(
    private globalConfigService: GlobalConfigService,
    private userConfigService: UserConfigService,
    private featureFlagsService: FeatureFlagsService,
    private experimentService: ExperimentService
  ) {}

  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const { service, key } = req.params;
      const userId = req.user?.id;

      let config = await this.userConfigService.getUserConfig(userId, `${service}.${key}`);
      
      if (!config || config.inheritsGlobal) {
        const globalConfig = await this.globalConfigService.getConfig(`${service}.${key}`);
        config = config?.inheritsGlobal ? { ...globalConfig, ...config } : globalConfig;
      }

      if (!config) {
        return res.status(404).json({ error: 'Configuration not found' });
      }

      res.json({ 
        service, 
        key, 
        value: config.value,
        source: config.source || 'global',
        updatedAt: config.updatedAt 
      });
    } catch (error) {
      logger.error('Error getting config:', error);
      next(error);
    }
  }

  async updateConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const { service } = req.params;
      const { key, value, type = 'system', description } = req.body;

      if (!req.user?.permissions?.includes('admin')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const config = await this.globalConfigService.setConfig(
        `${service}.${key}`,
        value,
        type,
        description
      );

      await this.notifyConfigChange(service, key, value);

      res.json({ 
        success: true, 
        config,
        message: 'Configuration updated successfully' 
      });
    } catch (error) {
      logger.error('Error updating config:', error);
      next(error);
    }
  }

  async getFeatureFlags(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      
      const features = await this.featureFlagsService.getEnabledFeatures(userId);
      const experiments = await this.experimentService.getUserExperiments(userId);

      res.json({
        userId,
        features,
        experiments,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error getting feature flags:', error);
      next(error);
    }
  }

  async configureExperiment(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, config, targetPercentage, criteria } = req.body;

      if (!req.user?.permissions?.includes('admin')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const experiment = await this.experimentService.createExperiment({
        name,
        config,
        targetPercentage,
        criteria,
        status: 'active'
      });

      res.json({ 
        success: true,
        experiment,
        message: 'Experiment configured successfully' 
      });
    } catch (error) {
      logger.error('Error configuring experiment:', error);
      next(error);
    }
  }

  async exportConfigs(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.permissions?.includes('admin')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const configs = await this.globalConfigService.exportAllConfigs();
      
      res.json({
        version: '1.0',
        exportedAt: new Date(),
        configs
      });
    } catch (error) {
      logger.error('Error exporting configs:', error);
      next(error);
    }
  }

  async importConfigs(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.permissions?.includes('admin')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { configs, overwrite = false } = req.body;
      
      const results = await this.globalConfigService.importConfigs(configs, overwrite);
      
      res.json({
        success: true,
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors
      });
    } catch (error) {
      logger.error('Error importing configs:', error);
      next(error);
    }
  }

  private async notifyConfigChange(service: string, key: string, value: any) {
    try {
      // TODO: Implement Redis pub/sub or WebSocket notification
      logger.info(`Config changed: ${service}.${key}`, { value });
    } catch (error) {
      logger.error('Failed to notify config change:', error);
    }
  }
}