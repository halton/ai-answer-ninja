import { Request, Response, NextFunction } from 'express';
import { HealthCheckService } from '../services/HealthCheckService';
import { MetricsCollector } from '../services/MetricsCollector';
import { AlertManager } from '../services/AlertManager';
import { TraceService } from '../services/TraceService';
import { PerformanceMonitor } from '../services/PerformanceMonitor';
import { logger } from '@shared/utils/logger';

export class MonitoringController {
  constructor(
    private healthCheckService: HealthCheckService,
    private metricsCollector: MetricsCollector,
    private alertManager: AlertManager,
    private traceService: TraceService,
    private performanceMonitor: PerformanceMonitor
  ) {}

  async getHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const health = await this.healthCheckService.checkOwnHealth();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      
      res.status(statusCode).json(health);
    } catch (error) {
      logger.error('Error getting health:', error);
      next(error);
    }
  }

  async getSystemHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const systemHealth = await this.healthCheckService.checkAllServices();
      
      res.json({
        timestamp: new Date(),
        overall: systemHealth.overall,
        services: systemHealth.services,
        summary: systemHealth.summary
      });
    } catch (error) {
      logger.error('Error getting system health:', error);
      next(error);
    }
  }

  async getServiceHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const { service } = req.params;
      const health = await this.healthCheckService.checkServiceHealth(service);
      
      if (!health) {
        return res.status(404).json({ error: 'Service not found' });
      }

      res.json(health);
    } catch (error) {
      logger.error('Error getting service health:', error);
      next(error);
    }
  }

  async getMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const { service, metric, from, to } = req.query;
      
      const metrics = await this.metricsCollector.getMetrics({
        service: service as string,
        metric: metric as string,
        startTime: from ? new Date(from as string) : undefined,
        endTime: to ? new Date(to as string) : undefined
      });

      res.json({
        metrics,
        count: metrics.length,
        query: { service, metric, from, to }
      });
    } catch (error) {
      logger.error('Error getting metrics:', error);
      next(error);
    }
  }

  async recordMetric(req: Request, res: Response, next: NextFunction) {
    try {
      const { service, metric, value, tags } = req.body;
      
      await this.metricsCollector.recordMetric({
        service,
        metric,
        value,
        tags,
        timestamp: new Date()
      });

      res.json({ success: true, message: 'Metric recorded' });
    } catch (error) {
      logger.error('Error recording metric:', error);
      next(error);
    }
  }

  async configureAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const alertConfig = req.body;
      
      if (!req.user?.permissions?.includes('admin')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const alert = await this.alertManager.createAlert(alertConfig);
      
      res.json({
        success: true,
        alert,
        message: 'Alert configured successfully'
      });
    } catch (error) {
      logger.error('Error configuring alert:', error);
      next(error);
    }
  }

  async getAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, severity, service } = req.query;
      
      const alerts = await this.alertManager.getAlerts({
        status: status as string,
        severity: severity as string,
        service: service as string
      });

      res.json({
        alerts,
        count: alerts.length,
        filters: { status, severity, service }
      });
    } catch (error) {
      logger.error('Error getting alerts:', error);
      next(error);
    }
  }

  async updateAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const { alertId } = req.params;
      const updates = req.body;
      
      const updated = await this.alertManager.updateAlert(alertId, updates);
      
      if (!updated) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({
        success: true,
        alert: updated,
        message: 'Alert updated successfully'
      });
    } catch (error) {
      logger.error('Error updating alert:', error);
      next(error);
    }
  }

  async deleteAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const { alertId } = req.params;
      
      if (!req.user?.permissions?.includes('admin')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const deleted = await this.alertManager.deleteAlert(alertId);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({
        success: true,
        message: 'Alert deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting alert:', error);
      next(error);
    }
  }

  async getTrace(req: Request, res: Response, next: NextFunction) {
    try {
      const { traceId } = req.params;
      
      const trace = await this.traceService.getTrace(traceId);
      
      if (!trace) {
        return res.status(404).json({ error: 'Trace not found' });
      }

      res.json(trace);
    } catch (error) {
      logger.error('Error getting trace:', error);
      next(error);
    }
  }

  async recordTrace(req: Request, res: Response, next: NextFunction) {
    try {
      const traceData = req.body;
      
      const trace = await this.traceService.recordTrace(traceData);
      
      res.json({
        success: true,
        traceId: trace.id,
        message: 'Trace recorded successfully'
      });
    } catch (error) {
      logger.error('Error recording trace:', error);
      next(error);
    }
  }

  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const dashboard = await this.performanceMonitor.getDashboardData();
      
      res.json({
        timestamp: new Date(),
        ...dashboard
      });
    } catch (error) {
      logger.error('Error getting dashboard:', error);
      next(error);
    }
  }

  async getServiceStatuses(req: Request, res: Response, next: NextFunction) {
    try {
      const statuses = await this.healthCheckService.getServiceStatuses();
      
      res.json({
        timestamp: new Date(),
        services: statuses
      });
    } catch (error) {
      logger.error('Error getting service statuses:', error);
      next(error);
    }
  }
}