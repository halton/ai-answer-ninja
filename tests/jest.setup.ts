// Jest setup file for test environment configuration
import { config } from 'dotenv';

// Load environment variables for testing
config({ path: '.env.test' });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.TEST_MODE = 'true';

// Global test timeout
jest.setTimeout(30000);

// Mock external services
jest.mock('axios');
jest.mock('ws');

// Global test setup
beforeAll(async () => {
  // Setup test environment
});

afterAll(async () => {
  // Cleanup after all tests
});