/**
 * Comprehensive Azure Services Mock Implementation
 * 
 * Provides realistic mocks for Azure Communication Services, Speech Services,
 * and other Azure APIs used in the AI Answer Ninja system.
 */

import { EventEmitter } from 'events';

// Azure Communication Services Mock
export class MockAzureCommunicationService extends EventEmitter {
  private calls = new Map<string, any>();
  private recordings = new Map<string, any>();
  
  constructor() {
    super();
    this.setupEventHandlers();
  }
  
  // Call Automation API Mock
  async answerCall(callId: string, callbackUri: string) {
    const call = {
      id: callId,
      status: 'connected',
      startTime: new Date().toISOString(),
      participants: ['caller', 'ai-assistant']
    };
    
    this.calls.set(callId, call);
    
    // Simulate incoming call event
    setTimeout(() => {
      this.emit('callConnected', { callId, call });
    }, 100);
    
    return { success: true, call };
  }
  
  async hangupCall(callId: string) {
    const call = this.calls.get(callId);
    if (call) {
      call.status = 'ended';
      call.endTime = new Date().toISOString();
      this.emit('callEnded', { callId, call });
    }
    
    return { success: true };
  }
  
  async transferCall(callId: string, targetPhoneNumber: string) {
    const call = this.calls.get(callId);
    if (call) {
      call.status = 'transferred';
      call.transferTarget = targetPhoneNumber;
      this.emit('callTransferred', { callId, targetPhoneNumber });
    }
    
    return { success: true };
  }
  
  async startRecording(callId: string) {
    const recording = {
      id: `recording-${callId}`,
      callId,
      status: 'active',
      startTime: new Date().toISOString()
    };
    
    this.recordings.set(callId, recording);
    return { recordingId: recording.id, success: true };
  }
  
  async stopRecording(callId: string) {
    const recording = this.recordings.get(callId);
    if (recording) {
      recording.status = 'completed';
      recording.endTime = new Date().toISOString();
      recording.downloadUrl = `https://storage.azure.com/recordings/${recording.id}.wav`;
    }
    
    return { success: true, recording };
  }
  
  private setupEventHandlers() {
    // Simulate various call events
    setInterval(() => {
      for (const [callId, call] of this.calls.entries()) {
        if (call.status === 'connected') {
          // Randomly simulate call events
          const eventType = Math.random();
          
          if (eventType < 0.1) {
            this.emit('participantJoined', { callId, participantId: 'new-participant' });
          } else if (eventType < 0.15) {
            this.emit('participantLeft', { callId, participantId: 'caller' });
            call.status = 'ended';
          }
        }
      }
    }, 5000);
  }
  
  // Test utilities
  getCall(callId: string) {
    return this.calls.get(callId);
  }
  
  getAllCalls() {
    return Array.from(this.calls.values());
  }
  
  reset() {
    this.calls.clear();
    this.recordings.clear();
    this.removeAllListeners();
    this.setupEventHandlers();
  }
}

// Azure Speech Services Mock
export class MockAzureSpeechService {
  private recognitionResults = new Map<string, any>();
  private synthesisResults = new Map<string, any>();
  
  // Speech-to-Text Mock
  async recognizeSpeech(audioBuffer: Buffer, options: any = {}) {
    // Simulate processing delay
    await this.delay(200 + Math.random() * 300);
    
    // Mock recognition results based on audio characteristics
    const audioLength = audioBuffer.length;
    const mockResults = this.generateMockRecognitionResult(audioLength, options);
    
    const resultId = `recognition-${Date.now()}`;
    this.recognitionResults.set(resultId, mockResults);
    
    return mockResults;
  }
  
  async startContinuousRecognition(options: any = {}) {
    const sessionId = `session-${Date.now()}`;
    
    // Simulate continuous recognition
    const recognitionEmitter = new EventEmitter();
    
    setTimeout(() => {
      recognitionEmitter.emit('recognizing', {
        text: 'Hello, I am calling about...',
        confidence: 0.7
      });
      
      setTimeout(() => {
        recognitionEmitter.emit('recognized', {
          text: 'Hello, I am calling about your insurance policy.',
          confidence: 0.92,
          intent: 'insurance_sales',
          duration: 2.5
        });
      }, 500);
    }, 100);
    
    return { sessionId, recognizer: recognitionEmitter };
  }
  
  // Text-to-Speech Mock
  async synthesizeSpeech(text: string, options: any = {}) {
    // Simulate processing delay based on text length
    const processingTime = 100 + (text.length * 5);
    await this.delay(processingTime);
    
    // Generate mock audio buffer
    const mockAudioBuffer = this.generateMockAudioBuffer(text, options);
    
    const resultId = `synthesis-${Date.now()}`;
    this.synthesisResults.set(resultId, {
      audioBuffer: mockAudioBuffer,
      duration: text.length * 0.1, // Rough estimation
      quality: 0.95,
      format: options.format || 'wav'
    });
    
    return mockAudioBuffer;
  }
  
  async createCustomVoice(voiceProfile: any) {
    await this.delay(1000); // Simulate voice training delay
    
    return {
      voiceId: `custom-voice-${Date.now()}`,
      status: 'ready',
      quality: 0.88,
      trainingDuration: '45 minutes'
    };
  }
  
  private generateMockRecognitionResult(audioLength: number, options: any) {
    const mockPhrases = [
      { text: 'Hello, I am calling about insurance', intent: 'insurance_sales', confidence: 0.92 },
      { text: 'Hi there, we have a special loan offer', intent: 'loan_offer', confidence: 0.89 },
      { text: 'Good morning, would you be interested in investment', intent: 'investment_pitch', confidence: 0.85 },
      { text: 'This is regarding your recent application', intent: 'follow_up', confidence: 0.78 }
    ];
    
    const selectedPhrase = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
    
    return {
      ...selectedPhrase,
      audioLength,
      processingTime: 150 + Math.random() * 200,
      language: options.language || 'en-US',
      timestamp: new Date().toISOString()
    };
  }
  
  private generateMockAudioBuffer(text: string, options: any): Buffer {
    // Generate a realistic mock audio buffer
    const sampleRate = options.sampleRate || 16000;
    const duration = text.length * 0.1; // 100ms per character
    const bufferSize = Math.floor(sampleRate * duration);
    
    // Generate white noise as mock audio
    const buffer = Buffer.alloc(bufferSize * 2); // 16-bit audio
    
    for (let i = 0; i < bufferSize; i++) {
      const sample = Math.floor((Math.random() - 0.5) * 32767);
      buffer.writeInt16LE(sample, i * 2);
    }
    
    return buffer;
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Test utilities
  getRecognitionResult(id: string) {
    return this.recognitionResults.get(id);
  }
  
  getSynthesisResult(id: string) {
    return this.synthesisResults.get(id);
  }
  
  reset() {
    this.recognitionResults.clear();
    this.synthesisResults.clear();
  }
}

// Azure OpenAI Service Mock
export class MockAzureOpenAIService {
  private conversations = new Map<string, any[]>();
  private models = new Map<string, any>();
  
  constructor() {
    this.setupMockModels();
  }
  
  async complete(prompt: string, options: any = {}) {
    await this.delay(300 + Math.random() * 200);
    
    const response = this.generateMockCompletion(prompt, options);
    
    // Store conversation history
    const conversationId = options.conversationId || 'default';
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, []);
    }
    
    const conversation = this.conversations.get(conversationId)!;
    conversation.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: response.text }
    );
    
    return response;
  }
  
  async analyzeIntent(text: string) {
    await this.delay(100 + Math.random() * 100);
    
    const intents = [
      { intent: 'sales_call', confidence: 0.92, keywords: ['product', 'offer', 'deal'] },
      { intent: 'loan_offer', confidence: 0.89, keywords: ['loan', 'credit', 'finance'] },
      { intent: 'insurance_sales', confidence: 0.85, keywords: ['insurance', 'policy', 'coverage'] },
      { intent: 'survey', confidence: 0.78, keywords: ['survey', 'questions', 'feedback'] }
    ];
    
    // Simple keyword matching for intent classification
    const detectedIntent = intents.find(intent => 
      intent.keywords.some(keyword => 
        text.toLowerCase().includes(keyword)
      )
    ) || { intent: 'unknown', confidence: 0.5, keywords: [] };
    
    return detectedIntent;
  }
  
  async generatePersonalizedResponse(context: any) {
    await this.delay(250 + Math.random() * 150);
    
    const personality = context.userProfile?.personality || 'polite';
    const intent = context.intent || 'unknown';
    
    const responses = this.getResponseTemplates(personality, intent);
    const selectedResponse = responses[Math.floor(Math.random() * responses.length)];
    
    return {
      text: selectedResponse,
      personality,
      intent,
      confidence: 0.87,
      shouldTerminate: this.shouldTerminateCall(context)
    };
  }
  
  private generateMockCompletion(prompt: string, options: any) {
    const responses = [
      "I appreciate the call, but I'm not interested at this time. Thank you for understanding.",
      "Thanks for reaching out, but I already have what I need. Have a great day!",
      "I'm not available to discuss this right now. Please remove my number from your list.",
      "While I appreciate the offer, it's not something I'm looking for. Thanks anyway."
    ];
    
    const selectedResponse = responses[Math.floor(Math.random() * responses.length)];
    
    return {
      text: selectedResponse,
      tokens: selectedResponse.split(' ').length,
      model: options.model || 'gpt-4',
      processingTime: 280 + Math.random() * 140,
      confidence: 0.85 + Math.random() * 0.1
    };
  }
  
  private getResponseTemplates(personality: string, intent: string): string[] {
    const templates = {
      polite: {
        sales_call: [
          "Thank you for the call, but I'm not interested in this offer at the moment.",
          "I appreciate you reaching out, but this isn't something I need right now."
        ],
        loan_offer: [
          "Thanks for the offer, but I'm not looking for a loan at this time.",
          "I appreciate the information, but I don't need financing right now."
        ],
        default: [
          "Thank you for calling, but I'm not interested. Have a good day."
        ]
      },
      direct: {
        sales_call: [
          "I'm not interested. Please remove my number from your list.",
          "No thank you. Don't call again."
        ],
        loan_offer: [
          "I don't need a loan. Stop calling.",
          "Not interested. Remove my number."
        ],
        default: [
          "Not interested. Goodbye."
        ]
      }
    };
    
    const personalityTemplates = templates[personality as keyof typeof templates] || templates.polite;
    return personalityTemplates[intent as keyof typeof personalityTemplates] || personalityTemplates.default;
  }
  
  private shouldTerminateCall(context: any): boolean {
    const turnCount = context.turnCount || 0;
    const persistenceLevel = context.persistenceLevel || 0;
    
    return turnCount >= 3 || persistenceLevel > 0.8;
  }
  
  private setupMockModels() {
    this.models.set('gpt-4', {
      name: 'GPT-4',
      maxTokens: 4000,
      averageLatency: 300,
      accuracy: 0.92
    });
    
    this.models.set('gpt-3.5-turbo', {
      name: 'GPT-3.5 Turbo',
      maxTokens: 2000,
      averageLatency: 150,
      accuracy: 0.87
    });
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Test utilities
  getConversation(id: string) {
    return this.conversations.get(id);
  }
  
  getAllConversations() {
    return Array.from(this.conversations.entries());
  }
  
  reset() {
    this.conversations.clear();
  }
}

// Azure Storage Mock
export class MockAzureStorageService {
  private blobs = new Map<string, any>();
  
  async uploadBlob(containerName: string, blobName: string, data: Buffer) {
    await this.delay(100 + Math.random() * 50);
    
    const blob = {
      name: blobName,
      container: containerName,
      size: data.length,
      contentType: this.getContentType(blobName),
      uploadTime: new Date().toISOString(),
      url: `https://mockstorageaccount.blob.core.windows.net/${containerName}/${blobName}`
    };
    
    this.blobs.set(`${containerName}/${blobName}`, blob);
    
    return {
      success: true,
      blob,
      url: blob.url
    };
  }
  
  async downloadBlob(containerName: string, blobName: string) {
    await this.delay(50 + Math.random() * 25);
    
    const blobKey = `${containerName}/${blobName}`;
    const blob = this.blobs.get(blobKey);
    
    if (!blob) {
      throw new Error(`Blob not found: ${blobKey}`);
    }
    
    // Generate mock data
    const mockData = Buffer.alloc(blob.size);
    return { success: true, data: mockData, blob };
  }
  
  async deleteBlob(containerName: string, blobName: string) {
    const blobKey = `${containerName}/${blobName}`;
    const existed = this.blobs.delete(blobKey);
    
    return { success: true, existed };
  }
  
  async listBlobs(containerName: string) {
    const containerBlobs = Array.from(this.blobs.values())
      .filter(blob => blob.container === containerName);
    
    return { success: true, blobs: containerBlobs };
  }
  
  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const contentTypes: { [key: string]: string } = {
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg',
      'json': 'application/json',
      'txt': 'text/plain'
    };
    
    return contentTypes[ext || 'txt'] || 'application/octet-stream';
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Test utilities
  getBlob(containerName: string, blobName: string) {
    return this.blobs.get(`${containerName}/${blobName}`);
  }
  
  getAllBlobs() {
    return Array.from(this.blobs.values());
  }
  
  reset() {
    this.blobs.clear();
  }
}

// Unified Azure Services Mock Factory
export class AzureServicesMockFactory {
  private static instances = new Map<string, any>();
  
  static getCommunicationService(): MockAzureCommunicationService {
    if (!this.instances.has('communication')) {
      this.instances.set('communication', new MockAzureCommunicationService());
    }
    return this.instances.get('communication');
  }
  
  static getSpeechService(): MockAzureSpeechService {
    if (!this.instances.has('speech')) {
      this.instances.set('speech', new MockAzureSpeechService());
    }
    return this.instances.get('speech');
  }
  
  static getOpenAIService(): MockAzureOpenAIService {
    if (!this.instances.has('openai')) {
      this.instances.set('openai', new MockAzureOpenAIService());
    }
    return this.instances.get('openai');
  }
  
  static getStorageService(): MockAzureStorageService {
    if (!this.instances.has('storage')) {
      this.instances.set('storage', new MockAzureStorageService());
    }
    return this.instances.get('storage');
  }
  
  static resetAll() {
    for (const service of this.instances.values()) {
      if (service.reset) {
        service.reset();
      }
    }
  }
  
  static clearAll() {
    this.resetAll();
    this.instances.clear();
  }
}

export {
  MockAzureCommunicationService,
  MockAzureSpeechService, 
  MockAzureOpenAIService,
  MockAzureStorageService
};