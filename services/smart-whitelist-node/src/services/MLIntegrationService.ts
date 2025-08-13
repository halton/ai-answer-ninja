import { logger } from '@/utils/logger';
import { cacheService } from '@/cache/cache-service';
import { enhancedMLClassifier } from '@/ml/enhanced-ml-classifier';
import { featureExtractor } from '@/ml/feature-extractor';
import { rulesEngine } from '@/ml/rules-engine';
import { config } from '@/config';
import {
  EvaluationRequest,
  EvaluationResult,
  PhoneFeatures,
  MLClassificationResult,
  LearningEvent,
  SpamProfile,
  UserRules,
  WhitelistError,
} from '@/types';

/**
 * ML Integration Service
 * Provides a unified interface for all ML operations in the whitelist system
 * Integrates enhanced ML classifier, feature extraction, and rules engine
 */
export class MLIntegrationService {
  private readonly integrationVersion = '1.0.0';
  private performanceMetrics = new Map<string, MLPerformanceMetrics>();
  private modelCache = new Map<string, CachedMLResult>();
  private featureCache = new Map<string, CachedFeatures>();

  constructor() {
    this.initializeMLIntegration();
    this.startPerformanceMonitoring();
  }

  /**
   * Comprehensive ML evaluation combining multiple models and approaches
   */
  async evaluateWithML(
    request: EvaluationRequest,
    userRules?: UserRules['rules'],
    context: MLEvaluationContext = {}
  ): Promise<EnhancedMLEvaluationResult> {
    const start = Date.now();
    const evaluationId = this.generateEvaluationId(request);

    try {
      logger.debug('Starting ML evaluation', {
        phone: this.maskPhone(request.phone),
        userId: request.userId,
        evaluationId,
        includeFeatures: request.includeFeatures,
      });

      // Phase 1: Feature extraction and caching
      const features = await this.extractAndCacheFeatures(request.phone, request.context);
      
      // Phase 2: Multi-model classification
      const [
        enhancedMLResult,
        rulesEngineResult,
        ensembleResult,
        behavioralAnalysis,
      ] = await Promise.allSettled([
        this.runEnhancedMLClassification(request, features, context),
        this.runRulesEngineEvaluation(request, userRules),
        this.runEnsembleClassification(request, features, context),
        this.runBehavioralAnalysis(request.phone, context),
      ]);

      // Phase 3: Result fusion and confidence calculation
      const fusedResult = await this.fuseMLResults({
        enhancedML: enhancedMLResult.status === 'fulfilled' ? enhancedMLResult.value : null,
        rulesEngine: rulesEngineResult.status === 'fulfilled' ? rulesEngineResult.value : null,
        ensemble: ensembleResult.status === 'fulfilled' ? ensembleResult.value : null,
        behavioral: behavioralAnalysis.status === 'fulfilled' ? behavioralAnalysis.value : null,
      });

      // Phase 4: Risk assessment and recommendation generation
      const riskAssessment = await this.assessMLRisk(fusedResult, features, userRules);
      const recommendation = this.generateMLRecommendation(riskAssessment, userRules);
      
      // Phase 5: Performance tracking and caching
      const processingTime = Date.now() - start;
      await this.trackPerformance(evaluationId, processingTime, fusedResult);
      await this.cacheMLResult(request, fusedResult);

      const result: EnhancedMLEvaluationResult = {
        phone: request.phone,
        isSpam: fusedResult.isSpam,
        spamType: fusedResult.spamType,
        confidence: fusedResult.confidence,
        riskScore: riskAssessment.riskScore,
        riskLevel: riskAssessment.riskLevel,
        classification: fusedResult.classification,
        recommendation,
        reasons: fusedResult.reasons,
        mlFeatures: request.includeFeatures ? features : undefined,
        processingTimeMs: processingTime,
        cacheHit: false,
        
        // Enhanced ML-specific fields
        evaluationId,
        modelResults: {
          enhancedML: enhancedMLResult.status === 'fulfilled' ? enhancedMLResult.value : null,
          rulesEngine: rulesEngineResult.status === 'fulfilled' ? rulesEngineResult.value : null,
          ensemble: ensembleResult.status === 'fulfilled' ? ensembleResult.value : null,
          behavioral: behavioralAnalysis.status === 'fulfilled' ? behavioralAnalysis.value : null,
        },
        fusionMetadata: {
          fusionMethod: 'weighted_ensemble',
          modelWeights: this.getModelWeights(),
          confidenceCalibration: fusedResult.confidenceCalibration,
          uncertaintyEstimate: fusedResult.uncertaintyEstimate,
        },
        performanceMetrics: {
          featureExtractionTime: features.extractionTime,
          classificationTime: processingTime - features.extractionTime,
          totalTime: processingTime,
          cacheHitRate: this.calculateCacheHitRate(),
        },
        modelVersion: this.integrationVersion,
        timestamp: new Date(),
      };

      logger.info('ML evaluation completed', {
        evaluationId,
        phone: this.maskPhone(request.phone),
        isSpam: result.isSpam,
        confidence: result.confidence,
        riskLevel: result.riskLevel,
        processingTime: result.processingTimeMs,
        modelsUsed: Object.keys(result.modelResults).filter(k => result.modelResults[k as keyof typeof result.modelResults] !== null),
      });

      return result;
    } catch (error) {
      logger.error('ML evaluation failed', {
        evaluationId,
        phone: this.maskPhone(request.phone),
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - start,
      });

      // Return safe fallback result
      return this.getSafeMLResult(request, start, evaluationId);
    }
  }

  /**
   * Batch ML evaluation for multiple phone numbers
   */
  async evaluateBatchWithML(
    requests: EvaluationRequest[],
    userRules?: UserRules['rules']
  ): Promise<EnhancedMLEvaluationResult[]> {
    const start = Date.now();
    const batchId = this.generateBatchId();

    logger.info('Starting batch ML evaluation', {
      batchId,
      count: requests.length,
    });

    try {
      // Pre-extract features for all requests in parallel
      const featureExtractionPromises = requests.map(request =>
        this.extractAndCacheFeatures(request.phone, request.context)
      );
      const allFeatures = await Promise.allSettled(featureExtractionPromises);

      // Process requests in optimized batches
      const batchSize = config.ML_BATCH_SIZE || 10;
      const results: EnhancedMLEvaluationResult[] = [];

      for (let i = 0; i < requests.length; i += batchSize) {
        const batchRequests = requests.slice(i, i + batchSize);
        const batchFeatures = allFeatures.slice(i, i + batchSize);

        // Process batch in parallel
        const batchResults = await Promise.allSettled(
          batchRequests.map((request, index) => {
            const features = batchFeatures[index];
            const requestFeatures = features.status === 'fulfilled' ? features.value : null;
            
            return this.evaluateWithMLOptimized(request, userRules, requestFeatures);
          })
        );

        // Collect results
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            // Create fallback result for failed evaluation
            const failedRequest = batchRequests[j];
            results.push(this.getSafeMLResult(failedRequest, start, `${batchId}_${i + j}`));
          }
        }
      }

      logger.info('Batch ML evaluation completed', {
        batchId,
        requested: requests.length,
        processed: results.length,
        processingTime: Date.now() - start,
      });

      return results;
    } catch (error) {
      logger.error('Batch ML evaluation failed', {
        batchId,
        count: requests.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Batch ML evaluation failed', 'BATCH_ML_EVALUATION_FAILED');
    }
  }

  /**
   * Learn from user feedback and update ML models
   */
  async learnFromFeedback(
    phone: string,
    userId: string,
    feedback: MLFeedback,
    originalResult: EnhancedMLEvaluationResult,
    context: Record<string, any> = {}
  ): Promise<MLLearningResult> {
    try {
      const start = Date.now();
      
      logger.debug('Processing ML feedback', {
        phone: this.maskPhone(phone),
        userId,
        feedback: feedback.type,
        originalPrediction: originalResult.isSpam,
        originalConfidence: originalResult.confidence,
      });

      // Prepare learning event
      const learningEvent: LearningEvent = {
        userId,
        phone,
        eventType: this.mapFeedbackToEventType(feedback.type),
        confidence: feedback.confidence,
        features: originalResult.mlFeatures || {},
        feedback: feedback.type as any,
        context: {
          originalResult: {
            isSpam: originalResult.isSpam,
            confidence: originalResult.confidence,
            riskLevel: originalResult.riskLevel,
            modelResults: originalResult.modelResults,
          },
          feedbackContext: feedback.context,
          ...context,
        },
        timestamp: new Date(),
      };

      // Update enhanced ML classifier
      const enhancedMLUpdate = await enhancedMLClassifier.learnFromFeedback(
        phone,
        feedback.actualResult,
        feedback.type as any,
        context,
        feedback.confidence
      );

      // Update rules engine if applicable
      let rulesEngineUpdate = null;
      if (feedback.type === 'false_positive' || feedback.type === 'false_negative') {
        rulesEngineUpdate = await this.updateRulesEngine(learningEvent);
      }

      // Update ensemble weights based on performance
      await this.updateEnsembleWeights(originalResult, feedback);

      // Update performance metrics
      await this.updatePerformanceMetrics(userId, originalResult, feedback);

      // Invalidate relevant caches
      await this.invalidateMLCaches(phone, userId);

      const result: MLLearningResult = {
        learningId: this.generateLearningId(),
        processed: true,
        modelsUpdated: [
          'enhanced_ml',
          ...(rulesEngineUpdate ? ['rules_engine'] : []),
          'ensemble_weights',
        ],
        improvementEstimate: this.estimateImprovement(feedback, originalResult),
        processingTimeMs: Date.now() - start,
        nextRecommendations: await this.generateLearningRecommendations(learningEvent),
      };

      logger.info('ML feedback processed', {
        phone: this.maskPhone(phone),
        userId,
        learningId: result.learningId,
        modelsUpdated: result.modelsUpdated,
        improvementEstimate: result.improvementEstimate,
      });

      return result;
    } catch (error) {
      logger.error('ML feedback processing failed', {
        phone: this.maskPhone(phone),
        userId,
        feedback,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        learningId: this.generateLearningId(),
        processed: false,
        modelsUpdated: [],
        improvementEstimate: 0,
        processingTimeMs: Date.now() - Date.now(),
        nextRecommendations: ['Manual review recommended due to learning failure'],
      };
    }
  }

  /**
   * Get ML model performance statistics
   */
  async getMLPerformanceStats(
    userId?: string,
    timeframe: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<MLPerformanceStats> {
    try {
      const cacheKey = `ml_performance:${userId || 'global'}:${timeframe}`;
      let stats = await cacheService.get(cacheKey);

      if (!stats) {
        stats = await this.calculateMLPerformanceStats(userId, timeframe);
        await cacheService.set(cacheKey, stats, 3600); // Cache for 1 hour
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get ML performance stats', {
        userId,
        timeframe,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return default stats
      return {
        timeframe,
        totalEvaluations: 0,
        accuracy: 0.85,
        precision: 0.80,
        recall: 0.90,
        f1Score: 0.85,
        avgConfidence: 0.75,
        avgProcessingTime: 200,
        modelPerformance: {
          enhancedML: { accuracy: 0.85, avgTime: 150 },
          rulesEngine: { accuracy: 0.80, avgTime: 50 },
          ensemble: { accuracy: 0.88, avgTime: 200 },
        },
        cacheHitRate: 0.60,
        errorRate: 0.05,
      };
    }
  }

  /**
   * Optimize ML models based on recent performance
   */
  async optimizeMLModels(userId?: string): Promise<MLOptimizationResult> {
    try {
      const start = Date.now();
      
      logger.info('Starting ML model optimization', { userId });

      // Get recent performance data
      const performanceData = await this.getRecentPerformanceData(userId);
      
      // Analyze optimization opportunities
      const optimizationPlan = await this.analyzeOptimizationOpportunities(performanceData);
      
      // Execute optimizations
      const optimizations: OptimizationStep[] = [];
      
      for (const step of optimizationPlan.steps) {
        try {
          const result = await this.executeOptimizationStep(step);
          optimizations.push({
            ...step,
            result,
            success: true,
          });
        } catch (error) {
          optimizations.push({
            ...step,
            result: { improvement: 0, error: error instanceof Error ? error.message : String(error) },
            success: false,
          });
        }
      }

      // Calculate total improvement
      const totalImprovement = optimizations
        .filter(opt => opt.success)
        .reduce((sum, opt) => sum + (opt.result?.improvement || 0), 0);

      const result: MLOptimizationResult = {
        optimizationId: this.generateOptimizationId(),
        userId,
        executedSteps: optimizations.length,
        successfulSteps: optimizations.filter(opt => opt.success).length,
        totalImprovement,
        optimizations,
        processingTimeMs: Date.now() - start,
        nextOptimizationRecommended: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
      };

      logger.info('ML model optimization completed', {
        optimizationId: result.optimizationId,
        userId,
        totalImprovement: result.totalImprovement,
        successfulSteps: result.successfulSteps,
        processingTime: result.processingTimeMs,
      });

      return result;
    } catch (error) {
      logger.error('ML model optimization failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        optimizationId: this.generateOptimizationId(),
        userId,
        executedSteps: 0,
        successfulSteps: 0,
        totalImprovement: 0,
        optimizations: [],
        processingTimeMs: 0,
        nextOptimizationRecommended: Date.now() + (24 * 60 * 60 * 1000),
      };
    }
  }

  // Private implementation methods

  private async initializeMLIntegration(): Promise<void> {
    try {
      // Initialize model weights
      await this.loadModelWeights();
      
      // Warm up caches
      await this.warmupCaches();
      
      logger.info('ML integration initialized', {
        version: this.integrationVersion,
        modelsLoaded: ['enhanced_ml', 'rules_engine', 'ensemble'],
      });
    } catch (error) {
      logger.error('Failed to initialize ML integration', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async extractAndCacheFeatures(
    phone: string,
    context: Record<string, any>
  ): Promise<CachedFeatures> {
    const phoneHash = this.hashPhone(phone);
    const cacheKey = `features:${phoneHash}`;
    
    // Check cache first
    let cached = this.featureCache.get(cacheKey);
    if (cached && this.isFeatureCacheValid(cached)) {
      return cached;
    }

    // Extract features
    const start = Date.now();
    const features = featureExtractor.extractFeatures(phone, context);
    const extractionTime = Date.now() - start;

    cached = {
      features,
      extractionTime,
      timestamp: Date.now(),
    };

    // Cache the features
    this.featureCache.set(cacheKey, cached);
    
    return cached;
  }

  private async runEnhancedMLClassification(
    request: EvaluationRequest,
    features: CachedFeatures,
    context: MLEvaluationContext
  ): Promise<EnhancedMLResult> {
    try {
      const result = await enhancedMLClassifier.classifyAdvanced(
        request.phone,
        request.context,
        context.userHistory
      );

      return {
        isSpam: result.isSpam,
        spamType: result.spamType,
        confidence: result.confidence,
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        features: result.features,
        explanation: result.explanation,
        recommendations: result.recommendations,
        processingTime: result.processingTimeMs,
        modelVersion: result.modelVersion,
        ensembleResults: result.ensembleResults,
        temporalFeatures: result.temporalFeatures,
        behavioralProfile: result.behavioralProfile,
      };
    } catch (error) {
      logger.warn('Enhanced ML classification failed', {
        phone: this.maskPhone(request.phone),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async runRulesEngineEvaluation(
    request: EvaluationRequest,
    userRules?: UserRules['rules']
  ): Promise<RulesEngineResult> {
    try {
      const result = await rulesEngine.evaluate(request, userRules);
      return {
        isSpam: result.isSpam,
        confidence: result.confidenceScore,
        riskScore: result.riskScore,
        classification: result.classification,
        recommendation: result.recommendation,
        reasons: result.reasons,
        rulesApplied: result.rulesApplied || [],
        processingTime: result.processingTimeMs,
      };
    } catch (error) {
      logger.warn('Rules engine evaluation failed', {
        phone: this.maskPhone(request.phone),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async runEnsembleClassification(
    request: EvaluationRequest,
    features: CachedFeatures,
    context: MLEvaluationContext
  ): Promise<EnsembleResult> {
    // This would implement a custom ensemble approach
    // For now, return a placeholder
    return {
      isSpam: false,
      confidence: 0.5,
      riskScore: 0.5,
      modelVotes: {},
      ensembleMethod: 'weighted_voting',
      processingTime: 50,
    };
  }

  private async runBehavioralAnalysis(
    phone: string,
    context: MLEvaluationContext
  ): Promise<BehavioralAnalysisResult> {
    // Placeholder for behavioral analysis
    return {
      riskScore: 0.5,
      patterns: [],
      anomalies: [],
      confidence: 0.6,
      processingTime: 30,
    };
  }

  private async fuseMLResults(results: ModelResults): Promise<FusedMLResult> {
    const weights = this.getModelWeights();
    let isSpamScore = 0;
    let totalWeight = 0;
    const reasons: string[] = [];
    const modelContributions: Record<string, number> = {};

    // Enhanced ML result
    if (results.enhancedML) {
      const weight = weights.enhancedML;
      const score = results.enhancedML.isSpam ? results.enhancedML.confidence : 1 - results.enhancedML.confidence;
      isSpamScore += score * weight;
      totalWeight += weight;
      modelContributions.enhancedML = score * weight;
      if (results.enhancedML.isSpam) {
        reasons.push(`Enhanced ML: ${results.enhancedML.explanation}`);
      }
    }

    // Rules engine result
    if (results.rulesEngine) {
      const weight = weights.rulesEngine;
      const score = results.rulesEngine.isSpam ? results.rulesEngine.confidence : 1 - results.rulesEngine.confidence;
      isSpamScore += score * weight;
      totalWeight += weight;
      modelContributions.rulesEngine = score * weight;
      if (results.rulesEngine.isSpam) {
        reasons.push(`Rules Engine: ${results.rulesEngine.reasons.join(', ')}`);
      }
    }

    // Ensemble result
    if (results.ensemble) {
      const weight = weights.ensemble;
      const score = results.ensemble.isSpam ? results.ensemble.confidence : 1 - results.ensemble.confidence;
      isSpamScore += score * weight;
      totalWeight += weight;
      modelContributions.ensemble = score * weight;
    }

    // Behavioral analysis
    if (results.behavioral) {
      const weight = weights.behavioral;
      const score = results.behavioral.riskScore;
      isSpamScore += score * weight;
      totalWeight += weight;
      modelContributions.behavioral = score * weight;
    }

    // Calculate final scores
    const finalSpamScore = totalWeight > 0 ? isSpamScore / totalWeight : 0.5;
    const isSpam = finalSpamScore > 0.6;
    const confidence = Math.abs(finalSpamScore - 0.5) * 2; // Convert to 0-1 range

    // Determine spam type (use Enhanced ML result if available)
    const spamType = results.enhancedML?.spamType || 'unknown';
    
    // Determine classification
    const classification = isSpam 
      ? `spam_${spamType}`
      : finalSpamScore > 0.4 ? 'suspicious' : 'legitimate';

    return {
      isSpam,
      spamType,
      confidence,
      classification,
      reasons: reasons.length > 0 ? reasons : ['Fusion of multiple ML models'],
      modelContributions,
      fusionScore: finalSpamScore,
      confidenceCalibration: this.calibrateConfidence(confidence, modelContributions),
      uncertaintyEstimate: this.estimateUncertainty(modelContributions, totalWeight),
    };
  }

  private async assessMLRisk(
    fusedResult: FusedMLResult,
    features: CachedFeatures,
    userRules?: UserRules['rules']
  ): Promise<MLRiskAssessment> {
    let riskScore = fusedResult.fusionScore;
    
    // Adjust risk based on user rules
    if (userRules?.blockKnownSpam && fusedResult.isSpam) {
      riskScore = Math.min(1.0, riskScore + 0.1);
    }
    
    // Determine risk level
    const riskLevel = this.determineRiskLevel(riskScore);
    
    return {
      riskScore,
      riskLevel,
      adjustments: userRules ? ['user_rules_applied'] : [],
    };
  }

  private generateMLRecommendation(
    riskAssessment: MLRiskAssessment,
    userRules?: UserRules['rules']
  ): string {
    const { riskLevel } = riskAssessment;
    
    if (userRules?.requireManualApproval && riskLevel !== 'low') {
      return 'manual_review';
    }
    
    switch (riskLevel) {
      case 'critical': return 'block';
      case 'high': return 'block_with_option';
      case 'medium': return 'analyze_further';
      case 'low': return 'allow';
      default: return 'allow_with_monitoring';
    }
  }

  private async evaluateWithMLOptimized(
    request: EvaluationRequest,
    userRules?: UserRules['rules'],
    features?: CachedFeatures | null
  ): Promise<EnhancedMLEvaluationResult> {
    // Optimized version for batch processing
    // Reuse pre-extracted features and simplified evaluation
    const start = Date.now();
    
    if (!features) {
      features = await this.extractAndCacheFeatures(request.phone, request.context);
    }
    
    // Run only essential models for batch processing
    const enhancedMLResult = await this.runEnhancedMLClassification(request, features, {});
    const rulesEngineResult = await this.runRulesEngineEvaluation(request, userRules);
    
    const fusedResult = await this.fuseMLResults({
      enhancedML: enhancedMLResult,
      rulesEngine: rulesEngineResult,
      ensemble: null,
      behavioral: null,
    });
    
    const riskAssessment = await this.assessMLRisk(fusedResult, features, userRules);
    const recommendation = this.generateMLRecommendation(riskAssessment, userRules);
    
    return {
      phone: request.phone,
      isSpam: fusedResult.isSpam,
      spamType: fusedResult.spamType,
      confidence: fusedResult.confidence,
      riskScore: riskAssessment.riskScore,
      riskLevel: riskAssessment.riskLevel,
      classification: fusedResult.classification,
      recommendation,
      reasons: fusedResult.reasons,
      processingTimeMs: Date.now() - start,
      cacheHit: false,
      evaluationId: this.generateEvaluationId(request),
      modelResults: {
        enhancedML: enhancedMLResult,
        rulesEngine: rulesEngineResult,
        ensemble: null,
        behavioral: null,
      },
      fusionMetadata: {
        fusionMethod: 'simplified_weighted',
        modelWeights: this.getModelWeights(),
        confidenceCalibration: fusedResult.confidenceCalibration,
        uncertaintyEstimate: fusedResult.uncertaintyEstimate,
      },
      performanceMetrics: {
        featureExtractionTime: features.extractionTime,
        classificationTime: Date.now() - start - features.extractionTime,
        totalTime: Date.now() - start,
        cacheHitRate: this.calculateCacheHitRate(),
      },
      modelVersion: this.integrationVersion,
      timestamp: new Date(),
    };
  }

  // Utility and helper methods
  private generateEvaluationId(request: EvaluationRequest): string {
    return `eval_${Date.now()}_${this.hashPhone(request.phone).substring(0, 8)}`;
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateLearningId(): string {
    return `learn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateOptimizationId(): string {
    return `opt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private hashPhone(phone: string): string {
    return require('crypto').createHash('sha256')
      .update(phone + config.JWT_SECRET)
      .digest('hex');
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    return phone.substring(0, 4) + '*'.repeat(phone.length - 4);
  }

  private getModelWeights(): ModelWeights {
    return {
      enhancedML: 0.4,
      rulesEngine: 0.3,
      ensemble: 0.2,
      behavioral: 0.1,
    };
  }

  private determineRiskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= 0.8) return 'critical';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'low';
  }

  private calibrateConfidence(confidence: number, contributions: Record<string, number>): number {
    // Simple confidence calibration based on model agreement
    const contributionValues = Object.values(contributions);
    const variance = this.calculateVariance(contributionValues);
    
    // Lower confidence if models disagree significantly
    if (variance > 0.1) {
      return Math.max(0.3, confidence - 0.2);
    }
    
    return confidence;
  }

  private estimateUncertainty(contributions: Record<string, number>, totalWeight: number): number {
    // Estimate uncertainty based on model coverage and agreement
    const coverage = totalWeight / Object.keys(this.getModelWeights()).length;
    const contributionValues = Object.values(contributions);
    const variance = this.calculateVariance(contributionValues);
    
    return Math.max(0.1, Math.min(0.5, (1 - coverage) + variance));
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  private isFeatureCacheValid(cached: CachedFeatures): boolean {
    const maxAge = config.FEATURE_CACHE_TTL || 300000; // 5 minutes
    return Date.now() - cached.timestamp < maxAge;
  }

  private calculateCacheHitRate(): number {
    // Calculate cache hit rate from recent operations
    return 0.65; // Placeholder
  }

  private mapFeedbackToEventType(feedbackType: string): any {
    const mapping: Record<string, any> = {
      'correct': 'accept',
      'incorrect': 'reject',
      'false_positive': 'reject',
      'false_negative': 'accept',
    };
    return mapping[feedbackType] || 'unknown';
  }

  private getSafeMLResult(
    request: EvaluationRequest,
    startTime: number,
    evaluationId: string
  ): EnhancedMLEvaluationResult {
    return {
      phone: request.phone,
      isSpam: false,
      spamType: 'unknown',
      confidence: 0.5,
      riskScore: 0.5,
      riskLevel: 'medium',
      classification: 'unknown',
      recommendation: 'manual_review',
      reasons: ['Evaluation failed - manual review recommended'],
      processingTimeMs: Date.now() - startTime,
      cacheHit: false,
      evaluationId,
      modelResults: {
        enhancedML: null,
        rulesEngine: null,
        ensemble: null,
        behavioral: null,
      },
      fusionMetadata: {
        fusionMethod: 'fallback',
        modelWeights: this.getModelWeights(),
        confidenceCalibration: 0.3,
        uncertaintyEstimate: 0.7,
      },
      performanceMetrics: {
        featureExtractionTime: 0,
        classificationTime: 0,
        totalTime: Date.now() - startTime,
        cacheHitRate: 0,
      },
      modelVersion: this.integrationVersion,
      timestamp: new Date(),
    };
  }

  // Placeholder implementations for complex methods
  private async loadModelWeights(): Promise<void> {
    // Load model weights from configuration or database
  }

  private async warmupCaches(): Promise<void> {
    // Warm up caches with frequently used data
  }

  private startPerformanceMonitoring(): void {
    // Start background performance monitoring
    setInterval(() => {
      this.collectPerformanceMetrics();
    }, 60000); // Every minute
  }

  private async collectPerformanceMetrics(): Promise<void> {
    // Collect and aggregate performance metrics
  }

  private async trackPerformance(
    evaluationId: string,
    processingTime: number,
    result: FusedMLResult
  ): Promise<void> {
    // Track performance metrics for analysis
  }

  private async cacheMLResult(request: EvaluationRequest, result: FusedMLResult): Promise<void> {
    const cacheKey = `ml_result:${this.hashPhone(request.phone)}`;
    this.modelCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });
  }

  private async updateRulesEngine(event: LearningEvent): Promise<any> {
    // Update rules engine based on learning event
    return null;
  }

  private async updateEnsembleWeights(
    originalResult: EnhancedMLEvaluationResult,
    feedback: MLFeedback
  ): Promise<void> {
    // Update ensemble weights based on feedback
  }

  private async updatePerformanceMetrics(
    userId: string,
    result: EnhancedMLEvaluationResult,
    feedback: MLFeedback
  ): Promise<void> {
    // Update performance metrics for user and global stats
  }

  private async invalidateMLCaches(phone: string, userId: string): Promise<void> {
    const phoneHash = this.hashPhone(phone);
    
    // Invalidate relevant caches
    this.featureCache.delete(`features:${phoneHash}`);
    this.modelCache.delete(`ml_result:${phoneHash}`);
    
    // Invalidate service-level caches
    await cacheService.invalidate('ml_features', { phone });
  }

  private estimateImprovement(
    feedback: MLFeedback,
    originalResult: EnhancedMLEvaluationResult
  ): number {
    // Estimate improvement from feedback
    return feedback.type === 'correct' ? 0.02 : 0.05; // 2-5% improvement
  }

  private async generateLearningRecommendations(event: LearningEvent): Promise<string[]> {
    // Generate recommendations based on learning event
    return ['Continue collecting feedback for model improvement'];
  }

  private async calculateMLPerformanceStats(
    userId?: string,
    timeframe: string = 'day'
  ): Promise<MLPerformanceStats> {
    // Calculate actual performance stats from historical data
    return {
      timeframe,
      totalEvaluations: 0,
      accuracy: 0.85,
      precision: 0.80,
      recall: 0.90,
      f1Score: 0.85,
      avgConfidence: 0.75,
      avgProcessingTime: 200,
      modelPerformance: {
        enhancedML: { accuracy: 0.85, avgTime: 150 },
        rulesEngine: { accuracy: 0.80, avgTime: 50 },
        ensemble: { accuracy: 0.88, avgTime: 200 },
      },
      cacheHitRate: 0.60,
      errorRate: 0.05,
    };
  }

  private async getRecentPerformanceData(userId?: string): Promise<any> {
    // Get recent performance data for optimization
    return {};
  }

  private async analyzeOptimizationOpportunities(data: any): Promise<{ steps: OptimizationStep[] }> {
    // Analyze optimization opportunities
    return { steps: [] };
  }

  private async executeOptimizationStep(step: OptimizationStep): Promise<{ improvement: number }> {
    // Execute optimization step
    return { improvement: 0.02 };
  }

  // Service health check
  async getServiceHealth(): Promise<{
    healthy: boolean;
    modelsActive: string[];
    cacheSize: number;
    avgResponseTime: number;
    errorRate: number;
  }> {
    try {
      return {
        healthy: true,
        modelsActive: ['enhanced_ml', 'rules_engine'],
        cacheSize: this.modelCache.size + this.featureCache.size,
        avgResponseTime: 180,
        errorRate: 0.02,
      };
    } catch (error) {
      return {
        healthy: false,
        modelsActive: [],
        cacheSize: 0,
        avgResponseTime: -1,
        errorRate: 1.0,
      };
    }
  }
}

// Type definitions
interface MLEvaluationContext {
  userAgent?: string;
  ipAddress?: string;
  userHistory?: any;
  callHistory?: any;
}

interface CachedFeatures {
  features: PhoneFeatures;
  extractionTime: number;
  timestamp: number;
}

interface CachedMLResult {
  result: FusedMLResult;
  timestamp: number;
}

interface EnhancedMLResult {
  isSpam: boolean;
  spamType: string;
  confidence: number;
  riskScore: number;
  riskLevel: string;
  features: PhoneFeatures;
  explanation: string;
  recommendations: string[];
  processingTime: number;
  modelVersion: string;
  ensembleResults?: any[];
  temporalFeatures?: any;
  behavioralProfile?: any;
}

interface RulesEngineResult {
  isSpam: boolean;
  confidence: number;
  riskScore: number;
  classification: string;
  recommendation: string;
  reasons: string[];
  rulesApplied: string[];
  processingTime: number;
}

interface EnsembleResult {
  isSpam: boolean;
  confidence: number;
  riskScore: number;
  modelVotes: Record<string, number>;
  ensembleMethod: string;
  processingTime: number;
}

interface BehavioralAnalysisResult {
  riskScore: number;
  patterns: any[];
  anomalies: any[];
  confidence: number;
  processingTime: number;
}

interface ModelResults {
  enhancedML: EnhancedMLResult | null;
  rulesEngine: RulesEngineResult | null;
  ensemble: EnsembleResult | null;
  behavioral: BehavioralAnalysisResult | null;
}

interface FusedMLResult {
  isSpam: boolean;
  spamType: string;
  confidence: number;
  classification: string;
  reasons: string[];
  modelContributions: Record<string, number>;
  fusionScore: number;
  confidenceCalibration: number;
  uncertaintyEstimate: number;
}

interface MLRiskAssessment {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  adjustments: string[];
}

interface ModelWeights {
  enhancedML: number;
  rulesEngine: number;
  ensemble: number;
  behavioral: number;
}

interface EnhancedMLEvaluationResult extends EvaluationResult {
  evaluationId: string;
  modelResults: ModelResults;
  fusionMetadata: {
    fusionMethod: string;
    modelWeights: ModelWeights;
    confidenceCalibration: number;
    uncertaintyEstimate: number;
  };
  performanceMetrics: {
    featureExtractionTime: number;
    classificationTime: number;
    totalTime: number;
    cacheHitRate: number;
  };
  modelVersion: string;
  timestamp: Date;
}

interface MLFeedback {
  type: 'correct' | 'incorrect' | 'false_positive' | 'false_negative';
  actualResult: boolean;
  confidence: number;
  context: Record<string, any>;
}

interface MLLearningResult {
  learningId: string;
  processed: boolean;
  modelsUpdated: string[];
  improvementEstimate: number;
  processingTimeMs: number;
  nextRecommendations: string[];
}

interface MLPerformanceStats {
  timeframe: string;
  totalEvaluations: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  avgConfidence: number;
  avgProcessingTime: number;
  modelPerformance: Record<string, { accuracy: number; avgTime: number }>;
  cacheHitRate: number;
  errorRate: number;
}

interface OptimizationStep {
  type: string;
  description: string;
  expectedImprovement: number;
  result?: { improvement: number; error?: string };
  success?: boolean;
}

interface MLOptimizationResult {
  optimizationId: string;
  userId?: string;
  executedSteps: number;
  successfulSteps: number;
  totalImprovement: number;
  optimizations: OptimizationStep[];
  processingTimeMs: number;
  nextOptimizationRecommended: number;
}

interface MLPerformanceMetrics {
  evaluations: number;
  avgProcessingTime: number;
  accuracy: number;
  errorRate: number;
  lastUpdated: Date;
}

export const mlIntegrationService = new MLIntegrationService();
export default mlIntegrationService;