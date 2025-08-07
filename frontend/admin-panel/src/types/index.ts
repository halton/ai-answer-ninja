// ==================== 基础类型 ====================

export interface ApiResponse<T = any> {
  success: boolean
  data: T
  message?: string
  code?: string | number
  timestamp?: string
}

export interface PaginationParams {
  page?: number
  pageSize?: number
  total?: number
}

export interface SortParams {
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface FilterParams {
  keyword?: string
  status?: string
  dateRange?: [string, string]
  [key: string]: any
}

export interface QueryParams extends PaginationParams, SortParams, FilterParams {}

// ==================== 用户相关类型 ====================

export interface User {
  id: string
  phoneNumber: string
  name: string
  email?: string
  personality?: 'polite' | 'direct' | 'humorous' | 'professional'
  voiceProfileId?: string
  preferences: UserPreferences
  status: 'active' | 'inactive' | 'suspended'
  role: 'user' | 'admin' | 'system'
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

export interface UserPreferences {
  language?: string
  timezone?: string
  notifications?: {
    email: boolean
    sms: boolean
    push: boolean
  }
  aiSettings?: {
    responseStyle: 'formal' | 'casual' | 'custom'
    maxCallDuration: number
    autoTerminate: boolean
    whitelistEnabled: boolean
  }
}

export interface CreateUserDto {
  phoneNumber: string
  name: string
  email?: string
  personality?: User['personality']
  preferences?: Partial<UserPreferences>
}

export interface UpdateUserDto extends Partial<CreateUserDto> {
  status?: User['status']
  role?: User['role']
}

// ==================== 通话相关类型 ====================

export interface CallRecord {
  id: string
  userId: string
  callerPhone: string
  callerName?: string
  callType: 'incoming' | 'outgoing'
  callStatus: 'answered' | 'missed' | 'blocked' | 'transferred'
  startTime: string
  endTime?: string
  durationSeconds?: number
  azureCallId?: string
  audioRecordingUrl?: string
  summary?: string
  sentiment?: 'positive' | 'neutral' | 'negative'
  spamCategory?: string
  aiResponseCount?: number
  processingMetadata?: ProcessingMetadata
  createdAt: string
}

export interface ProcessingMetadata {
  totalLatency: number
  sttLatency: number
  aiLatency: number
  ttsLatency: number
  audioQuality: number
  confidenceScore: number
  intentRecognitionAccuracy: number
}

export interface Conversation {
  id: string
  callRecordId: string
  speaker: 'user' | 'ai' | 'system'
  messageText: string
  timestamp: string
  confidenceScore?: number
  intentCategory?: string
  emotion?: 'happy' | 'neutral' | 'angry' | 'sad' | 'surprised'
  processingLatency?: number
  createdAt: string
}

// ==================== 白名单相关类型 ====================

export interface WhitelistEntry {
  id: string
  userId: string
  contactPhone: string
  contactName?: string
  whitelistType: 'manual' | 'auto' | 'temporary'
  confidenceScore?: number
  isActive: boolean
  expiresAt?: string
  reason?: string
  addedBy?: 'user' | 'system' | 'ai'
  createdAt: string
  updatedAt: string
}

export interface CreateWhitelistDto {
  contactPhone: string
  contactName?: string
  whitelistType?: WhitelistEntry['whitelistType']
  expiresAt?: string
  reason?: string
}

export interface SmartWhitelistRecommendation {
  phone: string
  name?: string
  reason: string
  confidence: number
  callHistory: number
  lastCallTime: string
  suggestedAction: 'add' | 'ignore' | 'temporary'
}

// ==================== 骚扰者画像类型 ====================

export interface SpamProfile {
  id: string
  phoneHash: string
  spamCategory: 'sales' | 'loan' | 'investment' | 'insurance' | 'scam' | 'unknown'
  riskScore: number
  confidenceLevel: number
  totalReports: number
  featureVector?: Record<string, number>
  behavioralPatterns?: {
    callFrequency: number
    callDuration: number
    timeOfDay: string[]
    persistenceLevel: number
    responsePatterns: string[]
  }
  lastActivity: string
  createdAt: string
  updatedAt: string
}

export interface UserSpamInteraction {
  id: string
  userId: string
  spamProfileId: string
  interactionCount: number
  lastInteraction: string
  userFeedback?: 'spam' | 'not_spam' | 'unknown'
  effectivenessScore?: number
  createdAt: string
  updatedAt: string
}

// ==================== 系统配置类型 ====================

export interface GlobalConfig {
  id: string
  configKey: string
  configValue: any
  configType: 'system' | 'feature' | 'experiment'
  description?: string
  isActive: boolean
  updatedAt: string
}

export interface UserConfig {
  id: string
  userId: string
  configKey: string
  configValue: any
  inheritsGlobal: boolean
  updatedAt: string
}

// ==================== 监控和分析类型 ====================

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical'
  services: ServiceHealth[]
  lastCheckedAt: string
}

export interface ServiceHealth {
  name: string
  status: 'up' | 'down' | 'degraded'
  responseTime: number
  uptime: number
  errorRate: number
  lastError?: string
  dependencies?: string[]
}

export interface PerformanceMetrics {
  timestamp: string
  totalCalls: number
  averageLatency: number
  successRate: number
  errorRate: number
  activeUsers: number
  cpuUsage: number
  memoryUsage: number
  diskUsage: number
  networkIO: number
}

export interface AnalyticsData {
  period: 'hour' | 'day' | 'week' | 'month'
  startDate: string
  endDate: string
  metrics: {
    totalCalls: number
    answeredCalls: number
    blockedCalls: number
    transferredCalls: number
    averageDuration: number
    topSpamCategories: Array<{
      category: string
      count: number
      percentage: number
    }>
    hourlyDistribution: Array<{
      hour: number
      callCount: number
    }>
    aiEffectiveness: {
      successfulTerminations: number
      averageResponseTime: number
      satisfactionScore: number
    }
  }
}

// ==================== WebSocket 类型 ====================

export interface WebSocketMessage {
  type: string
  data: any
  timestamp: string
  userId?: string
}

export interface RealTimeUpdate {
  type: 'call_started' | 'call_ended' | 'user_activity' | 'system_alert' | 'metrics_update'
  payload: any
  timestamp: string
}

// ==================== 表单和UI类型 ====================

export interface TableColumn {
  key: string
  title: string
  dataIndex: string
  width?: number | string
  align?: 'left' | 'center' | 'right'
  sorter?: boolean
  filterable?: boolean
  render?: (value: any, record: any, index: number) => React.ReactNode
}

export interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'area' | 'scatter'
  title?: string
  xAxis?: string
  yAxis?: string
  data: any[]
  colors?: string[]
  height?: number
}

// ==================== 权限和认证类型 ====================

export interface AuthUser {
  id: string
  username: string
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer'
  permissions: string[]
  avatar?: string
  lastLoginAt: string
}

export interface LoginCredentials {
  username: string
  password: string
  rememberMe?: boolean
}

export interface Permission {
  id: string
  name: string
  code: string
  resource: string
  action: string
  description?: string
}

export interface Role {
  id: string
  name: string
  code: string
  permissions: Permission[]
  description?: string
  isSystem: boolean
}