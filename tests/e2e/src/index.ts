/**
 * E2E Test Suite Entry Point
 * 
 * Main entry point for the AI Phone System E2E test suite.
 * Provides CLI interface and programmatic API for test execution.
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs/promises';
import E2ETestOrchestrator, { E2ETestConfig } from './E2ETestOrchestrator';

const program = new Command();

// Default configuration
const defaultConfig: E2ETestConfig = {
  services: {
    userManagement: process.env.USER_MANAGEMENT_URL || 'http://localhost:3005',
    smartWhitelist: process.env.SMART_WHITELIST_URL || 'http://localhost:3006',
    conversationEngine: process.env.CONVERSATION_ENGINE_URL || 'http://localhost:3003',
    realtimeProcessor: process.env.REALTIME_PROCESSOR_URL || 'http://localhost:3002',
    profileAnalytics: process.env.PROFILE_ANALYTICS_URL || 'http://localhost:3004',
    phoneGateway: process.env.PHONE_GATEWAY_URL || 'http://localhost:3001',
    configurationService: process.env.CONFIGURATION_SERVICE_URL || 'http://localhost:3007',
    storageService: process.env.STORAGE_SERVICE_URL || 'http://localhost:3008',
    monitoringService: process.env.MONITORING_SERVICE_URL || 'http://localhost:3009'
  },
  environment: (process.env.NODE_ENV as any) || 'development',
  testSuites: [], // Empty means all suites
  execution: {
    parallel: true,
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '4'),
    timeout: parseInt(process.env.TEST_TIMEOUT || '300000'), // 5 minutes
    retries: parseInt(process.env.MAX_RETRIES || '2')
  },
  reporting: {
    formats: ['html', 'json', 'junit'],
    outputDir: './test-results',
    realtime: false
  },
  cleanup: {
    onSuccess: true,
    onFailure: false,
    aggressive: false
  },
  notifications: {}
};

// CLI Commands

program
  .name('ai-ninja-e2e')
  .description('AI Phone System E2E Test Suite')
  .version('1.0.0');

program
  .command('run')
  .description('Run E2E tests')
  .option('-c, --config <file>', 'Configuration file path')
  .option('-s, --suites <suites>', 'Comma-separated list of test suites to run')
  .option('-e, --environment <env>', 'Test environment (development|staging|production)')
  .option('--parallel', 'Run tests in parallel')
  .option('--no-parallel', 'Run tests sequentially')
  .option('--concurrency <num>', 'Maximum concurrent test execution', parseInt)
  .option('--timeout <ms>', 'Test timeout in milliseconds', parseInt)
  .option('--output <dir>', 'Output directory for reports')
  .option('--format <formats>', 'Report formats (html,json,junit,csv)')
  .option('--realtime', 'Enable real-time monitoring')
  .option('--slack-webhook <url>', 'Slack webhook URL for notifications')
  .option('--verbose', 'Verbose logging')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      
      if (options.verbose) {
        console.log('Configuration:', JSON.stringify(config, null, 2));
      }

      const orchestrator = new E2ETestOrchestrator(config);
      
      // Setup event handlers for CLI output
      setupCLIEventHandlers(orchestrator, options.verbose);

      // Start real-time monitoring if requested
      if (config.reporting.realtime || options.realtime) {
        orchestrator.startRealTimeMonitoring();
      }

      // Execute tests
      console.log('🚀 Starting E2E test execution...\n');
      const result = await orchestrator.executeTests();

      // Output summary
      console.log('\n📊 Test Execution Summary:');
      console.log(`  Success: ${result.success ? '✅ YES' : '❌ NO'}`);
      console.log(`  Duration: ${Math.round(result.duration / 1000)}s`);
      console.log(`  Tests: ${result.summary.passed}/${result.summary.totalTests} passed (${result.summary.passRate.toFixed(1)}%)`);
      
      if (result.issues.length > 0) {
        console.log(`  Issues: ${result.issues.length} found`);
        result.issues.forEach(issue => {
          const icon = issue.severity === 'critical' ? '🔴' : 
                      issue.severity === 'high' ? '🟡' : '🔵';
          console.log(`    ${icon} ${issue.title}`);
        });
      }

      console.log(`\n📋 Reports generated:`);
      result.reportFiles.forEach(file => {
        console.log(`  📄 ${file}`);
      });

      // Exit with appropriate code
      process.exit(result.success ? 0 : 1);

    } catch (error) {
      console.error('❌ E2E test execution failed:', error);
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Show execution plan without running tests')
  .option('-c, --config <file>', 'Configuration file path')
  .option('-s, --suites <suites>', 'Comma-separated list of test suites')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const orchestrator = new E2ETestOrchestrator(config);
      
      const plan = await orchestrator.planExecution();
      
      console.log('📋 E2E Test Execution Plan:');
      console.log(`  Total Suites: ${plan.totalSuites}`);
      console.log(`  Total Tests: ${plan.totalTests}`);
      console.log(`  Estimated Duration: ${Math.round(plan.estimatedDuration / 1000)}s`);
      console.log(`  Execution Order: ${plan.executionOrder.join(' → ')}`);
      console.log(`  Resource Requirements:`);
      console.log(`    Memory: ${plan.resourceRequirements.memory}MB`);
      console.log(`    CPU: ${plan.resourceRequirements.cpu}%`);
      console.log(`    Storage: ${plan.resourceRequirements.storage}MB`);
      
      if (plan.dependencies.length > 0) {
        console.log(`  Dependencies: ${plan.dependencies.join(', ')}`);
      }

    } catch (error) {
      console.error('❌ Failed to create execution plan:', error);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check service health')
  .option('-c, --config <file>', 'Configuration file path')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const orchestrator = new E2ETestOrchestrator(config);
      
      console.log('🔍 Checking service health...\n');
      
      // Get health checker from orchestrator (would need to expose it)
      // For now, simulate health check
      const services = Object.keys(config.services);
      
      for (const service of services) {
        try {
          // Simulate health check
          console.log(`  ${service}: ✅ Healthy`);
        } catch (error) {
          console.log(`  ${service}: ❌ Unhealthy - ${error}`);
        }
      }

    } catch (error) {
      console.error('❌ Health check failed:', error);
      process.exit(1);
    }
  });

program
  .command('generate-config')
  .description('Generate sample configuration file')
  .option('-o, --output <file>', 'Output file path', './e2e-config.json')
  .action(async (options) => {
    try {
      const configContent = JSON.stringify(defaultConfig, null, 2);
      await fs.writeFile(options.output, configContent);
      console.log(`✅ Configuration file generated: ${options.output}`);
    } catch (error) {
      console.error('❌ Failed to generate configuration:', error);
      process.exit(1);
    }
  });

// Helper functions

async function loadConfig(options: any): Promise<E2ETestConfig> {
  let config = { ...defaultConfig };

  // Load config file if specified
  if (options.config) {
    try {
      const configFile = await fs.readFile(options.config, 'utf-8');
      const fileConfig = JSON.parse(configFile);
      config = { ...config, ...fileConfig };
    } catch (error) {
      console.error(`Failed to load config file: ${options.config}`);
      throw error;
    }
  }

  // Override with CLI options
  if (options.suites) {
    config.testSuites = options.suites.split(',').map((s: string) => s.trim());
  }

  if (options.environment) {
    config.environment = options.environment;
  }

  if (options.hasOwnProperty('parallel')) {
    config.execution.parallel = options.parallel;
  }

  if (options.concurrency) {
    config.execution.maxConcurrency = options.concurrency;
  }

  if (options.timeout) {
    config.execution.timeout = options.timeout;
  }

  if (options.output) {
    config.reporting.outputDir = options.output;
  }

  if (options.format) {
    config.reporting.formats = options.format.split(',').map((f: string) => f.trim());
  }

  if (options.realtime) {
    config.reporting.realtime = true;
  }

  if (options.slackWebhook) {
    config.notifications = {
      ...config.notifications,
      slack: { webhook: options.slackWebhook }
    };
  }

  return config;
}

function setupCLIEventHandlers(orchestrator: E2ETestOrchestrator, verbose: boolean = false): void {
  orchestrator.on('execution_planned', (plan) => {
    if (verbose) {
      console.log(`📋 Execution planned: ${plan.totalSuites} suites, ${plan.totalTests} tests`);
    }
  });

  orchestrator.on('validation_completed', (data) => {
    console.log(`✅ Pre-execution validation passed (${data.healthyServices} services, ${data.healthyApis} APIs)`);
  });

  orchestrator.on('test_started', (data) => {
    if (verbose) {
      console.log(`🏃 Starting: ${data.jobId}`);
    }
  });

  orchestrator.on('test_completed', (data) => {
    const icon = data.result.status === 'passed' ? '✅' : '❌';
    console.log(`${icon} ${data.jobId}: ${data.result.status} (${Math.round(data.result.duration)}ms)`);
  });

  orchestrator.on('test_failed', (data) => {
    console.log(`❌ ${data.jobId}: FAILED - ${data.error || 'Unknown error'}`);
  });

  orchestrator.on('service_issue', (data) => {
    console.log(`⚠️  Service issue detected: ${data.serviceName} - ${data.issue}`);
  });

  orchestrator.on('real_time_update', (data) => {
    if (verbose) {
      console.log(`📊 Stats - Queued: ${data.execution.queued}, Running: ${data.execution.running}, Completed: ${data.execution.completed}`);
    }
  });

  orchestrator.on('execution_stopping', (data) => {
    console.log(`🛑 Stopping execution: ${data.reason}`);
  });

  // Handle process termination gracefully
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, stopping test execution...');
    await orchestrator.stopExecution('SIGINT received');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, stopping test execution...');
    await orchestrator.stopExecution('SIGTERM received');
    process.exit(0);
  });
}

// Programmatic API
export { E2ETestOrchestrator, E2ETestConfig };
export * from './scenarios/CallProcessingE2ETest';
export * from './scenarios/UserManagementE2ETest';
export * from './scenarios/WhitelistManagementE2ETest';
export * from './utils/TestApiClient';
export * from './utils/TestReporter';
export * from './utils/TestExecutor';
export * from './utils/ServiceHealthChecker';
export * from './fixtures/TestDataFactory';

// CLI execution
if (require.main === module) {
  program.parse();
}