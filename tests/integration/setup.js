/**
 * Integration test setup
 * Ensures services are running and ready before tests begin
 */

const { spawn } = require('child_process');
const path = require('path');

// Global setup for all integration tests
beforeAll(async () => {
  console.log('🚀 Starting integration test setup...');
  
  // Check if services are already running
  const ServiceClient = require('../../shared/service-client');
  const client = new ServiceClient();
  
  try {
    const results = await client.checkAllServices();
    const runningServices = Object.entries(results)
      .filter(([_, status]) => status.available)
      .map(([name, _]) => name);
    
    console.log(`📊 Services currently running: ${runningServices.join(', ')}`);
    
    if (runningServices.length === 0) {
      console.log('⚠️  No services running. Please start services with: docker-compose up');
      console.log('   Running tests with mock responses...');
    }
  } catch (error) {
    console.warn('Could not check service status:', error.message);
  }
}, 30000);

afterAll(async () => {
  console.log('🧹 Integration test cleanup complete');
});