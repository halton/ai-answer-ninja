import { PhoneFeatures, MLClassificationResult, SpamCategory } from '@/types';
import { logger } from '@/utils/logger';

export class FeatureExtractor {
  
  /**
   * Extract comprehensive features from phone number for ML analysis
   */
  extractFeatures(phone: string, context: Record<string, any> = {}): PhoneFeatures {
    try {
      const cleanPhone = this.cleanPhoneNumber(phone);
      
      return {
        // Pattern Analysis
        hasRepeatingDigits: this.hasRepeatingDigits(cleanPhone),
        hasSequentialDigits: this.hasSequentialDigits(cleanPhone),
        digitComplexity: this.calculateDigitComplexity(cleanPhone),
        patternScore: this.calculatePatternScore(cleanPhone),

        // Geographic Analysis
        areaCode: this.extractAreaCode(cleanPhone),
        region: this.getRegionFromAreaCode(cleanPhone),
        carrier: this.inferCarrier(cleanPhone),
        isVoip: this.isVoipNumber(cleanPhone),
        isMobile: this.isMobileNumber(cleanPhone),

        // Behavioral Analysis (from context or defaults)
        callFrequency: context.callFrequency || 0,
        avgCallDuration: context.avgCallDuration || 0,
        timeOfDayPattern: context.timeOfDayPattern || new Array(24).fill(0),
        dayOfWeekPattern: context.dayOfWeekPattern || new Array(7).fill(0),

        // Context Analysis
        hasMarketingKeywords: this.hasMarketingKeywords(context),
        hasUrgentLanguage: this.hasUrgentLanguage(context),
        hasFinancialTerms: this.hasFinancialTerms(context),
        spamIndicatorCount: this.countSpamIndicators(cleanPhone, context),
      };
    } catch (error) {
      logger.error('Feature extraction failed', {
        phone: phone.substring(0, 4) + '****',
        error: error instanceof Error ? error.message : String(error),
      });

      // Return default features on error
      return this.getDefaultFeatures();
    }
  }

  private cleanPhoneNumber(phone: string): string {
    // Remove all non-digit characters
    return phone.replace(/\D/g, '');
  }

  private hasRepeatingDigits(phone: string): boolean {
    // Check for 3+ consecutive repeating digits
    return /(\d)\1{2,}/.test(phone);
  }

  private hasSequentialDigits(phone: string): boolean {
    // Check for ascending or descending sequences
    const sequences = [
      '0123', '1234', '2345', '3456', '4567', '5678', '6789',
      '9876', '8765', '7654', '6543', '5432', '4321', '3210',
    ];
    
    return sequences.some(seq => phone.includes(seq));
  }

  private calculateDigitComplexity(phone: string): number {
    if (phone.length === 0) return 0;

    const uniqueDigits = new Set(phone).size;
    const entropy = this.calculateEntropy(phone);
    
    // Normalize complexity score (0-1, higher = more complex)
    return Math.min(1, (uniqueDigits / 10) * 0.5 + entropy * 0.5);
  }

  private calculateEntropy(phone: string): number {
    const digitCounts = new Map<string, number>();
    
    for (const digit of phone) {
      digitCounts.set(digit, (digitCounts.get(digit) || 0) + 1);
    }

    let entropy = 0;
    for (const count of digitCounts.values()) {
      const probability = count / phone.length;
      entropy -= probability * Math.log2(probability);
    }

    // Normalize to 0-1 range (max entropy for 10 digits is ~3.32)
    return Math.min(1, entropy / 3.32);
  }

  private calculatePatternScore(phone: string): number {
    let score = 0.5; // Base score
    
    // Penalty for suspicious patterns
    if (this.hasRepeatingDigits(phone)) score -= 0.2;
    if (this.hasSequentialDigits(phone)) score -= 0.15;
    if (this.hasSuspiciousEnding(phone)) score -= 0.1;
    if (this.hasCommonSpamPattern(phone)) score -= 0.25;
    
    // Bonus for good patterns
    if (this.hasValidCountryCode(phone)) score += 0.1;
    if (this.hasValidAreaCode(phone)) score += 0.1;
    
    return Math.max(0, Math.min(1, score));
  }

  private hasSuspiciousEnding(phone: string): boolean {
    // Common spam number endings
    const suspiciousEndings = ['0000', '1111', '2222', '9999', '1234'];
    return suspiciousEndings.some(ending => phone.endsWith(ending));
  }

  private hasCommonSpamPattern(phone: string): boolean {
    // Common patterns used by spam callers
    const spamPatterns = [
      /^1?800/, // Toll-free
      /^1?888/, // Toll-free
      /^1?877/, // Toll-free
      /^1?866/, // Toll-free
      /^1?855/, // Toll-free
      /^1?844/, // Toll-free
      /^1?833/, // Toll-free
      /0000$/, // Ending in 0000
      /1111$/, // Ending in 1111
    ];

    return spamPatterns.some(pattern => pattern.test(phone));
  }

  private extractAreaCode(phone: string): string {
    if (phone.length >= 10) {
      // For US numbers, area code is first 3 digits (after country code)
      const startIndex = phone.length === 11 && phone.startsWith('1') ? 1 : 0;
      return phone.substring(startIndex, startIndex + 3);
    }
    return '';
  }

  private getRegionFromAreaCode(phone: string): string {
    const areaCode = this.extractAreaCode(phone);
    
    // Simplified region mapping (US-focused)
    const regionMap: Record<string, string> = {
      '212': 'NYC', '646': 'NYC', '917': 'NYC', '347': 'NYC',
      '213': 'LA', '323': 'LA', '310': 'LA', '424': 'LA',
      '415': 'SF', '628': 'SF', '650': 'SF',
      '305': 'Miami', '786': 'Miami', '954': 'Miami',
      '312': 'Chicago', '773': 'Chicago', '872': 'Chicago',
      '800': 'Toll-Free', '888': 'Toll-Free', '877': 'Toll-Free',
      '866': 'Toll-Free', '855': 'Toll-Free', '844': 'Toll-Free',
    };

    return regionMap[areaCode] || 'Unknown';
  }

  private inferCarrier(phone: string): string {
    // This would typically require a carrier database
    // For now, return basic inference based on patterns
    const areaCode = this.extractAreaCode(phone);
    
    if (['800', '888', '877', '866', '855', '844'].includes(areaCode)) {
      return 'Toll-Free';
    }
    
    // VoIP patterns
    if (this.isVoipNumber(phone)) {
      return 'VoIP';
    }

    return 'Unknown';
  }

  private isVoipNumber(phone: string): boolean {
    // Common VoIP provider patterns
    const voipPatterns = [
      /^1?555/, // Often VoIP test numbers
    ];

    // Check for geographic inconsistencies that might indicate VoIP
    const areaCode = this.extractAreaCode(phone);
    const voipAreaCodes = ['555']; // Simplified list

    return voipPatterns.some(pattern => pattern.test(phone)) ||
           voipAreaCodes.includes(areaCode);
  }

  private isMobileNumber(phone: string): boolean {
    // In the US, all area codes can be mobile
    // This would require a more sophisticated database in practice
    const areaCode = this.extractAreaCode(phone);
    
    // Exclude known landline-only patterns
    const landlineOnlyCodes = ['800', '888', '877', '866', '855', '844'];
    
    return !landlineOnlyCodes.includes(areaCode);
  }

  private hasValidCountryCode(phone: string): boolean {
    // Check for valid country code (simplified)
    return phone.length === 11 && phone.startsWith('1');
  }

  private hasValidAreaCode(phone: string): boolean {
    const areaCode = this.extractAreaCode(phone);
    
    // Valid area codes don't start with 0 or 1
    return areaCode.length === 3 && 
           !areaCode.startsWith('0') && 
           !areaCode.startsWith('1');
  }

  private hasMarketingKeywords(context: Record<string, any>): boolean {
    const marketingKeywords = [
      'offer', 'deal', 'discount', 'special', 'limited time',
      'act now', 'call now', 'free', 'promotion', 'sale',
      'exclusive', 'opportunity', 'winner', 'congratulations',
    ];

    const text = JSON.stringify(context).toLowerCase();
    return marketingKeywords.some(keyword => text.includes(keyword));
  }

  private hasUrgentLanguage(context: Record<string, any>): boolean {
    const urgentKeywords = [
      'urgent', 'immediate', 'asap', 'emergency', 'critical',
      'expire', 'deadline', 'last chance', 'final notice',
      'act now', 'limited time', 'hurry', 'quickly',
    ];

    const text = JSON.stringify(context).toLowerCase();
    return urgentKeywords.some(keyword => text.includes(keyword));
  }

  private hasFinancialTerms(context: Record<string, any>): boolean {
    const financialKeywords = [
      'loan', 'credit', 'debt', 'mortgage', 'interest rate',
      'investment', 'stock', 'crypto', 'bitcoin', 'trading',
      'insurance', 'policy', 'premium', 'claim', 'coverage',
      'bank', 'account', 'card', 'payment', 'refund',
    ];

    const text = JSON.stringify(context).toLowerCase();
    return financialKeywords.some(keyword => text.includes(keyword));
  }

  private countSpamIndicators(phone: string, context: Record<string, any>): number {
    let count = 0;

    // Phone-based indicators
    if (this.hasRepeatingDigits(phone)) count++;
    if (this.hasSequentialDigits(phone)) count++;
    if (this.hasCommonSpamPattern(phone)) count++;
    if (this.hasSuspiciousEnding(phone)) count++;

    // Context-based indicators
    if (this.hasMarketingKeywords(context)) count++;
    if (this.hasUrgentLanguage(context)) count++;
    if (this.hasFinancialTerms(context)) count++;

    return count;
  }

  private getDefaultFeatures(): PhoneFeatures {
    return {
      hasRepeatingDigits: false,
      hasSequentialDigits: false,
      digitComplexity: 0.5,
      patternScore: 0.5,
      areaCode: '',
      region: 'Unknown',
      carrier: 'Unknown',
      isVoip: false,
      isMobile: true,
      callFrequency: 0,
      avgCallDuration: 0,
      timeOfDayPattern: new Array(24).fill(0),
      dayOfWeekPattern: new Array(7).fill(0),
      hasMarketingKeywords: false,
      hasUrgentLanguage: false,
      hasFinancialTerms: false,
      spamIndicatorCount: 0,
    };
  }
}

/**
 * Simple ML Classifier for phone numbers
 * This is a basic implementation - in production, you'd use a more sophisticated model
 */
export class SimpleMLClassifier {
  private featureExtractor: FeatureExtractor;
  private modelWeights: Record<string, number>;

  constructor() {
    this.featureExtractor = new FeatureExtractor();
    
    // Simplified feature weights (would be learned from training data)
    this.modelWeights = {
      hasRepeatingDigits: -0.3,
      hasSequentialDigits: -0.2,
      digitComplexity: 0.4,
      patternScore: 0.5,
      isVoip: -0.1,
      hasMarketingKeywords: -0.4,
      hasUrgentLanguage: -0.3,
      hasFinancialTerms: -0.2,
      spamIndicatorCount: -0.1,
    };
  }

  /**
   * Classify a phone number as spam or legitimate
   */
  classify(phone: string, context: Record<string, any> = {}): MLClassificationResult {
    try {
      const features = this.featureExtractor.extractFeatures(phone, context);
      
      // Calculate spam probability
      let spamScore = 0.5; // Base probability
      
      // Apply feature weights
      spamScore += features.hasRepeatingDigits ? this.modelWeights.hasRepeatingDigits : 0;
      spamScore += features.hasSequentialDigits ? this.modelWeights.hasSequentialDigits : 0;
      spamScore += features.digitComplexity * this.modelWeights.digitComplexity;
      spamScore += features.patternScore * this.modelWeights.patternScore;
      spamScore += features.isVoip ? this.modelWeights.isVoip : 0;
      spamScore += features.hasMarketingKeywords ? this.modelWeights.hasMarketingKeywords : 0;
      spamScore += features.hasUrgentLanguage ? this.modelWeights.hasUrgentLanguage : 0;
      spamScore += features.hasFinancialTerms ? this.modelWeights.hasFinancialTerms : 0;
      spamScore += features.spamIndicatorCount * this.modelWeights.spamIndicatorCount;

      // Normalize to 0-1 range
      spamScore = Math.max(0, Math.min(1, spamScore));

      const isSpam = spamScore > 0.6;
      const confidence = isSpam ? spamScore : 1 - spamScore;
      
      // Determine spam type
      const spamType = this.determineSpamType(features, context);
      
      // Generate reasoning
      const reasoning = this.generateReasoning(features, isSpam, spamScore);

      return {
        isSpam,
        spamType,
        confidence,
        reasoning,
        features,
        modelVersion: '1.0.0',
      };
    } catch (error) {
      logger.error('ML classification failed', {
        phone: phone.substring(0, 4) + '****',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        isSpam: false,
        spamType: 'unknown',
        confidence: 0.5,
        reasoning: 'Classification failed',
        features: this.featureExtractor.getDefaultFeatures(),
        modelVersion: '1.0.0',
      };
    }
  }

  private determineSpamType(features: PhoneFeatures, context: Record<string, any>): SpamCategory {
    // Simple rule-based spam type classification
    if (features.hasFinancialTerms) {
      const text = JSON.stringify(context).toLowerCase();
      
      if (text.includes('loan') || text.includes('credit')) {
        return 'loan';
      } else if (text.includes('investment') || text.includes('stock')) {
        return 'investment';
      } else if (text.includes('insurance')) {
        return 'insurance';
      }
    }

    if (features.hasMarketingKeywords) {
      return 'sales';
    }

    if (features.hasUrgentLanguage && features.hasFinancialTerms) {
      return 'scam';
    }

    return 'unknown';
  }

  private generateReasoning(features: PhoneFeatures, isSpam: boolean, score: number): string {
    const reasons: string[] = [];

    if (features.hasRepeatingDigits) {
      reasons.push('contains repeating digit patterns');
    }

    if (features.hasSequentialDigits) {
      reasons.push('contains sequential digit patterns');
    }

    if (features.digitComplexity < 0.3) {
      reasons.push('low digit complexity');
    }

    if (features.patternScore < 0.4) {
      reasons.push('suspicious number patterns');
    }

    if (features.hasMarketingKeywords) {
      reasons.push('contains marketing language');
    }

    if (features.hasUrgentLanguage) {
      reasons.push('uses urgent language');
    }

    if (features.hasFinancialTerms) {
      reasons.push('contains financial terms');
    }

    if (features.spamIndicatorCount > 2) {
      reasons.push('multiple spam indicators detected');
    }

    if (reasons.length === 0) {
      return isSpam ? 
        'Multiple weak signals suggest spam' : 
        'No significant spam indicators detected';
    }

    const prefix = isSpam ? 
      `Classified as spam (${Math.round(score * 100)}% confidence)` : 
      `Classified as legitimate (${Math.round((1 - score) * 100)}% confidence)`;

    return `${prefix}: ${reasons.join(', ')}`;
  }

  /**
   * Learn from feedback to improve the model
   */
  learnFromFeedback(
    phone: string,
    isSpam: boolean,
    actualSpamType: string,
    confidence: number,
    context: Record<string, any>
  ): void {
    // In a real ML system, this would update the model weights
    // For now, just log the feedback for future training
    logger.info('ML feedback received', {
      phone: phone.substring(0, 4) + '****',
      isSpam,
      actualSpamType,
      confidence,
      hasContext: Object.keys(context).length > 0,
    });

    // Simple adaptive learning: slightly adjust weights based on feedback
    this.adaptWeights(phone, isSpam, context);
  }

  private adaptWeights(phone: string, isSpam: boolean, context: Record<string, any>): void {
    const features = this.featureExtractor.extractFeatures(phone, context);
    const prediction = this.classify(phone, context);
    
    const learningRate = 0.01; // Small learning rate for stability
    const error = isSpam ? 1 : 0 - (prediction.isSpam ? 1 : 0);
    
    // Update weights slightly based on error
    if (Math.abs(error) > 0.1) {
      for (const [feature, weight] of Object.entries(this.modelWeights)) {
        if (feature in features) {
          const featureValue = features[feature as keyof PhoneFeatures];
          const adjustment = typeof featureValue === 'boolean' ? 
            (featureValue ? 1 : 0) * error * learningRate :
            (featureValue as number) * error * learningRate;
          
          this.modelWeights[feature] += adjustment;
        }
      }

      logger.debug('Model weights adjusted', {
        error: Math.round(error * 100) / 100,
        phone: phone.substring(0, 4) + '****',
      });
    }
  }

  /**
   * Get model statistics
   */
  getModelStats(): Record<string, number> {
    return { ...this.modelWeights };
  }
}

export const featureExtractor = new FeatureExtractor();
export const mlClassifier = new SimpleMLClassifier();
export default { featureExtractor, mlClassifier };