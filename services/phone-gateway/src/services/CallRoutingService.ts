import logger from '../utils/logger';
import { DatabaseService } from './DatabaseService';
import { ServiceClient } from './ServiceClientManager';
import { 
  CallRoutingDecision, 
  WhitelistCheckResult, 
  UserProfile, 
  CallProcessingContext,
  IncomingCallEvent
} from '../types';

export class CallRoutingService {
  private dbService: DatabaseService;
  private serviceClient: ServiceClient;

  constructor(dbService: DatabaseService, serviceClient: ServiceClient) {
    this.dbService = dbService;
    this.serviceClient = serviceClient;
  }

  /**
   * Make routing decision for incoming call
   */
  async routeCall(callEvent: IncomingCallEvent): Promise<CallRoutingDecision> {
    const startTime = Date.now();
    
    try {
      logger.info({ 
        callId: callEvent.callId, 
        from: callEvent.from, 
        to: callEvent.to 
      }, 'Processing call routing decision');

      // Step 1: Get user profile
      const userProfile = await this.getUserProfile(callEvent.to);
      if (!userProfile) {
        return {
          action: 'reject',
          reason: 'User not found or inactive',
          confidence: 1.0
        };
      }

      // Step 2: Check whitelist
      const whitelistResult = await this.checkWhitelist(
        userProfile.id, 
        callEvent.from
      );

      // Step 3: Make routing decision
      const decision = await this.makeRoutingDecision(
        callEvent,
        userProfile,
        whitelistResult
      );

      // Step 4: Log decision and update metrics
      await this.logRoutingDecision(callEvent, decision, Date.now() - startTime);

      logger.info({
        callId: callEvent.callId,
        decision: decision.action,
        reason: decision.reason,
        confidence: decision.confidence,
        processingTime: Date.now() - startTime
      }, 'Call routing decision completed');

      return decision;

    } catch (error: any) {
      logger.error({ error, callEvent }, 'Failed to process call routing');
      
      // Return safe default decision
      return {
        action: 'ai_handle',
        reason: 'Routing error - defaulting to AI handling',
        confidence: 0.1
      };
    }
  }

  /**
   * Get user profile by phone number
   */
  private async getUserProfile(phoneNumber: string): Promise<UserProfile | null> {
    try {
      const query = `
        SELECT id, phone_number, name, personality, preferences, 
               created_at, updated_at
        FROM users 
        WHERE phone_number = $1 AND created_at IS NOT NULL
      `;
      
      const result = await this.dbService.query(query, [phoneNumber]);
      
      if (result.rows.length === 0) {
        logger.warn({ phoneNumber }, 'User profile not found');
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        phoneNumber: row.phone_number,
        name: row.name,
        personality: row.personality,
        preferences: row.preferences ? JSON.parse(row.preferences) : null,
        isActive: true
      };
    } catch (error: any) {
      logger.error({ error, phoneNumber }, 'Failed to get user profile');
      return null;
    }
  }

  /**
   * Check whitelist status
   */
  private async checkWhitelist(
    userId: string, 
    callerPhone: string
  ): Promise<WhitelistCheckResult> {
    try {
      // First check local database cache
      const localResult = await this.checkLocalWhitelist(userId, callerPhone);
      if (localResult.isWhitelisted) {
        return localResult;
      }

      // If not in local cache, check smart whitelist service
      const smartResult = await this.checkSmartWhitelist(userId, callerPhone);
      
      // Cache the result locally for faster future lookups
      if (smartResult.isWhitelisted) {
        await this.cacheWhitelistResult(userId, callerPhone, smartResult);
      }

      return smartResult;
    } catch (error: any) {
      logger.error({ error, userId, callerPhone }, 'Whitelist check failed');
      
      // Return safe default
      return {
        isWhitelisted: false,
        confidence: 0.0,
        source: 'manual',
        reason: 'Whitelist check error'
      };
    }
  }

  private async checkLocalWhitelist(
    userId: string, 
    callerPhone: string
  ): Promise<WhitelistCheckResult> {
    const query = `
      SELECT contact_phone, whitelist_type, confidence_score, expires_at
      FROM smart_whitelists 
      WHERE user_id = $1 AND contact_phone = $2 
        AND is_active = true 
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    
    const result = await this.dbService.query(query, [userId, callerPhone]);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        isWhitelisted: true,
        confidence: row.confidence_score || 1.0,
        source: row.whitelist_type as 'manual' | 'auto' | 'temporary',
        reason: 'Found in whitelist'
      };
    }

    return {
      isWhitelisted: false,
      confidence: 0.0,
      source: 'manual',
      reason: 'Not in whitelist'
    };
  }

  private async checkSmartWhitelist(
    userId: string, 
    callerPhone: string
  ): Promise<WhitelistCheckResult> {
    try {
      const response = await this.serviceClient.post('/whitelist/evaluate', {
        userId,
        callerPhone,
        context: 'incoming_call'
      });

      return {
        isWhitelisted: response.isWhitelisted || false,
        confidence: response.confidence || 0.0,
        source: response.source || 'auto',
        reason: response.reason || 'Smart whitelist evaluation'
      };
    } catch (error: any) {
      logger.warn({ error, userId, callerPhone }, 'Smart whitelist service unavailable');
      return {
        isWhitelisted: false,
        confidence: 0.0,
        source: 'manual',
        reason: 'Smart whitelist service unavailable'
      };
    }
  }

  private async cacheWhitelistResult(
    userId: string, 
    callerPhone: string, 
    result: WhitelistCheckResult
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO smart_whitelists (
          user_id, contact_phone, whitelist_type, 
          confidence_score, is_active, expires_at
        ) VALUES ($1, $2, $3, $4, true, $5)
        ON CONFLICT (user_id, contact_phone) 
        DO UPDATE SET 
          confidence_score = $4,
          updated_at = NOW()
      `;
      
      const expiresAt = result.source === 'temporary' 
        ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        : null;

      await this.dbService.query(query, [
        userId,
        callerPhone,
        result.source,
        result.confidence,
        expiresAt
      ]);

      logger.debug({ userId, callerPhone }, 'Cached whitelist result');
    } catch (error: any) {
      logger.error({ error, userId, callerPhone }, 'Failed to cache whitelist result');
    }
  }

  /**
   * Make the actual routing decision based on gathered information
   */
  private async makeRoutingDecision(
    callEvent: IncomingCallEvent,
    userProfile: UserProfile,
    whitelistResult: WhitelistCheckResult
  ): Promise<CallRoutingDecision> {
    
    // Priority 1: Whitelisted callers get transferred
    if (whitelistResult.isWhitelisted && whitelistResult.confidence > 0.7) {
      return {
        action: 'transfer',
        reason: `Whitelisted caller (${whitelistResult.source}, confidence: ${whitelistResult.confidence})`,
        targetNumber: userProfile.phoneNumber,
        confidence: whitelistResult.confidence
      };
    }

    // Priority 2: Check user preferences
    const preferences = userProfile.preferences || {};
    
    // Check if user has AI handling disabled
    if (preferences.aiHandlingEnabled === false) {
      return {
        action: 'reject',
        reason: 'AI handling disabled by user preference',
        confidence: 1.0
      };
    }

    // Check business hours preference
    if (preferences.businessHoursOnly && !this.isBusinessHours()) {
      return {
        action: 'ai_handle',
        reason: 'Outside business hours - AI handling',
        confidence: 0.8
      };
    }

    // Priority 3: Check if caller is known spam
    const spamCheck = await this.checkSpamDatabase(callEvent.from);
    if (spamCheck.isSpam && spamCheck.confidence > 0.9) {
      return {
        action: 'reject',
        reason: `High-confidence spam caller (${spamCheck.confidence})`,
        confidence: spamCheck.confidence
      };
    }

    // Priority 4: Default to AI handling for unknown callers
    return {
      action: 'ai_handle',
      reason: 'Unknown caller - AI handling',
      confidence: 0.6,
      metadata: {
        userPersonality: userProfile.personality,
        whitelistConfidence: whitelistResult.confidence
      }
    };
  }

  /**
   * Check if caller is known spam
   */
  private async checkSpamDatabase(callerPhone: string): Promise<{
    isSpam: boolean;
    confidence: number;
    category?: string;
  }> {
    try {
      const query = `
        SELECT spam_category, risk_score, confidence_level
        FROM spam_profiles 
        WHERE phone_hash = $1 AND risk_score > 0.5
      `;
      
      // Hash the phone number for privacy
      const phoneHash = require('crypto')
        .createHash('sha256')
        .update(callerPhone)
        .digest('hex');
      
      const result = await this.dbService.query(query, [phoneHash]);
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          isSpam: true,
          confidence: row.confidence_level,
          category: row.spam_category
        };
      }

      return { isSpam: false, confidence: 0.0 };
    } catch (error: any) {
      logger.error({ error, callerPhone }, 'Failed to check spam database');
      return { isSpam: false, confidence: 0.0 };
    }
  }

  /**
   * Check if current time is within business hours
   */
  private isBusinessHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Monday to Friday, 9 AM to 6 PM
    return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
  }

  /**
   * Log routing decision for analytics
   */
  private async logRoutingDecision(
    callEvent: IncomingCallEvent,
    decision: CallRoutingDecision,
    processingTime: number
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO call_routing_logs (
          call_id, caller_phone, target_phone, routing_action,
          routing_reason, confidence_score, processing_time,
          metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `;

      await this.dbService.query(query, [
        callEvent.callId,
        callEvent.from,
        callEvent.to,
        decision.action,
        decision.reason,
        decision.confidence || 0.0,
        processingTime,
        JSON.stringify({
          targetNumber: decision.targetNumber,
          metadata: decision.metadata
        })
      ]);

    } catch (error: any) {
      logger.error({ error, callEvent, decision }, 'Failed to log routing decision');
      // Don't throw - this is just logging
    }
  }

  /**
   * Get routing statistics
   */
  async getRoutingStats(timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<any> {
    try {
      let interval = '24 hours';
      switch (timeframe) {
        case 'hour': interval = '1 hour'; break;
        case 'week': interval = '7 days'; break;
      }

      const query = `
        SELECT 
          routing_action,
          COUNT(*) as count,
          AVG(confidence_score) as avg_confidence,
          AVG(processing_time) as avg_processing_time
        FROM call_routing_logs 
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY routing_action
        ORDER BY count DESC
      `;

      const result = await this.dbService.query(query);
      return result.rows;
    } catch (error: any) {
      logger.error({ error, timeframe }, 'Failed to get routing stats');
      return [];
    }
  }
}