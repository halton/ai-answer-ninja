import { logger } from '@shared/utils/logger';

export interface DashboardConfig {
  id: string;
  name: string;
  description: string;
  category: 'business' | 'technical' | 'operational' | 'security';
  refreshInterval: string;
  autoRefresh: boolean;
  widgets: WidgetConfig[];
  layout: DashboardLayout;
  permissions: Permission[];
  tags: string[];
}

export interface WidgetConfig {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'alert' | 'status' | 'log' | 'custom';
  title: string;
  description?: string;
  position: { x: number; y: number; w: number; h: number };
  dataSource: DataSourceConfig;
  visualization: VisualizationConfig;
  thresholds?: ThresholdConfig[];
  filters?: FilterConfig[];
  refreshInterval?: string;
}

export interface DataSourceConfig {
  type: 'prometheus' | 'elasticsearch' | 'database' | 'api';
  query: string;
  timeRange?: string;
  aggregation?: string;
  groupBy?: string[];
}

export interface VisualizationConfig {
  chartType: 'line' | 'bar' | 'pie' | 'gauge' | 'heatmap' | 'table' | 'stat' | 'text';
  options: {
    colors?: string[];
    legend?: { show: boolean; position: string };
    axes?: { x: AxisConfig; y: AxisConfig };
    format?: { unit: string; decimals: number };
    size?: { width: number; height: number };
  };
}

export interface AxisConfig {
  label: string;
  min?: number;
  max?: number;
  scale: 'linear' | 'log';
}

export interface ThresholdConfig {
  id: string;
  value: number;
  color: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  severity: 'info' | 'warning' | 'critical';
}

export interface FilterConfig {
  id: string;
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'regex';
  value: string;
  label: string;
}

export interface DashboardLayout {
  columns: number;
  rows: number;
  gridSize: { width: number; height: number };
  spacing: number;
}

export interface Permission {
  role: string;
  actions: ('view' | 'edit' | 'share' | 'delete')[];
}

export class MonitoringDashboardConfigs {
  private dashboardConfigs = new Map<string, DashboardConfig>();

  constructor() {
    this.initializePredefinedDashboards();
  }

  private initializePredefinedDashboards() {
    const dashboards: DashboardConfig[] = [
      this.createExecutiveOverviewDashboard(),
      this.createOperationalDashboard(),
      this.createAIPerformanceDashboard(),
      this.createSecurityMonitoringDashboard(),
      this.createInfrastructureDashboard(),
      this.createBusinessMetricsDashboard(),
      this.createTroubleshootingDashboard(),
      this.createCapacityPlanningDashboard()
    ];

    dashboards.forEach(dashboard => {
      this.dashboardConfigs.set(dashboard.id, dashboard);
    });

    logger.info(`Initialized ${dashboards.length} predefined dashboard configurations`);
  }

  private createExecutiveOverviewDashboard(): DashboardConfig {
    return {
      id: 'executive-overview',
      name: '高管总览仪表板',
      description: '为高管提供系统整体运营状况的高层视图',
      category: 'business',
      refreshInterval: '5m',
      autoRefresh: true,
      widgets: [
        {
          id: 'total-calls-today',
          type: 'metric',
          title: '今日通话总数',
          position: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'increase(ai_phone_calls_total[24h])',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'short', decimals: 0 },
              colors: ['#1f77b4']
            }
          },
          thresholds: [
            { id: 't1', value: 100, color: '#ff7f0e', operator: 'lt', severity: 'warning' },
            { id: 't2', value: 500, color: '#2ca02c', operator: 'gte', severity: 'info' }
          ]
        },
        {
          id: 'success-rate',
          type: 'metric',
          title: '通话成功率',
          position: { x: 3, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(ai_phone_calls_total{status="completed"}) / sum(ai_phone_calls_total) * 100',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percent', decimals: 1 }
            }
          },
          thresholds: [
            { id: 't1', value: 95, color: '#2ca02c', operator: 'gte', severity: 'info' },
            { id: 't2', value: 90, color: '#ff7f0e', operator: 'gte', severity: 'warning' },
            { id: 't3', value: 90, color: '#d62728', operator: 'lt', severity: 'critical' }
          ]
        },
        {
          id: 'avg-response-time',
          type: 'metric',
          title: '平均AI响应时间',
          position: { x: 6, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'histogram_quantile(0.50, rate(ai_response_time_seconds_bucket[5m]))',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 's', decimals: 2 },
              colors: ['#9467bd']
            }
          },
          thresholds: [
            { id: 't1', value: 1, color: '#2ca02c', operator: 'lt', severity: 'info' },
            { id: 't2', value: 2, color: '#ff7f0e', operator: 'lt', severity: 'warning' },
            { id: 't3', value: 2, color: '#d62728', operator: 'gte', severity: 'critical' }
          ]
        },
        {
          id: 'system-health',
          type: 'status',
          title: '系统健康状态',
          position: { x: 9, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'up{job=~".*"}',
            timeRange: '5m'
          },
          visualization: {
            chartType: 'table',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          }
        },
        {
          id: 'call-volume-trend',
          type: 'chart',
          title: '通话量趋势 (24小时)',
          position: { x: 0, y: 2, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'rate(ai_phone_calls_total[5m]) * 60',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'line',
            options: {
              axes: {
                x: { label: '时间', scale: 'linear' },
                y: { label: '通话/分钟', scale: 'linear', min: 0 }
              },
              colors: ['#1f77b4'],
              legend: { show: true, position: 'bottom' }
            }
          }
        },
        {
          id: 'service-status',
          type: 'table',
          title: '服务状态概览',
          position: { x: 6, y: 2, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'up{job=~".*"}',
            groupBy: ['job', 'instance']
          },
          visualization: {
            chartType: 'table',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'executive', actions: ['view', 'share'] },
        { role: 'manager', actions: ['view'] }
      ],
      tags: ['executive', 'overview', 'kpi']
    };
  }

  private createOperationalDashboard(): DashboardConfig {
    return {
      id: 'operational-dashboard',
      name: '运营监控仪表板',
      description: '实时监控系统运营状态和关键指标',
      category: 'operational',
      refreshInterval: '30s',
      autoRefresh: true,
      widgets: [
        {
          id: 'active-calls',
          type: 'metric',
          title: '当前活跃通话数',
          position: { x: 0, y: 0, w: 2, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(active_calls_current)',
            timeRange: '5m'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'short', decimals: 0 },
              colors: ['#17becf']
            }
          }
        },
        {
          id: 'queue-length',
          type: 'metric',
          title: '队列长度',
          position: { x: 2, y: 0, w: 2, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(queue_length)',
            timeRange: '5m'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          },
          thresholds: [
            { id: 't1', value: 50, color: '#ff7f0e', operator: 'gt', severity: 'warning' },
            { id: 't2', value: 100, color: '#d62728', operator: 'gt', severity: 'critical' }
          ]
        },
        {
          id: 'error-rate',
          type: 'metric',
          title: '系统错误率',
          position: { x: 4, y: 0, w: 2, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'percent', decimals: 2 },
              colors: ['#d62728']
            }
          },
          thresholds: [
            { id: 't1', value: 1, color: '#ff7f0e', operator: 'gt', severity: 'warning' },
            { id: 't2', value: 5, color: '#d62728', operator: 'gt', severity: 'critical' }
          ]
        },
        {
          id: 'spam-detection-rate',
          type: 'metric',
          title: '骚扰电话检测率',
          position: { x: 6, y: 0, w: 2, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(spam_detection_total) / sum(ai_phone_calls_total) * 100',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percent', decimals: 1 }
            }
          }
        },
        {
          id: 'whitelist-hit-rate',
          type: 'metric',
          title: '白名单命中率',
          position: { x: 8, y: 0, w: 2, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(whitelist_checks_total{result="hit"}) / sum(whitelist_checks_total) * 100',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percent', decimals: 1 }
            }
          }
        },
        {
          id: 'ai-accuracy',
          type: 'metric',
          title: 'AI识别准确率',
          position: { x: 10, y: 0, w: 2, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(ai_intent_classification_correct_total) / sum(ai_intent_classification_total) * 100',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percent', decimals: 1 }
            }
          },
          thresholds: [
            { id: 't1', value: 95, color: '#2ca02c', operator: 'gte', severity: 'info' },
            { id: 't2', value: 85, color: '#ff7f0e', operator: 'gte', severity: 'warning' },
            { id: 't3', value: 85, color: '#d62728', operator: 'lt', severity: 'critical' }
          ]
        },
        {
          id: 'response-time-distribution',
          type: 'chart',
          title: 'AI响应时间分布',
          position: { x: 0, y: 2, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'histogram_quantile(0.50, rate(ai_response_time_seconds_bucket[5m])) by (intent)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'line',
            options: {
              axes: {
                x: { label: '时间', scale: 'linear' },
                y: { label: '响应时间 (秒)', scale: 'linear', min: 0 }
              },
              legend: { show: true, position: 'right' }
            }
          }
        },
        {
          id: 'active-alerts',
          type: 'alert',
          title: '活跃告警',
          position: { x: 6, y: 2, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'ALERTS{alertstate="firing"}',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'table',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'operator', actions: ['view', 'share'] },
        { role: 'engineer', actions: ['view'] }
      ],
      tags: ['operational', 'realtime', 'monitoring']
    };
  }

  private createAIPerformanceDashboard(): DashboardConfig {
    return {
      id: 'ai-performance',
      name: 'AI性能分析仪表板',
      description: 'AI系统性能指标和质量分析',
      category: 'technical',
      refreshInterval: '1m',
      autoRefresh: true,
      widgets: [
        {
          id: 'ai-response-p95',
          type: 'metric',
          title: 'AI响应时间 P95',
          position: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'histogram_quantile(0.95, rate(ai_response_time_seconds_bucket[5m]))',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 's', decimals: 2 }
            }
          }
        },
        {
          id: 'intent-accuracy',
          type: 'metric',
          title: '意图识别准确率',
          position: { x: 3, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'avg(ai_intent_accuracy_rate)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percentunit', decimals: 2 }
            }
          }
        },
        {
          id: 'model-confidence',
          type: 'metric',
          title: '模型置信度均值',
          position: { x: 6, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'avg(ai_model_confidence_score)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'percentunit', decimals: 2 }
            }
          }
        },
        {
          id: 'conversation-length',
          type: 'metric',
          title: '平均对话轮次',
          position: { x: 9, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'avg(conversation_turns_total)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'short', decimals: 1 }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'ai_engineer', actions: ['view', 'edit', 'share'] },
        { role: 'data_scientist', actions: ['view', 'share'] }
      ],
      tags: ['ai', 'performance', 'ml']
    };
  }

  private createSecurityMonitoringDashboard(): DashboardConfig {
    return {
      id: 'security-monitoring',
      name: '安全监控仪表板',
      description: '系统安全事件和威胁监控',
      category: 'security',
      refreshInterval: '1m',
      autoRefresh: true,
      widgets: [
        {
          id: 'failed-auth-attempts',
          type: 'metric',
          title: '认证失败次数 (1小时)',
          position: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'increase(auth_attempts_total{status="failed"}[1h])',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          },
          thresholds: [
            { id: 't1', value: 10, color: '#ff7f0e', operator: 'gt', severity: 'warning' },
            { id: 't2', value: 50, color: '#d62728', operator: 'gt', severity: 'critical' }
          ]
        },
        {
          id: 'suspicious-ips',
          type: 'metric',
          title: '可疑IP数量',
          position: { x: 3, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'count(security_suspicious_ips_total > 0)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          }
        },
        {
          id: 'spam-confidence-distribution',
          type: 'chart',
          title: '骚扰电话置信度分布',
          position: { x: 6, y: 0, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'histogram_quantile(0.95, spam_detection_confidence_bucket) by (spam_category)',
            timeRange: '6h'
          },
          visualization: {
            chartType: 'bar',
            options: {
              axes: {
                x: { label: '骚扰类型', scale: 'linear' },
                y: { label: '置信度', scale: 'linear', min: 0, max: 1 }
              }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'security_analyst', actions: ['view', 'edit', 'share'] },
        { role: 'operator', actions: ['view'] }
      ],
      tags: ['security', 'threats', 'monitoring']
    };
  }

  private createInfrastructureDashboard(): DashboardConfig {
    return {
      id: 'infrastructure',
      name: '基础设施监控仪表板',
      description: '系统资源使用和基础设施健康监控',
      category: 'technical',
      refreshInterval: '30s',
      autoRefresh: true,
      widgets: [
        {
          id: 'cpu-usage',
          type: 'chart',
          title: 'CPU使用率',
          position: { x: 0, y: 0, w: 4, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: '100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'line',
            options: {
              axes: {
                x: { label: '时间', scale: 'linear' },
                y: { label: 'CPU %', scale: 'linear', min: 0, max: 100 }
              }
            }
          }
        },
        {
          id: 'memory-usage',
          type: 'chart',
          title: '内存使用率',
          position: { x: 4, y: 0, w: 4, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'line',
            options: {
              axes: {
                x: { label: '时间', scale: 'linear' },
                y: { label: '内存 %', scale: 'linear', min: 0, max: 100 }
              }
            }
          }
        },
        {
          id: 'disk-usage',
          type: 'metric',
          title: '磁盘使用率',
          position: { x: 8, y: 0, w: 4, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: '(1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100',
            timeRange: '5m'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percent', decimals: 1 }
            }
          },
          thresholds: [
            { id: 't1', value: 80, color: '#ff7f0e', operator: 'gt', severity: 'warning' },
            { id: 't2', value: 90, color: '#d62728', operator: 'gt', severity: 'critical' }
          ]
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'devops', actions: ['view', 'edit', 'share'] },
        { role: 'engineer', actions: ['view'] }
      ],
      tags: ['infrastructure', 'resources', 'system']
    };
  }

  private createBusinessMetricsDashboard(): DashboardConfig {
    return {
      id: 'business-metrics',
      name: '业务指标仪表板',
      description: '关键业务指标和KPI监控',
      category: 'business',
      refreshInterval: '5m',
      autoRefresh: true,
      widgets: [
        {
          id: 'daily-revenue',
          type: 'metric',
          title: '今日收入',
          position: { x: 0, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(business_revenue_total{period="today"})',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'currencyUSD', decimals: 2 }
            }
          }
        },
        {
          id: 'user-satisfaction',
          type: 'metric',
          title: '用户满意度',
          position: { x: 3, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'avg(user_satisfaction_score)',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'short', decimals: 1 }
            }
          }
        },
        {
          id: 'conversion-rate',
          type: 'metric',
          title: '转接成功率',
          position: { x: 6, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'sum(ai_phone_calls_total{status="transferred"}) / sum(ai_phone_calls_total) * 100',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'gauge',
            options: {
              format: { unit: 'percent', decimals: 1 }
            }
          }
        },
        {
          id: 'cost-per-call',
          type: 'metric',
          title: '每通话成本',
          position: { x: 9, y: 0, w: 3, h: 2 },
          dataSource: {
            type: 'prometheus',
            query: 'avg(cost_per_call)',
            timeRange: '24h'
          },
          visualization: {
            chartType: 'stat',
            options: {
              format: { unit: 'currencyUSD', decimals: 3 }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'business_analyst', actions: ['view', 'edit', 'share'] },
        { role: 'manager', actions: ['view', 'share'] }
      ],
      tags: ['business', 'kpi', 'revenue']
    };
  }

  private createTroubleshootingDashboard(): DashboardConfig {
    return {
      id: 'troubleshooting',
      name: '故障排查仪表板',
      description: '系统故障诊断和问题排查工具',
      category: 'operational',
      refreshInterval: '15s',
      autoRefresh: true,
      widgets: [
        {
          id: 'error-logs',
          type: 'log',
          title: '最近错误日志',
          position: { x: 0, y: 0, w: 6, h: 4 },
          dataSource: {
            type: 'elasticsearch',
            query: 'level:ERROR AND timestamp:[now-1h TO now]',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'table',
            options: {
              format: { unit: 'short', decimals: 0 }
            }
          }
        },
        {
          id: 'slow-requests',
          type: 'table',
          title: '慢请求分析',
          position: { x: 6, y: 0, w: 6, h: 4 },
          dataSource: {
            type: 'prometheus',
            query: 'topk(10, histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2)',
            timeRange: '1h'
          },
          visualization: {
            chartType: 'table',
            options: {
              format: { unit: 's', decimals: 2 }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'engineer', actions: ['view', 'edit', 'share'] },
        { role: 'support', actions: ['view'] }
      ],
      tags: ['troubleshooting', 'debugging', 'support']
    };
  }

  private createCapacityPlanningDashboard(): DashboardConfig {
    return {
      id: 'capacity-planning',
      name: '容量规划仪表板',
      description: '系统容量分析和未来规划',
      category: 'technical',
      refreshInterval: '10m',
      autoRefresh: true,
      widgets: [
        {
          id: 'resource-trends',
          type: 'chart',
          title: '资源使用趋势 (7天)',
          position: { x: 0, y: 0, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'avg_over_time(process_cpu_usage_percent[7d])',
            timeRange: '7d'
          },
          visualization: {
            chartType: 'line',
            options: {
              axes: {
                x: { label: '时间', scale: 'linear' },
                y: { label: '使用率 %', scale: 'linear', min: 0 }
              }
            }
          }
        },
        {
          id: 'growth-projection',
          type: 'chart',
          title: '负载增长预测',
          position: { x: 6, y: 0, w: 6, h: 3 },
          dataSource: {
            type: 'prometheus',
            query: 'predict_linear(rate(ai_phone_calls_total[24h])[7d:1h], 86400 * 30)',
            timeRange: '30d'
          },
          visualization: {
            chartType: 'line',
            options: {
              axes: {
                x: { label: '时间', scale: 'linear' },
                y: { label: '预测通话量', scale: 'linear', min: 0 }
              }
            }
          }
        }
      ],
      layout: {
        columns: 12,
        rows: 5,
        gridSize: { width: 100, height: 80 },
        spacing: 10
      },
      permissions: [
        { role: 'admin', actions: ['view', 'edit', 'share', 'delete'] },
        { role: 'architect', actions: ['view', 'edit', 'share'] },
        { role: 'devops', actions: ['view', 'share'] }
      ],
      tags: ['capacity', 'planning', 'forecasting']
    };
  }

  // Public methods
  public getDashboardConfig(id: string): DashboardConfig | undefined {
    return this.dashboardConfigs.get(id);
  }

  public getAllDashboardConfigs(): DashboardConfig[] {
    return Array.from(this.dashboardConfigs.values());
  }

  public getDashboardsByCategory(category: DashboardConfig['category']): DashboardConfig[] {
    return Array.from(this.dashboardConfigs.values())
      .filter(dashboard => dashboard.category === category);
  }

  public getDashboardsByTags(tags: string[]): DashboardConfig[] {
    return Array.from(this.dashboardConfigs.values())
      .filter(dashboard => tags.some(tag => dashboard.tags.includes(tag)));
  }

  public addDashboardConfig(config: DashboardConfig): void {
    this.validateDashboardConfig(config);
    this.dashboardConfigs.set(config.id, config);
    logger.info(`Added dashboard config: ${config.name}`);
  }

  public updateDashboardConfig(id: string, updates: Partial<DashboardConfig>): boolean {
    const existing = this.dashboardConfigs.get(id);
    if (!existing) return false;

    const updated = { ...existing, ...updates };
    this.validateDashboardConfig(updated);
    this.dashboardConfigs.set(id, updated);
    logger.info(`Updated dashboard config: ${updated.name}`);
    return true;
  }

  public deleteDashboardConfig(id: string): boolean {
    const deleted = this.dashboardConfigs.delete(id);
    if (deleted) {
      logger.info(`Deleted dashboard config: ${id}`);
    }
    return deleted;
  }

  private validateDashboardConfig(config: DashboardConfig): void {
    if (!config.id || !config.name) {
      throw new Error('Dashboard ID and name are required');
    }

    if (!config.widgets || config.widgets.length === 0) {
      throw new Error('Dashboard must have at least one widget');
    }

    // Validate widget positions don't overlap
    const positions = config.widgets.map(w => w.position);
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        if (this.positionsOverlap(positions[i], positions[j])) {
          throw new Error(`Widget positions overlap: ${config.widgets[i].title} and ${config.widgets[j].title}`);
        }
      }
    }
  }

  private positionsOverlap(pos1: { x: number; y: number; w: number; h: number }, pos2: { x: number; y: number; w: number; h: number }): boolean {
    return !(pos1.x + pos1.w <= pos2.x || 
             pos2.x + pos2.w <= pos1.x || 
             pos1.y + pos1.h <= pos2.y || 
             pos2.y + pos2.h <= pos1.y);
  }

  public exportDashboardConfig(id: string): string | null {
    const config = this.dashboardConfigs.get(id);
    return config ? JSON.stringify(config, null, 2) : null;
  }

  public importDashboardConfig(configJson: string): string {
    try {
      const config = JSON.parse(configJson) as DashboardConfig;
      this.validateDashboardConfig(config);
      
      // Generate new ID if it already exists
      if (this.dashboardConfigs.has(config.id)) {
        config.id = `${config.id}-${Date.now()}`;
      }
      
      this.dashboardConfigs.set(config.id, config);
      logger.info(`Imported dashboard config: ${config.name}`);
      return config.id;
    } catch (error) {
      throw new Error(`Failed to import dashboard config: ${error}`);
    }
  }

  public getConfigSummary() {
    const dashboards = Array.from(this.dashboardConfigs.values());
    const categoryStats = dashboards.reduce((acc, dashboard) => {
      acc[dashboard.category] = (acc[dashboard.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalDashboards: dashboards.length,
      categoriesCount: categoryStats,
      totalWidgets: dashboards.reduce((sum, dashboard) => sum + dashboard.widgets.length, 0),
      averageWidgetsPerDashboard: Math.round(
        dashboards.reduce((sum, dashboard) => sum + dashboard.widgets.length, 0) / dashboards.length
      )
    };
  }
}