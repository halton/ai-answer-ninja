import { Request, Response } from 'express';
import { register, Gauge, Counter, Histogram, Summary, collectDefaultMetrics } from 'prom-client';
import { MetricsCollector } from '../services/MetricsCollector';
import { logger } from '@shared/utils/logger';

interface CustomMetric {
  name: string;
  help: string;
  type: 'gauge' | 'counter' | 'histogram' | 'summary';
  labelNames?: string[];
}

export class PrometheusExporter {
  private metricsRegistry = register;
  private customMetrics = new Map<string, any>();
  private initialized = false;

  // Core business metrics
  private callMetrics = {
    totalCalls: new Counter({
      name: 'ai_phone_calls_total',
      help: 'Total number of phone calls processed',
      labelNames: ['service', 'call_type', 'status']
    }),
    
    callDuration: new Histogram({
      name: 'ai_phone_call_duration_seconds',
      help: 'Duration of phone calls in seconds',
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      labelNames: ['service', 'call_type']
    }),

    aiResponseTime: new Histogram({
      name: 'ai_response_time_seconds',
      help: 'Time taken for AI to generate response',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      labelNames: ['service', 'model_type', 'intent']
    }),

    whitelistChecks: new Counter({
      name: 'whitelist_checks_total',
      help: 'Total whitelist checks performed',
      labelNames: ['service', 'result', 'list_type']
    }),

    spamDetection: new Counter({
      name: 'spam_detection_total',
      help: 'Total spam calls detected',
      labelNames: ['service', 'spam_category', 'confidence_level']
    }),

    userInteractions: new Counter({
      name: 'user_interactions_total',
      help: 'Total user interactions with the system',
      labelNames: ['service', 'interaction_type', 'result']
    })
  };

  // System performance metrics
  private systemMetrics = {
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['service', 'method', 'endpoint', 'status_code']
    }),

    httpRequestDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      labelNames: ['service', 'method', 'endpoint']
    }),

    databaseConnections: new Gauge({
      name: 'database_connections_active',
      help: 'Number of active database connections',
      labelNames: ['service', 'database_type']
    }),

    databaseQueryDuration: new Histogram({
      name: 'database_query_duration_seconds',
      help: 'Database query execution time',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      labelNames: ['service', 'operation', 'table']
    }),

    cacheHitRate: new Gauge({
      name: 'cache_hit_rate',
      help: 'Cache hit rate percentage',
      labelNames: ['service', 'cache_type', 'cache_layer']
    }),

    queueLength: new Gauge({
      name: 'queue_length',
      help: 'Current queue length',
      labelNames: ['service', 'queue_name', 'queue_type']
    }),

    errorRate: new Gauge({
      name: 'error_rate',
      help: 'Error rate percentage',
      labelNames: ['service', 'error_type', 'severity']
    })
  };

  // Resource utilization metrics
  private resourceMetrics = {
    cpuUsage: new Gauge({
      name: 'process_cpu_usage_percent',
      help: 'Process CPU usage percentage',
      labelNames: ['service', 'instance']
    }),

    memoryUsage: new Gauge({
      name: 'process_memory_usage_bytes',
      help: 'Process memory usage in bytes',
      labelNames: ['service', 'instance', 'type']
    }),

    networkBytes: new Counter({
      name: 'network_bytes_total',
      help: 'Total network bytes transferred',
      labelNames: ['service', 'direction', 'protocol']
    }),

    diskUsage: new Gauge({
      name: 'disk_usage_bytes',
      help: 'Disk usage in bytes',
      labelNames: ['service', 'mount_point', 'type']
    })
  };

  constructor(private metricsCollector: MetricsCollector) {
    this.initialize();
  }

  private initialize() {
    if (this.initialized) return;

    // Enable default Node.js metrics
    collectDefaultMetrics({ register: this.metricsRegistry });

    // Register all custom metrics
    this.registerMetrics();
    
    // Start periodic metric collection
    this.startPeriodicCollection();
    
    this.initialized = true;
    logger.info('PrometheusExporter initialized successfully');
  }

  private registerMetrics() {
    // Register call metrics
    Object.values(this.callMetrics).forEach(metric => {
      this.metricsRegistry.registerMetric(metric);
    });

    // Register system metrics
    Object.values(this.systemMetrics).forEach(metric => {
      this.metricsRegistry.registerMetric(metric);
    });

    // Register resource metrics
    Object.values(this.resourceMetrics).forEach(metric => {
      this.metricsRegistry.registerMetric(metric);
    });
  }

  private startPeriodicCollection() {
    // Collect system metrics every 30 seconds
    setInterval(async () => {
      await this.collectSystemMetrics();
    }, 30000);

    // Collect business metrics every 15 seconds
    setInterval(async () => {
      await this.collectBusinessMetrics();
    }, 15000);

    // Collect resource metrics every 10 seconds
    setInterval(async () => {
      await this.collectResourceMetrics();
    }, 10000);
  }

  private async collectSystemMetrics() {
    try {
      const metrics = await this.metricsCollector.getRecentMetrics('system', 30);
      
      metrics.forEach(metric => {
        switch (metric.name) {
          case 'http_requests':
            this.systemMetrics.httpRequests.inc({
              service: metric.service,
              method: metric.tags?.method || 'unknown',
              endpoint: metric.tags?.endpoint || 'unknown',
              status_code: metric.tags?.status_code || 'unknown'
            }, metric.value);
            break;
            
          case 'database_connections':
            this.systemMetrics.databaseConnections.set({
              service: metric.service,
              database_type: metric.tags?.database_type || 'unknown'
            }, metric.value);
            break;
            
          case 'cache_hit_rate':
            this.systemMetrics.cacheHitRate.set({
              service: metric.service,
              cache_type: metric.tags?.cache_type || 'unknown',
              cache_layer: metric.tags?.cache_layer || 'unknown'
            }, metric.value);
            break;
        }
      });
    } catch (error) {
      logger.error('Error collecting system metrics:', error);
    }
  }

  private async collectBusinessMetrics() {
    try {
      const metrics = await this.metricsCollector.getRecentMetrics('business', 15);
      
      metrics.forEach(metric => {
        switch (metric.name) {
          case 'calls_total':
            this.callMetrics.totalCalls.inc({
              service: metric.service,
              call_type: metric.tags?.call_type || 'unknown',
              status: metric.tags?.status || 'unknown'
            }, metric.value);
            break;
            
          case 'ai_response_time':
            this.callMetrics.aiResponseTime.observe({
              service: metric.service,
              model_type: metric.tags?.model_type || 'unknown',
              intent: metric.tags?.intent || 'unknown'
            }, metric.value);
            break;
            
          case 'whitelist_check':
            this.callMetrics.whitelistChecks.inc({
              service: metric.service,
              result: metric.tags?.result || 'unknown',
              list_type: metric.tags?.list_type || 'unknown'
            }, metric.value);
            break;
        }
      });
    } catch (error) {
      logger.error('Error collecting business metrics:', error);
    }
  }

  private async collectResourceMetrics() {
    try {
      // Collect current process metrics
      const processMetrics = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.resourceMetrics.memoryUsage.set({
        service: process.env.SERVICE_NAME || 'monitoring',
        instance: process.env.HOSTNAME || 'localhost',
        type: 'rss'
      }, processMetrics.rss);
      
      this.resourceMetrics.memoryUsage.set({
        service: process.env.SERVICE_NAME || 'monitoring',
        instance: process.env.HOSTNAME || 'localhost',
        type: 'heapUsed'
      }, processMetrics.heapUsed);
      
      this.resourceMetrics.memoryUsage.set({
        service: process.env.SERVICE_NAME || 'monitoring',
        instance: process.env.HOSTNAME || 'localhost',
        type: 'heapTotal'
      }, processMetrics.heapTotal);
      
    } catch (error) {
      logger.error('Error collecting resource metrics:', error);
    }
  }

  // Public methods for recording metrics
  public recordCall(labels: { service: string; call_type: string; status: string }) {
    this.callMetrics.totalCalls.inc(labels);
  }

  public recordCallDuration(labels: { service: string; call_type: string }, duration: number) {
    this.callMetrics.callDuration.observe(labels, duration);
  }

  public recordAIResponseTime(labels: { service: string; model_type: string; intent: string }, duration: number) {
    this.callMetrics.aiResponseTime.observe(labels, duration);
  }

  public recordWhitelistCheck(labels: { service: string; result: string; list_type: string }) {
    this.callMetrics.whitelistChecks.inc(labels);
  }

  public recordSpamDetection(labels: { service: string; spam_category: string; confidence_level: string }) {
    this.callMetrics.spamDetection.inc(labels);
  }

  public recordHTTPRequest(labels: { service: string; method: string; endpoint: string; status_code: string }) {
    this.systemMetrics.httpRequests.inc(labels);
  }

  public recordHTTPDuration(labels: { service: string; method: string; endpoint: string }, duration: number) {
    this.systemMetrics.httpRequestDuration.observe(labels, duration);
  }

  public setDatabaseConnections(labels: { service: string; database_type: string }, value: number) {
    this.systemMetrics.databaseConnections.set(labels, value);
  }

  public recordDatabaseQuery(labels: { service: string; operation: string; table: string }, duration: number) {
    this.systemMetrics.databaseQueryDuration.observe(labels, duration);
  }

  public setCacheHitRate(labels: { service: string; cache_type: string; cache_layer: string }, rate: number) {
    this.systemMetrics.cacheHitRate.set(labels, rate);
  }

  public setQueueLength(labels: { service: string; queue_name: string; queue_type: string }, length: number) {
    this.systemMetrics.queueLength.set(labels, length);
  }

  public setErrorRate(labels: { service: string; error_type: string; severity: string }, rate: number) {
    this.systemMetrics.errorRate.set(labels, rate);
  }

  // Custom metrics management
  public createCustomMetric(config: CustomMetric) {
    if (this.customMetrics.has(config.name)) {
      logger.warn(`Metric ${config.name} already exists`);
      return;
    }

    let metric;
    switch (config.type) {
      case 'gauge':
        metric = new Gauge({
          name: config.name,
          help: config.help,
          labelNames: config.labelNames || []
        });
        break;
      case 'counter':
        metric = new Counter({
          name: config.name,
          help: config.help,
          labelNames: config.labelNames || []
        });
        break;
      case 'histogram':
        metric = new Histogram({
          name: config.name,
          help: config.help,
          labelNames: config.labelNames || []
        });
        break;
      case 'summary':
        metric = new Summary({
          name: config.name,
          help: config.help,
          labelNames: config.labelNames || []
        });
        break;
      default:
        throw new Error(`Unknown metric type: ${config.type}`);
    }

    this.customMetrics.set(config.name, metric);
    this.metricsRegistry.registerMetric(metric);
    
    logger.info(`Custom metric ${config.name} created successfully`);
  }

  public getCustomMetric(name: string) {
    return this.customMetrics.get(name);
  }

  // Prometheus endpoint handler
  public async export(req: Request, res: Response) {
    try {
      res.set('Content-Type', this.metricsRegistry.contentType);
      const metrics = await this.metricsRegistry.metrics();
      res.end(metrics);
    } catch (error) {
      logger.error('Error exporting Prometheus metrics:', error);
      res.status(500).send('Error exporting metrics');
    }
  }

  // Health check for metrics collection
  public async getHealth() {
    return {
      status: 'healthy',
      registeredMetrics: this.metricsRegistry.getMetricsAsJSON().length,
      customMetrics: this.customMetrics.size,
      collectionActive: this.initialized
    };
  }

  // Get metrics summary for debugging
  public async getMetricsSummary() {
    const allMetrics = await this.metricsRegistry.getMetricsAsJSON();
    
    return {
      totalMetrics: allMetrics.length,
      metricTypes: allMetrics.reduce((acc, metric) => {
        acc[metric.type] = (acc[metric.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      customMetrics: Array.from(this.customMetrics.keys()),
      lastCollection: new Date()
    };
  }
}