import { EventEmitter } from 'events';
import { Alert, AlertRule, NotificationChannel, EscalationPolicy, EscalationStep } from '../types';
import logger from '../utils/logger';
import { RedisService } from './redisService';
import { NotificationService } from './notificationService';
import { MetricsService } from './metricsService';
import config from '../config';

export class AlertManager extends EventEmitter {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private silencedAlerts: Set<string> = new Set();
  private alertHistory: Alert[] = [];
  private groupingWindow = new Map<string, NodeJS.Timeout>();
  private escalationTimers = new Map<string, NodeJS.Timeout>();
  
  constructor(
    private redis: RedisService,
    private notifications: NotificationService,
    private metrics: MetricsService
  ) {
    super();
    this.setupEventHandlers();
    this.loadAlertRules();
    this.startPeriodicTasks();
  }

  private setupEventHandlers(): void {
    // Handle incoming alerts from Prometheus
    this.on('prometheus-alert', this.handlePrometheusAlert.bind(this));
    
    // Handle custom application alerts
    this.on('custom-alert', this.handleCustomAlert.bind(this));
    
    // Handle alert state changes
    this.on('alert-state-change', this.handleAlertStateChange.bind(this));
  }

  private async loadAlertRules(): Promise<void> {
    try {
      // Load rules from configuration
      const rules = await this.redis.get('alert:rules') || '[]';
      const alertRules: AlertRule[] = JSON.parse(rules);
      
      alertRules.forEach(rule => {
        this.rules.set(rule.id, rule);
      });

      logger.info(`Loaded ${alertRules.length} alert rules`, {
        service: 'AlertManager',
        operation: 'loadAlertRules'
      });
    } catch (error) {
      logger.error('Failed to load alert rules', {
        error,
        service: 'AlertManager',
        operation: 'loadAlertRules'
      });
    }
  }

  public async addAlertRule(rule: AlertRule): Promise<void> {
    this.rules.set(rule.id, rule);
    
    // Persist to Redis
    const allRules = Array.from(this.rules.values());
    await this.redis.set('alert:rules', JSON.stringify(allRules));
    
    logger.info('Alert rule added', {
      ruleId: rule.id,
      ruleName: rule.name,
      service: 'AlertManager'
    });
  }

  public async removeAlertRule(ruleId: string): Promise<void> {
    if (this.rules.delete(ruleId)) {
      // Update persisted rules
      const allRules = Array.from(this.rules.values());
      await this.redis.set('alert:rules', JSON.stringify(allRules));
      
      logger.info('Alert rule removed', {
        ruleId,
        service: 'AlertManager'
      });
    }
  }

  private async handlePrometheusAlert(alertData: any): Promise<void> {
    try {
      const alert: Alert = {
        id: alertData.fingerprint || this.generateAlertId(alertData),
        name: alertData.alertname,
        severity: alertData.severity || 'warning',
        status: alertData.status || 'firing',
        description: alertData.annotations?.description || alertData.summary || '',
        labels: alertData.labels || {},
        annotations: alertData.annotations || {},
        startsAt: new Date(alertData.startsAt),
        endsAt: alertData.endsAt ? new Date(alertData.endsAt) : undefined,
        generatorURL: alertData.generatorURL,
        fingerprint: alertData.fingerprint || this.generateFingerprint(alertData)
      };

      await this.processAlert(alert);
    } catch (error) {
      logger.error('Failed to handle Prometheus alert', {
        error,
        alertData,
        service: 'AlertManager'
      });
    }
  }

  private async handleCustomAlert(alertData: Partial<Alert>): Promise<void> {
    try {
      const alert: Alert = {
        id: alertData.id || this.generateAlertId(alertData),
        name: alertData.name || 'Custom Alert',
        severity: alertData.severity || 'warning',
        status: alertData.status || 'firing',
        description: alertData.description || '',
        labels: alertData.labels || {},
        annotations: alertData.annotations || {},
        startsAt: alertData.startsAt || new Date(),
        endsAt: alertData.endsAt,
        fingerprint: alertData.fingerprint || this.generateFingerprint(alertData)
      };

      await this.processAlert(alert);
    } catch (error) {
      logger.error('Failed to handle custom alert', {
        error,
        alertData,
        service: 'AlertManager'
      });
    }
  }

  private async processAlert(alert: Alert): Promise<void> {
    // Check if alert should be silenced
    if (this.isAlertSilenced(alert)) {
      logger.info('Alert silenced', {
        alertId: alert.id,
        alertName: alert.name
      });
      return;
    }

    // Apply noise reduction
    if (await this.shouldSuppressAlert(alert)) {
      logger.debug('Alert suppressed by noise reduction', {
        alertId: alert.id,
        alertName: alert.name
      });
      return;
    }

    // Update alert state
    const existingAlert = this.activeAlerts.get(alert.id);
    const isNewAlert = !existingAlert;
    const isResolved = alert.status === 'resolved';

    if (isResolved && existingAlert) {
      // Mark alert as resolved
      existingAlert.status = 'resolved';
      existingAlert.endsAt = new Date();
      this.activeAlerts.delete(alert.id);
      
      // Cancel any pending escalations
      this.cancelEscalation(alert.id);
      
      this.emit('alert-state-change', {
        alert: existingAlert,
        previousState: 'firing',
        newState: 'resolved'
      });
    } else if (!isResolved) {
      // Add or update active alert
      this.activeAlerts.set(alert.id, alert);
      
      if (isNewAlert) {
        this.emit('alert-state-change', {
          alert,
          previousState: null,
          newState: 'firing'
        });
        
        // Start escalation if configured
        await this.startEscalation(alert);
      }
    }

    // Record metrics
    this.metrics.recordAlert(alert, isNewAlert, isResolved);
    
    // Add to history
    this.addToHistory(alert);
    
    // Persist state
    await this.persistAlertState();
  }

  private async shouldSuppressAlert(alert: Alert): Promise<boolean> {
    // Rate limiting: suppress if too many similar alerts in short time
    const rateLimitKey = `rate_limit:${alert.name}:${JSON.stringify(alert.labels)}`;
    const recentCount = await this.redis.get(rateLimitKey);
    
    if (recentCount && parseInt(recentCount) > 10) {
      return true;
    }
    
    // Increment counter with 5-minute expiry
    await this.redis.setex(rateLimitKey, 300, (parseInt(recentCount || '0') + 1).toString());
    
    // Dependency-based suppression: suppress child alerts if parent is firing
    if (await this.hasParentAlert(alert)) {
      return true;
    }
    
    // Time-based suppression: suppress during maintenance windows
    if (await this.isInMaintenanceWindow(alert)) {
      return true;
    }
    
    // Flapping detection: suppress if alert is flapping
    if (await this.isAlertFlapping(alert)) {
      return true;
    }
    
    return false;
  }

  private async hasParentAlert(alert: Alert): Promise<boolean> {
    // Define parent-child relationships
    const dependencies: Record<string, string[]> = {
      'ServiceDown': ['HighLatency', 'HighErrorRate'],
      'DatabaseDown': ['SlowQueries', 'ConnectionErrors'],
      'RedisDown': ['CacheErrors', 'SessionErrors']
    };
    
    const parentAlerts = dependencies[alert.name];
    if (!parentAlerts) return false;
    
    // Check if any parent alert is currently firing
    for (const [, activeAlert] of this.activeAlerts) {
      if (parentAlerts.includes(activeAlert.name) && activeAlert.status === 'firing') {
        // Additional check: ensure it's the same service/instance
        if (this.alertsAreRelated(alert, activeAlert)) {
          return true;
        }
      }
    }
    
    return false;
  }

  private alertsAreRelated(alert1: Alert, alert2: Alert): boolean {
    // Check if alerts are from the same service/instance
    const commonLabels = ['service', 'instance', 'job'];
    
    return commonLabels.some(label => 
      alert1.labels[label] && 
      alert2.labels[label] && 
      alert1.labels[label] === alert2.labels[label]
    );
  }

  private async isInMaintenanceWindow(alert: Alert): Promise<boolean> {
    // Check maintenance windows from configuration
    const maintenanceWindows = await this.redis.get('maintenance:windows');
    if (!maintenanceWindows) return false;
    
    const windows = JSON.parse(maintenanceWindows);
    const now = new Date();
    
    return windows.some((window: any) => {
      const start = new Date(window.start);
      const end = new Date(window.end);
      
      // Check if current time is within maintenance window
      if (now >= start && now <= end) {
        // Check if alert matches maintenance scope
        return this.alertMatchesScope(alert, window.scope);
      }
      
      return false;
    });
  }

  private alertMatchesScope(alert: Alert, scope: any): boolean {
    if (!scope) return true; // No scope means all alerts
    
    // Check service scope
    if (scope.services && scope.services.length > 0) {
      const alertService = alert.labels.service || alert.labels.job;
      if (!scope.services.includes(alertService)) {
        return false;
      }
    }
    
    // Check severity scope
    if (scope.severities && scope.severities.length > 0) {
      if (!scope.severities.includes(alert.severity)) {
        return false;
      }
    }
    
    return true;
  }

  private async isAlertFlapping(alert: Alert): Promise<boolean> {
    const flappingKey = `flapping:${alert.id}`;
    const history = await this.redis.get(flappingKey);
    
    if (!history) return false;
    
    const events = JSON.parse(history);
    const recentEvents = events.filter((event: any) => 
      Date.now() - new Date(event.timestamp).getTime() < 600000 // 10 minutes
    );
    
    // Consider flapping if more than 5 state changes in 10 minutes
    return recentEvents.length > 5;
  }

  private async startEscalation(alert: Alert): Promise<void> {
    const rule = this.rules.get(alert.name);
    if (!rule?.escalationPolicy) return;
    
    const policy = rule.escalationPolicy;
    this.scheduleEscalationSteps(alert, policy);
  }

  private scheduleEscalationSteps(alert: Alert, policy: EscalationPolicy): void {
    policy.steps.forEach((step, index) => {
      const delay = this.parseTimeString(step.delay);
      
      const timer = setTimeout(async () => {
        // Check if alert is still firing
        if (this.activeAlerts.has(alert.id)) {
          await this.executeEscalationStep(alert, step, index);
        }
      }, delay);
      
      // Store timer for potential cancellation
      const timerKey = `${alert.id}:escalation:${index}`;
      this.escalationTimers.set(timerKey, timer);
    });
  }

  private async executeEscalationStep(
    alert: Alert, 
    step: EscalationStep, 
    stepIndex: number
  ): Promise<void> {
    try {
      logger.info('Executing escalation step', {
        alertId: alert.id,
        stepIndex,
        channels: step.channels.map(c => c.type)
      });
      
      // Check if step condition is met (if specified)
      if (step.condition && !await this.evaluateCondition(alert, step.condition)) {
        logger.debug('Escalation step condition not met', {
          alertId: alert.id,
          stepIndex,
          condition: step.condition
        });
        return;
      }
      
      // Send notifications through specified channels
      await Promise.all(
        step.channels.map(channel => 
          this.notifications.sendAlert(alert, channel, stepIndex)
        )
      );
      
      // Record escalation metrics
      this.metrics.recordEscalation(alert, stepIndex);
      
    } catch (error) {
      logger.error('Failed to execute escalation step', {
        error,
        alertId: alert.id,
        stepIndex
      });
    }
  }

  private async evaluateCondition(alert: Alert, condition: string): Promise<boolean> {
    // Simple condition evaluation - can be extended for complex logic
    // Example conditions: "severity=critical", "duration>10m", "ack_count=0"
    
    const [key, operator, value] = condition.split(/([=><!]+)/);
    
    switch (key.trim()) {
      case 'severity':
        return this.compareSeverity(alert.severity, operator, value.trim());
      case 'duration':
        const duration = Date.now() - alert.startsAt.getTime();
        const targetDuration = this.parseTimeString(value.trim());
        return this.compareNumber(duration, operator, targetDuration);
      case 'ack_count':
        const ackCount = alert.annotations.ack_count || '0';
        return this.compareNumber(parseInt(ackCount), operator, parseInt(value.trim()));
      default:
        return true;
    }
  }

  private compareSeverity(alertSeverity: string, operator: string, targetSeverity: string): boolean {
    const severityLevels = { info: 1, warning: 2, critical: 3 };
    const alertLevel = severityLevels[alertSeverity as keyof typeof severityLevels] || 1;
    const targetLevel = severityLevels[targetSeverity as keyof typeof severityLevels] || 1;
    
    switch (operator) {
      case '=': return alertLevel === targetLevel;
      case '>': return alertLevel > targetLevel;
      case '<': return alertLevel < targetLevel;
      case '>=': return alertLevel >= targetLevel;
      case '<=': return alertLevel <= targetLevel;
      default: return false;
    }
  }

  private compareNumber(actual: number, operator: string, target: number): boolean {
    switch (operator) {
      case '=': return actual === target;
      case '>': return actual > target;
      case '<': return actual < target;
      case '>=': return actual >= target;
      case '<=': return actual <= target;
      default: return false;
    }
  }

  private cancelEscalation(alertId: string): void {
    // Find and cancel all timers for this alert
    for (const [timerKey, timer] of this.escalationTimers) {
      if (timerKey.startsWith(`${alertId}:escalation:`)) {
        clearTimeout(timer);
        this.escalationTimers.delete(timerKey);
      }
    }
  }

  private async handleAlertStateChange(event: {
    alert: Alert;
    previousState: string | null;
    newState: string;
  }): Promise<void> {
    const { alert, previousState, newState } = event;
    
    logger.info('Alert state changed', {
      alertId: alert.id,
      alertName: alert.name,
      previousState,
      newState,
      severity: alert.severity
    });
    
    // Record state change for flapping detection
    await this.recordStateChange(alert, newState);
    
    // Send immediate notifications for new critical alerts
    if (newState === 'firing' && alert.severity === 'critical' && !previousState) {
      await this.sendImmediateNotification(alert);
    }
    
    // Handle resolved alerts
    if (newState === 'resolved') {
      await this.handleResolvedAlert(alert);
    }
  }

  private async recordStateChange(alert: Alert, newState: string): Promise<void> {
    const flappingKey = `flapping:${alert.id}`;
    const history = await this.redis.get(flappingKey) || '[]';
    const events = JSON.parse(history);
    
    events.push({
      state: newState,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 20 events
    const recentEvents = events.slice(-20);
    
    await this.redis.setex(flappingKey, 3600, JSON.stringify(recentEvents)); // 1 hour TTL
  }

  private async sendImmediateNotification(alert: Alert): Promise<void> {
    // Get default notification channels for critical alerts
    const channels = config.notifications.defaultChannels;
    
    await Promise.all(
      channels.map(async channelType => {
        try {
          const channel: NotificationChannel = {
            id: `default-${channelType}`,
            type: channelType as any,
            name: `Default ${channelType}`,
            config: {},
            enabled: true
          };
          
          await this.notifications.sendAlert(alert, channel, 0);
        } catch (error) {
          logger.error('Failed to send immediate notification', {
            error,
            alertId: alert.id,
            channelType
          });
        }
      })
    );
  }

  private async handleResolvedAlert(alert: Alert): Promise<void> {
    // Send resolution notification
    const channels = config.notifications.defaultChannels;
    
    await Promise.all(
      channels.map(async channelType => {
        try {
          const channel: NotificationChannel = {
            id: `default-${channelType}`,
            type: channelType as any,
            name: `Default ${channelType}`,
            config: {},
            enabled: true
          };
          
          await this.notifications.sendResolutionNotification(alert, channel);
        } catch (error) {
          logger.error('Failed to send resolution notification', {
            error,
            alertId: alert.id,
            channelType
          });
        }
      })
    );
    
    // Clean up flapping history after some time
    setTimeout(async () => {
      await this.redis.del(`flapping:${alert.id}`);
    }, 3600000); // 1 hour
  }

  // Utility methods
  private generateAlertId(alertData: any): string {
    return `${alertData.alertname || 'custom'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFingerprint(alertData: any): string {
    const key = JSON.stringify({
      name: alertData.alertname || alertData.name,
      labels: alertData.labels || {}
    });
    
    // Simple hash function - in production, use crypto.createHash
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(16);
  }

  private parseTimeString(timeStr: string): number {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };
    
    return value * (multipliers[unit as keyof typeof multipliers] || 1000);
  }

  private isAlertSilenced(alert: Alert): boolean {
    return this.silencedAlerts.has(alert.id) || this.silencedAlerts.has(alert.fingerprint);
  }

  private addToHistory(alert: Alert): void {
    this.alertHistory.unshift(alert);
    
    // Keep only last 1000 alerts in memory
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(0, 1000);
    }
  }

  private async persistAlertState(): Promise<void> {
    try {
      const state = {
        activeAlerts: Array.from(this.activeAlerts.entries()),
        timestamp: new Date().toISOString()
      };
      
      await this.redis.setex('alert:state', 3600, JSON.stringify(state)); // 1 hour TTL
    } catch (error) {
      logger.error('Failed to persist alert state', {
        error,
        service: 'AlertManager'
      });
    }
  }

  private startPeriodicTasks(): void {
    // Cleanup resolved alerts from memory every 5 minutes
    setInterval(() => {
      this.cleanupResolvedAlerts();
    }, 5 * 60 * 1000);
    
    // Persist state every minute
    setInterval(() => {
      this.persistAlertState();
    }, 60 * 1000);
  }

  private cleanupResolvedAlerts(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    this.alertHistory = this.alertHistory.filter(alert => 
      alert.startsAt.getTime() > cutoffTime
    );
  }

  // Public API methods
  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  public getAlertHistory(limit = 100): Alert[] {
    return this.alertHistory.slice(0, limit);
  }

  public async silenceAlert(alertId: string, duration: number): Promise<void> {
    this.silencedAlerts.add(alertId);
    
    // Auto-remove silence after duration
    setTimeout(() => {
      this.silencedAlerts.delete(alertId);
    }, duration);
    
    logger.info('Alert silenced', {
      alertId,
      duration: `${duration / 1000}s`
    });
  }

  public async acknowledgeAlert(alertId: string, user: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.annotations.acknowledged = 'true';
      alert.annotations.acknowledged_by = user;
      alert.annotations.acknowledged_at = new Date().toISOString();
      
      // Cancel escalation for acknowledged alerts
      this.cancelEscalation(alertId);
      
      logger.info('Alert acknowledged', {
        alertId,
        user
      });
    }
  }
}