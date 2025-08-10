import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { db } from '@/utils/database';
import { cacheService } from '@/cache/cache-service';
import { logger } from '@/utils/logger';
import { config } from '@/config';
import {
  SmartWhitelist,
  CreateWhitelistRequest,
  UpdateWhitelistRequest,
  SmartAddRequest,
  EvaluationRequest,
  EvaluationResult,
  LearningEvent,
  UserRules,
  SpamProfile,
  WhitelistError,
  NotFoundError,
  ConflictError,
  ValidationError,
  WhitelistType,
  SpamCategory,
} from '@/types';

export class WhitelistService {
  private learningQueue: LearningEvent[] = [];
  private processingLearningEvents = false;

  constructor() {
    // Start background processing
    this.startBackgroundProcessing();
  }

  // Core CRUD Operations

  /**
   * Get whitelist entries for a user with pagination and filtering
   */
  async getUserWhitelist(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      active?: boolean;
      type?: WhitelistType;
      search?: string;
    } = {}
  ): Promise<{
    entries: SmartWhitelist[];
    total: number;
    page: number;
    pages: number;
  }> {
    const { page = 1, limit = 50, active, type, search } = options;
    const offset = (page - 1) * limit;

    try {
      let whereConditions = ['user_id = $1'];
      let params: any[] = [userId];
      let paramIndex = 2;

      if (active !== undefined) {
        whereConditions.push(`is_active = $${paramIndex}`);
        params.push(active);
        paramIndex++;
      }

      if (type) {
        whereConditions.push(`whitelist_type = $${paramIndex}`);
        params.push(type);
        paramIndex++;
      }

      if (search) {
        whereConditions.push(`(contact_phone ILIKE $${paramIndex} OR contact_name ILIKE $${paramIndex})`);
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Add expiration check
      whereConditions.push('(expires_at IS NULL OR expires_at > NOW())');

      const whereClause = whereConditions.join(' AND ');

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM smart_whitelists 
        WHERE ${whereClause}
      `;
      const countResult = await db.queryOne<{ total: string }>(countQuery, params);
      const total = parseInt(countResult?.total || '0', 10);

      // Get entries
      const entriesQuery = `
        SELECT 
          id, user_id, contact_phone, contact_name,
          whitelist_type, confidence_score, is_active,
          expires_at, hit_count, last_hit_at,
          created_at, updated_at
        FROM smart_whitelists 
        WHERE ${whereClause}
        ORDER BY updated_at DESC, hit_count DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);

      const entries = await db.queryMany<SmartWhitelist>(entriesQuery, params);

      // Cache frequently accessed entries
      if (entries.length > 0) {
        await cacheService.cacheMultipleWhitelistEntries(entries);
      }

      return {
        entries,
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Failed to get user whitelist', {
        userId,
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Failed to retrieve whitelist entries', 'GET_WHITELIST_FAILED');
    }
  }

  /**
   * Create a new whitelist entry
   */
  async createWhitelistEntry(request: CreateWhitelistRequest): Promise<SmartWhitelist> {
    try {
      // Check if entry already exists
      const existingEntry = await this.findExistingEntry(request.userId, request.contactPhone);
      if (existingEntry) {
        throw new ConflictError('Phone number already in whitelist');
      }

      const entry: SmartWhitelist = {
        id: uuidv4(),
        userId: request.userId,
        contactPhone: request.contactPhone,
        contactName: request.contactName,
        whitelistType: request.whitelistType,
        confidenceScore: request.confidenceScore,
        isActive: true,
        expiresAt: request.expiresAt,
        hitCount: 0,
        lastHitAt: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const insertQuery = `
        INSERT INTO smart_whitelists (
          id, user_id, contact_phone, contact_name,
          whitelist_type, confidence_score, is_active,
          expires_at, hit_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const result = await db.queryOne<SmartWhitelist>(insertQuery, [
        entry.id,
        entry.userId,
        entry.contactPhone,
        entry.contactName,
        entry.whitelistType,
        entry.confidenceScore,
        entry.isActive,
        entry.expiresAt,
        entry.hitCount,
        entry.createdAt,
        entry.updatedAt,
      ]);

      if (!result) {
        throw new WhitelistError('Failed to create whitelist entry', 'CREATE_FAILED');
      }

      // Cache the new entry
      await cacheService.cacheWhitelistEntry(result);

      logger.info('Whitelist entry created', {
        id: result.id,
        userId: result.userId,
        phone: this.maskPhone(result.contactPhone),
        type: result.whitelistType,
      });

      return result;
    } catch (error) {
      if (error instanceof WhitelistError) {
        throw error;
      }

      logger.error('Failed to create whitelist entry', {
        request,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Failed to create whitelist entry', 'CREATE_FAILED');
    }
  }

  /**
   * Update an existing whitelist entry
   */
  async updateWhitelistEntry(
    id: string,
    userId: string,
    request: UpdateWhitelistRequest
  ): Promise<SmartWhitelist> {
    try {
      const existing = await this.getWhitelistEntry(id, userId);
      if (!existing) {
        throw new NotFoundError('Whitelist entry not found');
      }

      const updateFields: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (request.contactName !== undefined) {
        updateFields.push(`contact_name = $${paramIndex}`);
        params.push(request.contactName);
        paramIndex++;
      }

      if (request.whitelistType) {
        updateFields.push(`whitelist_type = $${paramIndex}`);
        params.push(request.whitelistType);
        paramIndex++;
      }

      if (request.confidenceScore !== undefined) {
        updateFields.push(`confidence_score = $${paramIndex}`);
        params.push(request.confidenceScore);
        paramIndex++;
      }

      if (request.isActive !== undefined) {
        updateFields.push(`is_active = $${paramIndex}`);
        params.push(request.isActive);
        paramIndex++;
      }

      if (request.expiresAt !== undefined) {
        updateFields.push(`expires_at = $${paramIndex}`);
        params.push(request.expiresAt);
        paramIndex++;
      }

      updateFields.push(`updated_at = $${paramIndex}`);
      params.push(new Date());
      paramIndex++;

      params.push(id, userId);

      const updateQuery = `
        UPDATE smart_whitelists 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex - 1} AND user_id = $${paramIndex}
        RETURNING *
      `;

      const result = await db.queryOne<SmartWhitelist>(updateQuery, params);
      if (!result) {
        throw new NotFoundError('Whitelist entry not found or update failed');
      }

      // Update cache
      await cacheService.cacheWhitelistEntry(result);

      logger.info('Whitelist entry updated', {
        id: result.id,
        userId: result.userId,
        phone: this.maskPhone(result.contactPhone),
        changes: Object.keys(request),
      });

      return result;
    } catch (error) {
      if (error instanceof WhitelistError) {
        throw error;
      }

      logger.error('Failed to update whitelist entry', {
        id,
        userId,
        request,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Failed to update whitelist entry', 'UPDATE_FAILED');
    }
  }

  /**
   * Delete a whitelist entry
   */
  async deleteWhitelistEntry(id: string, userId: string): Promise<boolean> {
    try {
      const entry = await this.getWhitelistEntry(id, userId);
      if (!entry) {
        throw new NotFoundError('Whitelist entry not found');
      }

      const deleteQuery = `
        DELETE FROM smart_whitelists 
        WHERE id = $1 AND user_id = $2
      `;

      const result = await db.query(deleteQuery, [id, userId]);
      
      if (result.rowCount === 0) {
        throw new NotFoundError('Whitelist entry not found');
      }

      // Invalidate cache
      await cacheService.invalidate('whitelist', { userId, phone: entry.contactPhone });

      logger.info('Whitelist entry deleted', {
        id,
        userId,
        phone: this.maskPhone(entry.contactPhone),
      });

      return true;
    } catch (error) {
      if (error instanceof WhitelistError) {
        throw error;
      }

      logger.error('Failed to delete whitelist entry', {
        id,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Failed to delete whitelist entry', 'DELETE_FAILED');
    }
  }

  /**
   * Smart evaluation of a phone number
   */
  async evaluatePhone(request: EvaluationRequest): Promise<EvaluationResult> {
    const start = Date.now();

    try {
      // First check cache for whitelist status
      if (request.userId) {
        const cacheResult = await cacheService.fastWhitelistLookup(request.userId, request.phone);
        if (cacheResult.found) {
          return {
            phone: request.phone,
            isWhitelisted: true,
            confidenceScore: cacheResult.entry!.confidenceScore,
            riskScore: 1 - cacheResult.entry!.confidenceScore,
            classification: 'whitelisted',
            recommendation: 'allow',
            reasons: ['Phone number is in user\'s whitelist'],
            processingTimeMs: Date.now() - start,
            cacheHit: true,
          };
        }
      }

      // Check spam profile
      const phoneHash = this.hashPhone(request.phone);
      const spamProfile = await cacheService.getSpamProfile(phoneHash);
      
      let result: EvaluationResult = {
        phone: request.phone,
        isWhitelisted: false,
        confidenceScore: 0.5,
        riskScore: 0.5,
        classification: 'unknown',
        recommendation: 'analyze',
        reasons: ['No prior information available'],
        processingTimeMs: 0,
        cacheHit: !!spamProfile,
      };

      if (spamProfile) {
        result.confidenceScore = 1 - spamProfile.riskScore;
        result.riskScore = spamProfile.riskScore;
        result.classification = `spam_${spamProfile.spamCategory}`;
        
        if (spamProfile.riskScore > 0.8) {
          result.recommendation = 'block';
          result.reasons = [`High risk spam: ${spamProfile.spamCategory}`];
        } else if (spamProfile.riskScore > 0.6) {
          result.recommendation = 'analyze';
          result.reasons = [`Potential spam: ${spamProfile.spamCategory}`];
        } else {
          result.recommendation = 'allow';
          result.reasons = ['Low risk contact'];
        }
      } else {
        // No spam profile, apply basic heuristics
        result = await this.applyBasicHeuristics(request.phone, result);
      }

      result.processingTimeMs = Date.now() - start;

      // Record evaluation for learning
      this.queueLearningEvent({
        userId: request.userId || '',
        phone: request.phone,
        eventType: 'accept', // Default, will be updated based on actual user interaction
        confidence: result.confidenceScore,
        features: {},
        context: { evaluation: result, ...request.context },
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      logger.error('Phone evaluation failed', {
        phone: this.maskPhone(request.phone),
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        phone: request.phone,
        isWhitelisted: false,
        confidenceScore: 0.5,
        riskScore: 0.5,
        classification: 'error',
        recommendation: 'analyze',
        reasons: ['Evaluation failed'],
        processingTimeMs: Date.now() - start,
        cacheHit: false,
      };
    }
  }

  /**
   * Smart add functionality with ML assistance
   */
  async smartAdd(request: SmartAddRequest): Promise<SmartWhitelist> {
    try {
      // Evaluate phone number first
      const evaluation = await this.evaluatePhone({
        phone: request.contactPhone,
        userId: request.userId,
        context: { smartAdd: true, tags: request.tags },
      });

      // Determine whitelist type based on evaluation
      let whitelistType: WhitelistType = 'manual';
      let confidence = request.confidence;

      if (evaluation.classification === 'spam_sales' || evaluation.classification === 'spam_loan') {
        // User is manually adding a known spam number - respect their decision but with lower confidence
        whitelistType = 'manual';
        confidence = Math.min(0.7, request.confidence); // Cap confidence for known spam
      } else if (evaluation.confidenceScore > config.ML_AUTO_LEARN_THRESHOLD) {
        whitelistType = 'auto';
        confidence = evaluation.confidenceScore;
      } else if (request.context === 'user_interaction') {
        whitelistType = 'learned';
      }

      const createRequest: CreateWhitelistRequest = {
        userId: request.userId,
        contactPhone: request.contactPhone,
        contactName: request.contactName,
        whitelistType,
        confidenceScore: confidence,
        expiresAt: request.expiresAt,
      };

      const entry = await this.createWhitelistEntry(createRequest);

      // Record learning event
      this.queueLearningEvent({
        userId: request.userId,
        phone: request.contactPhone,
        eventType: 'manual_add',
        confidence,
        features: evaluation.mlFeatures || {},
        context: { tags: request.tags, smartAdd: true },
        timestamp: new Date(),
      });

      logger.info('Smart add completed', {
        userId: request.userId,
        phone: this.maskPhone(request.contactPhone),
        type: whitelistType,
        confidence,
        evaluationClass: evaluation.classification,
      });

      return entry;
    } catch (error) {
      if (error instanceof WhitelistError) {
        throw error;
      }

      logger.error('Smart add failed', {
        request,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Smart add failed', 'SMART_ADD_FAILED');
    }
  }

  /**
   * Record learning feedback from user interactions
   */
  async recordLearning(event: LearningEvent): Promise<void> {
    this.queueLearningEvent(event);
    
    logger.debug('Learning event recorded', {
      userId: event.userId,
      phone: this.maskPhone(event.phone),
      eventType: event.eventType,
      confidence: event.confidence,
    });
  }

  /**
   * Update user-specific rules
   */
  async updateUserRules(userId: string, rules: UserRules['rules']): Promise<void> {
    try {
      // Store rules in user_configs table
      const configKey = 'whitelist_rules';
      
      const upsertQuery = `
        INSERT INTO user_configs (id, user_id, config_key, config_value, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, config_key)
        DO UPDATE SET 
          config_value = EXCLUDED.config_value,
          updated_at = EXCLUDED.updated_at
      `;

      await db.query(upsertQuery, [
        uuidv4(),
        userId,
        configKey,
        JSON.stringify(rules),
        new Date(),
      ]);

      // Invalidate user cache
      await cacheService.invalidateUserCache(userId);

      logger.info('User rules updated', { userId, rules });
    } catch (error) {
      logger.error('Failed to update user rules', {
        userId,
        rules,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new WhitelistError('Failed to update user rules', 'UPDATE_RULES_FAILED');
    }
  }

  /**
   * Get user rules
   */
  async getUserRules(userId: string): Promise<UserRules['rules']> {
    try {
      // Try cache first
      const cached = await cacheService.getUserConfig(userId);
      if (cached?.whitelist_rules) {
        return cached.whitelist_rules;
      }

      // Query database
      const query = `
        SELECT config_value 
        FROM user_configs 
        WHERE user_id = $1 AND config_key = 'whitelist_rules'
      `;

      const result = await db.queryOne<{ config_value: any }>(query, [userId]);
      const rules = result?.config_value || this.getDefaultRules();

      // Cache the result
      await cacheService.cacheUserConfig(userId, { whitelist_rules: rules });

      return rules;
    } catch (error) {
      logger.error('Failed to get user rules', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getDefaultRules();
    }
  }

  // Private helper methods

  private async findExistingEntry(userId: string, phone: string): Promise<SmartWhitelist | null> {
    const query = `
      SELECT * FROM smart_whitelists 
      WHERE user_id = $1 AND contact_phone = $2
    `;
    return await db.queryOne<SmartWhitelist>(query, [userId, phone]);
  }

  private async getWhitelistEntry(id: string, userId: string): Promise<SmartWhitelist | null> {
    const query = `
      SELECT * FROM smart_whitelists 
      WHERE id = $1 AND user_id = $2
    `;
    return await db.queryOne<SmartWhitelist>(query, [id, userId]);
  }

  private async applyBasicHeuristics(phone: string, result: EvaluationResult): Promise<EvaluationResult> {
    const patterns = {
      repeatingDigits: /(\d)\1{3,}/,
      sequential: /(012|123|234|345|456|567|678|789|987|876|765|654|543|432|321|210)/,
      commonSpam: /(400|800|888|999|000)/,
    };

    const reasons: string[] = [];
    let riskScore = 0.3; // Base risk score

    if (patterns.repeatingDigits.test(phone)) {
      riskScore += 0.2;
      reasons.push('Contains repeating digit patterns');
    }

    if (patterns.sequential.test(phone)) {
      riskScore += 0.15;
      reasons.push('Contains sequential digit patterns');
    }

    if (patterns.commonSpam.test(phone)) {
      riskScore += 0.25;
      reasons.push('Contains common spam number patterns');
    }

    // Phone length and format checks
    if (phone.length < 10 || phone.length > 15) {
      riskScore += 0.3;
      reasons.push('Unusual phone number length');
    }

    result.riskScore = Math.min(riskScore, 1.0);
    result.confidenceScore = 1 - result.riskScore;

    if (result.riskScore > 0.7) {
      result.classification = 'likely_spam';
      result.recommendation = 'block';
      result.reasons = reasons;
    } else if (result.riskScore > 0.4) {
      result.classification = 'suspicious';
      result.recommendation = 'analyze';
      result.reasons = reasons.length > 0 ? reasons : ['Moderately suspicious pattern'];
    } else {
      result.classification = 'legitimate';
      result.recommendation = 'allow';
      result.reasons = ['Passed basic pattern checks'];
    }

    return result;
  }

  private queueLearningEvent(event: LearningEvent): void {
    this.learningQueue.push(event);
    
    // Process queue if it's getting full
    if (this.learningQueue.length >= config.ML_LEARNING_QUEUE_SIZE / 2) {
      this.processLearningQueue();
    }
  }

  private async processLearningQueue(): Promise<void> {
    if (this.processingLearningEvents || this.learningQueue.length === 0) {
      return;
    }

    this.processingLearningEvents = true;

    try {
      const events = this.learningQueue.splice(0, 50); // Process in batches
      
      for (const event of events) {
        await this.processLearningEvent(event);
      }

      logger.debug('Processed learning events', { count: events.length });
    } catch (error) {
      logger.error('Failed to process learning queue', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.processingLearningEvents = false;
    }
  }

  private async processLearningEvent(event: LearningEvent): Promise<void> {
    try {
      // Update or create spam profile based on learning
      const phoneHash = this.hashPhone(event.phone);
      
      if (event.eventType === 'reject' || (event.feedback && event.feedback === 'spam')) {
        await this.updateSpamProfile(phoneHash, event);
      }

      // Update user interaction statistics
      if (event.userId) {
        await this.updateUserInteractionStats(event);
      }

      logger.debug('Learning event processed', {
        userId: event.userId,
        phone: this.maskPhone(event.phone),
        eventType: event.eventType,
      });
    } catch (error) {
      logger.error('Failed to process learning event', {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateSpamProfile(phoneHash: string, event: LearningEvent): Promise<void> {
    try {
      // Check if spam profile exists
      let profile = await cacheService.getSpamProfile(phoneHash);
      
      if (!profile) {
        // Check database
        const query = `SELECT * FROM spam_profiles WHERE phone_hash = $1`;
        profile = await db.queryOne<SpamProfile>(query, [phoneHash]);
      }

      if (profile) {
        // Update existing profile
        const updateQuery = `
          UPDATE spam_profiles 
          SET 
            risk_score = LEAST(1.0, risk_score + $2),
            total_reports = total_reports + 1,
            last_activity = $3,
            last_updated = $3
          WHERE id = $1
          RETURNING *
        `;

        const riskIncrease = event.confidence * 0.1; // Gradual learning
        const updated = await db.queryOne<SpamProfile>(updateQuery, [
          profile.id,
          riskIncrease,
          new Date(),
        ]);

        if (updated) {
          await cacheService.cacheSpamProfile(updated);
        }
      } else {
        // Create new spam profile
        const newProfile: SpamProfile = {
          id: uuidv4(),
          phoneHash,
          spamCategory: this.inferSpamCategory(event),
          riskScore: Math.min(0.8, event.confidence),
          confidenceLevel: event.confidence,
          featureVector: event.features,
          behavioralPatterns: event.context,
          totalReports: 1,
          successfulBlocks: 0,
          falsePositiveCount: 0,
          firstReported: new Date(),
          lastActivity: new Date(),
          lastUpdated: new Date(),
          createdAt: new Date(),
        };

        const insertQuery = `
          INSERT INTO spam_profiles (
            id, phone_hash, spam_category, risk_score, confidence_level,
            feature_vector, behavioral_patterns, total_reports,
            successful_blocks, false_positive_count, first_reported,
            last_activity, last_updated, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `;

        await db.query(insertQuery, [
          newProfile.id,
          newProfile.phoneHash,
          newProfile.spamCategory,
          newProfile.riskScore,
          newProfile.confidenceLevel,
          JSON.stringify(newProfile.featureVector),
          JSON.stringify(newProfile.behavioralPatterns),
          newProfile.totalReports,
          newProfile.successfulBlocks,
          newProfile.falsePositiveCount,
          newProfile.firstReported,
          newProfile.lastActivity,
          newProfile.lastUpdated,
          newProfile.createdAt,
        ]);

        await cacheService.cacheSpamProfile(newProfile);
      }
    } catch (error) {
      logger.error('Failed to update spam profile', {
        phoneHash,
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateUserInteractionStats(event: LearningEvent): Promise<void> {
    // This would update user_spam_interactions table
    // Implementation details would depend on the specific analytics needs
    logger.debug('User interaction stats would be updated here', {
      userId: event.userId,
      eventType: event.eventType,
    });
  }

  private inferSpamCategory(event: LearningEvent): SpamCategory {
    // Basic inference based on context and features
    const context = JSON.stringify(event.context).toLowerCase();
    
    if (context.includes('loan') || context.includes('credit')) {
      return 'loan';
    } else if (context.includes('investment') || context.includes('stock')) {
      return 'investment';
    } else if (context.includes('insurance')) {
      return 'insurance';
    } else if (context.includes('sales') || context.includes('product')) {
      return 'sales';
    } else if (context.includes('scam') || context.includes('fraud')) {
      return 'scam';
    }
    
    return 'unknown';
  }

  private startBackgroundProcessing(): void {
    // Process learning queue every 30 seconds
    setInterval(() => {
      this.processLearningQueue();
    }, 30000);

    // Cleanup expired entries every hour
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 3600000);

    logger.info('Background processing started');
  }

  private async cleanupExpiredEntries(): Promise<void> {
    try {
      const deleteQuery = `
        DELETE FROM smart_whitelists 
        WHERE expires_at IS NOT NULL AND expires_at <= NOW()
      `;

      const result = await db.query(deleteQuery);
      
      if (result.rowCount && result.rowCount > 0) {
        logger.info('Cleaned up expired whitelist entries', { count: result.rowCount });
        
        // Clear related cache entries
        await cacheService.cleanup();
      }
    } catch (error) {
      logger.error('Failed to cleanup expired entries', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getDefaultRules(): UserRules['rules'] {
    return {
      autoLearnThreshold: config.ML_AUTO_LEARN_THRESHOLD,
      allowTemporary: true,
      maxTemporaryDuration: 24, // 24 hours
      blockKnownSpam: true,
      requireManualApproval: false,
      patterns: {
        allowedPrefixes: [],
        blockedPrefixes: [],
        allowedKeywords: [],
        blockedKeywords: [],
      },
    };
  }

  private hashPhone(phone: string): string {
    return crypto
      .createHash('sha256')
      .update(phone + config.JWT_SECRET) // Use secret as salt
      .digest('hex');
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    return phone.substring(0, 4) + '*'.repeat(phone.length - 4);
  }

  // Health check and statistics
  async healthCheck(): Promise<{
    healthy: boolean;
    queueSize: number;
    processingEvents: boolean;
  }> {
    return {
      healthy: true,
      queueSize: this.learningQueue.length,
      processingEvents: this.processingLearningEvents,
    };
  }

  async getServiceStats(): Promise<{
    totalEntries: number;
    activeEntries: number;
    learningQueueSize: number;
    cacheStats: any;
  }> {
    try {
      const totalEntries = await db.count('smart_whitelists');
      const activeEntries = await db.count('smart_whitelists', { is_active: true });
      const cacheStats = await cacheService.getCacheStatistics();

      return {
        totalEntries,
        activeEntries,
        learningQueueSize: this.learningQueue.length,
        cacheStats,
      };
    } catch (error) {
      logger.error('Failed to get service stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        totalEntries: 0,
        activeEntries: 0,
        learningQueueSize: this.learningQueue.length,
        cacheStats: {},
      };
    }
  }
}

export const whitelistService = new WhitelistService();
export default whitelistService;