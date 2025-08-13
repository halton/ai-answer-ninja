module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Project roots
  roots: [
    '<rootDir>/unit',
    '<rootDir>/integration', 
    '<rootDir>/e2e',
    '<rootDir>/../services'
  ],

  // Test patterns
  testMatch: [
    '**/__tests__/**/*.test.{js,ts}',
    '**/?(*.)+(spec|test).{js,ts}',
    '**/tests/**/*.test.{js,ts}'
  ],

  // File extensions
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],

  // Transform configuration
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': 'babel-jest',
  },

  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.ts'
  ],

  // Global setup/teardown
  globalSetup: '<rootDir>/jest.global-setup.ts',
  globalTeardown: '<rootDir>/jest.global-teardown.ts',

  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json-summary'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './services/phone-gateway/src/**/*.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './services/realtime-processor/src/**/*.ts': {
      branches: 82,
      functions: 82,
      lines: 82,
      statements: 82
    }
  },

  // What to collect coverage from
  collectCoverageFrom: [
    'services/**/*.{ts,js}',
    'shared/**/*.{ts,js}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/tests/**',
    '!**/*.config.{js,ts}',
    '!**/jest.setup.ts'
  ],

  // Module name mapping
  moduleNameMapping: {
    '^@services/(.*)$': '<rootDir>/../services/$1',
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '^@tests/(.*)$': '<rootDir>/$1',
    '^@mocks/(.*)$': '<rootDir>/mocks/$1',
    '^@fixtures/(.*)$': '<rootDir>/fixtures/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1'
  },

  // Test timeout
  testTimeout: 30000,

  // Verbose output
  verbose: true,

  // Detect open handles
  detectOpenHandles: true,
  forceExit: true,

  // Test environments for different suites
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/unit/**/*.test.{js,ts}'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/integration/**/*.test.{js,ts}'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      globalSetup: '<rootDir>/integration/setup.js',
      globalTeardown: '<rootDir>/integration/teardown.js',
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/e2e/**/*.test.{js,ts}'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      testTimeout: 60000,
    }
  ],

  // Reporter configuration
  reporters: [
    'default',
    ['jest-html-reporters', {
      publicPath: './coverage/html-report',
      filename: 'test-report.html',
      expand: true,
      hideIcon: false,
      pageTitle: 'AI Answer Ninja Test Report',
      logoImgPath: undefined,
      includeFailureMsg: true,
      includeSuiteFailure: true
    }],
    ['jest-junit', {
      outputDirectory: './coverage',
      outputName: 'junit.xml',
      ancestorSeparator: ' › ',
      uniqueOutputName: 'false',
      suiteNameTemplate: '{filepath}',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}'
    }]
  ],

  // Module paths
  modulePaths: ['<rootDir>'],

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Error handling
  errorOnDeprecated: true,

  // Notification settings (for development)
  notify: false,
  notifyMode: 'failure-change',

  // Watch plugins
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ]
};