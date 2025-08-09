/**
 * AI Phone Answering System - Comprehensive Security Library
 * Provides enterprise-grade security features for all microservices
 */

// Core Security Services
export * from './encryption/DataEncryption';
export * from './encryption/VoiceEncryption';
export * from './encryption/KeyManagement';

// Authentication & Authorization
export * from './auth/JWTManager';
export * from './auth/OAuth2Provider';
export * from './auth/MFAService';
export * from './auth/RBACManager';
export * from './auth/SessionManager';

// API Security
export * from './api/RateLimiter';
export * from './api/InputValidator';
export * from './api/CORSManager';
export * from './api/CSRFProtection';
export * from './api/XSSProtection';
export * from './api/SQLInjectionProtection';

// Privacy & Compliance
export * from './privacy/DataAnonymizer';
export * from './privacy/GDPRCompliance';
export * from './privacy/DataRetention';
export * from './privacy/ConsentManager';

// Audit & Monitoring
export * from './audit/AuditLogger';
export * from './audit/SecurityMonitor';
export * from './audit/ThreatDetector';
export * from './audit/ComplianceReporter';

// Middleware
export * from './middleware/SecurityMiddleware';
export * from './middleware/AuthMiddleware';
export * from './middleware/ValidationMiddleware';

// Utilities
export * from './utils/SecurityUtils';
export * from './utils/CryptoUtils';
export * from './utils/ValidationUtils';

// Types
export * from './types';

// Configuration
export * from './config/SecurityConfig';