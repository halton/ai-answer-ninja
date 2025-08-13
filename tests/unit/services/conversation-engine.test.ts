/**
 * Unit Tests for Conversation Engine Service
 * 
 * Tests AI conversation management, intent classification, 
 * personalized response generation, and conversation flow control.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { AzureServicesMockFactory } from '../../mocks/azure-services.mock';

// Mock Azure OpenAI and related services
jest.mock('@azure/openai');
jest.mock('../../../services/conversation-engine/src/services/azure_openai');

describe('Conversation Engine Service', () => {
  let app: any;
  let mockAzureOpenAI: any;
  let mockStateManager: any;

  beforeEach(async () => {
    // Setup mocks
    mockAzureOpenAI = AzureServicesMockFactory.getOpenAIService();
    mockStateManager = {
      getConversationState: jest.fn(),
      updateConversationState: jest.fn(),
      shouldTerminateConversation: jest.fn()
    };

    // Reset all mocks
    jest.clearAllMocks();
    AzureServicesMockFactory.resetAll();

    // Import app after mocks
    const conversationModule = await import('../../../services/conversation-engine/src/server');
    app = conversationModule.default || conversationModule.app;
  });

  afterEach(() => {
    AzureServicesMockFactory.clearAll();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toBeHealthy();
      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'conversation-engine',
        timestamp: expect.any(String)
      });
    });

    it('should check Azure OpenAI service health', async () => {
      mockAzureOpenAI.checkHealth = jest.fn().mockResolvedValue({ status: 'healthy' });

      const response = await request(app)
        .get('/health/detailed')
        .expect(200);

      expect(response.body.dependencies).toContainEqual(
        expect.objectContaining({
          name: 'azure-openai',
          status: 'healthy'
        })
      );
    });
  });

  describe('Intent Classification', () => {
    it('should classify spam call intents accurately', async () => {
      const testCases = [
        {
          text: 'Hello, I am calling about loan opportunities with low interest rates',
          expectedIntent: 'loan_offer',
          expectedConfidence: 0.85
        },
        {
          text: 'We have exclusive investment products that can double your money',
          expectedIntent: 'investment_pitch',
          expectedConfidence: 0.90
        },
        {
          text: 'This is regarding your car insurance policy renewal',
          expectedIntent: 'insurance_sales',
          expectedConfidence: 0.88
        },
        {
          text: 'Special promotion on our premium products just for you',
          expectedIntent: 'sales_call',
          expectedConfidence: 0.82
        }
      ];

      for (const testCase of testCases) {
        mockAzureOpenAI.classifyIntent = jest.fn().mockResolvedValue({
          intent: testCase.expectedIntent,
          confidence: testCase.expectedConfidence,
          categories: [testCase.expectedIntent],
          reasoning: `Detected ${testCase.expectedIntent} based on key phrases`
        });

        const response = await request(app)
          .post('/conversation/classify-intent')
          .send({
            text: testCase.text,
            context: { callId: 'test-call-123' }
          })
          .expect(200);

        expect(response.body.result).toRecognizeIntentWithConfidence(
          testCase.expectedIntent,
          testCase.expectedConfidence
        );

        expect(mockAzureOpenAI.classifyIntent).toHaveBeenCalledWith(
          testCase.text,
          expect.objectContaining({
            language: 'en-US',
            domain: 'spam_calls'
          })
        );
      }
    });

    it('should handle ambiguous or unclear input', async () => {
      const ambiguousText = 'Um... hello... this is... uh... about something...';

      mockAzureOpenAI.classifyIntent = jest.fn().mockResolvedValue({
        intent: 'unknown',
        confidence: 0.25,
        categories: ['unknown'],
        reasoning: 'Insufficient information to classify intent'
      });

      const response = await request(app)
        .post('/conversation/classify-intent')
        .send({
          text: ambiguousText,
          context: { callId: 'test-call-ambiguous' }
        })
        .expect(200);

      expect(response.body.result.confidence).toBeLessThan(0.5);
      expect(response.body.result.intent).toBe('unknown');
    });
  });

  describe('Personalized Response Generation', () => {
    it('should generate polite responses for polite personality', async () => {
      const userProfile = {
        personality: 'polite',
        name: 'John Doe',
        preferences: {
          responseStyle: 'courteous',
          maxResponseLength: 'medium'
        }
      };

      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockResolvedValue({
        text: 'Thank you for calling, but I\'m not interested in insurance services at this time. Have a great day!',
        confidence: 0.88,
        responseType: 'polite_decline',
        shouldTerminate: false
      });

      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'Hello, I am calling about your insurance policy',
          intent: 'insurance_sales',
          userProfile,
          conversationHistory: []
        })
        .expect(200);

      expect(response.body.response.text).toContain('Thank you');
      expect(response.body.response.text).not.toMatch(/\b(no|don't|won't)\b/i);
      expect(response.body.response.responseType).toBe('polite_decline');
      expect(response.body.response.confidence).toBeGreaterThan(0.8);
    });

    it('should generate direct responses for direct personality', async () => {
      const userProfile = {
        personality: 'direct',
        name: 'Jane Smith',
        preferences: {
          responseStyle: 'straightforward',
          maxResponseLength: 'short'
        }
      };

      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockResolvedValue({
        text: 'Not interested. Please remove my number from your list.',
        confidence: 0.92,
        responseType: 'direct_decline',
        shouldTerminate: true
      });

      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'We have great loan offers for you',
          intent: 'loan_offer',
          userProfile,
          conversationHistory: []
        })
        .expect(200);

      expect(response.body.response.text.length).toBeLessThan(100);
      expect(response.body.response.responseType).toBe('direct_decline');
      expect(response.body.response.shouldTerminate).toBe(true);
    });

    it('should generate humorous responses for humorous personality', async () => {
      const userProfile = {
        personality: 'humorous',
        name: 'Bob Wilson',
        preferences: {
          responseStyle: 'witty',
          maxResponseLength: 'medium'
        }
      };

      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockResolvedValue({
        text: 'I\'m actually in the market for a time machine, not investments. Do you happen to sell those?',
        confidence: 0.85,
        responseType: 'humorous_deflection',
        shouldTerminate: false
      });

      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'I have some investment opportunities for you',
          intent: 'investment_pitch',
          userProfile,
          conversationHistory: []
        })
        .expect(200);

      expect(response.body.response.responseType).toBe('humorous_deflection');
      expect(response.body.response.text).toMatch(/time machine|sell those/);
    });
  });

  describe('Conversation State Management', () => {
    it('should track conversation flow and escalation', async () => {
      mockStateManager.getConversationState = jest.fn().mockResolvedValue({
        stage: 'initial',
        turnCount: 0,
        lastIntent: null,
        persistenceLevel: 0.0,
        startTime: Date.now()
      });

      mockStateManager.updateConversationState = jest.fn().mockResolvedValue({
        stage: 'handling_sales',
        turnCount: 1,
        lastIntent: 'sales_call',
        persistenceLevel: 0.3,
        startTime: expect.any(Number)
      });

      const response = await request(app)
        .post('/conversation/manage')
        .send({
          callId: 'test-call-flow',
          recognizedText: 'Hello, I am calling about our products',
          intent: 'sales_call',
          userProfile: { personality: 'polite' }
        })
        .expect(200);

      expect(mockStateManager.getConversationState).toHaveBeenCalledWith('test-call-flow');
      expect(mockStateManager.updateConversationState).toHaveBeenCalledWith(
        'test-call-flow',
        expect.objectContaining({
          stage: expect.any(String),
          turnCount: expect.any(Number),
          lastIntent: 'sales_call'
        })
      );
    });

    it('should detect caller persistence and escalate response', async () => {
      const conversationHistory = [
        { speaker: 'caller', text: 'Hello, I have great loan offers', intent: 'loan_offer' },
        { speaker: 'ai', text: 'Not interested, thank you', responseType: 'polite_decline' },
        { speaker: 'caller', text: 'But wait, these are special rates', intent: 'loan_offer' },
        { speaker: 'ai', text: 'I said I\'m not interested', responseType: 'firm_decline' },
        { speaker: 'caller', text: 'Just hear me out for a second', intent: 'loan_offer' }
      ];

      mockStateManager.getConversationState = jest.fn().mockResolvedValue({
        stage: 'firm_rejection',
        turnCount: 5,
        lastIntent: 'loan_offer',
        persistenceLevel: 0.8,
        startTime: Date.now() - 60000
      });

      mockStateManager.shouldTerminateConversation = jest.fn().mockResolvedValue({
        shouldTerminate: true,
        reason: 'excessive_persistence',
        confidence: 0.92
      });

      const response = await request(app)
        .post('/conversation/manage')
        .send({
          callId: 'test-call-persistent',
          recognizedText: 'Just hear me out for a second',
          intent: 'loan_offer',
          conversationHistory,
          userProfile: { personality: 'polite' }
        })
        .expect(200);

      expect(response.body.shouldTerminate).toBe(true);
      expect(response.body.terminationReason).toBe('excessive_persistence');
    });

    it('should handle conversation timeout', async () => {
      const longConversationStart = Date.now() - 4 * 60 * 1000; // 4 minutes ago

      mockStateManager.getConversationState = jest.fn().mockResolvedValue({
        stage: 'extended_conversation',
        turnCount: 15,
        lastIntent: 'sales_call',
        persistenceLevel: 0.6,
        startTime: longConversationStart
      });

      mockStateManager.shouldTerminateConversation = jest.fn().mockResolvedValue({
        shouldTerminate: true,
        reason: 'max_duration_exceeded',
        confidence: 1.0
      });

      const response = await request(app)
        .post('/conversation/manage')
        .send({
          callId: 'test-call-timeout',
          recognizedText: 'Let me explain more about our services',
          intent: 'sales_call',
          userProfile: { personality: 'polite' }
        })
        .expect(200);

      expect(response.body.shouldTerminate).toBe(true);
      expect(response.body.terminationReason).toBe('max_duration_exceeded');
    });
  });

  describe('Emotion Analysis', () => {
    it('should detect caller frustration and adjust response', async () => {
      mockAzureOpenAI.analyzeEmotion = jest.fn().mockResolvedValue({
        primaryEmotion: 'frustration',
        confidence: 0.85,
        intensity: 0.7,
        emotionalTone: 'aggressive'
      });

      const response = await request(app)
        .post('/conversation/emotion')
        .send({
          audioFeatures: {
            pitch: 'high',
            volume: 'loud',
            pace: 'fast'
          },
          textContent: 'Look, I just need you to listen to me for one minute!',
          callId: 'test-emotion-analysis'
        })
        .expect(200);

      expect(response.body.emotion.primaryEmotion).toBe('frustration');
      expect(response.body.emotion.intensity).toBeGreaterThan(0.6);
      expect(response.body.recommendedStrategy).toContain('de_escalation');
    });

    it('should detect caller politeness and respond appropriately', async () => {
      mockAzureOpenAI.analyzeEmotion = jest.fn().mockResolvedValue({
        primaryEmotion: 'neutral',
        confidence: 0.78,
        intensity: 0.3,
        emotionalTone: 'polite'
      });

      const response = await request(app)
        .post('/conversation/emotion')
        .send({
          audioFeatures: {
            pitch: 'normal',
            volume: 'moderate',
            pace: 'normal'
          },
          textContent: 'Good morning, I hope I\'m not disturbing you. I wanted to discuss our services.',
          callId: 'test-polite-caller'
        })
        .expect(200);

      expect(response.body.emotion.emotionalTone).toBe('polite');
      expect(response.body.recommendedStrategy).toContain('maintain_politeness');
    });
  });

  describe('Conversation Termination Logic', () => {
    it('should determine when to terminate based on multiple factors', async () => {
      const terminationRequest = {
        callId: 'test-termination',
        conversationState: {
          stage: 'firm_rejection',
          turnCount: 8,
          lastIntent: 'sales_call',
          persistenceLevel: 0.85,
          startTime: Date.now() - 180000, // 3 minutes
          duration: 180000
        },
        callerEmotion: {
          primaryEmotion: 'frustration',
          intensity: 0.8
        },
        aiResponseEffectiveness: 0.2 // Low effectiveness
      };

      mockStateManager.shouldTerminateConversation = jest.fn().mockImplementation((request) => {
        const factors = {
          maxTurns: request.conversationState.turnCount > 10,
          maxDuration: request.conversationState.duration > 180000,
          highPersistence: request.conversationState.persistenceLevel > 0.8,
          lowEffectiveness: request.aiResponseEffectiveness < 0.3,
          callerFrustration: request.callerEmotion.intensity > 0.7
        };

        const shouldTerminate = Object.values(factors).filter(Boolean).length >= 2;

        return Promise.resolve({
          shouldTerminate,
          reason: shouldTerminate ? 'multiple_termination_criteria' : null,
          confidence: 0.9,
          factors
        });
      });

      const response = await request(app)
        .post('/conversation/terminate')
        .send(terminationRequest)
        .expect(200);

      expect(response.body.shouldTerminate).toBe(true);
      expect(response.body.reason).toBe('multiple_termination_criteria');
      expect(response.body.factors.highPersistence).toBe(true);
      expect(response.body.factors.maxDuration).toBe(true);
    });

    it('should generate appropriate final response when terminating', async () => {
      mockAzureOpenAI.generateFinalResponse = jest.fn().mockResolvedValue({
        text: 'I\'ve made it clear that I\'m not interested. Please don\'t call again. Goodbye.',
        confidence: 0.95,
        tone: 'firm_but_polite',
        includesDoNotCall: true
      });

      const response = await request(app)
        .post('/conversation/generate-final-response')
        .send({
          terminationReason: 'excessive_persistence',
          conversationHistory: [
            { speaker: 'caller', text: 'But you should really consider this offer' },
            { speaker: 'ai', text: 'I\'ve already said no several times' },
            { speaker: 'caller', text: 'Just one more minute of your time' }
          ],
          userProfile: { personality: 'polite' }
        })
        .expect(200);

      expect(response.body.finalResponse.includesDoNotCall).toBe(true);
      expect(response.body.finalResponse.tone).toBe('firm_but_polite');
      expect(response.body.finalResponse.text).toContain('don\'t call again');
    });
  });

  describe('Performance and Latency Tests', () => {
    it('should generate responses within latency requirements', async () => {
      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockResolvedValue({
        text: 'Thank you, but I\'m not interested.',
        confidence: 0.9,
        responseType: 'polite_decline',
        processingTime: 150
      });

      const responseGeneration = request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'I have great investment opportunities',
          intent: 'investment_pitch',
          userProfile: { personality: 'polite' },
          conversationHistory: []
        });

      await expect(responseGeneration).toCompleteWithinMs(300); // 300ms requirement for AI generation
    });

    it('should handle concurrent conversation requests', async () => {
      const concurrentRequests = 10;
      const promises = [];

      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockResolvedValue({
        text: 'Concurrent response',
        confidence: 0.85,
        responseType: 'polite_decline'
      });

      for (let i = 0; i < concurrentRequests; i++) {
        const promise = request(app)
          .post('/conversation/generate-response')
          .send({
            recognizedText: `Concurrent request ${i}`,
            intent: 'sales_call',
            userProfile: { personality: 'polite' },
            conversationHistory: []
          });

        promises.push(promise);
      }

      const results = await Promise.all(promises);

      results.forEach((result, index) => {
        expect(result.status).toBe(200);
        expect(result.body.response.text).toBe('Concurrent response');
      });

      expect(mockAzureOpenAI.generatePersonalizedResponse).toHaveBeenCalledTimes(concurrentRequests);
    });
  });

  describe('Context and Memory Management', () => {
    it('should maintain conversation context across turns', async () => {
      const conversationHistory = [
        { speaker: 'caller', text: 'Hello, I\'m calling about loans', intent: 'loan_offer', timestamp: Date.now() - 30000 },
        { speaker: 'ai', text: 'I\'m not interested in loans', responseType: 'polite_decline', timestamp: Date.now() - 25000 },
        { speaker: 'caller', text: 'What about credit cards then?', intent: 'credit_offer', timestamp: Date.now() - 20000 }
      ];

      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockResolvedValue({
        text: 'As I mentioned, I\'m not interested in any financial services.',
        confidence: 0.88,
        responseType: 'consistent_decline',
        contextAware: true
      });

      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'What about credit cards then?',
          intent: 'credit_offer',
          conversationHistory,
          userProfile: { personality: 'polite' }
        })
        .expect(200);

      expect(response.body.response.contextAware).toBe(true);
      expect(response.body.response.text).toContain('As I mentioned');

      // Verify that conversation history was passed to the AI service
      expect(mockAzureOpenAI.generatePersonalizedResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ intent: 'loan_offer' }),
            expect.objectContaining({ responseType: 'polite_decline' })
          ])
        })
      );
    });

    it('should clean up old conversation data', async () => {
      const oldConversationId = 'old-conversation-123';
      const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

      const response = await request(app)
        .post('/conversation/cleanup')
        .send({
          cutoffTime,
          maxConversations: 1000
        })
        .expect(200);

      expect(response.body.cleanupResult).toMatchObject({
        cleanedConversations: expect.any(Number),
        remainingConversations: expect.any(Number),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Azure OpenAI service failures', async () => {
      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockRejectedValue(
        new Error('Azure OpenAI service rate limit exceeded')
      );

      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'Hello, I have an offer for you',
          intent: 'sales_call',
          userProfile: { personality: 'polite' }
        })
        .expect(500);

      expect(response.body.error).toContain('AI service temporarily unavailable');
      expect(response.body.fallbackResponse).toBeTruthy();
    });

    it('should provide fallback responses when AI fails', async () => {
      mockAzureOpenAI.generatePersonalizedResponse = jest.fn().mockRejectedValue(
        new Error('Service timeout')
      );

      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          recognizedText: 'I have insurance offers',
          intent: 'insurance_sales',
          userProfile: { personality: 'polite' }
        })
        .expect(200); // Should succeed with fallback

      expect(response.body.response.text).toBeTruthy();
      expect(response.body.response.isFallback).toBe(true);
      expect(response.body.response.confidence).toBeLessThan(0.8);
    });

    it('should handle malformed input gracefully', async () => {
      const response = await request(app)
        .post('/conversation/generate-response')
        .send({
          // Missing required fields
          intent: 'sales_call'
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid request format');
    });
  });
});

describe('Conversation Engine Learning System', () => {
  let mockLearningService: any;

  beforeEach(() => {
    mockLearningService = {
      analyzeConversationEffectiveness: jest.fn(),
      updateResponseStrategies: jest.fn(),
      improveIntentRecognition: jest.fn()
    };
  });

  it('should analyze conversation effectiveness', async () => {
    const conversationRecord = {
      callId: 'learning-test-123',
      duration: 45000, // 45 seconds
      turnCount: 3,
      terminationReason: 'caller_hangup',
      userSatisfaction: 0.9,
      aiResponseQuality: 0.85,
      conversations: [
        { speaker: 'caller', text: 'Hello, loan offers', intent: 'loan_offer' },
        { speaker: 'ai', text: 'Not interested, thank you', effectiveness: 0.9 },
        { speaker: 'caller', text: 'Okay, goodbye', intent: 'goodbye' }
      ]
    };

    mockLearningService.analyzeConversationEffectiveness = jest.fn().mockResolvedValue({
      effectivenessScore: 0.88,
      metrics: {
        callDuration: 45000,
        turnCount: 3,
        terminationReason: 'caller_hangup',
        responseCoherence: 0.9
      },
      successful: true
    });

    const app = await import('../../../services/conversation-engine/src/server');

    const response = await request(app.default || app.app)
      .post('/conversation/analyze-effectiveness')
      .send({ conversationRecord })
      .expect(200);

    expect(response.body.effectiveness.successful).toBe(true);
    expect(response.body.effectiveness.effectivenessScore).toBeGreaterThan(0.8);
  });

  it('should learn from successful conversation patterns', async () => {
    const successfulConversations = [
      {
        intent: 'loan_offer',
        userPersonality: 'polite',
        responseStrategy: 'gentle_decline',
        effectiveness: 0.92,
        outcome: 'successful_termination'
      },
      {
        intent: 'insurance_sales',
        userPersonality: 'direct',
        responseStrategy: 'firm_decline',
        effectiveness: 0.88,
        outcome: 'successful_termination'
      }
    ];

    mockLearningService.updateResponseStrategies = jest.fn().mockResolvedValue({
      updatedStrategies: 2,
      improvements: [
        { intent: 'loan_offer', personality: 'polite', confidence: 0.95 },
        { intent: 'insurance_sales', personality: 'direct', confidence: 0.91 }
      ]
    });

    const app = await import('../../../services/conversation-engine/src/server');

    const response = await request(app.default || app.app)
      .post('/conversation/learn-from-patterns')
      .send({ conversations: successfulConversations })
      .expect(200);

    expect(response.body.learningResult.updatedStrategies).toBe(2);
    expect(response.body.learningResult.improvements).toHaveLength(2);
  });
});