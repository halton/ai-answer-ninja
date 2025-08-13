import fetch from 'node-fetch';
import { logger } from '@shared/utils/logger';
import { MetricsCollector } from '../services/MetricsCollector';

export interface AlertRule {
  id: string;
  name: string;
  expr: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  for?: string;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  thresholds?: {
    warning?: number;
    critical?: number;
  };
  notificationChannels: string[];
}

export interface AlertNotification {
  id: string;
  type: 'email' | 'slack' | 'webhook' | 'dingtalk' | 'sms';
  name: string;
  settings: Record<string, any>;
  enabled: boolean;
}

export interface Alert {
  id: string;
  state: 'pending' | 'firing' | 'resolved';
  startsAt: Date;
  endsAt?: Date;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  generatorUrl?: string;
  fingerprint: string;
  status?: {
    silencedBy?: string[];
    inhibitedBy?: string[];
  };
}

export interface SilenceRule {
  id: string;
  matchers: Array<{
    name: string;
    value: string;
    isRegex: boolean;
  }>;
  startsAt: Date;
  endsAt: Date;
  comment: string;
  createdBy: string;
  status: 'pending' | 'active' | 'expired';
}

export class AlertManagerIntegration {
  private alertRules = new Map<string, AlertRule>();
  private notifications = new Map<string, AlertNotification>();
  private activeAlerts = new Map<string, Alert>();
  private silences = new Map<string, SilenceRule>();
  
  constructor(
    private metricsCollector: MetricsCollector,
    private alertManagerUrl: string = process.env.ALERTMANAGER_URL || 'http://localhost:9093',
    private prometheusUrl: string = process.env.PROMETHEUS_URL || 'http://localhost:9090'
  ) {
    this.initializeDefaultRules();
    this.initializeDefaultNotifications();
    this.startAlertMonitoring();
  }

  private initializeDefaultRules() {
    // System health alert rules
    const systemRules: AlertRule[] = [
      {
        id: 'service-down',
        name: '服务不可用',
        expr: 'up == 0',
        labels: { severity: 'critical', team: 'platform' },
        annotations: {
          summary: '服务 {{ $labels.instance }} 不可用',
          description: '服务 {{ $labels.instance }} 已经下线超过 1 分钟',
          runbook_url: 'https://wiki.company.com/runbooks/service-down'
        },
        for: '1m',
        severity: 'critical',
        enabled: true,
        notificationChannels: ['critical-alerts', 'ops-team']
      },
      
      {
        id: 'high-error-rate',
        name: '高错误率告警',
        expr: 'rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100 > 5',
        labels: { severity: 'warning', team: 'backend' },
        annotations: {
          summary: '{{ $labels.service }} 错误率过高',
          description: '{{ $labels.service }} 在过去 5 分钟内错误率达到 {{ $value }}%',
          runbook_url: 'https://wiki.company.com/runbooks/high-error-rate'
        },
        for: '2m',
        severity: 'warning',
        enabled: true,
        thresholds: { warning: 5, critical: 15 },
        notificationChannels: ['backend-alerts']
      },

      {
        id: 'slow-response-time',
        name: '响应时间过慢',
        expr: 'histogram_quantile(0.95, rate(ai_response_time_seconds_bucket[5m])) > 2',
        labels: { severity: 'warning', team: 'ai' },
        annotations: {
          summary: 'AI响应时间过慢',
          description: 'AI响应时间P95超过2秒，当前值: {{ $value }}s',
          runbook_url: 'https://wiki.company.com/runbooks/slow-ai-response'
        },
        for: '3m',
        severity: 'warning',
        enabled: true,
        thresholds: { warning: 2, critical: 5 },
        notificationChannels: ['ai-team', 'performance-alerts']
      },

      {
        id: 'high-memory-usage',
        name: '内存使用率过高',
        expr: 'process_memory_usage_bytes{type="rss"} / 1024 / 1024 / 1024 > 2',
        labels: { severity: 'warning', team: 'platform' },
        annotations: {
          summary: '{{ $labels.service }} 内存使用过高',
          description: '{{ $labels.service }} 内存使用超过 2GB，当前: {{ $value }}GB',
          runbook_url: 'https://wiki.company.com/runbooks/high-memory'
        },
        for: '5m',
        severity: 'warning',
        enabled: true,
        thresholds: { warning: 2, critical: 4 },
        notificationChannels: ['platform-alerts']
      },

      {
        id: 'database-connection-high',
        name: '数据库连接数过高',
        expr: 'database_connections_active > 80',
        labels: { severity: 'warning', team: 'database' },
        annotations: {
          summary: '数据库连接数过高',
          description: '{{ $labels.database_type }} 连接数达到 {{ $value }}，接近上限',
          runbook_url: 'https://wiki.company.com/runbooks/db-connections'
        },
        for: '2m',
        severity: 'warning',
        enabled: true,
        thresholds: { warning: 80, critical: 95 },
        notificationChannels: ['database-alerts']
      },

      {
        id: 'low-cache-hit-rate',
        name: '缓存命中率过低',
        expr: 'cache_hit_rate < 0.7',
        labels: { severity: 'info', team: 'backend' },
        annotations: {
          summary: '{{ $labels.service }} 缓存命中率过低',
          description: '{{ $labels.cache_type }} 缓存命中率仅 {{ $value | humanizePercentage }}',
          runbook_url: 'https://wiki.company.com/runbooks/low-cache-hit'
        },
        for: '10m',
        severity: 'info',
        enabled: true,
        thresholds: { warning: 0.7, critical: 0.5 },
        notificationChannels: ['performance-alerts']
      },

      // Business-specific alert rules
      {
        id: 'ai-accuracy-degradation',
        name: 'AI识别准确率下降',
        expr: 'ai_intent_accuracy_rate < 0.85',
        labels: { severity: 'warning', team: 'ai' },
        annotations: {
          summary: 'AI意图识别准确率下降',
          description: 'AI意图识别准确率降至 {{ $value | humanizePercentage }}，低于85%阈值',
          runbook_url: 'https://wiki.company.com/runbooks/ai-accuracy'
        },
        for: '5m',
        severity: 'warning',
        enabled: true,
        thresholds: { warning: 0.85, critical: 0.7 },
        notificationChannels: ['ai-team', 'quality-alerts']
      },

      {
        id: 'spam-detection-spike',
        name: '骚扰电话激增',
        expr: 'rate(spam_detection_total[5m]) > 10',
        labels: { severity: 'info', team: 'security' },
        annotations: {
          summary: '骚扰电话检测量激增',
          description: '过去5分钟检测到 {{ $value }} 个骚扰电话，可能存在异常',
          runbook_url: 'https://wiki.company.com/runbooks/spam-spike'
        },
        for: '2m',
        severity: 'info',
        enabled: true,
        thresholds: { warning: 10, critical: 50 },
        notificationChannels: ['security-alerts']
      }
    ];

    systemRules.forEach(rule => {
      this.alertRules.set(rule.id, rule);
    });

    logger.info(`Initialized ${systemRules.length} default alert rules`);
  }

  private initializeDefaultNotifications() {
    const defaultNotifications: AlertNotification[] = [
      {
        id: 'critical-alerts',
        type: 'dingtalk',
        name: '紧急告警钉钉群',
        settings: {
          webhook: process.env.DINGTALK_CRITICAL_WEBHOOK,
          atMobiles: process.env.DINGTALK_CRITICAL_PHONES?.split(',') || [],
          isAtAll: true
        },
        enabled: true
      },
      
      {
        id: 'ops-team',
        type: 'email',
        name: '运维团队邮件',
        settings: {
          emails: process.env.OPS_TEAM_EMAILS?.split(',') || ['ops@company.com'],
          subject: '[告警] {{ .GroupLabels.alertname }}',
          body: `告警详情:
服务: {{ .GroupLabels.service }}
严重程度: {{ .GroupLabels.severity }}
描述: {{ .CommonAnnotations.description }}
时间: {{ .CommonAnnotations.startsAt }}`
        },
        enabled: true
      },

      {
        id: 'slack-channel',
        type: 'slack',
        name: 'Slack告警频道',
        settings: {
          webhook: process.env.SLACK_WEBHOOK_URL,
          channel: '#alerts',
          username: 'AlertManager',
          title: '{{ .GroupLabels.alertname }}',
          text: '{{ .CommonAnnotations.description }}',
          color: 'danger'
        },
        enabled: Boolean(process.env.SLACK_WEBHOOK_URL)
      },

      {
        id: 'webhook-integration',
        type: 'webhook',
        name: '内部系统Webhook',
        settings: {
          url: process.env.INTERNAL_WEBHOOK_URL || 'http://localhost:3000/api/alerts/webhook',
          httpMethod: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_TOKEN}`
          }
        },
        enabled: Boolean(process.env.INTERNAL_WEBHOOK_URL)
      }
    ];

    defaultNotifications.forEach(notification => {
      this.notifications.set(notification.id, notification);
    });

    logger.info(`Initialized ${defaultNotifications.length} notification channels`);
  }

  private startAlertMonitoring() {
    // Poll AlertManager for active alerts every 30 seconds
    setInterval(async () => {
      await this.syncActiveAlerts();
    }, 30000);

    // Evaluate custom alert rules every 15 seconds
    setInterval(async () => {
      await this.evaluateAlertRules();
    }, 15000);

    logger.info('Started alert monitoring processes');
  }

  private async syncActiveAlerts() {
    try {
      const response = await fetch(`${this.alertManagerUrl}/api/v1/alerts`);
      if (!response.ok) {
        throw new Error(`AlertManager API error: ${response.statusText}`);
      }

      const data = await response.json() as { data: Alert[] };
      const currentAlerts = new Map<string, Alert>();

      data.data.forEach(alert => {
        currentAlerts.set(alert.fingerprint, alert);
      });

      // Compare with previous alerts to detect state changes
      this.detectAlertStateChanges(currentAlerts);
      this.activeAlerts = currentAlerts;

      logger.debug(`Synced ${currentAlerts.size} active alerts from AlertManager`);
    } catch (error) {
      logger.error('Error syncing alerts from AlertManager:', error);
    }
  }

  private detectAlertStateChanges(newAlerts: Map<string, Alert>) {
    // Detect newly firing alerts
    newAlerts.forEach((newAlert, fingerprint) => {
      const oldAlert = this.activeAlerts.get(fingerprint);
      
      if (!oldAlert && newAlert.state === 'firing') {
        this.handleNewAlert(newAlert);
      } else if (oldAlert && oldAlert.state !== newAlert.state) {
        this.handleAlertStateChange(oldAlert, newAlert);
      }
    });

    // Detect resolved alerts
    this.activeAlerts.forEach((oldAlert, fingerprint) => {
      if (!newAlerts.has(fingerprint) && oldAlert.state === 'firing') {
        this.handleResolvedAlert(oldAlert);
      }
    });
  }

  private async handleNewAlert(alert: Alert) {
    logger.info(`New alert fired: ${alert.labels.alertname}`, { alert });
    
    // Record alert metrics
    await this.metricsCollector.recordMetric({
      service: 'monitoring',
      metric: 'alert_fired',
      value: 1,
      tags: {
        alertname: alert.labels.alertname,
        severity: alert.labels.severity,
        team: alert.labels.team
      },
      timestamp: new Date()
    });

    // Send notifications
    await this.sendAlertNotification(alert, 'fired');
  }

  private async handleAlertStateChange(oldAlert: Alert, newAlert: Alert) {
    logger.info(`Alert state changed: ${newAlert.labels.alertname} ${oldAlert.state} -> ${newAlert.state}`);
    
    if (newAlert.state === 'resolved') {
      await this.handleResolvedAlert(newAlert);
    }
  }

  private async handleResolvedAlert(alert: Alert) {
    logger.info(`Alert resolved: ${alert.labels.alertname}`, { alert });
    
    // Record resolution metrics
    await this.metricsCollector.recordMetric({
      service: 'monitoring',
      metric: 'alert_resolved',
      value: 1,
      tags: {
        alertname: alert.labels.alertname,
        severity: alert.labels.severity,
        duration: alert.endsAt ? Math.round((alert.endsAt.getTime() - alert.startsAt.getTime()) / 1000) : 0
      },
      timestamp: new Date()
    });

    // Send resolution notification
    await this.sendAlertNotification(alert, 'resolved');
  }

  private async sendAlertNotification(alert: Alert, action: 'fired' | 'resolved') {
    const rule = this.alertRules.get(alert.labels.alertname);
    if (!rule) return;

    const promises = rule.notificationChannels.map(channelId => {
      const channel = this.notifications.get(channelId);
      if (channel && channel.enabled) {
        return this.sendNotificationToChannel(alert, channel, action);
      }
    });

    await Promise.allSettled(promises);
  }

  private async sendNotificationToChannel(
    alert: Alert, 
    channel: AlertNotification, 
    action: 'fired' | 'resolved'
  ) {
    try {
      switch (channel.type) {
        case 'dingtalk':
          await this.sendDingTalkNotification(alert, channel, action);
          break;
        case 'slack':
          await this.sendSlackNotification(alert, channel, action);
          break;
        case 'email':
          await this.sendEmailNotification(alert, channel, action);
          break;
        case 'webhook':
          await this.sendWebhookNotification(alert, channel, action);
          break;
        case 'sms':
          await this.sendSMSNotification(alert, channel, action);
          break;
        default:
          logger.warn(`Unknown notification type: ${channel.type}`);
      }

      logger.info(`Sent ${action} notification for ${alert.labels.alertname} via ${channel.type}`);
    } catch (error) {
      logger.error(`Error sending notification via ${channel.type}:`, error);
    }
  }

  private async sendDingTalkNotification(alert: Alert, channel: AlertNotification, action: 'fired' | 'resolved') {
    const { webhook, atMobiles = [], isAtAll = false } = channel.settings;
    
    const color = action === 'fired' ? '🔴' : '🟢';
    const actionText = action === 'fired' ? '触发' : '恢复';
    
    const message = {
      msgtype: 'markdown',
      markdown: {
        title: `${color} 告警${actionText}`,
        text: `### ${color} ${alert.labels.alertname} 告警${actionText}

**服务**: ${alert.labels.service || 'Unknown'}
**严重程度**: ${alert.labels.severity}
**描述**: ${alert.annotations.description}
**时间**: ${new Date().toLocaleString('zh-CN')}

${alert.annotations.runbook_url ? `[处理手册](${alert.annotations.runbook_url})` : ''}
        `
      },
      at: {
        atMobiles,
        isAtAll
      }
    };

    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  }

  private async sendSlackNotification(alert: Alert, channel: AlertNotification, action: 'fired' | 'resolved') {
    const { webhook, channel: slackChannel, username } = channel.settings;
    
    const color = action === 'fired' ? 'danger' : 'good';
    const actionText = action === 'fired' ? 'FIRED' : 'RESOLVED';
    
    const message = {
      channel: slackChannel,
      username: username,
      attachments: [{
        color: color,
        title: `🚨 ${alert.labels.alertname} - ${actionText}`,
        text: alert.annotations.description,
        fields: [
          { title: 'Service', value: alert.labels.service || 'Unknown', short: true },
          { title: 'Severity', value: alert.labels.severity, short: true },
          { title: 'Time', value: new Date().toISOString(), short: true }
        ],
        actions: alert.annotations.runbook_url ? [{
          type: 'button',
          text: 'View Runbook',
          url: alert.annotations.runbook_url
        }] : []
      }]
    };

    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  }

  private async sendEmailNotification(alert: Alert, channel: AlertNotification, action: 'fired' | 'resolved') {
    // This would typically integrate with an email service like SendGrid, SES, etc.
    logger.info(`Email notification would be sent to: ${channel.settings.emails.join(', ')}`);
    
    // Record that email notification was attempted
    await this.metricsCollector.recordMetric({
      service: 'monitoring',
      metric: 'notification_sent',
      value: 1,
      tags: {
        type: 'email',
        action,
        alertname: alert.labels.alertname
      },
      timestamp: new Date()
    });
  }

  private async sendWebhookNotification(alert: Alert, channel: AlertNotification, action: 'fired' | 'resolved') {
    const { url, httpMethod = 'POST', headers = {} } = channel.settings;
    
    const payload = {
      alert,
      action,
      timestamp: new Date().toISOString()
    };

    await fetch(url, {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload)
    });
  }

  private async sendSMSNotification(alert: Alert, channel: AlertNotification, action: 'fired' | 'resolved') {
    // SMS integration would go here
    logger.info(`SMS notification would be sent for alert: ${alert.labels.alertname}`);
    
    await this.metricsCollector.recordMetric({
      service: 'monitoring',
      metric: 'notification_sent',
      value: 1,
      tags: {
        type: 'sms',
        action,
        alertname: alert.labels.alertname
      },
      timestamp: new Date()
    });
  }

  private async evaluateAlertRules() {
    const enabledRules = Array.from(this.alertRules.values()).filter(rule => rule.enabled);
    
    for (const rule of enabledRules) {
      try {
        await this.evaluateRule(rule);
      } catch (error) {
        logger.error(`Error evaluating rule ${rule.name}:`, error);
      }
    }
  }

  private async evaluateRule(rule: AlertRule) {
    try {
      const response = await fetch(
        `${this.prometheusUrl}/api/v1/query?query=${encodeURIComponent(rule.expr)}`
      );
      
      if (!response.ok) {
        throw new Error(`Prometheus query error: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.data.result && data.data.result.length > 0) {
        // Rule condition met - this would typically be handled by Prometheus AlertManager
        logger.debug(`Alert rule ${rule.name} condition met`);
      }
    } catch (error) {
      logger.error(`Error querying Prometheus for rule ${rule.name}:`, error);
    }
  }

  // Public API methods
  public async createAlertRule(rule: AlertRule): Promise<void> {
    this.alertRules.set(rule.id, rule);
    logger.info(`Created alert rule: ${rule.name}`);
  }

  public async updateAlertRule(ruleId: string, updates: Partial<AlertRule>): Promise<boolean> {
    const rule = this.alertRules.get(ruleId);
    if (!rule) return false;

    const updatedRule = { ...rule, ...updates };
    this.alertRules.set(ruleId, updatedRule);
    logger.info(`Updated alert rule: ${updatedRule.name}`);
    return true;
  }

  public async deleteAlertRule(ruleId: string): Promise<boolean> {
    return this.alertRules.delete(ruleId);
  }

  public getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  public async createNotificationChannel(notification: AlertNotification): Promise<void> {
    this.notifications.set(notification.id, notification);
    logger.info(`Created notification channel: ${notification.name}`);
  }

  public getNotificationChannels(): AlertNotification[] {
    return Array.from(this.notifications.values());
  }

  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  public async createSilence(silence: Omit<SilenceRule, 'id' | 'status'>): Promise<string> {
    const silenceId = `silence-${Date.now()}`;
    const newSilence: SilenceRule = {
      ...silence,
      id: silenceId,
      status: 'pending'
    };

    this.silences.set(silenceId, newSilence);
    logger.info(`Created silence rule: ${silenceId}`);
    return silenceId;
  }

  public async expireSilence(silenceId: string): Promise<boolean> {
    const silence = this.silences.get(silenceId);
    if (!silence) return false;

    silence.status = 'expired';
    logger.info(`Expired silence rule: ${silenceId}`);
    return true;
  }

  public getSilenceRules(): SilenceRule[] {
    return Array.from(this.silences.values());
  }

  // Health check and metrics
  public async getHealth() {
    const alertManagerHealthy = await this.checkAlertManagerHealth();
    const prometheusHealthy = await this.checkPrometheusHealth();

    return {
      status: alertManagerHealthy && prometheusHealthy ? 'healthy' : 'degraded',
      alertManager: alertManagerHealthy ? 'up' : 'down',
      prometheus: prometheusHealthy ? 'up' : 'down',
      activeAlerts: this.activeAlerts.size,
      alertRules: this.alertRules.size,
      notificationChannels: this.notifications.size,
      silenceRules: this.silences.size
    };
  }

  private async checkAlertManagerHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.alertManagerUrl}/-/healthy`, {
        timeout: 5000
      } as any);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkPrometheusHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.prometheusUrl}/-/healthy`, {
        timeout: 5000
      } as any);
      return response.ok;
    } catch {
      return false;
    }
  }
}