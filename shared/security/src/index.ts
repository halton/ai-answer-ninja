/**
 * AI Phone Answering System - Comprehensive Security Library
 * Provides enterprise-grade security features for all microservices
 * 
 * Security Infrastructure Components:
 * - End-to-end encryption for voice data and sensitive information
 * - Real-time threat detection and automated response
 * - Comprehensive audit logging with tamper-proof integrity
 * - HTTPS/TLS 1.3 transport security
 * - Secure storage with data classification
 * - Multi-layered security middleware
 */

// Core Encryption Services
export * from './crypto/EncryptionService';
export * from './encryption/AESEncryption';
export * from './encryption/DataEncryption';
export * from './encryption/VoiceEncryption';
export * from './encryption/KeyManagement';

// Transport Security
export * from './transport/TLSManager';

// Secure Storage
export * from './storage/SecureStorageManager';

// Authentication & Authorization
export * from './auth/SecurityAuditor';
export * from './auth/JWTManager';
export * from './auth/OAuth2Provider';
export * from './auth/MFAService';
export * from './auth/RBACManager';
export * from './auth/SessionManager';

// Threat Detection & Security Intelligence
export * from './threats/ThreatDetectionEngine';

// API Security
export * from './api/RateLimiter';
export * from './api/InputValidator';
export * from './api/CORSManager';

// Security Middleware Collection
export * from './middleware/SecurityMiddleware';

// Comprehensive Audit System
export * from './audit/ComprehensiveAuditSystem';
export * from './audit/AuditLogger';

// Privacy & Compliance
export * from './privacy/DataAnonymizer';
export * from './privacy/GDPRCompliance';

// Utilities
export * from './utils/Logger';

// Types
export * from './types';

// Security Constants and Enums
export {
  DataClassification,
  StorageType
} from './storage/SecureStorageManager';

export {
  SecurityEventType,
  SecuritySeverity
} from './auth/SecurityAuditor';

export {
  AuditEventType,
  AuditSeverity
} from './audit/ComprehensiveAuditSystem';

export {
  ThreatType,
  ThreatSeverity,
  ResponseAction
} from './threats/ThreatDetectionEngine';

// Singleton Instances (Pre-configured for immediate use)
export { encryptionService } from './crypto/EncryptionService';
export { securityAuditor } from './auth/SecurityAuditor';
export { securityMiddleware } from './middleware/SecurityMiddleware';
export { secureStorageManager } from './storage/SecureStorageManager';
export { comprehensiveAuditSystem } from './audit/ComprehensiveAuditSystem';
export { threatDetectionEngine } from './threats/ThreatDetectionEngine';
export { tlsManager } from './transport/TLSManager';