// Azure Speech Services Types
export interface SpeechToTextRequest {
  audio?: string | Buffer;
  format?: string;
  language?: string;
  model?: string;
}

export interface SpeechToTextResponse {
  text: string;
  confidence: number;
  offset: number;
  duration: number;
  words?: Array<{
    word: string;
    offset: number;
    duration: number;
    confidence: number;
  }>;
}

export interface TextToSpeechRequest {
  text: string;
  voice?: string;
  language?: string;
  format?: string;
  speed?: number;
  pitch?: number;
}

export interface TextToSpeechResponse {
  audioData: Buffer;
  contentType: string;
  duration: number;
}

// Azure OpenAI Types
export interface ChatCompletionsRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
}

export interface ChatCompletionsResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Azure Communication Services Types
export interface CreateCallConnectionRequest {
  targetParticipant: {
    phoneNumber: string;
  };
  sourceCallerIdNumber?: {
    phoneNumber: string;
  };
  callbackUri: string;
  mediaStreamingConfiguration?: {
    transportUrl: string;
    transportType: string;
    contentType: string;
    audioChannelType: string;
  };
}

export interface CallConnectionResponse {
  callConnectionId: string;
  serverCallId: string;
  targets: Array<{
    phoneNumber: string;
  }>;
  callConnectionState: 'connecting' | 'connected' | 'disconnected' | 'transferring';
  callbackUri: string;
  mediaStreamingConfiguration?: any;
}

export interface AnswerCallRequest {
  callbackUri: string;
  mediaStreamingConfiguration?: {
    transportUrl: string;
    transportType: string;
    contentType: string;
    audioChannelType: string;
  };
}

export interface TransferCallRequest {
  transferTarget: {
    phoneNumber: string;
  };
}

export interface PlayAudioRequest {
  playSourceInfo: {
    sourceType: 'text' | 'ssml' | 'file';
    text?: string;
    ssml?: string;
    fileSource?: {
      uri: string;
    };
  };
  playOptions?: {
    loop?: boolean;
    operationContext?: string;
  };
}

// Mock Configuration Types
export interface MockServiceConfig {
  latency?: {
    min: number;
    max: number;
  };
  errorRate?: number;
  responses?: {
    [key: string]: any;
  };
}

export interface MockStats {
  requestCount: number;
  errorCount: number;
  averageLatency: number;
  lastRequestTime?: Date;
  configuration?: MockServiceConfig;
}