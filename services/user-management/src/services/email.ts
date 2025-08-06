import nodemailer from 'nodemailer';
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { RedisService } from './redis';
import {
  User,
  EmailTemplate,
  PasswordResetRequest,
  EmailVerificationRequest
} from '@/types';

/**
 * Email Service for sending transactional emails
 */
export class EmailService {
  private transporter: nodemailer.Transporter;
  private redis: RedisService;
  private templates: Map<string, EmailTemplate>;

  constructor() {
    this.redis = new RedisService();
    this.templates = new Map();
    
    // Initialize transporter
    this.transporter = nodemailer.createTransporter({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.auth,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 14 // emails per second
    });

    // Initialize email templates
    this.initializeTemplates();

    // Verify transporter configuration
    this.verifyConnection();
  }

  // ==========================================
  // Authentication Related Emails
  // ==========================================

  /**
   * Send welcome email to new user
   */
  async sendWelcome(user: User): Promise<void> {
    try {
      if (!user.email) {
        logger.warn('Cannot send welcome email: user has no email', { userId: user.id });
        return;
      }

      const template = this.getTemplate('welcome');
      const subject = `Welcome to AI Answer Ninja, ${user.name}!`;
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        phoneNumber: user.phoneNumber,
        supportEmail: 'support@ai-answer-ninja.com',
        appUrl: process.env.APP_URL || 'https://ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Welcome email sent', { userId: user.id, email: user.email });
    } catch (error) {
      logger.error('Failed to send welcome email', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(user: User, resetToken: string): Promise<void> {
    try {
      if (!user.email) {
        throw new Error('User has no email address');
      }

      // Check rate limiting
      const rateLimitKey = `email_rate_limit:password_reset:${user.id}`;
      const { allowed } = await this.redis.checkRateLimit(rateLimitKey, 3, 3600); // 3 per hour
      if (!allowed) {
        throw new Error('Password reset email rate limit exceeded');
      }

      const template = this.getTemplate('password_reset');
      const subject = 'Reset Your AI Answer Ninja Password';
      const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        resetUrl,
        expiryHours: '1',
        supportEmail: 'support@ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Password reset email sent', { userId: user.id, email: user.email });
    } catch (error) {
      logger.error('Failed to send password reset email', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChanged(user: User): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('password_changed');
      const subject = 'Your AI Answer Ninja Password Has Been Changed';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        changeTime: new Date().toLocaleString(),
        supportEmail: 'support@ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Password changed email sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send password changed email', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(user: User, verificationToken: string): Promise<void> {
    try {
      if (!user.email) {
        throw new Error('User has no email address');
      }

      const template = this.getTemplate('email_verification');
      const subject = 'Verify Your Email Address';
      const verificationUrl = `${process.env.APP_URL}/verify-email?token=${verificationToken}`;
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        verificationUrl,
        expiryHours: '24'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Email verification sent', { userId: user.id, email: user.email });
    } catch (error) {
      logger.error('Failed to send email verification', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ==========================================
  // Security Related Emails
  // ==========================================

  /**
   * Send MFA enabled notification
   */
  async sendMFAEnabled(user: User): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('mfa_enabled');
      const subject = 'Multi-Factor Authentication Enabled';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        enableTime: new Date().toLocaleString(),
        supportEmail: 'support@ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('MFA enabled email sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send MFA enabled email', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send MFA disabled notification
   */
  async sendMFADisabled(user: User): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('mfa_disabled');
      const subject = 'Multi-Factor Authentication Disabled';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        disableTime: new Date().toLocaleString(),
        supportEmail: 'support@ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('MFA disabled email sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send MFA disabled email', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send MFA token via email
   */
  async sendMFAToken(user: User, token: string): Promise<void> {
    try {
      if (!user.email) {
        throw new Error('User has no email address');
      }

      // Check rate limiting
      const rateLimitKey = `email_rate_limit:mfa_token:${user.id}`;
      const { allowed } = await this.redis.checkRateLimit(rateLimitKey, 5, 900); // 5 per 15 minutes
      if (!allowed) {
        throw new Error('MFA token email rate limit exceeded');
      }

      const template = this.getTemplate('mfa_token');
      const subject = 'Your AI Answer Ninja Security Code';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        token,
        expiryMinutes: '5'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('MFA token email sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send MFA token email', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send low backup codes warning
   */
  async sendLowBackupCodesWarning(user: User, remainingCodes: number): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('low_backup_codes');
      const subject = 'Low Backup Codes Warning';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        remainingCodes: remainingCodes.toString(),
        manageUrl: `${process.env.APP_URL}/security/mfa`
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Low backup codes warning sent', { userId: user.id, remainingCodes });
    } catch (error) {
      logger.error('Failed to send low backup codes warning', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send login notification
   */
  async sendLoginNotification(
    user: User,
    ipAddress: string,
    userAgent: string,
    location?: string
  ): Promise<void> {
    try {
      if (!user.email) return;

      // Check if user wants login notifications
      const preferences = user.preferences as any;
      if (!preferences?.security?.loginNotifications) return;

      const template = this.getTemplate('login_notification');
      const subject = 'New Login to Your Account';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        loginTime: new Date().toLocaleString(),
        ipAddress,
        browser: this.extractBrowser(userAgent),
        location: location || 'Unknown',
        securityUrl: `${process.env.APP_URL}/security`
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Login notification sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send login notification', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send suspicious activity alert
   */
  async sendSuspiciousActivityAlert(
    user: User,
    activityType: string,
    details: Record<string, any>
  ): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('suspicious_activity');
      const subject = 'Suspicious Activity Detected';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        activityType,
        detectionTime: new Date().toLocaleString(),
        details: JSON.stringify(details, null, 2),
        securityUrl: `${process.env.APP_URL}/security`
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html,
        priority: 'high'
      });

      logger.info('Suspicious activity alert sent', { userId: user.id, activityType });
    } catch (error) {
      logger.error('Failed to send suspicious activity alert', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Administrative Emails
  // ==========================================

  /**
   * Send account locked notification
   */
  async sendAccountLocked(user: User, reason: string): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('account_locked');
      const subject = 'Your Account Has Been Locked';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        reason,
        lockTime: new Date().toLocaleString(),
        supportEmail: 'support@ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html,
        priority: 'high'
      });

      logger.info('Account locked notification sent', { userId: user.id, reason });
    } catch (error) {
      logger.error('Failed to send account locked notification', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send data export ready notification
   */
  async sendDataExportReady(user: User, downloadUrl: string, expiresAt: Date): Promise<void> {
    try {
      if (!user.email) return;

      const template = this.getTemplate('data_export_ready');
      const subject = 'Your Data Export is Ready';
      
      const html = this.renderTemplate(template.template, {
        userName: user.name,
        downloadUrl,
        expiresAt: expiresAt.toLocaleString(),
        supportEmail: 'support@ai-answer-ninja.com'
      });

      await this.sendEmail({
        to: user.email,
        subject,
        html
      });

      logger.info('Data export ready notification sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send data export ready notification', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Core Email Methods
  // ==========================================

  /**
   * Send email
   */
  private async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    priority?: 'low' | 'normal' | 'high';
  }): Promise<void> {
    try {
      const mailOptions = {
        from: `AI Answer Ninja <${config.email.from}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        priority: options.priority || 'normal'
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      logger.debug('Email sent successfully', {
        to: options.to,
        subject: options.subject,
        messageId: result.messageId
      });
    } catch (error) {
      logger.error('Email sending failed', {
        to: options.to,
        subject: options.subject,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Verify email service connection
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
    } catch (error) {
      logger.error('Email service connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ==========================================
  // Template Management
  // ==========================================

  /**
   * Initialize email templates
   */
  private initializeTemplates(): void {
    // Welcome email template
    this.templates.set('welcome', {
      to: '',
      subject: '',
      template: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #2563eb;">Welcome to AI Answer Ninja!</h1>
          <p>Hello {{userName}},</p>
          <p>Welcome to AI Answer Ninja! Your intelligent phone answering assistant is now ready to help you manage unwanted calls.</p>
          <p><strong>Your Account Details:</strong></p>
          <ul>
            <li>Phone Number: {{phoneNumber}}</li>
            <li>Registration Date: {{registrationDate}}</li>
          </ul>
          <p>Visit your dashboard to customize your AI assistant and manage your call preferences:</p>
          <p><a href="{{appUrl}}/dashboard" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Dashboard</a></p>
          <p>If you have any questions, feel free to contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>
          <p>Best regards,<br>The AI Answer Ninja Team</p>
        </div>
      `,
      variables: {}
    });

    // Password reset template
    this.templates.set('password_reset', {
      to: '',
      subject: '',
      template: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #dc2626;">Password Reset Request</h1>
          <p>Hello {{userName}},</p>
          <p>We received a request to reset your password for your AI Answer Ninja account.</p>
          <p>Click the button below to reset your password:</p>
          <p><a href="{{resetUrl}}" style="background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
          <p>This link will expire in {{expiryHours}} hour(s). If you didn't request this reset, please ignore this email.</p>
          <p>For security reasons, please don't share this link with anyone.</p>
          <p>If you need help, contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>
          <p>Best regards,<br>The AI Answer Ninja Team</p>
        </div>
      `,
      variables: {}
    });

    // MFA token template
    this.templates.set('mfa_token', {
      to: '',
      subject: '',
      template: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #2563eb;">Your Security Code</h1>
          <p>Hello {{userName}},</p>
          <p>Your security code for AI Answer Ninja is:</p>
          <div style="background-color: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h2 style="color: #1f2937; font-size: 32px; letter-spacing: 4px; margin: 0;">{{token}}</h2>
          </div>
          <p>This code will expire in {{expiryMinutes}} minutes. Do not share this code with anyone.</p>
          <p>If you didn't request this code, please ignore this email and ensure your account is secure.</p>
          <p>Best regards,<br>The AI Answer Ninja Team</p>
        </div>
      `,
      variables: {}
    });

    // Add more templates...
    this.addSecurityTemplates();
    this.addNotificationTemplates();
  }

  /**
   * Add security-related templates
   */
  private addSecurityTemplates(): void {
    this.templates.set('mfa_enabled', {
      to: '',
      subject: '',
      template: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #059669;">Multi-Factor Authentication Enabled</h1>
          <p>Hello {{userName}},</p>
          <p>Multi-factor authentication has been successfully enabled on your AI Answer Ninja account.</p>
          <p><strong>Enabled at:</strong> {{enableTime}}</p>
          <p>Your account is now more secure. You'll need to provide a verification code when logging in from new devices.</p>
          <p>If you didn't enable this feature, please contact us immediately at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>
          <p>Best regards,<br>The AI Answer Ninja Team</p>
        </div>
      `,
      variables: {}
    });

    this.templates.set('suspicious_activity', {
      to: '',
      subject: '',
      template: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #dc2626;">Suspicious Activity Detected</h1>
          <p>Hello {{userName}},</p>
          <p>We detected suspicious activity on your AI Answer Ninja account:</p>
          <div style="background-color: #fef2f2; padding: 15px; border-left: 4px solid #dc2626; margin: 20px 0;">
            <p><strong>Activity Type:</strong> {{activityType}}</p>
            <p><strong>Detection Time:</strong> {{detectionTime}}</p>
          </div>
          <p>If this was you, no action is needed. If you don't recognize this activity, please:</p>
          <ol>
            <li>Change your password immediately</li>
            <li>Review your security settings</li>
            <li>Enable multi-factor authentication if not already enabled</li>
          </ol>
          <p><a href="{{securityUrl}}" style="background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Security Settings</a></p>
          <p>Best regards,<br>The AI Answer Ninja Team</p>
        </div>
      `,
      variables: {}
    });
  }

  /**
   * Add notification templates
   */
  private addNotificationTemplates(): void {
    this.templates.set('login_notification', {
      to: '',
      subject: '',
      template: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #2563eb;">New Login to Your Account</h1>
          <p>Hello {{userName}},</p>
          <p>We detected a new login to your AI Answer Ninja account:</p>
          <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Time:</strong> {{loginTime}}</p>
            <p><strong>IP Address:</strong> {{ipAddress}}</p>
            <p><strong>Browser:</strong> {{browser}}</p>
            <p><strong>Location:</strong> {{location}}</p>
          </div>
          <p>If this was you, no action is needed. If you don't recognize this login, please secure your account immediately.</p>
          <p><a href="{{securityUrl}}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Security Settings</a></p>
          <p>Best regards,<br>The AI Answer Ninja Team</p>
        </div>
      `,
      variables: {}
    });
  }

  /**
   * Get email template
   */
  private getTemplate(templateName: string): EmailTemplate {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Email template '${templateName}' not found`);
    }
    return template;
  }

  /**
   * Render template with variables
   */
  private renderTemplate(template: string, variables: Record<string, string>): string {
    let rendered = template;
    
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replace(new RegExp(placeholder, 'g'), value);
    });

    return rendered;
  }

  /**
   * Extract browser from user agent
   */
  private extractBrowser(userAgent: string): string {
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown Browser';
  }

  /**
   * Close email service
   */
  async close(): Promise<void> {
    try {
      this.transporter.close();
      logger.info('Email service closed');
    } catch (error) {
      logger.error('Error closing email service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();