import { EventEmitter } from 'events';
import axios from 'axios';
import { spawn } from 'child_process';
import { Alert, RemediationAction, RemediationStep, AutoscalingConfig } from '../types';
import logger from '../utils/logger';
import { MetricsService } from './metricsService';
import { RedisService } from './redisService';
import config from '../config';

export class AutoRemediationService extends EventEmitter {
  private actions: Map<string, RemediationAction> = new Map();
  private executionHistory: Map<string, { lastExecuted: number; successCount: number; failureCount: number }> = new Map();
  private cooldownTimers = new Map<string, NodeJS.Timeout>();
  private autoscalingConfigs: Map<string, AutoscalingConfig> = new Map();

  constructor(
    private metrics: MetricsService,
    private redis: RedisService
  ) {
    super();
    this.loadRemediationActions();
    this.loadAutoscalingConfigs();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('alert-triggered', this.handleAlert.bind(this));
    this.on('metric-threshold-exceeded', this.handleMetricThreshold.bind(this));
    this.on('service-health-degraded', this.handleServiceHealthDegradation.bind(this));
  }

  private async loadRemediationActions(): Promise<void> {
    try {
      const actionsData = await this.redis.get('remediation:actions') || '[]';
      const actions: RemediationAction[] = JSON.parse(actionsData);

      actions.forEach(action => {
        this.actions.set(action.id, action);
      });

      // Load default remediation actions
      this.setupDefaultActions();

      logger.info(`Loaded ${actions.length} remediation actions`, {
        service: 'AutoRemediationService'
      });
    } catch (error) {
      logger.error('Failed to load remediation actions', {
        error,
        service: 'AutoRemediationService'
      });
    }
  }

  private setupDefaultActions(): void {
    const defaultActions: RemediationAction[] = [
      {
        id: 'restart-service',
        name: 'Restart Service',
        description: 'Restart a failed service',
        trigger: {
          alertName: 'ServiceDown'
        },
        actions: [
          {
            type: 'script',
            config: {
              command: 'kubectl',
              args: ['rollout', 'restart', 'deployment/${service}', '-n', 'ai-ninja'],
              timeout: '2m'
            },
            timeout: '2m',
            retries: 2
          },
          {
            type: 'notification',
            config: {
              message: 'Service ${service} has been restarted automatically',
              channels: ['slack']
            }
          }
        ],
        enabled: config.autoRemediation.enabled,
        cooldownPeriod: '10m'
      },
      {
        id: 'scale-up-on-high-load',
        name: 'Scale Up on High Load',
        description: 'Scale up service replicas when CPU/memory usage is high',
        trigger: {
          metricThreshold: {
            metric: 'cpu_usage_percent',
            operator: '>',
            value: 80
          }
        },
        actions: [
          {
            type: 'scale',
            config: {
              service: '${service}',
              action: 'scale-up',
              replicas: '+2'
            },
            timeout: '3m',
            retries: 1
          },
          {
            type: 'notification',
            config: {
              message: 'Scaled up ${service} by 2 replicas due to high CPU usage',
              channels: ['slack']
            }
          }
        ],
        enabled: config.autoRemediation.enabled,
        cooldownPeriod: '15m'
      },
      {
        id: 'clear-redis-memory',
        name: 'Clear Redis Memory',
        description: 'Clear expired keys when Redis memory usage is high',
        trigger: {
          metricThreshold: {
            metric: 'redis_memory_usage_percent',
            operator: '>',
            value: 85
          }
        },
        actions: [
          {
            type: 'script',
            config: {
              command: 'redis-cli',
              args: ['-h', '${redis_host}', 'FLUSHDB'],
              timeout: '30s'
            },
            timeout: '30s',
            retries: 1
          },
          {
            type: 'notification',
            config: {
              message: 'Redis memory cleared due to high usage',
              channels: ['slack']
            }
          }
        ],
        enabled: config.autoRemediation.enabled,
        cooldownPeriod: '30m'
      },
      {
        id: 'database-connection-cleanup',
        name: 'Database Connection Cleanup',
        description: 'Kill idle database connections when connection pool is full',
        trigger: {
          metricThreshold: {
            metric: 'database_connections_percent',
            operator: '>',
            value: 90
          }
        },
        actions: [
          {
            type: 'script',
            config: {
              command: 'psql',
              args: [
                '-h', '${db_host}',
                '-U', '${db_user}',
                '-d', '${db_name}',
                '-c', 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle\' AND state_change < now() - interval \'10 minutes\';'
              ],
              timeout: '1m'
            },
            timeout: '1m',
            retries: 1
          }
        ],
        enabled: config.autoRemediation.enabled,
        cooldownPeriod: '5m'
      },
      {
        id: 'circuit-breaker-reset',
        name: 'Circuit Breaker Reset',
        description: 'Reset circuit breakers for external services',
        trigger: {
          alertName: 'CircuitBreakerOpen'
        },
        actions: [
          {
            type: 'webhook',
            config: {
              url: 'http://${service}:${port}/admin/circuit-breaker/reset',
              method: 'POST',
              timeout: '10s'
            },
            timeout: '10s',
            retries: 2
          },
          {
            type: 'notification',
            config: {
              message: 'Circuit breaker reset for ${service}',
              channels: ['slack']
            }
          }
        ],
        enabled: config.autoRemediation.enabled,
        cooldownPeriod: '5m'
      }
    ];

    defaultActions.forEach(action => {
      if (!this.actions.has(action.id)) {
        this.actions.set(action.id, action);
      }
    });
  }

  private async loadAutoscalingConfigs(): Promise<void> {
    try {
      const configsData = await this.redis.get('autoscaling:configs') || '[]';
      const configs: AutoscalingConfig[] = JSON.parse(configsData);

      configs.forEach(config => {
        this.autoscalingConfigs.set(config.service, config);
      });

      logger.info(`Loaded ${configs.length} autoscaling configurations`, {
        service: 'AutoRemediationService'
      });
    } catch (error) {
      logger.error('Failed to load autoscaling configurations', {
        error,
        service: 'AutoRemediationService'
      });
    }
  }

  public async handleAlert(alert: Alert): Promise<void> {
    if (!config.autoRemediation.enabled) return;

    try {
      const applicableActions = this.findApplicableActions(alert);
      
      for (const action of applicableActions) {
        if (this.shouldExecuteAction(action, alert)) {
          await this.executeRemediationAction(action, alert);
        }
      }
    } catch (error) {
      logger.error('Failed to handle alert for auto-remediation', {
        error,
        alertId: alert.id,
        alertName: alert.name
      });
    }
  }

  public async handleMetricThreshold(data: {
    metric: string;
    value: number;
    service?: string;
    instance?: string;
    labels?: Record<string, string>;
  }): Promise<void> {
    if (!config.autoRemediation.enabled) return;

    try {
      const applicableActions = this.findActionsForMetric(data);
      
      for (const action of applicableActions) {
        if (this.shouldExecuteAction(action, data)) {
          await this.executeRemediationAction(action, data);
        }
      }

      // Check autoscaling
      if (data.service) {
        await this.checkAutoscaling(data);
      }
    } catch (error) {
      logger.error('Failed to handle metric threshold for auto-remediation', {
        error,
        metric: data.metric,
        value: data.value,
        service: data.service
      });
    }
  }

  private findApplicableActions(alert: Alert): RemediationAction[] {
    const applicableActions: RemediationAction[] = [];

    for (const [, action] of this.actions) {
      if (!action.enabled) continue;

      if (action.trigger.alertName && action.trigger.alertName === alert.name) {
        applicableActions.push(action);
      }
    }

    return applicableActions;
  }

  private findActionsForMetric(data: {
    metric: string;
    value: number;
    service?: string;
  }): RemediationAction[] {
    const applicableActions: RemediationAction[] = [];

    for (const [, action] of this.actions) {
      if (!action.enabled) continue;

      if (action.trigger.metricThreshold) {
        const threshold = action.trigger.metricThreshold;
        if (threshold.metric === data.metric && this.evaluateThreshold(data.value, threshold.operator, threshold.value)) {
          applicableActions.push(action);
        }
      }
    }

    return applicableActions;
  }

  private evaluateThreshold(actual: number, operator: string, target: number): boolean {
    switch (operator) {
      case '>': return actual > target;
      case '<': return actual < target;
      case '>=': return actual >= target;
      case '<=': return actual <= target;
      case '=': return actual === target;
      default: return false;
    }
  }

  private shouldExecuteAction(action: RemediationAction, context: any): boolean {
    const history = this.executionHistory.get(action.id);
    const now = Date.now();
    const cooldown = this.parseTimeString(action.cooldownPeriod);

    // Check cooldown period
    if (history && (now - history.lastExecuted) < cooldown) {
      logger.debug('Action in cooldown period', {
        actionId: action.id,
        lastExecuted: new Date(history.lastExecuted).toISOString(),
        cooldownPeriod: action.cooldownPeriod
      });
      return false;
    }

    // Check failure rate
    if (history && history.failureCount > 5 && history.successCount === 0) {
      logger.warn('Action has too many failures, skipping', {
        actionId: action.id,
        failureCount: history.failureCount
      });
      return false;
    }

    // Check maximum retries per time window
    const maxRetries = config.autoRemediation.maxRetries;
    const recentFailures = history?.failureCount || 0;
    
    if (recentFailures >= maxRetries) {
      logger.warn('Action has reached maximum retries', {
        actionId: action.id,
        failures: recentFailures,
        maxRetries
      });
      return false;
    }

    return true;
  }

  private async executeRemediationAction(action: RemediationAction, context: any): Promise<void> {
    const startTime = Date.now();
    let success = false;

    try {
      logger.info('Executing remediation action', {
        actionId: action.id,
        actionName: action.name,
        context: this.sanitizeContext(context)
      });

      // Execute all steps in sequence
      for (let i = 0; i < action.actions.length; i++) {
        const step = action.actions[i];
        await this.executeRemediationStep(step, context, i);
      }

      success = true;
      this.updateExecutionHistory(action.id, true);

      logger.info('Remediation action completed successfully', {
        actionId: action.id,
        duration: Date.now() - startTime
      });

      // Record metrics
      this.metrics.recordRemediation(action.id, 'success', Date.now() - startTime);

    } catch (error) {
      this.updateExecutionHistory(action.id, false);
      
      logger.error('Remediation action failed', {
        error,
        actionId: action.id,
        duration: Date.now() - startTime
      });

      // Record metrics
      this.metrics.recordRemediation(action.id, 'failure', Date.now() - startTime);

      // Send failure notification
      await this.sendFailureNotification(action, error, context);
    }
  }

  private async executeRemediationStep(
    step: RemediationStep,
    context: any,
    stepIndex: number
  ): Promise<void> {
    const timeout = step.timeout ? this.parseTimeString(step.timeout) : 60000; // Default 1 minute
    const maxRetries = step.retries || 1;

    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        logger.debug('Executing remediation step', {
          stepIndex,
          stepType: step.type,
          retry,
          maxRetries
        });

        await Promise.race([
          this.executeStepByType(step, context),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Step timeout')), timeout)
          )
        ]);

        return; // Success, exit retry loop
      } catch (error) {
        if (retry === maxRetries) {
          throw new Error(`Step failed after ${maxRetries + 1} attempts: ${error}`);
        }
        
        logger.warn('Step failed, retrying', {
          stepIndex,
          stepType: step.type,
          retry,
          error: error instanceof Error ? error.message : error
        });

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }
  }

  private async executeStepByType(step: RemediationStep, context: any): Promise<void> {
    switch (step.type) {
      case 'restart':
        await this.executeRestartStep(step, context);
        break;
      case 'scale':
        await this.executeScaleStep(step, context);
        break;
      case 'webhook':
        await this.executeWebhookStep(step, context);
        break;
      case 'script':
        await this.executeScriptStep(step, context);
        break;
      case 'notification':
        await this.executeNotificationStep(step, context);
        break;
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async executeRestartStep(step: RemediationStep, context: any): Promise<void> {
    const service = this.interpolateValue(step.config.service || context.service || context.labels?.service, context);
    
    if (!service) {
      throw new Error('Service name not provided for restart step');
    }

    // Use kubectl to restart the deployment
    await this.executeCommand('kubectl', [
      'rollout', 'restart', `deployment/${service}`, '-n', 'ai-ninja'
    ]);

    logger.info('Service restarted', { service });
  }

  private async executeScaleStep(step: RemediationStep, context: any): Promise<void> {
    const service = this.interpolateValue(step.config.service, context);
    const action = step.config.action; // 'scale-up', 'scale-down', 'scale-to'
    const replicas = step.config.replicas;

    if (!service) {
      throw new Error('Service name not provided for scale step');
    }

    let targetReplicas: number;

    if (action === 'scale-to') {
      targetReplicas = parseInt(replicas);
    } else {
      // Get current replica count
      const currentReplicas = await this.getCurrentReplicaCount(service);
      
      if (action === 'scale-up') {
        const increment = replicas.startsWith('+') ? parseInt(replicas.slice(1)) : parseInt(replicas);
        targetReplicas = currentReplicas + increment;
      } else if (action === 'scale-down') {
        const decrement = replicas.startsWith('-') ? parseInt(replicas.slice(1)) : parseInt(replicas);
        targetReplicas = Math.max(1, currentReplicas - decrement); // Ensure at least 1 replica
      } else {
        throw new Error(`Unknown scale action: ${action}`);
      }
    }

    // Execute scaling
    await this.executeCommand('kubectl', [
      'scale', `deployment/${service}`, '--replicas', targetReplicas.toString(), '-n', 'ai-ninja'
    ]);

    logger.info('Service scaled', { 
      service, 
      action, 
      targetReplicas 
    });
  }

  private async executeWebhookStep(step: RemediationStep, context: any): Promise<void> {
    const url = this.interpolateValue(step.config.url, context);
    const method = step.config.method || 'POST';
    const headers = step.config.headers || {};
    const payload = step.config.payload || {};

    const response = await axios({
      method: method.toLowerCase(),
      url,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      data: this.interpolateObject(payload, context),
      timeout: this.parseTimeString(step.timeout || '10s')
    });

    if (response.status >= 400) {
      throw new Error(`Webhook returned status ${response.status}: ${response.statusText}`);
    }

    logger.info('Webhook executed', { url, status: response.status });
  }

  private async executeScriptStep(step: RemediationStep, context: any): Promise<void> {
    const command = step.config.command;
    const args = (step.config.args || []).map((arg: string) => this.interpolateValue(arg, context));

    await this.executeCommand(command, args);
    
    logger.info('Script executed', { command, args });
  }

  private async executeNotificationStep(step: RemediationStep, context: any): Promise<void> {
    const message = this.interpolateValue(step.config.message, context);
    const channels = step.config.channels || ['slack'];

    // This would integrate with the notification service
    // For now, just log the notification
    logger.info('Remediation notification', {
      message,
      channels,
      context: this.sanitizeContext(context)
    });

    // Emit event for notification service to handle
    this.emit('send-notification', {
      type: 'remediation',
      message,
      channels,
      context
    });
  }

  private async executeCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async getCurrentReplicaCount(service: string): Promise<number> {
    try {
      const output = await this.executeCommand('kubectl', [
        'get', `deployment/${service}`, '-n', 'ai-ninja', '-o', 'jsonpath={.spec.replicas}'
      ]);
      return parseInt(output.trim()) || 1;
    } catch (error) {
      logger.warn('Failed to get current replica count, assuming 1', {
        service,
        error
      });
      return 1;
    }
  }

  private async checkAutoscaling(data: {
    metric: string;
    value: number;
    service?: string;
    instance?: string;
  }): Promise<void> {
    if (!data.service) return;

    const config = this.autoscalingConfigs.get(data.service);
    if (!config || !config.enabled) return;

    const shouldScale = this.shouldTriggerAutoscaling(data, config);
    
    if (shouldScale.scale) {
      await this.performAutoscaling(data.service, shouldScale.direction, config);
    }
  }

  private shouldTriggerAutoscaling(data: any, config: AutoscalingConfig): { scale: boolean; direction: 'up' | 'down' } {
    // Check CPU threshold
    if (config.metrics.cpu && data.metric === 'cpu_usage_percent') {
      if (data.value > config.metrics.cpu.targetPercentage) {
        return { scale: true, direction: 'up' };
      } else if (data.value < config.metrics.cpu.targetPercentage * 0.5) {
        return { scale: true, direction: 'down' };
      }
    }

    // Check memory threshold
    if (config.metrics.memory && data.metric === 'memory_usage_percent') {
      if (data.value > config.metrics.memory.targetPercentage) {
        return { scale: true, direction: 'up' };
      } else if (data.value < config.metrics.memory.targetPercentage * 0.5) {
        return { scale: true, direction: 'down' };
      }
    }

    // Check request rate threshold
    if (config.metrics.requests && data.metric === 'requests_per_second') {
      if (data.value > config.metrics.requests.targetPerSecond) {
        return { scale: true, direction: 'up' };
      } else if (data.value < config.metrics.requests.targetPerSecond * 0.3) {
        return { scale: true, direction: 'down' };
      }
    }

    return { scale: false, direction: 'up' };
  }

  private async performAutoscaling(service: string, direction: 'up' | 'down', config: AutoscalingConfig): Promise<void> {
    try {
      const currentReplicas = await this.getCurrentReplicaCount(service);
      let targetReplicas: number;

      if (direction === 'up') {
        targetReplicas = Math.min(currentReplicas + 1, config.limits.maxReplicas);
      } else {
        targetReplicas = Math.max(currentReplicas - 1, config.limits.minReplicas);
      }

      if (targetReplicas === currentReplicas) {
        logger.debug('Autoscaling skipped - already at limits', {
          service,
          currentReplicas,
          direction,
          limits: config.limits
        });
        return;
      }

      // Check cooldown
      const cooldownKey = `autoscaling:${service}:${direction}`;
      const lastScaling = await this.redis.get(cooldownKey);
      const cooldown = direction === 'up' ? config.limits.scaleUpCooldown : config.limits.scaleDownCooldown;
      
      if (lastScaling && (Date.now() - parseInt(lastScaling)) < this.parseTimeString(cooldown)) {
        logger.debug('Autoscaling in cooldown period', {
          service,
          direction,
          cooldown
        });
        return;
      }

      // Perform scaling
      await this.executeCommand('kubectl', [
        'scale', `deployment/${service}`, '--replicas', targetReplicas.toString(), '-n', 'ai-ninja'
      ]);

      // Set cooldown
      await this.redis.setex(cooldownKey, Math.floor(this.parseTimeString(cooldown) / 1000), Date.now().toString());

      logger.info('Autoscaling performed', {
        service,
        direction,
        fromReplicas: currentReplicas,
        toReplicas: targetReplicas
      });

      // Record metrics
      this.metrics.recordAutoscaling(service, direction, currentReplicas, targetReplicas);

    } catch (error) {
      logger.error('Autoscaling failed', {
        error,
        service,
        direction
      });
    }
  }

  // Utility methods
  private interpolateValue(template: string | undefined, context: any): string {
    if (!template) return '';
    
    return template.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const keys = key.split('.');
      let value = context;
      
      for (const k of keys) {
        value = value?.[k];
      }
      
      return value?.toString() || match;
    });
  }

  private interpolateObject(obj: any, context: any): any {
    if (typeof obj === 'string') {
      return this.interpolateValue(obj, context);
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateObject(item, context));
    } else if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateObject(value, context);
      }
      return result;
    }
    return obj;
  }

  private parseTimeString(timeStr: string): number {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return 60000; // Default 1 minute
    
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

  private updateExecutionHistory(actionId: string, success: boolean): void {
    const history = this.executionHistory.get(actionId) || {
      lastExecuted: 0,
      successCount: 0,
      failureCount: 0
    };

    history.lastExecuted = Date.now();
    
    if (success) {
      history.successCount++;
      history.failureCount = 0; // Reset failure count on success
    } else {
      history.failureCount++;
    }

    this.executionHistory.set(actionId, history);
  }

  private async sendFailureNotification(action: RemediationAction, error: any, context: any): Promise<void> {
    const message = `Auto-remediation action "${action.name}" failed: ${error instanceof Error ? error.message : error}`;
    
    this.emit('send-notification', {
      type: 'remediation-failure',
      message,
      channels: ['slack', 'email'],
      context: {
        actionId: action.id,
        actionName: action.name,
        error: error instanceof Error ? error.message : error,
        context: this.sanitizeContext(context)
      }
    });
  }

  private sanitizeContext(context: any): any {
    // Remove sensitive information from context before logging
    const sanitized = { ...context };
    
    // Remove common sensitive fields
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.secret;
    delete sanitized.apiKey;
    
    return sanitized;
  }

  // Public API methods
  public async addRemediationAction(action: RemediationAction): Promise<void> {
    this.actions.set(action.id, action);
    
    // Persist to Redis
    const allActions = Array.from(this.actions.values());
    await this.redis.set('remediation:actions', JSON.stringify(allActions));
    
    logger.info('Remediation action added', {
      actionId: action.id,
      actionName: action.name
    });
  }

  public async removeRemediationAction(actionId: string): Promise<void> {
    if (this.actions.delete(actionId)) {
      // Update persisted actions
      const allActions = Array.from(this.actions.values());
      await this.redis.set('remediation:actions', JSON.stringify(allActions));
      
      // Cancel any pending timers
      const timer = this.cooldownTimers.get(actionId);
      if (timer) {
        clearTimeout(timer);
        this.cooldownTimers.delete(actionId);
      }
      
      logger.info('Remediation action removed', { actionId });
    }
  }

  public getRemediationActions(): RemediationAction[] {
    return Array.from(this.actions.values());
  }

  public getExecutionHistory(): Array<{ actionId: string; history: any }> {
    return Array.from(this.executionHistory.entries()).map(([actionId, history]) => ({
      actionId,
      history
    }));
  }

  public async addAutoscalingConfig(config: AutoscalingConfig): Promise<void> {
    this.autoscalingConfigs.set(config.service, config);
    
    // Persist to Redis
    const allConfigs = Array.from(this.autoscalingConfigs.values());
    await this.redis.set('autoscaling:configs', JSON.stringify(allConfigs));
    
    logger.info('Autoscaling configuration added', {
      service: config.service
    });
  }
}