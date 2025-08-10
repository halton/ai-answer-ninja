import { UserRules, EvaluationRequest, EvaluationResult, PhoneFeatures } from '@/types';
import { logger } from '@/utils/logger';
import { mlClassifier } from './feature-extractor';

export interface Rule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  action: RuleAction;
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan' | 'matches' | 'in';
  value: any;
  caseSensitive?: boolean;
}

export interface RuleAction {
  type: 'allow' | 'block' | 'analyze' | 'flag';
  confidence: number;
  reason: string;
  temporary?: boolean;
  duration?: number; // hours
}

export interface RuleEvaluationResult {
  matched: boolean;
  rule?: Rule;
  confidence: number;
  reason: string;
  action: 'allow' | 'block' | 'analyze' | 'flag';
  temporary?: boolean;
  duration?: number;
}

export class RulesEngine {
  private globalRules: Rule[] = [];
  private userRulesCache = new Map<string, Rule[]>();

  constructor() {
    this.initializeGlobalRules();
  }

  /**
   * Evaluate phone number against rules and ML
   */
  async evaluate(request: EvaluationRequest, userRules?: UserRules['rules']): Promise<EvaluationResult> {
    const start = Date.now();

    try {
      // Get applicable rules
      const rules = await this.getApplicableRules(request.userId || '', userRules);
      
      // Evaluate rules in priority order
      const ruleResults = this.evaluateRules(request, rules);
      
      // If any rule matches, use it
      for (const ruleResult of ruleResults) {
        if (ruleResult.matched) {
          return this.buildResultFromRule(request, ruleResult, Date.now() - start);
        }
      }

      // No rules matched, use ML classification
      const mlResult = mlClassifier.classify(request.phone, request.context);
      
      return this.buildResultFromML(request, mlResult, Date.now() - start);
    } catch (error) {
      logger.error('Rules evaluation failed', {
        phone: request.phone.substring(0, 4) + '****',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        phone: request.phone,
        isWhitelisted: false,
        confidenceScore: 0.5,
        riskScore: 0.5,
        classification: 'error',
        recommendation: 'analyze',
        reasons: ['Rule evaluation failed'],
        processingTimeMs: Date.now() - start,
        cacheHit: false,
      };
    }
  }

  /**
   * Add or update a user rule
   */
  addUserRule(userId: string, rule: Rule): void {
    const userRules = this.userRulesCache.get(userId) || [];
    
    // Remove existing rule with same ID
    const filteredRules = userRules.filter(r => r.id !== rule.id);
    
    // Add new/updated rule
    filteredRules.push(rule);
    
    // Sort by priority (higher priority first)
    filteredRules.sort((a, b) => b.priority - a.priority);
    
    this.userRulesCache.set(userId, filteredRules);
    
    logger.info('User rule added/updated', {
      userId,
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
    });
  }

  /**
   * Remove a user rule
   */
  removeUserRule(userId: string, ruleId: string): boolean {
    const userRules = this.userRulesCache.get(userId) || [];
    const initialLength = userRules.length;
    
    const filteredRules = userRules.filter(r => r.id !== ruleId);
    
    if (filteredRules.length < initialLength) {
      this.userRulesCache.set(userId, filteredRules);
      logger.info('User rule removed', { userId, ruleId });
      return true;
    }
    
    return false;
  }

  /**
   * Get all rules for a user
   */
  getUserRules(userId: string): Rule[] {
    return [...(this.userRulesCache.get(userId) || [])];
  }

  /**
   * Create a rule from user preferences
   */
  createRuleFromPreferences(userId: string, preferences: UserRules['rules']): Rule[] {
    const rules: Rule[] = [];

    // Auto-learn threshold rule
    if (preferences.autoLearnThreshold && preferences.autoLearnThreshold > 0) {
      rules.push({
        id: `${userId}-auto-learn`,
        name: 'Auto Learn Threshold',
        description: 'Automatically allow numbers with high confidence',
        enabled: true,
        priority: 100,
        conditions: [
          {
            field: 'mlConfidence',
            operator: 'greaterThan',
            value: preferences.autoLearnThreshold,
          },
          {
            field: 'mlClassification',
            operator: 'equals',
            value: 'legitimate',
          },
        ],
        action: {
          type: 'allow',
          confidence: preferences.autoLearnThreshold,
          reason: 'High confidence legitimate number',
        },
      });
    }

    // Block known spam rule
    if (preferences.blockKnownSpam) {
      rules.push({
        id: `${userId}-block-spam`,
        name: 'Block Known Spam',
        description: 'Automatically block high-confidence spam numbers',
        enabled: true,
        priority: 200,
        conditions: [
          {
            field: 'mlClassification',
            operator: 'contains',
            value: 'spam_',
          },
          {
            field: 'mlConfidence',
            operator: 'greaterThan',
            value: 0.8,
          },
        ],
        action: {
          type: 'block',
          confidence: 0.9,
          reason: 'High confidence spam number',
        },
      });
    }

    // Allowed prefixes
    if (preferences.patterns?.allowedPrefixes?.length) {
      rules.push({
        id: `${userId}-allowed-prefixes`,
        name: 'Allowed Prefixes',
        description: 'Allow numbers with specified prefixes',
        enabled: true,
        priority: 150,
        conditions: [
          {
            field: 'phone',
            operator: 'in',
            value: preferences.patterns.allowedPrefixes,
          },
        ],
        action: {
          type: 'allow',
          confidence: 0.9,
          reason: 'Phone number matches allowed prefix',
        },
      });
    }

    // Blocked prefixes
    if (preferences.patterns?.blockedPrefixes?.length) {
      rules.push({
        id: `${userId}-blocked-prefixes`,
        name: 'Blocked Prefixes',
        description: 'Block numbers with specified prefixes',
        enabled: true,
        priority: 250,
        conditions: [
          {
            field: 'phone',
            operator: 'in',
            value: preferences.patterns.blockedPrefixes,
          },
        ],
        action: {
          type: 'block',
          confidence: 0.95,
          reason: 'Phone number matches blocked prefix',
        },
      });
    }

    // Temporary whitelist rule
    if (preferences.allowTemporary && preferences.maxTemporaryDuration) {
      rules.push({
        id: `${userId}-temp-allow`,
        name: 'Temporary Allow',
        description: 'Temporarily allow unknown numbers for evaluation',
        enabled: true,
        priority: 50,
        conditions: [
          {
            field: 'mlClassification',
            operator: 'equals',
            value: 'unknown',
          },
          {
            field: 'hasUserInteraction',
            operator: 'equals',
            value: true,
          },
        ],
        action: {
          type: 'allow',
          confidence: 0.6,
          reason: 'Temporary allowance for evaluation',
          temporary: true,
          duration: preferences.maxTemporaryDuration,
        },
      });
    }

    return rules;
  }

  // Private helper methods

  private initializeGlobalRules(): void {
    // Common spam patterns
    this.globalRules.push({
      id: 'global-toll-free-spam',
      name: 'Toll-Free Spam Filter',
      description: 'Filter common toll-free spam patterns',
      enabled: true,
      priority: 300,
      conditions: [
        {
          field: 'phone',
          operator: 'matches',
          value: '^1?(800|888|877|866|855|844)',
        },
        {
          field: 'mlSpamIndicators',
          operator: 'greaterThan',
          value: 2,
        },
      ],
      action: {
        type: 'analyze',
        confidence: 0.7,
        reason: 'Toll-free number with spam indicators',
      },
    });

    // Emergency numbers (always allow)
    this.globalRules.push({
      id: 'global-emergency',
      name: 'Emergency Numbers',
      description: 'Always allow emergency numbers',
      enabled: true,
      priority: 1000,
      conditions: [
        {
          field: 'phone',
          operator: 'in',
          value: ['911', '112', '999', '000'], // International emergency numbers
        },
      ],
      action: {
        type: 'allow',
        confidence: 1.0,
        reason: 'Emergency number',
      },
    });

    // Sequential/repeating patterns
    this.globalRules.push({
      id: 'global-suspicious-patterns',
      name: 'Suspicious Number Patterns',
      description: 'Flag numbers with suspicious patterns',
      enabled: true,
      priority: 200,
      conditions: [
        {
          field: 'hasRepeatingDigits',
          operator: 'equals',
          value: true,
        },
        {
          field: 'hasSequentialDigits',
          operator: 'equals',
          value: true,
        },
      ],
      action: {
        type: 'analyze',
        confidence: 0.3,
        reason: 'Number contains suspicious patterns',
      },
    });

    logger.info('Global rules initialized', { count: this.globalRules.length });
  }

  private async getApplicableRules(userId: string, userRules?: UserRules['rules']): Promise<Rule[]> {
    const rules: Rule[] = [];

    // Add global rules
    rules.push(...this.globalRules.filter(r => r.enabled));

    // Add user-specific rules from cache
    const cachedUserRules = this.userRulesCache.get(userId) || [];
    rules.push(...cachedUserRules.filter(r => r.enabled));

    // Add rules generated from user preferences
    if (userRules) {
      const preferenceRules = this.createRuleFromPreferences(userId, userRules);
      rules.push(...preferenceRules);
    }

    // Sort by priority (higher priority first)
    rules.sort((a, b) => b.priority - a.priority);

    return rules;
  }

  private evaluateRules(request: EvaluationRequest, rules: Rule[]): RuleEvaluationResult[] {
    const results: RuleEvaluationResult[] = [];
    
    // Get ML features for rule evaluation
    const mlResult = mlClassifier.classify(request.phone, request.context);
    
    // Create evaluation context
    const context = {
      phone: request.phone,
      userId: request.userId,
      context: request.context,
      mlClassification: mlResult.isSpam ? `spam_${mlResult.spamType}` : 'legitimate',
      mlConfidence: mlResult.confidence,
      mlSpamIndicators: mlResult.features.spamIndicatorCount,
      hasRepeatingDigits: mlResult.features.hasRepeatingDigits,
      hasSequentialDigits: mlResult.features.hasSequentialDigits,
      hasUserInteraction: !!request.context?.userInteraction,
      ...mlResult.features,
    };

    for (const rule of rules) {
      const result = this.evaluateRule(rule, context);
      results.push(result);
      
      // If this rule matched and has high priority, we can stop early
      if (result.matched && rule.priority > 500) {
        break;
      }
    }

    return results;
  }

  private evaluateRule(rule: Rule, context: Record<string, any>): RuleEvaluationResult {
    try {
      // All conditions must be true for the rule to match
      const conditionsMatch = rule.conditions.every(condition => 
        this.evaluateCondition(condition, context)
      );

      if (conditionsMatch) {
        return {
          matched: true,
          rule,
          confidence: rule.action.confidence,
          reason: rule.action.reason,
          action: rule.action.type,
          temporary: rule.action.temporary,
          duration: rule.action.duration,
        };
      }

      return {
        matched: false,
        confidence: 0.5,
        reason: 'Rule conditions not met',
        action: 'analyze',
      };
    } catch (error) {
      logger.error('Rule evaluation failed', {
        ruleId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        matched: false,
        confidence: 0.5,
        reason: 'Rule evaluation error',
        action: 'analyze',
      };
    }
  }

  private evaluateCondition(condition: RuleCondition, context: Record<string, any>): boolean {
    const fieldValue = this.getFieldValue(condition.field, context);
    const conditionValue = condition.value;

    switch (condition.operator) {
      case 'equals':
        return fieldValue === conditionValue;

      case 'contains':
        if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
          const value = condition.caseSensitive ? fieldValue : fieldValue.toLowerCase();
          const target = condition.caseSensitive ? conditionValue : conditionValue.toLowerCase();
          return value.includes(target);
        }
        return false;

      case 'startsWith':
        if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
          const value = condition.caseSensitive ? fieldValue : fieldValue.toLowerCase();
          const target = condition.caseSensitive ? conditionValue : conditionValue.toLowerCase();
          return value.startsWith(target);
        }
        return false;

      case 'endsWith':
        if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
          const value = condition.caseSensitive ? fieldValue : fieldValue.toLowerCase();
          const target = condition.caseSensitive ? conditionValue : conditionValue.toLowerCase();
          return value.endsWith(target);
        }
        return false;

      case 'greaterThan':
        return typeof fieldValue === 'number' && typeof conditionValue === 'number' &&
               fieldValue > conditionValue;

      case 'lessThan':
        return typeof fieldValue === 'number' && typeof conditionValue === 'number' &&
               fieldValue < conditionValue;

      case 'matches':
        if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
          const regex = new RegExp(conditionValue, condition.caseSensitive ? 'g' : 'gi');
          return regex.test(fieldValue);
        }
        return false;

      case 'in':
        if (Array.isArray(conditionValue)) {
          if (typeof fieldValue === 'string') {
            // For phone numbers, check if any prefix matches
            return conditionValue.some(prefix => fieldValue.startsWith(prefix));
          }
          return conditionValue.includes(fieldValue);
        }
        return false;

      default:
        logger.warn('Unknown condition operator', { operator: condition.operator });
        return false;
    }
  }

  private getFieldValue(field: string, context: Record<string, any>): any {
    // Support nested field access with dot notation
    const fieldParts = field.split('.');
    let value = context;

    for (const part of fieldParts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private buildResultFromRule(
    request: EvaluationRequest,
    ruleResult: RuleEvaluationResult,
    processingTime: number
  ): EvaluationResult {
    return {
      phone: request.phone,
      isWhitelisted: ruleResult.action === 'allow',
      confidenceScore: ruleResult.confidence,
      riskScore: 1 - ruleResult.confidence,
      classification: ruleResult.rule ? `rule_${ruleResult.rule.id}` : 'rule_match',
      recommendation: ruleResult.action,
      reasons: [ruleResult.reason],
      processingTimeMs: processingTime,
      cacheHit: false,
    };
  }

  private buildResultFromML(
    request: EvaluationRequest,
    mlResult: any,
    processingTime: number
  ): EvaluationResult {
    return {
      phone: request.phone,
      isWhitelisted: !mlResult.isSpam,
      confidenceScore: mlResult.confidence,
      riskScore: mlResult.isSpam ? mlResult.confidence : 1 - mlResult.confidence,
      classification: mlResult.isSpam ? `spam_${mlResult.spamType}` : 'legitimate',
      recommendation: mlResult.isSpam ? 
        (mlResult.confidence > 0.8 ? 'block' : 'analyze') : 
        (mlResult.confidence > 0.7 ? 'allow' : 'analyze'),
      reasons: [mlResult.reasoning],
      mlFeatures: mlResult.features,
      processingTimeMs: processingTime,
      cacheHit: false,
    };
  }

  /**
   * Get statistics about rule usage
   */
  getRuleStats(): {
    globalRules: number;
    totalUserRules: number;
    enabledRules: number;
    disabledRules: number;
  } {
    let totalUserRules = 0;
    let enabledRules = this.globalRules.filter(r => r.enabled).length;
    let disabledRules = this.globalRules.filter(r => !r.enabled).length;

    for (const rules of this.userRulesCache.values()) {
      totalUserRules += rules.length;
      enabledRules += rules.filter(r => r.enabled).length;
      disabledRules += rules.filter(r => !r.enabled).length;
    }

    return {
      globalRules: this.globalRules.length,
      totalUserRules,
      enabledRules,
      disabledRules,
    };
  }

  /**
   * Export rules for backup or migration
   */
  exportRules(userId?: string): Record<string, any> {
    if (userId) {
      return {
        userId,
        rules: this.getUserRules(userId),
        timestamp: new Date().toISOString(),
      };
    }

    return {
      globalRules: this.globalRules,
      userRules: Object.fromEntries(this.userRulesCache.entries()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Import rules from backup
   */
  importRules(data: Record<string, any>): boolean {
    try {
      if (data.globalRules && Array.isArray(data.globalRules)) {
        this.globalRules = data.globalRules;
      }

      if (data.userRules && typeof data.userRules === 'object') {
        for (const [userId, rules] of Object.entries(data.userRules)) {
          if (Array.isArray(rules)) {
            this.userRulesCache.set(userId, rules as Rule[]);
          }
        }
      }

      if (data.userId && data.rules && Array.isArray(data.rules)) {
        this.userRulesCache.set(data.userId, data.rules as Rule[]);
      }

      logger.info('Rules imported successfully', {
        globalRules: this.globalRules.length,
        userRules: this.userRulesCache.size,
      });

      return true;
    } catch (error) {
      logger.error('Failed to import rules', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

export const rulesEngine = new RulesEngine();
export default rulesEngine;