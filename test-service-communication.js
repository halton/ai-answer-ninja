#!/usr/bin/env node

/**
 * Service Communication Integration Test Runner
 * 
 * This script runs comprehensive tests of the AI Answer Ninja service communication layer.
 * It tests all service APIs, health checks, circuit breakers, and user journeys.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printHeader(title) {
  const border = '='.repeat(60);
  log(border, 'cyan');
  log(`  ${title}`, 'cyan');
  log(border, 'cyan');
}

function printSection(title) {
  log(`\n${'-'.repeat(40)}`, 'blue');
  log(`  ${title}`, 'blue');
  log(`${'-'.repeat(40)}`, 'blue');
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function formatTestResult(result) {
  const status = result.passed ? '✅' : '❌';
  const duration = formatDuration(result.duration);
  let line = `${status} ${result.testName} (${duration})`;
  
  if (!result.passed && result.error) {
    line += `\n   Error: ${result.error}`;
  }
  
  return line;
}

async function checkPrerequisites() {
  printSection('Checking Prerequisites');
  
  const checks = [
    {
      name: 'Node.js version',
      command: 'node --version',
      validator: (output) => {
        const version = output.trim();
        const majorVersion = parseInt(version.match(/v(\d+)/)[1]);
        return majorVersion >= 16;
      }
    },
    {
      name: 'TypeScript compiler',
      command: 'npx tsc --version',
      validator: (output) => output.includes('Version')
    },
    {
      name: 'Service communication library directory',
      command: 'ls -la shared/service-communication/src',
      validator: (output) => output.includes('index.ts')
    }
  ];

  const results = [];
  
  for (const check of checks) {
    try {
      const output = execSync(check.command, { encoding: 'utf8', stdio: 'pipe' });
      const passed = check.validator(output);
      results.push({ name: check.name, passed, output: output.trim() });
      
      if (passed) {
        log(`✅ ${check.name}: ${output.trim()}`);
      } else {
        log(`❌ ${check.name}: ${output.trim()}`, 'red');
      }
    } catch (error) {
      results.push({ name: check.name, passed: false, error: error.message });
      log(`❌ ${check.name}: ${error.message}`, 'red');
    }
  }

  const allPassed = results.every(r => r.passed);
  
  if (!allPassed) {
    log('\n⚠️  Some prerequisites failed. Please fix them before running tests.', 'yellow');
    process.exit(1);
  }
  
  log('\n✅ All prerequisites met!', 'green');
}

async function buildLibrary() {
  printSection('Building Service Communication Library');
  
  try {
    // Install dependencies
    log('Installing dependencies...');
    execSync('cd shared/service-communication && npm install', { stdio: 'inherit' });
    
    // Build TypeScript
    log('Building TypeScript...');
    execSync('cd shared/service-communication && npm run build', { stdio: 'inherit' });
    
    log('✅ Library built successfully!', 'green');
  } catch (error) {
    log(`❌ Build failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

async function checkServicesHealth() {
  printSection('Service Health Checks');
  
  const services = [
    { name: 'realtime-processor', port: 3002 },
    { name: 'conversation-engine', port: 3003 },
    { name: 'user-management', port: 3005 },
    { name: 'smart-whitelist', port: 3006 }
  ];

  const healthResults = [];
  
  for (const service of services) {
    try {
      const response = await fetch(`http://localhost:${service.port}/health`);
      const isHealthy = response.ok;
      healthResults.push({ service: service.name, healthy: isHealthy, status: response.status });
      
      if (isHealthy) {
        log(`✅ ${service.name} (port ${service.port}): Healthy`);
      } else {
        log(`⚠️  ${service.name} (port ${service.port}): Unhealthy (${response.status})`, 'yellow');
      }
    } catch (error) {
      healthResults.push({ service: service.name, healthy: false, error: error.message });
      log(`❌ ${service.name} (port ${service.port}): ${error.message}`, 'red');
    }
  }

  const healthyCount = healthResults.filter(r => r.healthy).length;
  const totalCount = healthResults.length;
  
  log(`\n📊 Health Summary: ${healthyCount}/${totalCount} services healthy`);
  
  if (healthyCount < totalCount) {
    log('⚠️  Some services are unhealthy. Tests may fail.', 'yellow');
    log('💡 Tip: Run "docker-compose up -d" to start all services', 'cyan');
  }
  
  return healthResults;
}

async function runIntegrationTests() {
  printSection('Running Integration Tests');
  
  const testScript = `
    const { IntegrationTestRunner } = require('./shared/service-communication/dist/index');
    
    async function runTests() {
      const runner = new IntegrationTestRunner({
        timeout: 30000,
        retries: 2,
        waitForHealthy: true,
        healthyTimeout: 60000,
        skipSlowTests: false
      });
      
      try {
        const results = await runner.runAllTests();
        console.log(JSON.stringify(results, null, 2));
      } catch (error) {
        console.error('Test runner failed:', error.message);
        process.exit(1);
      }
    }
    
    runTests();
  `;

  try {
    // Write temporary test script
    fs.writeFileSync('/tmp/integration-tests.js', testScript);
    
    // Run tests
    const output = execSync('node /tmp/integration-tests.js', { 
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    const results = JSON.parse(output);
    
    // Display results
    log(`\n📊 Integration Test Results:`);
    log(`   Overall: ${results.overall.passed ? '✅ PASSED' : '❌ FAILED'}`);
    log(`   Duration: ${formatDuration(results.overall.duration)}`);
    log(`   Suites: ${results.overall.passedSuites}/${results.overall.totalSuites} passed`);
    log(`   Tests: ${results.overall.passedTests}/${results.overall.totalTests} passed`);
    
    // Display suite details
    for (const suite of results.suites) {
      const suiteStatus = suite.passed ? '✅' : '❌';
      const suiteDuration = formatDuration(suite.duration);
      log(`\n${suiteStatus} ${suite.suiteName} (${suite.passedTests}/${suite.totalTests}, ${suiteDuration})`);
      
      // Show failed tests
      const failedTests = suite.tests.filter(t => !t.passed);
      for (const test of failedTests) {
        log(`   ${formatTestResult(test)}`, 'red');
      }
    }
    
    // Clean up
    fs.unlinkSync('/tmp/integration-tests.js');
    
    return results.overall.passed;
  } catch (error) {
    log(`❌ Integration tests failed: ${error.message}`, 'red');
    return false;
  }
}

async function runUserJourneyTests() {
  printSection('Running User Journey Tests');
  
  const testScript = `
    const { UserJourneyTests } = require('./shared/service-communication/dist/index');
    
    async function runJourneys() {
      const journeyTester = new UserJourneyTests();
      
      try {
        const results = await journeyTester.runAllJourneys();
        console.log(JSON.stringify(results, null, 2));
      } catch (error) {
        console.error('Journey tests failed:', error.message);
        process.exit(1);
      }
    }
    
    runJourneys();
  `;

  try {
    // Write temporary test script
    fs.writeFileSync('/tmp/journey-tests.js', testScript);
    
    // Run journey tests
    const output = execSync('node /tmp/journey-tests.js', { 
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    const results = JSON.parse(output);
    
    // Display results
    log(`\n🎯 User Journey Test Results:`);
    log(`   Overall: ${results.overall.passed ? '✅ PASSED' : '❌ FAILED'}`);
    log(`   Duration: ${formatDuration(results.overall.duration)}`);
    log(`   Journeys: ${results.overall.passedSuites}/${results.overall.totalSuites} passed`);
    log(`   Tests: ${results.overall.passedTests}/${results.overall.totalTests} passed`);
    
    // Display journey details
    for (const suite of results.suites) {
      const journeyStatus = suite.passed ? '✅' : '❌';
      const journeyDuration = formatDuration(suite.duration);
      log(`\n${journeyStatus} ${suite.suiteName} (${suite.passedTests}/${suite.totalTests}, ${journeyDuration})`);
      
      // Show failed tests
      const failedTests = suite.tests.filter(t => !t.passed);
      if (failedTests.length > 0) {
        for (const test of failedTests) {
          log(`   ${formatTestResult(test)}`, 'red');
        }
      }
    }
    
    // Clean up
    fs.unlinkSync('/tmp/journey-tests.js');
    
    return results.overall.passed;
  } catch (error) {
    log(`❌ User journey tests failed: ${error.message}`, 'red');
    return false;
  }
}

function printSummary(integrationPassed, journeyPassed, healthResults) {
  printHeader('TEST EXECUTION SUMMARY');
  
  const totalTests = 2;
  const passedTests = (integrationPassed ? 1 : 0) + (journeyPassed ? 1 : 0);
  
  log(`📊 Test Suite Results:`);
  log(`   Integration Tests: ${integrationPassed ? '✅ PASSED' : '❌ FAILED'}`);
  log(`   User Journey Tests: ${journeyPassed ? '✅ PASSED' : '❌ FAILED'}`);
  log(`   Overall: ${passedTests}/${totalTests} test suites passed`);
  
  log(`\n🏥 Service Health:`);
  const healthyServices = healthResults.filter(r => r.healthy).length;
  const totalServices = healthResults.length;
  log(`   Healthy Services: ${healthyServices}/${totalServices}`);
  
  for (const result of healthResults) {
    const status = result.healthy ? '✅' : '❌';
    log(`   ${status} ${result.service}`);
  }
  
  if (passedTests === totalTests) {
    log(`\n🎉 All tests passed! Service communication layer is working correctly.`, 'green');
    log(`\n💡 Next steps:`, 'cyan');
    log(`   - Deploy to staging environment`, 'cyan');
    log(`   - Run load testing`, 'cyan');
    log(`   - Monitor production metrics`, 'cyan');
  } else {
    log(`\n❌ Some tests failed. Please review the errors above.`, 'red');
    log(`\n🔧 Troubleshooting tips:`, 'yellow');
    log(`   - Check service logs: docker-compose logs <service-name>`, 'yellow');
    log(`   - Restart services: docker-compose restart`, 'yellow');
    log(`   - Verify database connections`, 'yellow');
    log(`   - Check network connectivity between services`, 'yellow');
  }
}

async function main() {
  const startTime = Date.now();
  
  printHeader('AI ANSWER NINJA - SERVICE COMMUNICATION TESTS');
  
  try {
    // Step 1: Check prerequisites
    await checkPrerequisites();
    
    // Step 2: Build the library
    await buildLibrary();
    
    // Step 3: Check service health
    const healthResults = await checkServicesHealth();
    
    // Step 4: Run integration tests
    const integrationPassed = await runIntegrationTests();
    
    // Step 5: Run user journey tests
    const journeyPassed = await runUserJourneyTests();
    
    // Step 6: Print summary
    printSummary(integrationPassed, journeyPassed, healthResults);
    
    const duration = Date.now() - startTime;
    log(`\n⏱️  Total execution time: ${formatDuration(duration)}`, 'cyan');
    
    // Exit with appropriate code
    const allPassed = integrationPassed && journeyPassed;
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    log(`\n💥 Test runner crashed: ${error.message}`, 'red');
    log(error.stack, 'red');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('\n⚠️  Test execution interrupted by user', 'yellow');
  process.exit(1);
});

process.on('SIGTERM', () => {
  log('\n⚠️  Test execution terminated', 'yellow');
  process.exit(1);
});

// Add global fetch polyfill for Node.js < 18
if (!global.fetch) {
  try {
    const fetch = require('node-fetch');
    global.fetch = fetch;
  } catch (error) {
    log('⚠️  node-fetch not available. Some tests may fail on Node.js < 18', 'yellow');
  }
}

// Run the main function
main();