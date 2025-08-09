/**
 * Azure Services Mock Implementation
 * Provides realistic mock responses for Azure Speech, OpenAI, and Communication Services
 */

import { EventEmitter } from 'events';
import { faker } from '@faker-js/faker';

// Azure Speech Service Mock
export interface SpeechToTextResult {
  text: string;
  confidence: number;
  offset: number;
  duration: number;
  language: string;
  displayText: string;
}

export interface TextToSpeechResult {
  audioData: Buffer;
  format: string;
  sampleRate: number;
  channels: number;
}

export class AzureSpeechServiceMock {
  private isConnected: boolean = false;
  private recognitionActive: boolean = false;
  private synthesisQueue: Array<{ text: string; resolve: Function; reject: Function }> = [];

  constructor(
    private subscriptionKey: string = 'mock_key',
    private region: string = 'eastus'
  ) {}

  /**
   * Mock Speech-to-Text recognition
   */
  public async recognizeOnceAsync(audioData: Buffer | string): Promise<SpeechToTextResult> {
    // Simulate processing delay
    await this.delay(faker.number.int({ min: 150, max: 400 }));

    // Generate realistic transcription based on audio characteristics
    const mockTranscriptions = [
      "您好，我是XX公司的，想了解一下您对我们新产品的兴趣",
      "Hello, I'm calling from XYZ company about our special offer",
      "我们有一个投资机会，收益很不错",
      "This is regarding your loan application",
      "我现在不方便接听电话",
      "I'm not interested, thank you",
      "请把我从您的通话名单中删除",
      "Please remove my number from your list"
    ];

    const text = faker.helpers.arrayElement(mockTranscriptions);
    const confidence = faker.number.float({ min: 0.7, max: 0.98, multipleOf: 0.01 });

    return {
      text,
      confidence,
      offset: 0,
      duration: faker.number.int({ min: 1000, max: 5000 }),
      language: text.match(/[\u4e00-\u9fff]/) ? 'zh-CN' : 'en-US',
      displayText: text
    };
  }

  /**
   * Mock continuous Speech-to-Text recognition
   */
  public startContinuousRecognitionAsync(): Promise<void> {
    return new Promise((resolve) => {
      this.recognitionActive = true;
      resolve();
      
      // Simulate continuous recognition events
      this.simulateContinuousRecognition();
    });
  }

  public async stopContinuousRecognitionAsync(): Promise<void> {
    this.recognitionActive = false;
  }

  private simulateContinuousRecognition(): void {
    if (!this.recognitionActive) return;

    setTimeout(async () => {
      if (this.recognitionActive) {
        const result = await this.recognizeOnceAsync('');
        this.emit('recognized', result);
        this.simulateContinuousRecognition();
      }
    }, faker.number.int({ min: 2000, max: 8000 }));
  }

  /**
   * Mock Text-to-Speech synthesis
   */
  public async synthesizeTextToSpeechAsync(
    text: string,
    voice: string = 'zh-CN-XiaoxiaoNeural'
  ): Promise<TextToSpeechResult> {
    // Simulate processing delay based on text length
    const processingDelay = Math.min(text.length * 10, 2000);
    await this.delay(processingDelay);

    // Generate mock audio data (random bytes representing audio)
    const estimatedAudioLength = text.length * 50; // Rough estimate
    const audioData = Buffer.from(faker.string.sample(estimatedAudioLength));

    return {
      audioData,
      format: 'audio/wav',
      sampleRate: 16000,
      channels: 1
    };
  }

  /**
   * Mock streaming synthesis
   */
  public async synthesizeTextToSpeechStreamAsync(
    text: string,
    voice: string = 'zh-CN-XiaoxiaoNeural'
  ): Promise<ReadableStream> {
    await this.delay(faker.number.int({ min: 100, max: 300 }));

    // Create a mock readable stream
    const stream = new ReadableStream({
      start(controller) {
        const chunks = Math.ceil(text.length / 10);
        let chunkIndex = 0;

        const sendChunk = () => {
          if (chunkIndex < chunks) {
            const chunkData = faker.string.sample(100);
            controller.enqueue(new TextEncoder().encode(chunkData));
            chunkIndex++;
            setTimeout(sendChunk, faker.number.int({ min: 50, max: 200 }));
          } else {
            controller.close();
          }
        };

        sendChunk();
      }
    });

    return stream;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private emit(event: string, data: any): void {
    // Mock event emission - in real implementation, this would use EventEmitter
    console.log(`Mock Azure Speech Event: ${event}`, data);
  }
}

// Azure OpenAI Service Mock
export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatCompletionMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class AzureOpenAIServiceMock {
  constructor(
    private endpoint: string = 'https://mock-openai.openai.azure.com',
    private apiKey: string = 'mock_api_key',
    private apiVersion: string = '2024-02-15-preview'
  ) {}

  /**
   * Mock chat completion
   */
  public async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Simulate processing delay based on complexity
    const processingDelay = faker.number.int({ min: 200, max: 800 });
    await this.delay(processingDelay);

    // Generate contextually appropriate response based on the conversation
    const lastMessage = request.messages[request.messages.length - 1];
    const response = this.generateContextualResponse(lastMessage.content, request.messages);

    const completionTokens = faker.number.int({ min: 10, max: 50 });
    const promptTokens = faker.number.int({ min: 20, max: 100 });

    return {
      id: `chatcmpl-${faker.string.alphanumeric(29)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };
  }

  /**
   * Mock streaming chat completion
   */
  public async createStreamingChatCompletion(request: ChatCompletionRequest): Promise<ReadableStream> {
    const lastMessage = request.messages[request.messages.length - 1];
    const response = this.generateContextualResponse(lastMessage.content, request.messages);
    const words = response.split(' ');

    return new ReadableStream({
      start(controller) {
        let wordIndex = 0;

        const sendWord = () => {
          if (wordIndex < words.length) {
            const chunk = {
              id: `chatcmpl-${faker.string.alphanumeric(29)}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: words[wordIndex] + ' '
                  },
                  finish_reason: null
                }
              ]
            };

            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
            wordIndex++;
            setTimeout(sendWord, faker.number.int({ min: 50, max: 150 }));
          } else {
            // Send final chunk
            const finalChunk = {
              id: `chatcmpl-${faker.string.alphanumeric(29)}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }
              ]
            };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          }
        };

        setTimeout(sendWord, faker.number.int({ min: 100, max: 300 }));
      }
    });
  }

  private generateContextualResponse(userMessage: string, conversationHistory: ChatCompletionMessage[]): string {
    // Analyze the conversation context and user message to generate appropriate responses
    const messageContent = userMessage.toLowerCase();

    // Sales call responses
    if (messageContent.includes('产品') || messageContent.includes('优惠') || messageContent.includes('product') || messageContent.includes('offer')) {
      return faker.helpers.arrayElement([
        "谢谢您的介绍，但我现在没有这方面的需求。",
        "Thank you for the information, but I'm not interested at this time.",
        "我现在不方便详细了解，谢谢。",
        "I appreciate the call, but I'm not looking for new products right now."
      ]);
    }

    // Loan offer responses
    if (messageContent.includes('贷款') || messageContent.includes('借款') || messageContent.includes('loan') || messageContent.includes('credit')) {
      return faker.helpers.arrayElement([
        "我不需要贷款服务，谢谢。",
        "I don't need any loan services, thank you.",
        "我的财务状况很好，不需要借款。",
        "My financial situation is fine, I don't need any loans."
      ]);
    }

    // Investment responses
    if (messageContent.includes('投资') || messageContent.includes('理财') || messageContent.includes('investment') || messageContent.includes('financial')) {
      return faker.helpers.arrayElement([
        "我对投资不感兴趣，谢谢。",
        "I'm not interested in investment opportunities, thank you.",
        "我已经有自己的理财规划了。",
        "I already have my own financial planning."
      ]);
    }

    // Persistent caller responses
    if (conversationHistory.length > 4) {
      return faker.helpers.arrayElement([
        "我已经说得很清楚了，请不要再打扰我。",
        "I've made it very clear, please don't disturb me anymore.",
        "请把我的号码从你们的通话名单中删除。",
        "Please remove my number from your calling list."
      ]);
    }

    // General polite decline
    return faker.helpers.arrayElement([
      "不好意思，我现在不方便。",
      "Sorry, it's not convenient for me right now.",
      "谢谢，但我不感兴趣。",
      "Thank you, but I'm not interested.",
      "我现在有事要忙，先挂了。",
      "I'm busy right now, I have to hang up."
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Azure Communication Services Mock
export interface CallConnectionProperties {
  callConnectionId: string;
  serverCallId: string;
  targets: string[];
  callConnectionState: 'connecting' | 'connected' | 'transferring' | 'disconnected';
  subject: string;
  callbackUri: string;
}

export interface AnswerCallRequest {
  incomingCallContext: string;
  callbackUri: string;
  mediaStreamingConfiguration?: any;
  transcriptionConfiguration?: any;
}

export class AzureCommunicationServiceMock {
  private activeConnections: Map<string, CallConnectionProperties> = new Map();

  constructor(
    private connectionString: string = 'mock_connection_string'
  ) {}

  /**
   * Mock answer call
   */
  public async answerCall(request: AnswerCallRequest): Promise<CallConnectionProperties> {
    await this.delay(faker.number.int({ min: 500, max: 1500 }));

    const callConnectionId = faker.string.uuid();
    const serverCallId = faker.string.uuid();

    const connection: CallConnectionProperties = {
      callConnectionId,
      serverCallId,
      targets: [faker.phone.number()],
      callConnectionState: 'connected',
      subject: 'Incoming Call',
      callbackUri: request.callbackUri
    };

    this.activeConnections.set(callConnectionId, connection);

    // Simulate call events
    this.simulateCallEvents(callConnectionId);

    return connection;
  }

  /**
   * Mock hang up call
   */
  public async hangUpCall(callConnectionId: string): Promise<void> {
    await this.delay(faker.number.int({ min: 100, max: 500 }));

    const connection = this.activeConnections.get(callConnectionId);
    if (connection) {
      connection.callConnectionState = 'disconnected';
      this.activeConnections.set(callConnectionId, connection);
    }
  }

  /**
   * Mock transfer call
   */
  public async transferCallToParticipant(
    callConnectionId: string,
    targetPhoneNumber: string
  ): Promise<void> {
    await this.delay(faker.number.int({ min: 800, max: 2000 }));

    const connection = this.activeConnections.get(callConnectionId);
    if (connection) {
      connection.callConnectionState = 'transferring';
      this.activeConnections.set(callConnectionId, connection);

      // Simulate transfer completion
      setTimeout(() => {
        if (connection) {
          connection.callConnectionState = 'connected';
          connection.targets = [targetPhoneNumber];
          this.activeConnections.set(callConnectionId, connection);
        }
      }, faker.number.int({ min: 1000, max: 3000 }));
    }
  }

  /**
   * Mock play audio
   */
  public async playAudio(
    callConnectionId: string,
    audioUri: string,
    playToAll: boolean = true
  ): Promise<void> {
    await this.delay(faker.number.int({ min: 200, max: 800 }));

    // Simulate audio playback completion
    setTimeout(() => {
      this.simulatePlayAudioComplete(callConnectionId);
    }, faker.number.int({ min: 2000, max: 10000 }));
  }

  /**
   * Mock recognize speech
   */
  public async recognizeSpeech(
    callConnectionId: string,
    recognizeOptions: any
  ): Promise<void> {
    await this.delay(faker.number.int({ min: 100, max: 300 }));

    // Simulate speech recognition results
    setTimeout(() => {
      this.simulateSpeechRecognitionResult(callConnectionId);
    }, faker.number.int({ min: 1000, max: 5000 }));
  }

  /**
   * Get call connection properties
   */
  public async getCallConnectionProperties(callConnectionId: string): Promise<CallConnectionProperties | null> {
    await this.delay(faker.number.int({ min: 50, max: 200 }));
    return this.activeConnections.get(callConnectionId) || null;
  }

  private simulateCallEvents(callConnectionId: string): void {
    // Simulate various call events
    const events = [
      'CallConnected',
      'CallDisconnected',
      'ParticipantsUpdated',
      'RecordingStateChanged'
    ];

    events.forEach((eventType, index) => {
      setTimeout(() => {
        this.simulateWebhookEvent(callConnectionId, eventType);
      }, (index + 1) * faker.number.int({ min: 1000, max: 5000 }));
    });
  }

  private simulatePlayAudioComplete(callConnectionId: string): void {
    this.simulateWebhookEvent(callConnectionId, 'PlayCompleted');
  }

  private simulateSpeechRecognitionResult(callConnectionId: string): void {
    const recognitionResult = {
      recognizedText: faker.helpers.arrayElement([
        "I'm not interested",
        "Remove my number",
        "Don't call again",
        "Not now, thank you"
      ]),
      confidence: faker.number.float({ min: 0.7, max: 0.95, multipleOf: 0.01 })
    };

    this.simulateWebhookEvent(callConnectionId, 'RecognizeCompleted', recognitionResult);
  }

  private simulateWebhookEvent(callConnectionId: string, eventType: string, data?: any): void {
    const webhookEvent = {
      eventType,
      callConnectionId,
      serverCallId: this.activeConnections.get(callConnectionId)?.serverCallId,
      timestamp: new Date().toISOString(),
      data: data || {}
    };

    // In a real implementation, this would POST to the webhook URL
    console.log(`Mock Azure Communication Service Event: ${eventType}`, webhookEvent);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Combined Mock Service Manager
export class AzureMockServiceManager {
  public speechService: AzureSpeechServiceMock;
  public openAIService: AzureOpenAIServiceMock;
  public communicationService: AzureCommunicationServiceMock;

  constructor() {
    this.speechService = new AzureSpeechServiceMock();
    this.openAIService = new AzureOpenAIServiceMock();
    this.communicationService = new AzureCommunicationServiceMock();
  }

  /**
   * Start mock services
   */
  public async startServices(): Promise<void> {
    console.log('Starting Azure Mock Services...');
    // Initialize any necessary resources
    await this.delay(1000);
    console.log('Azure Mock Services started successfully');
  }

  /**
   * Stop mock services
   */
  public async stopServices(): Promise<void> {
    console.log('Stopping Azure Mock Services...');
    // Cleanup resources
    await this.delay(500);
    console.log('Azure Mock Services stopped');
  }

  /**
   * Reset all mock services to initial state
   */
  public async resetServices(): Promise<void> {
    console.log('Resetting Azure Mock Services...');
    this.speechService = new AzureSpeechServiceMock();
    this.openAIService = new AzureOpenAIServiceMock();
    this.communicationService = new AzureCommunicationServiceMock();
    console.log('Azure Mock Services reset complete');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}