import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { CacheManager } from '../utils/CacheManager';
import AdvancedProfileService, { UserProfile, BehaviorPattern } from './AdvancedProfileService';
import { Recommendation } from '../types';

export interface RecommendationRule {
  id: string;
  name: string;
  description: string;
  category: 'security' | 'efficiency' | 'user_experience' | 'cost_optimization';
  conditions: RuleCondition[];
  recommendation: RecommendationTemplate;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  lastTriggered?: Date;
  triggerCount: number;
}

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'pattern';
  value: any;
  weight: number;
}

export interface RecommendationTemplate {
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  estimatedBenefit: string;
  implementationSteps: string[];
  tags: string[];
}

export interface RecommendationContext {
  userId: string;
  userProfile: UserProfile;
  behaviorPatterns: BehaviorPattern[];
  recentActivity: any[];
  systemMetrics: any;
  timestamp: Date;
}

export interface ScoredRecommendation extends Recommendation {
  score: number;
  confidence: number;
  reasoning: string[];
  applicableRules: string[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export class IntelligentRecommendationEngine extends EventEmitter {
  private logger: Logger;
  private cache: CacheManager;
  private profileService: AdvancedProfileService;
  private rules: Map<string, RecommendationRule>;
  private userRecommendations: Map<string, ScoredRecommendation[]>;
  private recommendationHistory: Map<string, any[]>;

  constructor(profileService: AdvancedProfileService) {
    super();
    
    this.logger = new Logger('IntelligentRecommendationEngine');
    this.cache = new CacheManager();
    this.profileService = profileService;
    this.rules = new Map();
    this.userRecommendations = new Map();
    this.recommendationHistory = new Map();

    this.initializeDefaultRules();
  }

  /**
   * 初始化默认推荐规则
   */
  private initializeDefaultRules(): void {
    const defaultRules: RecommendationRule[] = [
      {
        id: 'high_spam_exposure',
        name: 'High Spam Exposure Alert',
        description: 'User experiencing high spam call volume',
        category: 'security',
        conditions: [
          { field: 'riskMetrics.spamExposureLevel', operator: 'gt', value: 0.7, weight: 1.0 },
          { field: 'behaviorMetrics.callFrequency', operator: 'gt', value: 10, weight: 0.5 }
        ],
        recommendation: {
          title: '升级垃圾电话防护',
          description: '您的账户正在经历高频垃圾电话攻击，建议立即升级防护策略',
          impact: 'high',
          effort: 'low',
          estimatedBenefit: '减少80%垃圾电话',
          implementationSteps: [
            '切换到严格白名单模式',
            '启用AI智能过滤',
            '添加可信联系人到白名单',
            '定期审查和更新设置'
          ],
          tags: ['security', 'spam_protection', 'urgent']
        },
        priority: 9,
        isActive: true,
        createdAt: new Date(),
        triggerCount: 0
      },
      {
        id: 'behavior_change_detected',
        name: 'Unusual Behavior Pattern',
        description: 'Significant change in user behavior detected',
        category: 'user_experience',
        conditions: [
          { field: 'behaviorPatterns.length', operator: 'gt', value: 0, weight: 0.8 },
          { field: 'behaviorMetrics.interactionStyle', operator: 'ne', value: 'previous', weight: 0.6 }
        ],
        recommendation: {
          title: '调整个性化设置',
          description: '检测到您的使用习惯发生变化，建议更新个性化设置以获得更好体验',
          impact: 'medium',
          effort: 'low',
          estimatedBenefit: '提升30%用户体验',
          implementationSteps: [
            '重新评估通话偏好',
            '更新时间段设置',
            '调整AI响应风格',
            '优化通知设置'
          ],
          tags: ['personalization', 'user_experience']
        },
        priority: 6,
        isActive: true,
        createdAt: new Date(),
        triggerCount: 0
      },
      {
        id: 'low_ai_effectiveness',
        name: 'AI Performance Optimization',
        description: 'AI response effectiveness below optimal level',
        category: 'efficiency',
        conditions: [
          { field: 'learningData.accuracy', operator: 'lt', value: 0.8, weight: 1.0 },
          { field: 'behaviorMetrics.callFrequency', operator: 'gt', value: 5, weight: 0.3 }
        ],
        recommendation: {
          title: '优化AI响应效果',
          description: 'AI响应效果可以进一步优化，通过调整策略提升处理质量',
          impact: 'medium',
          effort: 'medium',
          estimatedBenefit: '提升25%AI准确率',
          implementationSteps: [
            '提供更多训练数据',
            '调整AI响应策略',
            '启用高级学习模式',
            '定期反馈AI表现'
          ],
          tags: ['ai_optimization', 'efficiency']
        },
        priority: 7,
        isActive: true,
        createdAt: new Date(),
        triggerCount: 0
      },
      {
        id: 'cost_optimization',
        name: 'Resource Usage Optimization',
        description: 'Optimize resource usage for cost efficiency',
        category: 'cost_optimization',
        conditions: [
          { field: 'behaviorMetrics.avgCallDuration', operator: 'gt', value: 180, weight: 0.7 },
          { field: 'behaviorMetrics.callFrequency', operator: 'lt', value: 2, weight: 0.5 }
        ],
        recommendation: {
          title: '优化资源使用',
          description: '根据您的使用模式，可以调整资源配置以降低成本',
          impact: 'low',
          effort: 'low',
          estimatedBenefit: '降低15%运营成本',
          implementationSteps: [
            '调整处理策略',
            '优化缓存设置',
            '调整监控频率',
            '启用节能模式'
          ],
          tags: ['cost_optimization', 'efficiency']
        },
        priority: 4,
        isActive: true,
        createdAt: new Date(),
        triggerCount: 0
      },
      {
        id: 'security_enhancement',
        name: 'Security Enhancement',
        description: 'Enhance security based on threat landscape',
        category: 'security',
        conditions: [
          { field: 'riskMetrics.securityScore', operator: 'lt', value: 0.8, weight: 0.9 },
          { field: 'riskMetrics.anomalyFlags.length', operator: 'gt', value: 0, weight: 0.6 }
        ],
        recommendation: {
          title: '加强安全防护',
          description: '检测到潜在安全风险，建议加强防护措施',
          impact: 'high',
          effort: 'medium',
          estimatedBenefit: '提升40%安全性',
          implementationSteps: [
            '启用高级威胁检测',
            '增强身份验证',
            '定期安全审计',
            '更新安全策略'
          ],
          tags: ['security', 'threat_protection']
        },
        priority: 8,
        isActive: true,
        createdAt: new Date(),
        triggerCount: 0
      }
    ];

    defaultRules.forEach(rule => {
      this.rules.set(rule.id, rule);
    });

    this.logger.info('Default recommendation rules initialized', { ruleCount: defaultRules.length });
  }

  /**
   * 为用户生成推荐
   */
  async generateRecommendations(userId: string): Promise<ScoredRecommendation[]> {
    try {
      this.logger.info('Generating recommendations', { userId });

      // 构建推荐上下文
      const context = await this.buildRecommendationContext(userId);
      
      // 评估所有规则
      const applicableRules = await this.evaluateRules(context);
      
      // 生成推荐
      const recommendations = await this.createRecommendations(context, applicableRules);
      
      // 评分和排序
      const scoredRecommendations = await this.scoreAndRankRecommendations(recommendations, context);
      
      // 过滤和去重
      const finalRecommendations = await this.filterRecommendations(scoredRecommendations, userId);
      
      // 缓存结果
      this.userRecommendations.set(userId, finalRecommendations);
      await this.cacheRecommendations(userId, finalRecommendations);
      
      // 记录历史
      await this.recordRecommendationHistory(userId, finalRecommendations);

      this.emit('recommendationsGenerated', {
        userId,
        recommendationCount: finalRecommendations.length,
        highPriorityCount: finalRecommendations.filter(r => r.urgency === 'high' || r.urgency === 'critical').length
      });

      return finalRecommendations;
    } catch (error) {
      this.logger.error('Failed to generate recommendations', { error, userId });
      throw error;
    }
  }

  /**
   * 构建推荐上下文
   */
  private async buildRecommendationContext(userId: string): Promise<RecommendationContext> {
    const userProfile = await this.profileService.getUserProfile(userId);
    const behaviorPatterns = await this.profileService.analyzeUserBehaviorPatterns(userId);
    const recentActivity = await this.getRecentActivity(userId);
    const systemMetrics = await this.getSystemMetrics();

    return {
      userId,
      userProfile,
      behaviorPatterns,
      recentActivity,
      systemMetrics,
      timestamp: new Date()
    };
  }

  /**
   * 获取最近活动
   */
  private async getRecentActivity(userId: string): Promise<any[]> {
    const cacheKey = `recent_activity_${userId}`;
    return await this.cache.get(cacheKey) || [];
  }

  /**
   * 获取系统指标
   */
  private async getSystemMetrics(): Promise<any> {
    const cacheKey = 'system_metrics';
    return await this.cache.get(cacheKey) || {};
  }

  /**
   * 评估规则
   */
  private async evaluateRules(context: RecommendationContext): Promise<string[]> {
    const applicableRules: string[] = [];

    for (const [ruleId, rule] of this.rules) {
      if (!rule.isActive) continue;

      const ruleScore = await this.evaluateRule(rule, context);
      
      if (ruleScore > 0.5) { // 阈值可配置
        applicableRules.push(ruleId);
        
        // 更新规则触发统计
        rule.triggerCount++;
        rule.lastTriggered = new Date();
      }
    }

    return applicableRules;
  }

  /**
   * 评估单个规则
   */
  private async evaluateRule(rule: RecommendationRule, context: RecommendationContext): Promise<number> {
    let totalScore = 0;
    let totalWeight = 0;

    for (const condition of rule.conditions) {
      const conditionScore = this.evaluateCondition(condition, context);
      totalScore += conditionScore * condition.weight;
      totalWeight += condition.weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * 评估条件
   */
  private evaluateCondition(condition: RuleCondition, context: RecommendationContext): number {
    const fieldValue = this.getFieldValue(condition.field, context);
    
    if (fieldValue === undefined || fieldValue === null) {
      return 0;
    }

    switch (condition.operator) {
      case 'eq':
        return fieldValue === condition.value ? 1 : 0;
      case 'ne':
        return fieldValue !== condition.value ? 1 : 0;
      case 'gt':
        return fieldValue > condition.value ? 1 : 0;
      case 'gte':
        return fieldValue >= condition.value ? 1 : 0;
      case 'lt':
        return fieldValue < condition.value ? 1 : 0;
      case 'lte':
        return fieldValue <= condition.value ? 1 : 0;
      case 'contains':
        return String(fieldValue).includes(String(condition.value)) ? 1 : 0;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue) ? 1 : 0;
      case 'pattern':
        const regex = new RegExp(condition.value);
        return regex.test(String(fieldValue)) ? 1 : 0;
      default:
        return 0;
    }
  }

  /**
   * 获取字段值
   */
  private getFieldValue(fieldPath: string, context: RecommendationContext): any {
    const parts = fieldPath.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * 创建推荐
   */
  private async createRecommendations(
    context: RecommendationContext,
    applicableRules: string[]
  ): Promise<ScoredRecommendation[]> {
    const recommendations: ScoredRecommendation[] = [];

    for (const ruleId of applicableRules) {
      const rule = this.rules.get(ruleId);
      if (!rule) continue;

      const recommendation: ScoredRecommendation = {
        id: `rec_${ruleId}_${Date.now()}`,
        category: rule.category,
        title: rule.recommendation.title,
        description: rule.recommendation.description,
        impact: rule.recommendation.impact,
        effort: rule.recommendation.effort,
        priority: rule.priority,
        estimatedBenefit: rule.recommendation.estimatedBenefit,
        implementationSteps: [...rule.recommendation.implementationSteps],
        score: 0, // 稍后计算
        confidence: 0, // 稍后计算
        reasoning: [],
        applicableRules: [ruleId],
        urgency: this.determineUrgency(rule, context)
      };

      recommendations.push(recommendation);
    }

    return recommendations;
  }

  /**
   * 确定紧急程度
   */
  private determineUrgency(rule: RecommendationRule, context: RecommendationContext): 'low' | 'medium' | 'high' | 'critical' {
    const { category, priority } = rule;
    const { userProfile } = context;

    // 安全相关推荐的紧急程度更高
    if (category === 'security') {
      if (userProfile.riskMetrics.spamExposureLevel > 0.8 || userProfile.riskMetrics.securityScore < 0.3) {
        return 'critical';
      }
      if (priority >= 8) return 'high';
      if (priority >= 6) return 'medium';
      return 'low';
    }

    // 其他类别基于优先级
    if (priority >= 9) return 'critical';
    if (priority >= 7) return 'high';
    if (priority >= 5) return 'medium';
    return 'low';
  }

  /**
   * 评分和排序推荐
   */
  private async scoreAndRankRecommendations(
    recommendations: ScoredRecommendation[],
    context: RecommendationContext
  ): Promise<ScoredRecommendation[]> {
    for (const recommendation of recommendations) {
      const score = await this.calculateRecommendationScore(recommendation, context);
      const confidence = await this.calculateConfidence(recommendation, context);
      const reasoning = await this.generateReasoning(recommendation, context);

      recommendation.score = score;
      recommendation.confidence = confidence;
      recommendation.reasoning = reasoning;
    }

    // 按评分排序
    return recommendations.sort((a, b) => {
      // 首先按紧急程度排序
      const urgencyWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const urgencyDiff = urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
      
      if (urgencyDiff !== 0) return urgencyDiff;
      
      // 然后按评分排序
      return b.score - a.score;
    });
  }

  /**
   * 计算推荐评分
   */
  private async calculateRecommendationScore(
    recommendation: ScoredRecommendation,
    context: RecommendationContext
  ): Promise<number> {
    let score = recommendation.priority / 10; // 基础分数

    // 影响程度加权
    const impactWeight = { high: 1.5, medium: 1.0, low: 0.7 };
    score *= impactWeight[recommendation.impact];

    // 实施难度调整（难度越低分数越高）
    const effortWeight = { low: 1.2, medium: 1.0, high: 0.8 };
    score *= effortWeight[recommendation.effort];

    // 用户特征相关性
    const relevanceScore = await this.calculateRelevance(recommendation, context);
    score *= relevanceScore;

    // 时间衰减（如果最近已经推荐过类似内容）
    const timeDecay = await this.calculateTimeDecay(recommendation, context.userId);
    score *= timeDecay;

    return Math.min(score, 10); // 限制最高分数
  }

  /**
   * 计算相关性
   */
  private async calculateRelevance(
    recommendation: ScoredRecommendation,
    context: RecommendationContext
  ): Promise<number> {
    let relevance = 1.0;

    // 基于用户行为模式调整
    const behaviorRelevance = this.calculateBehaviorRelevance(recommendation, context.behaviorPatterns);
    relevance *= behaviorRelevance;

    // 基于当前风险状态调整
    const riskRelevance = this.calculateRiskRelevance(recommendation, context.userProfile.riskMetrics);
    relevance *= riskRelevance;

    return Math.max(relevance, 0.1); // 最低相关性
  }

  /**
   * 计算行为相关性
   */
  private calculateBehaviorRelevance(
    recommendation: ScoredRecommendation,
    patterns: BehaviorPattern[]
  ): number {
    if (patterns.length === 0) return 1.0;

    // 如果推荐与检测到的行为模式相关，增加相关性
    let relevance = 1.0;
    
    for (const pattern of patterns) {
      if (pattern.confidence > 0.7) {
        if (recommendation.category === 'user_experience' && pattern.type === 'interaction') {
          relevance *= 1.3;
        }
        if (recommendation.category === 'security' && pattern.type === 'frequency' && pattern.trend === 'increasing') {
          relevance *= 1.2;
        }
      }
    }

    return Math.min(relevance, 2.0);
  }

  /**
   * 计算风险相关性
   */
  private calculateRiskRelevance(recommendation: ScoredRecommendation, riskMetrics: any): number {
    let relevance = 1.0;

    if (recommendation.category === 'security') {
      if (riskMetrics.spamExposureLevel > 0.7) relevance *= 1.5;
      if (riskMetrics.securityScore < 0.5) relevance *= 1.3;
      if (riskMetrics.anomalyFlags.length > 0) relevance *= 1.2;
    }

    return relevance;
  }

  /**
   * 计算时间衰减
   */
  private async calculateTimeDecay(recommendation: ScoredRecommendation, userId: string): Promise<number> {
    const history = this.recommendationHistory.get(userId) || [];
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    // 检查最近是否有相似推荐
    for (const historicalRec of history) {
      if (historicalRec.category === recommendation.category) {
        const daysSince = (now - historicalRec.timestamp) / dayInMs;
        
        if (daysSince < 1) return 0.3; // 1天内大幅降低
        if (daysSince < 3) return 0.6; // 3天内中度降低
        if (daysSince < 7) return 0.8; // 7天内轻度降低
      }
    }

    return 1.0; // 无衰减
  }

  /**
   * 计算置信度
   */
  private async calculateConfidence(
    recommendation: ScoredRecommendation,
    context: RecommendationContext
  ): Promise<number> {
    let confidence = 0.8; // 基础置信度

    // 基于数据质量调整
    const dataQuality = this.assessDataQuality(context);
    confidence *= dataQuality;

    // 基于规则复杂度调整
    const ruleComplexity = recommendation.applicableRules.length;
    confidence *= Math.min(1.0 + (ruleComplexity - 1) * 0.1, 1.3);

    // 基于历史准确性调整
    const historicalAccuracy = await this.getHistoricalAccuracy(recommendation.category, context.userId);
    confidence *= historicalAccuracy;

    return Math.min(confidence, 1.0);
  }

  /**
   * 评估数据质量
   */
  private assessDataQuality(context: RecommendationContext): number {
    let quality = 1.0;

    // 检查数据完整性
    if (!context.userProfile.basicInfo.lastActiveDate) quality *= 0.9;
    if (context.behaviorPatterns.length === 0) quality *= 0.8;
    if (context.recentActivity.length === 0) quality *= 0.9;

    // 检查数据新鲜度
    const daysSinceLastActive = (Date.now() - context.userProfile.basicInfo.lastActiveDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceLastActive > 7) quality *= 0.8;
    if (daysSinceLastActive > 30) quality *= 0.6;

    return Math.max(quality, 0.3);
  }

  /**
   * 获取历史准确性
   */
  private async getHistoricalAccuracy(category: string, userId: string): Promise<number> {
    // 简化实现，实际应该基于用户反馈计算
    const cacheKey = `recommendation_accuracy_${category}_${userId}`;
    const cachedAccuracy = await this.cache.get(cacheKey);
    
    return cachedAccuracy || 0.85; // 默认准确率
  }

  /**
   * 生成推理说明
   */
  private async generateReasoning(
    recommendation: ScoredRecommendation,
    context: RecommendationContext
  ): Promise<string[]> {
    const reasoning: string[] = [];

    // 基于适用规则生成推理
    for (const ruleId of recommendation.applicableRules) {
      const rule = this.rules.get(ruleId);
      if (rule) {
        reasoning.push(`规则"${rule.name}"被触发`);
      }
    }

    // 基于用户状态生成推理
    if (recommendation.category === 'security') {
      if (context.userProfile.riskMetrics.spamExposureLevel > 0.7) {
        reasoning.push('检测到高垃圾电话暴露风险');
      }
      if (context.userProfile.riskMetrics.anomalyFlags.length > 0) {
        reasoning.push('发现异常行为指标');
      }
    }

    // 基于行为模式生成推理
    if (context.behaviorPatterns.length > 0) {
      const significantPatterns = context.behaviorPatterns.filter(p => p.confidence > 0.8);
      if (significantPatterns.length > 0) {
        reasoning.push(`识别到${significantPatterns.length}个重要行为模式`);
      }
    }

    return reasoning;
  }

  /**
   * 过滤推荐
   */
  private async filterRecommendations(
    recommendations: ScoredRecommendation[],
    userId: string
  ): Promise<ScoredRecommendation[]> {
    // 去重相似推荐
    const filtered = this.deduplicateRecommendations(recommendations);

    // 限制数量
    const maxRecommendations = 10;
    const limited = filtered.slice(0, maxRecommendations);

    // 过滤低分推荐
    const minScore = 3.0;
    const scored = limited.filter(rec => rec.score >= minScore);

    return scored;
  }

  /**
   * 去重推荐
   */
  private deduplicateRecommendations(recommendations: ScoredRecommendation[]): ScoredRecommendation[] {
    const categoryMap = new Map<string, ScoredRecommendation>();

    for (const rec of recommendations) {
      const existing = categoryMap.get(rec.category);
      
      if (!existing || rec.score > existing.score) {
        categoryMap.set(rec.category, rec);
      }
    }

    return Array.from(categoryMap.values());
  }

  /**
   * 缓存推荐结果
   */
  private async cacheRecommendations(userId: string, recommendations: ScoredRecommendation[]): Promise<void> {
    const cacheKey = `recommendations_${userId}`;
    await this.cache.set(cacheKey, recommendations, 3600); // 缓存1小时
  }

  /**
   * 记录推荐历史
   */
  private async recordRecommendationHistory(userId: string, recommendations: ScoredRecommendation[]): Promise<void> {
    const history = this.recommendationHistory.get(userId) || [];
    
    const newEntries = recommendations.map(rec => ({
      id: rec.id,
      category: rec.category,
      title: rec.title,
      score: rec.score,
      urgency: rec.urgency,
      timestamp: Date.now()
    }));

    history.push(...newEntries);

    // 保留最近100个记录
    const maxHistorySize = 100;
    if (history.length > maxHistorySize) {
      history.splice(0, history.length - maxHistorySize);
    }

    this.recommendationHistory.set(userId, history);

    // 持久化到缓存
    const cacheKey = `recommendation_history_${userId}`;
    await this.cache.set(cacheKey, history, 86400); // 缓存24小时
  }

  /**
   * 获取用户推荐
   */
  async getUserRecommendations(userId: string): Promise<ScoredRecommendation[]> {
    // 先检查缓存
    const cacheKey = `recommendations_${userId}`;
    const cached = await this.cache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    // 生成新的推荐
    return await this.generateRecommendations(userId);
  }

  /**
   * 标记推荐为已实施
   */
  async markRecommendationImplemented(userId: string, recommendationId: string): Promise<void> {
    const recommendations = this.userRecommendations.get(userId) || [];
    const recommendation = recommendations.find(r => r.id === recommendationId);

    if (recommendation) {
      // 记录实施情况
      const implementationRecord = {
        recommendationId,
        userId,
        implementedAt: new Date(),
        category: recommendation.category,
        impact: recommendation.impact
      };

      const cacheKey = `implemented_recommendations_${userId}`;
      const implemented = await this.cache.get(cacheKey) || [];
      implemented.push(implementationRecord);
      await this.cache.set(cacheKey, implemented, 86400);

      this.emit('recommendationImplemented', implementationRecord);
    }
  }

  /**
   * 提供推荐反馈
   */
  async provideFeedback(
    userId: string,
    recommendationId: string,
    feedback: 'helpful' | 'not_helpful' | 'implemented'
  ): Promise<void> {
    const feedbackRecord = {
      recommendationId,
      userId,
      feedback,
      timestamp: new Date()
    };

    // 记录反馈
    const cacheKey = `recommendation_feedback_${userId}`;
    const feedbacks = await this.cache.get(cacheKey) || [];
    feedbacks.push(feedbackRecord);
    await this.cache.set(cacheKey, feedbacks, 86400);

    // 更新准确率统计
    await this.updateAccuracyStats(userId, recommendationId, feedback);

    this.emit('feedbackReceived', feedbackRecord);
  }

  /**
   * 更新准确率统计
   */
  private async updateAccuracyStats(
    userId: string,
    recommendationId: string,
    feedback: string
  ): Promise<void> {
    const recommendations = this.userRecommendations.get(userId) || [];
    const recommendation = recommendations.find(r => r.id === recommendationId);

    if (recommendation) {
      const cacheKey = `recommendation_accuracy_${recommendation.category}_${userId}`;
      let stats = await this.cache.get(cacheKey) || { total: 0, helpful: 0 };

      stats.total++;
      if (feedback === 'helpful' || feedback === 'implemented') {
        stats.helpful++;
      }

      const accuracy = stats.helpful / stats.total;
      await this.cache.set(cacheKey, accuracy, 86400);
    }
  }

  /**
   * 添加自定义规则
   */
  addCustomRule(rule: RecommendationRule): void {
    this.rules.set(rule.id, rule);
    this.logger.info('Custom rule added', { ruleId: rule.id, ruleName: rule.name });
  }

  /**
   * 更新规则
   */
  updateRule(ruleId: string, updates: Partial<RecommendationRule>): boolean {
    const rule = this.rules.get(ruleId);
    
    if (rule) {
      Object.assign(rule, updates);
      this.logger.info('Rule updated', { ruleId, updates });
      return true;
    }
    
    return false;
  }

  /**
   * 删除规则
   */
  deleteRule(ruleId: string): boolean {
    const deleted = this.rules.delete(ruleId);
    
    if (deleted) {
      this.logger.info('Rule deleted', { ruleId });
    }
    
    return deleted;
  }

  /**
   * 获取所有规则
   */
  getAllRules(): RecommendationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 获取推荐统计
   */
  async getRecommendationStats(): Promise<{
    totalRules: number;
    activeRules: number;
    totalRecommendations: number;
    implementationRate: number;
    categoryDistribution: Record<string, number>;
  }> {
    const totalRules = this.rules.size;
    const activeRules = Array.from(this.rules.values()).filter(r => r.isActive).length;
    
    let totalRecommendations = 0;
    const categoryDistribution: Record<string, number> = {};

    for (const recommendations of this.userRecommendations.values()) {
      totalRecommendations += recommendations.length;
      
      for (const rec of recommendations) {
        categoryDistribution[rec.category] = (categoryDistribution[rec.category] || 0) + 1;
      }
    }

    // 计算实施率（简化）
    const implementationRate = 0.15; // 15% 作为示例

    return {
      totalRules,
      activeRules,
      totalRecommendations,
      implementationRate,
      categoryDistribution
    };
  }
}

export default IntelligentRecommendationEngine;