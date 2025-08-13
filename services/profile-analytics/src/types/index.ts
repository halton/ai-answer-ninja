// 基础类型定义
export interface ServiceConfig {
  port: number;
  host: string;
  environment: 'development' | 'staging' | 'production';
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  enableCaching: boolean;
  enableRealTimeAnalysis: boolean;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  connectionTimeout: number;
  maxConnections: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  database: number;
  keyPrefix: string;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
}

export interface AzureConfig {
  openai: {
    endpoint: string;
    apiKey: string;
    deploymentName: string;
    apiVersion: string;
  };
  speech: {
    subscriptionKey: string;
    region: string;
    language: string;
  };
  storage: {
    connectionString: string;
    containerName: string;
  };
}

// 数据模型
export interface User {
  id: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  registrationDate: Date;
  lastActiveDate: Date;
  isActive: boolean;
  preferences: UserPreferences;
  metadata: Record<string, any>;
}

export interface UserPreferences {
  whitelistStrategy: 'strict' | 'moderate' | 'permissive';
  autoLearnEnabled: boolean;
  notificationSettings: NotificationSettings;
  privacyLevel: 'high' | 'medium' | 'low';
  customRules: CustomRule[];
}

export interface NotificationSettings {
  spamBlocked: boolean;
  whitelistUpdated: boolean;
  weeklyReport: boolean;
  securityAlerts: boolean;
  systemMaintenance: boolean;
}

export interface CustomRule {
  id: string;
  name: string;
  description: string;
  condition: RuleCondition;
  action: RuleAction;
  isActive: boolean;
  priority: number;
  createdAt: Date;
}

export interface RuleCondition {
  type: 'phone_pattern' | 'time_range' | 'frequency' | 'caller_info';
  operator: 'equals' | 'contains' | 'starts_with' | 'regex' | 'greater_than' | 'less_than';
  value: string | number;
  metadata?: Record<string, any>;
}

export interface RuleAction {
  type: 'allow' | 'block' | 'transfer' | 'ai_handle' | 'log_only';
  parameters?: Record<string, any>;
}

// 通话相关
export interface CallRecord {
  id: string;
  userId: string;
  callerPhone: string;
  callType: 'incoming' | 'outgoing';
  callStatus: 'answered' | 'rejected' | 'missed' | 'transferred' | 'ai_handled';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  azureCallId?: string;
  audioRecordingUrl?: string;
  processingMetadata: ProcessingMetadata;
  qualityMetrics: QualityMetrics;
}

export interface ProcessingMetadata {
  aiProcessingTime: number;
  sttLatency: number;
  ttsLatency: number;
  intentRecognitionTime: number;
  totalPipelineLatency: number;
  modelsUsed: string[];
  errorCount: number;
  retryCount: number;
}

export interface QualityMetrics {
  audioQuality: number;
  speechRecognitionAccuracy: number;
  intentClassificationConfidence: number;
  responseRelevance: number;
  userSatisfaction?: number;
}

export interface ConversationTurn {
  id: string;
  callRecordId: string;
  speaker: 'user' | 'ai' | 'caller';
  messageText: string;
  timestamp: Date;
  confidence: number;
  intent?: string;
  emotion?: EmotionAnalysis;
  entities?: Entity[];
  processingLatency: number;
}

export interface EmotionAnalysis {
  primary: 'happy' | 'sad' | 'angry' | 'neutral' | 'frustrated' | 'confused';
  confidence: number;
  intensity: number;
  secondary?: string[];
}

export interface Entity {
  type: 'person' | 'organization' | 'location' | 'phone_number' | 'email' | 'date' | 'time' | 'money';
  value: string;
  confidence: number;
  startIndex: number;
  endIndex: number;
}

// 分析相关
export interface AnalysisReport {
  id: string;
  userId: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  timeRange: TimeRange;
  metrics: AnalysisMetrics;
  insights: Insight[];
  recommendations: Recommendation[];
  generatedAt: Date;
  format: 'json' | 'pdf' | 'html';
}

export interface TimeRange {
  start: Date;
  end: Date;
  timezone: string;
}

export interface AnalysisMetrics {
  totalCalls: number;
  spamCallsBlocked: number;
  legitimateCallsAnswered: number;
  averageCallDuration: number;
  peakCallHours: number[];
  blockingEffectiveness: number;
  aiAccuracy: number;
  userSatisfactionScore: number;
}

export interface Insight {
  id: string;
  type: 'pattern' | 'anomaly' | 'trend' | 'recommendation';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  supportingData: any[];
  actionable: boolean;
}

export interface Recommendation {
  id: string;
  category: 'security' | 'efficiency' | 'user_experience' | 'cost_optimization';
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  priority: number;
  estimatedBenefit: string;
  implementationSteps: string[];
}

// 机器学习相关
export interface MLModel {
  id: string;
  name: string;
  version: string;
  type: 'classification' | 'regression' | 'clustering' | 'time_series';
  algorithm: string;
  status: 'training' | 'trained' | 'deployed' | 'deprecated';
  accuracy: number;
  trainedAt: Date;
  lastUpdated: Date;
  trainingDataSize: number;
  features: string[];
  hyperparameters: Record<string, any>;
  performanceMetrics: MLPerformanceMetrics;
}

export interface MLPerformanceMetrics {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  rmse?: number;
  mae?: number;
  r2Score?: number;
  confusionMatrix?: number[][];
  featureImportance?: FeatureImportance[];
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  rank: number;
}

export interface TrainingJob {
  id: string;
  modelId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  progress: number;
  trainingData: TrainingDataset;
  validationData?: TrainingDataset;
  metrics?: MLPerformanceMetrics;
  errorMessage?: string;
}

export interface TrainingDataset {
  id: string;
  name: string;
  size: number;
  features: number;
  samples: number;
  createdAt: Date;
  source: string;
  preprocessing: PreprocessingStep[];
}

export interface PreprocessingStep {
  type: 'normalization' | 'encoding' | 'feature_selection' | 'outlier_removal';
  parameters: Record<string, any>;
  applied: boolean;
}

// 实时处理
export interface RealtimeEvent {
  id: string;
  type: 'call_started' | 'call_ended' | 'anomaly_detected' | 'pattern_recognized' | 'model_updated';
  timestamp: Date;
  userId?: string;
  callId?: string;
  data: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  processed: boolean;
}

export interface StreamProcessor {
  id: string;
  name: string;
  type: 'audio' | 'text' | 'behavior' | 'security';
  status: 'running' | 'stopped' | 'error';
  throughput: number;
  latency: number;
  errorRate: number;
  lastHeartbeat: Date;
}

// API 相关
export interface APIRequest {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers: Record<string, string>;
  body?: any;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  clientInfo: ClientInfo;
}

export interface APIResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  timestamp: Date;
  processingTime: number;
  cached: boolean;
}

export interface ClientInfo {
  userAgent: string;
  ipAddress: string;
  country?: string;
  city?: string;
  device?: string;
  browser?: string;
}

// 监控和指标
export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    cores: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    free: number;
    total: number;
    usage: number;
  };
  disk: {
    used: number;
    free: number;
    total: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
}

export interface ServiceHealth {
  serviceName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  uptime: number;
  responseTime: number;
  errorRate: number;
  dependencies: DependencyHealth[];
}

export interface DependencyHealth {
  name: string;
  type: 'database' | 'cache' | 'external_api' | 'queue';
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  responseTime: number;
  errorMessage?: string;
}

// 错误处理
export interface ErrorInfo {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  context?: Record<string, any>;
  stackTrace?: string;
  userId?: string;
  sessionId?: string;
  retryable: boolean;
}

export interface AlertConfig {
  id: string;
  name: string;
  description: string;
  condition: AlertCondition;
  actions: AlertAction[];
  isActive: boolean;
  cooldownPeriod: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface AlertCondition {
  metric: string;
  operator: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  duration: number;
  aggregation: 'avg' | 'sum' | 'min' | 'max' | 'count';
}

export interface AlertAction {
  type: 'email' | 'sms' | 'webhook' | 'slack' | 'pagerduty';
  target: string;
  template?: string;
  metadata?: Record<string, any>;
}

// 安全相关
export interface SecurityEvent {
  id: string;
  type: 'authentication_failure' | 'authorization_failure' | 'suspicious_activity' | 'data_breach' | 'system_intrusion';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  description: string;
  evidence: Record<string, any>;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  before?: any;
  after?: any;
  result: 'success' | 'failure';
  errorMessage?: string;
}

// 导出所有类型的联合类型
export type AllEntityTypes = 
  | User 
  | CallRecord 
  | ConversationTurn 
  | AnalysisReport 
  | MLModel 
  | RealtimeEvent 
  | SecurityEvent 
  | AuditLog;

export type AllConfigTypes = 
  | ServiceConfig 
  | DatabaseConfig 
  | RedisConfig 
  | AzureConfig;

// 工具类型
export type Partial<T> = {
  [P in keyof T]?: T[P];
};

export type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
};

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = 
  Pick<T, Exclude<keyof T, Keys>> & 
  { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];

// 分页相关
export interface PaginationParams {
  page: number;
  limit: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// 过滤器相关
export interface FilterParams {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'starts_with' | 'ends_with';
  value: any;
}

export interface SearchParams {
  query: string;
  fields?: string[];
  exact?: boolean;
  caseSensitive?: boolean;
}

// 批量操作
export interface BulkOperation<T> {
  operation: 'create' | 'update' | 'delete';
  data: T[];
  options?: {
    validateOnly?: boolean;
    continueOnError?: boolean;
    batchSize?: number;
  };
}

export interface BulkOperationResult<T> {
  successful: T[];
  failed: {
    item: T;
    error: string;
  }[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    processingTime: number;
  };
}