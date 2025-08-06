import { Request } from 'express';

// ==========================================
// Core User Types
// ==========================================

export interface User {
  id: string;
  phoneNumber: string;
  name: string;
  email?: string;
  personality: PersonalityType;
  voiceProfileId?: string;
  languagePreference: string;
  timezone: string;
  maxCallDuration: number;
  preferences: UserPreferences;
  role: UserRole;
  isActive: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  phoneNumber: string;
  name: string;
  email?: string;
  password: string;
  personality?: PersonalityType;
  languagePreference?: string;
  timezone?: string;
  preferences?: Partial<UserPreferences>;
}

export interface UpdateUserData {
  name?: string;
  email?: string;
  personality?: PersonalityType;
  voiceProfileId?: string;
  languagePreference?: string;
  timezone?: string;
  maxCallDuration?: number;
  preferences?: Partial<UserPreferences>;
}

// ==========================================
// Authentication Types
// ==========================================

export interface LoginCredentials {
  phoneNumber: string;
  password: string;
  deviceFingerprint?: string;
  rememberMe?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface JWTPayload {
  userId: string;
  phoneNumber: string;
  role: UserRole;
  sessionId: string;
  permissions: Permission[];
  iat: number;
  exp: number;
}

export interface RefreshTokenData {
  id: string;
  userId: string;
  token: string;
  deviceInfo?: DeviceInfo;
  isRevoked: boolean;
  expiresAt: Date;
  createdAt: Date;
}

// ==========================================
// MFA Types
// ==========================================

export interface MFASettings {
  isEnabled: boolean;
  secret?: string;
  backupCodes: string[];
  method: MFAMethod;
  lastUsedAt?: Date;
}

export interface MFASetupData {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface MFAVerificationData {
  token: string;
  method: MFAMethod;
}

export type MFAMethod = 'totp' | 'sms' | 'email';

// ==========================================
// RBAC Types
// ==========================================

export type UserRole = 'user' | 'admin' | 'moderator' | 'system';

export type Permission = 
  | 'read:own_data'
  | 'update:own_profile'
  | 'delete:own_account'
  | 'manage:own_whitelist'
  | 'view:own_calls'
  | 'read:all_data'
  | 'update:system_config'
  | 'manage:users'
  | 'view:analytics'
  | 'manage:spam_profiles'
  | 'system:admin';

export interface RolePermissions {
  [key: string]: Permission[];
}

// ==========================================
// User Preferences Types
// ==========================================

export type PersonalityType = 'polite' | 'direct' | 'humorous' | 'professional' | 'custom';

export interface UserPreferences {
  notifications: NotificationPreferences;
  privacy: PrivacyPreferences;
  callHandling: CallHandlingPreferences;
  ai: AIPreferences;
  security: SecurityPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  callSummary: boolean;
  securityAlerts: boolean;
  weeklyReport: boolean;
}

export interface PrivacyPreferences {
  recordCalls: boolean;
  shareAnalytics: boolean;
  dataRetentionDays: number;
  allowPersonalization: boolean;
}

export interface CallHandlingPreferences {
  maxDuration: number;
  autoTerminate: boolean;
  whitelistMode: 'strict' | 'moderate' | 'permissive';
  blockUnknown: boolean;
  customResponses: string[];
}

export interface AIPreferences {
  personality: PersonalityType;
  responseStyle: 'formal' | 'casual' | 'friendly' | 'business';
  aggressiveness: 'passive' | 'moderate' | 'assertive';
  learningEnabled: boolean;
}

export interface SecurityPreferences {
  mfaEnabled: boolean;
  sessionTimeout: number;
  loginNotifications: boolean;
  deviceTracking: boolean;
}

// ==========================================
// Session and Device Types
// ==========================================

export interface UserSession {
  id: string;
  userId: string;
  sessionId: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
  lastActivityAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface DeviceInfo {
  fingerprint: string;
  platform: string;
  browser: string;
  version: string;
  isMobile: boolean;
  isTrusted: boolean;
}

// ==========================================
// Audit and Security Types
// ==========================================

export interface AuditLog {
  id: string;
  userId?: string;
  action: AuditAction;
  resource: string;
  details: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  timestamp: Date;
}

export type AuditAction = 
  | 'login'
  | 'logout'
  | 'register'
  | 'password_change'
  | 'password_reset'
  | 'mfa_enable'
  | 'mfa_disable'
  | 'profile_update'
  | 'permissions_change'
  | 'account_lock'
  | 'account_unlock'
  | 'data_export'
  | 'data_deletion';

export interface SecurityEvent {
  type: SecurityEventType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  details: Record<string, any>;
  timestamp: Date;
}

export type SecurityEventType = 
  | 'failed_login'
  | 'account_locked'
  | 'suspicious_activity'
  | 'password_breach'
  | 'mfa_bypass_attempt'
  | 'device_change'
  | 'location_change';

// ==========================================
// Configuration Types
// ==========================================

export interface SystemConfig {
  id: string;
  key: string;
  value: any;
  type: ConfigType;
  description?: string;
  isActive: boolean;
  isSensitive: boolean;
  requiresRestart: boolean;
  version: number;
  lastModifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserConfig {
  id: string;
  userId: string;
  key: string;
  value: any;
  inheritsGlobal: boolean;
  overrideReason?: string;
  autoLearned: boolean;
  learningConfidence?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ConfigType = 'system' | 'feature' | 'experiment' | 'security';

// ==========================================
// API Response Types
// ==========================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: ValidationError[];
  meta?: ResponseMeta;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  timestamp: Date;
  requestId: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ==========================================
// Request Extensions
// ==========================================

export interface AuthenticatedRequest extends Request {
  user: User;
  session: UserSession;
  permissions: Permission[];
}

export interface AdminRequest extends AuthenticatedRequest {
  user: User & { role: 'admin' | 'system' };
}

// ==========================================
// Email and Communication Types
// ==========================================

export interface EmailTemplate {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, any>;
}

export interface PasswordResetRequest {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  isUsed: boolean;
  createdAt: Date;
}

export interface EmailVerificationRequest {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  isUsed: boolean;
  createdAt: Date;
}

// ==========================================
// Rate Limiting Types
// ==========================================

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: Date;
}

// ==========================================
// Environment Configuration
// ==========================================

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  database: DatabaseConfig;
  redis: RedisConfig;
  jwt: JWTConfig;
  email: EmailConfig;
  security: SecurityConfig;
  rateLimit: RateLimitConfig;
}

export interface DatabaseConfig {
  url: string;
  poolSize: number;
  timeout: number;
}

export interface RedisConfig {
  url: string;
  keyPrefix: string;
  ttl: number;
}

export interface JWTConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiry: string;
  refreshExpiry: string;
  issuer: string;
  audience: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

export interface SecurityConfig {
  bcryptRounds: number;
  maxLoginAttempts: number;
  lockoutDuration: number;
  sessionTimeout: number;
  mfaWindowSize: number;
  passwordMinLength: number;
  passwordRequireSpecial: boolean;
}