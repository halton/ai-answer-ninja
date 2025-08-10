import { MonitoringConfig } from '../types';

export const config = {
  // Server configuration
  port: parseInt(process.env.PORT || '3009', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Service discovery
  services: {
    phoneGateway: process.env.PHONE_GATEWAY_URL || 'http://phone-gateway:3001',
    realtimeProcessor: process.env.REALTIME_PROCESSOR_URL || 'http://realtime-processor:3002',
    conversationEngine: process.env.CONVERSATION_ENGINE_URL || 'http://conversation-engine:3003',
    profileAnalytics: process.env.PROFILE_ANALYTICS_URL || 'http://profile-analytics:3004',
    userManagement: process.env.USER_MANAGEMENT_URL || 'http://user-management:3005',
    smartWhitelist: process.env.SMART_WHITELIST_URL || 'http://smart-whitelist:3006',
    configurationService: process.env.CONFIGURATION_SERVICE_URL || 'http://configuration-service:3007',
    storageService: process.env.STORAGE_SERVICE_URL || 'http://storage-service:3008',
  },

  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'ai_ninja_monitoring',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
  },

  // Prometheus configuration
  prometheus: {
    url: process.env.PROMETHEUS_URL || 'http://prometheus:9090',
    pushgateway: process.env.PUSHGATEWAY_URL || 'http://pushgateway:9091',
    scrapeInterval: process.env.PROMETHEUS_SCRAPE_INTERVAL || '15s',
  },

  // Grafana configuration
  grafana: {
    url: process.env.GRAFANA_URL || 'http://grafana:3000',
    apiKey: process.env.GRAFANA_API_KEY || '',
    orgId: parseInt(process.env.GRAFANA_ORG_ID || '1', 10),
  },

  // Jaeger tracing configuration
  jaeger: {
    endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:14268/api/traces',
    serviceName: 'monitoring-service',
    samplingRate: parseFloat(process.env.JAEGER_SAMPLING_RATE || '0.1'),
  },

  // ElasticSearch configuration
  elasticsearch: {
    node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200',
    maxRetries: 3,
    requestTimeout: 60000,
    sniffOnStart: false,
    auth: process.env.ELASTICSEARCH_AUTH ? {
      username: process.env.ELASTICSEARCH_USERNAME || '',
      password: process.env.ELASTICSEARCH_PASSWORD || '',
    } : undefined,
  },

  // Notification channels
  notifications: {
    email: {
      enabled: process.env.EMAIL_ENABLED === 'true',
      smtp: {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      },
      from: process.env.EMAIL_FROM || 'alerts@ai-ninja.com',
      templates: {
        critical: 'critical-alert.html',
        warning: 'warning-alert.html',
        resolved: 'resolved-alert.html',
      },
    },
    slack: {
      enabled: process.env.SLACK_ENABLED === 'true',
      webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
      channel: process.env.SLACK_CHANNEL || '#alerts',
      username: process.env.SLACK_USERNAME || 'AI Ninja Monitor',
      iconEmoji: process.env.SLACK_ICON || ':robot_face:',
    },
    pagerduty: {
      enabled: process.env.PAGERDUTY_ENABLED === 'true',
      serviceKey: process.env.PAGERDUTY_SERVICE_KEY || '',
      apiUrl: process.env.PAGERDUTY_API_URL || 'https://events.pagerduty.com/v2/enqueue',
    },
    sms: {
      enabled: process.env.SMS_ENABLED === 'true',
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_FROM_NUMBER || '',
      },
    },
    webhook: {
      enabled: process.env.WEBHOOK_ENABLED === 'true',
      urls: process.env.WEBHOOK_URLS?.split(',') || [],
      timeout: parseInt(process.env.WEBHOOK_TIMEOUT || '10000', 10),
      retries: parseInt(process.env.WEBHOOK_RETRIES || '3', 10),
    },
  },

  // Azure services monitoring
  azure: {
    enabled: process.env.AZURE_MONITORING_ENABLED === 'true',
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || '',
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
    services: {
      speech: {
        endpoint: process.env.AZURE_SPEECH_ENDPOINT || '',
        key: process.env.AZURE_SPEECH_KEY || '',
      },
      openai: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
        key: process.env.AZURE_OPENAI_KEY || '',
      },
      communication: {
        endpoint: process.env.AZURE_COMMUNICATION_ENDPOINT || '',
        key: process.env.AZURE_COMMUNICATION_KEY || '',
      },
    },
  },

  // Monitoring configuration
  monitoring: {
    metrics: {
      retentionDays: parseInt(process.env.METRICS_RETENTION_DAYS || '30', 10),
      scrapeInterval: process.env.METRICS_SCRAPE_INTERVAL || '15s',
      evaluationInterval: process.env.METRICS_EVALUATION_INTERVAL || '15s',
    },
    alerts: {
      defaultGroupWait: process.env.ALERT_GROUP_WAIT || '10s',
      defaultGroupInterval: process.env.ALERT_GROUP_INTERVAL || '10s',
      defaultRepeatInterval: process.env.ALERT_REPEAT_INTERVAL || '12h',
      resolveTimeout: process.env.ALERT_RESOLVE_TIMEOUT || '5m',
    },
    notifications: {
      defaultChannels: process.env.DEFAULT_NOTIFICATION_CHANNELS?.split(',') || ['slack', 'email'],
      rateLimiting: {
        enabled: process.env.RATE_LIMITING_ENABLED === 'true',
        maxPerHour: parseInt(process.env.MAX_NOTIFICATIONS_PER_HOUR || '60', 10),
      },
    },
    tracing: {
      samplingRate: parseFloat(process.env.TRACING_SAMPLING_RATE || '0.1'),
      maxSpanAge: process.env.MAX_SPAN_AGE || '24h',
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '7', 10),
      maxFileSize: process.env.LOG_MAX_FILE_SIZE || '100MB',
    },
  } as MonitoringConfig,

  // Performance baselines
  baselines: {
    updateInterval: process.env.BASELINE_UPDATE_INTERVAL || '1h',
    learningPeriod: process.env.BASELINE_LEARNING_PERIOD || '7d',
    confidenceThreshold: parseFloat(process.env.BASELINE_CONFIDENCE_THRESHOLD || '0.8'),
    anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || '2.5'), // Standard deviations
  },

  // Auto-remediation
  autoRemediation: {
    enabled: process.env.AUTO_REMEDIATION_ENABLED === 'true',
    cooldownPeriod: process.env.REMEDIATION_COOLDOWN || '10m',
    maxRetries: parseInt(process.env.MAX_REMEDIATION_RETRIES || '3', 10),
    timeoutPerAction: process.env.REMEDIATION_ACTION_TIMEOUT || '5m',
  },

  // Health check configuration
  healthCheck: {
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30', 10), // seconds
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '10', 10), // seconds
    retries: parseInt(process.env.HEALTH_CHECK_RETRIES || '3', 10),
    endpoints: {
      shallow: '/health',
      deep: '/health/deep',
      dependencies: '/health/dependencies',
    },
  },

  // Security
  security: {
    apiKey: process.env.MONITORING_API_KEY || '',
    jwtSecret: process.env.JWT_SECRET || 'monitoring-secret-key-change-in-production',
    encryptionKey: process.env.ENCRYPTION_KEY || '',
    rateLimiting: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },
  },

  // Feature flags
  features: {
    anomalyDetection: process.env.FEATURE_ANOMALY_DETECTION === 'true',
    predictiveAlerting: process.env.FEATURE_PREDICTIVE_ALERTING === 'true',
    autoRemediation: process.env.FEATURE_AUTO_REMEDIATION === 'true',
    businessMetrics: process.env.FEATURE_BUSINESS_METRICS === 'true',
    distributedTracing: process.env.FEATURE_DISTRIBUTED_TRACING === 'true',
    logAggregation: process.env.FEATURE_LOG_AGGREGATION === 'true',
  },
};

export default config;