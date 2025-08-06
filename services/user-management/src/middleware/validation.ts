import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationChain } from 'express-validator';
import { ApiResponse, ValidationError } from '@/types';

/**
 * Middleware to handle validation errors
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const validationErrors: ValidationError[] = errors.array().map(error => ({
      field: error.type === 'field' ? error.path : 'unknown',
      message: error.msg,
      code: 'VALIDATION_ERROR'
    }));

    const response: ApiResponse = {
      success: false,
      message: 'Validation failed',
      errors: validationErrors
    };

    res.status(400).json(response);
    return;
  }

  next();
};

// ==========================================
// Authentication Validations
// ==========================================

export const validateLogin = [
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1 })
    .withMessage('Password cannot be empty'),
  
  body('deviceFingerprint')
    .optional()
    .isString()
    .withMessage('Device fingerprint must be a string'),
  
  body('rememberMe')
    .optional()
    .isBoolean()
    .withMessage('Remember me must be a boolean'),
  
  handleValidationErrors
];

export const validateRegister = [
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format'),
  
  body('name')
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s\u4e00-\u9fff]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  
  body('personality')
    .optional()
    .isIn(['polite', 'direct', 'humorous', 'professional', 'custom'])
    .withMessage('Invalid personality type'),
  
  body('languagePreference')
    .optional()
    .matches(/^[a-z]{2}-[A-Z]{2}$/)
    .withMessage('Invalid language preference format (e.g., zh-CN)'),
  
  body('timezone')
    .optional()
    .isString()
    .withMessage('Timezone must be a string'),
  
  handleValidationErrors
];

export const validateRefreshToken = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
    .isString()
    .withMessage('Refresh token must be a string'),
  
  handleValidationErrors
];

export const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number'),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    }),
  
  handleValidationErrors
];

export const validatePasswordReset = [
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),
  
  handleValidationErrors
];

export const validatePasswordResetConfirm = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required')
    .isString()
    .withMessage('Reset token must be a string'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number'),
  
  handleValidationErrors
];

// ==========================================
// MFA Validations
// ==========================================

export const validateMFASetup = [
  body('method')
    .isIn(['totp', 'sms', 'email'])
    .withMessage('Invalid MFA method'),
  
  handleValidationErrors
];

export const validateMFAVerify = [
  body('token')
    .notEmpty()
    .withMessage('MFA token is required')
    .matches(/^\d{6}$/)
    .withMessage('MFA token must be 6 digits'),
  
  body('method')
    .isIn(['totp', 'sms', 'email'])
    .withMessage('Invalid MFA method'),
  
  handleValidationErrors
];

export const validateMFADisable = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required for MFA disable'),
  
  handleValidationErrors
];

// ==========================================
// User Profile Validations
// ==========================================

export const validateUpdateProfile = [
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s\u4e00-\u9fff]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  
  body('personality')
    .optional()
    .isIn(['polite', 'direct', 'humorous', 'professional', 'custom'])
    .withMessage('Invalid personality type'),
  
  body('voiceProfileId')
    .optional()
    .isString()
    .withMessage('Voice profile ID must be a string'),
  
  body('languagePreference')
    .optional()
    .matches(/^[a-z]{2}-[A-Z]{2}$/)
    .withMessage('Invalid language preference format'),
  
  body('timezone')
    .optional()
    .isString()
    .withMessage('Timezone must be a string'),
  
  body('maxCallDuration')
    .optional()
    .isInt({ min: 30, max: 1800 })
    .withMessage('Max call duration must be between 30 and 1800 seconds'),
  
  handleValidationErrors
];

export const validateUpdatePreferences = [
  body('notifications')
    .optional()
    .isObject()
    .withMessage('Notifications must be an object'),
  
  body('notifications.email')
    .optional()
    .isBoolean()
    .withMessage('Email notification setting must be boolean'),
  
  body('notifications.sms')
    .optional()
    .isBoolean()
    .withMessage('SMS notification setting must be boolean'),
  
  body('notifications.push')
    .optional()
    .isBoolean()
    .withMessage('Push notification setting must be boolean'),
  
  body('privacy')
    .optional()
    .isObject()
    .withMessage('Privacy must be an object'),
  
  body('privacy.recordCalls')
    .optional()
    .isBoolean()
    .withMessage('Record calls setting must be boolean'),
  
  body('privacy.shareAnalytics')
    .optional()
    .isBoolean()
    .withMessage('Share analytics setting must be boolean'),
  
  body('privacy.dataRetentionDays')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Data retention days must be between 1 and 365'),
  
  body('callHandling')
    .optional()
    .isObject()
    .withMessage('Call handling must be an object'),
  
  body('callHandling.maxDuration')
    .optional()
    .isInt({ min: 30, max: 1800 })
    .withMessage('Max duration must be between 30 and 1800 seconds'),
  
  body('callHandling.whitelistMode')
    .optional()
    .isIn(['strict', 'moderate', 'permissive'])
    .withMessage('Invalid whitelist mode'),
  
  body('ai')
    .optional()
    .isObject()
    .withMessage('AI preferences must be an object'),
  
  body('ai.personality')
    .optional()
    .isIn(['polite', 'direct', 'humorous', 'professional', 'custom'])
    .withMessage('Invalid AI personality'),
  
  body('ai.responseStyle')
    .optional()
    .isIn(['formal', 'casual', 'friendly', 'business'])
    .withMessage('Invalid response style'),
  
  body('ai.aggressiveness')
    .optional()
    .isIn(['passive', 'moderate', 'assertive'])
    .withMessage('Invalid aggressiveness level'),
  
  body('security')
    .optional()
    .isObject()
    .withMessage('Security preferences must be an object'),
  
  body('security.sessionTimeout')
    .optional()
    .isInt({ min: 300, max: 86400 })
    .withMessage('Session timeout must be between 5 minutes and 24 hours'),
  
  handleValidationErrors
];

// ==========================================
// Admin Validations
// ==========================================

export const validateRoleChange = [
  body('targetUserId')
    .isUUID()
    .withMessage('Valid target user ID is required'),
  
  body('newRole')
    .isIn(['user', 'moderator', 'admin', 'system'])
    .withMessage('Invalid role'),
  
  body('reason')
    .notEmpty()
    .withMessage('Reason for role change is required')
    .isLength({ min: 10, max: 500 })
    .withMessage('Reason must be between 10 and 500 characters'),
  
  handleValidationErrors
];

export const validateBulkRoleAssignment = [
  body('assignments')
    .isArray({ min: 1 })
    .withMessage('Assignments array is required'),
  
  body('assignments.*.userId')
    .isUUID()
    .withMessage('Valid user ID is required for each assignment'),
  
  body('assignments.*.role')
    .isIn(['user', 'moderator', 'admin', 'system'])
    .withMessage('Invalid role in assignment'),
  
  body('assignments.*.reason')
    .notEmpty()
    .withMessage('Reason is required for each assignment')
    .isLength({ min: 10, max: 500 })
    .withMessage('Reason must be between 10 and 500 characters'),
  
  handleValidationErrors
];

// ==========================================
// Query Parameter Validations
// ==========================================

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  
  handleValidationErrors
];

export const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO8601 date')
    .toDate(),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO8601 date')
    .toDate()
    .custom((value, { req }) => {
      if (req.query.startDate && value < req.query.startDate) {
        throw new Error('End date must be after start date');
      }
      return true;
    }),
  
  handleValidationErrors
];

export const validateAuditLogQuery = [
  query('action')
    .optional()
    .isIn(['login', 'logout', 'register', 'password_change', 'password_reset', 'mfa_enable', 'mfa_disable', 'profile_update', 'permissions_change', 'account_lock', 'account_unlock', 'data_export', 'data_deletion'])
    .withMessage('Invalid audit action'),
  
  query('resource')
    .optional()
    .isString()
    .withMessage('Resource must be a string'),
  
  query('success')
    .optional()
    .isBoolean()
    .withMessage('Success must be a boolean')
    .toBoolean(),
  
  ...validateDateRange,
  ...validatePagination
];

// ==========================================
// Parameter Validations
// ==========================================

export const validateUserId = [
  param('userId')
    .isUUID()
    .withMessage('Valid user ID is required'),
  
  handleValidationErrors
];

export const validateConfigKey = [
  param('key')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('Config key can only contain letters, numbers, dots, hyphens, and underscores'),
  
  handleValidationErrors
];

// ==========================================
// Configuration Validations
// ==========================================

export const validateUserConfig = [
  body('key')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('Config key can only contain letters, numbers, dots, hyphens, and underscores'),
  
  body('value')
    .notEmpty()
    .withMessage('Config value is required'),
  
  body('inheritsGlobal')
    .optional()
    .isBoolean()
    .withMessage('Inherits global must be boolean'),
  
  body('overrideReason')
    .optional()
    .isString()
    .withMessage('Override reason must be a string'),
  
  handleValidationErrors
];

// ==========================================
// Whitelist Validations
// ==========================================

export const validateWhitelistEntry = [
  body('contactPhone')
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format'),
  
  body('contactName')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Contact name must be between 1 and 100 characters'),
  
  body('whitelistType')
    .optional()
    .isIn(['manual', 'auto', 'temporary'])
    .withMessage('Invalid whitelist type'),
  
  body('expiresAt')
    .optional()
    .isISO8601()
    .withMessage('Expires at must be a valid ISO8601 date')
    .toDate()
    .custom((value) => {
      if (value && value <= new Date()) {
        throw new Error('Expiration date must be in the future');
      }
      return true;
    }),
  
  handleValidationErrors
];

// ==========================================
// Custom Validation Helpers
// ==========================================

export const validatePhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/(?=.*[a-z])/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/(?=.*[A-Z])/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/(?=.*\d)/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/(?=.*[!@#$%^&*(),.?\":{}|<>])/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Sanitize user input to prevent XSS and injection attacks
 */
export const sanitizeInput = (input: any): any => {
  if (typeof input === 'string') {
    return input
      .trim()
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/[<>\"']/g, ''); // Remove potentially dangerous characters
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (typeof input === 'object' && input !== null) {
    const sanitized: any = {};
    Object.keys(input).forEach(key => {
      sanitized[key] = sanitizeInput(input[key]);
    });
    return sanitized;
  }
  
  return input;
};

/**
 * Middleware to sanitize request body
 */
export const sanitizeRequestBody = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  next();
};