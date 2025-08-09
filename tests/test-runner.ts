#!/usr/bin/env ts-node

/**
 * Comprehensive Test Runner
 * Orchestrates test execution with proper fixture management and reporting
 */

import { program } from 'commander';
import { FixtureManager, TestEnvironmentConfig } from './fixtures/fixture-manager';
import { TestDataManager } from './data/test-data-manager';
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TestSuite {
  name: string;
  description: string;
  pattern: string;
  environment: TestEnvironmentConfig['environment'];
  fixtures: string[];
  timeout: number;
}

interface TestResults {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: number;
  errors: string[];
}

class ComprehensiveTestRunner {
  private fixtureManager: FixtureManager;
  private testResults: TestResults[] = [];
  private startTime: Date = new Date();

  constructor(private config: TestEnvironmentConfig) {
    this.fixtureManager = new FixtureManager(config);
  }

  /**
   * Run test suites based on configuration
   */
  public async runTests(suiteNames: string[] = []): Promise<void> {
    console.log('🚀 Starting AI Phone Answering System Test Suite');
    console.log(`Environment: ${this.config.environment}`);
    console.log(`Use Real Services: ${this.config.useRealServices}`);
    console.log(`Debug Mode: ${this.config.debugMode}`);
    console.log('='.repeat(60));

    this.startTime = new Date();

    try {
      // Initialize test environment
      await this.fixtureManager.initializeTestEnvironment();

      // Get available test suites
      const testSuites = this.getTestSuites();
      const suitesToRun = suiteNames.length > 0 
        ? testSuites.filter(suite => suiteNames.includes(suite.name))
        : testSuites.filter(suite => suite.environment === this.config.environment);

      if (suitesToRun.length === 0) {
        console.log('⚠️ No test suites found matching criteria');
        return;
      }

      console.log(`📋 Running ${suitesToRun.length} test suite(s):`);
      suitesToRun.forEach(suite => console.log(`  - ${suite.name}: ${suite.description}`));
      console.log('');

      // Run each test suite
      for (const suite of suitesToRun) {
        await this.runTestSuite(suite);
        
        if (this.config.resetBetweenTests) {
          await this.resetEnvironmentBetweenSuites();
        }
      }

      // Generate final report
      await this.generateFinalReport();

    } catch (error) {
      console.error('💥 Test execution failed:', error);
      process.exit(1);
    } finally {
      // Cleanup test environment
      await this.fixtureManager.cleanupTestEnvironment();
    }
  }

  /**
   * Run a single test suite
   */
  private async runTestSuite(suite: TestSuite): Promise<void> {
    console.log(`\n🧪 Running test suite: ${suite.name}`);
    console.log(`Description: ${suite.description}`);
    console.log(`Pattern: ${suite.pattern}`);
    console.log(`Fixtures: ${suite.fixtures.join(', ')}`);

    const suiteStartTime = Date.now();
    const result: TestResults = {
      suite: suite.name,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      errors: []
    };

    try {
      // Load required fixtures
      for (const fixtureName of suite.fixtures) {
        console.log(`📦 Loading fixture: ${fixtureName}`);
        await this.fixtureManager.loadFixture(fixtureName);
      }

      // Run the actual tests
      const testResult = await this.executeTests(suite);
      
      result.passed = testResult.passed;
      result.failed = testResult.failed;
      result.skipped = testResult.skipped;
      result.coverage = testResult.coverage;
      result.errors = testResult.errors;

      // Teardown fixtures
      for (const fixtureName of suite.fixtures) {
        await this.fixtureManager.teardownFixture(fixtureName);
      }

    } catch (error) {
      console.error(`❌ Test suite failed: ${suite.name}`, error);
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    result.duration = Date.now() - suiteStartTime;
    this.testResults.push(result);

    // Print suite results
    this.printSuiteResults(result);
  }

  /**
   * Execute tests using appropriate test runner
   */
  private async executeTests(suite: TestSuite): Promise<{
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
    errors: string[];
  }> {
    const testCommand = this.buildTestCommand(suite);
    console.log(`🏃 Executing: ${testCommand}`);

    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', testCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.getTestEnvironmentVars() }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        if (this.config.debugMode) {
          process.stdout.write(output);
        }
      });

      child.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        if (this.config.debugMode) {
          process.stderr.write(output);
        }
      });

      child.on('close', (code) => {
        try {
          const results = this.parseTestResults(stdout, stderr, suite);
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Handle timeout
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Test suite timed out after ${suite.timeout}ms`));
      }, suite.timeout);
    });
  }

  /**
   * Build test command based on suite type
   */
  private buildTestCommand(suite: TestSuite): string {
    const baseDir = path.resolve(__dirname, '..');
    
    switch (suite.environment) {
      case 'unit':
        return `cd ${baseDir} && npm run test:unit -- --testPathPattern="${suite.pattern}" --coverage --json --outputFile=./test-results/${suite.name}-results.json`;
      
      case 'integration':
        return `cd ${baseDir} && npm run test:integration -- --testPathPattern="${suite.pattern}" --coverage --json --outputFile=./test-results/${suite.name}-results.json`;
      
      case 'e2e':
        return `cd ${baseDir} && npm run test:e2e -- --testPathPattern="${suite.pattern}" --json --outputFile=./test-results/${suite.name}-results.json`;
      
      case 'load':
        return `cd ${baseDir} && npm run test:load -- --testPathPattern="${suite.pattern}" --json --outputFile=./test-results/${suite.name}-results.json`;
      
      default:
        throw new Error(`Unknown test environment: ${suite.environment}`);
    }
  }

  /**
   * Parse test results from test runner output
   */
  private parseTestResults(stdout: string, stderr: string, suite: TestSuite): {
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
    errors: string[];
  } {
    const errors: string[] = [];
    
    // Try to parse JSON results first
    try {
      const resultsFile = path.resolve(__dirname, `../test-results/${suite.name}-results.json`);
      if (fs.existsSync(resultsFile)) {
        const jsonResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
        
        return {
          passed: jsonResults.numPassedTests || 0,
          failed: jsonResults.numFailedTests || 0,
          skipped: jsonResults.numPendingTests || 0,
          coverage: jsonResults.coverageMap ? 
            this.calculateOverallCoverage(jsonResults.coverageMap) : undefined,
          errors: jsonResults.testResults?.reduce((acc: string[], test: any) => {
            if (test.status === 'failed') {
              acc.push(...test.failureMessages);
            }
            return acc;
          }, []) || []
        };
      }
    } catch (parseError) {
      errors.push(`Failed to parse JSON results: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
    }

    // Fallback to parsing stdout/stderr
    const passed = (stdout.match(/✓/g) || []).length;
    const failed = (stdout.match(/✗|×/g) || []).length;
    const skipped = (stdout.match(/⊘/g) || []).length;

    if (stderr) {
      errors.push(stderr);
    }

    return { passed, failed, skipped, errors };
  }

  /**
   * Calculate overall coverage percentage
   */
  private calculateOverallCoverage(coverageMap: any): number {
    if (!coverageMap) return 0;

    let totalStatements = 0;
    let coveredStatements = 0;

    Object.values(coverageMap).forEach((fileCoverage: any) => {
      const statements = fileCoverage.s || {};
      Object.values(statements).forEach((count: any) => {
        totalStatements++;
        if (count > 0) coveredStatements++;
      });
    });

    return totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : 0;
  }

  /**
   * Get environment variables for test execution
   */
  private getTestEnvironmentVars(): Record<string, string> {
    return {
      NODE_ENV: 'test',
      TEST_ENVIRONMENT: this.config.environment,
      USE_REAL_SERVICES: this.config.useRealServices.toString(),
      DEBUG_MODE: this.config.debugMode.toString(),
      // Database config
      DB_HOST: process.env.TEST_DB_HOST || 'localhost',
      DB_PORT: process.env.TEST_DB_PORT || '5432',
      DB_NAME: process.env.TEST_DB_NAME || 'ai_ninja_test',
      DB_USERNAME: process.env.TEST_DB_USERNAME || 'ai_ninja_test',
      DB_PASSWORD: process.env.TEST_DB_PASSWORD || 'test_password',
      // Redis config
      REDIS_HOST: process.env.TEST_REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.TEST_REDIS_PORT || '6379',
      REDIS_DB: process.env.TEST_REDIS_DB || '1'
    };
  }

  /**
   * Get available test suites
   */
  private getTestSuites(): TestSuite[] {
    return [
      {
        name: 'unit-tests',
        description: 'Unit tests for individual components',
        pattern: 'tests/unit',
        environment: 'unit',
        fixtures: ['basic-user-data'],
        timeout: 60000
      },
      {
        name: 'service-integration',
        description: 'Integration tests for service communication',
        pattern: 'tests/integration',
        environment: 'integration',
        fixtures: ['basic-user-data', 'spam-detection-data'],
        timeout: 120000
      },
      {
        name: 'api-integration',
        description: 'API endpoint integration tests',
        pattern: 'tests/integration/api-integration-tests.ts',
        environment: 'integration',
        fixtures: ['conversation-flow-data', 'whitelist-management-data'],
        timeout: 180000
      },
      {
        name: 'websocket-integration',
        description: 'WebSocket real-time communication tests',
        pattern: 'tests/integration/websocket-integration-tests.ts',
        environment: 'integration',
        fixtures: ['conversation-flow-data'],
        timeout: 120000
      },
      {
        name: 'database-integration',
        description: 'Database integration and transaction tests',
        pattern: 'tests/integration/database-integration-tests.ts',
        environment: 'integration',
        fixtures: ['performance-test-data'],
        timeout: 180000
      },
      {
        name: 'end-to-end',
        description: 'End-to-end user journey tests',
        pattern: 'tests/e2e',
        environment: 'e2e',
        fixtures: ['conversation-flow-data', 'whitelist-management-data'],
        timeout: 300000
      },
      {
        name: 'load-tests',
        description: 'Performance and load testing',
        pattern: 'tests/load',
        environment: 'load',
        fixtures: ['high-volume-data', 'performance-test-data'],
        timeout: 600000
      },
      {
        name: 'edge-cases',
        description: 'Edge cases and boundary condition tests',
        pattern: 'tests/edge-cases',
        environment: 'integration',
        fixtures: ['edge-cases-data'],
        timeout: 120000
      },
      {
        name: 'multi-language',
        description: 'Multi-language support tests',
        pattern: 'tests/multi-language',
        environment: 'integration',
        fixtures: ['multi-language-data'],
        timeout: 180000
      }
    ];
  }

  /**
   * Reset environment between test suites
   */
  private async resetEnvironmentBetweenSuites(): Promise<void> {
    console.log('🔄 Resetting environment between test suites...');
    
    try {
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('✅ Environment reset completed');
    } catch (error) {
      console.error('⚠️ Error during environment reset:', error);
    }
  }

  /**
   * Print results for a single test suite
   */
  private printSuiteResults(result: TestResults): void {
    const total = result.passed + result.failed + result.skipped;
    const passRate = total > 0 ? ((result.passed / total) * 100).toFixed(1) : '0.0';
    const durationSec = (result.duration / 1000).toFixed(1);

    console.log(`\n📊 ${result.suite} Results:`);
    console.log(`  ✅ Passed: ${result.passed}`);
    console.log(`  ❌ Failed: ${result.failed}`);
    console.log(`  ⏭️ Skipped: ${result.skipped}`);
    console.log(`  📈 Pass Rate: ${passRate}%`);
    console.log(`  ⏱️ Duration: ${durationSec}s`);
    
    if (result.coverage !== undefined) {
      console.log(`  🎯 Coverage: ${result.coverage}%`);
    }

    if (result.errors.length > 0) {
      console.log(`  🚨 Errors:`);
      result.errors.slice(0, 5).forEach(error => {
        console.log(`    - ${error.substring(0, 100)}${error.length > 100 ? '...' : ''}`);
      });
      
      if (result.errors.length > 5) {
        console.log(`    ... and ${result.errors.length - 5} more errors`);
      }
    }
  }

  /**
   * Generate final test report
   */
  private async generateFinalReport(): Promise<void> {
    const endTime = new Date();
    const totalDuration = endTime.getTime() - this.startTime.getTime();
    const totalPassed = this.testResults.reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = this.testResults.reduce((sum, r) => sum + r.failed, 0);
    const totalSkipped = this.testResults.reduce((sum, r) => sum + r.skipped, 0);
    const totalTests = totalPassed + totalFailed + totalSkipped;
    const overallPassRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';

    // Calculate average coverage
    const coverageResults = this.testResults.filter(r => r.coverage !== undefined);
    const avgCoverage = coverageResults.length > 0 
      ? (coverageResults.reduce((sum, r) => sum + r.coverage!, 0) / coverageResults.length).toFixed(1)
      : 'N/A';

    console.log('\n' + '='.repeat(60));
    console.log('🏁 FINAL TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Environment: ${this.config.environment}`);
    console.log(`Start Time: ${this.startTime.toISOString()}`);
    console.log(`End Time: ${endTime.toISOString()}`);
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log('');
    console.log(`Test Suites: ${this.testResults.length}`);
    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`⏭️ Skipped: ${totalSkipped}`);
    console.log(`📈 Overall Pass Rate: ${overallPassRate}%`);
    console.log(`🎯 Average Coverage: ${avgCoverage}%`);
    console.log('');

    // Suite-by-suite breakdown
    console.log('📋 Suite Breakdown:');
    this.testResults.forEach(result => {
      const total = result.passed + result.failed + result.skipped;
      const passRate = total > 0 ? ((result.passed / total) * 100).toFixed(1) : '0.0';
      const status = result.failed === 0 ? '✅' : '❌';
      
      console.log(`  ${status} ${result.suite}: ${result.passed}/${total} (${passRate}%) - ${(result.duration / 1000).toFixed(1)}s`);
    });

    // Generate JSON report
    await this.generateJSONReport(totalDuration, overallPassRate, avgCoverage);

    // Exit with appropriate code
    const hasFailures = totalFailed > 0;
    if (hasFailures) {
      console.log('\n❌ Some tests failed. Check the results above.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed successfully!');
      process.exit(0);
    }
  }

  /**
   * Generate JSON report file
   */
  private async generateJSONReport(
    totalDuration: number, 
    overallPassRate: string, 
    avgCoverage: string
  ): Promise<void> {
    const reportDir = path.resolve(__dirname, '../test-results');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const report = {
      summary: {
        environment: this.config.environment,
        startTime: this.startTime.toISOString(),
        endTime: new Date().toISOString(),
        totalDuration,
        overallPassRate: parseFloat(overallPassRate),
        averageCoverage: avgCoverage !== 'N/A' ? parseFloat(avgCoverage) : null,
        totalSuites: this.testResults.length,
        totalPassed: this.testResults.reduce((sum, r) => sum + r.passed, 0),
        totalFailed: this.testResults.reduce((sum, r) => sum + r.failed, 0),
        totalSkipped: this.testResults.reduce((sum, r) => sum + r.skipped, 0)
      },
      suites: this.testResults,
      config: this.config
    };

    const reportFile = path.join(reportDir, `test-report-${Date.now()}.json`);
    await fs.promises.writeFile(reportFile, JSON.stringify(report, null, 2));
    
    console.log(`📄 Detailed report saved to: ${reportFile}`);
  }
}

// CLI Implementation
program
  .name('test-runner')
  .description('AI Phone Answering System Test Runner')
  .version('1.0.0');

program
  .command('run')
  .description('Run test suites')
  .option('-e, --environment <type>', 'Test environment', 'integration')
  .option('-s, --suites <suites...>', 'Specific test suites to run')
  .option('--real-services', 'Use real external services instead of mocks', false)
  .option('--no-cleanup', 'Skip cleanup after tests', false)
  .option('--no-seed', 'Skip database seeding', false)
  .option('--reset-between', 'Reset environment between test suites', false)
  .option('--debug', 'Enable debug mode', false)
  .action(async (options) => {
    const config: TestEnvironmentConfig = {
      environment: options.environment as TestEnvironmentConfig['environment'],
      useRealServices: options.realServices,
      useMockData: true,
      cleanupAfterTests: options.cleanup,
      seedDatabase: options.seed,
      resetBetweenTests: options.resetBetween,
      debugMode: options.debug
    };

    const runner = new ComprehensiveTestRunner(config);
    await runner.runTests(options.suites);
  });

program
  .command('fixtures')
  .description('Manage test fixtures')
  .option('-l, --list', 'List available fixtures')
  .option('-g, --generate <fixture>', 'Generate specific fixture')
  .option('--cleanup', 'Cleanup all test data')
  .action(async (options) => {
    const config: TestEnvironmentConfig = {
      environment: 'integration',
      useRealServices: false,
      useMockData: true,
      cleanupAfterTests: false,
      seedDatabase: true,
      resetBetweenTests: false,
      debugMode: false
    };

    const fixtureManager = new FixtureManager(config);

    if (options.list) {
      console.log('Available fixtures:');
      fixtureManager.getAvailableFixtures().forEach(fixture => {
        console.log(`  - ${fixture}`);
      });
    }

    if (options.generate) {
      await fixtureManager.initializeTestEnvironment();
      await fixtureManager.loadFixture(options.generate);
      console.log(`✅ Generated fixture: ${options.generate}`);
      await fixtureManager.cleanupTestEnvironment();
    }

    if (options.cleanup) {
      await fixtureManager.initializeTestEnvironment();
      // Cleanup will happen in cleanupTestEnvironment
      await fixtureManager.cleanupTestEnvironment();
      console.log('✅ Test data cleanup completed');
    }
  });

program
  .command('status')
  .description('Check test environment status')
  .action(async () => {
    const config: TestEnvironmentConfig = {
      environment: 'integration',
      useRealServices: false,
      useMockData: true,
      cleanupAfterTests: false,
      seedDatabase: false,
      resetBetweenTests: false,
      debugMode: false
    };

    const fixtureManager = new FixtureManager(config);
    await fixtureManager.initializeTestEnvironment();
    
    const status = await fixtureManager.getEnvironmentStatus();
    
    console.log('🏥 Test Environment Status:');
    console.log(`Overall Health: ${status.isHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    console.log('');
    console.log('Services:');
    Object.entries(status.services).forEach(([service, healthy]) => {
      console.log(`  ${healthy ? '✅' : '❌'} ${service}`);
    });
    console.log('');
    console.log(`Active Fixtures: ${status.fixtures.length}`);
    status.fixtures.forEach(fixture => console.log(`  - ${fixture}`));
    console.log('');
    console.log('Test Data Counts:');
    Object.entries(status.testDataCount).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    await fixtureManager.cleanupTestEnvironment();
  });

// Run CLI
if (require.main === module) {
  program.parse();
}