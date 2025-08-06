/**
 * Jest test setup for service communication tests
 */

import { healthCheckManager } from '../health/HealthCheckManager';

// Global test timeout
jest.setTimeout(30000);

// Setup before all tests
beforeAll(async () => {
  // Start health check monitoring
  healthCheckManager.startPeriodicChecks();
  
  // Wait for services to be ready
  const ready = await healthCheckManager.waitForHealthyServices(10000, [
    'realtime-processor',
    'conversation-engine', 
    'user-management',
    'smart-whitelist'
  ]);
  
  if (!ready) {
    console.warn('⚠️  Not all services are healthy, tests may fail');
  }
});

// Cleanup after all tests
afterAll(async () => {
  // Stop health check monitoring
  healthCheckManager.stopPeriodicChecks();
  
  // Clean up any resources
  healthCheckManager.destroy();
});

// Console logging setup for tests
const originalConsole = console;
global.console = {
  ...originalConsole,
  log: jest.fn(originalConsole.log),
  warn: jest.fn(originalConsole.warn),
  error: jest.fn(originalConsole.error),
  debug: jest.fn(originalConsole.debug),
  info: jest.fn(originalConsole.info),
};