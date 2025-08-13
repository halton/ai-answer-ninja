/**
 * Test Data Factory for E2E Testing
 * 
 * Generates realistic test data for all test scenarios:
 * - User profiles and registration data
 * - Call records and conversation data
 * - Whitelist contacts and spam profiles
 * - Audio chunks and voice samples
 * - Configuration and preferences
 * - Performance and load testing data
 */

import { faker } from '@faker-js/faker';

export interface TestUser {
  id?: string;
  phone_number: string;
  name: string;
  email?: string;
  password?: string;
  personality: string;
  preferences: {
    response_style: string;
    max_call_duration: number;
    auto_hang_up: boolean;
    notification_settings: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
  };
  voice_settings?: {
    clone_enabled: boolean;
    sample_url?: string;
    language: string;
    tone: string;
  };
  emergency_contacts?: Array<{
    name: string;
    phone: string;
    relationship: string;
  }>;
}

export interface TestCall {
  call_id: string;
  caller_phone: string;
  called_phone: string;
  timestamp: string;
  duration_seconds?: number;
  spam_category?: string;
  expected_intent?: string;
  caller_behavior?: string;
  call_outcome?: string;
}

export interface WhitelistContact {
  phone: string;
  name: string;
  relationship?: string;
  notes?: string;
  priority?: string;
  added_date?: string;
}

export interface SpamProfile {
  phone: string;
  spam_category: string;
  risk_score: number;
  confidence_level: number;
  call_frequency: number;
  time_pattern: string;
  behavioral_patterns: {
    persistence_level: string;
    response_to_rejection: string;
    typical_duration: number;
  };
}

export interface AudioChunk {
  sequence: number;
  data: string;
  timestamp: number;
  is_final: boolean;
  duration_ms: number;
}

export interface ConversationData {
  call_id: string;
  turns: Array<{
    speaker: 'caller' | 'ai';
    message: string;
    timestamp: string;
    intent?: string;
    confidence?: number;
    emotion?: string;
  }>;
  effectiveness_score?: number;
  user_satisfaction?: number;
}

export class TestDataFactory {
  private usedPhoneNumbers: Set<string> = new Set();
  private usedEmails: Set<string> = new Set();
  private usedCallIds: Set<string> = new Set();

  constructor() {
    // Configure faker for Chinese locale when needed
    faker.locale = 'zh_CN';
  }

  /**
   * Create a test user with comprehensive profile data
   */
  createTestUser(options?: Partial<TestUser>): TestUser {
    const phoneNumber = this.generateUniquePhoneNumber();
    const email = this.generateUniqueEmail();
    
    const user: TestUser = {
      phone_number: phoneNumber,
      name: faker.person.fullName(),
      email,
      password: this.generateSecurePassword(),
      personality: faker.helpers.arrayElement([
        'professional', 'friendly', 'direct', 'humorous', 'polite'
      ]),
      preferences: {
        response_style: faker.helpers.arrayElement([
          'polite_decline', 'firm_decline', 'humorous_deflection', 'direct_hangup'
        ]),
        max_call_duration: faker.number.int({ min: 30, max: 300 }),
        auto_hang_up: faker.datatype.boolean(),
        notification_settings: {
          email: faker.datatype.boolean(),
          sms: faker.datatype.boolean(),
          push: faker.datatype.boolean()
        }
      },
      voice_settings: {
        clone_enabled: faker.datatype.boolean(),
        sample_url: faker.datatype.boolean() ? faker.internet.url() : undefined,
        language: faker.helpers.arrayElement(['zh-CN', 'en-US', 'zh-TW']),
        tone: faker.helpers.arrayElement(['natural', 'professional', 'friendly', 'authoritative'])
      },
      emergency_contacts: this.generateEmergencyContacts(faker.number.int({ min: 1, max: 3 })),
      ...options
    };

    return user;
  }

  /**
   * Create user registration data with validation
   */
  createUserRegistrationData(options?: {
    include_preferences?: boolean;
    include_voice_profile?: boolean;
    include_call_history?: boolean;
    include_voice_samples?: boolean;
    include_analytics_data?: boolean;
  }): any {
    const baseUser = this.createTestUser();
    
    const registrationData = {
      phone_number: baseUser.phone_number,
      name: baseUser.name,
      email: baseUser.email,
      password: baseUser.password,
      confirm_password: baseUser.password,
      terms_accepted: true,
      privacy_accepted: true,
      marketing_consent: faker.datatype.boolean()
    };

    if (options?.include_preferences) {
      Object.assign(registrationData, {
        preferences: baseUser.preferences
      });
    }

    if (options?.include_voice_profile) {
      Object.assign(registrationData, {
        voice_settings: baseUser.voice_settings
      });
    }

    return registrationData;
  }

  /**
   * Create incoming call data
   */
  createIncomingCall(options?: Partial<TestCall>): TestCall {
    const callId = this.generateUniqueCallId();
    
    const spamCategories = [
      'telemarketing', 'loan_offer', 'investment_pitch', 'insurance_sales',
      'real_estate', 'credit_card_sales', 'debt_collection', 'survey_call'
    ];

    const call: TestCall = {
      call_id: callId,
      caller_phone: this.generatePhoneNumber(),
      called_phone: this.generatePhoneNumber(),
      timestamp: new Date().toISOString(),
      duration_seconds: faker.number.int({ min: 10, max: 300 }),
      spam_category: faker.helpers.arrayElement(spamCategories),
      expected_intent: faker.helpers.arrayElement([
        'financial_services', 'telemarketing', 'survey', 'appointment_booking'
      ]),
      caller_behavior: faker.helpers.arrayElement([
        'persistent', 'polite', 'aggressive', 'robotic', 'normal'
      ]),
      call_outcome: faker.helpers.arrayElement([
        'caller_hung_up', 'ai_terminated', 'transferred', 'timeout'
      ]),
      ...options
    };

    return call;
  }

  /**
   * Create whitelist contacts
   */
  createWhitelistContacts(count: number): WhitelistContact[] {
    const relationships = [
      'family', 'friend', 'colleague', 'business', 'healthcare', 'emergency'
    ];

    return Array(count).fill(null).map(() => ({
      phone: this.generatePhoneNumber(),
      name: faker.person.fullName(),
      relationship: faker.helpers.arrayElement(relationships),
      notes: faker.helpers.maybe(() => faker.lorem.sentence()) || undefined,
      priority: faker.helpers.arrayElement(['low', 'normal', 'high']),
      added_date: faker.date.recent({ days: 90 }).toISOString()
    }));
  }

  /**
   * Generate known spam numbers with behavioral patterns
   */
  generateKnownSpamNumbers(count: number): SpamProfile[] {
    const spamCategories = [
      'telemarketing', 'loan_scam', 'investment_fraud', 'robocall',
      'debt_collection', 'insurance_scam', 'survey_spam'
    ];

    const timePa terns = [
      'business_hours', 'evening_calls', 'weekend_calls', 'random', 'persistent_daily'
    ];

    return Array(count).fill(null).map(() => ({
      phone: this.generatePhoneNumber(),
      spam_category: faker.helpers.arrayElement(spamCategories),
      risk_score: faker.number.float({ min: 0.7, max: 1.0, precision: 0.01 }),
      confidence_level: faker.number.float({ min: 0.8, max: 1.0, precision: 0.01 }),
      call_frequency: faker.number.int({ min: 3, max: 15 }), // calls per day
      time_pattern: faker.helpers.arrayElement(timePa terns),
      behavioral_patterns: {
        persistence_level: faker.helpers.arrayElement(['low', 'medium', 'high', 'extreme']),
        response_to_rejection: faker.helpers.arrayElement([
          'hangs_up', 'continues_talking', 'becomes_aggressive', 'calls_back'
        ]),
        typical_duration: faker.number.int({ min: 30, max: 180 })
      }
    }));
  }

  /**
   * Generate legitimate phone numbers with normal patterns
   */
  generateLegitimateNumbers(count: number): Array<{
    phone: string;
    name: string;
    call_frequency: number;
    relationship?: string;
  }> {
    const relationships = [
      'family', 'friend', 'doctor', 'colleague', 'business_legitimate', 'delivery'
    ];

    return Array(count).fill(null).map(() => ({
      phone: this.generatePhoneNumber(),
      name: faker.person.fullName(),
      call_frequency: faker.number.int({ min: 1, max: 5 }), // calls per week
      relationship: faker.helpers.arrayElement(relationships)
    }));
  }

  /**
   * Generate audio chunks for testing real-time processing
   */
  generateAudioChunks(options: {
    text: string;
    chunkCount: number;
    chunkDuration?: number;
  }): AudioChunk[] {
    const { text, chunkCount, chunkDuration = 500 } = options;
    const chunks: AudioChunk[] = [];

    for (let i = 0; i < chunkCount; i++) {
      chunks.push({
        sequence: i + 1,
        data: this.generateMockAudioData(),
        timestamp: Date.now() + (i * chunkDuration),
        is_final: i === chunkCount - 1,
        duration_ms: chunkDuration
      });
    }

    return chunks;
  }

  /**
   * Generate large audio chunk for performance testing
   */
  generateLargeAudioChunk(): string {
    // Generate a larger mock audio chunk (4KB base64 encoded)
    const size = 4096;
    const bytes = Array(size).fill(null).map(() => 
      Math.floor(Math.random() * 256)
    );
    return Buffer.from(bytes).toString('base64');
  }

  /**
   * Generate conversation data with multiple turns
   */
  generateConversationData(callId: string, turnCount: number = 5): ConversationData {
    const spamPhrases = [
      '你好，我是XX银行的',
      '我们有一个特别优惠的产品',
      '现在办理可以享受优惠',
      '您有兴趣了解一下吗',
      '这个机会很难得'
    ];

    const aiResponses = [
      '不好意思，我现在不方便',
      '谢谢，我暂时不需要',
      '我对这个不感兴趣',
      '请不要再打扰我了',
      '再见'
    ];

    const turns = [];
    
    for (let i = 0; i < turnCount; i++) {
      // Caller turn
      turns.push({
        speaker: 'caller' as const,
        message: faker.helpers.arrayElement(spamPhrases),
        timestamp: new Date(Date.now() + i * 10000).toISOString(),
        intent: 'sales_pitch',
        confidence: faker.number.float({ min: 0.8, max: 0.95, precision: 0.01 }),
        emotion: faker.helpers.arrayElement(['neutral', 'persuasive', 'persistent'])
      });

      // AI response (if not the last turn)
      if (i < turnCount - 1) {
        turns.push({
          speaker: 'ai' as const,
          message: faker.helpers.arrayElement(aiResponses),
          timestamp: new Date(Date.now() + i * 10000 + 5000).toISOString(),
          confidence: faker.number.float({ min: 0.85, max: 0.98, precision: 0.01 }),
          emotion: faker.helpers.arrayElement(['polite', 'firm', 'friendly'])
        });
      }
    }

    return {
      call_id: callId,
      turns,
      effectiveness_score: faker.number.float({ min: 0.6, max: 0.95, precision: 0.01 }),
      user_satisfaction: faker.number.float({ min: 0.7, max: 1.0, precision: 0.01 })
    };
  }

  /**
   * Generate configuration data for testing
   */
  generateConfigurationData(userId?: string): any {
    return {
      user_id: userId,
      ai_settings: {
        response_temperature: faker.number.float({ min: 0.1, max: 1.0, precision: 0.1 }),
        max_response_length: faker.number.int({ min: 50, max: 200 }),
        personality_strength: faker.number.float({ min: 0.5, max: 1.0, precision: 0.1 })
      },
      voice_settings: {
        speech_rate: faker.number.float({ min: 0.8, max: 1.2, precision: 0.1 }),
        pitch: faker.number.float({ min: -20, max: 20, precision: 1 }),
        volume: faker.number.float({ min: 0.5, max: 1.0, precision: 0.1 })
      },
      whitelist_settings: {
        auto_add_threshold: faker.number.float({ min: 0.8, max: 0.95, precision: 0.01 }),
        smart_filtering: faker.datatype.boolean(),
        learning_enabled: faker.datatype.boolean()
      },
      notification_settings: {
        email_summary: faker.datatype.boolean(),
        sms_alerts: faker.datatype.boolean(),
        call_logs_retention: faker.number.int({ min: 30, max: 365 })
      }
    };
  }

  /**
   * Generate performance test data sets
   */
  generatePerformanceTestData(options: {
    userCount: number;
    callsPerUser: number;
    contactsPerUser: number;
  }): {
    users: TestUser[];
    calls: TestCall[];
    contacts: WhitelistContact[];
  } {
    const { userCount, callsPerUser, contactsPerUser } = options;
    const users: TestUser[] = [];
    const calls: TestCall[] = [];
    const contacts: WhitelistContact[] = [];

    // Generate users
    for (let i = 0; i < userCount; i++) {
      const user = this.createTestUser();
      users.push(user);

      // Generate calls for each user
      for (let j = 0; j < callsPerUser; j++) {
        const call = this.createIncomingCall({
          called_phone: user.phone_number
        });
        calls.push(call);
      }

      // Generate contacts for each user
      const userContacts = this.createWhitelistContacts(contactsPerUser);
      contacts.push(...userContacts);
    }

    return { users, calls, contacts };
  }

  /**
   * Generate mock Azure service responses
   */
  generateMockAzureResponses(): {
    sttResponse: any;
    ttsResponse: any;
    openAIResponse: any;
  } {
    return {
      sttResponse: {
        RecognitionStatus: 'Success',
        DisplayText: '你好，我是XX银行的客服，想向您推荐我们的信用卡产品',
        Offset: 0,
        Duration: 50000000,
        NBest: [{
          Confidence: faker.number.float({ min: 0.85, max: 0.98, precision: 0.01 }),
          Lexical: '你好我是XX银行的客服想向您推荐我们的信用卡产品',
          ITN: '你好，我是XX银行的客服，想向您推荐我们的信用卡产品',
          MaskedITN: '你好，我是XX银行的客服，想向您推荐我们的信用卡产品',
          Display: '你好，我是XX银行的客服，想向您推荐我们的信用卡产品'
        }]
      },
      ttsResponse: {
        audioData: this.generateMockAudioData(),
        contentType: 'audio/wav',
        duration: faker.number.int({ min: 2000, max: 5000 })
      },
      openAIResponse: {
        choices: [{
          message: {
            role: 'assistant',
            content: '谢谢您的来电，但我现在不需要信用卡服务。祝您工作顺利，再见。'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: faker.number.int({ min: 50, max: 200 }),
          completion_tokens: faker.number.int({ min: 20, max: 100 }),
          total_tokens: faker.number.int({ min: 70, max: 300 })
        }
      }
    };
  }

  /**
   * Clean up generated data (reset counters and sets)
   */
  cleanup(): void {
    this.usedPhoneNumbers.clear();
    this.usedEmails.clear();
    this.usedCallIds.clear();
  }

  // Private helper methods

  private generateUniquePhoneNumber(): string {
    let phone: string;
    do {
      phone = this.generatePhoneNumber();
    } while (this.usedPhoneNumbers.has(phone));
    
    this.usedPhoneNumbers.add(phone);
    return phone;
  }

  private generatePhoneNumber(): string {
    // Generate Chinese mobile phone number
    const prefixes = ['130', '131', '132', '133', '134', '135', '136', '137', '138', '139',
                     '150', '151', '152', '153', '155', '156', '157', '158', '159',
                     '180', '181', '182', '183', '184', '185', '186', '187', '188', '189'];
    
    const prefix = faker.helpers.arrayElement(prefixes);
    const suffix = faker.string.numeric(8);
    return `+86${prefix}${suffix}`;
  }

  private generateUniqueEmail(): string {
    let email: string;
    do {
      email = faker.internet.email();
    } while (this.usedEmails.has(email));
    
    this.usedEmails.add(email);
    return email;
  }

  private generateSecurePassword(): string {
    const length = faker.number.int({ min: 12, max: 20 });
    const lowercase = faker.string.alpha({ length: Math.ceil(length / 4), casing: 'lower' });
    const uppercase = faker.string.alpha({ length: Math.ceil(length / 4), casing: 'upper' });
    const numbers = faker.string.numeric(Math.ceil(length / 4));
    const symbols = faker.helpers.multiple(() => 
      faker.helpers.arrayElement(['!', '@', '#', '$', '%', '^', '&', '*']), 
      { count: Math.floor(length / 4) }
    ).join('');
    
    const password = (lowercase + uppercase + numbers + symbols)
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('')
      .substring(0, length);
    
    return password;
  }

  private generateUniqueCallId(): string {
    let callId: string;
    do {
      callId = `call_${faker.string.alphanumeric(12)}`;
    } while (this.usedCallIds.has(callId));
    
    this.usedCallIds.add(callId);
    return callId;
  }

  private generateEmergencyContacts(count: number): Array<{
    name: string;
    phone: string;
    relationship: string;
  }> {
    const relationships = ['spouse', 'parent', 'child', 'sibling', 'friend', 'colleague'];
    
    return Array(count).fill(null).map(() => ({
      name: faker.person.fullName(),
      phone: this.generatePhoneNumber(),
      relationship: faker.helpers.arrayElement(relationships)
    }));
  }

  private generateMockAudioData(): string {
    // Generate base64 encoded mock audio data (1KB)
    const size = 1024;
    const bytes = Array(size).fill(null).map(() => 
      Math.floor(Math.random() * 256)
    );
    return Buffer.from(bytes).toString('base64');
  }
}

export default TestDataFactory;