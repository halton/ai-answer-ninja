// Jest setup file
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1'; // Use test database
process.env.AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || 'test-key';
process.env.AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'eastus2';
process.env.AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || 'test-key';
process.env.AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://test.openai.azure.com';

// Global test timeout
jest.setTimeout(10000);

// Cleanup function for tests
afterEach(async () => {
  // Clear any timers or intervals
  jest.clearAllTimers();
});

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});