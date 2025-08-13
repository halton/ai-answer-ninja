import { logger } from '@shared/utils/logger';

export interface GrafanaDashboard {
  dashboard: {
    id?: number;
    title: string;
    tags: string[];
    timezone: string;
    panels: GrafanaPanel[];
    time: {
      from: string;
      to: string;
    };
    refresh: string;
    schemaVersion: number;
    version: number;
    links: any[];
  };
  folderId: number;
  overwrite: boolean;
}

export interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  targets: GrafanaTarget[];
  gridPos: {
    h: number;
    w: number;
    x: number;
    y: number;
  };
  options?: any;
  fieldConfig?: any;
}

export interface GrafanaTarget {
  expr: string;
  refId: string;
  legendFormat?: string;
  interval?: string;
}

export class DashboardTemplates {
  private static readonly PROMETHEUS_DATASOURCE = '${DS_PROMETHEUS}';

  // Main system overview dashboard
  static getSystemOverviewDashboard(): GrafanaDashboard {
    return {
      dashboard: {
        title: 'AI电话应答系统 - 系统总览',
        tags: ['ai-phone', 'system', 'overview'],
        timezone: 'browser',
        panels: [
          // System Health Status
          {
            id: 1,
            title: '服务健康状态',
            type: 'stat',
            targets: [
              {
                expr: 'up{job=~".*"}',
                refId: 'A',
                legendFormat: '{{instance}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
            options: {
              colorMode: 'background',
              graphMode: 'none',
              justifyMode: 'auto',
              orientation: 'horizontal',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              },
              textMode: 'auto'
            },
            fieldConfig: {
              defaults: {
                color: {
                  mode: 'thresholds'
                },
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'red', value: null },
                    { color: 'green', value: 1 }
                  ]
                },
                mappings: [
                  { options: { '0': { text: 'DOWN' } }, type: 'value' },
                  { options: { '1': { text: 'UP' } }, type: 'value' }
                ]
              }
            }
          },

          // Total Calls Today
          {
            id: 2,
            title: '今日通话总数',
            type: 'stat',
            targets: [
              {
                expr: 'increase(ai_phone_calls_total[24h])',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 0 },
            options: {
              colorMode: 'value',
              graphMode: 'area',
              justifyMode: 'auto',
              orientation: 'auto',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'short'
              }
            }
          },

          // Call Volume Over Time
          {
            id: 3,
            title: '通话量趋势',
            type: 'timeseries',
            targets: [
              {
                expr: 'rate(ai_phone_calls_total[5m]) * 60',
                refId: 'A',
                legendFormat: '通话/分钟'
              }
            ],
            gridPos: { h: 8, w: 24, x: 0, y: 8 },
            options: {
              tooltip: { mode: 'multi', sort: 'none' },
              legend: { displayMode: 'table', placement: 'bottom' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'cpm'
              }
            }
          },

          // Response Time Distribution
          {
            id: 4,
            title: 'AI响应时间分布',
            type: 'histogram',
            targets: [
              {
                expr: 'ai_response_time_seconds_bucket',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 16 },
            options: {
              bucketSize: 0.1,
              bucketOffset: 0
            }
          },

          // Error Rate
          {
            id: 5,
            title: '错误率',
            type: 'timeseries',
            targets: [
              {
                expr: 'rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100',
                refId: 'A',
                legendFormat: '错误率 %'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 16 },
            options: {
              tooltip: { mode: 'single' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'thresholds' },
                unit: 'percent',
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'green', value: null },
                    { color: 'yellow', value: 1 },
                    { color: 'red', value: 5 }
                  ]
                }
              }
            }
          }
        ],
        time: { from: 'now-6h', to: 'now' },
        refresh: '30s',
        schemaVersion: 27,
        version: 1,
        links: []
      },
      folderId: 0,
      overwrite: true
    };
  }

  // AI Performance Dashboard
  static getAIPerformanceDashboard(): GrafanaDashboard {
    return {
      dashboard: {
        title: 'AI电话应答系统 - AI性能分析',
        tags: ['ai-phone', 'ai', 'performance'],
        timezone: 'browser',
        panels: [
          // AI Response Time by Intent
          {
            id: 1,
            title: 'AI响应时间 (按意图分类)',
            type: 'timeseries',
            targets: [
              {
                expr: 'histogram_quantile(0.95, rate(ai_response_time_seconds_bucket[5m])) by (intent)',
                refId: 'A',
                legendFormat: '{{intent}} - P95'
              },
              {
                expr: 'histogram_quantile(0.50, rate(ai_response_time_seconds_bucket[5m])) by (intent)',
                refId: 'B',
                legendFormat: '{{intent}} - P50'
              }
            ],
            gridPos: { h: 8, w: 24, x: 0, y: 0 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'right' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 's'
              }
            }
          },

          // Intent Classification Accuracy
          {
            id: 2,
            title: '意图识别准确率',
            type: 'gauge',
            targets: [
              {
                expr: 'sum(ai_intent_classification_correct_total) / sum(ai_intent_classification_total) * 100',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 8 },
            options: {
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              },
              orientation: 'auto',
              textMode: 'auto',
              colorMode: 'value',
              graphMode: 'area',
              justifyMode: 'auto'
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'thresholds' },
                unit: 'percent',
                min: 0,
                max: 100,
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'red', value: null },
                    { color: 'yellow', value: 80 },
                    { color: 'green', value: 90 }
                  ]
                }
              }
            }
          },

          // Conversation Length Distribution
          {
            id: 3,
            title: '对话轮次分布',
            type: 'barchart',
            targets: [
              {
                expr: 'histogram_quantile(0.95, ai_phone_call_duration_seconds_bucket)',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 8 },
            options: {
              orientation: 'horizontal',
              barWidth: 0.97,
              groupWidth: 0.7,
              xField: 'Time',
              colorByField: 'Value'
            }
          },

          // Spam Detection Statistics
          {
            id: 4,
            title: '骚扰电话检测统计',
            type: 'piechart',
            targets: [
              {
                expr: 'sum by (spam_category) (spam_detection_total)',
                refId: 'A',
                legendFormat: '{{spam_category}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 16 },
            options: {
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              },
              pieType: 'pie',
              tooltip: { mode: 'single' },
              legend: { displayMode: 'table', placement: 'right' }
            }
          },

          // Whitelist Hit Rate
          {
            id: 5,
            title: '白名单命中率',
            type: 'stat',
            targets: [
              {
                expr: 'sum(whitelist_checks_total{result="hit"}) / sum(whitelist_checks_total) * 100',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 16 },
            options: {
              colorMode: 'background',
              graphMode: 'area',
              justifyMode: 'auto',
              orientation: 'auto',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              },
              textMode: 'auto'
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'thresholds' },
                unit: 'percent',
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'red', value: null },
                    { color: 'yellow', value: 70 },
                    { color: 'green', value: 85 }
                  ]
                }
              }
            }
          }
        ],
        time: { from: 'now-1h', to: 'now' },
        refresh: '15s',
        schemaVersion: 27,
        version: 1,
        links: []
      },
      folderId: 0,
      overwrite: true
    };
  }

  // Infrastructure Dashboard
  static getInfrastructureDashboard(): GrafanaDashboard {
    return {
      dashboard: {
        title: 'AI电话应答系统 - 基础设施监控',
        tags: ['ai-phone', 'infrastructure', 'resources'],
        timezone: 'browser',
        panels: [
          // CPU Usage
          {
            id: 1,
            title: 'CPU使用率',
            type: 'timeseries',
            targets: [
              {
                expr: '100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
                refId: 'A',
                legendFormat: '{{instance}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'right' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'percent',
                min: 0,
                max: 100
              }
            }
          },

          // Memory Usage
          {
            id: 2,
            title: '内存使用率',
            type: 'timeseries',
            targets: [
              {
                expr: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
                refId: 'A',
                legendFormat: '{{instance}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 0 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'right' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'percent',
                min: 0,
                max: 100
              }
            }
          },

          // Database Connections
          {
            id: 3,
            title: '数据库连接数',
            type: 'timeseries',
            targets: [
              {
                expr: 'database_connections_active',
                refId: 'A',
                legendFormat: '{{service}} - {{database_type}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 8 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'bottom' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'short'
              }
            }
          },

          // Cache Hit Rates
          {
            id: 4,
            title: '缓存命中率',
            type: 'timeseries',
            targets: [
              {
                expr: 'cache_hit_rate',
                refId: 'A',
                legendFormat: '{{service}} - {{cache_type}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 8 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'bottom' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'percentunit',
                min: 0,
                max: 1
              }
            }
          },

          // Queue Lengths
          {
            id: 5,
            title: '队列长度',
            type: 'timeseries',
            targets: [
              {
                expr: 'queue_length',
                refId: 'A',
                legendFormat: '{{service}} - {{queue_name}}'
              }
            ],
            gridPos: { h: 8, w: 24, x: 0, y: 16 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'bottom' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'short'
              }
            }
          }
        ],
        time: { from: 'now-1h', to: 'now' },
        refresh: '30s',
        schemaVersion: 27,
        version: 1,
        links: []
      },
      folderId: 0,
      overwrite: true
    };
  }

  // Business Metrics Dashboard
  static getBusinessMetricsDashboard(): GrafanaDashboard {
    return {
      dashboard: {
        title: 'AI电话应答系统 - 业务指标',
        tags: ['ai-phone', 'business', 'kpi'],
        timezone: 'browser',
        panels: [
          // Daily Call Statistics
          {
            id: 1,
            title: '每日通话统计',
            type: 'timeseries',
            targets: [
              {
                expr: 'increase(ai_phone_calls_total{status="completed"}[1d])',
                refId: 'A',
                legendFormat: '成功通话'
              },
              {
                expr: 'increase(ai_phone_calls_total{status="failed"}[1d])',
                refId: 'B',
                legendFormat: '失败通话'
              }
            ],
            gridPos: { h: 8, w: 24, x: 0, y: 0 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'bottom' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'short'
              }
            }
          },

          // User Satisfaction Score
          {
            id: 2,
            title: '用户满意度评分',
            type: 'gauge',
            targets: [
              {
                expr: 'avg(user_satisfaction_score)',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 8, x: 0, y: 8 },
            options: {
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              },
              orientation: 'auto',
              textMode: 'auto',
              colorMode: 'value'
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'thresholds' },
                unit: 'short',
                min: 1,
                max: 5,
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'red', value: null },
                    { color: 'yellow', value: 3 },
                    { color: 'green', value: 4 }
                  ]
                }
              }
            }
          },

          // Average Call Duration
          {
            id: 3,
            title: '平均通话时长',
            type: 'stat',
            targets: [
              {
                expr: 'avg(ai_phone_call_duration_seconds)',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 8, x: 8, y: 8 },
            options: {
              colorMode: 'value',
              graphMode: 'area',
              justifyMode: 'auto',
              orientation: 'auto',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 's'
              }
            }
          },

          // Conversion Rate
          {
            id: 4,
            title: '转接成功率',
            type: 'stat',
            targets: [
              {
                expr: 'sum(ai_phone_calls_total{status="transferred"}) / sum(ai_phone_calls_total) * 100',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 8, x: 16, y: 8 },
            options: {
              colorMode: 'background',
              graphMode: 'none',
              justifyMode: 'auto',
              orientation: 'auto',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'thresholds' },
                unit: 'percent',
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'red', value: null },
                    { color: 'yellow', value: 15 },
                    { color: 'green', value: 25 }
                  ]
                }
              }
            }
          },

          // Top Spam Categories
          {
            id: 5,
            title: '热门骚扰类型',
            type: 'bargauge',
            targets: [
              {
                expr: 'topk(5, sum by (spam_category) (spam_detection_total))',
                refId: 'A',
                legendFormat: '{{spam_category}}'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 16 },
            options: {
              orientation: 'horizontal',
              displayMode: 'gradient',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'short'
              }
            }
          },

          // Peak Hours Analysis
          {
            id: 6,
            title: '通话高峰时段',
            type: 'heatmap',
            targets: [
              {
                expr: 'sum by (hour) (increase(ai_phone_calls_total[1h]))',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 16 },
            options: {
              calculate: true,
              yAxis: {
                min: '0',
                max: '23',
                unit: 'short'
              },
              cellGap: 2,
              cellValues: {},
              color: {
                colorPalette: 'auto',
                colorSpace: 'RGB',
                fillColor: 'dark-green',
                mode: 'spectrum',
                reverse: false,
                scale: 'exponential'
              },
              yBucketBound: 'upper'
            }
          }
        ],
        time: { from: 'now-7d', to: 'now' },
        refresh: '5m',
        schemaVersion: 27,
        version: 1,
        links: []
      },
      folderId: 0,
      overwrite: true
    };
  }

  // Alert Dashboard
  static getAlertDashboard(): GrafanaDashboard {
    return {
      dashboard: {
        title: 'AI电话应答系统 - 告警监控',
        tags: ['ai-phone', 'alerts', 'monitoring'],
        timezone: 'browser',
        panels: [
          // Active Alerts
          {
            id: 1,
            title: '活跃告警',
            type: 'table',
            targets: [
              {
                expr: 'ALERTS{alertstate="firing"}',
                refId: 'A',
                legendFormat: '{{alertname}}'
              }
            ],
            gridPos: { h: 12, w: 24, x: 0, y: 0 },
            options: {
              showHeader: true,
              sortBy: [{ desc: true, displayName: 'Time' }]
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'thresholds' },
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'green', value: null },
                    { color: 'red', value: 80 }
                  ]
                }
              }
            }
          },

          // Alert History
          {
            id: 2,
            title: '告警历史趋势',
            type: 'timeseries',
            targets: [
              {
                expr: 'increase(alertmanager_alerts_received_total[5m])',
                refId: 'A',
                legendFormat: '接收告警数'
              },
              {
                expr: 'increase(alertmanager_alerts_resolved_total[5m])',
                refId: 'B',
                legendFormat: '解决告警数'
              }
            ],
            gridPos: { h: 8, w: 12, x: 0, y: 12 },
            options: {
              tooltip: { mode: 'multi' },
              legend: { displayMode: 'table', placement: 'bottom' }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 'short'
              }
            }
          },

          // Alert Resolution Time
          {
            id: 3,
            title: '平均告警解决时间',
            type: 'stat',
            targets: [
              {
                expr: 'avg(alertmanager_alert_resolution_time_seconds)',
                refId: 'A'
              }
            ],
            gridPos: { h: 8, w: 12, x: 12, y: 12 },
            options: {
              colorMode: 'value',
              graphMode: 'area',
              justifyMode: 'auto',
              orientation: 'auto',
              reduceOptions: {
                values: false,
                calcs: ['lastNotNull'],
                fields: ''
              }
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'palette-classic' },
                unit: 's'
              }
            }
          }
        ],
        time: { from: 'now-24h', to: 'now' },
        refresh: '1m',
        schemaVersion: 27,
        version: 1,
        links: []
      },
      folderId: 0,
      overwrite: true
    };
  }

  // Get all dashboard templates
  static getAllDashboards(): GrafanaDashboard[] {
    return [
      this.getSystemOverviewDashboard(),
      this.getAIPerformanceDashboard(),
      this.getInfrastructureDashboard(),
      this.getBusinessMetricsDashboard(),
      this.getAlertDashboard()
    ];
  }

  // Dashboard management methods
  static async deployDashboard(dashboard: GrafanaDashboard, grafanaUrl: string, apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${grafanaUrl}/api/dashboards/db`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dashboard)
      });

      if (response.ok) {
        const result = await response.json();
        logger.info(`Dashboard "${dashboard.dashboard.title}" deployed successfully:`, result);
        return true;
      } else {
        const error = await response.text();
        logger.error(`Failed to deploy dashboard "${dashboard.dashboard.title}":`, error);
        return false;
      }
    } catch (error) {
      logger.error(`Error deploying dashboard "${dashboard.dashboard.title}":`, error);
      return false;
    }
  }

  static async deployAllDashboards(grafanaUrl: string, apiKey: string): Promise<void> {
    const dashboards = this.getAllDashboards();
    
    for (const dashboard of dashboards) {
      await this.deployDashboard(dashboard, grafanaUrl, apiKey);
    }
    
    logger.info(`Deployed ${dashboards.length} dashboards to Grafana`);
  }

  // Generate dashboard JSON for export
  static exportDashboard(dashboard: GrafanaDashboard): string {
    return JSON.stringify(dashboard, null, 2);
  }

  // Validate dashboard configuration
  static validateDashboard(dashboard: GrafanaDashboard): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!dashboard.dashboard.title) {
      errors.push('Dashboard title is required');
    }

    if (!dashboard.dashboard.panels || dashboard.dashboard.panels.length === 0) {
      errors.push('Dashboard must have at least one panel');
    }

    dashboard.dashboard.panels.forEach((panel, index) => {
      if (!panel.title) {
        errors.push(`Panel ${index + 1} is missing a title`);
      }
      
      if (!panel.targets || panel.targets.length === 0) {
        errors.push(`Panel "${panel.title}" has no data targets`);
      }

      panel.targets.forEach((target, targetIndex) => {
        if (!target.expr) {
          errors.push(`Panel "${panel.title}" target ${targetIndex + 1} has no expression`);
        }
      });
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}