/**
 * AI Answer Ninja Service Communication Library
 * 
 * Main entry point for service-to-service communication,
 * health checks, circuit breakers, and integration testing.
 */

// Core communication components
export { HttpClient } from './client/HttpClient';
export { CircuitBreaker, CircuitState } from './client/CircuitBreaker';

// Service discovery
export { ServiceRegistry, serviceRegistry } from './discovery/ServiceRegistry';

// Service clients
export {
  UserManagementClient,
  SmartWhitelistClient,
  ConversationEngineClient,
  RealtimeProcessorClient,
  ProfileAnalyticsClient
} from './clients';

// Health checking
export { HealthCheckManager, healthCheckManager } from './health/HealthCheckManager';

// Testing framework
export { IntegrationTestRunner } from './testing/IntegrationTestRunner';
export { UserJourneyTests } from './testing/UserJourneyTests';

// Types
export type {
  ServiceEndpoint,
  ServiceRegistry as ServiceRegistryType,
  HealthCheckResult,
  CircuitBreakerOptions,
  RetryOptions,
  ApiRequestOptions,
  ApiResponse,
  ApiError,
  UserProfile,
  WhitelistEntry,
  ConversationContext,
  ConversationMessage,
  ConversationRequest,
  ConversationResponse,
  WhitelistEvaluationRequest,
  WhitelistEvaluationResult,
  SmartAddRequest,
  AudioProcessingRequest,
  AudioProcessingResult
} from './types';

// Test result types
export type { TestResult, TestSuite } from './testing/IntegrationTestRunner';

// Utility functions
export const createServiceClients = () => ({
  userManagement: new UserManagementClient(),
  smartWhitelist: new SmartWhitelistClient(),
  conversationEngine: new ConversationEngineClient(),
  realtimeProcessor: new RealtimeProcessorClient(),
  profileAnalytics: new ProfileAnalyticsClient()
});

export const createIntegrationTester = (options?: any) => new IntegrationTestRunner(options);
export const createUserJourneyTester = () => new UserJourneyTests();

// Version info
export const version = '1.0.0';
export const name = '@ai-ninja/service-communication';