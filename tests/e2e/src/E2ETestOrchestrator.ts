/**
 * E2E Test Orchestrator
 * 
 * Main orchestrator that coordinates all E2E testing components:
 * - Test suite discovery and planning
 * - Environment setup and validation
 * - Parallel test execution management
 * - Real-time monitoring and reporting
 * - Cleanup and resource management
 */

import { EventEmitter } from 'events';
import { TestApiClient, ServiceEndpoints } from './utils/TestApiClient';
import { TestDataFactory } from './fixtures/TestDataFactory';
import { ServiceHealthChecker } from './utils/ServiceHealthChecker';
import { TestReporter, TestSuite, TestResult } from './utils/TestReporter';
import { TestExecutor, TestJob } from './utils/TestExecutor';
import CallProcessingE2ETest from './scenarios/CallProcessingE2ETest';
import UserManagementE2ETest from './scenarios/UserManagementE2ETest';
import WhitelistManagementE2ETest from './scenarios/WhitelistManagementE2ETest';

export interface E2ETestConfig {
  services: ServiceEndpoints;
  environment: 'development' | 'staging' | 'production';
  testSuites: string[];
  execution: {
    parallel: boolean;
    maxConcurrency: number;
    timeout: number;
    retries: number;
  };
  reporting: {
    formats: Array<'html' | 'json' | 'junit' | 'csv'>;
    outputDir: string;
    realtime: boolean;
  };
  cleanup: {
    onSuccess: boolean;
    onFailure: boolean;
    aggressive: boolean;
  };
  notifications: {
    slack?: { webhook: string };
    email?: { recipients: string[] };
    teams?: { webhook: string };
  };
}

export interface E2EExecutionPlan {
  totalSuites: number;
  totalTests: number;
  estimatedDuration: number;
  dependencies: string[];
  resourceRequirements: {
    memory: number;
    cpu: number;
    network: boolean;
    storage: number;
  };
  executionOrder: string[];
}

export interface E2EExecutionResult {
  success: boolean;
  duration: number;
  startTime: string;
  endTime: string;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  };
  suiteResults: Map<string, TestSuite>;
  performanceMetrics: {
    averageResponseTime: number;
    throughput: number;
    errorRate: number;
  };
  coverageMetrics: {
    endpointCoverage: number;
    serviceCoverage: number;
  };
  reportFiles: string[];
  issues: Issue[];
}

export interface Issue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'performance' | 'functionality' | 'reliability' | 'security';
  title: string;
  description: string;
  testCase: string;
  recommendation?: string;
}

export class E2ETestOrchestrator extends EventEmitter {
  private config: E2ETestConfig;
  private apiClient: TestApiClient;
  private dataFactory: TestDataFactory;
  private healthChecker: ServiceHealthChecker;
  private reporter: TestReporter;
  private executor: TestExecutor;
  private testSuites: Map<string, any> = new Map();

  constructor(config: E2ETestConfig) {
    super();
    this.config = config;

    // Initialize components
    this.apiClient = new TestApiClient(config.services, {
      timeout: config.execution.timeout,
      retries: { max: config.execution.retries, delay: 1000, factor: 2 }
    });

    this.dataFactory = new TestDataFactory();
    
    this.healthChecker = new ServiceHealthChecker(this.apiClient, {
      timeout: 10000,
      startupTimeout: 120000
    });

    this.reporter = new TestReporter({
      outputDir: config.reporting.outputDir,
      formats: config.reporting.formats,
      realtime: { enabled: config.reporting.realtime, websocketPort: 8080 }
    });

    this.executor = new TestExecutor({
      maxConcurrency: config.execution.maxConcurrency,
      isolationLevel: 'data',
      timeouts: {
        testTimeout: config.execution.timeout,
        setupTimeout: 60000,
        teardownTimeout: 30000
      }
    });

    this.initializeTestSuites();
    this.setupEventHandlers();
  }

  /**
   * Plan E2E test execution
   */
  async planExecution(): Promise<E2EExecutionPlan> {
    console.log('📋 Planning E2E test execution...');

    const availableSuites = Array.from(this.testSuites.keys());
    const requestedSuites = this.config.testSuites.length > 0 
      ? this.config.testSuites 
      : availableSuites;

    // Validate requested suites exist
    const invalidSuites = requestedSuites.filter(suite => !availableSuites.includes(suite));
    if (invalidSuites.length > 0) {
      throw new Error(`Invalid test suites: ${invalidSuites.join(', ')}`);
    }

    // Estimate test counts and duration
    let totalTests = 0;
    let estimatedDuration = 0;
    const executionOrder: string[] = [];

    // Define suite dependencies and execution order
    const suiteDependencies: { [key: string]: string[] } = {
      'UserManagement': [],
      'WhitelistManagement': ['UserManagement'],
      'CallProcessing': ['UserManagement', 'WhitelistManagement']
    };

    // Sort by dependencies
    const sortedSuites = this.topologicalSort(requestedSuites, suiteDependencies);

    for (const suiteName of sortedSuites) {
      const suite = this.testSuites.get(suiteName);
      if (suite) {
        // Estimate based on suite type (simplified)
        const suiteTestCount = this.estimateTestCount(suiteName);
        const suiteDuration = this.estimateDuration(suiteName);
        
        totalTests += suiteTestCount;
        estimatedDuration += suiteDuration;
        executionOrder.push(suiteName);
      }
    }

    // Account for parallel execution
    if (this.config.execution.parallel) {
      estimatedDuration = estimatedDuration / Math.min(this.config.execution.maxConcurrency, requestedSuites.length);
    }

    const plan: E2EExecutionPlan = {
      totalSuites: requestedSuites.length,
      totalTests,
      estimatedDuration: Math.round(estimatedDuration),
      dependencies: Object.keys(suiteDependencies).filter(dep => 
        requestedSuites.some(suite => suiteDependencies[suite]?.includes(dep))
      ),
      resourceRequirements: {
        memory: 512 * this.config.execution.maxConcurrency, // MB per worker
        cpu: 25 * this.config.execution.maxConcurrency, // % per worker
        network: true,
        storage: 100 // MB for test data and reports
      },
      executionOrder
    };

    this.emit('execution_planned', plan);
    return plan;
  }

  /**
   * Execute E2E tests according to plan
   */
  async executeTests(): Promise<E2EExecutionResult> {
    const startTime = new Date();
    console.log(`🚀 Starting E2E test execution at ${startTime.toISOString()}`);

    try {
      // Phase 1: Pre-execution validation
      await this.preExecutionValidation();

      // Phase 2: Execute test suites
      const suiteResults = await this.executeTestSuites();

      // Phase 3: Generate reports and analysis
      const reportFiles = await this.generateReports();

      // Phase 4: Post-execution cleanup
      await this.postExecutionCleanup(true);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const result = this.buildExecutionResult(
        true, startTime, endTime, duration, suiteResults, reportFiles
      );

      this.emit('execution_completed', result);
      
      // Send notifications
      await this.sendNotifications(result);

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      console.error('❌ E2E test execution failed:', error);

      // Attempt to generate partial reports
      let reportFiles: string[] = [];
      try {
        const partialReport = await this.reporter.generateReport();
        reportFiles = partialReport.reportFiles;
      } catch (reportError) {
        console.error('Failed to generate error report:', reportError);
      }

      // Cleanup on failure
      await this.postExecutionCleanup(false);

      const result = this.buildExecutionResult(
        false, startTime, endTime, duration, new Map(), reportFiles, error as Error
      );

      this.emit('execution_failed', result);
      await this.sendNotifications(result);

      throw error;
    }
  }

  /**
   * Real-time execution monitoring
   */
  startRealTimeMonitoring(): void {
    const monitoringInterval = setInterval(async () => {
      const stats = this.executor.getExecutionStats();
      const healthReport = await this.healthChecker.generateHealthReport();

      this.emit('real_time_update', {
        timestamp: new Date().toISOString(),
        execution: stats,
        health: healthReport,
        reporter: this.reporter.getCurrentStats()
      });
    }, 5000); // Update every 5 seconds

    this.on('execution_completed', () => clearInterval(monitoringInterval));
    this.on('execution_failed', () => clearInterval(monitoringInterval));
  }

  /**
   * Stop execution gracefully
   */
  async stopExecution(reason: string = 'User requested stop'): Promise<void> {
    console.log(`🛑 Stopping E2E test execution: ${reason}`);
    
    this.emit('execution_stopping', { reason });

    // Cancel ongoing executions
    await this.executor.cancelExecution(reason);

    // Cleanup
    await this.postExecutionCleanup(false);

    this.emit('execution_stopped', { reason });
  }

  // Private methods

  private initializeTestSuites(): void {
    this.testSuites.set('CallProcessing', CallProcessingE2ETest);
    this.testSuites.set('UserManagement', UserManagementE2ETest);
    this.testSuites.set('WhitelistManagement', WhitelistManagementE2ETest);
  }

  private setupEventHandlers(): void {
    // Executor events
    this.executor.on('job_started', (data) => {
      this.emit('test_started', data);
    });

    this.executor.on('job_completed', (data) => {
      this.emit('test_completed', data);
    });

    this.executor.on('job_failed', (data) => {
      this.emit('test_failed', data);
    });

    // Health checker events
    this.healthChecker.on('service_unhealthy', (data) => {
      this.emit('service_issue', data);
    });

    // Reporter events
    this.reporter.on('report_generated', (data) => {
      this.emit('report_ready', data);
    });
  }

  private async preExecutionValidation(): Promise<void> {
    console.log('🔍 Performing pre-execution validation...');

    // Check service health
    const healthResult = await this.healthChecker.waitForServicesReady(60000);
    if (!healthResult.success) {
      throw new Error(`Services not ready: ${healthResult.unhealthyServices.join(', ')}`);
    }

    // Validate API client connectivity
    const apiHealth = await this.apiClient.healthCheck();
    const unhealthyApis = Object.entries(apiHealth)
      .filter(([_, health]) => !health.healthy)
      .map(([service, _]) => service);

    if (unhealthyApis.length > 0) {
      throw new Error(`API connectivity issues: ${unhealthyApis.join(', ')}`);
    }

    // Validate test data factory
    try {
      const testUser = this.dataFactory.createTestUser();
      if (!testUser.phone_number || !testUser.name) {
        throw new Error('Test data factory validation failed');
      }
    } catch (error) {
      throw new Error(`Test data factory validation failed: ${error}`);
    }

    console.log('✅ Pre-execution validation passed');
    this.emit('validation_completed', { 
      healthyServices: healthResult.healthyServices.length,
      healthyApis: Object.keys(apiHealth).length - unhealthyApis.length
    });
  }

  private async executeTestSuites(): Promise<Map<string, TestSuite>> {
    console.log('🏃 Executing test suites...');

    const plan = await this.planExecution();
    const suiteResults = new Map<string, TestSuite>();

    if (this.config.execution.parallel) {
      // Parallel execution
      const jobs = this.createParallelJobs(plan.executionOrder);
      await this.executor.queueJobs(jobs);
      const results = await this.executor.executeJobs();
      
      // Convert results to test suites
      for (const [jobId, result] of results) {
        const suiteName = jobId.split('_')[0];
        const suite = this.convertToTestSuite(suiteName, result);
        suiteResults.set(suiteName, suite);
        await this.reporter.addTestSuite(suite);
      }
    } else {
      // Sequential execution
      for (const suiteName of plan.executionOrder) {
        console.log(`📝 Executing ${suiteName} test suite...`);
        
        const suiteStart = performance.now();
        const suite = await this.executeSingleSuite(suiteName);
        const suiteDuration = performance.now() - suiteStart;
        
        suite.duration = suiteDuration;
        suiteResults.set(suiteName, suite);
        
        await this.reporter.addTestSuite(suite);
        
        console.log(`✅ ${suiteName} completed: ${suite.tests.filter(t => t.status === 'passed').length}/${suite.tests.length} passed`);
      }
    }

    return suiteResults;
  }

  private async executeSingleSuite(suiteName: string): Promise<TestSuite> {
    const SuiteClass = this.testSuites.get(suiteName);
    if (!SuiteClass) {
      throw new Error(`Test suite not found: ${suiteName}`);
    }

    const suiteInstance = new SuiteClass(this.apiClient);
    const startTime = performance.now();

    try {
      const results = await suiteInstance.runAllTests();
      const endTime = performance.now();

      const tests: TestResult[] = results.results.map((result: any) => ({
        name: result.testName,
        category: suiteName,
        status: result.passed ? 'passed' : 'failed',
        duration: result.duration,
        error: result.error,
        metrics: result.metrics
      }));

      return {
        name: suiteName,
        category: 'E2E',
        startTime,
        endTime,
        duration: endTime - startTime,
        tests,
        passed: tests.every(t => t.status === 'passed'),
        metrics: {
          totalTests: tests.length,
          passedTests: tests.filter(t => t.status === 'passed').length,
          failedTests: tests.filter(t => t.status === 'failed').length,
          skippedTests: tests.filter(t => t.status === 'skipped').length,
          passRate: (tests.filter(t => t.status === 'passed').length / tests.length) * 100,
          averageDuration: tests.reduce((sum, t) => sum + t.duration, 0) / tests.length,
          performance: {
            averageResponseTime: results.summary.averageLatency || 0,
            maxResponseTime: 0,
            minResponseTime: 0,
            p95ResponseTime: 0,
            throughput: 0,
            errorRate: 0,
            slaCompliance: {}
          },
          coverage: {
            endpoints: [],
            services: [],
            scenarios: [],
            overall: {
              endpointCoverage: 0,
              serviceCoverage: 0,
              scenarioCoverage: 0
            }
          }
        }
      };
    } catch (error) {
      const endTime = performance.now();
      
      return {
        name: suiteName,
        category: 'E2E',
        startTime,
        endTime,
        duration: endTime - startTime,
        tests: [{
          name: `${suiteName} Suite Execution`,
          category: suiteName,
          status: 'failed',
          duration: endTime - startTime,
          error: error instanceof Error ? error.message : String(error)
        }],
        passed: false,
        metrics: {
          totalTests: 1,
          passedTests: 0,
          failedTests: 1,
          skippedTests: 0,
          passRate: 0,
          averageDuration: endTime - startTime,
          performance: {
            averageResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: 0,
            p95ResponseTime: 0,
            throughput: 0,
            errorRate: 1,
            slaCompliance: {}
          },
          coverage: {
            endpoints: [],
            services: [],
            scenarios: [],
            overall: {
              endpointCoverage: 0,
              serviceCoverage: 0,
              scenarioCoverage: 0
            }
          }
        }
      };
    }
  }

  private createParallelJobs(suites: string[]): TestJob[] {
    return suites.map((suiteName, index) => ({
      id: `${suiteName}_${Date.now()}_${index}`,
      name: `${suiteName} E2E Test Suite`,
      category: 'E2E',
      testFunction: `
        return async function(data) {
          const { suiteName, apiClient } = data;
          const SuiteClass = testSuites.get(suiteName);
          const instance = new SuiteClass(apiClient);
          return await instance.runAllTests();
        };
      `,
      priority: 1,
      dependencies: this.getSuiteDependencies(suiteName),
      tags: ['e2e', suiteName.toLowerCase()],
      estimatedDuration: this.estimateDuration(suiteName),
      resources: {
        memory: 128,
        cpu: 25,
        network: true,
        database: true
      },
      isolation: {
        dataIsolation: true,
        serviceIsolation: false,
        networkIsolation: false,
        temporalIsolation: true,
        cleanupLevel: 'standard'
      },
      data: { suiteName, apiClient: this.apiClient }
    }));
  }

  private async generateReports(): Promise<string[]> {
    console.log('📊 Generating test reports...');
    
    const reportResult = await this.reporter.generateReport();
    
    console.log('📋 Reports generated:');
    reportResult.reportFiles.forEach(file => console.log(`  - ${file}`));
    
    return reportResult.reportFiles;
  }

  private async postExecutionCleanup(success: boolean): Promise<void> {
    console.log('🧹 Performing post-execution cleanup...');

    try {
      // Cleanup test data
      if (this.config.cleanup.onSuccess && success || this.config.cleanup.onFailure && !success) {
        this.dataFactory.cleanup();
      }

      // Shutdown executor
      await this.executor.shutdown();

      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('⚠️ Cleanup failed:', error);
    }
  }

  private buildExecutionResult(
    success: boolean,
    startTime: Date,
    endTime: Date,
    duration: number,
    suiteResults: Map<string, TestSuite>,
    reportFiles: string[],
    error?: Error
  ): E2EExecutionResult {
    const allTests = Array.from(suiteResults.values()).flatMap(suite => suite.tests);
    
    return {
      success,
      duration,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      summary: {
        totalTests: allTests.length,
        passed: allTests.filter(t => t.status === 'passed').length,
        failed: allTests.filter(t => t.status === 'failed').length,
        skipped: allTests.filter(t => t.status === 'skipped').length,
        passRate: allTests.length > 0 ? (allTests.filter(t => t.status === 'passed').length / allTests.length) * 100 : 0
      },
      suiteResults,
      performanceMetrics: {
        averageResponseTime: this.calculateAverageResponseTime(suiteResults),
        throughput: this.calculateThroughput(allTests, duration),
        errorRate: allTests.length > 0 ? allTests.filter(t => t.status === 'failed').length / allTests.length : 0
      },
      coverageMetrics: {
        endpointCoverage: 0, // Would be calculated from actual coverage data
        serviceCoverage: 0
      },
      reportFiles,
      issues: this.analyzeIssues(suiteResults, error)
    };
  }

  private async sendNotifications(result: E2EExecutionResult): Promise<void> {
    if (!this.config.notifications) return;

    const message = this.buildNotificationMessage(result);

    try {
      // Slack notification
      if (this.config.notifications.slack) {
        await this.sendSlackNotification(this.config.notifications.slack.webhook, message);
      }

      // Email notification  
      if (this.config.notifications.email) {
        await this.sendEmailNotification(this.config.notifications.email.recipients, message);
      }

      // Teams notification
      if (this.config.notifications.teams) {
        await this.sendTeamsNotification(this.config.notifications.teams.webhook, message);
      }
    } catch (error) {
      console.error('Failed to send notifications:', error);
    }
  }

  // Helper methods
  private topologicalSort(suites: string[], dependencies: { [key: string]: string[] }): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (suite: string) => {
      if (visited.has(suite)) return;
      visited.add(suite);
      
      const deps = dependencies[suite] || [];
      deps.forEach(dep => {
        if (suites.includes(dep)) {
          visit(dep);
        }
      });
      
      result.push(suite);
    };

    suites.forEach(visit);
    return result;
  }

  private estimateTestCount(suiteName: string): number {
    const estimates: { [key: string]: number } = {
      'CallProcessing': 5,
      'UserManagement': 3,
      'WhitelistManagement': 4
    };
    return estimates[suiteName] || 3;
  }

  private estimateDuration(suiteName: string): number {
    const estimates: { [key: string]: number } = {
      'CallProcessing': 180000, // 3 minutes
      'UserManagement': 120000, // 2 minutes  
      'WhitelistManagement': 150000 // 2.5 minutes
    };
    return estimates[suiteName] || 120000;
  }

  private getSuiteDependencies(suiteName: string): string[] {
    const dependencies: { [key: string]: string[] } = {
      'CallProcessing': ['UserManagement', 'WhitelistManagement'],
      'WhitelistManagement': ['UserManagement'],
      'UserManagement': []
    };
    return dependencies[suiteName] || [];
  }

  private convertToTestSuite(suiteName: string, result: any): TestSuite {
    // Convert execution result to test suite format
    return {
      name: suiteName,
      category: 'E2E',
      startTime: result.startTime,
      endTime: result.endTime,
      duration: result.duration,
      tests: [{
        name: suiteName,
        category: 'E2E',
        status: result.status === 'passed' ? 'passed' : 'failed',
        duration: result.duration,
        error: result.error,
        metrics: result.metrics
      }],
      passed: result.status === 'passed',
      metrics: {
        totalTests: 1,
        passedTests: result.status === 'passed' ? 1 : 0,
        failedTests: result.status === 'failed' ? 1 : 0,
        skippedTests: 0,
        passRate: result.status === 'passed' ? 100 : 0,
        averageDuration: result.duration,
        performance: {
          averageResponseTime: 0,
          maxResponseTime: 0,
          minResponseTime: 0,
          p95ResponseTime: 0,
          throughput: 0,
          errorRate: result.status === 'failed' ? 1 : 0,
          slaCompliance: {}
        },
        coverage: {
          endpoints: [],
          services: [],
          scenarios: [],
          overall: {
            endpointCoverage: 0,
            serviceCoverage: 0,
            scenarioCoverage: 0
          }
        }
      }
    };
  }

  private calculateAverageResponseTime(suites: Map<string, TestSuite>): number {
    let totalTime = 0;
    let totalTests = 0;

    suites.forEach(suite => {
      suite.tests.forEach(test => {
        if (test.metrics?.responseTime) {
          totalTime += test.metrics.responseTime;
          totalTests++;
        }
      });
    });

    return totalTests > 0 ? totalTime / totalTests : 0;
  }

  private calculateThroughput(tests: TestResult[], duration: number): number {
    return duration > 0 ? (tests.length / duration) * 1000 : 0; // tests per second
  }

  private analyzeIssues(suites: Map<string, TestSuite>, error?: Error): Issue[] {
    const issues: Issue[] = [];

    // Check for failed tests
    suites.forEach(suite => {
      suite.tests.filter(t => t.status === 'failed').forEach(test => {
        issues.push({
          severity: 'high',
          category: 'functionality',
          title: `Test Failed: ${test.name}`,
          description: test.error || 'Test failed without specific error',
          testCase: `${suite.name}.${test.name}`,
          recommendation: 'Review test logs and fix the underlying issue'
        });
      });
    });

    // Check for performance issues
    suites.forEach(suite => {
      if (suite.metrics.performance.averageResponseTime > 2000) {
        issues.push({
          severity: 'medium',
          category: 'performance',
          title: `Slow Response Times in ${suite.name}`,
          description: `Average response time: ${suite.metrics.performance.averageResponseTime}ms`,
          testCase: suite.name,
          recommendation: 'Investigate and optimize slow endpoints'
        });
      }
    });

    // Add execution-level error if present
    if (error) {
      issues.push({
        severity: 'critical',
        category: 'reliability',
        title: 'Test Execution Failed',
        description: error.message,
        testCase: 'Execution',
        recommendation: 'Fix execution environment or test configuration issues'
      });
    }

    return issues;
  }

  private buildNotificationMessage(result: E2EExecutionResult): any {
    const status = result.success ? '✅ PASSED' : '❌ FAILED';
    const passRate = result.summary.passRate.toFixed(1);
    
    return {
      title: `E2E Tests ${status}`,
      summary: `Pass Rate: ${passRate}% (${result.summary.passed}/${result.summary.totalTests})`,
      duration: `Duration: ${Math.round(result.duration / 1000)}s`,
      environment: this.config.environment,
      timestamp: result.endTime,
      reportUrl: result.reportFiles.length > 0 ? result.reportFiles[0] : null,
      issues: result.issues.filter(i => i.severity === 'critical' || i.severity === 'high')
    };
  }

  private async sendSlackNotification(webhook: string, message: any): Promise<void> {
    // Implementation would send Slack notification
    console.log('📱 Slack notification sent');
  }

  private async sendEmailNotification(recipients: string[], message: any): Promise<void> {
    // Implementation would send email notification
    console.log('📧 Email notification sent');
  }

  private async sendTeamsNotification(webhook: string, message: any): Promise<void> {
    // Implementation would send Teams notification
    console.log('💬 Teams notification sent');
  }
}

export default E2ETestOrchestrator;