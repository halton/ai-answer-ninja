module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/integration/**/*.test.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/setup.js'],
  testTimeout: 60000, // 60 seconds for integration tests
  verbose: true,
  collectCoverage: false, // Don't collect coverage for integration tests
  globalTeardown: '<rootDir>/teardown.js',
  rootDir: __dirname
};