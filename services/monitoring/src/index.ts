import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MonitoringController } from './controllers/MonitoringController';
import { HealthCheckService } from './services/HealthCheckService';
import { MetricsCollector } from './services/MetricsCollector';
import { AlertManager } from './services/AlertManager';
import { TraceService } from './services/TraceService';
import { PerformanceMonitor } from './services/PerformanceMonitor';
import { errorHandler } from '@shared/middleware/errorHandler';
import { requestLogger } from '@shared/middleware/requestLogger';
import { authMiddleware } from '@shared/middleware/authMiddleware';
import { logger } from '@shared/utils/logger';
import { MonitoringDatabase } from './database/MonitoringDatabase';
import { PrometheusExporter } from './exporters/PrometheusExporter';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

const PORT = process.env.MONITORING_SERVICE_PORT || 3009;

async function initialize() {
  try {
    const db = new MonitoringDatabase();
    await db.initialize();

    const healthCheckService = new HealthCheckService();
    const metricsCollector = new MetricsCollector(db);
    const alertManager = new AlertManager(db, io);
    const traceService = new TraceService(db);
    const performanceMonitor = new PerformanceMonitor(metricsCollector);
    const prometheusExporter = new PrometheusExporter(metricsCollector);

    const controller = new MonitoringController(
      healthCheckService,
      metricsCollector,
      alertManager,
      traceService,
      performanceMonitor
    );

    app.use(helmet());
    app.use(cors());
    app.use(express.json());
    app.use(requestLogger);

    // Health endpoints
    app.get('/health', controller.getHealth.bind(controller));
    app.get('/monitoring/health', controller.getSystemHealth.bind(controller));
    app.get('/monitoring/health/:service', controller.getServiceHealth.bind(controller));

    // Metrics endpoints
    app.get('/monitoring/metrics', authMiddleware, controller.getMetrics.bind(controller));
    app.post('/monitoring/metrics', authMiddleware, controller.recordMetric.bind(controller));
    app.get('/monitoring/metrics/prometheus', prometheusExporter.export.bind(prometheusExporter));

    // Alert endpoints
    app.post('/monitoring/alerts', authMiddleware, controller.configureAlert.bind(controller));
    app.get('/monitoring/alerts', authMiddleware, controller.getAlerts.bind(controller));
    app.put('/monitoring/alerts/:alertId', authMiddleware, controller.updateAlert.bind(controller));
    app.delete('/monitoring/alerts/:alertId', authMiddleware, controller.deleteAlert.bind(controller));

    // Trace endpoints
    app.get('/monitoring/traces/:traceId', authMiddleware, controller.getTrace.bind(controller));
    app.post('/monitoring/traces', authMiddleware, controller.recordTrace.bind(controller));

    // Dashboard endpoints
    app.get('/monitoring/dashboard', authMiddleware, controller.getDashboard.bind(controller));
    app.get('/monitoring/services', authMiddleware, controller.getServiceStatuses.bind(controller));

    app.use(errorHandler);

    // Start periodic health checks
    healthCheckService.startHealthChecks();
    
    // Start alert monitoring
    alertManager.startMonitoring();

    server.listen(PORT, () => {
      logger.info(`Monitoring Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Monitoring Service:', error);
    process.exit(1);
  }
}

initialize();