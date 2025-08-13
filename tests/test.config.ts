/**
 * Comprehensive Test Configuration
 * 
 * Central configuration for all test types across the AI Answer Ninja system.
 * Manages test environments, service endpoints, test data, and execution settings.
 */

import { ServiceEndpoints } from './e2e/src/utils/TestApiClient';
import { E2ETestConfig } from './e2e/src/E2ETestOrchestrator';

export interface TestEnvironment {
  name: string;
  services: ServiceEndpoints;
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  azure: {
    speechServiceKey?: string;
    speechServiceRegion?: string;
    communicationServiceKey?: string;
    openaiServiceKey?: string;
    storageConnectionString?: string;
  };
  monitoring: {
    enabled: boolean;
    tracing: boolean;
    metrics: boolean;
  };
}

export interface TestExecutionConfig {
  // Test Selection
  testTypes: Array<'unit' | 'integration' | 'e2e' | 'performance'>;
  testSuites?: string[];
  testPatterns?: string[];
  
  // Execution Settings
  parallel: boolean;
  maxWorkers?: number;
  timeout: {
    test: number;
    suite: number;
    setup: number;
    teardown: number;
  };
  
  // Retry Configuration
  retries: {
    unit: number;
    integration: number;
    e2e: number;
    performance: number;
  };
  
  // Environment Management
  isolateTests: boolean;
  cleanupBetweenTests: boolean;
  resetDatabase: boolean;
  
  // Reporting
  reporting: {
    console: boolean;
    junit: boolean;
    html: boolean;
    coverage: boolean;
    performance: boolean;
    outputDir: string;
  };
  
  // Performance Testing
  performance: {
    enabled: boolean;
    scenarios: string[];
    thresholds: {
      averageResponseTime: number;
      p95ResponseTime: number;
      errorRate: number;
      throughput: number;
    };
  };
}

/**
 * Test Environment Definitions
 */
export const testEnvironments: { [key: string]: TestEnvironment } = {
  local: {
    name: 'Local Development',
    services: {
      phoneGateway: 'http://localhost:3001',
      realtimeProcessor: 'http://localhost:3002',
      conversationEngine: 'http://localhost:3003', 
      profileAnalytics: 'http://localhost:3004',
      userManagement: 'http://localhost:3005',
      smartWhitelist: 'http://localhost:3006',
      configurationService: 'http://localhost:3007',
      storageService: 'http://localhost:3008',
      monitoringService: 'http://localhost:3009'
    },
    database: {
      host: 'localhost',
      port: 5433,
      database: 'ai_ninja_test',
      username: 'test_user',
      password: 'test_password'
    },
    redis: {
      host: 'localhost',
      port: 6380
    },
    azure: {
      // Use mock services for local testing
    },
    monitoring: {
      enabled: true,
      tracing: true,
      metrics: true
    }
  },
  
  ci: {
    name: 'CI/CD Pipeline',
    services: {
      phoneGateway: 'http://phone-gateway-test:3001',
      realtimeProcessor: 'http://realtime-processor-test:3002',
      conversationEngine: 'http://conversation-engine-test:3003',
      profileAnalytics: 'http://profile-analytics-test:3004',
      userManagement: 'http://user-management-test:3005',
      smartWhitelist: 'http://smart-whitelist-test:3006',
      configurationService: 'http://configuration-service-test:3007',
      storageService: 'http://storage-service-test:3008',
      monitoringService: 'http://monitoring-service-test:3009'
    },
    database: {
      host: 'postgres-test',
      port: 5432,
      database: 'ai_ninja_test',
      username: 'test_user',
      password: 'test_password'
    },
    redis: {
      host: 'redis-test',
      port: 6379
    },
    azure: {
      // Mock services for CI
    },
    monitoring: {
      enabled: true,
      tracing: false, // Disable tracing in CI to reduce overhead
      metrics: true
    }
  },
  
  staging: {
    name: 'Staging Environment',
    services: {
      phoneGateway: 'https://phone-gateway-staging.ai-ninja.com',
      realtimeProcessor: 'https://realtime-processor-staging.ai-ninja.com',
      conversationEngine: 'https://conversation-engine-staging.ai-ninja.com',
      profileAnalytics: 'https://profile-analytics-staging.ai-ninja.com',
      userManagement: 'https://user-management-staging.ai-ninja.com',
      smartWhitelist: 'https://smart-whitelist-staging.ai-ninja.com',
      configurationService: 'https://configuration-service-staging.ai-ninja.com',
      storageService: 'https://storage-service-staging.ai-ninja.com',
      monitoringService: 'https://monitoring-service-staging.ai-ninja.com'
    },
    database: {
      host: process.env.STAGING_DB_HOST || 'staging-db.ai-ninja.com',
      port: parseInt(process.env.STAGING_DB_PORT || '5432'),
      database: 'ai_ninja_staging',
      username: process.env.STAGING_DB_USER || 'staging_user',
      password: process.env.STAGING_DB_PASSWORD || ''
    },
    redis: {
      host: process.env.STAGING_REDIS_HOST || 'staging-redis.ai-ninja.com',
      port: parseInt(process.env.STAGING_REDIS_PORT || '6379'),
      password: process.env.STAGING_REDIS_PASSWORD
    },
    azure: {
      speechServiceKey: process.env.AZURE_SPEECH_KEY_STAGING,
      speechServiceRegion: process.env.AZURE_SPEECH_REGION_STAGING,
      communicationServiceKey: process.env.AZURE_COMMUNICATION_KEY_STAGING,
      openaiServiceKey: process.env.AZURE_OPENAI_KEY_STAGING,
      storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STAGING
    },
    monitoring: {
      enabled: true,
      tracing: true,
      metrics: true
    }
  }
};

/**
 * Test Execution Configurations
 */
export const testConfigurations: { [key: string]: TestExecutionConfig } = {
  // Quick smoke tests for development
  smoke: {
    testTypes: ['unit'],
    testPatterns: ['**/*.smoke.test.ts', '**/*.health.test.ts'],
    parallel: true,
    maxWorkers: 4,
    timeout: {
      test: 5000,
      suite: 30000,
      setup: 30000,
      teardown: 10000
    },
    retries: {
      unit: 1,
      integration: 1,
      e2e: 0,
      performance: 0
    },
    isolateTests: false,
    cleanupBetweenTests: false,
    resetDatabase: false,
    reporting: {
      console: true,
      junit: false,
      html: false,
      coverage: false,
      performance: false,
      outputDir: './test-results'
    },
    performance: {
      enabled: false,
      scenarios: [],
      thresholds: {
        averageResponseTime: 1000,
        p95ResponseTime: 2000,
        errorRate: 5,
        throughput: 10
      }
    }
  },
  
  // Full unit test suite
  unit: {
    testTypes: ['unit'],
    parallel: true,
    maxWorkers: 6,
    timeout: {
      test: 10000,
      suite: 60000,
      setup: 60000,
      teardown: 30000
    },
    retries: {
      unit: 2,
      integration: 0,
      e2e: 0,
      performance: 0
    },
    isolateTests: true,
    cleanupBetweenTests: true,
    resetDatabase: false,
    reporting: {
      console: true,
      junit: true,
      html: true,
      coverage: true,
      performance: false,
      outputDir: './test-results/unit'
    },
    performance: {
      enabled: false,
      scenarios: [],
      thresholds: {
        averageResponseTime: 500,
        p95ResponseTime: 1000,
        errorRate: 1,
        throughput: 50
      }
    }
  },
  
  // Integration test configuration
  integration: {
    testTypes: ['integration'],
    parallel: true,
    maxWorkers: 3,
    timeout: {
      test: 30000,
      suite: 300000, // 5 minutes
      setup: 180000, // 3 minutes for container startup
      teardown: 60000
    },
    retries: {
      unit: 0,
      integration: 2,
      e2e: 0,
      performance: 0
    },
    isolateTests: true,
    cleanupBetweenTests: true,
    resetDatabase: true,
    reporting: {
      console: true,
      junit: true,
      html: true,
      coverage: false,
      performance: true,
      outputDir: './test-results/integration'
    },
    performance: {
      enabled: true,
      scenarios: ['service_communication', 'database_operations'],
      thresholds: {
        averageResponseTime: 1000,
        p95ResponseTime: 2500,
        errorRate: 3,
        throughput: 20
      }
    }
  },
  
  // End-to-end test configuration
  e2e: {
    testTypes: ['e2e'],
    parallel: false, // E2E tests run sequentially to avoid conflicts
    maxWorkers: 1,
    timeout: {
      test: 120000, // 2 minutes per test
      suite: 600000, // 10 minutes per suite
      setup: 300000, // 5 minutes setup
      teardown: 120000 // 2 minutes teardown
    },
    retries: {
      unit: 0,
      integration: 0,
      e2e: 2,
      performance: 0
    },
    isolateTests: true,
    cleanupBetweenTests: true,
    resetDatabase: true,
    reporting: {
      console: true,
      junit: true,
      html: true,
      coverage: false,
      performance: true,
      outputDir: './test-results/e2e'
    },
    performance: {
      enabled: true,
      scenarios: ['complete_workflows', 'user_interactions'],
      thresholds: {
        averageResponseTime: 2000,
        p95ResponseTime: 5000,
        errorRate: 5,
        throughput: 5
      }
    }
  },
  
  // Performance and load testing
  performance: {
    testTypes: ['performance'],
    parallel: false,
    maxWorkers: 1,
    timeout: {
      test: 600000, // 10 minutes per test
      suite: 1800000, // 30 minutes per suite
      setup: 300000,
      teardown: 180000
    },
    retries: {
      unit: 0,
      integration: 0,
      e2e: 0,
      performance: 1
    },
    isolateTests: true,
    cleanupBetweenTests: true,
    resetDatabase: true,
    reporting: {
      console: true,
      junit: true,
      html: true,
      coverage: false,
      performance: true,
      outputDir: './test-results/performance'
    },
    performance: {
      enabled: true,
      scenarios: ['load_testing', 'stress_testing', 'endurance_testing'],
      thresholds: {
        averageResponseTime: 1500,
        p95ResponseTime: 3000,
        errorRate: 5,
        throughput: 10
      }
    }
  },
  
  // Complete test suite (all test types)
  complete: {
    testTypes: ['unit', 'integration', 'e2e', 'performance'],
    parallel: true,
    maxWorkers: 4,
    timeout: {
      test: 120000,
      suite: 1800000, // 30 minutes per suite
      setup: 600000, // 10 minutes setup
      teardown: 300000
    },
    retries: {
      unit: 2,
      integration: 2,
      e2e: 2,
      performance: 1
    },
    isolateTests: true,
    cleanupBetweenTests: true,
    resetDatabase: true,
    reporting: {
      console: true,
      junit: true,
      html: true,
      coverage: true,
      performance: true,
      outputDir: './test-results/complete'
    },
    performance: {
      enabled: true,
      scenarios: ['all'],
      thresholds: {
        averageResponseTime: 1500,
        p95ResponseTime: 3000,
        errorRate: 3,
        throughput: 15
      }
    }
  }
};

/**
 * E2E Test Orchestrator Configuration
 */
export const e2eConfig: E2ETestConfig = {
  services: testEnvironments.local.services,
  environment: 'development',
  testSuites: ['CallProcessing', 'UserManagement', 'WhitelistManagement'],
  execution: {
    parallel: false,
    maxConcurrency: 3,
    timeout: 120000,
    retries: 2
  },
  reporting: {
    formats: ['html', 'json', 'junit'],
    outputDir: './test-results/e2e',
    realtime: true
  },
  cleanup: {
    onSuccess: true,
    onFailure: true,
    aggressive: false
  },
  notifications: {
    // Configure notifications based on environment variables
    slack: process.env.SLACK_WEBHOOK_URL ? { webhook: process.env.SLACK_WEBHOOK_URL } : undefined,
    email: process.env.TEST_NOTIFICATION_EMAILS ? 
      { recipients: process.env.TEST_NOTIFICATION_EMAILS.split(',') } : undefined
  }
};

/**
 * Get test environment based on NODE_ENV
 */
export function getTestEnvironment(): TestEnvironment {
  const env = process.env.NODE_ENV || 'local';
  const testEnv = process.env.TEST_ENV || env;
  
  if (!testEnvironments[testEnv]) {
    throw new Error(`Unknown test environment: ${testEnv}`);
  }
  
  return testEnvironments[testEnv];
}

/**
 * Get test configuration based on TEST_TYPE
 */
export function getTestConfiguration(): TestExecutionConfig {
  const testType = process.env.TEST_TYPE || 'unit';
  
  if (!testConfigurations[testType]) {
    throw new Error(`Unknown test configuration: ${testType}`);
  }
  
  return testConfigurations[testType];
}

/**
 * Create environment-specific E2E configuration
 */
export function getE2EConfiguration(environment?: string): E2ETestConfig {
  const env = environment || process.env.TEST_ENV || 'local';
  const testEnv = testEnvironments[env];
  
  if (!testEnv) {
    throw new Error(`Unknown environment for E2E config: ${env}`);
  }
  
  return {
    ...e2eConfig,
    services: testEnv.services,
    environment: env as 'development' | 'staging' | 'production'
  };
}

/**
 * Validate test configuration
 */
export function validateTestConfig(config: TestExecutionConfig): string[] {
  const errors: string[] = [];
  
  if (config.testTypes.length === 0) {
    errors.push('At least one test type must be specified');
  }
  
  if (config.timeout.test <= 0) {
    errors.push('Test timeout must be greater than 0');
  }
  
  if (config.parallel && config.maxWorkers && config.maxWorkers <= 0) {
    errors.push('Max workers must be greater than 0 when parallel is enabled');
  }
  
  if (config.performance.enabled && config.performance.scenarios.length === 0) {
    errors.push('Performance scenarios must be specified when performance testing is enabled');
  }
  
  return errors;
}

export default {
  testEnvironments,
  testConfigurations,
  e2eConfig,
  getTestEnvironment,
  getTestConfiguration,
  getE2EConfiguration,
  validateTestConfig
};