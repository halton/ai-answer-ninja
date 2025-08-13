/**
 * Whitelist Management E2E Test Suite
 * 
 * Tests comprehensive whitelist functionality and intelligent filtering:
 * 1. Manual whitelist management (add/remove/update)
 * 2. Smart whitelist automation and ML-driven decisions
 * 3. Dynamic whitelist based on user behavior
 * 4. Bulk operations and import/export
 * 5. Cross-user spam detection and sharing
 * 6. Performance under high load
 */

import { performance } from 'perf_hooks';
import { TestApiClient } from '../utils/TestApiClient';
import { TestDataFactory } from '../fixtures/TestDataFactory';

export interface WhitelistTestResult {
  testName: string;
  passed: boolean;
  duration: number;
  metrics: {
    addContactTime: number;
    removeContactTime: number;
    lookupTime: number;
    bulkOperationTime: number;
    mlPredictionTime: number;
    cacheHitRate: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
  };
  details: {
    userId?: string;
    contactsAdded: number;
    contactsRemoved: number;
    smartDecisionsCorrect: number;
    bulkOperationsSuccessful: boolean;
    mlAccuracy: number;
    performanceThresholdMet: boolean;
  };
  error?: string;
}

export interface WhitelistConfig {
  maxLookupTime: number; // ms
  maxBulkOperationTime: number; // ms
  minMLAccuracy: number; // 0-1
  maxFalsePositiveRate: number; // 0-1
  cacheTimeout: number; // ms
  bulkOperationSize: number;
  smartThreshold: number; // ML confidence threshold
}

export class WhitelistManagementE2ETest {
  private apiClient: TestApiClient;
  private dataFactory: TestDataFactory;
  private config: WhitelistConfig;
  private testUsers: Map<string, any> = new Map();
  private testContacts: Map<string, any[]> = new Map();

  constructor(apiClient: TestApiClient, config?: Partial<WhitelistConfig>) {
    this.apiClient = apiClient;
    this.dataFactory = new TestDataFactory();
    this.config = {
      maxLookupTime: 100,
      maxBulkOperationTime: 5000,
      minMLAccuracy: 0.85,
      maxFalsePositiveRate: 0.05,
      cacheTimeout: 60000,
      bulkOperationSize: 100,
      smartThreshold: 0.8,
      ...config
    };
  }

  /**
   * Test basic whitelist CRUD operations
   */
  async testBasicWhitelistOperations(): Promise<WhitelistTestResult> {
    const testName = 'Basic Whitelist CRUD Operations';
    const startTime = performance.now();
    
    try {
      // Setup test user
      const userData = this.dataFactory.createTestUser();
      const userResponse = await this.apiClient.post('/user-management/api/users', userData);
      const userId = userResponse.data.id;
      this.testUsers.set(userId, userData);

      // Step 1: Add individual contacts
      const addContactStart = performance.now();
      const testContacts = this.dataFactory.createWhitelistContacts(5);
      const addResults = [];

      for (const contact of testContacts) {
        const addResponse = await this.apiClient.post('/smart-whitelist/api/whitelist', {
          user_id: userId,
          contact_phone: contact.phone,
          contact_name: contact.name,
          whitelist_type: 'manual',
          notes: contact.notes
        });

        addResults.push({
          success: addResponse.status === 201,
          contact: contact.phone,
          responseTime: performance.now()
        });
      }

      const averageAddTime = addResults.reduce((sum, r) => 
        sum + (r.responseTime - addContactStart), 0) / addResults.length;
      
      const successfulAdds = addResults.filter(r => r.success).length;

      // Step 2: Retrieve whitelist
      const retrieveStart = performance.now();
      const listResponse = await this.apiClient.get(`/smart-whitelist/api/whitelist/${userId}`);
      const retrieveTime = performance.now() - retrieveStart;

      if (listResponse.status !== 200) {
        throw new Error(`Whitelist retrieval failed: ${listResponse.status}`);
      }

      const whitelistContacts = listResponse.data;

      // Step 3: Lookup individual contacts
      const lookupTimes = [];
      for (const contact of testContacts.slice(0, 3)) {
        const lookupStart = performance.now();
        const lookupResponse = await this.apiClient.get(
          `/smart-whitelist/api/whitelist/${userId}/check/${encodeURIComponent(contact.phone)}`
        );
        const lookupTime = performance.now() - lookupStart;
        
        lookupTimes.push(lookupTime);
        
        if (lookupResponse.data.is_whitelisted !== true) {
          throw new Error(`Contact ${contact.phone} should be whitelisted but is not`);
        }
      }

      const averageLookupTime = lookupTimes.reduce((a, b) => a + b, 0) / lookupTimes.length;

      // Step 4: Update contact information
      const updateContact = testContacts[0];
      const updateResponse = await this.apiClient.put(
        `/smart-whitelist/api/whitelist/${userId}/${encodeURIComponent(updateContact.phone)}`,
        {
          contact_name: `Updated ${updateContact.name}`,
          notes: 'Updated during test',
          priority: 'high'
        }
      );

      // Step 5: Remove contacts
      const removeContactStart = performance.now();
      const removeResults = [];

      for (const contact of testContacts.slice(3)) { // Remove last 2 contacts
        const removeResponse = await this.apiClient.delete(
          `/smart-whitelist/api/whitelist/${userId}/${encodeURIComponent(contact.phone)}`
        );

        removeResults.push({
          success: removeResponse.status === 200,
          contact: contact.phone
        });
      }

      const removeTime = performance.now() - removeContactStart;
      const successfulRemoves = removeResults.filter(r => r.success).length;

      // Step 6: Verify removals
      const finalListResponse = await this.apiClient.get(`/smart-whitelist/api/whitelist/${userId}`);
      const finalContacts = finalListResponse.data;
      const expectedRemainingCount = successfulAdds - successfulRemoves;

      const totalTime = performance.now() - startTime;

      // Cache performance test
      const cacheTestResults = await this.testCachePerformance(userId, testContacts.slice(0, 3));

      const passed = successfulAdds === testContacts.length &&
                     averageLookupTime <= this.config.maxLookupTime &&
                     updateResponse.status === 200 &&
                     finalContacts.length === expectedRemainingCount &&
                     cacheTestResults.cacheHitRate > 0.5;

      return {
        testName,
        passed,
        duration: Math.round(totalTime),
        metrics: {
          addContactTime: Math.round(averageAddTime),
          removeContactTime: Math.round(removeTime / removeResults.length),
          lookupTime: Math.round(averageLookupTime),
          bulkOperationTime: 0,
          mlPredictionTime: 0,
          cacheHitRate: cacheTestResults.cacheHitRate,
          falsePositiveRate: 0,
          falseNegativeRate: 0
        },
        details: {
          userId,
          contactsAdded: successfulAdds,
          contactsRemoved: successfulRemoves,
          smartDecisionsCorrect: 0,
          bulkOperationsSuccessful: false,
          mlAccuracy: 0,
          performanceThresholdMet: averageLookupTime <= this.config.maxLookupTime
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        testName,
        passed: false,
        duration: Math.round(duration),
        metrics: {
          addContactTime: 0,
          removeContactTime: 0,
          lookupTime: Math.round(duration),
          bulkOperationTime: 0,
          mlPredictionTime: 0,
          cacheHitRate: 0,
          falsePositiveRate: 1,
          falseNegativeRate: 1
        },
        details: {
          contactsAdded: 0,
          contactsRemoved: 0,
          smartDecisionsCorrect: 0,
          bulkOperationsSuccessful: false,
          mlAccuracy: 0,
          performanceThresholdMet: false
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test smart whitelist automation and ML predictions
   */
  async testSmartWhitelistAutomation(): Promise<WhitelistTestResult> {
    const testName = 'Smart Whitelist Automation';
    const startTime = performance.now();
    
    try {
      // Setup test user
      const userData = this.dataFactory.createTestUser();
      const userResponse = await this.apiClient.post('/user-management/api/users', userData);
      const userId = userResponse.data.id;

      // Generate call history to train the ML model
      await this.generateCallHistory(userId, 20);

      // Test 1: Smart whitelist suggestions
      const suggestionsStart = performance.now();
      const suggestionsResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/smart-suggest', {
        user_id: userId,
        analysis_period: '30_days',
        suggestion_limit: 10
      });

      const suggestionsTime = performance.now() - suggestionsStart;

      if (suggestionsResponse.status !== 200) {
        throw new Error(`Smart suggestions failed: ${suggestionsResponse.status}`);
      }

      const suggestions = suggestionsResponse.data.suggestions;

      // Test 2: Evaluate ML predictions for known spam numbers
      const mlTestStart = performance.now();
      const spamNumbers = this.dataFactory.generateKnownSpamNumbers(10);
      const legitimateNumbers = this.dataFactory.generateLegitimateNumbers(10);
      
      const mlPredictions = [];

      // Test spam number detection
      for (const spamNumber of spamNumbers) {
        const predictionResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/evaluate', {
          user_id: userId,
          phone: spamNumber.phone,
          context: {
            call_time: new Date().toISOString(),
            call_frequency: spamNumber.call_frequency,
            time_pattern: spamNumber.time_pattern
          }
        });

        mlPredictions.push({
          phone: spamNumber.phone,
          predicted_spam: predictionResponse.data.is_spam,
          confidence: predictionResponse.data.confidence,
          actual_spam: true,
          correct: predictionResponse.data.is_spam === true
        });
      }

      // Test legitimate number detection
      for (const legitNumber of legitimateNumbers) {
        const predictionResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/evaluate', {
          user_id: userId,
          phone: legitNumber.phone,
          context: {
            call_time: new Date().toISOString(),
            call_frequency: legitNumber.call_frequency,
            caller_name: legitNumber.name
          }
        });

        mlPredictions.push({
          phone: legitNumber.phone,
          predicted_spam: predictionResponse.data.is_spam,
          confidence: predictionResponse.data.confidence,
          actual_spam: false,
          correct: predictionResponse.data.is_spam === false
        });
      }

      const mlTime = performance.now() - mlTestStart;

      // Calculate ML performance metrics
      const correctPredictions = mlPredictions.filter(p => p.correct).length;
      const mlAccuracy = correctPredictions / mlPredictions.length;
      
      const falsePositives = mlPredictions.filter(p => 
        !p.actual_spam && p.predicted_spam).length;
      const falseNegatives = mlPredictions.filter(p => 
        p.actual_spam && !p.predicted_spam).length;
      
      const falsePositiveRate = falsePositives / legitimateNumbers.length;
      const falseNegativeRate = falseNegatives / spamNumbers.length;

      // Test 3: Auto-whitelist behavior
      const autoWhitelistResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/auto-add', {
        user_id: userId,
        phone: legitimateNumbers[0].phone,
        reason: 'frequent_contact',
        confidence: 0.95,
        auto_approve: true
      });

      // Test 4: Learning from user feedback
      const feedbackResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/feedback', {
        user_id: userId,
        phone: spamNumbers[0].phone,
        user_action: 'blocked',
        system_prediction: 'spam',
        feedback: 'correct'
      });

      const totalTime = performance.now() - startTime;

      const passed = suggestionsResponse.status === 200 &&
                     mlAccuracy >= this.config.minMLAccuracy &&
                     falsePositiveRate <= this.config.maxFalsePositiveRate &&
                     autoWhitelistResponse.status === 201 &&
                     feedbackResponse.status === 200;

      return {
        testName,
        passed,
        duration: Math.round(totalTime),
        metrics: {
          addContactTime: 0,
          removeContactTime: 0,
          lookupTime: 0,
          bulkOperationTime: 0,
          mlPredictionTime: Math.round(mlTime / mlPredictions.length),
          cacheHitRate: 0,
          falsePositiveRate,
          falseNegativeRate
        },
        details: {
          userId,
          contactsAdded: 1, // Auto-added contact
          contactsRemoved: 0,
          smartDecisionsCorrect: correctPredictions,
          bulkOperationsSuccessful: false,
          mlAccuracy,
          performanceThresholdMet: mlTime / mlPredictions.length <= this.config.maxLookupTime
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        testName,
        passed: false,
        duration: Math.round(duration),
        metrics: {
          addContactTime: 0,
          removeContactTime: 0,
          lookupTime: 0,
          bulkOperationTime: 0,
          mlPredictionTime: Math.round(duration),
          cacheHitRate: 0,
          falsePositiveRate: 1,
          falseNegativeRate: 1
        },
        details: {
          contactsAdded: 0,
          contactsRemoved: 0,
          smartDecisionsCorrect: 0,
          bulkOperationsSuccessful: false,
          mlAccuracy: 0,
          performanceThresholdMet: false
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test bulk operations and high-load performance
   */
  async testBulkOperationsAndPerformance(): Promise<WhitelistTestResult> {
    const testName = 'Bulk Operations and Performance';
    const startTime = performance.now();
    
    try {
      // Setup test user
      const userData = this.dataFactory.createTestUser();
      const userResponse = await this.apiClient.post('/user-management/api/users', userData);
      const userId = userResponse.data.id;

      // Test 1: Bulk import
      const bulkImportStart = performance.now();
      const bulkContacts = this.dataFactory.createWhitelistContacts(this.config.bulkOperationSize);
      
      const importResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/bulk-import', {
        user_id: userId,
        contacts: bulkContacts,
        source: 'csv_import',
        overwrite_existing: false
      });

      const bulkImportTime = performance.now() - bulkImportStart;

      if (importResponse.status !== 202) { // Accepted for async processing
        throw new Error(`Bulk import failed: ${importResponse.status}`);
      }

      const importId = importResponse.data.import_id;

      // Poll for import completion
      let importComplete = false;
      let importResult = null;
      
      for (let i = 0; i < 30 && !importComplete; i++) { // Max 30 seconds
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await this.apiClient.get(`/smart-whitelist/api/whitelist/import-status/${importId}`);
        
        if (statusResponse.data.status === 'completed') {
          importComplete = true;
          importResult = statusResponse.data;
        } else if (statusResponse.data.status === 'failed') {
          throw new Error('Bulk import failed');
        }
      }

      // Test 2: High-load lookup performance
      const lookupLoadStart = performance.now();
      const concurrentLookups = 50;
      
      const lookupPromises = Array(concurrentLookups).fill(null).map(async (_, index) => {
        const contact = bulkContacts[index % bulkContacts.length];
        const lookupStart = performance.now();
        
        const response = await this.apiClient.get(
          `/smart-whitelist/api/whitelist/${userId}/check/${encodeURIComponent(contact.phone)}`
        );
        
        const lookupTime = performance.now() - lookupStart;
        
        return {
          success: response.status === 200 && response.data.is_whitelisted === true,
          lookupTime,
          phone: contact.phone
        };
      });

      const lookupResults = await Promise.all(lookupPromises);
      const lookupLoadTime = performance.now() - lookupLoadStart;
      
      const successfulLookups = lookupResults.filter(r => r.success).length;
      const averageLookupTime = lookupResults.reduce((sum, r) => sum + r.lookupTime, 0) / lookupResults.length;

      // Test 3: Bulk export
      const exportStart = performance.now();
      const exportResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/bulk-export', {
        user_id: userId,
        format: 'json',
        include_metadata: true
      });

      const exportTime = performance.now() - exportStart;

      // Test 4: Bulk update
      const bulkUpdateStart = performance.now();
      const updateContacts = bulkContacts.slice(0, 10).map(contact => ({
        phone: contact.phone,
        updates: {
          priority: 'high',
          notes: 'Bulk updated'
        }
      }));

      const updateResponse = await this.apiClient.put('/smart-whitelist/api/whitelist/bulk-update', {
        user_id: userId,
        updates: updateContacts
      });

      const bulkUpdateTime = performance.now() - bulkUpdateStart;

      // Test 5: Bulk delete
      const deleteStart = performance.now();
      const deleteContacts = bulkContacts.slice(-10).map(c => c.phone);
      
      const deleteResponse = await this.apiClient.post('/smart-whitelist/api/whitelist/bulk-delete', {
        user_id: userId,
        phones: deleteContacts
      });

      const deleteTime = performance.now() - deleteStart;

      const totalTime = performance.now() - startTime;

      // Performance validation
      const bulkOperationsSuccessful = importComplete &&
                                       exportResponse.status === 200 &&
                                       updateResponse.status === 200 &&
                                       deleteResponse.status === 200;

      const performanceThresholdMet = bulkImportTime <= this.config.maxBulkOperationTime &&
                                      averageLookupTime <= this.config.maxLookupTime * 2; // Allow 2x for concurrent

      const passed = bulkOperationsSuccessful &&
                     performanceThresholdMet &&
                     successfulLookups >= concurrentLookups * 0.95; // 95% success rate

      return {
        testName,
        passed,
        duration: Math.round(totalTime),
        metrics: {
          addContactTime: 0,
          removeContactTime: Math.round(deleteTime / deleteContacts.length),
          lookupTime: Math.round(averageLookupTime),
          bulkOperationTime: Math.round(bulkImportTime),
          mlPredictionTime: 0,
          cacheHitRate: successfulLookups / concurrentLookups,
          falsePositiveRate: 0,
          falseNegativeRate: (concurrentLookups - successfulLookups) / concurrentLookups
        },
        details: {
          userId,
          contactsAdded: importResult?.successful_imports || 0,
          contactsRemoved: deleteContacts.length,
          smartDecisionsCorrect: 0,
          bulkOperationsSuccessful,
          mlAccuracy: 0,
          performanceThresholdMet
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        testName,
        passed: false,
        duration: Math.round(duration),
        metrics: {
          addContactTime: 0,
          removeContactTime: 0,
          lookupTime: Math.round(duration),
          bulkOperationTime: Math.round(duration),
          mlPredictionTime: 0,
          cacheHitRate: 0,
          falsePositiveRate: 1,
          falseNegativeRate: 1
        },
        details: {
          contactsAdded: 0,
          contactsRemoved: 0,
          smartDecisionsCorrect: 0,
          bulkOperationsSuccessful: false,
          mlAccuracy: 0,
          performanceThresholdMet: false
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test cache performance and hit rates
   */
  private async testCachePerformance(userId: string, contacts: any[]): Promise<{ cacheHitRate: number; averageTime: number }> {
    const lookupTimes = [];
    
    // First round - populate cache
    for (const contact of contacts) {
      const start = performance.now();
      await this.apiClient.get(`/smart-whitelist/api/whitelist/${userId}/check/${encodeURIComponent(contact.phone)}`);
      lookupTimes.push(performance.now() - start);
    }

    // Second round - should hit cache
    const cachedTimes = [];
    for (const contact of contacts) {
      const start = performance.now();
      await this.apiClient.get(`/smart-whitelist/api/whitelist/${userId}/check/${encodeURIComponent(contact.phone)}`);
      cachedTimes.push(performance.now() - start);
    }

    const averageFirstTime = lookupTimes.reduce((a, b) => a + b, 0) / lookupTimes.length;
    const averageCachedTime = cachedTimes.reduce((a, b) => a + b, 0) / cachedTimes.length;
    
    // Cache hit rate approximated by performance improvement
    const cacheHitRate = Math.max(0, (averageFirstTime - averageCachedTime) / averageFirstTime);
    
    return {
      cacheHitRate,
      averageTime: averageCachedTime
    };
  }

  /**
   * Generate call history for ML training
   */
  private async generateCallHistory(userId: string, callCount: number): Promise<void> {
    const calls = Array(callCount).fill(null).map(() => {
      const isSpam = Math.random() > 0.3; // 70% spam calls
      return this.dataFactory.createIncomingCall({
        spam_category: isSpam ? 'telemarketing' : null,
        caller_behavior: isSpam ? 'persistent' : 'normal'
      });
    });

    for (const call of calls) {
      await this.apiClient.post('/conversation-engine/api/calls', {
        ...call,
        user_id: userId
      }).catch(() => {}); // Ignore failures for test data
    }
  }

  /**
   * Cleanup test data
   */
  private async cleanup(userId: string): Promise<void> {
    try {
      await this.apiClient.delete(`/user-management/api/users/${userId}`);
      this.testUsers.delete(userId);
      this.testContacts.delete(userId);
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  }

  /**
   * Run all whitelist management tests
   */
  async runAllTests(): Promise<{
    summary: {
      totalTests: number;
      passedTests: number;
      averageLookupTime: number;
      mlAccuracy: number;
      bulkOperationSuccess: boolean;
    };
    results: WhitelistTestResult[];
  }> {
    const results: WhitelistTestResult[] = [];
    
    // Run all test scenarios
    results.push(await this.testBasicWhitelistOperations());
    results.push(await this.testSmartWhitelistAutomation());
    results.push(await this.testBulkOperationsAndPerformance());

    // Calculate summary
    const passedTests = results.filter(r => r.passed).length;
    const averageLookupTime = results.reduce((sum, r) => sum + r.metrics.lookupTime, 0) / results.length;
    const mlAccuracy = results
      .filter(r => r.details.mlAccuracy > 0)
      .reduce((sum, r) => sum + r.details.mlAccuracy, 0) / 
      results.filter(r => r.details.mlAccuracy > 0).length || 0;
    const bulkOperationSuccess = results.some(r => r.details.bulkOperationsSuccessful);

    // Cleanup all test users
    for (const userId of this.testUsers.keys()) {
      await this.cleanup(userId);
    }

    return {
      summary: {
        totalTests: results.length,
        passedTests,
        averageLookupTime: Math.round(averageLookupTime),
        mlAccuracy: Math.round(mlAccuracy * 100) / 100,
        bulkOperationSuccess
      },
      results
    };
  }
}

export default WhitelistManagementE2ETest;