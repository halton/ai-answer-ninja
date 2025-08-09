/**
 * Load Test Configuration
 * 
 * Defines load test profiles, thresholds, and environment-specific settings
 * for comprehensive performance testing of the AI Phone Answering System.
 */

import { LoadTestConfig } from './load-test-runner';

export const LOAD_TEST_ENVIRONMENTS = {
  local: {
    baseUrls: {
      userManagement: 'http://localhost:3005',
      smartWhitelist: 'http://localhost:3006',
      conversationEngine: 'http://localhost:3003',
      realtimeProcessor: 'http://localhost:3002',
      profileAnalytics: 'http://localhost:3004'
    }
  },
  dev: {
    baseUrls: {
      userManagement: 'http://dev-user-management:3005',
      smartWhitelist: 'http://dev-smart-whitelist:3006',
      conversationEngine: 'http://dev-conversation-engine:3003',
      realtimeProcessor: 'http://dev-realtime-processor:3002',
      profileAnalytics: 'http://dev-profile-analytics:3004'
    }
  },
  staging: {
    baseUrls: {
      userManagement: 'https://staging-api.ai-ninja.com/user-management',
      smartWhitelist: 'https://staging-api.ai-ninja.com/smart-whitelist',
      conversationEngine: 'https://staging-api.ai-ninja.com/conversation-engine',
      realtimeProcessor: 'wss://staging-api.ai-ninja.com/realtime-processor',
      profileAnalytics: 'https://staging-api.ai-ninja.com/profile-analytics'
    }
  }
};

export const LOAD_TEST_PROFILES = {
  // Light Load - Basic functionality validation
  light: {
    concurrentUsers: 10,
    requestsPerUser: 20,
    rampUpTime: 30000, // 30 seconds
    duration: 120000   // 2 minutes
  },
  
  // Normal Load - Expected production traffic
  normal: {
    concurrentUsers: 50,
    requestsPerUser: 50,
    rampUpTime: 60000, // 1 minute
    duration: 300000   // 5 minutes
  },
  
  // Heavy Load - Peak traffic simulation
  heavy: {
    concurrentUsers: 200,
    requestsPerUser: 100,
    rampUpTime: 120000, // 2 minutes
    duration: 600000    // 10 minutes
  },
  
  // Spike Load - Sudden traffic bursts
  spike: {
    concurrentUsers: 500,
    requestsPerUser: 30,
    rampUpTime: 10000,  // 10 seconds rapid ramp-up
    duration: 180000    // 3 minutes
  }
};

export const PERFORMANCE_THRESHOLDS = {
  // Response time thresholds (milliseconds)
  responseTime: {
    p50: 500,   // 50th percentile - 500ms
    p95: 1500,  // 95th percentile - 1.5s
    p99: 3000   // 99th percentile - 3s
  },
  
  // Throughput thresholds (requests per second)
  throughput: {
    min: 100,     // Minimum acceptable throughput
    target: 500   // Target throughput
  },
  
  // Error rate thresholds
  errorRate: {
    max: 0.01    // Maximum 1% error rate
  },
  
  // Resource usage thresholds
  resourceUsage: {
    cpu: 80,        // Maximum 80% CPU usage
    memory: 85,     // Maximum 85% memory usage
    connections: 1000 // Maximum concurrent connections
  }
};

export const BUSINESS_SCENARIO_WEIGHTS = {
  // Realistic distribution of API calls in production
  scenarios: {
    incoming_call_processing: {
      weight: 0.4,
      endpoints: [
        { endpoint: '/api/whitelist/{userId}/check/{phone}', method: 'GET', weight: 1.0 },
        { endpoint: '/api/conversation/manage', method: 'POST', weight: 0.8 },
        { endpoint: '/api/profile/{phone}', method: 'GET', weight: 0.6 }
      ]
    },
    
    user_management: {
      weight: 0.2,
      endpoints: [
        { endpoint: '/api/users', method: 'POST', weight: 0.3 },
        { endpoint: '/api/users/{id}', method: 'GET', weight: 0.7 },
        { endpoint: '/api/users/{id}', method: 'PUT', weight: 0.1 }
      ]
    },
    
    whitelist_management: {
      weight: 0.2,
      endpoints: [
        { endpoint: '/api/whitelist/{userId}', method: 'GET', weight: 0.5 },
        { endpoint: '/api/whitelist/{userId}/smart-add', method: 'POST', weight: 0.3 },
        { endpoint: '/api/evaluate', method: 'POST', weight: 0.2 }
      ]
    },
    
    analytics_processing: {
      weight: 0.15,
      endpoints: [
        { endpoint: '/api/analysis/call-effectiveness', method: 'POST', weight: 0.4 },
        { endpoint: '/api/analytics/user/{userId}', method: 'GET', weight: 0.3 },
        { endpoint: '/api/profile/update', method: 'PUT', weight: 0.3 }
      ]
    },
    
    realtime_processing: {
      weight: 0.05,
      endpoints: [
        { endpoint: '/api/session/init', method: 'POST', weight: 0.4 },
        { endpoint: '/api/audio/process', method: 'POST', weight: 0.5 },
        { endpoint: '/api/session/{callId}/end', method: 'POST', weight: 0.1 }
      ]
    }
  }
};

export const WEBSOCKET_LOAD_CONFIG = {
  concurrentConnections: 100,
  messagesPerConnection: 50,
  messageInterval: 50, // milliseconds between messages
  connectionTimeout: 60000, // 1 minute
  expectedThroughput: 1000, // messages per second
  stableConnectionRate: 0.95 // 95% connection success rate
};

export const ERROR_SIMULATION_CONFIG = {
  // Simulate various error conditions during load testing
  errorTypes: {
    network_timeout: {
      probability: 0.02, // 2% chance
      duration: 5000     // 5 second timeout
    },
    server_error: {
      probability: 0.005, // 0.5% chance
      statusCode: 500
    },
    rate_limit: {
      probability: 0.01, // 1% chance
      statusCode: 429
    },
    database_timeout: {
      probability: 0.003, // 0.3% chance
      duration: 10000    // 10 second timeout
    }
  }
};

/**
 * Generate load test configuration for specific environment
 */
export function getLoadTestConfig(environment: keyof typeof LOAD_TEST_ENVIRONMENTS): LoadTestConfig {
  const envConfig = LOAD_TEST_ENVIRONMENTS[environment];
  
  if (!envConfig) {
    throw new Error(`Unknown environment: ${environment}`);
  }

  return {
    baseUrls: envConfig.baseUrls,
    loadProfiles: LOAD_TEST_PROFILES,
    thresholds: PERFORMANCE_THRESHOLDS,
    timeout: 30000 // 30 second default timeout
  };
}

/**
 * Get environment-specific performance baselines
 */
export function getPerformanceBaselines(environment: keyof typeof LOAD_TEST_ENVIRONMENTS) {
  const baselines = {
    local: {
      expectedThroughput: 200,     // req/s
      expectedP95ResponseTime: 800, // ms
      maxAcceptableErrorRate: 0.02 // 2%
    },
    dev: {
      expectedThroughput: 300,     // req/s
      expectedP95ResponseTime: 1200, // ms
      maxAcceptableErrorRate: 0.015 // 1.5%
    },
    staging: {
      expectedThroughput: 500,     // req/s
      expectedP95ResponseTime: 1000, // ms
      maxAcceptableErrorRate: 0.01  // 1%
    }
  };

  return baselines[environment] || baselines.local;
}

/**
 * Generate realistic test data for load testing
 */
export function generateTestUserData(count: number) {
  const personalities = ['polite', 'direct', 'professional', 'humorous'];
  const phoneAreaCodes = ['555', '444', '333', '222'];
  
  return Array.from({ length: count }, (_, index) => ({
    phone_number: `+1${phoneAreaCodes[index % phoneAreaCodes.length]}${String(Date.now() + index).slice(-7)}`,
    name: `Load Test User ${index + 1}`,
    personality: personalities[index % personalities.length],
    preferences: {
      response_style: ['polite_decline', 'firm_refusal', 'humorous_deflection'][index % 3],
      auto_hang_up: index % 2 === 0,
      max_call_duration: 60 + (index % 5) * 30 // 60-180 seconds
    }
  }));
}

/**
 * Generate realistic call scenarios for testing
 */
export function generateCallScenarios(count: number) {
  const spamCategories = ['financial_services', 'insurance', 'real_estate', 'telemarketing', 'surveys'];
  const intents = ['loan_offer', 'insurance_sales', 'investment_pitch', 'credit_card_sales', 'survey_request'];
  const callerPhrases = [
    '你好，我是XX银行的客服',
    '我们有优质的保险产品',
    '了解一下我们的理财产品',
    '您有投资意向吗',
    '参与我们的调研活动'
  ];

  return Array.from({ length: count }, (_, index) => ({
    call_id: `load_test_call_${Date.now()}_${index}`,
    caller_phone: `+1555${String(Date.now() + index).slice(-7)}`,
    input_text: callerPhrases[index % callerPhrases.length],
    detected_intent: intents[index % intents.length],
    spam_category: spamCategories[index % spamCategories.length],
    intent_confidence: 0.7 + (Math.random() * 0.3), // 0.7-1.0 confidence
    processing_priority: Math.random() > 0.8 ? 'high' : 'normal'
  }));
}

/**
 * Get load test reporting configuration
 */
export const LOAD_TEST_REPORTING = {
  outputFormats: ['json', 'html', 'csv'],
  
  metricsToCapture: [
    'response_times',
    'throughput',
    'error_rates',
    'resource_utilization',
    'concurrent_users',
    'system_health'
  ],
  
  alertThresholds: {
    p95_response_time: 2000,    // 2 seconds
    error_rate: 0.05,           // 5%
    cpu_usage: 90,              // 90%
    memory_usage: 90,           // 90%
    failed_health_checks: 3     // consecutive failures
  },
  
  reportSections: [
    'executive_summary',
    'test_configuration',
    'performance_metrics',
    'error_analysis',
    'resource_utilization',
    'bottleneck_identification',
    'recommendations'
  ]
};

export default {
  LOAD_TEST_ENVIRONMENTS,
  LOAD_TEST_PROFILES,
  PERFORMANCE_THRESHOLDS,
  BUSINESS_SCENARIO_WEIGHTS,
  WEBSOCKET_LOAD_CONFIG,
  ERROR_SIMULATION_CONFIG,
  LOAD_TEST_REPORTING,
  getLoadTestConfig,
  getPerformanceBaselines,
  generateTestUserData,
  generateCallScenarios
};