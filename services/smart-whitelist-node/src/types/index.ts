import { z } from 'zod';

// Enum Types
export const WhitelistType = z.enum(['manual', 'auto', 'temporary', 'learned']);
export type WhitelistType = z.infer<typeof WhitelistType>;

export const SpamCategory = z.enum(['sales', 'loan', 'investment', 'insurance', 'scam', 'unknown']);
export type SpamCategory = z.infer<typeof SpamCategory>;

export const LearningEventType = z.enum(['accept', 'reject', 'timeout', 'manual_add', 'manual_remove', 'user_feedback']);
export type LearningEventType = z.infer<typeof LearningEventType>;

export const UserFeedback = z.enum(['spam', 'not_spam', 'unknown', 'partial_spam']);
export type UserFeedback = z.infer<typeof UserFeedback>;

// Core Data Models
export const SmartWhitelistSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  contactPhone: z.string().min(10).max(20),
  contactName: z.string().optional(),
  whitelistType: WhitelistType,
  confidenceScore: z.number().min(0).max(1),
  isActive: z.boolean().default(true),
  expiresAt: z.date().optional(),
  hitCount: z.number().default(0),
  lastHitAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SmartWhitelist = z.infer<typeof SmartWhitelistSchema>;

export const SpamProfileSchema = z.object({
  id: z.string().uuid(),
  phoneHash: z.string().length(64),
  spamCategory: SpamCategory,
  riskScore: z.number().min(0).max(1),
  confidenceLevel: z.number().min(0).max(1),
  featureVector: z.record(z.any()).default({}),
  behavioralPatterns: z.record(z.any()).default({}),
  totalReports: z.number().default(1),
  successfulBlocks: z.number().default(0),
  falsePositiveCount: z.number().default(0),
  firstReported: z.date(),
  lastActivity: z.date(),
  lastUpdated: z.date(),
  createdAt: z.date(),
});

export type SpamProfile = z.infer<typeof SpamProfileSchema>;

export const UserSpamInteractionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  spamProfileId: z.string().uuid(),
  interactionCount: z.number().default(1),
  blockCount: z.number().default(0),
  allowCount: z.number().default(0),
  userFeedback: UserFeedback.optional(),
  feedbackConfidence: z.number().min(0).max(1).optional(),
  aiAccuracyScore: z.number().min(0).max(1).optional(),
  responseEffectiveness: z.number().min(0).max(1).optional(),
  firstInteraction: z.date(),
  lastInteraction: z.date(),
  lastFeedbackAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserSpamInteraction = z.infer<typeof UserSpamInteractionSchema>;

// Request/Response Types
export const EvaluationRequestSchema = z.object({
  phone: z.string().min(10).max(20),
  userId: z.string().uuid().optional(),
  context: z.record(z.any()).default({}),
  includeFeatures: z.boolean().default(false),
});

export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

export const EvaluationResultSchema = z.object({
  phone: z.string(),
  isWhitelisted: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
  classification: z.string(),
  recommendation: z.enum(['allow', 'block', 'analyze', 'auto_allow']),
  reasons: z.array(z.string()),
  mlFeatures: z.record(z.any()).optional(),
  processingTimeMs: z.number(),
  cacheHit: z.boolean().default(false),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const SmartAddRequestSchema = z.object({
  userId: z.string().uuid(),
  contactPhone: z.string().min(10).max(20),
  contactName: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  context: z.string().optional(),
  tags: z.array(z.string()).default([]),
  expiresAt: z.date().optional(),
});

export type SmartAddRequest = z.infer<typeof SmartAddRequestSchema>;

export const CreateWhitelistRequestSchema = z.object({
  userId: z.string().uuid(),
  contactPhone: z.string().min(10).max(20),
  contactName: z.string().optional(),
  whitelistType: WhitelistType.default('manual'),
  confidenceScore: z.number().min(0).max(1).default(1.0),
  expiresAt: z.date().optional(),
});

export type CreateWhitelistRequest = z.infer<typeof CreateWhitelistRequestSchema>;

export const UpdateWhitelistRequestSchema = z.object({
  contactName: z.string().optional(),
  whitelistType: WhitelistType.optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.date().optional().nullable(),
});

export type UpdateWhitelistRequest = z.infer<typeof UpdateWhitelistRequestSchema>;

export const LearningEventSchema = z.object({
  userId: z.string().uuid(),
  phone: z.string().min(10).max(20),
  eventType: LearningEventType,
  confidence: z.number().min(0).max(1),
  features: z.record(z.any()).default({}),
  feedback: UserFeedback.optional(),
  context: z.record(z.any()).default({}),
  timestamp: z.date().default(() => new Date()),
});

export type LearningEvent = z.infer<typeof LearningEventSchema>;

export const UserRulesSchema = z.object({
  userId: z.string().uuid(),
  rules: z.object({
    autoLearnThreshold: z.number().min(0).max(1).optional(),
    allowTemporary: z.boolean().optional(),
    maxTemporaryDuration: z.number().optional(), // hours
    blockKnownSpam: z.boolean().optional(),
    requireManualApproval: z.boolean().optional(),
    patterns: z.object({
      allowedPrefixes: z.array(z.string()).optional(),
      blockedPrefixes: z.array(z.string()).optional(),
      allowedKeywords: z.array(z.string()).optional(),
      blockedKeywords: z.array(z.string()).optional(),
    }).optional(),
  }),
});

export type UserRules = z.infer<typeof UserRulesSchema>;

// ML Feature Types
export interface PhoneFeatures {
  // Pattern Analysis
  hasRepeatingDigits: boolean;
  hasSequentialDigits: boolean;
  digitComplexity: number;
  patternScore: number;

  // Geographic Analysis
  areaCode: string;
  region: string;
  carrier: string;
  isVoip: boolean;
  isMobile: boolean;

  // Behavioral Analysis
  callFrequency: number;
  avgCallDuration: number;
  timeOfDayPattern: number[];
  dayOfWeekPattern: number[];

  // Context Analysis
  hasMarketingKeywords: boolean;
  hasUrgentLanguage: boolean;
  hasFinancialTerms: boolean;
  spamIndicatorCount: number;
}

export interface MLClassificationResult {
  isSpam: boolean;
  spamType: SpamCategory;
  confidence: number;
  reasoning: string;
  features: PhoneFeatures;
  modelVersion: string;
}

// Performance and Monitoring Types
export interface PerformanceMetrics {
  lookupLatency: number;
  mlLatency: number;
  cacheHitRate: number;
  requestsPerSecond: number;
  errorRate: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: boolean;
  redis: boolean;
  mlService: boolean;
  timestamp: Date;
  uptime: number;
}

// Cache Types
export interface CacheKey {
  type: 'whitelist' | 'spam_profile' | 'user_config' | 'ml_features';
  userId?: string;
  phone?: string;
  hash?: string;
}

export interface CacheItem<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
}

// Error Types
export class WhitelistError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'WhitelistError';
  }
}

export class ValidationError extends WhitelistError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends WhitelistError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends WhitelistError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    processingTime?: number;
  };
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface BatchOperationResult {
  successful: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

// Queue and Worker Types
export interface QueueJob<T = any> {
  id: string;
  type: string;
  data: T;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt?: Date;
  failedAt?: Date;
  error?: string;
}

export interface WorkerStats {
  processed: number;
  failed: number;
  active: number;
  waiting: number;
  completed: number;
  delayed: number;
}