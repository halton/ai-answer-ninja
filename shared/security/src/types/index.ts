/**
 * Security Type Definitions
 */

import { Request } from 'express';

// ==========================================
// Encryption Types
// ==========================================

export interface EncryptionOptions {
  algorithm?: 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305';
  keyDerivation?: 'pbkdf2' | 'scrypt' | 'argon2';
  iterations?: number;
  saltLength?: number;
  tagLength?: number;
}

export interface EncryptedData {
  data: string;
  iv: string;
  salt: string;
  tag?: string;
  algorithm: string;
  keyVersion: string;
  timestamp: number;
  checksum: string;
}

export interface VoiceEncryptionOptions extends EncryptionOptions {
  compression?: boolean;
  chunkSize?: number;
  streamMode?: boolean;
}

// ==========================================
// Authentication Types
// ==========================================

export interface JWTPayload {
  userId: string;
  sessionId: string;
  permissions: string[];
  roles: string[];
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
  deviceFingerprint?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: UserSession;
  permissions?: string[];
  roles?: string[];
  deviceFingerprint?: string;
}

export interface User {
  id: string;
  phoneNumber: string;
  email?: string;
  name: string;
  roles: string[];
  permissions: string[];
  isActive: boolean;
  isLocked: boolean;
  isEmailVerified?: boolean;
  isMFAEnabled: boolean;
  lockReason?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  deviceInfo?: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
}

export interface DeviceInfo {
  fingerprint: string;
  type: string;
  os: string;
  browser?: string;
  isTrusted: boolean;
}

export interface MFASettings {
  userId: string;
  isEnabled: boolean;
  methods: MFAMethod[];
  backupCodes?: string[];
  preferredMethod?: MFAMethodType;
}

export interface MFAMethod {
  type: MFAMethodType;
  isConfigured: boolean;
  isVerified: boolean;
  secret?: string;
  phoneNumber?: string;
  email?: string;
  configuredAt?: Date;
  lastUsedAt?: Date;
}

export type MFAMethodType = 'totp' | 'sms' | 'email' | 'backup_codes';

// ==========================================
// Authorization Types
// ==========================================

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  conditions?: Record<string, any>;
  description?: string;
}

export interface AccessControlPolicy {
  userId: string;
  roles: string[];
  permissions: string[];
  restrictions?: AccessRestriction[];
  effectiveFrom?: Date;
  effectiveUntil?: Date;
}

export interface AccessRestriction {
  type: 'ip' | 'time' | 'location' | 'device';
  value: any;
  action: 'allow' | 'deny';
}

// ==========================================
// Security Event Types
// ==========================================

export interface SecurityEvent {
  id?: string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  details?: Record<string, any>;
  timestamp: Date;
  resolved?: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export type SecurityEventType = 
  | 'failed_login'
  | 'successful_login'
  | 'logout'
  | 'password_reset'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'permission_denied'
  | 'suspicious_activity'
  | 'data_breach_attempt'
  | 'brute_force_detected'
  | 'rate_limit_exceeded'
  | 'invalid_token'
  | 'session_hijack_attempt'
  | 'sql_injection_attempt'
  | 'xss_attempt'
  | 'unauthorized_access'
  | 'data_export'
  | 'data_deletion'
  | 'configuration_change'
  | 'api_key_generated'
  | 'api_key_revoked';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

// ==========================================
// Audit Types
// ==========================================

export interface AuditLog {
  id: string;
  userId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  method?: string;
  ipAddress?: string;
  userAgent?: string;
  requestData?: Record<string, any>;
  responseData?: Record<string, any>;
  statusCode?: number;
  duration?: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  integrity?: string;
}

export interface ComplianceReport {
  reportId: string;
  type: ComplianceType;
  period: {
    start: Date;
    end: Date;
  };
  status: 'compliant' | 'non_compliant' | 'partially_compliant';
  findings: ComplianceFinding[];
  recommendations: string[];
  generatedAt: Date;
  generatedBy: string;
}

export interface ComplianceFinding {
  requirement: string;
  status: 'pass' | 'fail' | 'partial';
  evidence?: string[];
  gaps?: string[];
  remediationSteps?: string[];
}

export type ComplianceType = 'gdpr' | 'ccpa' | 'hipaa' | 'pci_dss' | 'sox' | 'iso_27001';

// ==========================================
// Privacy Types
// ==========================================

export interface DataSubjectRequest {
  id: string;
  userId: string;
  type: DataSubjectRequestType;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  requestedAt: Date;
  processedAt?: Date;
  processedBy?: string;
  data?: any;
  reason?: string;
  verificationMethod?: string;
  verificationCompleted?: boolean;
}

export type DataSubjectRequestType = 
  | 'access'
  | 'rectification'
  | 'erasure'
  | 'portability'
  | 'objection'
  | 'restriction';

export interface ConsentRecord {
  id: string;
  userId: string;
  purpose: string;
  description: string;
  lawfulBasis: string;
  granted: boolean;
  grantedAt?: Date;
  revokedAt?: Date;
  expiresAt?: Date;
  version: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface DataRetentionPolicy {
  dataType: string;
  retentionPeriod: number; // in days
  afterRetentionAction: 'delete' | 'anonymize' | 'archive';
  legalBasis?: string;
  exceptions?: string[];
  lastExecuted?: Date;
  nextExecution?: Date;
}

// ==========================================
// Rate Limiting Types
// ==========================================

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  handler?: (req: Request, res: any) => void;
}

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

// ==========================================
// Validation Types
// ==========================================

export interface ValidationRule {
  field: string;
  rules: Array<{
    type: ValidationType;
    value?: any;
    message?: string;
  }>;
  sanitize?: boolean;
  transform?: (value: any) => any;
}

export type ValidationType = 
  | 'required'
  | 'email'
  | 'phone'
  | 'url'
  | 'uuid'
  | 'alpha'
  | 'numeric'
  | 'alphanumeric'
  | 'length'
  | 'min'
  | 'max'
  | 'pattern'
  | 'custom';

export interface ValidationError {
  field: string;
  value?: any;
  message: string;
  code: string;
}

// ==========================================
// Voice Security Types
// ==========================================

export interface VoiceDataEncryption {
  callId: string;
  userId: string;
  encryptedAudio: Buffer;
  encryptionMetadata: {
    algorithm: string;
    keyId: string;
    chunkSize: number;
    duration: number;
    sampleRate: number;
    channels: number;
  };
  timestamp: Date;
  checksum: string;
}

export interface VoicePrivacySettings {
  userId: string;
  enableRecording: boolean;
  enableTranscription: boolean;
  autoDeleteAfterDays: number;
  maskSensitiveInfo: boolean;
  consentGiven: boolean;
  consentTimestamp?: Date;
}

// ==========================================
// API Security Types
// ==========================================

export interface APIKey {
  id: string;
  key: string;
  name: string;
  userId: string;
  permissions: string[];
  rateLimit?: number;
  ipWhitelist?: string[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  revokeReason?: string;
}

export interface CORSOptions {
  origin: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
}

export interface CSRFToken {
  token: string;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
}

// ==========================================
// Threat Detection Types
// ==========================================

export interface ThreatIndicator {
  type: ThreatType;
  confidence: number;
  source: string;
  details: Record<string, any>;
  detectedAt: Date;
  mitigationApplied?: boolean;
  mitigationDetails?: string;
}

export type ThreatType = 
  | 'brute_force'
  | 'credential_stuffing'
  | 'session_hijacking'
  | 'sql_injection'
  | 'xss'
  | 'csrf'
  | 'ddos'
  | 'data_exfiltration'
  | 'privilege_escalation'
  | 'malware'
  | 'phishing'
  | 'insider_threat';

export interface SecurityMetrics {
  period: {
    start: Date;
    end: Date;
  };
  totalRequests: number;
  blockedRequests: number;
  failedAuthentications: number;
  successfulAuthentications: number;
  threatsDetected: number;
  threatsBlocked: number;
  averageResponseTime: number;
  uptime: number;
  complianceScore: number;
}