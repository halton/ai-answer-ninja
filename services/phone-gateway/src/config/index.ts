import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const configSchema = Joi.object({
  server: Joi.object({
    port: Joi.number().default(3001),
    host: Joi.string().default('0.0.0.0'),
    environment: Joi.string().valid('development', 'staging', 'production').default('development'),
    maxConnections: Joi.number().default(1000),
    requestTimeout: Joi.number().default(30000),
  }),
  
  azure: Joi.object({
    communicationServices: Joi.object({
      connectionString: Joi.string().required(),
      endpoint: Joi.string().required(),
      resourceId: Joi.string().required(),
    }),
    eventGrid: Joi.object({
      endpoint: Joi.string().required(),
      accessKey: Joi.string().required(),
    }),
  }),
  
  database: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().default(5432),
    name: Joi.string().default('ai_ninja'),
    username: Joi.string().required(),
    password: Joi.string().required(),
    ssl: Joi.boolean().default(false),
    maxConnections: Joi.number().default(20),
  }),
  
  redis: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().default(6379),
    password: Joi.string().optional(),
    db: Joi.number().default(0),
  }),
  
  services: Joi.object({
    realtimeProcessor: Joi.object({
      url: Joi.string().default('http://localhost:3002'),
      timeout: Joi.number().default(5000),
    }),
    smartWhitelist: Joi.object({
      url: Joi.string().default('http://localhost:3006'),
      timeout: Joi.number().default(3000),
    }),
    userManagement: Joi.object({
      url: Joi.string().default('http://localhost:3005'),
      timeout: Joi.number().default(3000),
    }),
    profileAnalytics: Joi.object({
      url: Joi.string().default('http://localhost:3004'),
      timeout: Joi.number().default(3000),
    }),
  }),
  
  security: Joi.object({
    jwtSecret: Joi.string().required(),
    corsOrigins: Joi.array().items(Joi.string()).default(['http://localhost:3000']),
    rateLimiting: Joi.object({
      windowMs: Joi.number().default(15 * 60 * 1000), // 15 minutes
      max: Joi.number().default(100), // limit each IP to 100 requests per windowMs
    }),
  }),
  
  monitoring: Joi.object({
    metricsEnabled: Joi.boolean().default(true),
    healthCheckInterval: Joi.number().default(30000),
    logLevel: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  }),
  
  performance: Joi.object({
    compressionEnabled: Joi.boolean().default(true),
    cacheEnabled: Joi.boolean().default(true),
    cacheTtl: Joi.number().default(300), // 5 minutes
  }),
});

const rawConfig = {
  server: {
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '1000'),
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000'),
  },
  
  azure: {
    communicationServices: {
      connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '',
      endpoint: process.env.AZURE_COMMUNICATION_ENDPOINT || '',
      resourceId: process.env.AZURE_COMMUNICATION_RESOURCE_ID || '',
    },
    eventGrid: {
      endpoint: process.env.AZURE_EVENT_GRID_ENDPOINT || '',
      accessKey: process.env.AZURE_EVENT_GRID_ACCESS_KEY || '',
    },
  },
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'ai_ninja',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  
  services: {
    realtimeProcessor: {
      url: process.env.REALTIME_PROCESSOR_URL || 'http://localhost:3002',
      timeout: parseInt(process.env.REALTIME_PROCESSOR_TIMEOUT || '5000'),
    },
    smartWhitelist: {
      url: process.env.SMART_WHITELIST_URL || 'http://localhost:3006',
      timeout: parseInt(process.env.SMART_WHITELIST_TIMEOUT || '3000'),
    },
    userManagement: {
      url: process.env.USER_MANAGEMENT_URL || 'http://localhost:3005',
      timeout: parseInt(process.env.USER_MANAGEMENT_TIMEOUT || '3000'),
    },
    profileAnalytics: {
      url: process.env.PROFILE_ANALYTICS_URL || 'http://localhost:3004',
      timeout: parseInt(process.env.PROFILE_ANALYTICS_TIMEOUT || '3000'),
    },
  },
  
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    rateLimiting: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
      max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    },
  },
  
  monitoring: {
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  
  performance: {
    compressionEnabled: process.env.COMPRESSION_ENABLED !== 'false',
    cacheEnabled: process.env.CACHE_ENABLED !== 'false',
    cacheTtl: parseInt(process.env.CACHE_TTL || '300'),
  },
};

const { error, value: config } = configSchema.validate(rawConfig);

if (error) {
  throw new Error(`Configuration validation error: ${error.details[0].message}`);
}

export default config as {
  server: {
    port: number;
    host: string;
    environment: string;
    maxConnections: number;
    requestTimeout: number;
  };
  azure: {
    communicationServices: {
      connectionString: string;
      endpoint: string;
      resourceId: string;
    };
    eventGrid: {
      endpoint: string;
      accessKey: string;
    };
  };
  database: {
    host: string;
    port: number;
    name: string;
    username: string;
    password: string;
    ssl: boolean;
    maxConnections: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  services: {
    realtimeProcessor: {
      url: string;
      timeout: number;
    };
    smartWhitelist: {
      url: string;
      timeout: number;
    };
    userManagement: {
      url: string;
      timeout: number;
    };
    profileAnalytics: {
      url: string;
      timeout: number;
    };
  };
  security: {
    jwtSecret: string;
    corsOrigins: string[];
    rateLimiting: {
      windowMs: number;
      max: number;
    };
  };
  monitoring: {
    metricsEnabled: boolean;
    healthCheckInterval: number;
    logLevel: string;
  };
  performance: {
    compressionEnabled: boolean;
    cacheEnabled: boolean;
    cacheTtl: number;
  };
};