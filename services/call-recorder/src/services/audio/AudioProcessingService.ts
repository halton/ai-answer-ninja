import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'stream';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { config } from '../../config';
import { AudioProcessor, AudioMetadata, CompressionOptions } from '../../types';
import { logger } from '../../utils/logger';

export class AudioProcessingService implements AudioProcessor {
  private readonly ffmpegPath: string;
  private readonly tempDir: string;
  private readonly threads: number;
  private readonly timeout: number;

  constructor() {
    this.ffmpegPath = config.ffmpeg.path;
    this.tempDir = config.storage.local.tempDir;
    this.threads = config.ffmpeg.threads;
    this.timeout = config.ffmpeg.timeout;

    // Set ffmpeg path
    if (this.ffmpegPath && this.ffmpegPath !== 'ffmpeg') {
      ffmpeg.setFfmpegPath(this.ffmpegPath);
    }

    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create temp directory', { tempDir: this.tempDir, error });
    }
  }

  /**
   * Compress audio file with specified options
   */
  async compress(input: Buffer, options: CompressionOptions): Promise<Buffer> {
    const tempInput = await this.createTempFile(input, 'input');
    const tempOutput = this.getTempFilePath('output', options.format || 'mp3');

    try {
      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(tempInput)
          .outputOptions([
            `-threads ${this.threads}`,
            `-acodec ${options.codec || config.ffmpeg.formats.codec}`,
            `-b:a ${options.bitrate || config.ffmpeg.formats.bitrate}`,
            `-ar ${options.sampleRate || config.ffmpeg.formats.sampleRate}`,
            `-ac ${options.channels || config.ffmpeg.formats.channels}`
          ])
          .output(tempOutput)
          .on('start', (cmd) => {
            logger.debug('FFmpeg compression started', { command: cmd });
          })
          .on('progress', (progress) => {
            logger.debug('Compression progress', { percent: progress.percent });
          })
          .on('end', () => {
            logger.info('Audio compression completed', { 
              inputSize: input.length,
              format: options.format 
            });
            resolve();
          })
          .on('error', (err) => {
            logger.error('Audio compression failed', { error: err });
            reject(err);
          });

        // Apply quality settings
        if (options.quality !== undefined) {
          command.outputOptions(`-q:a ${options.quality}`);
        }

        // Set timeout
        setTimeout(() => {
          command.kill('SIGKILL');
          reject(new Error('Compression timeout'));
        }, this.timeout);

        command.run();
      });

      // Read compressed file
      const compressedData = await fs.readFile(tempOutput);
      return Buffer.from(compressedData);

    } finally {
      // Cleanup temp files
      await this.cleanupTempFiles([tempInput, tempOutput]);
    }
  }

  /**
   * Convert audio to different format
   */
  async convert(input: Buffer, targetFormat: string): Promise<Buffer> {
    const tempInput = await this.createTempFile(input, 'input');
    const tempOutput = this.getTempFilePath('output', targetFormat);

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInput)
          .outputOptions([`-threads ${this.threads}`])
          .toFormat(targetFormat)
          .output(tempOutput)
          .on('end', () => {
            logger.info('Audio conversion completed', { targetFormat });
            resolve();
          })
          .on('error', (err) => {
            logger.error('Audio conversion failed', { error: err });
            reject(err);
          })
          .run();
      });

      const convertedData = await fs.readFile(tempOutput);
      return Buffer.from(convertedData);

    } finally {
      await this.cleanupTempFiles([tempInput, tempOutput]);
    }
  }

  /**
   * Extract metadata from audio file
   */
  async extractMetadata(input: Buffer): Promise<AudioMetadata> {
    const tempInput = await this.createTempFile(input, 'input');

    try {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempInput, (err, metadata) => {
          if (err) {
            logger.error('Failed to extract metadata', { error: err });
            reject(err);
            return;
          }

          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
          if (!audioStream) {
            reject(new Error('No audio stream found'));
            return;
          }

          const audioMetadata: AudioMetadata = {
            format: metadata.format.format_name || 'unknown',
            codec: audioStream.codec_name,
            bitrate: parseInt(audioStream.bit_rate || '0'),
            sampleRate: audioStream.sample_rate,
            channels: audioStream.channels,
            duration: metadata.format.duration,
            size: input.length
          };

          logger.debug('Metadata extracted', audioMetadata);
          resolve(audioMetadata);
        });
      });

    } finally {
      await this.cleanupTempFiles([tempInput]);
    }
  }

  /**
   * Normalize audio levels
   */
  async normalize(input: Buffer): Promise<Buffer> {
    const tempInput = await this.createTempFile(input, 'input');
    const tempOutput = this.getTempFilePath('output', 'wav');

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInput)
          .audioFilters([
            'loudnorm=I=-16:TP=-1.5:LRA=11', // EBU R128 loudness normalization
            'highpass=f=80', // Remove frequencies below 80Hz
            'lowpass=f=15000' // Remove frequencies above 15kHz
          ])
          .outputOptions([
            `-threads ${this.threads}`,
            '-acodec pcm_s16le' // Use PCM for lossless processing
          ])
          .output(tempOutput)
          .on('end', () => {
            logger.info('Audio normalization completed');
            resolve();
          })
          .on('error', (err) => {
            logger.error('Audio normalization failed', { error: err });
            reject(err);
          })
          .run();
      });

      const normalizedData = await fs.readFile(tempOutput);
      return Buffer.from(normalizedData);

    } finally {
      await this.cleanupTempFiles([tempInput, tempOutput]);
    }
  }

  /**
   * Remove noise from audio
   */
  async removeNoise(input: Buffer): Promise<Buffer> {
    const tempInput = await this.createTempFile(input, 'input');
    const tempOutput = this.getTempFilePath('output', 'wav');

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInput)
          .audioFilters([
            'afftdn=nf=-20', // FFT denoiser
            'highpass=f=100:poles=4', // High-pass filter
            'lowpass=f=8000:poles=4', // Low-pass filter for voice
            'compand=attacks=0.3:decays=0.8:points=-80/-80|-60/-40|-40/-30|-20/-20|0/0', // Compressor
            'equalizer=f=3000:t=h:w=200:g=-10' // Reduce harsh frequencies
          ])
          .outputOptions([
            `-threads ${this.threads}`,
            '-acodec pcm_s16le'
          ])
          .output(tempOutput)
          .on('end', () => {
            logger.info('Noise removal completed');
            resolve();
          })
          .on('error', (err) => {
            logger.error('Noise removal failed', { error: err });
            reject(err);
          })
          .run();
      });

      const denoisedData = await fs.readFile(tempOutput);
      return Buffer.from(denoisedData);

    } finally {
      await this.cleanupTempFiles([tempInput, tempOutput]);
    }
  }

  /**
   * Split stereo audio into separate channels
   */
  async splitChannels(input: Buffer): Promise<{ left: Buffer; right: Buffer }> {
    const tempInput = await this.createTempFile(input, 'input');
    const tempLeftOutput = this.getTempFilePath('left', 'wav');
    const tempRightOutput = this.getTempFilePath('right', 'wav');

    try {
      // Extract left channel
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInput)
          .audioFilters('pan=mono|c0=c0') // Extract left channel
          .outputOptions([
            `-threads ${this.threads}`,
            '-acodec pcm_s16le'
          ])
          .output(tempLeftOutput)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      // Extract right channel
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInput)
          .audioFilters('pan=mono|c0=c1') // Extract right channel
          .outputOptions([
            `-threads ${this.threads}`,
            '-acodec pcm_s16le'
          ])
          .output(tempRightOutput)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      const leftData = await fs.readFile(tempLeftOutput);
      const rightData = await fs.readFile(tempRightOutput);

      logger.info('Audio channels split successfully');

      return {
        left: Buffer.from(leftData),
        right: Buffer.from(rightData)
      };

    } finally {
      await this.cleanupTempFiles([tempInput, tempLeftOutput, tempRightOutput]);
    }
  }

  /**
   * Merge two mono channels into stereo
   */
  async mergeChannels(left: Buffer, right: Buffer): Promise<Buffer> {
    const tempLeftInput = await this.createTempFile(left, 'left');
    const tempRightInput = await this.createTempFile(right, 'right');
    const tempOutput = this.getTempFilePath('output', 'wav');

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(tempLeftInput)
          .input(tempRightInput)
          .complexFilter([
            '[0:a][1:a]amerge=inputs=2[aout]'
          ])
          .outputOptions([
            `-threads ${this.threads}`,
            '-map [aout]',
            '-acodec pcm_s16le'
          ])
          .output(tempOutput)
          .on('end', () => {
            logger.info('Audio channels merged successfully');
            resolve();
          })
          .on('error', (err) => {
            logger.error('Channel merge failed', { error: err });
            reject(err);
          })
          .run();
      });

      const mergedData = await fs.readFile(tempOutput);
      return Buffer.from(mergedData);

    } finally {
      await this.cleanupTempFiles([tempLeftInput, tempRightInput, tempOutput]);
    }
  }

  /**
   * Create streaming audio processor
   */
  createStreamProcessor(options: CompressionOptions): PassThrough {
    const outputStream = new PassThrough();

    const command = ffmpeg()
      .inputOptions([
        '-f s16le', // Raw PCM input
        '-ar 44100', // Sample rate
        '-ac 2' // Stereo
      ])
      .outputOptions([
        `-threads ${this.threads}`,
        `-acodec ${options.codec || 'libmp3lame'}`,
        `-b:a ${options.bitrate || '128k'}`,
        `-ar ${options.sampleRate || 44100}`,
        `-ac ${options.channels || 2}`,
        '-f mp3' // Output format
      ])
      .on('start', (cmd) => {
        logger.debug('Stream processing started', { command: cmd });
      })
      .on('error', (err) => {
        logger.error('Stream processing failed', { error: err });
        outputStream.destroy(err);
      })
      .pipe(outputStream, { end: true });

    return outputStream;
  }

  /**
   * Generate waveform data for visualization
   */
  async generateWaveform(input: Buffer, samples: number = 1000): Promise<number[]> {
    const tempInput = await this.createTempFile(input, 'input');
    const tempOutput = this.getTempFilePath('waveform', 'dat');

    try {
      // Extract raw audio samples
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInput)
          .outputOptions([
            '-f f32le', // 32-bit float PCM
            '-acodec pcm_f32le',
            '-ac 1', // Mono for simplicity
            '-ar 8000' // Lower sample rate for waveform
          ])
          .output(tempOutput)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      // Read and process samples
      const rawData = await fs.readFile(tempOutput);
      const floatArray = new Float32Array(rawData.buffer);
      
      // Downsample to requested number of samples
      const waveform: number[] = [];
      const chunkSize = Math.floor(floatArray.length / samples);
      
      for (let i = 0; i < samples; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, floatArray.length);
        
        // Calculate RMS for chunk
        let sum = 0;
        for (let j = start; j < end; j++) {
          sum += floatArray[j] * floatArray[j];
        }
        const rms = Math.sqrt(sum / (end - start));
        waveform.push(Math.min(1, rms * 2)); // Normalize to 0-1
      }

      logger.debug('Waveform generated', { samples: waveform.length });
      return waveform;

    } finally {
      await this.cleanupTempFiles([tempInput, tempOutput]);
    }
  }

  /**
   * Create temporary file from buffer
   */
  private async createTempFile(data: Buffer, prefix: string): Promise<string> {
    const filename = `${prefix}_${crypto.randomBytes(8).toString('hex')}.tmp`;
    const filepath = path.join(this.tempDir, filename);
    await fs.writeFile(filepath, data);
    return filepath;
  }

  /**
   * Generate temporary file path
   */
  private getTempFilePath(prefix: string, extension: string): string {
    const filename = `${prefix}_${crypto.randomBytes(8).toString('hex')}.${extension}`;
    return path.join(this.tempDir, filename);
  }

  /**
   * Cleanup temporary files
   */
  private async cleanupTempFiles(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch (error) {
        logger.warn('Failed to cleanup temp file', { file, error });
      }
    }
  }
}