// Core monitoring types and interfaces
export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'resolved' | 'pending';
  description: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: Date;
  endsAt?: Date;
  generatorURL?: string;
  fingerprint: string;
  silenceId?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  expr: string;
  severity: 'critical' | 'warning' | 'info';
  duration: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  enabled: boolean;
  groupBy: string[];
  repeatInterval?: string;
  escalationPolicy?: EscalationPolicy;
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
}

export interface EscalationStep {
  delay: string; // e.g., '5m', '1h'
  channels: NotificationChannel[];
  condition?: string; // Optional condition to trigger this step
}

export interface NotificationChannel {
  id: string;
  type: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'sms';
  name: string;
  config: Record<string, any>;
  enabled: boolean;
}

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  responseTime?: number;
  uptime?: number;
  version?: string;
  dependencies?: DependencyHealth[];
  metrics?: Record<string, number>;
}

export interface DependencyHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  responseTime?: number;
  lastCheck: Date;
  error?: string;
}

export interface BusinessMetrics {
  callVolume: {
    total: number;
    successful: number;
    failed: number;
    rate: number;
  };
  aiPerformance: {
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
    successRate: number;
    sttAccuracy?: number;
    ttsQuality?: number;
  };
  userSatisfaction: {
    rating: number;
    totalRatings: number;
    nps?: number;
  };
  systemHealth: {
    availability: number;
    errorRate: number;
    resourceUtilization: {
      cpu: number;
      memory: number;
      disk: number;
      network: number;
    };
  };
}

export interface PerformanceBaseline {
  metric: string;
  service?: string;
  baseline: number;
  threshold: {
    warning: number;
    critical: number;
  };
  timeWindow: string;
  lastUpdated: Date;
  confidence: number;
}

export interface AnomalyDetection {
  id: string;
  metric: string;
  service?: string;
  detected: boolean;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  anomalyScore: number;
  expectedValue: number;
  actualValue: number;
  timestamp: Date;
  context?: Record<string, any>;
}

export interface LogEntry {
  timestamp: Date;
  level: 'error' | 'warn' | 'info' | 'debug';
  service: string;
  message: string;
  metadata?: Record<string, any>;
  traceId?: string;
  spanId?: string;
  userId?: string;
  callId?: string;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  service: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'ok' | 'error' | 'timeout';
  tags: Record<string, string>;
  logs?: LogEntry[];
}

export interface MonitoringConfig {
  metrics: {
    retentionDays: number;
    scrapeInterval: string;
    evaluationInterval: string;
  };
  alerts: {
    defaultGroupWait: string;
    defaultGroupInterval: string;
    defaultRepeatInterval: string;
    resolveTimeout: string;
  };
  notifications: {
    defaultChannels: string[];
    rateLimiting: {
      enabled: boolean;
      maxPerHour: number;
    };
  };
  tracing: {
    samplingRate: number;
    maxSpanAge: string;
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    retentionDays: number;
    maxFileSize: string;
  };
}

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  panels: DashboardPanel[];
  variables?: DashboardVariable[];
  refresh?: string;
  timeRange: {
    from: string;
    to: string;
  };
}

export interface DashboardPanel {
  id: string;
  title: string;
  type: 'graph' | 'singlestat' | 'table' | 'heatmap' | 'logs' | 'gauge';
  targets: PanelTarget[];
  gridPos: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  options?: Record<string, any>;
  fieldConfig?: Record<string, any>;
}

export interface PanelTarget {
  expr: string;
  refId: string;
  legendFormat?: string;
  hide?: boolean;
}

export interface DashboardVariable {
  name: string;
  type: 'query' | 'custom' | 'constant';
  query?: string;
  options?: Array<{ text: string; value: string }>;
  current?: { text: string; value: string };
  multi?: boolean;
  includeAll?: boolean;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  timestamp: Date;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Event types for real-time monitoring
export interface MonitoringEvent {
  id: string;
  type: 'alert' | 'anomaly' | 'healthchange' | 'metric' | 'log';
  source: string;
  timestamp: Date;
  data: Record<string, any>;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

// Auto-remediation types
export interface RemediationAction {
  id: string;
  name: string;
  description: string;
  trigger: {
    alertName?: string;
    metricThreshold?: {
      metric: string;
      operator: '>' | '<' | '=' | '>=' | '<=';
      value: number;
    };
  };
  actions: RemediationStep[];
  enabled: boolean;
  cooldownPeriod: string;
}

export interface RemediationStep {
  type: 'restart' | 'scale' | 'webhook' | 'script' | 'notification';
  config: Record<string, any>;
  timeout?: string;
  retries?: number;
}

export interface AutoscalingConfig {
  service: string;
  enabled: boolean;
  metrics: {
    cpu?: { targetPercentage: number };
    memory?: { targetPercentage: number };
    requests?: { targetPerSecond: number };
    custom?: Array<{
      name: string;
      targetValue: number;
    }>;
  };
  limits: {
    minReplicas: number;
    maxReplicas: number;
    scaleUpCooldown: string;
    scaleDownCooldown: string;
  };
}