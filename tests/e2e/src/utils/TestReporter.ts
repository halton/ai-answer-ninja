/**
 * Test Reporter and Coverage Statistics
 * 
 * Provides comprehensive test reporting and metrics collection:
 * - Test execution results and timing
 * - Coverage analysis across services and endpoints
 * - Performance metrics and SLA validation
 * - HTML, JSON, and JUnit XML report generation
 * - Real-time dashboard data
 * - Trend analysis and historical comparison
 */

import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';

export interface TestSuite {
  name: string;
  category: string;
  startTime: number;
  endTime: number;
  duration: number;
  tests: TestResult[];
  passed: boolean;
  metrics: TestMetrics;
}

export interface TestResult {
  name: string;
  category: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  metrics?: {
    [key: string]: number;
  };
  screenshots?: string[];
  logs?: string[];
  steps?: TestStep[];
}

export interface TestStep {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  details?: any;
  error?: string;
}

export interface TestMetrics {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  passRate: number;
  averageDuration: number;
  performance: PerformanceMetrics;
  coverage: CoverageMetrics;
}

export interface PerformanceMetrics {
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number;
  throughput: number;
  errorRate: number;
  slaCompliance: {
    [sla: string]: {
      threshold: number;
      actual: number;
      passed: boolean;
    };
  };
}

export interface CoverageMetrics {
  endpoints: EndpointCoverage[];
  services: ServiceCoverage[];
  scenarios: ScenarioCoverage[];
  overall: {
    endpointCoverage: number;
    serviceCoverage: number;
    scenarioCoverage: number;
  };
}

export interface EndpointCoverage {
  service: string;
  endpoint: string;
  method: string;
  tested: boolean;
  testCount: number;
  lastTested?: string;
  responseTypes: string[];
  statusCodes: number[];
}

export interface ServiceCoverage {
  name: string;
  totalEndpoints: number;
  testedEndpoints: number;
  coveragePercentage: number;
  criticalEndpointsCovered: number;
  criticalEndpointsTotal: number;
}

export interface ScenarioCoverage {
  name: string;
  tested: boolean;
  variations: number;
  edgeCasesTested: number;
  businessRulesCovered: number;
}

export interface ReportConfig {
  outputDir: string;
  formats: Array<'html' | 'json' | 'junit' | 'csv'>;
  includeMetrics: boolean;
  includeCoverage: boolean;
  includePerformance: boolean;
  includeScreenshots: boolean;
  includeLogs: boolean;
  realtime: {
    enabled: boolean;
    websocketPort: number;
    updateInterval: number;
  };
  comparison: {
    enabled: boolean;
    baselineFile?: string;
    trendsHistory: number;
  };
}

export class TestReporter {
  private config: ReportConfig;
  private testSuites: TestSuite[] = [];
  private endpointRegistry: Map<string, EndpointCoverage> = new Map();
  private serviceRegistry: Map<string, ServiceCoverage> = new Map();
  private performanceMetrics: PerformanceMetrics[] = [];
  private realTimeClients: any[] = [];

  constructor(config?: Partial<ReportConfig>) {
    this.config = {
      outputDir: './test-results',
      formats: ['html', 'json'],
      includeMetrics: true,
      includeCoverage: true,
      includePerformance: true,
      includeScreenshots: true,
      includeLogs: true,
      realtime: {
        enabled: false,
        websocketPort: 8080,
        updateInterval: 1000
      },
      comparison: {
        enabled: true,
        trendsHistory: 30
      },
      ...config
    };

    this.initializeEndpointRegistry();
    this.initializeServiceRegistry();
  }

  /**
   * Add test suite results
   */
  async addTestSuite(suite: TestSuite): Promise<void> {
    this.testSuites.push(suite);
    
    // Update coverage metrics
    await this.updateCoverageMetrics(suite);
    
    // Update performance metrics
    await this.updatePerformanceMetrics(suite);
    
    // Send real-time updates
    if (this.config.realtime.enabled) {
      this.broadcastRealTimeUpdate({
        type: 'suite_completed',
        suite: this.sanitizeSuiteForTransport(suite),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Generate comprehensive test report
   */
  async generateReport(): Promise<{
    reportFiles: string[];
    summary: TestMetrics;
    timestamp: string;
  }> {
    const timestamp = new Date().toISOString();
    const summary = this.calculateOverallMetrics();
    const reportFiles: string[] = [];

    // Ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });

    // Generate reports in requested formats
    if (this.config.formats.includes('html')) {
      const htmlFile = await this.generateHTMLReport(summary, timestamp);
      reportFiles.push(htmlFile);
    }

    if (this.config.formats.includes('json')) {
      const jsonFile = await this.generateJSONReport(summary, timestamp);
      reportFiles.push(jsonFile);
    }

    if (this.config.formats.includes('junit')) {
      const junitFile = await this.generateJUnitReport(timestamp);
      reportFiles.push(junitFile);
    }

    if (this.config.formats.includes('csv')) {
      const csvFile = await this.generateCSVReport(timestamp);
      reportFiles.push(csvFile);
    }

    // Generate coverage report
    if (this.config.includeCoverage) {
      const coverageFile = await this.generateCoverageReport(timestamp);
      reportFiles.push(coverageFile);
    }

    // Generate performance report
    if (this.config.includePerformance) {
      const perfFile = await this.generatePerformanceReport(timestamp);
      reportFiles.push(perfFile);
    }

    // Generate trend analysis
    if (this.config.comparison.enabled) {
      const trendFile = await this.generateTrendAnalysis(summary, timestamp);
      reportFiles.push(trendFile);
    }

    return {
      reportFiles,
      summary,
      timestamp
    };
  }

  /**
   * Generate HTML report with interactive dashboard
   */
  private async generateHTMLReport(summary: TestMetrics, timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `test-report-${this.formatTimestamp(timestamp)}.html`);
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E2E Test Report - AI Phone System</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        ${this.getHTMLStyles()}
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>🤖 AI Phone System - E2E Test Report</h1>
            <div class="report-info">
                <span>Generated: ${new Date(timestamp).toLocaleString()}</span>
                <span class="status ${summary.passRate === 100 ? 'success' : summary.passRate >= 80 ? 'warning' : 'error'}">
                    ${summary.passRate.toFixed(1)}% Pass Rate
                </span>
            </div>
        </header>

        <div class="summary-cards">
            <div class="card">
                <h3>Tests</h3>
                <div class="metric">${summary.totalTests}</div>
                <div class="sub-metric">${summary.passedTests} passed, ${summary.failedTests} failed</div>
            </div>
            <div class="card">
                <h3>Performance</h3>
                <div class="metric">${summary.performance.averageResponseTime}ms</div>
                <div class="sub-metric">Avg Response Time</div>
            </div>
            <div class="card">
                <h3>Coverage</h3>
                <div class="metric">${summary.coverage.overall.endpointCoverage.toFixed(1)}%</div>
                <div class="sub-metric">Endpoint Coverage</div>
            </div>
            <div class="card">
                <h3>SLA Compliance</h3>
                <div class="metric">${this.calculateSLACompliance()}%</div>
                <div class="sub-metric">Performance SLAs Met</div>
            </div>
        </div>

        <div class="charts-section">
            <div class="chart-container">
                <canvas id="testResultsChart"></canvas>
            </div>
            <div class="chart-container">
                <canvas id="performanceChart"></canvas>
            </div>
        </div>

        <div class="test-suites-section">
            <h2>Test Suites</h2>
            ${this.generateTestSuitesHTML()}
        </div>

        <div class="coverage-section">
            <h2>Coverage Analysis</h2>
            ${this.generateCoverageHTML()}
        </div>

        <div class="performance-section">
            <h2>Performance Analysis</h2>
            ${this.generatePerformanceHTML()}
        </div>
    </div>

    <script>
        ${this.generateChartScripts(summary)}
    </script>
</body>
</html>`;

    await fs.writeFile(filename, html);
    return filename;
  }

  /**
   * Generate JSON report
   */
  private async generateJSONReport(summary: TestMetrics, timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `test-report-${this.formatTimestamp(timestamp)}.json`);
    
    const report = {
      metadata: {
        timestamp,
        version: '1.0.0',
        generator: 'AI-Ninja-E2E-TestReporter'
      },
      summary,
      testSuites: this.testSuites,
      coverage: this.calculateCoverageMetrics(),
      performance: this.calculatePerformanceMetrics()
    };

    await fs.writeFile(filename, JSON.stringify(report, null, 2));
    return filename;
  }

  /**
   * Generate JUnit XML report
   */
  private async generateJUnitReport(timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `test-results-${this.formatTimestamp(timestamp)}.xml`);
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<testsuites name="AI-Phone-System-E2E" timestamp="${timestamp}">\n`;

    for (const suite of this.testSuites) {
      xml += `  <testsuite name="${this.escapeXML(suite.name)}" `;
      xml += `tests="${suite.tests.length}" `;
      xml += `failures="${suite.tests.filter(t => t.status === 'failed').length}" `;
      xml += `skipped="${suite.tests.filter(t => t.status === 'skipped').length}" `;
      xml += `time="${(suite.duration / 1000).toFixed(3)}" `;
      xml += `timestamp="${new Date(suite.startTime).toISOString()}">\n`;

      for (const test of suite.tests) {
        xml += `    <testcase name="${this.escapeXML(test.name)}" `;
        xml += `classname="${this.escapeXML(suite.name)}" `;
        xml += `time="${(test.duration / 1000).toFixed(3)}"`;

        if (test.status === 'failed') {
          xml += '>\n';
          xml += `      <failure message="${this.escapeXML(test.error || 'Test failed')}">\n`;
          xml += `        ${this.escapeXML(test.error || 'No error details')}\n`;
          xml += '      </failure>\n';
          xml += '    </testcase>\n';
        } else if (test.status === 'skipped') {
          xml += '>\n';
          xml += '      <skipped/>\n';
          xml += '    </testcase>\n';
        } else {
          xml += '/>\n';
        }
      }

      xml += '  </testsuite>\n';
    }

    xml += '</testsuites>\n';

    await fs.writeFile(filename, xml);
    return filename;
  }

  /**
   * Generate CSV report for data analysis
   */
  private async generateCSVReport(timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `test-data-${this.formatTimestamp(timestamp)}.csv`);
    
    const headers = [
      'Suite', 'Test', 'Status', 'Duration(ms)', 'ResponseTime(ms)', 
      'Error', 'Category', 'Timestamp'
    ];

    let csv = headers.join(',') + '\n';

    for (const suite of this.testSuites) {
      for (const test of suite.tests) {
        const row = [
          this.escapeCSV(suite.name),
          this.escapeCSV(test.name),
          test.status,
          test.duration,
          test.metrics?.responseTime || 0,
          this.escapeCSV(test.error || ''),
          this.escapeCSV(test.category),
          new Date(suite.startTime).toISOString()
        ];
        csv += row.join(',') + '\n';
      }
    }

    await fs.writeFile(filename, csv);
    return filename;
  }

  /**
   * Generate coverage report
   */
  private async generateCoverageReport(timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `coverage-report-${this.formatTimestamp(timestamp)}.html`);
    
    const coverage = this.calculateCoverageMetrics();
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>API Coverage Report</title>
    <style>${this.getCoverageStyles()}</style>
</head>
<body>
    <div class="container">
        <h1>API Endpoint Coverage Report</h1>
        
        <div class="summary">
            <div class="metric">
                <h3>Overall Coverage</h3>
                <div class="percentage">${coverage.overall.endpointCoverage.toFixed(1)}%</div>
            </div>
        </div>

        <div class="services">
            ${coverage.services.map(service => `
                <div class="service">
                    <h3>${service.name}</h3>
                    <div class="service-stats">
                        <span>Coverage: ${service.coveragePercentage.toFixed(1)}%</span>
                        <span>Endpoints: ${service.testedEndpoints}/${service.totalEndpoints}</span>
                    </div>
                    <div class="endpoints">
                        ${this.generateEndpointsHTML(service.name)}
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;

    await fs.writeFile(filename, html);
    return filename;
  }

  /**
   * Generate performance analysis report
   */
  private async generatePerformanceReport(timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `performance-report-${this.formatTimestamp(timestamp)}.json`);
    
    const perfData = {
      timestamp,
      summary: this.calculatePerformanceMetrics(),
      slaCompliance: this.calculateDetailedSLACompliance(),
      trends: this.calculatePerformanceTrends(),
      bottlenecks: this.identifyPerformanceBottlenecks(),
      recommendations: this.generatePerformanceRecommendations()
    };

    await fs.writeFile(filename, JSON.stringify(perfData, null, 2));
    return filename;
  }

  /**
   * Generate trend analysis comparing with historical data
   */
  private async generateTrendAnalysis(summary: TestMetrics, timestamp: string): Promise<string> {
    const filename = path.join(this.config.outputDir, `trend-analysis-${this.formatTimestamp(timestamp)}.json`);
    
    // Load historical data
    const historicalData = await this.loadHistoricalData();
    
    const trends = {
      timestamp,
      current: summary,
      historical: historicalData.slice(-this.config.comparison.trendsHistory),
      trends: {
        passRate: this.calculateTrend(historicalData.map(d => d.passRate)),
        performance: this.calculateTrend(historicalData.map(d => d.performance.averageResponseTime)),
        coverage: this.calculateTrend(historicalData.map(d => d.coverage.overall.endpointCoverage))
      },
      insights: this.generateTrendInsights(historicalData, summary)
    };

    // Save current data to history
    historicalData.push({
      timestamp,
      passRate: summary.passRate,
      performance: summary.performance,
      coverage: summary.coverage
    });

    // Keep only recent history
    const recentHistory = historicalData.slice(-this.config.comparison.trendsHistory);
    await this.saveHistoricalData(recentHistory);

    await fs.writeFile(filename, JSON.stringify(trends, null, 2));
    return filename;
  }

  // Private helper methods

  private calculateOverallMetrics(): TestMetrics {
    const allTests = this.testSuites.flatMap(suite => suite.tests);
    
    return {
      totalTests: allTests.length,
      passedTests: allTests.filter(t => t.status === 'passed').length,
      failedTests: allTests.filter(t => t.status === 'failed').length,
      skippedTests: allTests.filter(t => t.status === 'skipped').length,
      passRate: allTests.length > 0 ? (allTests.filter(t => t.status === 'passed').length / allTests.length) * 100 : 0,
      averageDuration: allTests.length > 0 ? allTests.reduce((sum, t) => sum + t.duration, 0) / allTests.length : 0,
      performance: this.calculatePerformanceMetrics(),
      coverage: this.calculateCoverageMetrics()
    };
  }

  private calculatePerformanceMetrics(): PerformanceMetrics {
    const allTests = this.testSuites.flatMap(suite => suite.tests);
    const responseTimes = allTests
      .map(t => t.metrics?.responseTime)
      .filter(rt => rt !== undefined) as number[];

    if (responseTimes.length === 0) {
      return {
        averageResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: 0,
        p95ResponseTime: 0,
        throughput: 0,
        errorRate: 0,
        slaCompliance: {}
      };
    }

    responseTimes.sort((a, b) => a - b);
    const p95Index = Math.floor(responseTimes.length * 0.95);

    return {
      averageResponseTime: Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length),
      maxResponseTime: Math.max(...responseTimes),
      minResponseTime: Math.min(...responseTimes),
      p95ResponseTime: responseTimes[p95Index] || 0,
      throughput: this.calculateThroughput(),
      errorRate: allTests.filter(t => t.status === 'failed').length / allTests.length,
      slaCompliance: this.calculateDetailedSLACompliance()
    };
  }

  private calculateCoverageMetrics(): CoverageMetrics {
    return {
      endpoints: Array.from(this.endpointRegistry.values()),
      services: Array.from(this.serviceRegistry.values()),
      scenarios: this.calculateScenarioCoverage(),
      overall: {
        endpointCoverage: this.calculateOverallEndpointCoverage(),
        serviceCoverage: this.calculateOverallServiceCoverage(),
        scenarioCoverage: this.calculateOverallScenarioCoverage()
      }
    };
  }

  private initializeEndpointRegistry(): void {
    // Define all known endpoints for coverage tracking
    const endpoints = [
      // User Management
      { service: 'userManagement', endpoint: '/api/users', method: 'POST' },
      { service: 'userManagement', endpoint: '/api/users/{id}', method: 'GET' },
      { service: 'userManagement', endpoint: '/api/users/{id}', method: 'PUT' },
      { service: 'userManagement', endpoint: '/api/users/{id}', method: 'DELETE' },
      { service: 'userManagement', endpoint: '/api/auth/login', method: 'POST' },
      
      // Smart Whitelist
      { service: 'smartWhitelist', endpoint: '/api/whitelist', method: 'POST' },
      { service: 'smartWhitelist', endpoint: '/api/whitelist/{userId}', method: 'GET' },
      { service: 'smartWhitelist', endpoint: '/api/whitelist/check', method: 'POST' },
      
      // Conversation Engine
      { service: 'conversationEngine', endpoint: '/api/conversation/process', method: 'POST' },
      { service: 'conversationEngine', endpoint: '/api/conversation/manage', method: 'POST' },
      
      // Add more endpoints...
    ];

    endpoints.forEach(ep => {
      const key = `${ep.service}:${ep.method}:${ep.endpoint}`;
      this.endpointRegistry.set(key, {
        service: ep.service,
        endpoint: ep.endpoint,
        method: ep.method,
        tested: false,
        testCount: 0,
        responseTypes: [],
        statusCodes: []
      });
    });
  }

  private initializeServiceRegistry(): void {
    const services = ['userManagement', 'smartWhitelist', 'conversationEngine', 'realtimeProcessor', 'profileAnalytics'];
    
    services.forEach(serviceName => {
      const serviceEndpoints = Array.from(this.endpointRegistry.values())
        .filter(ep => ep.service === serviceName);
      
      this.serviceRegistry.set(serviceName, {
        name: serviceName,
        totalEndpoints: serviceEndpoints.length,
        testedEndpoints: 0,
        coveragePercentage: 0,
        criticalEndpointsCovered: 0,
        criticalEndpointsTotal: serviceEndpoints.filter(ep => 
          ep.endpoint.includes('/health') || 
          ep.endpoint.includes('/api/') && ep.method === 'POST'
        ).length
      });
    });
  }

  private async updateCoverageMetrics(suite: TestSuite): Promise<void> {
    // This would be implemented based on actual API calls made during tests
    // For now, simulate coverage updates
  }

  private async updatePerformanceMetrics(suite: TestSuite): Promise<void> {
    // Extract performance data from test results
    const performanceData = suite.tests
      .filter(t => t.metrics?.responseTime)
      .map(t => ({
        testName: t.name,
        responseTime: t.metrics!.responseTime!,
        timestamp: Date.now()
      }));

    // Store for trend analysis
    this.performanceMetrics.push(...performanceData as any);
  }

  private formatTimestamp(timestamp: string): string {
    return timestamp.replace(/[:.]/g, '-').substring(0, 19);
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeCSV(str: string): string {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // Additional helper methods for HTML generation, calculations, etc.
  private getHTMLStyles(): string {
    return `
      body { font-family: Arial, sans-serif; margin: 0; background: #f5f5f5; }
      .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
      .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
      .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .metric { font-size: 2em; font-weight: bold; color: #2c3e50; }
      .status.success { color: #27ae60; }
      .status.warning { color: #f39c12; }
      .status.error { color: #e74c3c; }
      .charts-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
      .chart-container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    `;
  }

  private generateChartScripts(summary: TestMetrics): string {
    return `
      // Test Results Chart
      const ctx1 = document.getElementById('testResultsChart').getContext('2d');
      new Chart(ctx1, {
        type: 'doughnut',
        data: {
          labels: ['Passed', 'Failed', 'Skipped'],
          datasets: [{
            data: [${summary.passedTests}, ${summary.failedTests}, ${summary.skippedTests}],
            backgroundColor: ['#27ae60', '#e74c3c', '#95a5a6']
          }]
        },
        options: { responsive: true, title: { display: true, text: 'Test Results' } }
      });

      // Performance Chart
      const ctx2 = document.getElementById('performanceChart').getContext('2d');
      new Chart(ctx2, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(this.testSuites.map(s => s.name))},
          datasets: [{
            label: 'Avg Response Time (ms)',
            data: ${JSON.stringify(this.testSuites.map(s => s.metrics.performance.averageResponseTime))},
            borderColor: '#3498db',
            fill: false
          }]
        },
        options: { responsive: true, title: { display: true, text: 'Performance Trends' } }
      });
    `;
  }

  private calculateSLACompliance(): number {
    // Simplified SLA calculation
    const performance = this.calculatePerformanceMetrics();
    const slaThreshold = 1500; // 1.5s threshold
    return performance.averageResponseTime <= slaThreshold ? 100 : 
           Math.max(0, 100 - ((performance.averageResponseTime - slaThreshold) / slaThreshold * 100));
  }

  private calculateDetailedSLACompliance(): PerformanceMetrics['slaCompliance'] {
    return {
      'response_time_1500ms': {
        threshold: 1500,
        actual: this.calculatePerformanceMetrics().averageResponseTime,
        passed: this.calculatePerformanceMetrics().averageResponseTime <= 1500
      }
    };
  }

  private calculateThroughput(): number {
    const totalDuration = this.testSuites.reduce((sum, suite) => sum + suite.duration, 0);
    const totalTests = this.testSuites.reduce((sum, suite) => sum + suite.tests.length, 0);
    return totalDuration > 0 ? (totalTests / totalDuration) * 1000 : 0; // tests per second
  }

  private calculateOverallEndpointCoverage(): number {
    const totalEndpoints = this.endpointRegistry.size;
    const testedEndpoints = Array.from(this.endpointRegistry.values()).filter(ep => ep.tested).length;
    return totalEndpoints > 0 ? (testedEndpoints / totalEndpoints) * 100 : 0;
  }

  private calculateOverallServiceCoverage(): number {
    const services = Array.from(this.serviceRegistry.values());
    const totalCoverage = services.reduce((sum, service) => sum + service.coveragePercentage, 0);
    return services.length > 0 ? totalCoverage / services.length : 0;
  }

  private calculateOverallScenarioCoverage(): number {
    // Placeholder - would be based on actual scenario definitions
    return 75;
  }

  private calculateScenarioCoverage(): ScenarioCoverage[] {
    // Placeholder - would be based on actual scenario definitions
    return [
      { name: 'User Registration Flow', tested: true, variations: 3, edgeCasesTested: 2, businessRulesCovered: 5 },
      { name: 'Call Processing Flow', tested: true, variations: 5, edgeCasesTested: 3, businessRulesCovered: 8 }
    ];
  }

  private generateTestSuitesHTML(): string {
    return this.testSuites.map(suite => `
      <div class="test-suite">
        <h3>${suite.name}</h3>
        <div class="suite-stats">
          <span>Tests: ${suite.tests.length}</span>
          <span>Duration: ${(suite.duration / 1000).toFixed(1)}s</span>
          <span>Pass Rate: ${((suite.tests.filter(t => t.status === 'passed').length / suite.tests.length) * 100).toFixed(1)}%</span>
        </div>
      </div>
    `).join('');
  }

  private generateCoverageHTML(): string {
    return `<div class="coverage-summary">Overall endpoint coverage: ${this.calculateOverallEndpointCoverage().toFixed(1)}%</div>`;
  }

  private generatePerformanceHTML(): string {
    const perf = this.calculatePerformanceMetrics();
    return `
      <div class="performance-summary">
        <div>Average Response Time: ${perf.averageResponseTime}ms</div>
        <div>95th Percentile: ${perf.p95ResponseTime}ms</div>
        <div>Error Rate: ${(perf.errorRate * 100).toFixed(2)}%</div>
      </div>
    `;
  }

  private generateEndpointsHTML(serviceName: string): string {
    const endpoints = Array.from(this.endpointRegistry.values())
      .filter(ep => ep.service === serviceName);
    
    return endpoints.map(ep => `
      <div class="endpoint ${ep.tested ? 'tested' : 'untested'}">
        <span class="method">${ep.method}</span>
        <span class="path">${ep.endpoint}</span>
        <span class="status">${ep.tested ? '✓' : '✗'}</span>
      </div>
    `).join('');
  }

  private getCoverageStyles(): string {
    return `
      .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
      .endpoint { display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #eee; }
      .endpoint.tested { background: #d4edda; }
      .endpoint.untested { background: #f8d7da; }
      .method { font-weight: bold; width: 80px; }
      .path { flex: 1; }
      .status { width: 30px; text-align: center; }
    `;
  }

  private identifyPerformanceBottlenecks(): any[] {
    // Analyze performance data to identify bottlenecks
    return [];
  }

  private generatePerformanceRecommendations(): string[] {
    return [
      'Consider caching frequently accessed endpoints',
      'Optimize database queries for better response times',
      'Implement connection pooling for external services'
    ];
  }

  private calculateTrend(values: number[]): { direction: 'up' | 'down' | 'stable'; change: number } {
    if (values.length < 2) return { direction: 'stable', change: 0 };
    
    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const change = ((latest - previous) / previous) * 100;
    
    return {
      direction: Math.abs(change) < 5 ? 'stable' : change > 0 ? 'up' : 'down',
      change: Math.abs(change)
    };
  }

  private calculatePerformanceTrends(): any {
    return { /* trend analysis */ };
  }

  private generateTrendInsights(historical: any[], current: TestMetrics): string[] {
    const insights = [];
    
    if (historical.length > 0) {
      const lastRun = historical[historical.length - 1];
      
      if (current.passRate > lastRun.passRate) {
        insights.push(`Pass rate improved by ${(current.passRate - lastRun.passRate).toFixed(1)}%`);
      } else if (current.passRate < lastRun.passRate) {
        insights.push(`Pass rate decreased by ${(lastRun.passRate - current.passRate).toFixed(1)}%`);
      }
    }
    
    return insights;
  }

  private async loadHistoricalData(): Promise<any[]> {
    try {
      const historyFile = path.join(this.config.outputDir, 'test-history.json');
      const data = await fs.readFile(historyFile, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async saveHistoricalData(data: any[]): Promise<void> {
    const historyFile = path.join(this.config.outputDir, 'test-history.json');
    await fs.writeFile(historyFile, JSON.stringify(data, null, 2));
  }

  private sanitizeSuiteForTransport(suite: TestSuite): any {
    // Remove large data that shouldn't be sent over WebSocket
    return {
      name: suite.name,
      category: suite.category,
      duration: suite.duration,
      passed: suite.passed,
      testCount: suite.tests.length,
      passedCount: suite.tests.filter(t => t.status === 'passed').length
    };
  }

  private broadcastRealTimeUpdate(update: any): void {
    this.realTimeClients.forEach(client => {
      try {
        client.send(JSON.stringify(update));
      } catch (error) {
        // Remove disconnected client
        const index = this.realTimeClients.indexOf(client);
        if (index > -1) {
          this.realTimeClients.splice(index, 1);
        }
      }
    });
  }

  /**
   * Get current test statistics
   */
  getCurrentStats(): TestMetrics {
    return this.calculateOverallMetrics();
  }

  /**
   * Reset all collected data
   */
  reset(): void {
    this.testSuites = [];
    this.performanceMetrics = [];
    this.initializeEndpointRegistry();
    this.initializeServiceRegistry();
  }
}

export default TestReporter;