/**
 * Input Validator
 * Validates and sanitizes user input to prevent injection attacks
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import sanitizeHtml from 'sanitize-html';
import xss from 'xss';
import { ValidationRule, ValidationError, ValidationType } from '../types';
import { logger } from '../utils/Logger';

export class InputValidator {
  private static instance: InputValidator;
  
  // Common validation patterns
  private readonly PATTERNS = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/,
    url: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    alphanumeric: /^[a-zA-Z0-9]+$/,
    alpha: /^[a-zA-Z]+$/,
    numeric: /^[0-9]+$/,
    strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{8,})/,
    creditCard: /^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})$/,
    ipv4: /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
    ipv6: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/
  };
  
  // Dangerous patterns to detect
  private readonly DANGEROUS_PATTERNS = {
    sqlInjection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE|SCRIPT)\b|--|\/\*|\*\/|xp_|sp_|0x)/gi,
    scriptTag: /<script[^>]*>.*?<\/script>/gi,
    eventHandler: /on\w+\s*=/gi,
    javascript: /javascript:/gi,
    dataUri: /data:text\/html/gi,
    vbscript: /vbscript:/gi,
    commandInjection: /[;&|`$()]/g,
    pathTraversal: /\.\.[\/\\]/g,
    xmlInjection: /<!\[CDATA\[|<!ENTITY|<!DOCTYPE/gi
  };
  
  private constructor() {}
  
  public static getInstance(): InputValidator {
    if (!InputValidator.instance) {
      InputValidator.instance = new InputValidator();
    }
    return InputValidator.instance;
  }
  
  /**
   * Create validation middleware
   */
  public validate(schema: Joi.Schema) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Combine all input sources
        const input = {
          ...req.body,
          ...req.query,
          ...req.params
        };
        
        // Validate against schema
        const { error, value } = schema.validate(input, {
          abortEarly: false,
          stripUnknown: true,
          convert: true
        });
        
        if (error) {
          const errors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            type: detail.type
          }));
          
          logger.warn('Validation failed', {
            errors,
            path: req.path,
            method: req.method
          });
          
          return res.status(400).json({
            error: 'Validation failed',
            errors
          });
        }
        
        // Replace input with validated and sanitized values
        req.body = value;
        
        // Check for dangerous patterns
        const threats = await this.detectThreats(value);
        if (threats.length > 0) {
          logger.warn('Potential threats detected', {
            threats,
            path: req.path,
            method: req.method,
            ip: req.ip
          });
          
          return res.status(400).json({
            error: 'Invalid input detected',
            message: 'Your request contains potentially harmful content'
          });
        }
        
        next();
      } catch (error) {
        logger.error('Validation error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          path: req.path
        });
        
        res.status(500).json({
          error: 'Validation error',
          message: 'An error occurred while validating your request'
        });
      }
    };
  }
  
  /**
   * Validate field with rules
   */
  public validateField(value: any, rules: ValidationRule[]): ValidationError[] {
    const errors: ValidationError[] = [];
    
    for (const rule of rules) {
      const error = this.applyRule(value, rule);
      if (error) {
        errors.push(error);
      }
    }
    
    return errors;
  }
  
  /**
   * Apply single validation rule
   */
  private applyRule(value: any, rule: ValidationRule): ValidationError | null {
    for (const check of rule.rules) {
      let isValid = true;
      let errorMessage = check.message || 'Validation failed';
      
      switch (check.type) {
        case 'required':
          isValid = value !== undefined && value !== null && value !== '';
          errorMessage = check.message || `${rule.field} is required`;
          break;
          
        case 'email':
          isValid = !value || this.PATTERNS.email.test(value);
          errorMessage = check.message || `${rule.field} must be a valid email`;
          break;
          
        case 'phone':
          isValid = !value || this.PATTERNS.phone.test(value);
          errorMessage = check.message || `${rule.field} must be a valid phone number`;
          break;
          
        case 'url':
          isValid = !value || this.PATTERNS.url.test(value);
          errorMessage = check.message || `${rule.field} must be a valid URL`;
          break;
          
        case 'uuid':
          isValid = !value || this.PATTERNS.uuid.test(value);
          errorMessage = check.message || `${rule.field} must be a valid UUID`;
          break;
          
        case 'alpha':
          isValid = !value || this.PATTERNS.alpha.test(value);
          errorMessage = check.message || `${rule.field} must contain only letters`;
          break;
          
        case 'numeric':
          isValid = !value || this.PATTERNS.numeric.test(value);
          errorMessage = check.message || `${rule.field} must contain only numbers`;
          break;
          
        case 'alphanumeric':
          isValid = !value || this.PATTERNS.alphanumeric.test(value);
          errorMessage = check.message || `${rule.field} must contain only letters and numbers`;
          break;
          
        case 'length':
          if (check.value && typeof value === 'string') {
            const { min, max } = check.value;
            isValid = (!min || value.length >= min) && (!max || value.length <= max);
            errorMessage = check.message || `${rule.field} must be between ${min} and ${max} characters`;
          }
          break;
          
        case 'min':
          if (check.value !== undefined) {
            isValid = !value || Number(value) >= check.value;
            errorMessage = check.message || `${rule.field} must be at least ${check.value}`;
          }
          break;
          
        case 'max':
          if (check.value !== undefined) {
            isValid = !value || Number(value) <= check.value;
            errorMessage = check.message || `${rule.field} must be at most ${check.value}`;
          }
          break;
          
        case 'pattern':
          if (check.value instanceof RegExp) {
            isValid = !value || check.value.test(value);
            errorMessage = check.message || `${rule.field} format is invalid`;
          }
          break;
          
        case 'custom':
          if (typeof check.value === 'function') {
            isValid = check.value(value);
            errorMessage = check.message || `${rule.field} validation failed`;
          }
          break;
      }
      
      if (!isValid) {
        return {
          field: rule.field,
          value,
          message: errorMessage,
          code: check.type
        };
      }
    }
    
    return null;
  }
  
  /**
   * Sanitize HTML content
   */
  public sanitizeHtml(input: string, options?: sanitizeHtml.IOptions): string {
    const defaultOptions: sanitizeHtml.IOptions = {
      allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
      allowedAttributes: {
        'a': ['href']
      },
      allowedSchemes: ['http', 'https'],
      textFilter: (text) => {
        // Remove any remaining dangerous patterns
        return text.replace(this.DANGEROUS_PATTERNS.scriptTag, '')
                   .replace(this.DANGEROUS_PATTERNS.eventHandler, '');
      }
    };
    
    return sanitizeHtml(input, options || defaultOptions);
  }
  
  /**
   * Sanitize for XSS
   */
  public sanitizeXSS(input: string): string {
    return xss(input);
  }
  
  /**
   * Sanitize SQL input
   */
  public sanitizeSQL(input: string): string {
    // Basic SQL injection prevention
    return input
      .replace(/'/g, "''") // Escape single quotes
      .replace(/;/g, '') // Remove semicolons
      .replace(/--/g, '') // Remove SQL comments
      .replace(/\/\*/g, '') // Remove block comments
      .replace(/\*\//g, '');
  }
  
  /**
   * Sanitize file path
   */
  public sanitizeFilePath(path: string): string {
    // Remove path traversal attempts
    return path
      .replace(/\.\./g, '')
      .replace(/[\/\\]{2,}/g, '/')
      .replace(/^[\/\\]/, '')
      .replace(/[^a-zA-Z0-9._\-\/\\]/g, '');
  }
  
  /**
   * Sanitize JSON
   */
  public sanitizeJSON(obj: any): any {
    if (typeof obj === 'string') {
      return this.sanitizeXSS(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeJSON(item));
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          // Sanitize key
          const sanitizedKey = this.sanitizeXSS(key);
          // Sanitize value
          sanitized[sanitizedKey] = this.sanitizeJSON(obj[key]);
        }
      }
      return sanitized;
    }
    
    return obj;
  }
  
  /**
   * Detect potential threats in input
   */
  private async detectThreats(input: any): Promise<string[]> {
    const threats: string[] = [];
    
    const checkValue = (value: any, path: string = '') => {
      if (typeof value === 'string') {
        // Check for SQL injection
        if (this.DANGEROUS_PATTERNS.sqlInjection.test(value)) {
          threats.push(`SQL injection attempt detected at ${path}`);
        }
        
        // Check for script tags
        if (this.DANGEROUS_PATTERNS.scriptTag.test(value)) {
          threats.push(`Script tag detected at ${path}`);
        }
        
        // Check for event handlers
        if (this.DANGEROUS_PATTERNS.eventHandler.test(value)) {
          threats.push(`Event handler detected at ${path}`);
        }
        
        // Check for command injection
        if (this.DANGEROUS_PATTERNS.commandInjection.test(value)) {
          threats.push(`Command injection attempt detected at ${path}`);
        }
        
        // Check for path traversal
        if (this.DANGEROUS_PATTERNS.pathTraversal.test(value)) {
          threats.push(`Path traversal attempt detected at ${path}`);
        }
        
        // Check for XML injection
        if (this.DANGEROUS_PATTERNS.xmlInjection.test(value)) {
          threats.push(`XML injection attempt detected at ${path}`);
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => checkValue(item, `${path}[${index}]`));
      } else if (value && typeof value === 'object') {
        Object.keys(value).forEach(key => checkValue(value[key], path ? `${path}.${key}` : key));
      }
    };
    
    checkValue(input);
    
    return threats;
  }
  
  /**
   * Validate password strength
   */
  public validatePasswordStrength(password: string): {
    isValid: boolean;
    score: number;
    suggestions: string[];
  } {
    const suggestions: string[] = [];
    let score = 0;
    
    // Length check
    if (password.length >= 8) score += 20;
    if (password.length >= 12) score += 10;
    if (password.length >= 16) score += 10;
    if (password.length < 8) suggestions.push('Use at least 8 characters');
    
    // Complexity checks
    if (/[a-z]/.test(password)) score += 10;
    else suggestions.push('Include lowercase letters');
    
    if (/[A-Z]/.test(password)) score += 10;
    else suggestions.push('Include uppercase letters');
    
    if (/[0-9]/.test(password)) score += 10;
    else suggestions.push('Include numbers');
    
    if (/[^a-zA-Z0-9]/.test(password)) score += 20;
    else suggestions.push('Include special characters');
    
    // Pattern checks
    if (!/(.)\1{2,}/.test(password)) score += 10; // No repeated characters
    else suggestions.push('Avoid repeated characters');
    
    if (!/^[0-9]+$/.test(password) && !/^[a-zA-Z]+$/.test(password)) score += 10;
    else suggestions.push('Mix different character types');
    
    return {
      isValid: score >= 60,
      score: Math.min(100, score),
      suggestions
    };
  }
  
  /**
   * Create common validation schemas
   */
  public createCommonSchemas() {
    return {
      login: Joi.object({
        username: Joi.string().required().min(3).max(50),
        password: Joi.string().required().min(8)
      }),
      
      register: Joi.object({
        username: Joi.string().required().min(3).max(50).alphanum(),
        email: Joi.string().required().email(),
        password: Joi.string().required().min(8).pattern(this.PATTERNS.strongPassword),
        confirmPassword: Joi.string().required().valid(Joi.ref('password')),
        phoneNumber: Joi.string().optional().pattern(this.PATTERNS.phone)
      }),
      
      updateProfile: Joi.object({
        name: Joi.string().optional().min(1).max(100),
        email: Joi.string().optional().email(),
        phoneNumber: Joi.string().optional().pattern(this.PATTERNS.phone),
        bio: Joi.string().optional().max(500)
      }),
      
      pagination: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20),
        sort: Joi.string().optional(),
        order: Joi.string().valid('asc', 'desc').default('asc')
      }),
      
      id: Joi.object({
        id: Joi.string().required().pattern(this.PATTERNS.uuid)
      })
    };
  }
}