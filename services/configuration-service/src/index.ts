import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { ConfigurationController } from './controllers/ConfigurationController';
import { GlobalConfigService } from './services/GlobalConfigService';
import { UserConfigService } from './services/UserConfigService';
import { FeatureFlagsService } from './services/FeatureFlagsService';
import { ExperimentService } from './services/ExperimentService';
import { errorHandler } from '@shared/middleware/errorHandler';
import { requestLogger } from '@shared/middleware/requestLogger';
import { authMiddleware } from '@shared/middleware/authMiddleware';
import { rateLimiter } from '@shared/middleware/rateLimiter';
import { ConfigDatabase } from './database/ConfigDatabase';
import { logger } from '@shared/utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.CONFIG_SERVICE_PORT || 3007;

async function initialize() {
  try {
    const db = new ConfigDatabase();
    await db.initialize();

    const globalConfigService = new GlobalConfigService(db);
    const userConfigService = new UserConfigService(db);
    const featureFlagsService = new FeatureFlagsService(db);
    const experimentService = new ExperimentService(db);

    const controller = new ConfigurationController(
      globalConfigService,
      userConfigService,
      featureFlagsService,
      experimentService
    );

    app.use(helmet());
    app.use(cors());
    app.use(express.json());
    app.use(requestLogger);
    app.use(rateLimiter);

    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'configuration-service', timestamp: new Date() });
    });

    app.get('/config/:service/:key', authMiddleware, controller.getConfig.bind(controller));
    app.post('/config/:service', authMiddleware, controller.updateConfig.bind(controller));
    app.get('/config/features/:userId', authMiddleware, controller.getFeatureFlags.bind(controller));
    app.post('/config/experiments', authMiddleware, controller.configureExperiment.bind(controller));
    app.get('/config/export', authMiddleware, controller.exportConfigs.bind(controller));
    app.post('/config/import', authMiddleware, controller.importConfigs.bind(controller));

    app.use(errorHandler);

    app.listen(PORT, () => {
      logger.info(`Configuration Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Configuration Service:', error);
    process.exit(1);
  }
}

initialize();