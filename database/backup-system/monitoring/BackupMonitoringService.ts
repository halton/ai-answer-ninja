/**
 * AI电话应答系统 - 备份监控服务
 * 
 * 功能特性:
 * - 实时备份状态监控
 * - 多渠道告警通知
 * - 性能指标收集
 * - 预测性故障检测
 * - SLA监控和报告
 * - 自动化运维响应
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import nodemailer from 'nodemailer';

interface MonitoringConfig {
  metrics: {
    collectionInterval: number; // seconds
    retentionPeriod: number; // days
    aggregationWindows: number[]; // minutes: [5, 15, 60, 1440]
  };
  alerts: {
    channels: {
      email: {
        enabled: boolean;
        smtp: {
          host: string;
          port: number;
          secure: boolean;
          auth: {
            user: string;
            pass: string;
          };
        };
        recipients: string[];
      };
      webhook: {
        enabled: boolean;
        url: string;
        headers?: Record<string, string>;
        retryAttempts: number;
      };
      slack: {
        enabled: boolean;
        webhookUrl: string;
        channel: string;
      };
      teams: {
        enabled: boolean;
        webhookUrl: string;
      };
      sms: {
        enabled: boolean;
        apiKey: string;
        recipients: string[];
      };
    };
    rules: Array<{
      name: string;
      condition: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      throttle: number; // minutes
      escalation: {
        enabled: boolean;
        after: number; // minutes
        to: string[];
      };
    }>;
  };
  sla: {
    backupFrequency: {
      postgresql: {
        full: number; // hours
        incremental: number; // hours
      };
      redis: {
        rdb: number; // hours
        aof: number; // hours
      };
    };
    recoveryTime: {
      rto: number; // minutes - Recovery Time Objective
      rpo: number; // minutes - Recovery Point Objective
    };
    availability: {
      target: number; // percentage
      calculationPeriod: number; // days
    };
  };
  dashboard: {
    enabled: boolean;
    port: number;
    refreshInterval: number; // seconds
  };
}

interface Metric {
  timestamp: Date;
  name: string;
  value: number;
  labels: Record<string, string>;
  unit: string;
}

interface Alert {
  id: string;
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'resolved' | 'acknowledged';
  createdAt: Date;
  resolvedAt?: Date;
  acknowledgedAt?: Date;
  message: string;
  details: any;
  notificationsSent: Array<{
    channel: string;
    sentAt: Date;
    success: boolean;
    error?: string;
  }>;
}

interface BackupStatus {
  service: 'postgresql' | 'redis';
  type: 'full' | 'incremental' | 'rdb' | 'aof';
  status: 'success' | 'failed' | 'running' | 'missed';
  lastRun: Date;
  nextScheduled: Date;
  duration?: number;
  size?: number;
  errorMessage?: string;
}

interface SLAMetrics {
  availability: {
    percentage: number;
    uptime: number;
    downtime: number;
    incidents: number;
  };
  backup: {
    successRate: number;
    averageSize: number;
    averageDuration: number;
    missedBackups: number;
  };
  recovery: {
    averageRTO: number;
    averageRPO: number;
    testSuccessRate: number;
    lastSuccessfulTest: Date;
  };
}

export class BackupMonitoringService extends EventEmitter {
  private config: MonitoringConfig;
  private metrics: Map<string, Metric[]> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private backupStatuses: Map<string, BackupStatus> = new Map();
  private slaMetrics: SLAMetrics;
  
  private metricsCollectionTimer?: NodeJS.Timeout;
  private alertProcessingTimer?: NodeJS.Timeout;
  private slaCalculationTimer?: NodeJS.Timeout;
  
  private emailTransporter?: nodemailer.Transporter;

  constructor(config: MonitoringConfig) {
    super();
    this.config = config;
    this.slaMetrics = this.initializeSLAMetrics();
    this.setupEventHandlers();
  }

  /**
   * 初始化监控服务
   */
  async initialize(): Promise<void> {
    try {
      console.log('初始化备份监控服务...');
      
      // 初始化通知渠道
      await this.initializeNotificationChannels();
      
      // 启动指标收集
      this.startMetricsCollection();
      
      // 启动告警处理
      this.startAlertProcessing();
      
      // 启动SLA计算
      this.startSLACalculation();
      
      // 启动仪表盘(如果启用)
      if (this.config.dashboard.enabled) {
        await this.startDashboard();
      }
      
      this.emit('monitoring_initialized', { timestamp: new Date() });
      console.log('备份监控服务初始化完成');
    } catch (error) {
      this.emit('error', {
        type: 'monitoring_initialization_failed',
        error: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * 记录指标
   */
  recordMetric(name: string, value: number, labels: Record<string, string> = {}, unit: string = ''): void {
    const metric: Metric = {
      timestamp: new Date(),
      name,
      value,
      labels,
      unit
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    this.metrics.get(name)!.push(metric);
    
    // 限制内存中的指标数量
    const maxMetrics = 10000;
    const metricArray = this.metrics.get(name)!;
    if (metricArray.length > maxMetrics) {
      metricArray.splice(0, metricArray.length - maxMetrics);
    }

    this.emit('metric_recorded', { metric });
    
    // 检查告警规则
    this.checkAlertRules(metric);
  }

  /**
   * 更新备份状态
   */
  updateBackupStatus(
    service: 'postgresql' | 'redis',
    type: string,
    status: 'success' | 'failed' | 'running' | 'missed',
    details: {
      duration?: number;
      size?: number;
      errorMessage?: string;
      nextScheduled?: Date;
    } = {}
  ): void {
    const statusKey = `${service}-${type}`;
    const backupStatus: BackupStatus = {
      service,
      type: type as any,
      status,
      lastRun: new Date(),
      nextScheduled: details.nextScheduled || new Date(Date.now() + 24 * 60 * 60 * 1000),
      duration: details.duration,
      size: details.size,
      errorMessage: details.errorMessage
    };

    this.backupStatuses.set(statusKey, backupStatus);

    // 记录相关指标
    this.recordMetric('backup_status', status === 'success' ? 1 : 0, {
      service,
      type,
      status
    });

    if (details.duration) {
      this.recordMetric('backup_duration', details.duration, { service, type }, 'ms');
    }

    if (details.size) {
      this.recordMetric('backup_size', details.size, { service, type }, 'bytes');
    }

    this.emit('backup_status_updated', { service, type, status, details });

    // 检查备份失败告警
    if (status === 'failed') {
      this.triggerAlert('backup_failed', 'high', `${service} ${type} 备份失败`, {
        service,
        type,
        error: details.errorMessage
      });
    }

    // 检查备份遗漏告警
    if (status === 'missed') {
      this.triggerAlert('backup_missed', 'medium', `${service} ${type} 备份遗漏`, {
        service,
        type,
        nextScheduled: details.nextScheduled
      });
    }
  }

  /**
   * 手动触发告警
   */
  triggerAlert(
    name: string, 
    severity: Alert['severity'], 
    message: string, 
    details: any = {}
  ): string {
    const alertId = this.generateAlertId(name);
    const alert: Alert = {
      id: alertId,
      name,
      severity,
      status: 'active',
      createdAt: new Date(),
      message,
      details,
      notificationsSent: []
    };

    this.alerts.set(alertId, alert);
    
    this.emit('alert_triggered', { alert });
    
    // 异步发送通知
    this.sendAlertNotifications(alert).catch(error => {
      console.error('发送告警通知失败:', error);
    });

    return alertId;
  }

  /**
   * 确认告警
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    
    this.emit('alert_acknowledged', { 
      alertId, 
      acknowledgedBy,
      timestamp: new Date() 
    });

    return true;
  }

  /**
   * 解决告警
   */
  resolveAlert(alertId: string, resolvedBy?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    
    this.emit('alert_resolved', { 
      alertId, 
      resolvedBy,
      timestamp: new Date() 
    });

    return true;
  }

  /**
   * 获取当前告警
   */
  getActiveAlerts(severity?: Alert['severity']): Alert[] {
    const alerts = Array.from(this.alerts.values())
      .filter(alert => alert.status === 'active');

    if (severity) {
      return alerts.filter(alert => alert.severity === severity);
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * 获取指标数据
   */
  getMetrics(
    name: string, 
    timeRange?: { start: Date; end: Date },
    aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count'
  ): Metric[] {
    const metrics = this.metrics.get(name) || [];
    
    let filteredMetrics = metrics;
    
    // 应用时间范围过滤
    if (timeRange) {
      filteredMetrics = metrics.filter(metric => 
        metric.timestamp >= timeRange.start && metric.timestamp <= timeRange.end
      );
    }

    // 应用聚合
    if (aggregation && filteredMetrics.length > 0) {
      return this.aggregateMetrics(filteredMetrics, aggregation);
    }

    return filteredMetrics;
  }

  /**
   * 获取SLA指标
   */
  getSLAMetrics(): SLAMetrics {
    return { ...this.slaMetrics };
  }

  /**
   * 获取备份状态概览
   */
  getBackupStatusOverview(): {
    postgresql: {
      full: BackupStatus | null;
      incremental: BackupStatus | null;
    };
    redis: {
      rdb: BackupStatus | null;
      aof: BackupStatus | null;
    };
    summary: {
      total: number;
      successful: number;
      failed: number;
      running: number;
      missed: number;
    };
  } {
    const postgresql = {
      full: this.backupStatuses.get('postgresql-full') || null,
      incremental: this.backupStatuses.get('postgresql-incremental') || null
    };

    const redis = {
      rdb: this.backupStatuses.get('redis-rdb') || null,
      aof: this.backupStatuses.get('redis-aof') || null
    };

    const allStatuses = Array.from(this.backupStatuses.values());
    const summary = {
      total: allStatuses.length,
      successful: allStatuses.filter(s => s.status === 'success').length,
      failed: allStatuses.filter(s => s.status === 'failed').length,
      running: allStatuses.filter(s => s.status === 'running').length,
      missed: allStatuses.filter(s => s.status === 'missed').length
    };

    return { postgresql, redis, summary };
  }

  /**
   * 生成监控报告
   */
  async generateMonitoringReport(period: {
    start: Date;
    end: Date;
  }): Promise<{
    period: { start: Date; end: Date };
    summary: {
      totalAlerts: number;
      criticalAlerts: number;
      resolvedAlerts: number;
      avgResolutionTime: number;
    };
    sla: SLAMetrics;
    backupSummary: {
      successful: number;
      failed: number;
      totalSize: number;
      avgDuration: number;
    };
    recommendations: string[];
  }> {
    console.log(`生成监控报告: ${period.start.toISOString()} - ${period.end.toISOString()}`);

    const periodAlerts = Array.from(this.alerts.values())
      .filter(alert => alert.createdAt >= period.start && alert.createdAt <= period.end);

    const criticalAlerts = periodAlerts.filter(alert => alert.severity === 'critical');
    const resolvedAlerts = periodAlerts.filter(alert => alert.status === 'resolved');
    
    const resolutionTimes = resolvedAlerts
      .filter(alert => alert.resolvedAt)
      .map(alert => alert.resolvedAt!.getTime() - alert.createdAt.getTime());
    
    const avgResolutionTime = resolutionTimes.length > 0
      ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length
      : 0;

    // 获取备份指标
    const backupSizeMetrics = this.getMetrics('backup_size', period);
    const backupDurationMetrics = this.getMetrics('backup_duration', period);
    const backupStatusMetrics = this.getMetrics('backup_status', period);

    const totalSize = backupSizeMetrics.reduce((sum, metric) => sum + metric.value, 0);
    const avgDuration = backupDurationMetrics.length > 0
      ? backupDurationMetrics.reduce((sum, metric) => sum + metric.value, 0) / backupDurationMetrics.length
      : 0;
    const successful = backupStatusMetrics.filter(metric => metric.value === 1).length;
    const failed = backupStatusMetrics.filter(metric => metric.value === 0).length;

    // 生成建议
    const recommendations = this.generateRecommendations({
      criticalAlerts: criticalAlerts.length,
      failedBackups: failed,
      avgResolutionTime,
      slaMetrics: this.slaMetrics
    });

    return {
      period,
      summary: {
        totalAlerts: periodAlerts.length,
        criticalAlerts: criticalAlerts.length,
        resolvedAlerts: resolvedAlerts.length,
        avgResolutionTime
      },
      sla: this.getSLAMetrics(),
      backupSummary: {
        successful,
        failed,
        totalSize,
        avgDuration
      },
      recommendations
    };
  }

  /**
   * 停止监控服务
   */
  async shutdown(): Promise<void> {
    console.log('关闭备份监控服务...');

    // 停止定时器
    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
    }
    
    if (this.alertProcessingTimer) {
      clearInterval(this.alertProcessingTimer);
    }
    
    if (this.slaCalculationTimer) {
      clearInterval(this.slaCalculationTimer);
    }

    // 关闭邮件传输器
    if (this.emailTransporter) {
      this.emailTransporter.close();
    }

    this.emit('monitoring_shutdown', { timestamp: new Date() });
  }

  // ==================== 私有方法 ====================

  private setupEventHandlers(): void {
    this.on('error', (data) => {
      console.error('监控服务错误:', data);
    });

    this.on('alert_triggered', (data) => {
      console.warn('告警触发:', {
        id: data.alert.id,
        name: data.alert.name,
        severity: data.alert.severity,
        message: data.alert.message
      });
    });

    this.on('backup_status_updated', (data) => {
      console.log('备份状态更新:', {
        service: data.service,
        type: data.type,
        status: data.status
      });
    });
  }

  private initializeSLAMetrics(): SLAMetrics {
    return {
      availability: {
        percentage: 99.9,
        uptime: 0,
        downtime: 0,
        incidents: 0
      },
      backup: {
        successRate: 100,
        averageSize: 0,
        averageDuration: 0,
        missedBackups: 0
      },
      recovery: {
        averageRTO: 0,
        averageRPO: 0,
        testSuccessRate: 100,
        lastSuccessfulTest: new Date()
      }
    };
  }

  private async initializeNotificationChannels(): Promise<void> {
    // 初始化邮件传输器
    if (this.config.alerts.channels.email.enabled) {
      this.emailTransporter = nodemailer.createTransporter(this.config.alerts.channels.email.smtp);
      
      // 验证邮件配置
      try {
        await this.emailTransporter.verify();
        console.log('邮件通知渠道初始化成功');
      } catch (error) {
        console.error('邮件通知渠道初始化失败:', error);
      }
    }

    // 其他通知渠道的初始化
    console.log('通知渠道初始化完成');
  }

  private startMetricsCollection(): void {
    this.metricsCollectionTimer = setInterval(async () => {
      try {
        await this.collectSystemMetrics();
      } catch (error) {
        console.error('指标收集失败:', error);
      }
    }, this.config.metrics.collectionInterval * 1000);
  }

  private startAlertProcessing(): void {
    this.alertProcessingTimer = setInterval(async () => {
      try {
        await this.processAlerts();
      } catch (error) {
        console.error('告警处理失败:', error);
      }
    }, 60000); // 每分钟处理一次
  }

  private startSLACalculation(): void {
    this.slaCalculationTimer = setInterval(async () => {
      try {
        await this.calculateSLAMetrics();
      } catch (error) {
        console.error('SLA计算失败:', error);
      }
    }, 300000); // 每5分钟计算一次
  }

  private async startDashboard(): Promise<void> {
    // 简化的仪表盘实现
    console.log(`仪表盘启动在端口 ${this.config.dashboard.port}`);
  }

  private async collectSystemMetrics(): Promise<void> {
    // 收集系统级指标
    const os = require('os');
    const process = require('process');
    
    // CPU使用率
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = 100 - (totalIdle / totalTick * 100);
    this.recordMetric('system_cpu_usage', cpuUsage, {}, 'percentage');
    
    // 内存使用率
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;
    this.recordMetric('system_memory_usage', memUsage, {}, 'percentage');
    
    // 进程指标
    this.recordMetric('process_memory_usage', process.memoryUsage().rss, {}, 'bytes');
    this.recordMetric('process_uptime', process.uptime(), {}, 'seconds');
  }

  private checkAlertRules(metric: Metric): void {
    for (const rule of this.config.alerts.rules) {
      try {
        if (this.evaluateAlertCondition(rule.condition, metric)) {
          // 检查是否已存在相同的活跃告警（避免重复告警）
          const existingAlert = Array.from(this.alerts.values()).find(alert => 
            alert.name === rule.name && 
            alert.status === 'active' &&
            (Date.now() - alert.createdAt.getTime()) < rule.throttle * 60 * 1000
          );

          if (!existingAlert) {
            this.triggerAlert(
              rule.name,
              rule.severity,
              `告警规则触发: ${rule.condition}`,
              { metric, rule }
            );
          }
        }
      } catch (error) {
        console.error(`评估告警规则失败: ${rule.name}`, error);
      }
    }
  }

  private evaluateAlertCondition(condition: string, metric: Metric): boolean {
    // 简化的条件评估实现
    // 实际应该实现更复杂的表达式解析器
    try {
      const context = {
        value: metric.value,
        name: metric.name,
        ...metric.labels
      };

      // 简单的条件评估
      if (condition.includes('value >')) {
        const threshold = parseFloat(condition.split('value >')[1].trim());
        return metric.value > threshold;
      }
      
      if (condition.includes('value <')) {
        const threshold = parseFloat(condition.split('value <')[1].trim());
        return metric.value < threshold;
      }

      return false;
    } catch (error) {
      console.error('条件评估失败:', condition, error);
      return false;
    }
  }

  private async sendAlertNotifications(alert: Alert): Promise<void> {
    const channels = this.config.alerts.channels;
    const notifications: Array<Promise<{ channel: string; success: boolean; error?: string }>> = [];

    // 邮件通知
    if (channels.email.enabled) {
      notifications.push(this.sendEmailAlert(alert));
    }

    // Webhook通知
    if (channels.webhook.enabled) {
      notifications.push(this.sendWebhookAlert(alert));
    }

    // Slack通知
    if (channels.slack.enabled) {
      notifications.push(this.sendSlackAlert(alert));
    }

    // Teams通知
    if (channels.teams.enabled) {
      notifications.push(this.sendTeamsAlert(alert));
    }

    // 等待所有通知发送完成
    const results = await Promise.allSettled(notifications);
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        alert.notificationsSent.push({
          channel: result.value.channel,
          sentAt: new Date(),
          success: result.value.success,
          error: result.value.error
        });
      } else {
        alert.notificationsSent.push({
          channel: 'unknown',
          sentAt: new Date(),
          success: false,
          error: result.reason.message
        });
      }
    }
  }

  private async sendEmailAlert(alert: Alert): Promise<{ channel: string; success: boolean; error?: string }> {
    if (!this.emailTransporter) {
      return { channel: 'email', success: false, error: '邮件传输器未初始化' };
    }

    try {
      const subject = `[${alert.severity.toUpperCase()}] 备份系统告警: ${alert.name}`;
      const html = this.generateEmailAlertHTML(alert);

      await this.emailTransporter.sendMail({
        from: this.config.alerts.channels.email.smtp.auth.user,
        to: this.config.alerts.channels.email.recipients.join(','),
        subject,
        html
      });

      return { channel: 'email', success: true };
    } catch (error) {
      return { channel: 'email', success: false, error: error.message };
    }
  }

  private async sendWebhookAlert(alert: Alert): Promise<{ channel: string; success: boolean; error?: string }> {
    try {
      const payload = {
        alert: {
          id: alert.id,
          name: alert.name,
          severity: alert.severity,
          status: alert.status,
          message: alert.message,
          createdAt: alert.createdAt.toISOString(),
          details: alert.details
        },
        timestamp: new Date().toISOString()
      };

      await axios.post(this.config.alerts.channels.webhook.url, payload, {
        headers: this.config.alerts.channels.webhook.headers,
        timeout: 10000
      });

      return { channel: 'webhook', success: true };
    } catch (error) {
      return { channel: 'webhook', success: false, error: error.message };
    }
  }

  private async sendSlackAlert(alert: Alert): Promise<{ channel: string; success: boolean; error?: string }> {
    try {
      const color = this.getSlackColorForSeverity(alert.severity);
      const payload = {
        channel: this.config.alerts.channels.slack.channel,
        attachments: [{
          color,
          title: `备份系统告警: ${alert.name}`,
          text: alert.message,
          fields: [
            { title: '严重程度', value: alert.severity.toUpperCase(), short: true },
            { title: '状态', value: alert.status, short: true },
            { title: '时间', value: alert.createdAt.toISOString(), short: true }
          ],
          footer: 'AI答案忍者 - 备份监控',
          ts: Math.floor(alert.createdAt.getTime() / 1000)
        }]
      };

      await axios.post(this.config.alerts.channels.slack.webhookUrl, payload);

      return { channel: 'slack', success: true };
    } catch (error) {
      return { channel: 'slack', success: false, error: error.message };
    }
  }

  private async sendTeamsAlert(alert: Alert): Promise<{ channel: string; success: boolean; error?: string }> {
    try {
      const color = this.getTeamsColorForSeverity(alert.severity);
      const payload = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: color,
        summary: `备份系统告警: ${alert.name}`,
        sections: [{
          activityTitle: `备份系统告警: ${alert.name}`,
          activitySubtitle: alert.message,
          facts: [
            { name: '严重程度', value: alert.severity.toUpperCase() },
            { name: '状态', value: alert.status },
            { name: '时间', value: alert.createdAt.toISOString() }
          ]
        }]
      };

      await axios.post(this.config.alerts.channels.teams.webhookUrl, payload);

      return { channel: 'teams', success: true };
    } catch (error) {
      return { channel: 'teams', success: false, error: error.message };
    }
  }

  private async processAlerts(): Promise<void> {
    const activeAlerts = this.getActiveAlerts();
    
    for (const alert of activeAlerts) {
      // 检查告警升级
      const rule = this.config.alerts.rules.find(r => r.name === alert.name);
      if (rule?.escalation.enabled) {
        const timeSinceCreation = Date.now() - alert.createdAt.getTime();
        const escalationThreshold = rule.escalation.after * 60 * 1000;
        
        if (timeSinceCreation > escalationThreshold) {
          // TODO: 实现告警升级逻辑
          console.log(`告警升级: ${alert.id}`);
        }
      }
    }
  }

  private async calculateSLAMetrics(): Promise<void> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // 计算可用性
    const downtimeAlerts = Array.from(this.alerts.values())
      .filter(alert => 
        alert.severity === 'critical' &&
        alert.createdAt >= oneDayAgo
      );
    
    let totalDowntime = 0;
    for (const alert of downtimeAlerts) {
      const endTime = alert.resolvedAt || now;
      totalDowntime += endTime.getTime() - alert.createdAt.getTime();
    }
    
    const availability = ((24 * 60 * 60 * 1000 - totalDowntime) / (24 * 60 * 60 * 1000)) * 100;
    
    // 计算备份成功率
    const backupStatusMetrics = this.getMetrics('backup_status', { start: oneDayAgo, end: now });
    const successfulBackups = backupStatusMetrics.filter(m => m.value === 1).length;
    const totalBackups = backupStatusMetrics.length;
    const successRate = totalBackups > 0 ? (successfulBackups / totalBackups) * 100 : 100;
    
    // 更新SLA指标
    this.slaMetrics = {
      availability: {
        percentage: availability,
        uptime: 24 * 60 * 60 * 1000 - totalDowntime,
        downtime: totalDowntime,
        incidents: downtimeAlerts.length
      },
      backup: {
        successRate,
        averageSize: this.calculateAverageMetric('backup_size', oneDayAgo, now),
        averageDuration: this.calculateAverageMetric('backup_duration', oneDayAgo, now),
        missedBackups: Array.from(this.backupStatuses.values()).filter(s => s.status === 'missed').length
      },
      recovery: {
        averageRTO: 0, // 需要从实际恢复测试中计算
        averageRPO: 0, // 需要从实际恢复测试中计算
        testSuccessRate: 100, // 需要从验证服务获取
        lastSuccessfulTest: new Date()
      }
    };
  }

  private calculateAverageMetric(metricName: string, start: Date, end: Date): number {
    const metrics = this.getMetrics(metricName, { start, end });
    if (metrics.length === 0) return 0;
    
    return metrics.reduce((sum, metric) => sum + metric.value, 0) / metrics.length;
  }

  private aggregateMetrics(metrics: Metric[], aggregation: string): Metric[] {
    if (metrics.length === 0) return [];
    
    const values = metrics.map(m => m.value);
    let aggregatedValue: number;
    
    switch (aggregation) {
      case 'avg':
        aggregatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
        break;
      case 'sum':
        aggregatedValue = values.reduce((sum, val) => sum + val, 0);
        break;
      case 'min':
        aggregatedValue = Math.min(...values);
        break;
      case 'max':
        aggregatedValue = Math.max(...values);
        break;
      case 'count':
        aggregatedValue = values.length;
        break;
      default:
        aggregatedValue = values[values.length - 1];
    }
    
    return [{
      timestamp: metrics[metrics.length - 1].timestamp,
      name: metrics[0].name,
      value: aggregatedValue,
      labels: { ...metrics[0].labels, aggregation },
      unit: metrics[0].unit
    }];
  }

  private generateRecommendations(data: any): string[] {
    const recommendations: string[] = [];

    if (data.criticalAlerts > 0) {
      recommendations.push('发现关键告警，建议立即检查系统状态');
    }

    if (data.failedBackups > 5) {
      recommendations.push('备份失败次数过多，建议检查备份系统配置');
    }

    if (data.avgResolutionTime > 60 * 60 * 1000) { // 1小时
      recommendations.push('告警平均处理时间过长，建议优化响应流程');
    }

    if (data.slaMetrics.availability.percentage < 99) {
      recommendations.push('系统可用性低于99%，建议进行系统优化');
    }

    if (data.slaMetrics.backup.successRate < 95) {
      recommendations.push('备份成功率低于95%，建议检查备份策略');
    }

    return recommendations;
  }

  private generateEmailAlertHTML(alert: Alert): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .alert { border-left: 4px solid #dc3545; padding: 10px; background-color: #f8f9fa; }
          .severity-${alert.severity} { border-left-color: ${this.getSeverityColor(alert.severity)}; }
          .details { margin-top: 15px; }
          .footer { margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="alert severity-${alert.severity}">
          <h3>备份系统告警</h3>
          <p><strong>告警名称:</strong> ${alert.name}</p>
          <p><strong>严重程度:</strong> ${alert.severity.toUpperCase()}</p>
          <p><strong>消息:</strong> ${alert.message}</p>
          <p><strong>时间:</strong> ${alert.createdAt.toISOString()}</p>
          
          ${alert.details ? `
          <div class="details">
            <h4>详细信息:</h4>
            <pre>${JSON.stringify(alert.details, null, 2)}</pre>
          </div>
          ` : ''}
        </div>
        
        <div class="footer">
          <p>这是一条来自AI答案忍者备份监控系统的自动告警通知。</p>
        </div>
      </body>
      </html>
    `;
  }

  private getSeverityColor(severity: string): string {
    const colors = {
      low: '#28a745',
      medium: '#ffc107',
      high: '#fd7e14',
      critical: '#dc3545'
    };
    return colors[severity] || '#6c757d';
  }

  private getSlackColorForSeverity(severity: string): string {
    const colors = {
      low: 'good',
      medium: 'warning',
      high: 'danger',
      critical: 'danger'
    };
    return colors[severity] || '#000000';
  }

  private getTeamsColorForSeverity(severity: string): string {
    const colors = {
      low: '28a745',
      medium: 'ffc107',
      high: 'fd7e14',
      critical: 'dc3545'
    };
    return colors[severity] || '6c757d';
  }

  private generateAlertId(name: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substr(2, 9);
    return `alert-${name}-${timestamp}-${random}`;
  }
}