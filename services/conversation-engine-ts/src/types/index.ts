// 对话相关类型定义
export interface ConversationContext {
  callId: string;
  userId: string;
  callerPhone: string;
  sessionId: string;
  startTime: Date;
  turnCount: number;
  currentStage: ConversationStage;
  lastIntent?: Intent;
  emotionalState?: EmotionalState;
  userProfile?: UserProfile;
  conversationHistory: ConversationTurn[];
  metadata: Record<string, any>;
}

export interface ConversationTurn {
  id: string;
  speaker: 'user' | 'ai' | 'caller';
  message: string;
  timestamp: Date;
  intent?: Intent;
  confidence?: number;
  emotion?: string;
  processingLatency?: number;
}

export interface Intent {
  category: IntentCategory;
  confidence: number;
  subCategory?: string;
  entities?: Record<string, any>;
  context?: Record<string, any>;
}

export enum IntentCategory {
  SALES_CALL = 'sales_call',
  LOAN_OFFER = 'loan_offer',
  INVESTMENT_PITCH = 'investment_pitch',
  INSURANCE_SALES = 'insurance_sales',
  SURVEY_REQUEST = 'survey_request',
  SCAM_ATTEMPT = 'scam_attempt',
  LEGITIMATE_CALL = 'legitimate_call',
  UNKNOWN = 'unknown'
}

export enum ConversationStage {
  INITIAL = 'initial',
  GREETING = 'greeting',
  IDENTIFYING_PURPOSE = 'identifying_purpose',
  HANDLING_REQUEST = 'handling_request',
  POLITE_DECLINE = 'polite_decline',
  FIRM_REJECTION = 'firm_rejection',
  FINAL_WARNING = 'final_warning',
  TERMINATING = 'terminating',
  ENDED = 'ended'
}

export interface EmotionalState {
  primary: string;
  secondary?: string;
  intensity: number; // 0-1
  valence: number; // -1 to 1 (negative to positive)
  arousal: number; // 0-1 (calm to excited)
  confidence: number;
}

export interface UserProfile {
  id: string;
  name: string;
  personality: PersonalityType;
  speechStyle?: string;
  occupation?: string;
  preferences: UserPreferences;
  voiceProfileId?: string;
}

export enum PersonalityType {
  POLITE = 'polite',
  DIRECT = 'direct',
  HUMOROUS = 'humorous',
  PROFESSIONAL = 'professional',
  FRIENDLY = 'friendly'
}

export interface UserPreferences {
  maxConversationLength: number;
  preferredResponseStyle: string;
  terminationStrategy: TerminationStrategy;
  emotionalResponseLevel: number; // 0-1
  customResponses?: Record<string, string>;
}

export enum TerminationStrategy {
  POLITE_GRADUAL = 'polite_gradual',
  FIRM_IMMEDIATE = 'firm_immediate',
  HUMOR_DEFLECTION = 'humor_deflection',
  PROFESSIONAL_BOUNDARY = 'professional_boundary'
}

// 响应生成相关类型
export interface GeneratedResponse {
  text: string;
  audioUrl?: string;
  emotion?: string;
  confidence: number;
  shouldTerminate: boolean;
  nextStage: ConversationStage;
  metadata: ResponseMetadata;
}

export interface ResponseMetadata {
  strategy: string;
  template?: string;
  personalizationLevel: number;
  estimatedEffectiveness: number;
  generationLatency: number;
  cacheHit: boolean;
}

// AI服务相关类型
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deploymentName: string;
  maxTokens: number;
  temperature: number;
  topP: number;
}

export interface IntentClassificationResult {
  intent: Intent;
  alternativeIntents: Intent[];
  processingTime: number;
  method: 'keyword' | 'semantic' | 'contextual' | 'hybrid';
}

export interface SentimentAnalysisResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number; // -1 to 1
  magnitude: number; // 0 to 1
  emotions: Record<string, number>;
  confidence: number;
}

// 学习和优化相关类型
export interface ConversationAnalytics {
  callId: string;
  effectiveness: number;
  userSatisfaction?: number;
  aiPerformance: AIPerformanceMetrics;
  optimizationSuggestions: string[];
}

export interface AIPerformanceMetrics {
  avgResponseTime: number;
  intentAccuracy: number;
  responseRelevance: number;
  conversationFlow: number;
  terminationSuccess: boolean;
}

// 缓存相关类型
export interface CacheKey {
  type: 'intent' | 'response' | 'user_profile' | 'conversation_context';
  identifier: string;
  params?: Record<string, any>;
}

export interface CachedResponse {
  data: any;
  timestamp: Date;
  ttl: number;
  hitCount: number;
}

// API响应类型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    requestId: string;
    timestamp: Date;
    processingTime: number;
  };
}

// 健康检查类型
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, HealthCheck>;
  timestamp: Date;
  uptime: number;
}

export interface HealthCheck {
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  responseTime?: number;
  metadata?: Record<string, any>;
}

// 配置类型
export interface ServiceConfig {
  port: number;
  serviceName: string;
  environment: string;
  azure: AzureOpenAIConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  logging: LoggingConfig;
  performance: PerformanceConfig;
}

export interface DatabaseConfig {
  url: string;
  maxConnections: number;
  connectionTimeout: number;
  ssl: boolean;
}

export interface RedisConfig {
  url: string;
  maxRetries: number;
  retryDelay: number;
  keyPrefix: string;
}

export interface LoggingConfig {
  level: string;
  format: string;
  enableRequestLogging: boolean;
}

export interface PerformanceConfig {
  maxConversationTurns: number;
  maxResponseLength: number;
  intentConfidenceThreshold: number;
  cacheTtl: number;
  responseCacheTtl: number;
}

// 错误类型
export class ConversationEngineError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'ConversationEngineError';
  }
}

export class IntentClassificationError extends ConversationEngineError {
  constructor(message: string, details?: any) {
    super(message, 'INTENT_CLASSIFICATION_ERROR', 400, details);
  }
}

export class ResponseGenerationError extends ConversationEngineError {
  constructor(message: string, details?: any) {
    super(message, 'RESPONSE_GENERATION_ERROR', 500, details);
  }
}

export class AzureServiceError extends ConversationEngineError {
  constructor(message: string, details?: any) {
    super(message, 'AZURE_SERVICE_ERROR', 502, details);
  }
}