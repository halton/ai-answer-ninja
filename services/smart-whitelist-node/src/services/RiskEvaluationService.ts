import { logger } from '@/utils/logger';
import { cacheService } from '@/cache/cache-service';
import { enhancedMLClassifier } from '@/ml/enhanced-ml-classifier';
import { featureExtractor } from '@/ml/feature-extractor';
import { config } from '@/config';
import crypto from 'crypto';
import {
  EvaluationRequest,
  EvaluationResult,
  PhoneFeatures,
  SpamProfile,
  UserRules,
  LearningEvent,
  SpamCategory,
  WhitelistError,
} from '@/types';

/**
 * Advanced Risk Evaluation Service
 * Integrates ML classification, behavioral analysis, and contextual evaluation
 * for comprehensive phone number risk assessment
 */
export class RiskEvaluationService {
  private readonly modelVersion = '2.1.0';
  private evaluationCache = new Map<string, CachedEvaluation>();
  private recentEvaluations = new Map<string, EvaluationHistory[]>();
  private adaptiveThresholds = new Map<string, AdaptiveThresholds>();

  constructor() {
    this.startBackgroundTasks();
  }

  /**
   * Comprehensive risk evaluation with ML integration
   */
  async evaluateRisk(
    request: EvaluationRequest,
    userRules?: UserRules['rules'],
    context: AdditionalContext = {}
  ): Promise<EnhancedEvaluationResult> {
    const start = Date.now();
    const evaluationId = this.generateEvaluationId(request);

    try {
      logger.debug('Starting risk evaluation', {
        phone: this.maskPhone(request.phone),
        userId: request.userId,
        evaluationId,
      });

      // Phase 1: Quick cache lookup
      const cacheResult = await this.checkEvaluationCache(request);
      if (cacheResult && this.isRecentEvaluation(cacheResult)) {
        return this.enrichCacheResult(cacheResult, start);
      }

      // Phase 2: Multi-layered evaluation
      const [
        whitelistStatus,
        spamProfile,
        mlClassification,
        behavioralAnalysis,
        contextualFactors,
        userHistory,
      ] = await Promise.allSettled([
        this.checkWhitelistStatus(request),
        this.getSpamProfile(request.phone),
        this.performMLClassification(request, context),
        this.analyzeBehavioralPatterns(request.phone, context),
        this.analyzeContextualFactors(request, userRules),
        this.getUserCallHistory(request.userId, request.phone),
      ]);

      // Phase 3: Risk computation and decision making
      const riskAssessment = await this.computeRiskScore({
        request,
        whitelistStatus: whitelistStatus.status === 'fulfilled' ? whitelistStatus.value : null,
        spamProfile: spamProfile.status === 'fulfilled' ? spamProfile.value : null,
        mlResult: mlClassification.status === 'fulfilled' ? mlClassification.value : null,
        behavioralAnalysis: behavioralAnalysis.status === 'fulfilled' ? behavioralAnalysis.value : null,
        contextualFactors: contextualFactors.status === 'fulfilled' ? contextualFactors.value : null,
        userHistory: userHistory.status === 'fulfilled' ? userHistory.value : null,
        userRules,
      });

      // Phase 4: Generate recommendations and explanations
      const recommendation = await this.generateSmartRecommendation(riskAssessment, userRules);
      const explanation = this.generateDetailedExplanation(riskAssessment);

      const result: EnhancedEvaluationResult = {
        ...riskAssessment,
        evaluationId,
        recommendation,
        explanation,
        processingTimeMs: Date.now() - start,
        modelVersion: this.modelVersion,
        cacheHit: false,
        confidence: this.calculateOverallConfidence(riskAssessment),
        metadata: {
          timestamp: new Date(),
          requestHash: this.hashRequest(request),
          userAgent: context.userAgent,
          ipAddress: context.ipAddress ? this.hashIP(context.ipAddress) : undefined,
        },
      };

      // Phase 5: Cache and record evaluation
      await this.cacheEvaluation(request, result);
      await this.recordEvaluationHistory(request, result);

      logger.info('Risk evaluation completed', {
        phone: this.maskPhone(request.phone),
        evaluationId,
        riskLevel: result.riskLevel,
        recommendation: result.recommendation,
        processingTime: result.processingTimeMs,
        mlConfidence: result.mlClassification?.confidence,
      });

      return result;
    } catch (error) {
      logger.error('Risk evaluation failed', {
        phone: this.maskPhone(request.phone),
        evaluationId,
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - start,
      });

      // Return safe fallback result
      return this.getSafeEvaluationResult(request, start, evaluationId);
    }
  }

  /**
   * Batch risk evaluation for multiple phone numbers
   */
  async evaluateBatch(
    requests: EvaluationRequest[],
    userRules?: UserRules['rules']
  ): Promise<EnhancedEvaluationResult[]> {
    const start = Date.now();
    const batchId = crypto.randomUUID();

    logger.info('Starting batch risk evaluation', {
      batchId,
      count: requests.length,
    });

    try {
      // Process in parallel with controlled concurrency
      const concurrency = Math.min(requests.length, config.ML_BATCH_CONCURRENCY || 5);
      const results: EnhancedEvaluationResult[] = [];
      
      for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
          batch.map(request => this.evaluateRisk(request, userRules))
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            // Create error result for failed evaluation
            const failedRequest = batch[batchResults.indexOf(result)];
            results.push(this.getSafeEvaluationResult(failedRequest, start, batchId + '_' + i));
          }
        }
      }

      logger.info('Batch risk evaluation completed', {
        batchId,
        processed: results.length,
        processingTime: Date.now() - start,
      });

      return results;
    } catch (error) {
      logger.error('Batch risk evaluation failed', {
        batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Batch evaluation failed', 'BATCH_EVALUATION_FAILED');
    }
  }

  /**
   * Update risk evaluation based on user feedback
   */
  async updateFromFeedback(
    phone: string,
    userId: string,
    feedback: 'correct' | 'incorrect' | 'spam' | 'not_spam',
    originalEvaluation: EnhancedEvaluationResult,
    context: Record<string, any> = {}
  ): Promise<void> {
    try {
      const phoneHash = this.hashPhone(phone);
      const learningEvent: LearningEvent = {
        userId,
        phone,
        eventType: feedback === 'correct' ? 'accept' : 'reject',
        confidence: originalEvaluation.confidence,
        features: originalEvaluation.mlClassification?.features || {},
        feedback: feedback as any,
        context: {
          originalEvaluation: {
            riskLevel: originalEvaluation.riskLevel,
            recommendation: originalEvaluation.recommendation,
            confidence: originalEvaluation.confidence,
          },
          ...context,
        },
        timestamp: new Date(),
      };

      // Update ML classifier
      await enhancedMLClassifier.learnFromFeedback(
        phone,
        feedback === 'correct' || feedback === 'not_spam',
        feedback as any,
        context,
        originalEvaluation.confidence
      );

      // Update adaptive thresholds for this user
      await this.updateAdaptiveThresholds(userId, feedback, originalEvaluation);

      // Invalidate related cache entries
      await this.invalidateEvaluationCache(phoneHash, userId);

      logger.info('Risk evaluation updated from feedback', {
        phone: this.maskPhone(phone),
        userId,
        feedback,
        originalRisk: originalEvaluation.riskLevel,
        originalRecommendation: originalEvaluation.recommendation,
      });
    } catch (error) {
      logger.error('Failed to update risk evaluation from feedback', {
        phone: this.maskPhone(phone),
        userId,
        feedback,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get evaluation history for a phone number
   */
  async getEvaluationHistory(
    phone: string,
    userId?: string,
    limit: number = 10
  ): Promise<EvaluationHistoryEntry[]> {
    try {
      const phoneHash = this.hashPhone(phone);
      const cacheKey = `eval_history:${phoneHash}${userId ? ':' + userId : ''}`;
      
      // Try cache first
      let history = await cacheService.get(cacheKey);
      
      if (!history) {
        // Query from storage/database
        history = this.recentEvaluations.get(cacheKey) || [];
      }

      return history.slice(0, limit);
    } catch (error) {
      logger.error('Failed to get evaluation history', {
        phone: this.maskPhone(phone),
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get risk trends for analytics
   */
  async getRiskTrends(
    userId: string,
    timeframe: 'day' | 'week' | 'month' = 'week'
  ): Promise<RiskTrends> {
    try {
      const cacheKey = `risk_trends:${userId}:${timeframe}`;
      let trends = await cacheService.get(cacheKey);
      
      if (!trends) {
        trends = await this.calculateRiskTrends(userId, timeframe);
        await cacheService.set(cacheKey, trends, 3600); // Cache for 1 hour
      }

      return trends;
    } catch (error) {
      logger.error('Failed to get risk trends', {
        userId,
        timeframe,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        totalEvaluations: 0,
        riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        accuracyRate: 0,
        avgResponseTime: 0,
        topSpamCategories: [],
        timeframe,
      };
    }
  }

  // Private methods

  private async checkEvaluationCache(request: EvaluationRequest): Promise<CachedEvaluation | null> {
    const cacheKey = this.generateCacheKey(request);
    return this.evaluationCache.get(cacheKey) || null;
  }

  private async checkWhitelistStatus(request: EvaluationRequest): Promise<WhitelistStatus | null> {
    if (!request.userId) return null;
    
    try {
      return await cacheService.fastWhitelistLookup(request.userId, request.phone);
    } catch (error) {
      logger.debug('Whitelist lookup failed', { error });
      return null;
    }
  }

  private async getSpamProfile(phone: string): Promise<SpamProfile | null> {
    const phoneHash = this.hashPhone(phone);
    return await cacheService.getSpamProfile(phoneHash);
  }

  private async performMLClassification(
    request: EvaluationRequest,
    context: AdditionalContext
  ): Promise<MLClassificationResult | null> {
    try {
      const features = featureExtractor.extractFeatures(request.phone, request.context);
      const userHistory = context.callHistory;
      
      const mlResult = await enhancedMLClassifier.classifyAdvanced(
        request.phone,
        request.context,
        userHistory
      );

      return {
        isSpam: mlResult.isSpam,
        spamType: mlResult.spamType,
        confidence: mlResult.confidence,
        riskScore: mlResult.riskScore,
        features: mlResult.features,
        explanation: mlResult.explanation,
        recommendations: mlResult.recommendations,
        processingTime: mlResult.processingTimeMs,
      };
    } catch (error) {
      logger.warn('ML classification failed', {
        phone: this.maskPhone(request.phone),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async analyzeBehavioralPatterns(
    phone: string,
    context: AdditionalContext
  ): Promise<BehavioralAnalysis> {
    const phoneHash = this.hashPhone(phone);
    
    // Get behavioral data from various sources
    const [callPatterns, timePatterns, frequencyAnalysis] = await Promise.allSettled([
      this.analyzeCallPatterns(phoneHash),
      this.analyzeTimePatterns(phoneHash),
      this.analyzeCallFrequency(phoneHash),
    ]);

    return {
      callPatterns: callPatterns.status === 'fulfilled' ? callPatterns.value : null,
      timePatterns: timePatterns.status === 'fulfilled' ? timePatterns.value : null,
      frequencyAnalysis: frequencyAnalysis.status === 'fulfilled' ? frequencyAnalysis.value : null,
      riskIndicators: this.calculateBehavioralRisk({
        callPatterns: callPatterns.status === 'fulfilled' ? callPatterns.value : null,
        timePatterns: timePatterns.status === 'fulfilled' ? timePatterns.value : null,
        frequencyAnalysis: frequencyAnalysis.status === 'fulfilled' ? frequencyAnalysis.value : null,
      }),
    };
  }

  private async analyzeContextualFactors(
    request: EvaluationRequest,
    userRules?: UserRules['rules']
  ): Promise<ContextualFactors> {
    const factors: ContextualFactors = {
      userRules,
      phoneCharacteristics: this.analyzePhoneCharacteristics(request.phone),
      requestContext: request.context,
      riskModifiers: [],
    };

    // Apply user-specific rules
    if (userRules) {
      factors.riskModifiers = this.applyUserRules(request.phone, userRules);
    }

    return factors;
  }

  private async getUserCallHistory(
    userId?: string,
    phone?: string
  ): Promise<CallHistoryAnalysis | null> {
    if (!userId || !phone) return null;
    
    try {
      // This would typically query a call history database
      // For now, return mock analysis
      return {
        totalCalls: 0,
        recentCalls: [],
        patterns: {},
        userInteractions: {},
      };
    } catch (error) {
      logger.debug('Failed to get call history', { userId, phone: this.maskPhone(phone || '') });
      return null;
    }
  }

  private async computeRiskScore(data: RiskComputationData): Promise<RiskAssessment> {
    const {
      request,
      whitelistStatus,
      spamProfile,
      mlResult,
      behavioralAnalysis,
      contextualFactors,
      userHistory,
      userRules,
    } = data;

    // Initialize base risk
    let riskScore = 0.5;
    let confidenceScore = 0.5;
    const riskFactors: RiskFactor[] = [];

    // Factor 1: Whitelist status (highest priority)
    if (whitelistStatus?.found) {
      riskScore = 0.1;
      confidenceScore = whitelistStatus.entry?.confidenceScore || 0.9;
      riskFactors.push({
        name: 'whitelist_status',
        impact: -0.4,
        confidence: confidenceScore,
        description: 'Phone number is in user whitelist',
      });
    }

    // Factor 2: ML Classification
    if (mlResult) {
      const mlWeight = 0.4;
      const mlImpact = mlResult.isSpam ? mlResult.riskScore * mlWeight : -(1 - mlResult.riskScore) * mlWeight;
      riskScore += mlImpact;
      
      riskFactors.push({
        name: 'ml_classification',
        impact: mlImpact,
        confidence: mlResult.confidence,
        description: `ML Classification: ${mlResult.isSpam ? 'SPAM' : 'LEGITIMATE'} (${mlResult.spamType})`,
      });
    }

    // Factor 3: Spam profile
    if (spamProfile) {
      const spamWeight = 0.3;
      const spamImpact = spamProfile.riskScore * spamWeight;
      riskScore += spamImpact;
      
      riskFactors.push({
        name: 'spam_profile',
        impact: spamImpact,
        confidence: spamProfile.confidenceLevel,
        description: `Known spam profile: ${spamProfile.spamCategory}`,
      });
    }

    // Factor 4: Behavioral analysis
    if (behavioralAnalysis?.riskIndicators) {
      const behavioralWeight = 0.2;
      const behavioralImpact = behavioralAnalysis.riskIndicators.overallRisk * behavioralWeight;
      riskScore += behavioralImpact;
      
      riskFactors.push({
        name: 'behavioral_patterns',
        impact: behavioralImpact,
        confidence: behavioralAnalysis.riskIndicators.confidence,
        description: 'Behavioral pattern analysis',
      });
    }

    // Factor 5: Contextual factors
    if (contextualFactors?.riskModifiers) {
      for (const modifier of contextualFactors.riskModifiers) {
        riskScore += modifier.impact;
        riskFactors.push({
          name: 'contextual_' + modifier.name,
          impact: modifier.impact,
          confidence: modifier.confidence,
          description: modifier.description,
        });
      }
    }

    // Normalize risk score
    riskScore = Math.max(0, Math.min(1, riskScore));
    
    // Calculate confidence based on available data
    const dataQuality = this.calculateDataQuality({
      hasWhitelist: !!whitelistStatus,
      hasMLResult: !!mlResult,
      hasSpamProfile: !!spamProfile,
      hasBehavioralData: !!behavioralAnalysis,
      hasUserHistory: !!userHistory,
    });

    confidenceScore = Math.max(0.5, Math.min(1, 0.6 + dataQuality * 0.4));

    return {
      phone: request.phone,
      riskScore,
      riskLevel: this.determineRiskLevel(riskScore),
      confidenceScore,
      classification: this.determineClassification(riskScore, mlResult),
      riskFactors,
      dataQuality,
      mlClassification: mlResult,
      spamProfile,
      behavioralAnalysis,
      whitelistStatus,
    };
  }

  private async generateSmartRecommendation(
    assessment: RiskAssessment,
    userRules?: UserRules['rules']
  ): Promise<string> {
    const { riskLevel, riskScore, classification } = assessment;

    // Apply user-specific rules first
    if (userRules) {
      if (userRules.blockKnownSpam && classification.includes('spam')) {
        return 'block';
      }
      if (userRules.requireManualApproval && riskScore > 0.6) {
        return 'manual_review';
      }
    }

    // Default recommendation logic
    if (riskLevel === 'critical') return 'block';
    if (riskLevel === 'high') return 'block_with_option';
    if (riskLevel === 'medium') return 'analyze_further';
    if (riskLevel === 'low') return 'allow';
    
    return 'allow_with_monitoring';
  }

  private generateDetailedExplanation(assessment: RiskAssessment): string {
    const { riskLevel, riskScore, riskFactors, classification } = assessment;
    
    const parts: string[] = [];
    parts.push(`Risk Level: ${riskLevel.toUpperCase()} (${Math.round(riskScore * 100)}%)`);
    parts.push(`Classification: ${classification}`);
    
    if (riskFactors.length > 0) {
      parts.push('Risk Factors:');
      riskFactors.forEach(factor => {
        const impact = factor.impact > 0 ? 'increases' : 'decreases';
        parts.push(`- ${factor.description} (${impact} risk by ${Math.abs(factor.impact * 100).toFixed(1)}%)`);
      });
    }

    return parts.join('\n');
  }

  private calculateOverallConfidence(assessment: RiskAssessment): number {
    const factors = assessment.riskFactors;
    if (factors.length === 0) return 0.5;
    
    const avgConfidence = factors.reduce((sum, factor) => sum + factor.confidence, 0) / factors.length;
    const dataQualityBonus = assessment.dataQuality * 0.2;
    
    return Math.min(1, avgConfidence + dataQualityBonus);
  }

  private determineRiskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= 0.8) return 'critical';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'low';
  }

  private determineClassification(riskScore: number, mlResult?: MLClassificationResult | null): string {
    if (mlResult?.isSpam) {
      return `spam_${mlResult.spamType}`;
    }
    
    if (riskScore > 0.7) return 'likely_spam';
    if (riskScore > 0.4) return 'suspicious';
    return 'legitimate';
  }

  private calculateDataQuality(data: {
    hasWhitelist: boolean;
    hasMLResult: boolean;
    hasSpamProfile: boolean;
    hasBehavioralData: boolean;
    hasUserHistory: boolean;
  }): number {
    const weights = {
      hasWhitelist: 0.3,
      hasMLResult: 0.3,
      hasSpamProfile: 0.2,
      hasBehavioralData: 0.1,
      hasUserHistory: 0.1,
    };

    let quality = 0;
    Object.entries(data).forEach(([key, hasData]) => {
      if (hasData) {
        quality += weights[key as keyof typeof weights];
      }
    });

    return quality;
  }

  // Helper methods for various analyses
  private async analyzeCallPatterns(phoneHash: string): Promise<any> {
    // Implementation would analyze call duration patterns, success rates, etc.
    return null;
  }

  private async analyzeTimePatterns(phoneHash: string): Promise<any> {
    // Implementation would analyze calling time patterns
    return null;
  }

  private async analyzeCallFrequency(phoneHash: string): Promise<any> {
    // Implementation would analyze call frequency patterns
    return null;
  }

  private calculateBehavioralRisk(data: any): BehavioralRiskIndicators {
    return {
      overallRisk: 0.5,
      confidence: 0.7,
      indicators: [],
    };
  }

  private analyzePhoneCharacteristics(phone: string): PhoneCharacteristics {
    return {
      length: phone.length,
      hasRepeating: /(\d)\1{3,}/.test(phone),
      hasSequential: /(012|123|234|345|456|567|678|789)/.test(phone),
      isBusinessFormat: phone.startsWith('1800') || phone.startsWith('1888'),
      estimatedCarrier: 'unknown',
      geographicRegion: 'unknown',
    };
  }

  private applyUserRules(phone: string, rules: UserRules['rules']): RiskModifier[] {
    const modifiers: RiskModifier[] = [];
    
    if (rules.patterns?.blockedPrefixes) {
      for (const prefix of rules.patterns.blockedPrefixes) {
        if (phone.startsWith(prefix)) {
          modifiers.push({
            name: 'blocked_prefix',
            impact: 0.3,
            confidence: 1.0,
            description: `Matches blocked prefix: ${prefix}`,
          });
        }
      }
    }

    if (rules.patterns?.allowedPrefixes) {
      for (const prefix of rules.patterns.allowedPrefixes) {
        if (phone.startsWith(prefix)) {
          modifiers.push({
            name: 'allowed_prefix',
            impact: -0.3,
            confidence: 1.0,
            description: `Matches allowed prefix: ${prefix}`,
          });
        }
      }
    }

    return modifiers;
  }

  // Utility methods
  private generateEvaluationId(request: EvaluationRequest): string {
    return crypto.createHash('md5')
      .update(request.phone + request.userId + Date.now())
      .digest('hex')
      .substring(0, 16);
  }

  private generateCacheKey(request: EvaluationRequest): string {
    return `eval:${this.hashPhone(request.phone)}:${request.userId || 'anon'}`;
  }

  private hashPhone(phone: string): string {
    return crypto.createHash('sha256')
      .update(phone + config.JWT_SECRET)
      .digest('hex');
  }

  private hashRequest(request: EvaluationRequest): string {
    return crypto.createHash('md5')
      .update(JSON.stringify(request))
      .digest('hex');
  }

  private hashIP(ip: string): string {
    return crypto.createHash('sha256')
      .update(ip + config.JWT_SECRET)
      .digest('hex')
      .substring(0, 16);
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    return phone.substring(0, 4) + '*'.repeat(phone.length - 4);
  }

  private isRecentEvaluation(cached: CachedEvaluation): boolean {
    const maxAge = config.EVALUATION_CACHE_TTL || 300000; // 5 minutes
    return Date.now() - cached.timestamp < maxAge;
  }

  private enrichCacheResult(cached: CachedEvaluation, startTime: number): EnhancedEvaluationResult {
    return {
      ...cached.result,
      processingTimeMs: Date.now() - startTime,
      cacheHit: true,
    };
  }

  private getSafeEvaluationResult(
    request: EvaluationRequest,
    startTime: number,
    evaluationId: string
  ): EnhancedEvaluationResult {
    return {
      phone: request.phone,
      riskScore: 0.5,
      riskLevel: 'medium',
      confidenceScore: 0.5,
      classification: 'unknown',
      recommendation: 'manual_review',
      explanation: 'Evaluation failed - manual review recommended',
      evaluationId,
      processingTimeMs: Date.now() - startTime,
      modelVersion: this.modelVersion,
      cacheHit: false,
      confidence: 0.3,
      riskFactors: [],
      dataQuality: 0.2,
      metadata: {
        timestamp: new Date(),
        requestHash: this.hashRequest(request),
      },
    };
  }

  // Background tasks and maintenance
  private startBackgroundTasks(): void {
    // Clean evaluation cache every 15 minutes
    setInterval(() => {
      this.cleanEvaluationCache();
    }, 900000);

    // Update adaptive thresholds every hour
    setInterval(() => {
      this.updateGlobalAdaptiveThresholds();
    }, 3600000);

    logger.info('Risk evaluation background tasks started');
  }

  private cleanEvaluationCache(): void {
    const cutoff = Date.now() - (config.EVALUATION_CACHE_TTL || 300000);
    
    for (const [key, cached] of this.evaluationCache.entries()) {
      if (cached.timestamp < cutoff) {
        this.evaluationCache.delete(key);
      }
    }

    logger.debug('Evaluation cache cleaned', {
      remainingEntries: this.evaluationCache.size,
    });
  }

  private async updateGlobalAdaptiveThresholds(): Promise<void> {
    // Implementation for updating global adaptive thresholds based on performance metrics
    logger.debug('Global adaptive thresholds updated');
  }

  private async cacheEvaluation(request: EvaluationRequest, result: EnhancedEvaluationResult): Promise<void> {
    const cacheKey = this.generateCacheKey(request);
    
    this.evaluationCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });
  }

  private async recordEvaluationHistory(
    request: EvaluationRequest, 
    result: EnhancedEvaluationResult
  ): Promise<void> {
    const phoneHash = this.hashPhone(request.phone);
    const cacheKey = `eval_history:${phoneHash}${request.userId ? ':' + request.userId : ''}`;
    
    let history = this.recentEvaluations.get(cacheKey) || [];
    
    history.unshift({
      timestamp: new Date(),
      riskLevel: result.riskLevel,
      recommendation: result.recommendation,
      confidence: result.confidence,
      processingTime: result.processingTimeMs,
    });

    // Keep only recent 20 evaluations
    if (history.length > 20) {
      history = history.slice(0, 20);
    }

    this.recentEvaluations.set(cacheKey, history);
  }

  private async updateAdaptiveThresholds(
    userId: string,
    feedback: string,
    evaluation: EnhancedEvaluationResult
  ): Promise<void> {
    let thresholds = this.adaptiveThresholds.get(userId);
    
    if (!thresholds) {
      thresholds = {
        riskThreshold: 0.6,
        confidenceThreshold: 0.7,
        learningRate: 0.1,
        accuracy: 0.8,
        totalFeedback: 0,
      };
    }

    // Update based on feedback
    const isCorrect = feedback === 'correct';
    const learningRate = thresholds.learningRate;
    
    if (isCorrect) {
      thresholds.accuracy = thresholds.accuracy * 0.9 + 0.1;
    } else {
      thresholds.accuracy = thresholds.accuracy * 0.9;
      
      // Adjust thresholds if prediction was wrong
      if (evaluation.riskLevel === 'high' && feedback === 'not_spam') {
        thresholds.riskThreshold += learningRate;
      } else if (evaluation.riskLevel === 'low' && feedback === 'spam') {
        thresholds.riskThreshold -= learningRate;
      }
    }

    thresholds.totalFeedback++;
    this.adaptiveThresholds.set(userId, thresholds);
  }

  private async invalidateEvaluationCache(phoneHash: string, userId?: string): Promise<void> {
    const pattern = `eval:${phoneHash}:${userId || ''}`;
    
    for (const key of this.evaluationCache.keys()) {
      if (key.includes(pattern)) {
        this.evaluationCache.delete(key);
      }
    }
  }

  private async calculateRiskTrends(userId: string, timeframe: string): Promise<RiskTrends> {
    // Implementation would calculate actual trends from historical data
    return {
      totalEvaluations: 0,
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      accuracyRate: 0.85,
      avgResponseTime: 150,
      topSpamCategories: [],
      timeframe,
    };
  }

  // Health check and statistics
  async getServiceHealth(): Promise<{
    healthy: boolean;
    cacheSize: number;
    mlServiceAvailable: boolean;
    avgResponseTime: number;
  }> {
    try {
      // Test ML service
      const testStart = Date.now();
      await enhancedMLClassifier.classifyAdvanced('1234567890', {});
      const mlResponseTime = Date.now() - testStart;

      return {
        healthy: true,
        cacheSize: this.evaluationCache.size,
        mlServiceAvailable: mlResponseTime < 5000, // 5 second timeout
        avgResponseTime: mlResponseTime,
      };
    } catch (error) {
      return {
        healthy: false,
        cacheSize: this.evaluationCache.size,
        mlServiceAvailable: false,
        avgResponseTime: -1,
      };
    }
  }
}

// Type definitions for the service
interface CachedEvaluation {
  result: EnhancedEvaluationResult;
  timestamp: number;
}

interface EvaluationHistory {
  timestamp: Date;
  riskLevel: string;
  recommendation: string;
  confidence: number;
  processingTime: number;
}

interface EvaluationHistoryEntry extends EvaluationHistory {
  phone?: string;
  userId?: string;
  feedback?: string;
}

interface AdditionalContext {
  userAgent?: string;
  ipAddress?: string;
  callHistory?: any;
}

interface AdaptiveThresholds {
  riskThreshold: number;
  confidenceThreshold: number;
  learningRate: number;
  accuracy: number;
  totalFeedback: number;
}

interface WhitelistStatus {
  found: boolean;
  entry?: any;
}

interface MLClassificationResult {
  isSpam: boolean;
  spamType: SpamCategory;
  confidence: number;
  riskScore: number;
  features: PhoneFeatures;
  explanation: string;
  recommendations: string[];
  processingTime: number;
}

interface BehavioralAnalysis {
  callPatterns: any;
  timePatterns: any;
  frequencyAnalysis: any;
  riskIndicators: BehavioralRiskIndicators;
}

interface BehavioralRiskIndicators {
  overallRisk: number;
  confidence: number;
  indicators: string[];
}

interface ContextualFactors {
  userRules?: UserRules['rules'];
  phoneCharacteristics: PhoneCharacteristics;
  requestContext: Record<string, any>;
  riskModifiers: RiskModifier[];
}

interface PhoneCharacteristics {
  length: number;
  hasRepeating: boolean;
  hasSequential: boolean;
  isBusinessFormat: boolean;
  estimatedCarrier: string;
  geographicRegion: string;
}

interface RiskModifier {
  name: string;
  impact: number;
  confidence: number;
  description: string;
}

interface CallHistoryAnalysis {
  totalCalls: number;
  recentCalls: any[];
  patterns: Record<string, any>;
  userInteractions: Record<string, any>;
}

interface RiskComputationData {
  request: EvaluationRequest;
  whitelistStatus: WhitelistStatus | null;
  spamProfile: SpamProfile | null;
  mlResult: MLClassificationResult | null;
  behavioralAnalysis: BehavioralAnalysis | null;
  contextualFactors: ContextualFactors | null;
  userHistory: CallHistoryAnalysis | null;
  userRules?: UserRules['rules'];
}

interface RiskFactor {
  name: string;
  impact: number;
  confidence: number;
  description: string;
}

interface RiskAssessment {
  phone: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidenceScore: number;
  classification: string;
  riskFactors: RiskFactor[];
  dataQuality: number;
  mlClassification?: MLClassificationResult | null;
  spamProfile?: SpamProfile | null;
  behavioralAnalysis?: BehavioralAnalysis | null;
  whitelistStatus?: WhitelistStatus | null;
}

interface EnhancedEvaluationResult extends EvaluationResult {
  evaluationId: string;
  explanation: string;
  confidence: number;
  riskFactors: RiskFactor[];
  dataQuality: number;
  modelVersion: string;
  mlClassification?: MLClassificationResult;
  spamProfile?: SpamProfile;
  behavioralAnalysis?: BehavioralAnalysis;
  whitelistStatus?: WhitelistStatus;
  metadata: {
    timestamp: Date;
    requestHash: string;
    userAgent?: string;
    ipAddress?: string;
  };
}

interface RiskTrends {
  totalEvaluations: number;
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  accuracyRate: number;
  avgResponseTime: number;
  topSpamCategories: Array<{
    category: SpamCategory;
    count: number;
    percentage: number;
  }>;
  timeframe: string;
}

export const riskEvaluationService = new RiskEvaluationService();
export default riskEvaluationService;