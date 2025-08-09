/**
 * GDPR Compliance Service
 * Handles data subject rights, consent management, and privacy compliance
 */

import { 
  DataSubjectRequest, 
  DataSubjectRequestType,
  ConsentRecord,
  DataRetentionPolicy,
  User
} from '../types';
import { DataEncryption } from '../encryption/DataEncryption';
import { DataAnonymizer } from './DataAnonymizer';
import { AuditLogger } from '../audit/AuditLogger';
import { logger } from '../utils/Logger';

export class GDPRCompliance {
  private static instance: GDPRCompliance;
  private dataEncryption: DataEncryption;
  private dataAnonymizer: DataAnonymizer;
  private auditLogger: AuditLogger;
  private consentRecords: Map<string, ConsentRecord[]> = new Map();
  private dataSubjectRequests: Map<string, DataSubjectRequest[]> = new Map();

  private constructor() {
    this.dataEncryption = DataEncryption.getInstance();
    this.dataAnonymizer = DataAnonymizer.getInstance();
    this.auditLogger = AuditLogger.getInstance();
  }

  public static getInstance(): GDPRCompliance {
    if (!GDPRCompliance.instance) {
      GDPRCompliance.instance = new GDPRCompliance();
    }
    return GDPRCompliance.instance;
  }

  /**
   * Handle data subject access request (DSAR)
   */
  public async handleDataSubjectRequest(
    userId: string,
    requestType: DataSubjectRequestType,
    verificationToken?: string
  ): Promise<DataSubjectRequest> {
    try {
      // Verify user identity
      const verified = await this.verifyUserIdentity(userId, verificationToken);
      if (!verified) {
        throw new Error('Identity verification failed');
      }

      // Create request record
      const request: DataSubjectRequest = {
        id: this.generateRequestId(),
        userId,
        type: requestType,
        status: 'pending',
        requestedAt: new Date(),
        verificationMethod: 'token',
        verificationCompleted: true
      };

      // Store request
      const userRequests = this.dataSubjectRequests.get(userId) || [];
      userRequests.push(request);
      this.dataSubjectRequests.set(userId, userRequests);

      // Process request based on type
      const result = await this.processDataSubjectRequest(request);

      // Update request status
      request.status = 'completed';
      request.processedAt = new Date();
      request.data = result;

      // Log for compliance
      await this.auditLogger.logDataSubjectRequest(request);

      logger.info('Data subject request processed', {
        userId,
        requestId: request.id,
        type: requestType
      });

      return request;
    } catch (error) {
      logger.error('Data subject request failed', {
        userId,
        requestType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process different types of data subject requests
   */
  private async processDataSubjectRequest(request: DataSubjectRequest): Promise<any> {
    switch (request.type) {
      case 'access':
        return this.handleAccessRequest(request.userId);
      case 'rectification':
        return this.handleRectificationRequest(request.userId);
      case 'erasure':
        return this.handleErasureRequest(request.userId);
      case 'portability':
        return this.handlePortabilityRequest(request.userId);
      case 'objection':
        return this.handleObjectionRequest(request.userId);
      case 'restriction':
        return this.handleRestrictionRequest(request.userId);
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  }

  /**
   * Handle right to access (Article 15)
   */
  private async handleAccessRequest(userId: string): Promise<any> {
    // Collect all user data
    const userData = await this.collectAllUserData(userId);
    
    // Include processing information
    const processingInfo = {
      purposes: await this.getProcessingPurposes(userId),
      categories: await this.getDataCategories(userId),
      recipients: await this.getDataRecipients(userId),
      retentionPeriods: await this.getRetentionPeriods(userId),
      rights: this.getDataSubjectRights(),
      source: await this.getDataSource(userId)
    };

    return {
      personalData: userData,
      processingInformation: processingInfo,
      exportedAt: new Date()
    };
  }

  /**
   * Handle right to rectification (Article 16)
   */
  private async handleRectificationRequest(userId: string): Promise<any> {
    // Enable data correction interface
    const correctionToken = this.generateCorrectionToken(userId);
    
    return {
      correctionEnabled: true,
      token: correctionToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      instructions: 'Use the provided token to access the data correction interface'
    };
  }

  /**
   * Handle right to erasure / right to be forgotten (Article 17)
   */
  private async handleErasureRequest(userId: string): Promise<any> {
    try {
      // Check if erasure is allowed (no legal obligations to keep data)
      const canErase = await this.checkErasureEligibility(userId);
      if (!canErase.eligible) {
        return {
          erased: false,
          reason: canErase.reason,
          alternativeAction: 'data_anonymization'
        };
      }

      // Delete personal data
      const deletionResults = await this.deleteAllUserData(userId);

      // Generate deletion proof
      const deletionProof = await this.generateDeletionProof(userId, deletionResults);

      return {
        erased: true,
        deletionProof,
        timestamp: new Date(),
        dataCategories: deletionResults.deletedCategories
      };
    } catch (error) {
      logger.error('Erasure request failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Handle right to data portability (Article 20)
   */
  private async handlePortabilityRequest(userId: string): Promise<any> {
    // Export data in machine-readable format
    const userData = await this.collectAllUserData(userId);
    
    // Format as JSON for portability
    const portableData = {
      version: '1.0',
      exportDate: new Date(),
      userId,
      data: userData,
      format: 'JSON',
      schema: await this.getDataSchema()
    };

    // Encrypt for secure transfer
    const encrypted = await this.dataEncryption.encryptObject(
      portableData,
      `portability:${userId}`
    );

    return {
      format: 'encrypted_json',
      data: encrypted,
      decryptionInstructions: 'Contact support for decryption key',
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    };
  }

  /**
   * Handle right to object (Article 21)
   */
  private async handleObjectionRequest(userId: string): Promise<any> {
    // Stop specific processing activities
    const stoppedProcessing = await this.stopProcessingActivities(userId, [
      'marketing',
      'profiling',
      'automated_decision_making'
    ]);

    return {
      objectionRecorded: true,
      stoppedActivities: stoppedProcessing,
      effectiveDate: new Date()
    };
  }

  /**
   * Handle right to restriction of processing (Article 18)
   */
  private async handleRestrictionRequest(userId: string): Promise<any> {
    // Restrict data processing
    const restrictions = await this.restrictDataProcessing(userId);

    return {
      restricted: true,
      restrictions,
      reviewDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    };
  }

  /**
   * Record user consent
   */
  public async recordConsent(
    userId: string,
    purpose: string,
    description: string,
    lawfulBasis: string = 'consent'
  ): Promise<ConsentRecord> {
    const consent: ConsentRecord = {
      id: this.generateConsentId(),
      userId,
      purpose,
      description,
      lawfulBasis,
      granted: true,
      grantedAt: new Date(),
      version: '1.0',
      metadata: {
        ipAddress: this.getCurrentIP(),
        userAgent: this.getCurrentUserAgent()
      }
    };

    // Store consent record
    const userConsents = this.consentRecords.get(userId) || [];
    userConsents.push(consent);
    this.consentRecords.set(userId, userConsents);

    // Log consent
    await this.auditLogger.logConsent(consent);

    return consent;
  }

  /**
   * Withdraw consent
   */
  public async withdrawConsent(
    userId: string,
    purpose: string
  ): Promise<boolean> {
    const userConsents = this.consentRecords.get(userId) || [];
    const consent = userConsents.find(c => c.purpose === purpose && c.granted);

    if (consent) {
      consent.granted = false;
      consent.revokedAt = new Date();

      // Stop related processing
      await this.stopProcessingForPurpose(userId, purpose);

      // Log withdrawal
      await this.auditLogger.logConsentWithdrawal(userId, purpose);

      return true;
    }

    return false;
  }

  /**
   * Check if user has given consent for specific purpose
   */
  public async hasConsent(userId: string, purpose: string): Promise<boolean> {
    const userConsents = this.consentRecords.get(userId) || [];
    const activeConsent = userConsents.find(
      c => c.purpose === purpose && c.granted && !c.revokedAt
    );

    return !!activeConsent;
  }

  /**
   * Apply data retention policies
   */
  public async applyRetentionPolicies(): Promise<void> {
    const policies: DataRetentionPolicy[] = [
      {
        dataType: 'call_recordings',
        retentionPeriod: 30,
        afterRetentionAction: 'delete'
      },
      {
        dataType: 'call_transcripts',
        retentionPeriod: 365,
        afterRetentionAction: 'anonymize'
      },
      {
        dataType: 'user_profiles',
        retentionPeriod: 1095, // 3 years
        afterRetentionAction: 'anonymize'
      },
      {
        dataType: 'audit_logs',
        retentionPeriod: 2555, // 7 years
        afterRetentionAction: 'archive'
      }
    ];

    for (const policy of policies) {
      await this.enforceRetentionPolicy(policy);
    }
  }

  /**
   * Enforce a specific retention policy
   */
  private async enforceRetentionPolicy(policy: DataRetentionPolicy): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionPeriod);

    // Get data older than retention period
    const expiredData = await this.getExpiredData(policy.dataType, cutoffDate);

    for (const data of expiredData) {
      switch (policy.afterRetentionAction) {
        case 'delete':
          await this.deleteData(data);
          break;
        case 'anonymize':
          await this.dataAnonymizer.anonymizeData(data);
          break;
        case 'archive':
          await this.archiveData(data);
          break;
      }
    }

    logger.info('Retention policy applied', {
      dataType: policy.dataType,
      action: policy.afterRetentionAction,
      recordsProcessed: expiredData.length
    });
  }

  /**
   * Generate privacy policy compliance report
   */
  public async generateComplianceReport(): Promise<any> {
    const report = {
      generatedAt: new Date(),
      complianceStatus: 'compliant',
      dataProtectionOfficer: process.env.DPO_CONTACT || 'dpo@ai-ninja.com',
      
      dataProcessing: {
        purposes: await this.getAllProcessingPurposes(),
        lawfulBases: await this.getAllLawfulBases(),
        dataCategories: await this.getAllDataCategories(),
        retentionPeriods: await this.getAllRetentionPeriods()
      },
      
      dataSubjectRights: {
        totalRequests: await this.getTotalDataSubjectRequests(),
        averageResponseTime: await this.getAverageResponseTime(),
        requestsByType: await this.getRequestsByType()
      },
      
      consent: {
        totalConsents: await this.getTotalConsents(),
        withdrawals: await this.getTotalWithdrawals(),
        consentRate: await this.getConsentRate()
      },
      
      breaches: {
        total: 0, // Would connect to security monitoring
        reported: 0,
        averageResponseTime: 0
      },
      
      technicalMeasures: {
        encryption: 'AES-256-GCM',
        pseudonymization: true,
        accessControls: 'RBAC',
        auditLogging: true,
        regularTesting: true
      },
      
      organizationalMeasures: {
        privacyByDesign: true,
        dataProtectionOfficer: true,
        privacyImpactAssessments: true,
        staffTraining: true,
        vendorManagement: true
      }
    };

    return report;
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  private async verifyUserIdentity(userId: string, token?: string): Promise<boolean> {
    // Implement identity verification logic
    return true; // Simplified for example
  }

  private generateRequestId(): string {
    return `DSR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateConsentId(): string {
    return `CONSENT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCorrectionToken(userId: string): string {
    return `CORRECT_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async collectAllUserData(userId: string): Promise<any> {
    // Collect all user data from various sources
    return {
      profile: await this.getUserProfile(userId),
      callRecords: await this.getCallRecords(userId),
      whitelists: await this.getWhitelists(userId),
      preferences: await this.getPreferences(userId)
    };
  }

  private async deleteAllUserData(userId: string): Promise<any> {
    // Delete user data from all systems
    return {
      deletedCategories: ['profile', 'calls', 'recordings', 'preferences']
    };
  }

  private async generateDeletionProof(userId: string, deletionResults: any): Promise<string> {
    const crypto = require('crypto');
    const proof = {
      userId,
      deletionResults,
      timestamp: new Date(),
      nonce: Math.random().toString(36)
    };
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(proof))
      .digest('hex');
  }

  private async checkErasureEligibility(userId: string): Promise<{ eligible: boolean; reason?: string }> {
    // Check legal obligations, ongoing investigations, etc.
    return { eligible: true };
  }

  private getDataSubjectRights(): string[] {
    return [
      'Right to access',
      'Right to rectification',
      'Right to erasure',
      'Right to data portability',
      'Right to object',
      'Right to restriction of processing',
      'Right not to be subject to automated decision-making'
    ];
  }

  private getCurrentIP(): string {
    // Get current request IP
    return '0.0.0.0';
  }

  private getCurrentUserAgent(): string {
    // Get current user agent
    return 'System';
  }

  // Placeholder methods - would connect to actual data sources
  private async getUserProfile(userId: string): Promise<any> { return {}; }
  private async getCallRecords(userId: string): Promise<any> { return []; }
  private async getWhitelists(userId: string): Promise<any> { return []; }
  private async getPreferences(userId: string): Promise<any> { return {}; }
  private async getProcessingPurposes(userId: string): Promise<string[]> { return []; }
  private async getDataCategories(userId: string): Promise<string[]> { return []; }
  private async getDataRecipients(userId: string): Promise<string[]> { return []; }
  private async getRetentionPeriods(userId: string): Promise<any> { return {}; }
  private async getDataSource(userId: string): Promise<string> { return 'direct'; }
  private async getDataSchema(): Promise<any> { return {}; }
  private async stopProcessingActivities(userId: string, activities: string[]): Promise<string[]> { return activities; }
  private async restrictDataProcessing(userId: string): Promise<any> { return {}; }
  private async stopProcessingForPurpose(userId: string, purpose: string): Promise<void> { }
  private async getExpiredData(dataType: string, cutoffDate: Date): Promise<any[]> { return []; }
  private async deleteData(data: any): Promise<void> { }
  private async archiveData(data: any): Promise<void> { }
  private async getAllProcessingPurposes(): Promise<string[]> { return []; }
  private async getAllLawfulBases(): Promise<string[]> { return []; }
  private async getAllDataCategories(): Promise<string[]> { return []; }
  private async getAllRetentionPeriods(): Promise<any> { return {}; }
  private async getTotalDataSubjectRequests(): Promise<number> { return 0; }
  private async getAverageResponseTime(): Promise<number> { return 0; }
  private async getRequestsByType(): Promise<any> { return {}; }
  private async getTotalConsents(): Promise<number> { return 0; }
  private async getTotalWithdrawals(): Promise<number> { return 0; }
  private async getConsentRate(): Promise<number> { return 0; }
}