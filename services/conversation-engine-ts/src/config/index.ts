import dotenv from 'dotenv';
import { ServiceConfig } from '@/types';

// 加载环境变量
dotenv.config();

const config: ServiceConfig = {
  port: parseInt(process.env.PORT || '3003', 10),
  serviceName: process.env.SERVICE_NAME || 'conversation-engine',
  environment: process.env.NODE_ENV || 'development',
  
  azure: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2023-12-01-preview',
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
    maxTokens: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS || '150', 10),
    temperature: parseFloat(process.env.AZURE_OPENAI_TEMPERATURE || '0.7'),
    topP: parseFloat(process.env.AZURE_OPENAI_TOP_P || '0.9')
  },
  
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_ninja',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '30000', 10),
    ssl: process.env.DB_SSL === 'true'
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '1000', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'conversation:'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false'
  },
  
  performance: {
    maxConversationTurns: parseInt(process.env.MAX_CONVERSATION_TURNS || '10', 10),
    maxResponseLength: parseInt(process.env.MAX_RESPONSE_LENGTH || '200', 10),
    intentConfidenceThreshold: parseFloat(process.env.INTENT_CONFIDENCE_THRESHOLD || '0.7'),
    cacheTtl: parseInt(process.env.CACHE_TTL || '3600', 10),
    responseCacheTtl: parseInt(process.env.RESPONSE_CACHE_TTL || '1800', 10)
  }
};

// 验证必需的配置
function validateConfig() {
  const requiredFields = [
    'azure.endpoint',
    'azure.apiKey',
    'database.url'
  ];
  
  const missing = requiredFields.filter(field => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
    return !value;
  });
  
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}

// 在非测试环境中验证配置
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

export default config;