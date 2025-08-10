// Test setup file
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock Azure Speech SDK if not available in test environment
jest.mock('@azure/cognitiveservices-speech-sdk', () => ({
  SpeechConfig: {
    fromSubscription: jest.fn(() => ({
      speechRecognitionLanguage: '',
      speechSynthesisLanguage: '',
      speechSynthesisVoiceName: '',
      outputFormat: 0,
      setProperty: jest.fn(),
      requestWordLevelTimestamps: jest.fn(),
      setProfanity: jest.fn(),
      enableDictation: jest.fn(),
    })),
  },
  SpeechRecognizer: jest.fn(() => ({
    recognizing: null,
    recognized: null,
    canceled: null,
    sessionStarted: null,
    sessionStopped: null,
    startContinuousRecognitionAsync: jest.fn((success) => success()),
    stopContinuousRecognitionAsync: jest.fn((success) => success()),
    recognizeOnceAsync: jest.fn((success) => success({
      text: 'test text',
      reason: 3, // RecognizedSpeech
      duration: 1000000,
      json: JSON.stringify({
        NBest: [{
          Display: 'test text',
          Confidence: 0.95,
        }],
      }),
    })),
    close: jest.fn(),
  })),
  SpeechSynthesizer: jest.fn(() => ({
    synthesizing: null,
    synthesisCompleted: null,
    synthesisStarted: null,
    speakSsmlAsync: jest.fn((ssml, success) => success({
      reason: 5, // SynthesizingAudioCompleted
      audioData: Buffer.alloc(1000),
      audioDuration: 1000000,
    })),
    getVoicesAsync: jest.fn(() => Promise.resolve({
      reason: 0,
      voices: [],
    })),
    close: jest.fn(),
  })),
  AudioInputStream: {
    createPushStream: jest.fn(() => ({
      write: jest.fn(),
      close: jest.fn(),
    })),
  },
  AudioOutputStream: {
    createPullStream: jest.fn(() => ({})),
  },
  AudioConfig: {
    fromStreamInput: jest.fn(() => ({})),
    fromStreamOutput: jest.fn(() => ({})),
  },
  AudioStreamFormat: {
    getWaveFormatPCM: jest.fn(() => ({})),
  },
  ResultReason: {
    RecognizedSpeech: 3,
    NoMatch: 1,
    Canceled: 2,
    RecognizingSpeech: 4,
    SynthesizingAudioCompleted: 5,
    VoicesListRetrieved: 0,
  },
  ProfanityOption: {
    Masked: 0,
    Removed: 1,
    Raw: 2,
  },
  PropertyId: {
    SpeechServiceConnection_InitialSilenceTimeoutMs: 'InitialSilenceTimeoutMs',
    SpeechServiceConnection_EndSilenceTimeoutMs: 'EndSilenceTimeoutMs',
  },
  OutputFormat: {
    Detailed: 1,
  },
  SpeechSynthesisOutputFormat: {
    Riff16Khz16BitMonoPcm: 0,
    Audio16Khz32KBitRateMonoMp3: 1,
  },
  SynthesisVoiceGender: {
    Female: 0,
    Male: 1,
  },
}));

// Set test timeout
jest.setTimeout(30000);

// Suppress console output during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};