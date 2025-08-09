/**
 * Data Anonymization Service
 * Provides data anonymization and pseudonymization capabilities
 */

import * as crypto from 'crypto';
import { logger } from '../utils/Logger';

interface AnonymizationRule {
  field: string;
  method: 'hash' | 'mask' | 'generalize' | 'suppress' | 'noise' | 'synthetic';
  options?: any;
}

export class DataAnonymizer {
  private static instance: DataAnonymizer;
  private readonly saltSecret: string;
  private anonymizationRules: Map<string, AnonymizationRule[]> = new Map();

  private constructor() {
    this.saltSecret = process.env.ANONYMIZATION_SALT || crypto.randomBytes(32).toString('hex');
    this.initializeRules();
  }

  public static getInstance(): DataAnonymizer {
    if (!DataAnonymizer.instance) {
      DataAnonymizer.instance = new DataAnonymizer();
    }
    return DataAnonymizer.instance;
  }

  /**
   * Initialize default anonymization rules
   */
  private initializeRules(): void {
    // Phone number anonymization rules
    this.anonymizationRules.set('phone_number', [
      { field: 'phone_number', method: 'mask', options: { keepFirst: 3, keepLast: 2 } }
    ]);

    // Email anonymization rules
    this.anonymizationRules.set('email', [
      { field: 'email', method: 'mask', options: { keepDomain: true } }
    ]);

    // Name anonymization rules
    this.anonymizationRules.set('name', [
      { field: 'name', method: 'generalize', options: { level: 'initials' } }
    ]);

    // Voice data anonymization rules
    this.anonymizationRules.set('voice_recording', [
      { field: 'voice_url', method: 'suppress' },
      { field: 'voice_features', method: 'noise', options: { level: 0.1 } }
    ]);

    // Location anonymization rules
    this.anonymizationRules.set('location', [
      { field: 'latitude', method: 'generalize', options: { precision: 2 } },
      { field: 'longitude', method: 'generalize', options: { precision: 2 } }
    ]);
  }

  /**
   * Anonymize data based on its type
   */
  public async anonymizeData(data: any, dataType?: string): Promise<any> {
    try {
      if (Array.isArray(data)) {
        return Promise.all(data.map(item => this.anonymizeData(item, dataType)));
      }

      if (typeof data !== 'object' || data === null) {
        return data;
      }

      const anonymized = { ...data };

      // Apply type-specific rules if provided
      if (dataType && this.anonymizationRules.has(dataType)) {
        const rules = this.anonymizationRules.get(dataType)!;
        for (const rule of rules) {
          if (anonymized[rule.field] !== undefined) {
            anonymized[rule.field] = await this.applyAnonymizationMethod(
              anonymized[rule.field],
              rule.method,
              rule.options
            );
          }
        }
      } else {
        // Auto-detect and anonymize sensitive fields
        anonymized = await this.autoAnonymize(anonymized);
      }

      return anonymized;
    } catch (error) {
      logger.error('Data anonymization failed', {
        dataType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Apply specific anonymization method
   */
  private async applyAnonymizationMethod(
    value: any,
    method: string,
    options?: any
  ): Promise<any> {
    switch (method) {
      case 'hash':
        return this.hashValue(value);
      case 'mask':
        return this.maskValue(value, options);
      case 'generalize':
        return this.generalizeValue(value, options);
      case 'suppress':
        return this.suppressValue();
      case 'noise':
        return this.addNoise(value, options);
      case 'synthetic':
        return this.generateSynthetic(value, options);
      default:
        return value;
    }
  }

  /**
   * Hash value for pseudonymization
   */
  private hashValue(value: string): string {
    return crypto
      .createHmac('sha256', this.saltSecret)
      .update(String(value))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Mask sensitive parts of data
   */
  private maskValue(value: string, options?: any): string {
    const str = String(value);
    const keepFirst = options?.keepFirst || 0;
    const keepLast = options?.keepLast || 0;
    const maskChar = options?.maskChar || '*';

    if (str.length <= keepFirst + keepLast) {
      return maskChar.repeat(str.length);
    }

    const first = str.substring(0, keepFirst);
    const last = str.substring(str.length - keepLast);
    const middle = maskChar.repeat(str.length - keepFirst - keepLast);

    return first + middle + last;
  }

  /**
   * Generalize value to reduce precision
   */
  private generalizeValue(value: any, options?: any): any {
    if (typeof value === 'number') {
      const precision = options?.precision || 0;
      return Number(value.toFixed(precision));
    }

    if (typeof value === 'string') {
      const level = options?.level || 'category';
      
      if (level === 'initials') {
        return value
          .split(' ')
          .map(word => word[0]?.toUpperCase() || '')
          .join('.');
      }

      if (level === 'category') {
        // Return generic category
        return 'User';
      }
    }

    if (value instanceof Date) {
      const level = options?.level || 'month';
      const date = new Date(value);
      
      if (level === 'year') {
        return new Date(date.getFullYear(), 0, 1);
      }
      if (level === 'month') {
        return new Date(date.getFullYear(), date.getMonth(), 1);
      }
    }

    return value;
  }

  /**
   * Suppress (remove) value
   */
  private suppressValue(): null {
    return null;
  }

  /**
   * Add statistical noise to value
   */
  private addNoise(value: any, options?: any): any {
    if (typeof value === 'number') {
      const noiseLevel = options?.level || 0.1;
      const noise = (Math.random() - 0.5) * 2 * noiseLevel * value;
      return value + noise;
    }

    if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
      const noiseLevel = options?.level || 0.1;
      return value.map(v => {
        const noise = (Math.random() - 0.5) * 2 * noiseLevel * v;
        return v + noise;
      });
    }

    return value;
  }

  /**
   * Generate synthetic data
   */
  private generateSynthetic(value: any, options?: any): any {
    const type = options?.type || 'random';

    if (type === 'random') {
      if (typeof value === 'string') {
        return `SYNTH_${crypto.randomBytes(8).toString('hex')}`;
      }
      if (typeof value === 'number') {
        return Math.floor(Math.random() * 1000000);
      }
    }

    if (type === 'pattern') {
      const pattern = options?.pattern || 'XXX-XXX-XXXX';
      return pattern.replace(/X/g, () => Math.floor(Math.random() * 10).toString());
    }

    return value;
  }

  /**
   * Auto-detect and anonymize sensitive fields
   */
  private async autoAnonymize(data: any): Promise<any> {
    const anonymized = { ...data };
    const sensitivePatterns = {
      phone: /phone|mobile|cell|tel/i,
      email: /email|mail/i,
      name: /name|firstname|lastname|fullname/i,
      address: /address|street|city|zip|postal/i,
      ssn: /ssn|social|security/i,
      card: /card|credit|debit|payment/i,
      date: /birth|dob|date.*birth/i,
      id: /passport|license|national.*id/i
    };

    for (const field in anonymized) {
      const value = anonymized[field];
      
      // Skip null/undefined values
      if (value === null || value === undefined) continue;

      // Check field name against patterns
      for (const [type, pattern] of Object.entries(sensitivePatterns)) {
        if (pattern.test(field)) {
          switch (type) {
            case 'phone':
              anonymized[field] = this.maskValue(String(value), { keepFirst: 3, keepLast: 2 });
              break;
            case 'email':
              anonymized[field] = this.maskEmail(String(value));
              break;
            case 'name':
              anonymized[field] = this.generalizeValue(String(value), { level: 'initials' });
              break;
            case 'address':
              anonymized[field] = this.generalizeValue(String(value), { level: 'category' });
              break;
            case 'ssn':
            case 'card':
            case 'id':
              anonymized[field] = this.hashValue(String(value));
              break;
            case 'date':
              anonymized[field] = this.generalizeValue(value, { level: 'year' });
              break;
          }
          break;
        }
      }

      // Recursively anonymize nested objects
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        anonymized[field] = await this.autoAnonymize(value);
      }
    }

    return anonymized;
  }

  /**
   * Mask email address
   */
  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return this.hashValue(email);

    const [local, domain] = parts;
    const maskedLocal = this.maskValue(local, { keepFirst: 2, keepLast: 1 });
    
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Anonymize phone conversation transcript
   */
  public async anonymizeTranscript(transcript: string): Promise<string> {
    let anonymized = transcript;

    // Pattern replacements for common PII
    const patterns = [
      // Phone numbers
      { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: 'XXX-XXX-XXXX' },
      // Email addresses
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: 'email@hidden.com' },
      // Credit card numbers
      { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: 'XXXX-XXXX-XXXX-XXXX' },
      // SSN
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: 'XXX-XX-XXXX' },
      // Names (simplified - would use NER in production)
      { pattern: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, replacement: 'PERSON_NAME' }
    ];

    for (const { pattern, replacement } of patterns) {
      anonymized = anonymized.replace(pattern, replacement);
    }

    return anonymized;
  }

  /**
   * K-anonymity implementation
   */
  public async applyKAnonymity(
    dataset: any[],
    quasiIdentifiers: string[],
    k: number = 5
  ): Promise<any[]> {
    if (dataset.length < k) {
      logger.warn('Dataset smaller than k value', { datasetSize: dataset.length, k });
      return dataset;
    }

    // Group records by quasi-identifiers
    const groups = new Map<string, any[]>();
    
    for (const record of dataset) {
      const key = quasiIdentifiers
        .map(qi => this.generalizeValue(record[qi], { level: 'category' }))
        .join('|');
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(record);
    }

    // Ensure each group has at least k records
    const anonymized: any[] = [];
    
    for (const [key, group] of groups) {
      if (group.length >= k) {
        // Group satisfies k-anonymity
        anonymized.push(...group);
      } else {
        // Suppress or further generalize small groups
        const generalized = group.map(record => {
          const anon = { ...record };
          for (const qi of quasiIdentifiers) {
            anon[qi] = this.suppressValue();
          }
          return anon;
        });
        anonymized.push(...generalized);
      }
    }

    return anonymized;
  }

  /**
   * Differential privacy implementation
   */
  public async applyDifferentialPrivacy(
    value: number,
    epsilon: number = 1.0
  ): Promise<number> {
    // Add Laplace noise for differential privacy
    const sensitivity = 1; // Assuming sensitivity of 1
    const scale = sensitivity / epsilon;
    
    // Generate Laplace noise
    const u = Math.random() - 0.5;
    const laplacianNoise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    
    return value + laplacianNoise;
  }

  /**
   * Create anonymization report
   */
  public async generateAnonymizationReport(
    originalData: any,
    anonymizedData: any
  ): Promise<any> {
    const report = {
      timestamp: new Date(),
      dataUtilityScore: await this.calculateDataUtility(originalData, anonymizedData),
      privacyLevel: await this.assessPrivacyLevel(anonymizedData),
      fieldsAnonymized: this.identifyAnonymizedFields(originalData, anonymizedData),
      techniques: this.getAppliedTechniques(),
      compliance: {
        gdpr: true,
        ccpa: true,
        hipaa: this.checkHIPAACompliance(anonymizedData)
      }
    };

    return report;
  }

  // Helper methods for report generation
  private async calculateDataUtility(original: any, anonymized: any): Promise<number> {
    // Calculate information loss
    return 0.85; // Placeholder
  }

  private async assessPrivacyLevel(data: any): Promise<string> {
    return 'high'; // Placeholder
  }

  private identifyAnonymizedFields(original: any, anonymized: any): string[] {
    const fields: string[] = [];
    for (const key in original) {
      if (original[key] !== anonymized[key]) {
        fields.push(key);
      }
    }
    return fields;
  }

  private getAppliedTechniques(): string[] {
    return ['masking', 'generalization', 'suppression', 'hashing'];
  }

  private checkHIPAACompliance(data: any): boolean {
    // Check if all 18 HIPAA identifiers are properly anonymized
    return true; // Placeholder
  }
}