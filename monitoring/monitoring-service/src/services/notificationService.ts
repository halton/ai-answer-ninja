import nodemailer, { Transporter } from 'nodemailer';
import axios from 'axios';
import { Twilio } from 'twilio';
import { Alert, NotificationChannel } from '../types';
import logger from '../utils/logger';
import config from '../config';

export class NotificationService {
  private emailTransporter: Transporter | null = null;
  private twilioClient: Twilio | null = null;
  private rateLimitCounters = new Map<string, { count: number; resetTime: number }>();

  constructor() {
    this.initializeEmailService();
    this.initializeSMSService();
    this.startRateLimitCleanup();
  }

  private initializeEmailService(): void {
    if (config.notifications.email.enabled) {
      this.emailTransporter = nodemailer.createTransporter({
        host: config.notifications.email.smtp.host,
        port: config.notifications.email.smtp.port,
        secure: config.notifications.email.smtp.secure,
        auth: config.notifications.email.smtp.auth
      });

      logger.info('Email notification service initialized');
    }
  }

  private initializeSMSService(): void {
    if (config.notifications.sms.enabled && config.notifications.sms.twilio.accountSid) {
      this.twilioClient = new Twilio(
        config.notifications.sms.twilio.accountSid,
        config.notifications.sms.twilio.authToken
      );

      logger.info('SMS notification service initialized');
    }
  }

  public async sendAlert(
    alert: Alert,
    channel: NotificationChannel,
    escalationLevel = 0
  ): Promise<void> {
    try {
      // Check rate limiting
      if (this.isRateLimited(channel)) {
        logger.warn('Notification rate limited', {
          channelId: channel.id,
          channelType: channel.type,
          alertId: alert.id
        });
        return;
      }

      // Record rate limit attempt
      this.recordRateLimitAttempt(channel);

      switch (channel.type) {
        case 'email':
          await this.sendEmailAlert(alert, channel, escalationLevel);
          break;
        case 'slack':
          await this.sendSlackAlert(alert, channel, escalationLevel);
          break;
        case 'webhook':
          await this.sendWebhookAlert(alert, channel, escalationLevel);
          break;
        case 'pagerduty':
          await this.sendPagerDutyAlert(alert, channel, escalationLevel);
          break;
        case 'sms':
          await this.sendSMSAlert(alert, channel, escalationLevel);
          break;
        default:
          logger.warn('Unknown notification channel type', {
            channelType: channel.type,
            alertId: alert.id
          });
      }

      logger.info('Alert notification sent', {
        alertId: alert.id,
        channelType: channel.type,
        escalationLevel
      });

    } catch (error) {
      logger.error('Failed to send alert notification', {
        error,
        alertId: alert.id,
        channelType: channel.type,
        escalationLevel
      });
      throw error;
    }
  }

  public async sendResolutionNotification(
    alert: Alert,
    channel: NotificationChannel
  ): Promise<void> {
    try {
      switch (channel.type) {
        case 'email':
          await this.sendEmailResolution(alert, channel);
          break;
        case 'slack':
          await this.sendSlackResolution(alert, channel);
          break;
        case 'webhook':
          await this.sendWebhookResolution(alert, channel);
          break;
        case 'pagerduty':
          await this.sendPagerDutyResolution(alert, channel);
          break;
        case 'sms':
          await this.sendSMSResolution(alert, channel);
          break;
      }

      logger.info('Resolution notification sent', {
        alertId: alert.id,
        channelType: channel.type
      });

    } catch (error) {
      logger.error('Failed to send resolution notification', {
        error,
        alertId: alert.id,
        channelType: channel.type
      });
    }
  }

  private async sendEmailAlert(
    alert: Alert,
    channel: NotificationChannel,
    escalationLevel: number
  ): Promise<void> {
    if (!this.emailTransporter) {
      throw new Error('Email transporter not initialized');
    }

    const template = this.getEmailTemplate(alert, escalationLevel);
    const subject = this.getEmailSubject(alert, escalationLevel);

    const mailOptions = {
      from: config.notifications.email.from,
      to: channel.config.email || channel.config.to,
      subject,
      html: template,
      attachments: await this.generateEmailAttachments(alert)
    };

    await this.emailTransporter.sendMail(mailOptions);
  }

  private async sendEmailResolution(alert: Alert, channel: NotificationChannel): Promise<void> {
    if (!this.emailTransporter) return;

    const template = this.getResolutionEmailTemplate(alert);
    const subject = `[RESOLVED] ${alert.name}`;

    const mailOptions = {
      from: config.notifications.email.from,
      to: channel.config.email || channel.config.to,
      subject,
      html: template
    };

    await this.emailTransporter.sendMail(mailOptions);
  }

  private async sendSlackAlert(
    alert: Alert,
    channel: NotificationChannel,
    escalationLevel: number
  ): Promise<void> {
    const webhookUrl = channel.config.webhookUrl || config.notifications.slack.webhookUrl;
    const slackChannel = channel.config.channel || config.notifications.slack.channel;

    const message = this.formatSlackMessage(alert, escalationLevel);

    await axios.post(webhookUrl, {
      channel: slackChannel,
      username: config.notifications.slack.username,
      icon_emoji: config.notifications.slack.iconEmoji,
      attachments: [message]
    });
  }

  private async sendSlackResolution(alert: Alert, channel: NotificationChannel): Promise<void> {
    const webhookUrl = channel.config.webhookUrl || config.notifications.slack.webhookUrl;
    const slackChannel = channel.config.channel || config.notifications.slack.channel;

    const message = {
      color: 'good',
      title: `✅ RESOLVED: ${alert.name}`,
      text: alert.description,
      fields: [
        {
          title: 'Service',
          value: alert.labels.service || alert.labels.job || 'Unknown',
          short: true
        },
        {
          title: 'Duration',
          value: this.calculateAlertDuration(alert),
          short: true
        },
        {
          title: 'Resolved At',
          value: new Date().toISOString(),
          short: true
        }
      ]
    };

    await axios.post(webhookUrl, {
      channel: slackChannel,
      username: config.notifications.slack.username,
      icon_emoji: ':white_check_mark:',
      attachments: [message]
    });
  }

  private async sendWebhookAlert(
    alert: Alert,
    channel: NotificationChannel,
    escalationLevel: number
  ): Promise<void> {
    const webhookUrl = channel.config.url;
    if (!webhookUrl) {
      throw new Error('Webhook URL not configured');
    }

    const payload = {
      alert,
      escalationLevel,
      timestamp: new Date().toISOString(),
      event: 'alert.firing'
    };

    const headers = channel.config.headers || {};
    const timeout = channel.config.timeout || 10000;

    await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      timeout
    });
  }

  private async sendWebhookResolution(alert: Alert, channel: NotificationChannel): Promise<void> {
    const webhookUrl = channel.config.url;
    if (!webhookUrl) return;

    const payload = {
      alert,
      timestamp: new Date().toISOString(),
      event: 'alert.resolved'
    };

    const headers = channel.config.headers || {};
    const timeout = channel.config.timeout || 10000;

    await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      timeout
    });
  }

  private async sendPagerDutyAlert(
    alert: Alert,
    channel: NotificationChannel,
    escalationLevel: number
  ): Promise<void> {
    const serviceKey = channel.config.serviceKey || config.notifications.pagerduty.serviceKey;
    const apiUrl = config.notifications.pagerduty.apiUrl;

    const payload = {
      routing_key: serviceKey,
      event_action: 'trigger',
      dedup_key: alert.fingerprint,
      payload: {
        summary: alert.description,
        source: alert.labels.service || 'AI Ninja Monitor',
        severity: this.mapSeverityToPagerDuty(alert.severity),
        timestamp: alert.startsAt.toISOString(),
        custom_details: {
          alert_name: alert.name,
          labels: alert.labels,
          annotations: alert.annotations,
          escalation_level: escalationLevel
        }
      }
    };

    await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  private async sendPagerDutyResolution(alert: Alert, channel: NotificationChannel): Promise<void> {
    const serviceKey = channel.config.serviceKey || config.notifications.pagerduty.serviceKey;
    const apiUrl = config.notifications.pagerduty.apiUrl;

    const payload = {
      routing_key: serviceKey,
      event_action: 'resolve',
      dedup_key: alert.fingerprint
    };

    await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  private async sendSMSAlert(
    alert: Alert,
    channel: NotificationChannel,
    escalationLevel: number
  ): Promise<void> {
    if (!this.twilioClient) {
      throw new Error('SMS service not initialized');
    }

    const phoneNumber = channel.config.phoneNumber;
    if (!phoneNumber) {
      throw new Error('Phone number not configured for SMS channel');
    }

    const message = this.formatSMSMessage(alert, escalationLevel);

    await this.twilioClient.messages.create({
      body: message,
      from: config.notifications.sms.twilio.fromNumber,
      to: phoneNumber
    });
  }

  private async sendSMSResolution(alert: Alert, channel: NotificationChannel): Promise<void> {
    if (!this.twilioClient || !channel.config.phoneNumber) return;

    const message = `✅ RESOLVED: ${alert.name}\nDuration: ${this.calculateAlertDuration(alert)}\nService: ${alert.labels.service || 'Unknown'}`;

    await this.twilioClient.messages.create({
      body: message,
      from: config.notifications.sms.twilio.fromNumber,
      to: channel.config.phoneNumber
    });
  }

  // Template and formatting methods
  private getEmailTemplate(alert: Alert, escalationLevel: number): string {
    const severityColor = this.getSeverityColor(alert.severity);
    const escalationBadge = escalationLevel > 0 ? `<span style="background-color: orange; color: white; padding: 2px 8px; border-radius: 3px;">ESCALATED L${escalationLevel}</span>` : '';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Alert: ${alert.name}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background-color: ${severityColor}; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .details { background-color: #f4f4f4; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .label { font-weight: bold; }
        .footer { background-color: #f0f0f0; padding: 10px; text-align: center; font-size: 12px; }
        .escalation { margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚨 ${alert.name}</h1>
        <p>${alert.severity.toUpperCase()} Alert</p>
        ${escalationBadge ? `<div class="escalation">${escalationBadge}</div>` : ''}
    </div>
    
    <div class="content">
        <h2>Alert Details</h2>
        <div class="details">
            <p><span class="label">Description:</span> ${alert.description}</p>
            <p><span class="label">Service:</span> ${alert.labels.service || alert.labels.job || 'Unknown'}</p>
            <p><span class="label">Instance:</span> ${alert.labels.instance || 'Unknown'}</p>
            <p><span class="label">Started At:</span> ${alert.startsAt.toISOString()}</p>
            <p><span class="label">Duration:</span> ${this.calculateAlertDuration(alert)}</p>
        </div>

        ${Object.keys(alert.labels).length > 0 ? `
        <h3>Labels</h3>
        <div class="details">
            ${Object.entries(alert.labels).map(([key, value]) => 
              `<p><span class="label">${key}:</span> ${value}</p>`
            ).join('')}
        </div>
        ` : ''}

        ${Object.keys(alert.annotations).length > 0 ? `
        <h3>Annotations</h3>
        <div class="details">
            ${Object.entries(alert.annotations).map(([key, value]) => 
              `<p><span class="label">${key}:</span> ${value}</p>`
            ).join('')}
        </div>
        ` : ''}

        ${alert.generatorURL ? `
        <p><a href="${alert.generatorURL}">View in Prometheus</a></p>
        ` : ''}
    </div>

    <div class="footer">
        <p>AI Answer Ninja Monitoring System</p>
        <p>Generated at: ${new Date().toISOString()}</p>
    </div>
</body>
</html>
    `;
  }

  private getResolutionEmailTemplate(alert: Alert): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Resolved: ${alert.name}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background-color: #28a745; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .details { background-color: #f4f4f4; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .label { font-weight: bold; }
        .footer { background-color: #f0f0f0; padding: 10px; text-align: center; font-size: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>✅ Alert Resolved</h1>
        <h2>${alert.name}</h2>
    </div>
    
    <div class="content">
        <div class="details">
            <p><span class="label">Description:</span> ${alert.description}</p>
            <p><span class="label">Service:</span> ${alert.labels.service || alert.labels.job || 'Unknown'}</p>
            <p><span class="label">Started At:</span> ${alert.startsAt.toISOString()}</p>
            <p><span class="label">Resolved At:</span> ${alert.endsAt?.toISOString() || new Date().toISOString()}</p>
            <p><span class="label">Total Duration:</span> ${this.calculateAlertDuration(alert)}</p>
        </div>
    </div>

    <div class="footer">
        <p>AI Answer Ninja Monitoring System</p>
        <p>Generated at: ${new Date().toISOString()}</p>
    </div>
</body>
</html>
    `;
  }

  private getEmailSubject(alert: Alert, escalationLevel: number): string {
    const prefix = escalationLevel > 0 ? `[ESCALATED L${escalationLevel}] ` : '';
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    
    return `${prefix}${severityEmoji} ${alert.severity.toUpperCase()}: ${alert.name} - ${alert.labels.service || 'AI Ninja'}`;
  }

  private formatSlackMessage(alert: Alert, escalationLevel: number): any {
    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);
    const escalationText = escalationLevel > 0 ? ` (ESCALATED L${escalationLevel})` : '';

    return {
      color,
      title: `${emoji} ${alert.name}${escalationText}`,
      title_link: alert.generatorURL,
      text: alert.description,
      fields: [
        {
          title: 'Severity',
          value: alert.severity.toUpperCase(),
          short: true
        },
        {
          title: 'Service',
          value: alert.labels.service || alert.labels.job || 'Unknown',
          short: true
        },
        {
          title: 'Instance',
          value: alert.labels.instance || 'Unknown',
          short: true
        },
        {
          title: 'Duration',
          value: this.calculateAlertDuration(alert),
          short: true
        }
      ],
      footer: 'AI Ninja Monitor',
      footer_icon: 'https://example.com/icon.png',
      ts: Math.floor(alert.startsAt.getTime() / 1000)
    };
  }

  private formatSMSMessage(alert: Alert, escalationLevel: number): string {
    const emoji = this.getSeverityEmoji(alert.severity);
    const escalationText = escalationLevel > 0 ? ` [L${escalationLevel}]` : '';
    
    return `${emoji} ${alert.severity.toUpperCase()}${escalationText}: ${alert.name}\n` +
           `Service: ${alert.labels.service || 'Unknown'}\n` +
           `${alert.description}\n` +
           `Duration: ${this.calculateAlertDuration(alert)}`;
  }

  // Utility methods
  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return '#dc3545';
      case 'warning': return '#ffc107';
      case 'info': return '#17a2b8';
      default: return '#6c757d';
    }
  }

  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'critical': return '🚨';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '📊';
    }
  }

  private mapSeverityToPagerDuty(severity: string): string {
    switch (severity) {
      case 'critical': return 'critical';
      case 'warning': return 'warning';
      case 'info': return 'info';
      default: return 'error';
    }
  }

  private calculateAlertDuration(alert: Alert): string {
    const endTime = alert.endsAt || new Date();
    const duration = endTime.getTime() - alert.startsAt.getTime();
    
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private async generateEmailAttachments(alert: Alert): Promise<any[]> {
    // Generate graph images or CSV data if needed
    // This is a placeholder for future implementation
    return [];
  }

  // Rate limiting
  private isRateLimited(channel: NotificationChannel): boolean {
    if (!config.notifications.rateLimiting.enabled) return false;

    const key = `${channel.type}:${channel.id}`;
    const counter = this.rateLimitCounters.get(key);
    const now = Date.now();
    const windowSize = 60 * 60 * 1000; // 1 hour

    if (!counter || now > counter.resetTime) {
      return false;
    }

    return counter.count >= config.notifications.rateLimiting.maxPerHour;
  }

  private recordRateLimitAttempt(channel: NotificationChannel): void {
    if (!config.notifications.rateLimiting.enabled) return;

    const key = `${channel.type}:${channel.id}`;
    const now = Date.now();
    const windowSize = 60 * 60 * 1000; // 1 hour
    const counter = this.rateLimitCounters.get(key);

    if (!counter || now > counter.resetTime) {
      this.rateLimitCounters.set(key, {
        count: 1,
        resetTime: now + windowSize
      });
    } else {
      counter.count++;
    }
  }

  private startRateLimitCleanup(): void {
    // Clean up expired rate limit counters every 10 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, counter] of this.rateLimitCounters) {
        if (now > counter.resetTime) {
          this.rateLimitCounters.delete(key);
        }
      }
    }, 10 * 60 * 1000);
  }
}