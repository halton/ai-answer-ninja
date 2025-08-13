// Core conversation types
export interface ConversationContext {
  callId: string;
  userId: string;
  callerPhone: string;
  conversationHistory: ConversationTurn[];
  currentState: ConversationState;
  startTime: Date;
  lastActivity: Date;
  metadata: Record<string, any>;
}

export interface ConversationTurn {
  id: string;
  callId: string;
  speaker: 'user' | 'ai' | 'caller';
  message: string;
  timestamp: Date;
  confidence?: number;
  intent?: IntentResult;
  emotion?: EmotionResult;
  processingLatency?: number;
}

export interface ConversationState {
  stage: ConversationStage;
  turnCount: number;
  lastIntent: string;
  emotionalState: EmotionalState;
  terminationScore: number;
  userEngagement: number;
}

export type ConversationStage = 
  | 'initial' 
  | 'identification'
  | 'handling_sales' 
  | 'handling_loan' 
  | 'handling_investment'
  | 'firm_rejection'
  | 'final_warning'
  | 'call_end'
  | 'hang_up';

// Intent classification types
export interface IntentResult {
  intent: string;
  confidence: number;
  subCategory?: string;
  emotionalTone?: string;
  contextInfluenced?: boolean;
}

export interface IntentClassificationInput {
  text: string;
  context?: Partial<ConversationContext>;
  userId?: string;
}

// Emotion analysis types
export interface EmotionResult {
  primaryEmotion: Emotion;
  emotionScores: Record<Emotion, number>;
  intensity: number;
  valence: number; // positive/negative
  arousal: number; // calm/excited
}

export type Emotion = 
  | 'joy' 
  | 'sadness' 
  | 'anger' 
  | 'fear' 
  | 'surprise' 
  | 'disgust' 
  | 'neutral'
  | 'frustration'
  | 'boredom'
  | 'confusion';

export interface EmotionalState {
  currentEmotion: Emotion;
  emotionHistory: EmotionResult[];
  averageValence: number;
  averageArousal: number;
  emotionTrend: 'improving' | 'degrading' | 'stable';
}

// Response generation types
export interface ResponseGenerationRequest {
  text: string;
  intent: IntentResult;
  context: ConversationContext;
  userProfile?: UserProfile;
  strategy?: ResponseStrategy;
}

export interface ResponseGenerationResult {
  response: string;
  audioResponse?: Buffer;
  confidence: number;
  shouldTerminate: boolean;
  nextState: ConversationState;
  responseMetadata: ResponseMetadata;
}

export interface ResponseMetadata {
  strategy: ResponseStrategy;
  generationTime: number;
  templateUsed?: string;
  personalizations: string[];
  reasoning: string;
}

export type ResponseStrategy = 
  | 'gentle_decline'
  | 'firm_decline'
  | 'witty_response'
  | 'explain_not_interested'
  | 'clear_refusal'
  | 'deflect_with_humor'
  | 'final_warning'
  | 'default_response';

// User profile types
export interface UserProfile {
  userId: string;
  name: string;
  personality: PersonalityType;
  speechStyle: string;
  occupation?: string;
  demographics?: Demographics;
  preferences: UserPreferences;
  conversationHistory: ConversationSummary[];
}

export type PersonalityType = 'polite' | 'direct' | 'humorous' | 'professional';

export interface Demographics {
  ageGroup?: string;
  location?: string;
  language?: string;
  culturalBackground?: string;
}

export interface UserPreferences {
  responseStyle: ResponseStyle;
  terminationStyle: TerminationStyle;
  allowHumor: boolean;
  maxConversationDuration: number;
  escalationThreshold: number;
}

export type ResponseStyle = 'minimal' | 'conversational' | 'detailed';
export type TerminationStyle = 'polite' | 'firm' | 'immediate';

export interface ConversationSummary {
  callId: string;
  date: Date;
  duration: number;
  spamCategory: string;
  outcome: ConversationOutcome;
  effectivenessScore: number;
}

export type ConversationOutcome = 
  | 'caller_hangup'
  | 'ai_hangup'
  | 'transferred'
  | 'timeout'
  | 'error';

// Termination analysis types
export interface TerminationAnalysis {
  shouldTerminate: boolean;
  confidence: number;
  reason: TerminationReason;
  recommendedResponse?: string;
  urgency: 'low' | 'medium' | 'high';
}

export type TerminationReason = 
  | 'excessive_persistence'
  | 'max_duration'
  | 'ineffective_responses'
  | 'high_frustration'
  | 'user_request'
  | 'system_timeout';

// Performance monitoring types
export interface PerformanceMetrics {
  conversationId: string;
  processingLatency: {
    intentClassification: number;
    emotionAnalysis: number;
    responseGeneration: number;
    total: number;
  };
  accuracy: {
    intentAccuracy: number;
    emotionAccuracy: number;
    responseRelevance: number;
  };
  effectiveness: {
    terminationSuccess: boolean;
    userSatisfaction?: number;
    conversationQuality: number;
  };
}

// Configuration types
export interface ConversationConfig {
  maxTurns: number;
  maxDuration: number;
  terminationThresholds: {
    persistenceScore: number;
    frustrationLevel: number;
    engagementScore: number;
  };
  responseSettings: {
    maxLength: number;
    allowPersonalization: boolean;
    enableEmotionAdaptation: boolean;
  };
  modelSettings: {
    intentModel: string;
    emotionModel: string;
    responseModel: string;
    temperature: number;
  };
}

// API request/response types
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  service: string;
  timestamp: string;
  version: string;
  dependencies?: {
    redis: boolean;
    database: boolean;
    azureOpenAI: boolean;
    textAnalytics: boolean;
  };
}

export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  timestamp: string;
  requestId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Service communication types
export interface ServiceRequest<T = any> {
  requestId: string;
  timestamp: Date;
  service: string;
  action: string;
  data: T;
  metadata?: Record<string, any>;
}

export interface ServiceResponse<T = any> {
  requestId: string;
  timestamp: Date;
  success: boolean;
  data?: T;
  error?: string;
  processingTime: number;
}

// Learning and optimization types
export interface ConversationFeedback {
  callId: string;
  overallEffectiveness: number;
  specificFeedback: {
    intentAccuracy: number;
    responseQuality: number;
    terminationTiming: number;
  };
  suggestions: string[];
  timestamp: Date;
}