/**
 * Test Fixture Manager
 * Manages test fixtures, setup, teardown, and test environment state
 */

import { TestDataManager, TestDataSet } from '../data/test-data-manager';
import { AzureMockServiceManager } from '../mocks/azure-mock-service';
import { DatabaseService } from '../../shared/service-communication/src/clients';
import { RedisService } from '../../services/user-management/src/services/redis';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface TestEnvironmentConfig {
  environment: 'unit' | 'integration' | 'e2e' | 'load';
  useRealServices: boolean;
  useMockData: boolean;
  cleanupAfterTests: boolean;
  seedDatabase: boolean;
  resetBetweenTests: boolean;
  debugMode: boolean;
}

export interface TestFixture {
  name: string;
  description: string;
  dataSet: TestDataSet;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
  validate: () => Promise<boolean>;
}

export class FixtureManager {
  private testDataManager: TestDataManager;
  private mockServiceManager: AzureMockServiceManager;
  private databaseService: DatabaseService;
  private redisService: RedisService;
  private activeFixtures: Map<string, TestFixture> = new Map();
  private testStartTime: Date = new Date();

  constructor(
    private config: TestEnvironmentConfig,
    private fixturesDirectory: string = './tests/fixtures/data'
  ) {
    this.testDataManager = new TestDataManager();
    this.mockServiceManager = new AzureMockServiceManager();
    this.databaseService = new DatabaseService();
    this.redisService = new RedisService();
    
    this.ensureFixturesDirectory();
  }

  /**
   * Initialize the test environment
   */
  public async initializeTestEnvironment(): Promise<void> {
    console.log('🔧 Initializing test environment...');
    this.testStartTime = new Date();

    try {
      // Start mock services if not using real services
      if (!this.config.useRealServices) {
        await this.mockServiceManager.startServices();
      }

      // Initialize database connection
      await this.databaseService.initialize();

      // Initialize Redis connection
      await this.redisService.initialize();

      // Clean up any previous test data if requested
      if (this.config.cleanupAfterTests) {
        await this.cleanupTestData();
      }

      // Create test database tables if needed
      await this.ensureTestDatabaseSchema();

      console.log('✅ Test environment initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize test environment:', error);
      throw error;
    }
  }

  /**
   * Cleanup the test environment
   */
  public async cleanupTestEnvironment(): Promise<void> {
    console.log('🧹 Cleaning up test environment...');

    try {
      // Cleanup active fixtures
      for (const [name, fixture] of this.activeFixtures) {
        await this.teardownFixture(name);
      }

      // Cleanup test data if requested
      if (this.config.cleanupAfterTests) {
        await this.cleanupTestData();
      }

      // Stop mock services
      if (!this.config.useRealServices) {
        await this.mockServiceManager.stopServices();
      }

      // Close database connections
      await this.databaseService.close();
      await this.redisService.close();

      console.log('✅ Test environment cleanup completed');
    } catch (error) {
      console.error('❌ Error during test environment cleanup:', error);
      throw error;
    }
  }

  /**
   * Load a test fixture
   */
  public async loadFixture(fixtureName: string): Promise<TestFixture> {
    console.log(`📦 Loading fixture: ${fixtureName}`);

    try {
      const fixture = await this.createFixture(fixtureName);
      
      // Run fixture setup
      await fixture.setup();
      
      // Validate fixture
      const isValid = await fixture.validate();
      if (!isValid) {
        throw new Error(`Fixture validation failed: ${fixtureName}`);
      }

      this.activeFixtures.set(fixtureName, fixture);
      console.log(`✅ Fixture loaded successfully: ${fixtureName}`);
      
      return fixture;
    } catch (error) {
      console.error(`❌ Failed to load fixture: ${fixtureName}`, error);
      throw error;
    }
  }

  /**
   * Teardown a test fixture
   */
  public async teardownFixture(fixtureName: string): Promise<void> {
    const fixture = this.activeFixtures.get(fixtureName);
    if (!fixture) {
      console.warn(`⚠️ Fixture not found: ${fixtureName}`);
      return;
    }

    console.log(`🗑️ Tearing down fixture: ${fixtureName}`);
    
    try {
      await fixture.teardown();
      this.activeFixtures.delete(fixtureName);
      console.log(`✅ Fixture torn down successfully: ${fixtureName}`);
    } catch (error) {
      console.error(`❌ Error tearing down fixture: ${fixtureName}`, error);
      throw error;
    }
  }

  /**
   * Get available test fixtures
   */
  public getAvailableFixtures(): string[] {
    return [
      'basic-user-data',
      'spam-detection-data',
      'conversation-flow-data',
      'whitelist-management-data',
      'performance-test-data',
      'edge-cases-data',
      'multi-language-data',
      'high-volume-data'
    ];
  }

  /**
   * Create specific test fixtures
   */
  private async createFixture(fixtureName: string): Promise<TestFixture> {
    switch (fixtureName) {
      case 'basic-user-data':
        return this.createBasicUserDataFixture();
      case 'spam-detection-data':
        return this.createSpamDetectionFixture();
      case 'conversation-flow-data':
        return this.createConversationFlowFixture();
      case 'whitelist-management-data':
        return this.createWhitelistManagementFixture();
      case 'performance-test-data':
        return this.createPerformanceTestFixture();
      case 'edge-cases-data':
        return this.createEdgeCasesFixture();
      case 'multi-language-data':
        return this.createMultiLanguageFixture();
      case 'high-volume-data':
        return this.createHighVolumeFixture();
      default:
        throw new Error(`Unknown fixture: ${fixtureName}`);
    }
  }

  /**
   * Basic user data fixture
   */
  private async createBasicUserDataFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 5,
      spamProfileCount: 10,
      callRecordsPerUser: 3,
      conversationsPerCall: 4,
      whitelistEntriesPerUser: 2
    });

    return {
      name: 'basic-user-data',
      description: 'Basic user data for standard testing scenarios',
      dataSet,
      setup: async () => {
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('basic-user-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.users.length === 5 && 
               dataSet.spamProfiles.length === 10 &&
               dataSet.callRecords.length >= 15;
      }
    };
  }

  /**
   * Spam detection fixture
   */
  private async createSpamDetectionFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 10,
      spamProfileCount: 50,
      callRecordsPerUser: 10,
      conversationsPerCall: 6,
      whitelistEntriesPerUser: 5
    });

    // Enhance spam profiles with specific patterns
    dataSet.spamProfiles = dataSet.spamProfiles.map(profile => ({
      ...profile,
      featureVector: {
        ...profile.featureVector,
        call_frequency: Math.random() > 0.5 ? 0.8 : 0.3,
        keyword_density: Math.random() > 0.5 ? 0.9 : 0.2
      }
    }));

    return {
      name: 'spam-detection-data',
      description: 'Data optimized for testing spam detection algorithms',
      dataSet,
      setup: async () => {
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('spam-detection-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.spamProfiles.length === 50 &&
               dataSet.spamProfiles.every(p => p.featureVector.call_frequency !== undefined);
      }
    };
  }

  /**
   * Conversation flow fixture
   */
  private async createConversationFlowFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 8,
      spamProfileCount: 15,
      callRecordsPerUser: 5,
      conversationsPerCall: 10, // Longer conversations
      whitelistEntriesPerUser: 3
    });

    return {
      name: 'conversation-flow-data',
      description: 'Data for testing conversation flow and AI responses',
      dataSet,
      setup: async () => {
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('conversation-flow-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        const avgConversationsPerCall = dataSet.conversations.length / dataSet.callRecords.length;
        return avgConversationsPerCall >= 5; // Should have good conversation data
      }
    };
  }

  /**
   * Whitelist management fixture
   */
  private async createWhitelistManagementFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 6,
      spamProfileCount: 20,
      callRecordsPerUser: 8,
      conversationsPerCall: 4,
      whitelistEntriesPerUser: 15 // High whitelist count
    });

    return {
      name: 'whitelist-management-data',
      description: 'Data for testing whitelist management functionality',
      dataSet,
      setup: async () => {
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('whitelist-management-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.whitelistEntries.length >= 90 &&
               dataSet.whitelistEntries.some(w => w.whitelistType === 'auto') &&
               dataSet.whitelistEntries.some(w => w.whitelistType === 'temporary');
      }
    };
  }

  /**
   * Performance test fixture
   */
  private async createPerformanceTestFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 100,
      spamProfileCount: 200,
      callRecordsPerUser: 20,
      conversationsPerCall: 5,
      whitelistEntriesPerUser: 10
    });

    return {
      name: 'performance-test-data',
      description: 'Large dataset for performance and load testing',
      dataSet,
      setup: async () => {
        console.log('⚡ Setting up performance test data (this may take a while)...');
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('performance-test-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.users.length === 100 &&
               dataSet.callRecords.length >= 2000 &&
               dataSet.conversations.length >= 10000;
      }
    };
  }

  /**
   * Edge cases fixture
   */
  private async createEdgeCasesFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 10,
      spamProfileCount: 25,
      callRecordsPerUser: 5,
      conversationsPerCall: 3,
      whitelistEntriesPerUser: 5
    });

    // Add edge case scenarios
    dataSet.users.push({
      id: 'edge-user-locked',
      phoneNumber: '+1-555-0001',
      name: 'Locked User',
      personality: 'polite',
      isActive: true,
      isLocked: true, // Locked user
      createdAt: new Date(),
      updatedAt: new Date()
    });

    dataSet.users.push({
      id: 'edge-user-inactive',
      phoneNumber: '+1-555-0002',
      name: 'Inactive User',
      personality: 'direct',
      isActive: false, // Inactive user
      isLocked: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return {
      name: 'edge-cases-data',
      description: 'Data containing edge cases and boundary conditions',
      dataSet,
      setup: async () => {
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('edge-cases-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.users.some(u => u.isLocked) &&
               dataSet.users.some(u => !u.isActive);
      }
    };
  }

  /**
   * Multi-language fixture
   */
  private async createMultiLanguageFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 12,
      spamProfileCount: 30,
      callRecordsPerUser: 4,
      conversationsPerCall: 6,
      whitelistEntriesPerUser: 4
    });

    // Add multi-language conversations
    dataSet.conversations = dataSet.conversations.map((conv, index) => ({
      ...conv,
      messageText: index % 2 === 0 ? 
        conv.messageText : // Keep original
        this.translateToMultiLanguage(conv.messageText, index % 4) // Add translations
    }));

    return {
      name: 'multi-language-data',
      description: 'Data for testing multi-language support',
      dataSet,
      setup: async () => {
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('multi-language-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.conversations.some(c => c.messageText.includes('您好')) &&
               dataSet.conversations.some(c => c.messageText.includes('Hello'));
      }
    };
  }

  /**
   * High volume fixture
   */
  private async createHighVolumeFixture(): Promise<TestFixture> {
    const dataSet = await this.testDataManager.generateTestDataSet({
      userCount: 50,
      spamProfileCount: 500,
      callRecordsPerUser: 50,
      conversationsPerCall: 8,
      whitelistEntriesPerUser: 25
    });

    return {
      name: 'high-volume-data',
      description: 'High-volume data for stress testing',
      dataSet,
      setup: async () => {
        console.log('🚀 Setting up high-volume test data (this will take some time)...');
        if (this.config.seedDatabase) {
          await this.testDataManager.seedDatabase(dataSet);
        }
        await this.saveFixtureData('high-volume-data', dataSet);
      },
      teardown: async () => {
        if (this.config.cleanupAfterTests) {
          await this.cleanupSpecificTestData(dataSet);
        }
      },
      validate: async () => {
        return dataSet.users.length === 50 &&
               dataSet.spamProfiles.length === 500 &&
               dataSet.callRecords.length >= 2500;
      }
    };
  }

  /**
   * Save fixture data to file
   */
  private async saveFixtureData(fixtureName: string, dataSet: TestDataSet): Promise<void> {
    const filePath = path.join(this.fixturesDirectory, `${fixtureName}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(dataSet, null, 2));
  }

  /**
   * Clean up test data
   */
  private async cleanupTestData(): Promise<void> {
    console.log('🧹 Cleaning up test data...');
    
    try {
      // Clear Redis cache
      await this.redisService.flushall();

      // Clear database tables (in correct order due to foreign keys)
      const tables = [
        'conversations',
        'call_records',
        'smart_whitelists',
        'user_spam_interactions',
        'spam_profiles',
        'users'
      ];

      for (const table of tables) {
        await this.databaseService.query(`DELETE FROM ${table} WHERE created_at >= $1`, [this.testStartTime]);
      }

      console.log('✅ Test data cleanup completed');
    } catch (error) {
      console.error('❌ Error during test data cleanup:', error);
      throw error;
    }
  }

  /**
   * Clean up specific test data
   */
  private async cleanupSpecificTestData(dataSet: TestDataSet): Promise<void> {
    try {
      const userIds = dataSet.users.map(u => u.id);
      
      if (userIds.length > 0) {
        const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
        
        await this.databaseService.query(`DELETE FROM conversations WHERE call_record_id IN (SELECT id FROM call_records WHERE user_id IN (${placeholders}))`, userIds);
        await this.databaseService.query(`DELETE FROM call_records WHERE user_id IN (${placeholders})`, userIds);
        await this.databaseService.query(`DELETE FROM smart_whitelists WHERE user_id IN (${placeholders})`, userIds);
        await this.databaseService.query(`DELETE FROM user_spam_interactions WHERE user_id IN (${placeholders})`, userIds);
        await this.databaseService.query(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);
      }

      const spamProfileIds = dataSet.spamProfiles.map(s => s.id);
      if (spamProfileIds.length > 0) {
        const placeholders = spamProfileIds.map((_, i) => `$${i + 1}`).join(',');
        await this.databaseService.query(`DELETE FROM spam_profiles WHERE id IN (${placeholders})`, spamProfileIds);
      }
    } catch (error) {
      console.error('Error cleaning up specific test data:', error);
      throw error;
    }
  }

  /**
   * Ensure test database schema exists
   */
  private async ensureTestDatabaseSchema(): Promise<void> {
    try {
      // Check if test tables exist, create if needed
      const schemaFiles = [
        '../../database/schemas/01-core-tables.sql',
        '../../database/schemas/02-performance-functions.sql'
      ];

      for (const schemaFile of schemaFiles) {
        const schemaPath = path.resolve(__dirname, schemaFile);
        if (fs.existsSync(schemaPath)) {
          const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
          await this.databaseService.query(schemaSql);
        }
      }
    } catch (error) {
      console.error('Error ensuring test database schema:', error);
      // Don't throw - tables might already exist
    }
  }

  /**
   * Ensure fixtures directory exists
   */
  private ensureFixturesDirectory(): void {
    if (!fs.existsSync(this.fixturesDirectory)) {
      fs.mkdirSync(this.fixturesDirectory, { recursive: true });
    }
  }

  /**
   * Translate text for multi-language testing
   */
  private translateToMultiLanguage(text: string, languageIndex: number): string {
    const languages = [
      { // Chinese
        "Hello": "您好",
        "Thank you": "谢谢",
        "Not interested": "不感兴趣",
        "Goodbye": "再见"
      },
      { // Spanish
        "Hello": "Hola",
        "Thank you": "Gracias",
        "Not interested": "No me interesa",
        "Goodbye": "Adiós"
      },
      { // French
        "Hello": "Bonjour",
        "Thank you": "Merci",
        "Not interested": "Pas intéressé",
        "Goodbye": "Au revoir"
      },
      { // Japanese
        "Hello": "こんにちは",
        "Thank you": "ありがとう",
        "Not interested": "興味がありません",
        "Goodbye": "さようなら"
      }
    ];

    const lang = languages[languageIndex];
    let translatedText = text;

    Object.entries(lang).forEach(([english, translation]) => {
      translatedText = translatedText.replace(new RegExp(english, 'g'), translation);
    });

    return translatedText;
  }

  /**
   * Get test environment status
   */
  public async getEnvironmentStatus(): Promise<{
    isHealthy: boolean;
    services: Record<string, boolean>;
    fixtures: string[];
    testDataCount: Record<string, number>;
  }> {
    const services = {
      database: await this.isDatabaseHealthy(),
      redis: await this.isRedisHealthy(),
      mockServices: !this.config.useRealServices || await this.areMockServicesHealthy()
    };

    const testDataCount = await this.getTestDataCounts();

    return {
      isHealthy: Object.values(services).every(status => status),
      services,
      fixtures: Array.from(this.activeFixtures.keys()),
      testDataCount
    };
  }

  private async isDatabaseHealthy(): Promise<boolean> {
    try {
      await this.databaseService.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async isRedisHealthy(): Promise<boolean> {
    try {
      await this.redisService.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async areMockServicesHealthy(): Promise<boolean> {
    // Mock services are always healthy if they're running
    return true;
  }

  private async getTestDataCounts(): Promise<Record<string, number>> {
    try {
      const counts = {
        users: 0,
        spamProfiles: 0,
        callRecords: 0,
        conversations: 0,
        whitelistEntries: 0
      };

      const tables = [
        { name: 'users', key: 'users' },
        { name: 'spam_profiles', key: 'spamProfiles' },
        { name: 'call_records', key: 'callRecords' },
        { name: 'conversations', key: 'conversations' },
        { name: 'smart_whitelists', key: 'whitelistEntries' }
      ];

      for (const table of tables) {
        try {
          const result = await this.databaseService.query(
            `SELECT COUNT(*) as count FROM ${table.name} WHERE created_at >= $1`,
            [this.testStartTime]
          );
          counts[table.key as keyof typeof counts] = parseInt(result.rows?.[0]?.count || 0);
        } catch {
          // Table might not exist
          counts[table.key as keyof typeof counts] = 0;
        }
      }

      return counts;
    } catch {
      return {
        users: 0,
        spamProfiles: 0,
        callRecords: 0,
        conversations: 0,
        whitelistEntries: 0
      };
    }
  }
}