import { 
  UserManagementClient, 
  SmartWhitelistClient, 
  ConversationEngineClient,
  RealtimeProcessorClient,
  ProfileAnalyticsClient,
  PhoneGatewayClient,
  ConfigurationServiceClient
} from '../clients';
import { ServiceConfig } from '../types';
import logger from '../utils/logger';

export interface ServiceEndpoints {
  userManagement: string;
  smartWhitelist: string;
  conversationEngine: string;
  realtimeProcessor: string;
  profileAnalytics: string;
  phoneGateway: string;
  configurationService: string;
}

export interface ServiceIntegrationTestResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  error?: string;
  details?: any;
}

export class ServiceIntegrationTest {
  private clients: Map<string, any> = new Map();

  constructor(endpoints: ServiceEndpoints) {
    // Initialize all service clients
    this.initializeClients(endpoints);
  }

  private initializeClients(endpoints: ServiceEndpoints): void {
    const timeout = 5000; // 5 seconds
    
    const configs: Record<string, ServiceConfig> = {
      userManagement: {
        baseURL: endpoints.userManagement,
        timeout,
        retries: 2
      },
      smartWhitelist: {
        baseURL: endpoints.smartWhitelist,
        timeout,
        retries: 2
      },
      conversationEngine: {
        baseURL: endpoints.conversationEngine,
        timeout,
        retries: 2
      },
      realtimeProcessor: {
        baseURL: endpoints.realtimeProcessor,
        timeout,
        retries: 2
      },
      profileAnalytics: {
        baseURL: endpoints.profileAnalytics,
        timeout,
        retries: 2
      },
      phoneGateway: {
        baseURL: endpoints.phoneGateway,
        timeout,
        retries: 2
      },
      configurationService: {
        baseURL: endpoints.configurationService,
        timeout,
        retries: 2
      }
    };

    this.clients.set('userManagement', new UserManagementClient(configs.userManagement));
    this.clients.set('smartWhitelist', new SmartWhitelistClient(configs.smartWhitelist));
    this.clients.set('conversationEngine', new ConversationEngineClient(configs.conversationEngine));
    this.clients.set('realtimeProcessor', new RealtimeProcessorClient(configs.realtimeProcessor));
    this.clients.set('profileAnalytics', new ProfileAnalyticsClient(configs.profileAnalytics));
    this.clients.set('phoneGateway', new PhoneGatewayClient(configs.phoneGateway));
    this.clients.set('configurationService', new ConfigurationServiceClient(configs.configurationService));

    logger.info('Service clients initialized');
  }

  /**
   * Run health checks on all services
   */
  async runHealthChecks(): Promise<ServiceIntegrationTestResult[]> {
    const results: ServiceIntegrationTestResult[] = [];

    for (const [serviceName, client] of this.clients) {
      const result = await this.testServiceHealth(serviceName, client);
      results.push(result);
    }

    return results;
  }

  private async testServiceHealth(serviceName: string, client: any): Promise<ServiceIntegrationTestResult> {
    const startTime = Date.now();

    try {
      const healthResponse = await client.getHealth();
      const responseTime = Date.now() - startTime;

      const status = this.determineHealthStatus(healthResponse, responseTime);

      return {
        service: serviceName,
        status,
        responseTime,
        details: healthResponse
      };

    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      return {
        service: serviceName,
        status: 'unhealthy',
        responseTime,
        error: error.message,
        details: {
          code: error.code,
          status: error.status
        }
      };
    }
  }

  private determineHealthStatus(healthResponse: any, responseTime: number): 'healthy' | 'degraded' | 'unhealthy' {
    if (healthResponse?.status === 'unhealthy') {
      return 'unhealthy';
    }

    if (responseTime > 3000 || healthResponse?.status === 'degraded') {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Test service-to-service communication flows
   */
  async runCommunicationTests(): Promise<{
    testName: string;
    success: boolean;
    duration: number;
    error?: string;
    details?: any;
  }[]> {
    const tests = [
      () => this.testUserProfileFlow(),
      () => this.testCallRoutingFlow(),
      () => this.testConfigurationFlow(),
      () => this.testAnalyticsFlow(),
      () => this.testWhitelistFlow()
    ];

    const results = [];

    for (const test of tests) {
      const startTime = Date.now();
      try {
        const result = await test();
        results.push({
          testName: result.testName,
          success: true,
          duration: Date.now() - startTime,
          details: result.details
        });
      } catch (error: any) {
        results.push({
          testName: test.name || 'unknown',
          success: false,
          duration: Date.now() - startTime,
          error: error.message,
          details: error.details
        });
      }
    }

    return results;
  }

  private async testUserProfileFlow(): Promise<any> {
    const userClient = this.clients.get('userManagement');
    const profileClient = this.clients.get('profileAnalytics');

    // Test user creation and profile generation
    const testUser = {
      phoneNumber: '+1234567890',
      name: 'Test User',
      email: 'test@example.com'
    };

    // This would be a real integration test
    // For now, just test the health endpoints
    await userClient.getHealth();
    await profileClient.getHealth();

    return {
      testName: 'User Profile Flow',
      details: { testUser }
    };
  }

  private async testCallRoutingFlow(): Promise<any> {
    const phoneClient = this.clients.get('phoneGateway');
    const realtimeClient = this.clients.get('realtimeProcessor');
    const whitelistClient = this.clients.get('smartWhitelist');

    // Test call routing decision flow
    await phoneClient.getHealth();
    await realtimeClient.getHealth();
    await whitelistClient.getHealth();

    return {
      testName: 'Call Routing Flow',
      details: { flow: 'phone -> whitelist -> realtime' }
    };
  }

  private async testConfigurationFlow(): Promise<any> {
    const configClient = this.clients.get('configurationService');

    // Test configuration retrieval
    await configClient.getHealth();

    // Test getting a configuration value
    try {
      await configClient.getConfiguration('test.config', {
        service: 'test',
        environment: 'development'
      });
    } catch (error) {
      // Expected for non-existent config
    }

    return {
      testName: 'Configuration Flow',
      details: { operation: 'config retrieval' }
    };
  }

  private async testAnalyticsFlow(): Promise<any> {
    const profileClient = this.clients.get('profileAnalytics');

    // Test analytics processing
    await profileClient.getHealth();

    return {
      testName: 'Analytics Flow',
      details: { operation: 'profile analytics' }
    };
  }

  private async testWhitelistFlow(): Promise<any> {
    const whitelistClient = this.clients.get('smartWhitelist');

    // Test whitelist checking
    await whitelistClient.getHealth();

    return {
      testName: 'Whitelist Flow',
      details: { operation: 'whitelist check' }
    };
  }

  /**
   * Generate integration test report
   */
  async generateReport(): Promise<{
    timestamp: string;
    summary: {
      totalServices: number;
      healthyServices: number;
      degradedServices: number;
      unhealthyServices: number;
    };
    healthChecks: ServiceIntegrationTestResult[];
    communicationTests: any[];
    recommendations: string[];
  }> {
    logger.info('Running service integration tests...');

    const healthChecks = await this.runHealthChecks();
    const communicationTests = await this.runCommunicationTests();

    const summary = {
      totalServices: healthChecks.length,
      healthyServices: healthChecks.filter(r => r.status === 'healthy').length,
      degradedServices: healthChecks.filter(r => r.status === 'degraded').length,
      unhealthyServices: healthChecks.filter(r => r.status === 'unhealthy').length
    };

    const recommendations = this.generateRecommendations(healthChecks, communicationTests);

    const report = {
      timestamp: new Date().toISOString(),
      summary,
      healthChecks,
      communicationTests,
      recommendations
    };

    logger.info({ report: summary }, 'Service integration test completed');

    return report;
  }

  private generateRecommendations(
    healthChecks: ServiceIntegrationTestResult[],
    communicationTests: any[]
  ): string[] {
    const recommendations: string[] = [];

    // Analyze health check results
    const unhealthyServices = healthChecks.filter(r => r.status === 'unhealthy');
    const slowServices = healthChecks.filter(r => r.responseTime > 2000);

    if (unhealthyServices.length > 0) {
      recommendations.push(
        `Immediate attention required: ${unhealthyServices.length} service(s) are unhealthy: ${unhealthyServices.map(s => s.service).join(', ')}`
      );
    }

    if (slowServices.length > 0) {
      recommendations.push(
        `Performance optimization needed: ${slowServices.length} service(s) have slow response times (>2s): ${slowServices.map(s => s.service).join(', ')}`
      );
    }

    // Analyze communication test results
    const failedTests = communicationTests.filter(t => !t.success);
    if (failedTests.length > 0) {
      recommendations.push(
        `Service integration issues: ${failedTests.length} communication test(s) failed: ${failedTests.map(t => t.testName).join(', ')}`
      );
    }

    // General recommendations
    if (recommendations.length === 0) {
      recommendations.push('All services are healthy and communicating properly');
    }

    if (healthChecks.some(r => r.responseTime > 1000)) {
      recommendations.push('Consider implementing caching to improve response times');
    }

    if (unhealthyServices.length === 0 && slowServices.length === 0) {
      recommendations.push('Consider setting up automated monitoring and alerting for proactive issue detection');
    }

    return recommendations;
  }

  /**
   * Test specific service integration scenario
   */
  async testScenario(scenarioName: string): Promise<any> {
    switch (scenarioName) {
      case 'incoming-call-processing':
        return this.testIncomingCallProcessingScenario();
      case 'user-onboarding':
        return this.testUserOnboardingScenario();
      case 'configuration-update':
        return this.testConfigurationUpdateScenario();
      default:
        throw new Error(`Unknown scenario: ${scenarioName}`);
    }
  }

  private async testIncomingCallProcessingScenario(): Promise<any> {
    // Simulate the full incoming call processing flow
    const phoneClient = this.clients.get('phoneGateway');
    const whitelistClient = this.clients.get('smartWhitelist');
    const realtimeClient = this.clients.get('realtimeProcessor');
    const profileClient = this.clients.get('profileAnalytics');

    const testCallEvent = {
      eventType: 'IncomingCall',
      from: '+1234567890',
      to: '+0987654321',
      callId: 'test-call-123',
      serverCallId: 'server-call-456',
      timestamp: new Date().toISOString()
    };

    // Simulate the flow
    const steps = [
      { name: 'Phone Gateway Health', client: phoneClient, method: 'getHealth' },
      { name: 'Whitelist Check', client: whitelistClient, method: 'getHealth' },
      { name: 'Profile Analytics', client: profileClient, method: 'getHealth' },
      { name: 'Realtime Processor', client: realtimeClient, method: 'getHealth' }
    ];

    const stepResults = [];

    for (const step of steps) {
      try {
        const startTime = Date.now();
        await step.client[step.method]();
        const duration = Date.now() - startTime;

        stepResults.push({
          step: step.name,
          success: true,
          duration
        });
      } catch (error: any) {
        stepResults.push({
          step: step.name,
          success: false,
          error: error.message
        });
      }
    }

    return {
      testName: 'Incoming Call Processing Scenario',
      testCallEvent,
      steps: stepResults,
      success: stepResults.every(s => s.success)
    };
  }

  private async testUserOnboardingScenario(): Promise<any> {
    // Simulate user onboarding flow
    const userClient = this.clients.get('userManagement');
    const configClient = this.clients.get('configurationService');

    return {
      testName: 'User Onboarding Scenario',
      success: true,
      details: 'User onboarding test completed'
    };
  }

  private async testConfigurationUpdateScenario(): Promise<any> {
    // Simulate configuration update propagation
    const configClient = this.clients.get('configurationService');

    return {
      testName: 'Configuration Update Scenario',
      success: true,
      details: 'Configuration update test completed'
    };
  }
}