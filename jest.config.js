/**
 * Comprehensive Jest Configuration for AI Answer Ninja Test Suite
 * 
 * This configuration supports:
 * - Unit tests with mocking
 * - Integration tests with real services
 * - E2E tests with full system setup
 * - Performance tests with custom reporters
 * - Security tests with specialized matchers
 */

const { defaults } = require('jest-config');

const baseConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/services'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^@services/(.*)$': '<rootDir>/services/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
  },
  setupFilesAfterEnv: [
    '<rootDir>/tests/jest.setup.ts'
  ],
  globalSetup: '<rootDir>/tests/jest.global-setup.ts',
  globalTeardown: '<rootDir>/tests/jest.global-teardown.ts',
  testTimeout: 30000,
  verbose: true,
  collectCoverageFrom: [
    'services/**/*.ts',
    'shared/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/dist/**',
    '!**/*.config.ts',
  ],
  coverageDirectory: 'tests/coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
  ],
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'ts', 'tsx'],
};

module.exports = {
  projects: [
    // Unit Tests Configuration
    {
      ...baseConfig,
      displayName: 'unit',
      testMatch: [
        '<rootDir>/tests/unit/**/*.test.ts',
        '<rootDir>/services/**/tests/**/*.test.ts',
        '<rootDir>/shared/**/tests/**/*.test.ts',
      ],
      testEnvironment: 'node',
      setupFilesAfterEnv: [
        '<rootDir>/tests/jest.setup.ts',
        '<rootDir>/tests/unit/unit.setup.ts',
      ],
      coveragePathIgnorePatterns: [
        '/tests/',
        '/mocks/',
        '/__tests__/',
      ],
    },

    // Integration Tests Configuration
    {
      ...baseConfig,
      displayName: 'integration',
      testMatch: [
        '<rootDir>/tests/integration/**/*.test.ts',
      ],
      testEnvironment: 'node',
      setupFilesAfterEnv: [
        '<rootDir>/tests/jest.setup.ts',
        '<rootDir>/tests/integration/integration.setup.ts',
      ],
      testTimeout: 60000,
      // Run integration tests sequentially to avoid conflicts
      maxWorkers: 1,
      // Enable real database connections
      globalSetup: '<rootDir>/tests/integration/jest.integration-setup.ts',
      globalTeardown: '<rootDir>/tests/integration/jest.integration-teardown.ts',
    },

    // E2E Tests Configuration
    {
      ...baseConfig,
      displayName: 'e2e',
      testMatch: [
        '<rootDir>/tests/e2e/**/*.test.ts',
      ],
      testEnvironment: 'node',
      setupFilesAfterEnv: [
        '<rootDir>/tests/jest.setup.ts',
        '<rootDir>/tests/e2e/e2e.setup.ts',
      ],
      testTimeout: 120000,
      // Run E2E tests sequentially
      maxWorkers: 1,
      // Special setup for E2E environment
      globalSetup: '<rootDir>/tests/e2e/jest.e2e-setup.ts',
      globalTeardown: '<rootDir>/tests/e2e/jest.e2e-teardown.ts',
      // Disable coverage for E2E tests (focus on functionality)
      collectCoverage: false,
    },

    // Performance Tests Configuration
    {
      ...baseConfig,
      displayName: 'performance',
      testMatch: [
        '<rootDir>/tests/performance/**/*.test.ts',
        '<rootDir>/tests/load/**/*.test.ts',
      ],
      testEnvironment: 'node',
      setupFilesAfterEnv: [
        '<rootDir>/tests/jest.setup.ts',
        '<rootDir>/tests/performance/performance.setup.ts',
      ],
      testTimeout: 300000, // 5 minutes for performance tests
      maxWorkers: 1,
      // Custom reporters for performance metrics
      reporters: [
        'default',
        ['<rootDir>/tests/reporters/performance-reporter.js', {
          outputFile: 'tests/reports/performance-results.json',
        }],
      ],
      collectCoverage: false,
    },

    // Security Tests Configuration
    {
      ...baseConfig,
      displayName: 'security',
      testMatch: [
        '<rootDir>/tests/security/**/*.test.ts',
      ],
      testEnvironment: 'node',
      setupFilesAfterEnv: [
        '<rootDir>/tests/jest.setup.ts',
        '<rootDir>/tests/security/security.setup.ts',
      ],
      testTimeout: 60000,
      maxWorkers: 1,
      // Custom matchers for security assertions
      setupFilesAfterEnv: [
        '<rootDir>/tests/matchers/security-matchers.ts',
      ],
      collectCoverage: false,
    },
  ],

  // Global configuration
  coverageDirectory: '<rootDir>/tests/coverage',
  collectCoverageFrom: [
    'services/**/*.ts',
    'shared/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/dist/**',
    '!**/*.config.ts',
    '!**/tests/**',
    '!**/mocks/**',
  ],

  // Custom reporters
  reporters: [
    'default',
    ['jest-html-reporters', {
      publicPath: './tests/reports',
      filename: 'test-report.html',
      expand: true,
    }],
    ['jest-junit', {
      outputDirectory: './tests/reports',
      outputName: 'junit.xml',
    }],
  ],

  // Global thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Per-service thresholds
    'services/realtime-processor/**/*.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    'services/conversation-engine/**/*.py': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    'shared/security/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};