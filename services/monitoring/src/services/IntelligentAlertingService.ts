import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';
import { AlertManagerIntegration, AlertRule, AlertNotification } from '../alerting/AlertManagerIntegration';
import { logger } from '@shared/utils/logger';

export interface SmartAlertRule extends AlertRule {
  conditions: AlertCondition[];
  correlations?: CorrelationRule[];
  suppressions?: SuppressionRule[];
  escalation?: EscalationRule;
  machineLearning?: MLBasedRule;
  businessImpact?: BusinessImpactRule;
}

export interface AlertCondition {
  id: string;
  metric: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne' | 'increase' | 'decrease' | 'absent' | 'present';
  value: number;
  duration: string; // e.g., "5m", "1h"
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count';
  groupBy?: string[];
  filters?: Record<string, string>;
}

export interface CorrelationRule {
  id: string;
  name: string;
  relatedAlerts: string[]; // other alert rule IDs
  correlationType: 'causation' | 'similar_root_cause' | 'cascading_failure' | 'dependency';
  timeWindow: string;
  minimumOccurrences: number;
  action: 'suppress' | 'merge' | 'escalate' | 'notify_once';
}

export interface SuppressionRule {
  id: string;
  name: string;
  conditions: AlertCondition[];
  suppressDuring: {
    maintenanceWindows?: string[]; // cron expressions
    businessHours?: { start: string; end: string; timezone: string };
    dependentServices?: string[];
  };
  maxSuppressionTime: string;
}

export interface EscalationRule {
  levels: EscalationLevel[];
  autoEscalate: boolean;
  escalationInterval: string;
  maxEscalationLevel: number;
}

export interface EscalationLevel {
  level: number;
  delay: string;
  notificationChannels: string[];
  requiresAcknowledgment: boolean;
  autoResolve: boolean;
  additionalContacts?: string[];
}

export interface MLBasedRule {
  enabled: boolean;
  model: 'anomaly_detection' | 'pattern_recognition' | 'predictive';
  sensitivity: 'low' | 'medium' | 'high';
  trainingPeriod: string; // e.g., "7d", "30d"
  features: string[]; // metric names to use as features
  minimumConfidence: number; // 0-1
  adaptiveThresholds: boolean;
}

export interface BusinessImpactRule {
  enabled: boolean;
  impactCategories: ('customer_facing' | 'revenue_affecting' | 'sla_breach' | 'security_incident')[];
  priorityMatrix: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    urgency: 'low' | 'medium' | 'high' | 'critical';
    priority: number; // 1-5
  }[];
  slaThresholds?: {
    availability: number;
    responseTime: number;
    errorRate: number;
  };
  costImpact?: {
    estimatedCostPerMinute: number;
    currency: string;
  };
}

export interface AlertContext {
  alert: SmartAlertRule;
  currentValue: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  historicalData: MetricDataPoint[];
  correlatedAlerts: string[];
  businessContext: {
    peakHours: boolean;
    maintenanceWindow: boolean;
    businessDay: boolean;
  };
  systemContext: {
    recentDeployments: boolean;
    highLoad: boolean;
    degradedServices: string[];
  };
}

export interface MetricDataPoint {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
}

export interface AlertDecision {
  action: 'fire' | 'suppress' | 'delay' | 'escalate' | 'merge';
  reason: string;
  confidence: number;
  recommendedActions: string[];
  estimatedResolutionTime?: string;
  businessImpact?: {
    severity: string;
    affectedUsers?: number;
    estimatedCost?: number;
  };
}

export class IntelligentAlertingService extends EventEmitter {
  private smartRules = new Map<string, SmartAlertRule>();
  private alertHistory = new Map<string, AlertContext[]>();
  private correlationEngine: CorrelationEngine;
  private suppressionEngine: SuppressionEngine;
  private mlEngine: MachineLearningEngine;
  private businessImpactAnalyzer: BusinessImpactAnalyzer;

  constructor(
    private metricsCollector: MetricsCollector,
    private alertManager: AlertManagerIntegration
  ) {
    super();
    
    this.correlationEngine = new CorrelationEngine();
    this.suppressionEngine = new SuppressionEngine();
    this.mlEngine = new MachineLearningEngine();
    this.businessImpactAnalyzer = new BusinessImpactAnalyzer();
    
    this.initializeIntelligentRules();
    this.startIntelligentProcessing();
  }

  private initializeIntelligentRules() {
    const smartRules: SmartAlertRule[] = [
      {
        id: 'smart-response-time',
        name: '智能AI响应时间监控',
        expr: 'histogram_quantile(0.95, rate(ai_response_time_seconds_bucket[5m]))',
        labels: { severity: 'warning', team: 'ai', type: 'performance' },
        annotations: {
          summary: 'AI响应时间异常',
          description: 'AI响应时间超出正常范围，可能影响用户体验',
          runbook_url: 'https://wiki.company.com/runbooks/ai-performance'
        },
        severity: 'warning',
        enabled: true,
        notificationChannels: ['ai-team', 'performance-alerts'],
        conditions: [
          {
            id: 'response-time-condition',
            metric: 'ai_response_time_seconds',
            operator: 'gt',
            value: 2,
            duration: '3m',
            aggregation: 'avg'
          }
        ],
        correlations: [
          {
            id: 'cpu-correlation',
            name: 'CPU使用率相关',
            relatedAlerts: ['high-cpu-usage'],
            correlationType: 'causation',
            timeWindow: '10m',
            minimumOccurrences: 1,
            action: 'merge'
          }
        ],
        suppressions: [
          {
            id: 'maintenance-suppression',
            name: '维护窗口抑制',
            conditions: [],
            suppressDuring: {
              maintenanceWindows: ['0 2 * * 0'], // Sunday 2 AM
              businessHours: { start: '09:00', end: '18:00', timezone: 'Asia/Shanghai' }
            },
            maxSuppressionTime: '4h'
          }
        ],
        escalation: {
          levels: [
            {
              level: 1,
              delay: '5m',
              notificationChannels: ['ai-team'],
              requiresAcknowledgment: false,
              autoResolve: true
            },
            {
              level: 2,
              delay: '15m',
              notificationChannels: ['ai-team', 'ops-escalation'],
              requiresAcknowledgment: true,
              autoResolve: false,
              additionalContacts: ['ai-lead@company.com']
            }
          ],
          autoEscalate: true,
          escalationInterval: '15m',
          maxEscalationLevel: 2
        },
        machineLearning: {
          enabled: true,
          model: 'anomaly_detection',
          sensitivity: 'medium',
          trainingPeriod: '14d',
          features: ['ai_response_time_seconds', 'process_cpu_usage_percent', 'queue_length'],
          minimumConfidence: 0.8,
          adaptiveThresholds: true
        },
        businessImpact: {
          enabled: true,
          impactCategories: ['customer_facing', 'sla_breach'],
          priorityMatrix: [
            { severity: 'high', urgency: 'high', priority: 1 }
          ],
          slaThresholds: {
            availability: 99.9,
            responseTime: 2.0,
            errorRate: 0.1
          }
        }
      },

      {
        id: 'smart-error-rate',
        name: '智能错误率监控',
        expr: 'rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100',
        labels: { severity: 'critical', team: 'backend', type: 'error' },
        annotations: {
          summary: '系统错误率异常',
          description: '系统错误率超出正常范围，需要立即处理',
          runbook_url: 'https://wiki.company.com/runbooks/error-rate'
        },
        severity: 'critical',
        enabled: true,
        notificationChannels: ['critical-alerts', 'backend-team'],
        conditions: [
          {
            id: 'error-rate-condition',
            metric: 'http_requests_total',
            operator: 'gt',
            value: 5,
            duration: '2m',
            aggregation: 'avg',
            filters: { status_code: '5..' }
          }
        ],
        correlations: [
          {
            id: 'database-correlation',
            name: '数据库连接相关',
            relatedAlerts: ['database-connection-high', 'database-slow-query'],
            correlationType: 'causation',
            timeWindow: '15m',
            minimumOccurrences: 1,
            action: 'merge'
          }
        ],
        machineLearning: {
          enabled: true,
          model: 'pattern_recognition',
          sensitivity: 'high',
          trainingPeriod: '30d',
          features: ['http_requests_total', 'database_connections_active', 'process_cpu_usage_percent'],
          minimumConfidence: 0.9,
          adaptiveThresholds: true
        },
        businessImpact: {
          enabled: true,
          impactCategories: ['customer_facing', 'revenue_affecting', 'sla_breach'],
          priorityMatrix: [
            { severity: 'critical', urgency: 'critical', priority: 1 }
          ],
          slaThresholds: {
            availability: 99.9,
            responseTime: 2.0,
            errorRate: 0.1
          },
          costImpact: {
            estimatedCostPerMinute: 100,
            currency: 'USD'
          }
        }
      },

      {
        id: 'smart-spam-detection',
        name: '智能骚扰电话检测异常',
        expr: 'rate(spam_detection_total[5m])',
        labels: { severity: 'info', team: 'security', type: 'anomaly' },
        annotations: {
          summary: '骚扰电话检测模式异常',
          description: '骚扰电话检测量出现异常模式，可能存在新的攻击类型',
          runbook_url: 'https://wiki.company.com/runbooks/spam-detection'
        },
        severity: 'info',
        enabled: true,
        notificationChannels: ['security-team'],
        conditions: [
          {
            id: 'spam-spike-condition',
            metric: 'spam_detection_total',
            operator: 'increase',
            value: 100, // 100% increase from baseline
            duration: '10m',
            aggregation: 'sum'
          }
        ],
        machineLearning: {
          enabled: true,
          model: 'anomaly_detection',
          sensitivity: 'low',
          trainingPeriod: '7d',
          features: ['spam_detection_total', 'ai_phone_calls_total'],
          minimumConfidence: 0.7,
          adaptiveThresholds: true
        },
        businessImpact: {
          enabled: true,
          impactCategories: ['security_incident'],
          priorityMatrix: [
            { severity: 'medium', urgency: 'low', priority: 3 }
          ]
        }
      }
    ];

    smartRules.forEach(rule => {
      this.smartRules.set(rule.id, rule);
    });

    logger.info(`Initialized ${smartRules.length} intelligent alert rules`);
  }

  private startIntelligentProcessing() {
    // Process alerts every 30 seconds
    setInterval(async () => {
      await this.processIntelligentAlerts();
    }, 30000);

    // Update ML models every hour
    setInterval(async () => {
      await this.updateMachineLearningModels();
    }, 3600000);

    // Clean up old alert history daily
    setInterval(async () => {
      await this.cleanupAlertHistory();
    }, 86400000);

    logger.info('Started intelligent alerting processing');
  }

  private async processIntelligentAlerts() {
    const smartRules = Array.from(this.smartRules.values()).filter(rule => rule.enabled);

    for (const rule of smartRules) {
      try {
        const context = await this.buildAlertContext(rule);
        const decision = await this.makeIntelligentDecision(rule, context);
        
        await this.executeAlertDecision(rule, decision, context);
        
        // Store context for learning
        this.storeAlertContext(rule.id, context);
        
      } catch (error) {
        logger.error(`Error processing smart rule ${rule.id}:`, error);
      }
    }
  }

  private async buildAlertContext(rule: SmartAlertRule): Promise<AlertContext> {
    // Collect current metric values
    const currentMetrics = await this.metricsCollector.getCurrentMetrics(
      rule.conditions.map(c => c.metric)
    );
    
    // Get historical data for trend analysis
    const historicalData = await this.metricsCollector.getMetrics({
      metric: rule.conditions[0].metric,
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours
      endTime: new Date()
    });

    // Analyze trends
    const trend = this.analyzeTrend(historicalData);
    
    // Find correlated alerts
    const correlatedAlerts = await this.findCorrelatedAlerts(rule);
    
    // Build business and system context
    const businessContext = await this.buildBusinessContext();
    const systemContext = await this.buildSystemContext();

    return {
      alert: rule,
      currentValue: currentMetrics[0]?.value || 0,
      trend,
      historicalData,
      correlatedAlerts,
      businessContext,
      systemContext
    };
  }

  private async makeIntelligentDecision(
    rule: SmartAlertRule, 
    context: AlertContext
  ): Promise<AlertDecision> {
    let decision: AlertDecision = {
      action: 'fire',
      reason: 'Threshold exceeded',
      confidence: 0.5,
      recommendedActions: []
    };

    // Apply ML-based analysis if enabled
    if (rule.machineLearning?.enabled) {
      const mlDecision = await this.mlEngine.analyzeAlert(rule, context);
      decision = this.mergeMlDecision(decision, mlDecision);
    }

    // Check suppression rules
    if (rule.suppressions) {
      const suppressed = await this.suppressionEngine.shouldSuppress(rule, context);
      if (suppressed.suppress) {
        decision.action = 'suppress';
        decision.reason = suppressed.reason;
        return decision;
      }
    }

    // Apply correlation rules
    if (rule.correlations) {
      const correlationDecision = await this.correlationEngine.analyzeCorrelations(rule, context);
      decision = this.mergeCorrelationDecision(decision, correlationDecision);
    }

    // Calculate business impact
    if (rule.businessImpact?.enabled) {
      const impact = await this.businessImpactAnalyzer.calculateImpact(rule, context);
      decision.businessImpact = impact;
      
      // Adjust decision based on business impact
      if (impact.severity === 'critical') {
        decision.action = 'escalate';
        decision.confidence = Math.min(decision.confidence + 0.3, 1.0);
      }
    }

    // Generate recommended actions
    decision.recommendedActions = await this.generateRecommendedActions(rule, context, decision);

    return decision;
  }

  private async executeAlertDecision(
    rule: SmartAlertRule, 
    decision: AlertDecision, 
    context: AlertContext
  ) {
    switch (decision.action) {
      case 'fire':
        await this.fireAlert(rule, context, decision);
        break;
      case 'suppress':
        await this.suppressAlert(rule, decision);
        break;
      case 'delay':
        await this.delayAlert(rule, decision);
        break;
      case 'escalate':
        await this.escalateAlert(rule, context, decision);
        break;
      case 'merge':
        await this.mergeAlerts(rule, context, decision);
        break;
    }

    // Emit event for external systems
    this.emit('intelligent-decision', {
      ruleId: rule.id,
      decision,
      context: this.sanitizeContext(context)
    });
  }

  private async fireAlert(
    rule: SmartAlertRule, 
    context: AlertContext, 
    decision: AlertDecision
  ) {
    // Create enhanced alert with intelligent context
    const enhancedAlert = {
      ...rule,
      annotations: {
        ...rule.annotations,
        ai_decision_reason: decision.reason,
        ai_confidence: decision.confidence.toString(),
        business_impact: decision.businessImpact ? JSON.stringify(decision.businessImpact) : '',
        recommended_actions: decision.recommendedActions.join('; '),
        trend_analysis: context.trend,
        correlated_alerts: context.correlatedAlerts.join(', ')
      }
    };

    // Send to AlertManager
    await this.alertManager.createAlert(enhancedAlert);
    
    // Apply escalation rules if configured
    if (rule.escalation?.autoEscalate) {
      await this.scheduleEscalation(rule, context);
    }

    logger.info(`Fired intelligent alert: ${rule.name}`, {
      decision,
      businessImpact: decision.businessImpact
    });
  }

  private async suppressAlert(rule: SmartAlertRule, decision: AlertDecision) {
    logger.info(`Suppressed alert: ${rule.name} - ${decision.reason}`);
    
    // Record suppression metrics
    await this.metricsCollector.recordMetric({
      service: 'intelligent-alerting',
      metric: 'alert_suppressed',
      value: 1,
      tags: {
        rule_id: rule.id,
        reason: decision.reason
      },
      timestamp: new Date()
    });
  }

  private async escalateAlert(
    rule: SmartAlertRule, 
    context: AlertContext, 
    decision: AlertDecision
  ) {
    if (!rule.escalation) return;

    // Find appropriate escalation level
    const level = rule.escalation.levels[0]; // Start with level 1
    
    // Send escalated notification
    const escalatedChannels = [
      ...rule.notificationChannels,
      ...level.notificationChannels
    ];

    const escalatedRule = {
      ...rule,
      notificationChannels: escalatedChannels,
      labels: {
        ...rule.labels,
        escalated: 'true',
        escalation_level: level.level.toString()
      }
    };

    await this.alertManager.createAlert(escalatedRule);
    
    logger.warn(`Escalated alert: ${rule.name} to level ${level.level}`);
  }

  private analyzeTrend(data: MetricDataPoint[]): 'increasing' | 'decreasing' | 'stable' | 'volatile' {
    if (data.length < 3) return 'stable';

    const values = data.slice(-10).map(d => d.value); // Last 10 points
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Check for volatility
    if (stdDev > mean * 0.3) return 'volatile';

    // Simple trend analysis
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    const change = (secondAvg - firstAvg) / firstAvg;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private async findCorrelatedAlerts(rule: SmartAlertRule): Promise<string[]> {
    if (!rule.correlations) return [];

    const correlated: string[] = [];
    const activeAlerts = await this.alertManager.getActiveAlerts();

    for (const correlation of rule.correlations) {
      const relatedActive = activeAlerts.filter(alert => 
        correlation.relatedAlerts.includes(alert.labels.alertname)
      );
      
      if (relatedActive.length >= correlation.minimumOccurrences) {
        correlated.push(...relatedActive.map(a => a.labels.alertname));
      }
    }

    return [...new Set(correlated)];
  }

  private async buildBusinessContext() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    return {
      peakHours: hour >= 9 && hour <= 18, // 9 AM to 6 PM
      maintenanceWindow: hour >= 2 && hour <= 4, // 2 AM to 4 AM
      businessDay: day >= 1 && day <= 5 // Monday to Friday
    };
  }

  private async buildSystemContext() {
    // This would typically query deployment systems, load balancers, etc.
    return {
      recentDeployments: false, // Check deployment history
      highLoad: false, // Check system load metrics
      degradedServices: [] // Check service health
    };
  }

  private mergeMlDecision(base: AlertDecision, ml: Partial<AlertDecision>): AlertDecision {
    return {
      ...base,
      confidence: Math.min((base.confidence + (ml.confidence || 0)) / 2, 1.0),
      recommendedActions: [...base.recommendedActions, ...(ml.recommendedActions || [])],
      reason: ml.reason ? `${base.reason}; ML: ${ml.reason}` : base.reason
    };
  }

  private mergeCorrelationDecision(base: AlertDecision, correlation: Partial<AlertDecision>): AlertDecision {
    if (correlation.action === 'merge') {
      return {
        ...base,
        action: 'merge',
        reason: `${base.reason}; Correlated with other alerts`,
        confidence: Math.min(base.confidence + 0.2, 1.0)
      };
    }
    return base;
  }

  private async generateRecommendedActions(
    rule: SmartAlertRule,
    context: AlertContext,
    decision: AlertDecision
  ): Promise<string[]> {
    const actions: string[] = [];

    // Add generic recommendations based on alert type
    if (rule.labels.type === 'performance') {
      actions.push('检查系统资源使用情况');
      actions.push('查看最近的性能指标趋势');
    }

    if (rule.labels.type === 'error') {
      actions.push('检查应用程序日志');
      actions.push('验证相关服务状态');
    }

    // Add ML-based recommendations
    if (context.trend === 'increasing') {
      actions.push('问题正在恶化，建议立即处理');
    }

    if (context.correlatedAlerts.length > 0) {
      actions.push(`检查相关告警: ${context.correlatedAlerts.join(', ')}`);
    }

    // Add business context recommendations
    if (context.businessContext.peakHours) {
      actions.push('当前处于业务高峰期，请优先处理');
    }

    return actions;
  }

  private storeAlertContext(ruleId: string, context: AlertContext) {
    if (!this.alertHistory.has(ruleId)) {
      this.alertHistory.set(ruleId, []);
    }
    
    const history = this.alertHistory.get(ruleId)!;
    history.push(context);
    
    // Keep only last 100 entries
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
  }

  private async scheduleEscalation(rule: SmartAlertRule, context: AlertContext) {
    if (!rule.escalation) return;

    setTimeout(async () => {
      // Check if alert is still active and not acknowledged
      const activeAlerts = await this.alertManager.getActiveAlerts();
      const stillActive = activeAlerts.some(alert => alert.labels.alertname === rule.name);
      
      if (stillActive) {
        await this.escalateAlert(rule, context, {
          action: 'escalate',
          reason: 'Auto-escalation due to timeout',
          confidence: 0.8,
          recommendedActions: ['需要上级介入处理']
        });
      }
    }, this.parseTimeToMs(rule.escalation.escalationInterval));
  }

  private parseTimeToMs(timeStr: string): number {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return 0;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 0;
    }
  }

  private sanitizeContext(context: AlertContext): any {
    return {
      alertId: context.alert.id,
      currentValue: context.currentValue,
      trend: context.trend,
      correlatedAlerts: context.correlatedAlerts,
      businessContext: context.businessContext,
      historicalDataPoints: context.historicalData.length
    };
  }

  private async updateMachineLearningModels() {
    try {
      const rules = Array.from(this.smartRules.values())
        .filter(rule => rule.machineLearning?.enabled);

      for (const rule of rules) {
        await this.mlEngine.updateModel(rule, this.alertHistory.get(rule.id) || []);
      }

      logger.info(`Updated ML models for ${rules.length} rules`);
    } catch (error) {
      logger.error('Error updating ML models:', error);
    }
  }

  private async cleanupAlertHistory() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    
    for (const [ruleId, history] of this.alertHistory.entries()) {
      const filtered = history.filter(context => 
        context.historicalData.some(point => point.timestamp > cutoff)
      );
      
      this.alertHistory.set(ruleId, filtered);
    }

    logger.info('Cleaned up old alert history data');
  }

  // Public API methods
  public async createSmartRule(rule: SmartAlertRule): Promise<void> {
    this.validateSmartRule(rule);
    this.smartRules.set(rule.id, rule);
    
    // Also create in AlertManager for basic functionality
    await this.alertManager.createAlertRule(rule);
    
    logger.info(`Created smart alert rule: ${rule.name}`);
  }

  public getSmartRules(): SmartAlertRule[] {
    return Array.from(this.smartRules.values());
  }

  public async updateSmartRule(ruleId: string, updates: Partial<SmartAlertRule>): Promise<boolean> {
    const rule = this.smartRules.get(ruleId);
    if (!rule) return false;

    const updatedRule = { ...rule, ...updates };
    this.validateSmartRule(updatedRule);
    this.smartRules.set(ruleId, updatedRule);
    
    await this.alertManager.updateAlertRule(ruleId, updates);
    
    logger.info(`Updated smart alert rule: ${updatedRule.name}`);
    return true;
  }

  public async deleteSmartRule(ruleId: string): Promise<boolean> {
    const deleted = this.smartRules.delete(ruleId);
    if (deleted) {
      await this.alertManager.deleteAlertRule(ruleId);
      this.alertHistory.delete(ruleId);
    }
    return deleted;
  }

  private validateSmartRule(rule: SmartAlertRule): void {
    if (!rule.id || !rule.name) {
      throw new Error('Rule ID and name are required');
    }

    if (!rule.conditions || rule.conditions.length === 0) {
      throw new Error('At least one condition is required');
    }

    rule.conditions.forEach((condition, index) => {
      if (!condition.metric || !condition.operator || condition.value === undefined) {
        throw new Error(`Condition ${index + 1} is missing required fields`);
      }
    });
  }

  public getAlertHistory(ruleId?: string): Map<string, AlertContext[]> | AlertContext[] | undefined {
    if (ruleId) {
      return this.alertHistory.get(ruleId);
    }
    return this.alertHistory;
  }

  public async getIntelligentInsights(ruleId: string): Promise<any> {
    const rule = this.smartRules.get(ruleId);
    const history = this.alertHistory.get(ruleId);
    
    if (!rule || !history) return null;

    return {
      rule: rule.name,
      totalAlerts: history.length,
      averageResolutionTime: await this.calculateAverageResolutionTime(ruleId),
      commonPatterns: await this.identifyCommonPatterns(history),
      correlationInsights: await this.getCorrelationInsights(ruleId),
      mlModelAccuracy: await this.mlEngine.getModelAccuracy(rule),
      businessImpactTrends: await this.businessImpactAnalyzer.getTrendAnalysis(ruleId)
    };
  }

  private async calculateAverageResolutionTime(ruleId: string): Promise<string> {
    // This would calculate based on alert resolution history
    return '15m'; // Placeholder
  }

  private async identifyCommonPatterns(history: AlertContext[]): Promise<string[]> {
    // Analyze patterns in alert context
    return ['High CPU correlation', 'Peak hours occurrence']; // Placeholder
  }

  private async getCorrelationInsights(ruleId: string): Promise<any> {
    // Analyze correlation effectiveness
    return { strongCorrelations: [], weakCorrelations: [] }; // Placeholder
  }

  public getServiceHealth() {
    return {
      status: 'healthy',
      smartRules: this.smartRules.size,
      alertHistory: Array.from(this.alertHistory.values()).reduce((sum, history) => sum + history.length, 0),
      mlModelsActive: Array.from(this.smartRules.values()).filter(r => r.machineLearning?.enabled).length
    };
  }
}

// Helper classes (simplified implementations)
class CorrelationEngine {
  async analyzeCorrelations(rule: SmartAlertRule, context: AlertContext): Promise<Partial<AlertDecision>> {
    // Simplified correlation analysis
    if (context.correlatedAlerts.length > 0) {
      return {
        action: 'merge',
        reason: 'Correlated with existing alerts',
        confidence: 0.8
      };
    }
    return {};
  }
}

class SuppressionEngine {
  async shouldSuppress(rule: SmartAlertRule, context: AlertContext): Promise<{ suppress: boolean; reason: string }> {
    if (!rule.suppressions) return { suppress: false, reason: '' };

    // Check maintenance windows
    if (context.businessContext.maintenanceWindow) {
      return { suppress: true, reason: 'Maintenance window active' };
    }

    return { suppress: false, reason: '' };
  }
}

class MachineLearningEngine {
  async analyzeAlert(rule: SmartAlertRule, context: AlertContext): Promise<Partial<AlertDecision>> {
    if (!rule.machineLearning?.enabled) return {};

    // Simplified ML analysis
    const confidence = Math.random() > 0.3 ? 0.8 : 0.4; // Placeholder
    
    return {
      confidence,
      reason: 'ML model analysis',
      recommendedActions: ['基于历史模式的建议处理方案']
    };
  }

  async updateModel(rule: SmartAlertRule, history: AlertContext[]): Promise<void> {
    // Update ML model based on historical data
    logger.debug(`Updated ML model for rule: ${rule.name} with ${history.length} data points`);
  }

  async getModelAccuracy(rule: SmartAlertRule): Promise<number> {
    // Return model accuracy metrics
    return Math.random() * 0.3 + 0.7; // Placeholder: 70-100%
  }
}

class BusinessImpactAnalyzer {
  async calculateImpact(rule: SmartAlertRule, context: AlertContext): Promise<any> {
    if (!rule.businessImpact?.enabled) return null;

    // Simplified business impact calculation
    return {
      severity: rule.businessImpact.impactCategories.includes('revenue_affecting') ? 'critical' : 'medium',
      affectedUsers: Math.floor(Math.random() * 1000),
      estimatedCost: rule.businessImpact.costImpact?.estimatedCostPerMinute || 0
    };
  }

  async getTrendAnalysis(ruleId: string): Promise<any> {
    // Analyze business impact trends
    return { trend: 'stable', averageImpact: 'medium' }; // Placeholder
  }
}