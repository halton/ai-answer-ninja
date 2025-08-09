#!/usr/bin/env ts-node
/**
 * E2E Test Execution Script
 * 
 * Usage:
 *   npm run test:e2e              # Run all E2E tests
 *   npm run test:e2e -- --env=dev # Run tests against dev environment
 *   npm run test:e2e -- --env=staging --skip-cleanup # Run against staging, skip cleanup
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { program } from 'commander';
import E2ETestRunner, { E2ETestConfig } from './e2e-test-runner';

interface EnvironmentConfig {
  [key: string]: {
    services: {
      userManagement: string;
      smartWhitelist: string;
      conversationEngine: string;
      realtimeProcessor: string;
      profileAnalytics: string;
      adminPanel: string;
    };
  };
}

const ENVIRONMENT_CONFIGS: EnvironmentConfig = {
  local: {
    services: {
      userManagement: 'http://localhost:3005',
      smartWhitelist: 'http://localhost:3006',
      conversationEngine: 'http://localhost:3003',
      realtimeProcessor: 'http://localhost:3002',
      profileAnalytics: 'http://localhost:3004',
      adminPanel: 'http://localhost:3000'
    }
  },
  dev: {
    services: {
      userManagement: 'http://dev-user-management:3005',
      smartWhitelist: 'http://dev-smart-whitelist:3006',
      conversationEngine: 'http://dev-conversation-engine:3003',
      realtimeProcessor: 'http://dev-realtime-processor:3002',
      profileAnalytics: 'http://dev-profile-analytics:3004',
      adminPanel: 'http://dev-admin-panel:3000'
    }
  },
  staging: {
    services: {
      userManagement: 'https://staging-api.ai-ninja.com/user-management',
      smartWhitelist: 'https://staging-api.ai-ninja.com/smart-whitelist',
      conversationEngine: 'https://staging-api.ai-ninja.com/conversation-engine',
      realtimeProcessor: 'wss://staging-api.ai-ninja.com/realtime-processor',
      profileAnalytics: 'https://staging-api.ai-ninja.com/profile-analytics',
      adminPanel: 'https://staging-admin.ai-ninja.com'
    }
  },
  production: {
    services: {
      userManagement: 'https://api.ai-ninja.com/user-management',
      smartWhitelist: 'https://api.ai-ninja.com/smart-whitelist',
      conversationEngine: 'https://api.ai-ninja.com/conversation-engine',
      realtimeProcessor: 'wss://api.ai-ninja.com/realtime-processor',
      profileAnalytics: 'https://api.ai-ninja.com/profile-analytics',
      adminPanel: 'https://admin.ai-ninja.com'
    }
  }
};

const DEFAULT_CONFIG: Omit<E2ETestConfig, 'services'> = {
  timeouts: {
    short: 5000,     // 5 seconds
    medium: 15000,   // 15 seconds
    long: 30000,     // 30 seconds
    realtime: 45000  // 45 seconds for WebSocket tests
  },
  retries: {
    default: 2,
    websocket: 3,
    database: 1
  },
  thresholds: {
    responseTime: 1000,  // 1 second
    accuracy: 0.85,      // 85%
    availability: 0.95   // 95%
  }
};

async function generateTestReport(results: any, environment: string): Promise<void> {
  const reportDir = path.join(__dirname, '../../reports/e2e');
  await fs.mkdir(reportDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(reportDir, `e2e-test-report-${environment}-${timestamp}.json`);
  
  const report = {
    environment,
    timestamp: new Date().toISOString(),
    results,
    metadata: {
      nodejs_version: process.version,
      platform: process.platform,
      arch: process.arch,
      memory_usage: process.memoryUsage(),
      execution_time: results.summary.duration
    }
  };

  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  
  // Generate HTML report
  const htmlReport = generateHtmlReport(report);
  const htmlFile = path.join(reportDir, `e2e-test-report-${environment}-${timestamp}.html`);
  await fs.writeFile(htmlFile, htmlReport);
  
  console.log(`\n📊 Test reports generated:`);
  console.log(`   JSON: ${reportFile}`);
  console.log(`   HTML: ${htmlFile}`);
}

function generateHtmlReport(report: any): string {
  const { results } = report;
  const { summary, suites } = results;
  
  const statusColor = summary.passed ? '#28a745' : '#dc3545';
  const statusIcon = summary.passed ? '✅' : '❌';
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Phone System E2E Test Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #f8f9fa; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 40px; }
        .status { font-size: 24px; font-weight: bold; color: ${statusColor}; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .metric { text-align: center; padding: 20px; background: #f8f9fa; border-radius: 6px; }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; }
        .metric-label { color: #666; margin-top: 5px; }
        .suite { margin: 30px 0; padding: 20px; border: 1px solid #dee2e6; border-radius: 6px; }
        .suite-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .suite-title { font-size: 1.2em; font-weight: bold; }
        .suite-status { padding: 4px 12px; border-radius: 4px; color: white; font-size: 0.9em; }
        .suite-passed { background: #28a745; }
        .suite-failed { background: #dc3545; }
        .tests { display: grid; gap: 10px; }
        .test { padding: 10px 15px; border-left: 4px solid; background: #f8f9fa; }
        .test-passed { border-color: #28a745; }
        .test-failed { border-color: #dc3545; }
        .test-details { display: flex; justify-content: space-between; align-items: center; }
        .test-metrics { font-size: 0.9em; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>AI Phone System E2E Test Report</h1>
            <div class="status">${statusIcon} ${summary.passed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}</div>
            <p>Environment: <strong>${report.environment.toUpperCase()}</strong> | ${report.timestamp}</p>
        </div>
        
        <div class="metrics">
            <div class="metric">
                <div class="metric-value">${summary.passedTests}/${summary.totalTests}</div>
                <div class="metric-label">Tests Passed</div>
            </div>
            <div class="metric">
                <div class="metric-value">${Math.round(summary.overallMetrics.systemAvailability * 100)}%</div>
                <div class="metric-label">System Availability</div>
            </div>
            <div class="metric">
                <div class="metric-value">${summary.overallMetrics.averageResponseTime}ms</div>
                <div class="metric-label">Avg Response Time</div>
            </div>
            <div class="metric">
                <div class="metric-value">${Math.round(summary.overallMetrics.accuracy * 100)}%</div>
                <div class="metric-label">Accuracy</div>
            </div>
            <div class="metric">
                <div class="metric-value">${Math.round(summary.duration / 1000)}s</div>
                <div class="metric-label">Total Duration</div>
            </div>
        </div>
        
        ${suites.map(suite => `
        <div class="suite">
            <div class="suite-header">
                <div class="suite-title">${suite.suiteName}</div>
                <div class="suite-status ${suite.passed ? 'suite-passed' : 'suite-failed'}">
                    ${suite.metrics.passedTests}/${suite.metrics.totalTests} PASSED
                </div>
            </div>
            <div class="tests">
                ${suite.tests.map(test => `
                <div class="test ${test.passed ? 'test-passed' : 'test-failed'}">
                    <div class="test-details">
                        <div>${test.passed ? '✅' : '❌'} ${test.testName}</div>
                        <div class="test-metrics">
                            ${test.duration}ms
                            ${test.metrics?.responseTime ? ` | Response: ${test.metrics.responseTime}ms` : ''}
                            ${test.metrics?.accuracy ? ` | Accuracy: ${Math.round(test.metrics.accuracy * 100)}%` : ''}
                        </div>
                    </div>
                    ${test.error ? `<div style="color: #dc3545; font-size: 0.9em; margin-top: 5px;">Error: ${test.error}</div>` : ''}
                </div>
                `).join('')}
            </div>
        </div>
        `).join('')}
    </div>
</body>
</html>`;
}

async function main() {
  program
    .name('run-e2e-tests')
    .description('Run End-to-End tests for AI Phone Answering System')
    .option('-e, --env <environment>', 'Target environment', 'local')
    .option('--skip-cleanup', 'Skip test data cleanup')
    .option('--skip-slow', 'Skip slow performance tests')
    .option('--timeout <ms>', 'Override default timeout', '30000')
    .option('--retries <count>', 'Number of retries for failed tests', '2')
    .option('--verbose', 'Enable verbose logging')
    .option('--report', 'Generate detailed HTML report', true)
    .parse();

  const options = program.opts();
  
  console.log('🚀 Starting AI Phone System E2E Tests');
  console.log(`   Environment: ${options.env}`);
  console.log(`   Skip cleanup: ${options.skipCleanup ? 'Yes' : 'No'}`);
  console.log(`   Timeout: ${options.timeout}ms`);
  console.log('');

  // Validate environment
  if (!ENVIRONMENT_CONFIGS[options.env]) {
    console.error(`❌ Invalid environment: ${options.env}`);
    console.error(`Available environments: ${Object.keys(ENVIRONMENT_CONFIGS).join(', ')}`);
    process.exit(1);
  }

  // Build configuration
  const config: E2ETestConfig = {
    ...DEFAULT_CONFIG,
    services: ENVIRONMENT_CONFIGS[options.env].services,
    timeouts: {
      ...DEFAULT_CONFIG.timeouts,
      medium: parseInt(options.timeout) || DEFAULT_CONFIG.timeouts.medium
    },
    retries: {
      ...DEFAULT_CONFIG.retries,
      default: parseInt(options.retries) || DEFAULT_CONFIG.retries.default
    }
  };

  if (options.skipSlow) {
    config.timeouts.long = config.timeouts.medium;
    config.timeouts.realtime = config.timeouts.medium;
  }

  // Create and run test runner
  const testRunner = new E2ETestRunner(config);
  
  try {
    const results = await testRunner.runAllTests();
    
    // Generate reports if requested
    if (options.report) {
      await generateTestReport(results, options.env);
    }
    
    // Cleanup unless skipped
    if (!options.skipCleanup) {
      await testRunner.cleanup();
    }
    
    // Exit with appropriate code
    const exitCode = results.summary.passed ? 0 : 1;
    
    console.log(`\n🎯 E2E Test Execution Complete`);
    console.log(`   Status: ${results.summary.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Tests: ${results.summary.passedTests}/${results.summary.totalTests}`);
    console.log(`   Duration: ${Math.round(results.summary.duration / 1000)}s`);
    console.log(`   Avg Response Time: ${results.summary.overallMetrics.averageResponseTime}ms`);
    console.log(`   System Availability: ${Math.round(results.summary.overallMetrics.systemAvailability * 100)}%`);
    
    process.exit(exitCode);
    
  } catch (error) {
    console.error('💥 E2E test execution failed:', (error as Error).message);
    
    // Try to cleanup even if tests failed
    if (!options.skipCleanup) {
      try {
        await testRunner.cleanup();
      } catch (cleanupError) {
        console.error('⚠️ Cleanup failed:', (cleanupError as Error).message);
      }
    }
    
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Main execution failed:', error.message);
    process.exit(1);
  });
}

export { main as runE2ETests };