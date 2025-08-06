import { VoiceActivityDetector } from '../../src/services/voiceActivityDetector';

describe('VoiceActivityDetector', () => {
  let vad: VoiceActivityDetector;

  beforeEach(() => {
    vad = new VoiceActivityDetector({
      energyThreshold: 0.01,
      zcrThreshold: 0.1,
      adaptiveThresholding: false, // Disable for consistent testing
    });
  });

  describe('detectSpeech', () => {
    it('should detect silence in empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await vad.detectSpeech(emptyBuffer);
      
      expect(result.isSpeech).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.energy).toBe(0);
    });

    it('should detect silence in low-energy audio', async () => {
      // Create a buffer with very low energy (silence)
      const silenceBuffer = Buffer.alloc(1024); // All zeros = silence
      const result = await vad.detectSpeech(silenceBuffer);
      
      expect(result.isSpeech).toBe(false);
      expect(result.energy).toBe(0);
    });

    it('should detect speech in high-energy audio with appropriate ZCR', async () => {
      // Create a buffer that simulates speech-like audio
      const audioBuffer = Buffer.alloc(1024);
      const samples = new Int16Array(audioBuffer.buffer);
      
      // Generate a simple sine wave to simulate speech energy
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin(i * 0.1) * 5000 + Math.sin(i * 0.05) * 3000;
      }
      
      const result = await vad.detectSpeech(audioBuffer);
      
      expect(result.isSpeech).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.energy).toBeGreaterThan(0);
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
    });

    it('should handle corrupted audio data gracefully', async () => {
      // Create invalid audio data
      const invalidBuffer = Buffer.from('invalid audio data');
      const result = await vad.detectSpeech(invalidBuffer);
      
      // Should not crash and return safe defaults
      expect(result.isSpeech).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.energy).toBeGreaterThanOrEqual(0);
    });

    it('should adapt thresholds over time when adaptive thresholding is enabled', async () => {
      const adaptiveVAD = new VoiceActivityDetector({
        adaptiveThresholding: true,
      });

      // Send some background noise samples first
      const noiseBuffer = Buffer.alloc(512);
      const noiseSamples = new Int16Array(noiseBuffer.buffer);
      for (let i = 0; i < noiseSamples.length; i++) {
        noiseSamples[i] = Math.random() * 100; // Low level noise
      }

      // Process noise to establish background level
      await adaptiveVAD.detectSpeech(noiseBuffer);
      await adaptiveVAD.detectSpeech(noiseBuffer);
      await adaptiveVAD.detectSpeech(noiseBuffer);

      // Now send speech-like signal
      const speechBuffer = Buffer.alloc(512);
      const speechSamples = new Int16Array(speechBuffer.buffer);
      for (let i = 0; i < speechSamples.length; i++) {
        speechSamples[i] = Math.sin(i * 0.1) * 3000; // Higher energy
      }

      const result = await adaptiveVAD.detectSpeech(speechBuffer);
      expect(result.isSpeech).toBe(true);
    });
  });

  describe('temporal smoothing', () => {
    it('should apply hangover effect for speech continuation', async () => {
      const vad = new VoiceActivityDetector({
        hangoverTime: 100, // Short hangover for testing
      });

      // Create speech buffer
      const speechBuffer = Buffer.alloc(512);
      const speechSamples = new Int16Array(speechBuffer.buffer);
      for (let i = 0; i < speechSamples.length; i++) {
        speechSamples[i] = Math.sin(i * 0.1) * 5000;
      }

      // Create silence buffer  
      const silenceBuffer = Buffer.alloc(512);

      // First detect speech
      const speechResult = await vad.detectSpeech(speechBuffer);
      expect(speechResult.isSpeech).toBe(true);

      // Then immediately after, silence should still be considered speech due to hangover
      const hangoverResult = await vad.detectSpeech(silenceBuffer);
      expect(hangoverResult.isSpeech).toBe(true);
      expect(hangoverResult.confidence).toBeLessThan(speechResult.confidence);
    });
  });
});