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
import { CustomMetricsService } from './services/CustomMetricsService';
import { IntelligentAlertingService } from './services/IntelligentAlertingService';
import { errorHandler } from '@shared/middleware/errorHandler';
import { requestLogger } from '@shared/middleware/requestLogger';
import { authMiddleware } from '@shared/middleware/authMiddleware';
import { logger } from '@shared/utils/logger';
import { MonitoringDatabase } from './database/MonitoringDatabase';
import { PrometheusExporter } from './exporters/PrometheusExporter';
import { DashboardTemplates } from './grafana/DashboardTemplates';
import { AlertManagerIntegration } from './alerting/AlertManagerIntegration';
import { JaegerIntegration } from './tracing/JaegerIntegration';
import { LongTermStorageStrategy } from './storage/LongTermStorageStrategy';
import { MonitoringDashboardConfigs } from './config/MonitoringDashboardConfigs';

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

    // Initialize new advanced services
    const customMetricsService = new CustomMetricsService(metricsCollector, prometheusExporter);
    const alertManagerIntegration = new AlertManagerIntegration(metricsCollector);
    const intelligentAlertingService = new IntelligentAlertingService(metricsCollector, alertManagerIntegration);
    const jaegerIntegration = new JaegerIntegration();
    const longTermStorageStrategy = new LongTermStorageStrategy(metricsCollector);
    const dashboardConfigs = new MonitoringDashboardConfigs();

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

    // Advanced Prometheus metrics endpoints
    app.get('/monitoring/metrics/custom', authMiddleware, async (req, res) => {
      try {
        const metrics = customMetricsService.getMetricDefinitions();
        res.json({ metrics });
      } catch (error) {
        logger.error('Error getting custom metrics:', error);
        res.status(500).json({ error: 'Failed to get custom metrics' });
      }
    });

    app.post('/monitoring/metrics/custom', authMiddleware, async (req, res) => {
      try {
        await customMetricsService.recordMetric(req.body);
        res.json({ success: true, message: 'Custom metric recorded' });
      } catch (error) {
        logger.error('Error recording custom metric:', error);
        res.status(500).json({ error: 'Failed to record custom metric' });
      }
    });

    // Grafana dashboard endpoints
    app.get('/monitoring/dashboards', authMiddleware, async (req, res) => {
      try {
        const dashboards = dashboardConfigs.getAllDashboardConfigs();
        res.json({ dashboards });
      } catch (error) {
        logger.error('Error getting dashboards:', error);
        res.status(500).json({ error: 'Failed to get dashboards' });
      }
    });

    app.get('/monitoring/dashboards/:id', authMiddleware, async (req, res) => {
      try {
        const dashboard = dashboardConfigs.getDashboardConfig(req.params.id);
        if (!dashboard) {
          return res.status(404).json({ error: 'Dashboard not found' });
        }
        res.json({ dashboard });
      } catch (error) {
        logger.error('Error getting dashboard:', error);
        res.status(500).json({ error: 'Failed to get dashboard' });
      }
    });

    app.get('/monitoring/dashboards/grafana/templates', authMiddleware, async (req, res) => {
      try {
        const templates = DashboardTemplates.getAllDashboards();
        res.json({ templates });
      } catch (error) {
        logger.error('Error getting Grafana templates:', error);
        res.status(500).json({ error: 'Failed to get Grafana templates' });
      }
    });

    // Intelligent alerting endpoints
    app.get('/monitoring/alerts/smart', authMiddleware, async (req, res) => {
      try {
        const smartRules = intelligentAlertingService.getSmartRules();
        res.json({ smartRules });
      } catch (error) {
        logger.error('Error getting smart alert rules:', error);
        res.status(500).json({ error: 'Failed to get smart alert rules' });
      }
    });

    app.post('/monitoring/alerts/smart', authMiddleware, async (req, res) => {
      try {
        if (!req.user?.permissions?.includes('admin')) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
        await intelligentAlertingService.createSmartRule(req.body);
        res.json({ success: true, message: 'Smart alert rule created' });
      } catch (error) {
        logger.error('Error creating smart alert rule:', error);
        res.status(500).json({ error: 'Failed to create smart alert rule' });
      }
    });

    app.get('/monitoring/alerts/smart/:ruleId/insights', authMiddleware, async (req, res) => {
      try {
        const insights = await intelligentAlertingService.getIntelligentInsights(req.params.ruleId);
        res.json({ insights });
      } catch (error) {
        logger.error('Error getting alert insights:', error);
        res.status(500).json({ error: 'Failed to get alert insights' });
      }
    });

    // AlertManager integration endpoints
    app.get('/monitoring/alertmanager/health', authMiddleware, async (req, res) => {
      try {
        const health = await alertManagerIntegration.getHealth();
        res.json({ health });
      } catch (error) {
        logger.error('Error getting AlertManager health:', error);
        res.status(500).json({ error: 'Failed to get AlertManager health' });
      }
    });

    app.get('/monitoring/alertmanager/rules', authMiddleware, async (req, res) => {
      try {
        const rules = alertManagerIntegration.getAlertRules();
        res.json({ rules });
      } catch (error) {
        logger.error('Error getting AlertManager rules:', error);
        res.status(500).json({ error: 'Failed to get AlertManager rules' });
      }
    });

    // Jaeger tracing endpoints
    app.get('/monitoring/tracing/health', authMiddleware, async (req, res) => {
      try {
        const health = await jaegerIntegration.getJaegerHealth();
        res.json({ health });
      } catch (error) {
        logger.error('Error getting Jaeger health:', error);
        res.status(500).json({ error: 'Failed to get Jaeger health' });
      }
    });

    app.get('/monitoring/tracing/traces', authMiddleware, async (req, res) => {
      try {
        const query = {
          service: req.query.service as string,
          operation: req.query.operation as string,
          startTime: req.query.startTime ? new Date(req.query.startTime as string) : undefined,
          endTime: req.query.endTime ? new Date(req.query.endTime as string) : undefined,
          limit: req.query.limit ? parseInt(req.query.limit as string) : undefined
        };
        const traces = await jaegerIntegration.queryTraces(query);
        res.json({ traces });
      } catch (error) {
        logger.error('Error querying traces:', error);
        res.status(500).json({ error: 'Failed to query traces' });
      }
    });

    app.get('/monitoring/tracing/traces/:traceId', authMiddleware, async (req, res) => {
      try {
        const trace = await jaegerIntegration.getTrace(req.params.traceId);
        if (!trace) {
          return res.status(404).json({ error: 'Trace not found' });
        }
        res.json({ trace });
      } catch (error) {
        logger.error('Error getting trace:', error);
        res.status(500).json({ error: 'Failed to get trace' });
      }
    });

    app.get('/monitoring/tracing/traces/:traceId/analyze', authMiddleware, async (req, res) => {
      try {
        const analysis = await jaegerIntegration.analyzeTrace(req.params.traceId);
        if (!analysis) {
          return res.status(404).json({ error: 'Trace not found' });
        }
        res.json({ analysis });
      } catch (error) {
        logger.error('Error analyzing trace:', error);
        res.status(500).json({ error: 'Failed to analyze trace' });
      }
    });

    // Storage strategy endpoints
    app.get('/monitoring/storage/statistics', authMiddleware, async (req, res) => {
      try {
        const stats = await longTermStorageStrategy.getStorageStatistics();
        res.json({ statistics: stats });
      } catch (error) {
        logger.error('Error getting storage statistics:', error);
        res.status(500).json({ error: 'Failed to get storage statistics' });
      }
    });

    app.get('/monitoring/storage/tiers', authMiddleware, async (req, res) => {
      try {
        const tiers = longTermStorageStrategy.getStorageTiers();
        res.json({ tiers });
      } catch (error) {
        logger.error('Error getting storage tiers:', error);
        res.status(500).json({ error: 'Failed to get storage tiers' });
      }
    });

    app.get('/monitoring/storage/policies', authMiddleware, async (req, res) => {
      try {
        const policies = longTermStorageStrategy.getLifecyclePolicies();
        res.json({ policies });
      } catch (error) {
        logger.error('Error getting lifecycle policies:', error);
        res.status(500).json({ error: 'Failed to get lifecycle policies' });
      }
    });

    app.post('/monitoring/storage/policies/:policyId/trigger', authMiddleware, async (req, res) => {
      try {
        if (!req.user?.permissions?.includes('admin')) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const result = await longTermStorageStrategy.triggerManualTransition(req.params.policyId);
        res.json({ success: true, message: result });
      } catch (error) {
        logger.error('Error triggering manual transition:', error);
        res.status(500).json({ error: 'Failed to trigger manual transition' });
      }
    });

    // Comprehensive health check endpoint
    app.get('/monitoring/health/comprehensive', authMiddleware, async (req, res) => {
      try {
        const health = {
          monitoring: await controller.getHealth(req as any, res as any, () => {}),
          prometheus: await prometheusExporter.getHealth(),
          customMetrics: customMetricsService.getStatus(),
          intelligentAlerting: intelligentAlertingService.getServiceHealth(),
          alertManager: await alertManagerIntegration.getHealth(),
          jaeger: await jaegerIntegration.getJaegerHealth(),
          storage: longTermStorageStrategy.getServiceHealth(),
          timestamp: new Date()
        };
        res.json({ health });
      } catch (error) {
        logger.error('Error getting comprehensive health:', error);
        res.status(500).json({ error: 'Failed to get comprehensive health' });
      }
    });

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