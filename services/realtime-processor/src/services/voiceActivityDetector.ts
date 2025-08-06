import { VoiceActivityResult } from '../types';
import logger from '../utils/logger';

interface VADConfig {
  energyThreshold: number;
  zcrThreshold: number;
  spectralRolloffThreshold: number;
  minimumSpeechDuration: number;
  hangoverTime: number;
  adaptiveThresholding: boolean;
}

interface AudioFeatures {
  energy: number;
  zeroCrossingRate: number;
  spectralRolloff: number;
  spectralCentroid: number;
  mfccCoefficients: number[];
}

export class VoiceActivityDetector {
  private isInitialized = false;
  private config: VADConfig;
  private backgroundNoiseLevel = 0;
  private adaptiveEnergyThreshold = 0.01;
  private recentFrames: AudioFeatures[] = [];
  private speechHistory: boolean[] = [];
  private hangoverCounter = 0;
  private readonly maxHistoryFrames = 50;

  constructor(config?: Partial<VADConfig>) {
    this.config = {
      energyThreshold: 0.01,
      zcrThreshold: 0.1,
      spectralRolloffThreshold: 0.5,
      minimumSpeechDuration: 100, // ms
      hangoverTime: 300, // ms
      adaptiveThresholding: true,
      ...config,
    };
    
    this.isInitialized = true;
    logger.debug('Advanced Voice Activity Detector initialized', this.config);
  }

  public async detectSpeech(audioData: Buffer): Promise<VoiceActivityResult> {
    try {
      // Convert audio buffer to samples
      const samples = this.bufferToSamples(audioData);
      
      if (samples.length === 0) {
        return this.createVADResult(false, 0, 0);
      }

      // Extract audio features
      const features = await this.extractAudioFeatures(samples);
      
      // Update background noise estimation
      this.updateBackgroundNoise(features);
      
      // Perform multi-feature VAD
      const vadResult = this.performAdvancedVAD(features);
      
      // Apply temporal smoothing
      const smoothedResult = this.applyTemporalSmoothing(vadResult);
      
      // Store features for adaptive thresholding
      this.updateFeatureHistory(features);
      
      return this.createVADResult(
        smoothedResult.isSpeech,
        smoothedResult.confidence,
        features.energy,
        samples.length
      );

    } catch (error) {
      logger.error({ error }, 'Advanced voice activity detection failed');
      return this.createVADResult(false, 0, 0);
    }
  }

  private async extractAudioFeatures(samples: Float32Array): Promise<AudioFeatures> {
    const energy = this.calculateEnergy(samples);
    const zeroCrossingRate = this.calculateZeroCrossingRate(samples);
    const spectralFeatures = this.calculateSpectralFeatures(samples);
    const mfccCoefficients = this.calculateMFCC(samples);

    return {
      energy,
      zeroCrossingRate,
      spectralRolloff: spectralFeatures.rolloff,
      spectralCentroid: spectralFeatures.centroid,
      mfccCoefficients,
    };
  }

  private performAdvancedVAD(features: AudioFeatures): { isSpeech: boolean; confidence: number } {
    let confidence = 0;
    let speechIndicators = 0;
    let totalIndicators = 0;

    // Energy-based detection with adaptive threshold
    const energyThreshold = this.config.adaptiveThresholding 
      ? this.adaptiveEnergyThreshold 
      : this.config.energyThreshold;
    
    if (features.energy > energyThreshold) {
      confidence += 0.3;
      speechIndicators++;
    }
    totalIndicators++;

    // Zero-crossing rate analysis (speech typically has moderate ZCR)
    if (features.zeroCrossingRate > this.config.zcrThreshold && features.zeroCrossingRate < 0.5) {
      confidence += 0.2;
      speechIndicators++;
    }
    totalIndicators++;

    // Spectral rolloff analysis (speech energy concentrated in lower frequencies)
    if (features.spectralRolloff > this.config.spectralRolloffThreshold) {
      confidence += 0.2;
      speechIndicators++;
    }
    totalIndicators++;

    // Spectral centroid analysis (speech has characteristic spectral shape)
    if (features.spectralCentroid > 500 && features.spectralCentroid < 4000) {
      confidence += 0.15;
      speechIndicators++;
    }
    totalIndicators++;

    // MFCC-based analysis (simplified)
    if (this.analyzeMFCCForSpeech(features.mfccCoefficients)) {
      confidence += 0.15;
      speechIndicators++;
    }
    totalIndicators++;

    // Normalize confidence
    confidence = Math.min(confidence, 1.0);
    
    // Decision logic: require multiple indicators for robust detection
    const isSpeech = speechIndicators >= Math.ceil(totalIndicators * 0.4) && confidence > 0.3;

    return { isSpeech, confidence };
  }

  private applyTemporalSmoothing(currentResult: { isSpeech: boolean; confidence: number }): { isSpeech: boolean; confidence: number } {
    // Add to speech history
    this.speechHistory.push(currentResult.isSpeech);
    
    // Keep only recent history
    if (this.speechHistory.length > 10) {
      this.speechHistory = this.speechHistory.slice(-10);
    }

    // Count recent speech frames
    const recentSpeechCount = this.speechHistory.filter(Boolean).length;
    const smoothingFactor = recentSpeechCount / this.speechHistory.length;

    // Apply hangover for speech continuation
    if (currentResult.isSpeech) {
      this.hangoverCounter = Math.floor(this.config.hangoverTime / 32); // Assume 32ms frames
      return { isSpeech: true, confidence: currentResult.confidence * smoothingFactor };
    } else if (this.hangoverCounter > 0) {
      this.hangoverCounter--;
      return { isSpeech: true, confidence: currentResult.confidence * 0.7 }; // Reduced confidence during hangover
    }

    // Apply smoothing for non-speech
    const adjustedConfidence = currentResult.confidence * (1 - smoothingFactor * 0.3);
    return { isSpeech: false, confidence: adjustedConfidence };
  }

  private updateBackgroundNoise(features: AudioFeatures): void {
    // Simple background noise adaptation
    if (!this.recentFrames.length || features.energy < this.backgroundNoiseLevel * 2) {
      const alpha = 0.1; // Adaptation rate
      this.backgroundNoiseLevel = alpha * features.energy + (1 - alpha) * this.backgroundNoiseLevel;
      
      // Update adaptive threshold
      if (this.config.adaptiveThresholding) {
        this.adaptiveEnergyThreshold = Math.max(
          this.backgroundNoiseLevel * 3,
          this.config.energyThreshold
        );
      }
    }
  }

  private updateFeatureHistory(features: AudioFeatures): void {
    this.recentFrames.push(features);
    
    if (this.recentFrames.length > this.maxHistoryFrames) {
      this.recentFrames = this.recentFrames.slice(-this.maxHistoryFrames);
    }
  }

  private calculateSpectralFeatures(samples: Float32Array): { rolloff: number; centroid: number } {
    // Simple FFT-based spectral analysis (simplified implementation)
    const fftSize = Math.min(1024, samples.length);
    const fft = this.simpleFFT(samples.slice(0, fftSize));
    
    // Calculate magnitude spectrum
    const magnitudes = fft.map(complex => Math.sqrt(complex.real * complex.real + complex.imag * complex.imag));
    
    // Calculate spectral centroid
    let weightedSum = 0;
    let magnitudeSum = 0;
    
    for (let i = 0; i < magnitudes.length / 2; i++) {
      const frequency = (i * 16000) / fftSize; // Assume 16kHz sample rate
      weightedSum += frequency * magnitudes[i];
      magnitudeSum += magnitudes[i];
    }
    
    const centroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    
    // Calculate spectral rolloff (frequency below which 85% of energy is contained)
    const targetEnergy = magnitudeSum * 0.85;
    let cumulativeEnergy = 0;
    let rolloffBin = 0;
    
    for (let i = 0; i < magnitudes.length / 2; i++) {
      cumulativeEnergy += magnitudes[i];
      if (cumulativeEnergy >= targetEnergy) {
        rolloffBin = i;
        break;
      }
    }
    
    const rolloff = (rolloffBin * 16000) / fftSize;
    
    return { centroid, rolloff: rolloff / 8000 }; // Normalize rolloff
  }

  private calculateMFCC(samples: Float32Array): number[] {
    // Simplified MFCC calculation (normally would use proper mel-filter bank)
    const numCoefficients = 13;
    const coefficients: number[] = [];
    
    // This is a very simplified version - production would use proper MFCC implementation
    const fftSize = Math.min(512, samples.length);
    const fft = this.simpleFFT(samples.slice(0, fftSize));
    const magnitudes = fft.map(complex => Math.sqrt(complex.real * complex.real + complex.imag * complex.imag));
    
    // Simple approximation of MFCC coefficients
    for (let i = 0; i < numCoefficients; i++) {
      const start = Math.floor((i * magnitudes.length) / (numCoefficients * 2));
      const end = Math.floor(((i + 1) * magnitudes.length) / (numCoefficients * 2));
      
      let sum = 0;
      for (let j = start; j < end && j < magnitudes.length; j++) {
        sum += Math.log(magnitudes[j] + 1e-10); // Avoid log(0)
      }
      
      coefficients.push(sum / (end - start));
    }
    
    return coefficients;
  }

  private analyzeMFCCForSpeech(mfccCoefficients: number[]): boolean {
    // Simplified MFCC analysis for speech detection
    if (mfccCoefficients.length < 3) return false;
    
    // Check if MFCC pattern is consistent with speech
    const c0 = mfccCoefficients[0];
    const c1 = mfccCoefficients[1];
    const c2 = mfccCoefficients[2];
    
    // Speech typically has specific MFCC patterns
    return c0 > -5 && c0 < 5 && Math.abs(c1) < 3 && Math.abs(c2) < 2;
  }

  private simpleFFT(samples: Float32Array): Array<{ real: number; imag: number }> {
    // Very simplified DFT (not efficient, but functional for demo)
    const N = samples.length;
    const result: Array<{ real: number; imag: number }> = [];
    
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * k * n) / N;
        real += samples[n] * Math.cos(angle);
        imag -= samples[n] * Math.sin(angle);
      }
      
      result.push({ real, imag });
    }
    
    return result;
  }

  private createVADResult(
    isSpeech: boolean, 
    confidence: number, 
    energy: number, 
    sampleCount?: number
  ): VoiceActivityResult {
    const now = Date.now();
    const duration = sampleCount ? (sampleCount / 16000) * 1000 : 0; // Assume 16kHz
    
    return {
      isSpeech,
      confidence: Math.min(Math.max(confidence, 0), 1),
      energy,
      startTime: isSpeech ? now : undefined,
      endTime: isSpeech ? now + duration : undefined,
    };
  }

  private bufferToSamples(buffer: Buffer): Float32Array {
    // Assume 16-bit PCM
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    const floatSamples = new Float32Array(samples.length);
    
    for (let i = 0; i < samples.length; i++) {
      floatSamples[i] = samples[i] / 32768.0;
    }
    
    return floatSamples;
  }

  private calculateEnergy(samples: Float32Array): number {
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      energy += samples[i] * samples[i];
    }
    return energy / samples.length;
  }

  private calculateZeroCrossingRate(samples: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / samples.length;
  }

  private estimateAudioDuration(buffer: Buffer): number {
    // Assume 16kHz, 16-bit, mono
    const samplesCount = buffer.length / 2;
    return (samplesCount / 16000) * 1000; // Return in milliseconds
  }
}