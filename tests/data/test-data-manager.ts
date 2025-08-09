/**
 * Test Data Management System
 * Provides comprehensive test data generation and management for AI Phone Answering System
 */

import { faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../shared/service-communication/src/clients';

// Type definitions for test data
export interface TestUser {
  id: string;
  phoneNumber: string;
  name: string;
  email?: string;
  personality: 'polite' | 'direct' | 'humorous' | 'professional';
  isActive: boolean;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestSpamProfile {
  id: string;
  phoneHash: string;
  spamCategory: 'sales_call' | 'loan_offer' | 'investment_pitch' | 'insurance_sales';
  riskScore: number;
  confidenceLevel: number;
  featureVector: Record<string, number>;
  behavioralPatterns: Record<string, any>;
  totalReports: number;
  lastActivity: Date;
  createdAt: Date;
}

export interface TestCallRecord {
  id: string;
  userId: string;
  callerPhone: string;
  callType: 'incoming' | 'outgoing';
  callStatus: 'answered' | 'missed' | 'blocked' | 'transferred';
  startTime: Date;
  endTime?: Date;
  durationSeconds?: number;
  azureCallId?: string;
  audioRecordingUrl?: string;
  processingMetadata: Record<string, any>;
}

export interface TestConversation {
  id: string;
  callRecordId: string;
  speaker: 'user' | 'ai' | 'caller';
  messageText: string;
  timestamp: Date;
  confidenceScore: number;
  intentCategory: string;
  emotion: 'neutral' | 'positive' | 'negative' | 'angry' | 'happy' | 'sad';
  processingLatency: number;
}

export interface TestWhitelistEntry {
  id: string;
  userId: string;
  contactPhone: string;
  contactName?: string;
  whitelistType: 'manual' | 'auto' | 'temporary';
  confidenceScore: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

export interface TestDataSet {
  users: TestUser[];
  spamProfiles: TestSpamProfile[];
  callRecords: TestCallRecord[];
  conversations: TestConversation[];
  whitelistEntries: TestWhitelistEntry[];
}

export class TestDataManager {
  private readonly dataDirectory: string;
  private readonly dbService: DatabaseService;
  
  constructor(dataDirectory: string = './tests/data/generated') {
    this.dataDirectory = dataDirectory;
    this.dbService = new DatabaseService();
    this.ensureDataDirectory();
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDirectory)) {
      fs.mkdirSync(this.dataDirectory, { recursive: true });
    }
  }

  /**
   * Generate comprehensive test data set
   */
  public async generateTestDataSet(config: {
    userCount: number;
    spamProfileCount: number;
    callRecordsPerUser: number;
    conversationsPerCall: number;
    whitelistEntriesPerUser: number;
  }): Promise<TestDataSet> {
    const users = this.generateUsers(config.userCount);
    const spamProfiles = this.generateSpamProfiles(config.spamProfileCount);
    const callRecords = this.generateCallRecords(users, config.callRecordsPerUser);
    const conversations = this.generateConversations(callRecords, config.conversationsPerCall);
    const whitelistEntries = this.generateWhitelistEntries(users, config.whitelistEntriesPerUser);

    const testDataSet: TestDataSet = {
      users,
      spamProfiles,
      callRecords,
      conversations,
      whitelistEntries
    };

    // Save to file
    await this.saveTestDataSet(testDataSet);

    return testDataSet;
  }

  /**
   * Generate test users with diverse personalities and characteristics
   */
  public generateUsers(count: number): TestUser[] {
    const personalities: TestUser['personality'][] = ['polite', 'direct', 'humorous', 'professional'];
    const users: TestUser[] = [];

    for (let i = 0; i < count; i++) {
      const user: TestUser = {
        id: uuidv4(),
        phoneNumber: this.generatePhoneNumber(),
        name: faker.person.fullName(),
        email: faker.internet.email(),
        personality: faker.helpers.arrayElement(personalities),
        isActive: faker.datatype.boolean(0.9), // 90% active
        isLocked: faker.datatype.boolean(0.05), // 5% locked
        createdAt: faker.date.past({ years: 2 }),
        updatedAt: faker.date.recent({ days: 30 })
      };

      users.push(user);
    }

    return users;
  }

  /**
   * Generate spam profiles with realistic patterns
   */
  public generateSpamProfiles(count: number): TestSpamProfile[] {
    const spamCategories: TestSpamProfile['spamCategory'][] = [
      'sales_call', 'loan_offer', 'investment_pitch', 'insurance_sales'
    ];

    const profiles: TestSpamProfile[] = [];

    for (let i = 0; i < count; i++) {
      const category = faker.helpers.arrayElement(spamCategories);
      const profile: TestSpamProfile = {
        id: uuidv4(),
        phoneHash: faker.string.alphanumeric(64),
        spamCategory: category,
        riskScore: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 }),
        confidenceLevel: faker.number.float({ min: 0.5, max: 1.0, multipleOf: 0.01 }),
        featureVector: this.generateFeatureVector(category),
        behavioralPatterns: this.generateBehavioralPatterns(category),
        totalReports: faker.number.int({ min: 1, max: 100 }),
        lastActivity: faker.date.recent({ days: 30 }),
        createdAt: faker.date.past({ years: 1 })
      };

      profiles.push(profile);
    }

    return profiles;
  }

  /**
   * Generate call records with realistic patterns
   */
  public generateCallRecords(users: TestUser[], recordsPerUser: number): TestCallRecord[] {
    const callStatuses: TestCallRecord['callStatus'][] = [
      'answered', 'missed', 'blocked', 'transferred'
    ];

    const records: TestCallRecord[] = [];

    for (const user of users) {
      for (let i = 0; i < recordsPerUser; i++) {
        const startTime = faker.date.recent({ days: 90 });
        const status = faker.helpers.arrayElement(callStatuses);
        const duration = status === 'answered' || status === 'transferred' 
          ? faker.number.int({ min: 10, max: 600 }) 
          : undefined;

        const record: TestCallRecord = {
          id: uuidv4(),
          userId: user.id,
          callerPhone: this.generatePhoneNumber(),
          callType: 'incoming',
          callStatus: status,
          startTime,
          endTime: duration ? new Date(startTime.getTime() + duration * 1000) : undefined,
          durationSeconds: duration,
          azureCallId: faker.string.uuid(),
          audioRecordingUrl: duration ? `https://storage.example.com/recordings/${faker.string.uuid()}.wav` : undefined,
          processingMetadata: {
            aiResponseGenerated: status === 'answered',
            responseLatency: status === 'answered' ? faker.number.int({ min: 500, max: 2000 }) : null,
            intentDetected: status === 'answered' ? faker.helpers.arrayElement(['sales_call', 'loan_offer', 'unknown']) : null,
            qualityScore: status === 'answered' ? faker.number.float({ min: 0.6, max: 1.0, multipleOf: 0.01 }) : null
          }
        };

        records.push(record);
      }
    }

    return records;
  }

  /**
   * Generate realistic conversations
   */
  public generateConversations(callRecords: TestCallRecord[], conversationsPerCall: number): TestConversation[] {
    const intentions = ['sales_call', 'loan_offer', 'investment_pitch', 'insurance_sales', 'unknown'];
    const emotions: TestConversation['emotion'][] = ['neutral', 'positive', 'negative', 'angry', 'happy', 'sad'];
    const conversations: TestConversation[] = [];

    // Only generate conversations for answered calls
    const answeredCalls = callRecords.filter(call => call.callStatus === 'answered');

    for (const call of answeredCalls) {
      const conversationCount = faker.number.int({ min: 2, max: conversationsPerCall });
      let timestamp = new Date(call.startTime.getTime() + 1000); // Start 1 second after call start

      for (let i = 0; i < conversationCount; i++) {
        const isCallerTurn = i % 2 === 0; // Alternate between caller and AI
        const speaker = isCallerTurn ? 'caller' : 'ai';
        
        const conversation: TestConversation = {
          id: uuidv4(),
          callRecordId: call.id,
          speaker,
          messageText: this.generateConversationMessage(speaker, i),
          timestamp,
          confidenceScore: faker.number.float({ min: 0.7, max: 0.99, multipleOf: 0.01 }),
          intentCategory: faker.helpers.arrayElement(intentions),
          emotion: faker.helpers.arrayElement(emotions),
          processingLatency: faker.number.int({ min: 100, max: 800 })
        };

        conversations.push(conversation);

        // Increment timestamp for next message
        timestamp = new Date(timestamp.getTime() + faker.number.int({ min: 2000, max: 8000 }));
      }
    }

    return conversations;
  }

  /**
   * Generate whitelist entries
   */
  public generateWhitelistEntries(users: TestUser[], entriesPerUser: number): TestWhitelistEntry[] {
    const whitelistTypes: TestWhitelistEntry['whitelistType'][] = ['manual', 'auto', 'temporary'];
    const entries: TestWhitelistEntry[] = [];

    for (const user of users) {
      for (let i = 0; i < entriesPerUser; i++) {
        const type = faker.helpers.arrayElement(whitelistTypes);
        const isTemporary = type === 'temporary';

        const entry: TestWhitelistEntry = {
          id: uuidv4(),
          userId: user.id,
          contactPhone: this.generatePhoneNumber(),
          contactName: faker.person.fullName(),
          whitelistType: type,
          confidenceScore: type === 'auto' ? faker.number.float({ min: 0.6, max: 1.0, multipleOf: 0.01 }) : 1.0,
          isActive: faker.datatype.boolean(0.95), // 95% active
          expiresAt: isTemporary ? faker.date.future({ days: 30 }) : undefined,
          createdAt: faker.date.past({ days: 60 })
        };

        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Generate realistic phone numbers
   */
  private generatePhoneNumber(): string {
    // Generate format: +1-XXX-XXX-XXXX
    const areaCode = faker.number.int({ min: 200, max: 999 });
    const exchangeCode = faker.number.int({ min: 200, max: 999 });
    const number = faker.number.int({ min: 1000, max: 9999 });
    return `+1-${areaCode}-${exchangeCode}-${number}`;
  }

  /**
   * Generate feature vector for spam detection
   */
  private generateFeatureVector(category: TestSpamProfile['spamCategory']): Record<string, number> {
    const baseFeatures = {
      call_frequency: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 }),
      time_of_day_score: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 }),
      duration_pattern: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 }),
      response_rate: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 }),
      keyword_density: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 })
    };

    // Adjust features based on spam category
    switch (category) {
      case 'sales_call':
        baseFeatures.keyword_density *= 1.2;
        baseFeatures.call_frequency *= 1.1;
        break;
      case 'loan_offer':
        baseFeatures.response_rate *= 0.8;
        baseFeatures.keyword_density *= 1.3;
        break;
      case 'investment_pitch':
        baseFeatures.duration_pattern *= 1.2;
        baseFeatures.time_of_day_score *= 1.1;
        break;
      case 'insurance_sales':
        baseFeatures.call_frequency *= 0.9;
        baseFeatures.response_rate *= 0.9;
        break;
    }

    return baseFeatures;
  }

  /**
   * Generate behavioral patterns
   */
  private generateBehavioralPatterns(category: TestSpamProfile['spamCategory']): Record<string, any> {
    return {
      preferred_times: this.generateCallTimePreferences(),
      common_phrases: this.generateCommonPhrases(category),
      persistence_level: faker.number.float({ min: 0.1, max: 1.0, multipleOf: 0.01 }),
      callback_frequency: faker.number.int({ min: 1, max: 10 }),
      response_to_rejection: faker.helpers.arrayElement(['polite_end', 'persistent', 'aggressive', 'callback_later'])
    };
  }

  /**
   * Generate call time preferences
   */
  private generateCallTimePreferences(): number[] {
    // Hours of the day (0-23) with higher probability
    const preferences: number[] = [];
    const peakHours = [9, 10, 11, 14, 15, 16, 19, 20]; // Common telemarketing hours

    for (let hour = 0; hour < 24; hour++) {
      if (peakHours.includes(hour)) {
        preferences.push(faker.number.float({ min: 0.6, max: 1.0, multipleOf: 0.01 }));
      } else {
        preferences.push(faker.number.float({ min: 0.0, max: 0.4, multipleOf: 0.01 }));
      }
    }

    return preferences;
  }

  /**
   * Generate common phrases for spam categories
   */
  private generateCommonPhrases(category: TestSpamProfile['spamCategory']): string[] {
    const phrases = {
      sales_call: [
        "特别优惠", "限时活动", "了解一下", "产品介绍", "免费试用",
        "special offer", "limited time", "product demo", "free trial"
      ],
      loan_offer: [
        "低利息贷款", "快速放款", "无抵押", "征信要求低", "当天到账",
        "low interest loan", "quick approval", "no collateral", "same day funding"
      ],
      investment_pitch: [
        "投资机会", "高收益", "稳定回报", "理财产品", "专业顾问",
        "investment opportunity", "high returns", "financial advisor", "portfolio"
      ],
      insurance_sales: [
        "保险计划", "保障全面", "理赔快速", "保费优惠", "家庭保障",
        "insurance plan", "comprehensive coverage", "premium discount", "family protection"
      ]
    };

    return phrases[category] || [];
  }

  /**
   * Generate conversation message based on speaker and turn
   */
  private generateConversationMessage(speaker: 'caller' | 'ai' | 'user', turn: number): string {
    if (speaker === 'caller') {
      if (turn === 0) {
        return faker.helpers.arrayElement([
          "您好，我是XX公司的，想了解一下您对我们新产品的兴趣",
          "Hello, I'm calling from XX company about our new product offering",
          "打扰一下，我们有一个特别的投资机会想与您分享",
          "Hi there, we have an exclusive loan offer with very competitive rates"
        ]);
      } else {
        return faker.helpers.arrayElement([
          "我理解您的顾虑，但这真的是一个很好的机会",
          "I understand your concern, but this is really a great opportunity",
          "只需要几分钟时间，我可以详细解释",
          "It will only take a few minutes to explain the benefits",
          "这个优惠只对今天有效",
          "This offer is only valid today"
        ]);
      }
    } else {
      // AI responses
      if (turn === 1) {
        return faker.helpers.arrayElement([
          "谢谢您的介绍，但我现在不方便",
          "Thank you for the information, but I'm not interested right now",
          "我现在没有这方面的需求，谢谢",
          "I don't have any need for this service currently, thank you"
        ]);
      } else {
        return faker.helpers.arrayElement([
          "我已经说得很清楚了，请不要再打扰我",
          "I've made it clear that I'm not interested, please don't call again",
          "麻烦您把我的号码从通话名单中删除",
          "Please remove my number from your calling list",
          "再见",
          "Goodbye"
        ]);
      }
    }
  }

  /**
   * Save test data set to files
   */
  public async saveTestDataSet(dataSet: TestDataSet, filename?: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = filename || `test-data-${timestamp}`;

    // Save complete data set
    const completeFilePath = path.join(this.dataDirectory, `${baseFilename}.json`);
    fs.writeFileSync(completeFilePath, JSON.stringify(dataSet, null, 2));

    // Save individual entity files
    const entities = ['users', 'spamProfiles', 'callRecords', 'conversations', 'whitelistEntries'] as const;
    
    for (const entity of entities) {
      const entityFilePath = path.join(this.dataDirectory, `${baseFilename}-${entity}.json`);
      fs.writeFileSync(entityFilePath, JSON.stringify(dataSet[entity], null, 2));
    }

    console.log(`Test data saved to: ${this.dataDirectory}`);
    console.log(`Files: ${baseFilename}.json, ${baseFilename}-*.json`);
  }

  /**
   * Load test data set from file
   */
  public async loadTestDataSet(filename: string): Promise<TestDataSet> {
    const filePath = path.join(this.dataDirectory, filename);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Test data file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as TestDataSet;
  }

  /**
   * Clear test data from database
   */
  public async clearTestData(): Promise<void> {
    // Implementation would depend on your database service
    // This is a placeholder for the actual implementation
    console.log('Clearing test data from database...');
    
    // Example:
    // await this.dbService.query('DELETE FROM conversations WHERE call_record_id IN (SELECT id FROM call_records WHERE created_at > ?)', [testStartTime]);
    // await this.dbService.query('DELETE FROM call_records WHERE created_at > ?', [testStartTime]);
    // await this.dbService.query('DELETE FROM whitelist_entries WHERE created_at > ?', [testStartTime]);
    // await this.dbService.query('DELETE FROM spam_profiles WHERE created_at > ?', [testStartTime]);
    // await this.dbService.query('DELETE FROM users WHERE created_at > ?', [testStartTime]);
  }

  /**
   * Seed database with test data
   */
  public async seedDatabase(dataSet: TestDataSet): Promise<void> {
    console.log('Seeding database with test data...');

    try {
      // Insert users first (as other entities depend on them)
      for (const user of dataSet.users) {
        await this.dbService.query(`
          INSERT INTO users (id, phone_number, name, email, personality, is_active, is_locked, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            phone_number = EXCLUDED.phone_number,
            name = EXCLUDED.name,
            updated_at = EXCLUDED.updated_at
        `, [user.id, user.phoneNumber, user.name, user.email, user.personality, user.isActive, user.isLocked, user.createdAt, user.updatedAt]);
      }

      // Insert spam profiles
      for (const profile of dataSet.spamProfiles) {
        await this.dbService.query(`
          INSERT INTO spam_profiles (id, phone_hash, spam_category, risk_score, confidence_level, feature_vector, behavioral_patterns, total_reports, last_activity, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            risk_score = EXCLUDED.risk_score,
            confidence_level = EXCLUDED.confidence_level,
            last_activity = EXCLUDED.last_activity
        `, [profile.id, profile.phoneHash, profile.spamCategory, profile.riskScore, profile.confidenceLevel, JSON.stringify(profile.featureVector), JSON.stringify(profile.behavioralPatterns), profile.totalReports, profile.lastActivity, profile.createdAt]);
      }

      // Insert call records
      for (const record of dataSet.callRecords) {
        await this.dbService.query(`
          INSERT INTO call_records (id, user_id, caller_phone, call_type, call_status, start_time, end_time, duration_seconds, azure_call_id, audio_recording_url, processing_metadata, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO NOTHING
        `, [record.id, record.userId, record.callerPhone, record.callType, record.callStatus, record.startTime, record.endTime, record.durationSeconds, record.azureCallId, record.audioRecordingUrl, JSON.stringify(record.processingMetadata), record.startTime]);
      }

      // Insert conversations
      for (const conversation of dataSet.conversations) {
        await this.dbService.query(`
          INSERT INTO conversations (id, call_record_id, speaker, message_text, timestamp, confidence_score, intent_category, emotion, processing_latency, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO NOTHING
        `, [conversation.id, conversation.callRecordId, conversation.speaker, conversation.messageText, conversation.timestamp, conversation.confidenceScore, conversation.intentCategory, conversation.emotion, conversation.processingLatency, conversation.timestamp]);
      }

      // Insert whitelist entries
      for (const entry of dataSet.whitelistEntries) {
        await this.dbService.query(`
          INSERT INTO smart_whitelists (id, user_id, contact_phone, contact_name, whitelist_type, confidence_score, is_active, expires_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            is_active = EXCLUDED.is_active,
            expires_at = EXCLUDED.expires_at
        `, [entry.id, entry.userId, entry.contactPhone, entry.contactName, entry.whitelistType, entry.confidenceScore, entry.isActive, entry.expiresAt, entry.createdAt]);
      }

      console.log('Database seeding completed successfully');
    } catch (error) {
      console.error('Error seeding database:', error);
      throw error;
    }
  }

  /**
   * Generate specific test scenarios
   */
  public generateTestScenarios(): Record<string, TestDataSet> {
    return {
      'high-volume-spam': this.generateHighVolumeSpamScenario(),
      'mixed-call-types': this.generateMixedCallTypesScenario(),
      'whitelist-accuracy': this.generateWhitelistAccuracyScenario(),
      'performance-stress': this.generatePerformanceStressScenario()
    };
  }

  private generateHighVolumeSpamScenario(): TestDataSet {
    const users = this.generateUsers(10);
    const spamProfiles = this.generateSpamProfiles(100);
    const callRecords = this.generateCallRecords(users, 50); // High call volume
    const conversations = this.generateConversations(callRecords, 8); // Longer conversations
    const whitelistEntries = this.generateWhitelistEntries(users, 5);

    return { users, spamProfiles, callRecords, conversations, whitelistEntries };
  }

  private generateMixedCallTypesScenario(): TestDataSet {
    const users = this.generateUsers(20);
    const spamProfiles = this.generateSpamProfiles(30);
    const callRecords = this.generateCallRecords(users, 15);
    const conversations = this.generateConversations(callRecords, 5);
    const whitelistEntries = this.generateWhitelistEntries(users, 10);

    return { users, spamProfiles, callRecords, conversations, whitelistEntries };
  }

  private generateWhitelistAccuracyScenario(): TestDataSet {
    const users = this.generateUsers(15);
    const spamProfiles = this.generateSpamProfiles(20);
    const callRecords = this.generateCallRecords(users, 10);
    const conversations = this.generateConversations(callRecords, 3);
    const whitelistEntries = this.generateWhitelistEntries(users, 20); // High whitelist count

    return { users, spamProfiles, callRecords, conversations, whitelistEntries };
  }

  private generatePerformanceStressScenario(): TestDataSet {
    const users = this.generateUsers(100);
    const spamProfiles = this.generateSpamProfiles(500);
    const callRecords = this.generateCallRecords(users, 100); // Very high volume
    const conversations = this.generateConversations(callRecords, 10);
    const whitelistEntries = this.generateWhitelistEntries(users, 50);

    return { users, spamProfiles, callRecords, conversations, whitelistEntries };
  }
}