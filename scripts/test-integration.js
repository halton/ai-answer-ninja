#!/usr/bin/env node
/**
 * Integration test runner script
 * Tests service communication, health checks, and API contracts
 */

const { spawn } = require('child_process');
const path = require('path');
const ServiceClient = require('../shared/service-client');

async function main() {
  console.log('🧪 Starting AI Answer Ninja Integration Tests');
  console.log('================================================');

  // Check if services are running
  const client = new ServiceClient();
  
  try {
    console.log('📊 Checking service availability...');
    const serviceStatus = await client.checkAllServices();
    
    const runningServices = Object.entries(serviceStatus)
      .filter(([_, status]) => status.available)
      .map(([name, _]) => name);
    
    const totalServices = Object.keys(serviceStatus).length;
    console.log(`✅ ${runningServices.length}/${totalServices} services are running`);
    
    if (runningServices.length === 0) {
      console.log('⚠️  No services detected. Starting minimal test mode...');
      console.log('   To run full tests: docker-compose up -d');
    } else {
      console.log(`🚀 Running services: ${runningServices.join(', ')}`);
    }
    
    console.log('');
  } catch (error) {
    console.warn('⚠️  Could not check service status:', error.message);
  }

  // Run Jest integration tests
  console.log('🔄 Running integration tests...');
  
  const jestProcess = spawn('npx', ['jest', '--config', 'tests/integration/jest.config.js', '--verbose'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });

  jestProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n🎉 All integration tests passed!');
    } else {
      console.log(`\n❌ Integration tests failed with code ${code}`);
    }
    
    // Run performance tests if main tests pass
    if (code === 0) {
      runPerformanceTests();
    } else {
      process.exit(code);
    }
  });
}

async function runPerformanceTests() {
  console.log('\n⚡ Running performance tests...');
  
  const client = new ServiceClient();
  
  try {
    // Test concurrent requests
    const concurrency = 10;
    const requests = Array(concurrency).fill().map(async (_, i) => {
      const start = Date.now();
      const result = await client.healthCheck('realtime-processor');
      const duration = Date.now() - start;
      return { success: result.success, duration, requestId: i };
    });

    const results = await Promise.allSettled(requests);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const avgDuration = successful.reduce((sum, r) => sum + r.value.duration, 0) / successful.length;
    
    console.log(`📈 Concurrent requests: ${successful.length}/${concurrency} successful`);
    console.log(`⏱️  Average response time: ${avgDuration.toFixed(2)}ms`);
    
    // Test circuit breaker
    console.log('\n🔌 Testing circuit breaker...');
    const breakerResults = [];
    for (let i = 0; i < 5; i++) {
      const result = await client.request('smart-whitelist', {
        url: '/api/v1/non-existent',
        timeout: 1000
      });
      breakerResults.push(result.success);
    }
    
    const circuitStats = client.getCircuitBreakerStats();
    console.log('🔧 Circuit breaker stats:', JSON.stringify(circuitStats, null, 2));
    
    console.log('\n✅ Performance tests completed');
    
  } catch (error) {
    console.error('❌ Performance tests failed:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };