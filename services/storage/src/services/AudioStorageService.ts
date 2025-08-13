import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { CryptoUtils } from '../utils/crypto';
import { FileStorageService } from './FileStorageService';
import {
  AudioFileInfo,
  AudioMetadata,
  FileType,
  StorageTier,
  FileStatus,
  StorageError,
  ValidationError
} from '../types';

// 设置FFmpeg路径
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

export interface AudioUploadRequest {
  filename: string;
  audioData: Buffer;
  uploaderId: string;
  callId?: string;
  language?: string;
  transcription?: string;
  storageTier?: StorageTier;
  encrypt?: boolean;
  compress?: boolean;
}

export interface AudioProcessingOptions {
  targetFormat?: 'mp3' | 'wav' | 'opus' | 'm4a';
  targetBitrate?: number;
  targetSampleRate?: number;
  normalizeAudio?: boolean;
  removeNoise?: boolean;
  generateWaveform?: boolean;
  extractThumbnail?: boolean;
}

export interface AudioProcessingResult {
  processedAudio: Buffer;
  metadata: AudioMetadata;
  waveform?: Buffer;
  thumbnail?: Buffer;
  processingStats: {
    originalSize: number;
    processedSize: number;
    compressionRatio: number;
    processingTime: number;
  };
}

export class AudioStorageService {
  private fileService: FileStorageService;
  
  // 支持的音频格式
  private static readonly SUPPORTED_FORMATS = [
    'audio/mpeg',    // MP3
    'audio/wav',     // WAV
    'audio/ogg',     // OGG
    'audio/opus',    // Opus
    'audio/m4a',     // M4A
    'audio/aac',     // AAC
    'audio/flac',    // FLAC
    'audio/webm'     // WebM Audio
  ];

  // 默认处理配置
  private static readonly DEFAULT_CONFIG = {
    targetFormat: 'mp3' as const,
    targetBitrate: 128, // kbps
    targetSampleRate: 44100, // Hz
    maxDuration: 3600, // 1小时
    maxFileSize: 500 * 1024 * 1024 // 500MB
  };

  constructor(fileService: FileStorageService) {
    this.fileService = fileService;
    logger.info('AudioStorageService initialized successfully');
  }

  /**
   * 上传并处理音频文件
   */
  async uploadAudio(
    request: AudioUploadRequest,
    processingOptions: AudioProcessingOptions = {}
  ): Promise<AudioFileInfo> {
    try {
      // 验证音频文件
      this.validateAudioRequest(request);

      // 检测音频格式
      const detectedMimeType = await this.detectAudioFormat(request.audioData);
      if (!detectedMimeType) {
        throw new ValidationError('Invalid audio format');
      }

      // 处理音频
      const processingResult = await this.processAudio(request.audioData, processingOptions);

      // 准备上传请求
      const uploadRequest = {
        filename: this.generateAudioFilename(request.filename, processingOptions.targetFormat),
        data: processingResult.processedAudio,
        mimeType: this.getTargetMimeType(processingOptions.targetFormat),
        uploaderId: request.uploaderId,
        fileType: FileType.AUDIO,
        tags: this.generateAudioTags(request, processingResult.metadata),
        storageTier: request.storageTier || StorageTier.HOT,
        encrypt: request.encrypt,
        compress: request.compress
      };

      // 上传到文件存储服务
      const fileMetadata = await this.fileService.uploadFile(uploadRequest);

      // 创建音频文件信息
      const audioFileInfo: AudioFileInfo = {
        ...fileMetadata,
        audioMetadata: {
          ...processingResult.metadata,
          callId: request.callId,
          language: request.language,
          transcription: request.transcription
        }
      };

      // 如果生成了波形图或缩略图，也要上传
      if (processingResult.waveform) {
        await this.uploadWaveform(fileMetadata.id, processingResult.waveform, request.uploaderId);
      }

      if (processingResult.thumbnail) {
        await this.uploadThumbnail(fileMetadata.id, processingResult.thumbnail, request.uploaderId);
      }

      logger.info(`Audio uploaded and processed successfully: ${fileMetadata.id}`, {
        originalSize: request.audioData.length,
        processedSize: processingResult.processedAudio.length,
        duration: processingResult.metadata.duration,
        format: processingOptions.targetFormat || 'original'
      });

      return audioFileInfo;

    } catch (error) {
      logger.error('Audio upload failed:', error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Audio upload failed: ${error.message}`, 'AUDIO_UPLOAD_FAILED');
    }
  }

  /**
   * 处理音频文件
   */
  async processAudio(
    audioData: Buffer,
    options: AudioProcessingOptions = {}
  ): Promise<AudioProcessingResult> {
    const startTime = Date.now();
    
    try {
      // 获取原始音频元数据
      const originalMetadata = await this.extractAudioMetadata(audioData);

      // 设置处理选项
      const config = {
        ...AudioStorageService.DEFAULT_CONFIG,
        ...options
      };

      // 处理音频
      let processedAudio = audioData;
      let finalMetadata = originalMetadata;

      // 如果需要转换格式或调整参数
      if (this.shouldProcessAudio(originalMetadata, config)) {
        const conversionResult = await this.convertAudio(audioData, config);
        processedAudio = conversionResult.audio;
        finalMetadata = conversionResult.metadata;
      }

      // 生成附加内容
      let waveform: Buffer | undefined;
      let thumbnail: Buffer | undefined;

      if (options.generateWaveform) {
        waveform = await this.generateWaveform(processedAudio);
      }

      if (options.extractThumbnail) {
        thumbnail = await this.generateThumbnail(finalMetadata);
      }

      const processingTime = Date.now() - startTime;

      return {
        processedAudio,
        metadata: finalMetadata,
        waveform,
        thumbnail,
        processingStats: {
          originalSize: audioData.length,
          processedSize: processedAudio.length,
          compressionRatio: processedAudio.length / audioData.length,
          processingTime
        }
      };

    } catch (error) {
      logger.error('Audio processing failed:', error);
      throw new StorageError(`Audio processing failed: ${error.message}`, 'AUDIO_PROCESSING_FAILED');
    }
  }

  /**
   * 下载音频文件
   */
  async downloadAudio(fileId: string, userId?: string): Promise<{
    audioData: Buffer;
    audioInfo: AudioFileInfo;
  }> {
    try {
      // 通过文件服务下载
      const result = await this.fileService.downloadFile(fileId, userId);

      // 验证是否为音频文件
      if (result.metadata.fileType !== FileType.AUDIO) {
        throw new ValidationError('Requested file is not an audio file');
      }

      // 获取音频元数据（这里应该从数据库或缓存获取）
      const audioMetadata = await this.getAudioMetadata(fileId);
      if (!audioMetadata) {
        throw new StorageError('Audio metadata not found', 'METADATA_NOT_FOUND');
      }

      const audioInfo: AudioFileInfo = {
        ...result.metadata,
        audioMetadata
      };

      logger.debug(`Audio downloaded successfully: ${fileId}`, {
        size: result.data.length,
        duration: audioMetadata.duration
      });

      return {
        audioData: result.data,
        audioInfo
      };

    } catch (error) {
      logger.error(`Failed to download audio ${fileId}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to download audio: ${error.message}`, 'AUDIO_DOWNLOAD_FAILED');
    }
  }

  /**
   * 提取音频片段
   */
  async extractAudioSegment(
    fileId: string,
    startTime: number,
    duration: number,
    userId?: string
  ): Promise<{
    segmentData: Buffer;
    metadata: AudioMetadata;
  }> {
    try {
      // 下载完整音频
      const { audioData, audioInfo } = await this.downloadAudio(fileId, userId);

      // 验证时间范围
      if (startTime < 0 || startTime >= audioInfo.audioMetadata.duration) {
        throw new ValidationError('Invalid start time');
      }

      if (duration <= 0 || startTime + duration > audioInfo.audioMetadata.duration) {
        throw new ValidationError('Invalid duration');
      }

      // 提取片段
      const segmentData = await this.extractSegment(audioData, startTime, duration);
      
      // 获取片段元数据
      const segmentMetadata = await this.extractAudioMetadata(segmentData);

      logger.debug(`Audio segment extracted: ${fileId}`, {
        startTime,
        duration,
        segmentSize: segmentData.length
      });

      return {
        segmentData,
        metadata: segmentMetadata
      };

    } catch (error) {
      logger.error(`Failed to extract audio segment ${fileId}:`, error);
      throw new StorageError(`Failed to extract audio segment: ${error.message}`, 'SEGMENT_EXTRACTION_FAILED');
    }
  }

  /**
   * 转换音频格式
   */
  async convertAudioFormat(
    fileId: string,
    targetFormat: 'mp3' | 'wav' | 'opus' | 'm4a',
    options: {
      bitrate?: number;
      sampleRate?: number;
      quality?: 'low' | 'medium' | 'high';
    } = {},
    userId?: string
  ): Promise<AudioFileInfo> {
    try {
      // 下载原始音频
      const { audioData, audioInfo } = await this.downloadAudio(fileId, userId);

      // 转换配置
      const conversionConfig = {
        targetFormat,
        targetBitrate: options.bitrate || this.getDefaultBitrate(targetFormat),
        targetSampleRate: options.sampleRate || 44100,
        ...this.getQualitySettings(options.quality || 'medium')
      };

      // 执行转换
      const conversionResult = await this.convertAudio(audioData, conversionConfig);

      // 生成新文件名
      const convertedFilename = this.generateConvertedFilename(
        audioInfo.originalName,
        targetFormat
      );

      // 上传转换后的文件
      const uploadRequest = {
        filename: convertedFilename,
        data: conversionResult.audio,
        mimeType: this.getTargetMimeType(targetFormat),
        uploaderId: audioInfo.uploaderId,
        fileType: FileType.AUDIO,
        tags: [
          ...audioInfo.tags,
          `converted_from_${audioInfo.id}`,
          `format_${targetFormat}`
        ],
        storageTier: audioInfo.storageTier,
        encrypt: !!audioInfo.encryptionKey,
        compress: false // 音频已经压缩过了
      };

      const newFileMetadata = await this.fileService.uploadFile(uploadRequest);

      // 创建新的音频文件信息
      const convertedAudioInfo: AudioFileInfo = {
        ...newFileMetadata,
        audioMetadata: {
          ...conversionResult.metadata,
          callId: audioInfo.audioMetadata.callId,
          language: audioInfo.audioMetadata.language,
          transcription: audioInfo.audioMetadata.transcription
        }
      };

      logger.info(`Audio converted successfully: ${fileId} -> ${newFileMetadata.id}`, {
        originalFormat: audioInfo.audioMetadata.format,
        targetFormat,
        originalSize: audioData.length,
        convertedSize: conversionResult.audio.length
      });

      return convertedAudioInfo;

    } catch (error) {
      logger.error(`Failed to convert audio format ${fileId}:`, error);
      throw new StorageError(`Failed to convert audio format: ${error.message}`, 'AUDIO_CONVERSION_FAILED');
    }
  }

  /**
   * 获取音频波形数据
   */
  async getWaveform(fileId: string, userId?: string): Promise<Buffer> {
    try {
      // 首先尝试获取预生成的波形图
      const waveformFileId = `${fileId}_waveform`;
      try {
        const result = await this.fileService.downloadFile(waveformFileId, userId);
        return result.data;
      } catch (error) {
        // 如果没有预生成的波形图，则实时生成
      }

      // 下载音频并生成波形图
      const { audioData } = await this.downloadAudio(fileId, userId);
      const waveform = await this.generateWaveform(audioData);

      // 缓存波形图以备后用
      try {
        await this.uploadWaveform(fileId, waveform, userId || 'system');
      } catch (error) {
        logger.warn(`Failed to cache waveform for ${fileId}:`, error);
      }

      return waveform;

    } catch (error) {
      logger.error(`Failed to get waveform for ${fileId}:`, error);
      throw new StorageError(`Failed to get waveform: ${error.message}`, 'WAVEFORM_GENERATION_FAILED');
    }
  }

  // 私有方法

  private validateAudioRequest(request: AudioUploadRequest): void {
    if (!request.filename || request.filename.trim().length === 0) {
      throw new ValidationError('Audio filename is required');
    }

    if (!request.audioData || request.audioData.length === 0) {
      throw new ValidationError('Audio data is required');
    }

    if (!request.uploaderId) {
      throw new ValidationError('Uploader ID is required');
    }

    // 检查文件大小限制
    if (request.audioData.length > AudioStorageService.DEFAULT_CONFIG.maxFileSize) {
      throw new ValidationError(
        `Audio file size exceeds maximum limit (${AudioStorageService.DEFAULT_CONFIG.maxFileSize / 1024 / 1024}MB)`
      );
    }
  }

  private async detectAudioFormat(audioData: Buffer): Promise<string | null> {
    try {
      // 检查文件头来识别格式
      if (audioData.subarray(0, 3).toString() === 'ID3' || 
          audioData.subarray(0, 2).toString('hex') === 'fffa' ||
          audioData.subarray(0, 2).toString('hex') === 'fffb') {
        return 'audio/mpeg';
      }

      if (audioData.subarray(0, 4).toString() === 'RIFF' &&
          audioData.subarray(8, 12).toString() === 'WAVE') {
        return 'audio/wav';
      }

      if (audioData.subarray(0, 4).toString() === 'OggS') {
        return 'audio/ogg';
      }

      if (audioData.subarray(4, 8).toString() === 'ftyp') {
        return 'audio/m4a';
      }

      // 如果无法识别，尝试使用FFmpeg来检测
      return await this.detectFormatWithFFmpeg(audioData);

    } catch (error) {
      logger.warn('Failed to detect audio format:', error);
      return null;
    }
  }

  private async detectFormatWithFFmpeg(audioData: Buffer): Promise<string | null> {
    return new Promise((resolve) => {
      const tempFile = `/tmp/audio_detect_${Date.now()}.tmp`;
      require('fs').writeFileSync(tempFile, audioData);

      ffmpeg(tempFile)
        .ffprobe((err, metadata) => {
          // 清理临时文件
          try {
            require('fs').unlinkSync(tempFile);
          } catch {}

          if (err) {
            resolve(null);
            return;
          }

          const format = metadata.format?.format_name?.split(',')[0];
          if (format) {
            resolve(`audio/${format}`);
          } else {
            resolve(null);
          }
        });
    });
  }

  private async extractAudioMetadata(audioData: Buffer): Promise<AudioMetadata> {
    return new Promise((resolve, reject) => {
      const tempFile = `/tmp/audio_metadata_${Date.now()}.tmp`;
      require('fs').writeFileSync(tempFile, audioData);

      ffmpeg(tempFile)
        .ffprobe((err, metadata) => {
          // 清理临时文件
          try {
            require('fs').unlinkSync(tempFile);
          } catch {}

          if (err) {
            reject(new Error(`Failed to extract audio metadata: ${err.message}`));
            return;
          }

          const audioStream = metadata.streams?.find(s => s.codec_type === 'audio');
          if (!audioStream) {
            reject(new Error('No audio stream found'));
            return;
          }

          resolve({
            duration: parseFloat(metadata.format?.duration || '0'),
            sampleRate: parseInt(audioStream.sample_rate || '0'),
            channels: audioStream.channels || 1,
            bitrate: parseInt(audioStream.bit_rate || '0'),
            format: audioStream.codec_name || 'unknown'
          });
        });
    });
  }

  private shouldProcessAudio(metadata: AudioMetadata, config: any): boolean {
    // 检查是否需要转换格式
    if (config.targetFormat && metadata.format !== config.targetFormat) {
      return true;
    }

    // 检查是否需要调整比特率
    if (config.targetBitrate && Math.abs(metadata.bitrate - config.targetBitrate * 1000) > 32000) {
      return true;
    }

    // 检查是否需要调整采样率
    if (config.targetSampleRate && metadata.sampleRate !== config.targetSampleRate) {
      return true;
    }

    return false;
  }

  private async convertAudio(
    audioData: Buffer,
    config: any
  ): Promise<{ audio: Buffer; metadata: AudioMetadata }> {
    return new Promise((resolve, reject) => {
      const inputFile = `/tmp/audio_input_${Date.now()}.tmp`;
      const outputFile = `/tmp/audio_output_${Date.now()}.${config.targetFormat}`;

      require('fs').writeFileSync(inputFile, audioData);

      let command = ffmpeg(inputFile);

      // 设置输出格式
      if (config.targetFormat === 'mp3') {
        command = command.audioCodec('libmp3lame');
      } else if (config.targetFormat === 'wav') {
        command = command.audioCodec('pcm_s16le');
      } else if (config.targetFormat === 'opus') {
        command = command.audioCodec('libopus');
      } else if (config.targetFormat === 'm4a') {
        command = command.audioCodec('aac');
      }

      // 设置比特率
      if (config.targetBitrate) {
        command = command.audioBitrate(config.targetBitrate);
      }

      // 设置采样率
      if (config.targetSampleRate) {
        command = command.audioFrequency(config.targetSampleRate);
      }

      // 音频标准化
      if (config.normalizeAudio) {
        command = command.audioFilters('loudnorm');
      }

      // 降噪
      if (config.removeNoise) {
        command = command.audioFilters('afftdn');
      }

      command
        .output(outputFile)
        .on('end', async () => {
          try {
            const convertedData = require('fs').readFileSync(outputFile);
            const metadata = await this.extractAudioMetadata(convertedData);

            // 清理临时文件
            try {
              require('fs').unlinkSync(inputFile);
              require('fs').unlinkSync(outputFile);
            } catch {}

            resolve({ audio: convertedData, metadata });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (err) => {
          // 清理临时文件
          try {
            require('fs').unlinkSync(inputFile);
            require('fs').unlinkSync(outputFile);
          } catch {}

          reject(new Error(`Audio conversion failed: ${err.message}`));
        })
        .run();
    });
  }

  private async extractSegment(
    audioData: Buffer,
    startTime: number,
    duration: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const inputFile = `/tmp/audio_segment_input_${Date.now()}.tmp`;
      const outputFile = `/tmp/audio_segment_output_${Date.now()}.mp3`;

      require('fs').writeFileSync(inputFile, audioData);

      ffmpeg(inputFile)
        .seekInput(startTime)
        .duration(duration)
        .output(outputFile)
        .on('end', () => {
          try {
            const segmentData = require('fs').readFileSync(outputFile);

            // 清理临时文件
            try {
              require('fs').unlinkSync(inputFile);
              require('fs').unlinkSync(outputFile);
            } catch {}

            resolve(segmentData);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (err) => {
          // 清理临时文件
          try {
            require('fs').unlinkSync(inputFile);
            require('fs').unlinkSync(outputFile);
          } catch {}

          reject(new Error(`Segment extraction failed: ${err.message}`));
        })
        .run();
    });
  }

  private async generateWaveform(audioData: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const inputFile = `/tmp/waveform_input_${Date.now()}.tmp`;
      const outputFile = `/tmp/waveform_output_${Date.now()}.png`;

      require('fs').writeFileSync(inputFile, audioData);

      ffmpeg(inputFile)
        .complexFilter([
          'showwavespic=s=1200x300:colors=0x3b82f6'
        ])
        .output(outputFile)
        .on('end', () => {
          try {
            const waveformData = require('fs').readFileSync(outputFile);

            // 清理临时文件
            try {
              require('fs').unlinkSync(inputFile);
              require('fs').unlinkSync(outputFile);
            } catch {}

            resolve(waveformData);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (err) => {
          // 清理临时文件
          try {
            require('fs').unlinkSync(inputFile);
            require('fs').unlinkSync(outputFile);
          } catch {}

          reject(new Error(`Waveform generation failed: ${err.message}`));
        })
        .run();
    });
  }

  private async generateThumbnail(metadata: AudioMetadata): Promise<Buffer> {
    // 为音频生成一个可视化缩略图
    // 这里可以生成一个包含音频信息的图片
    const svg = `
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="#f3f4f6"/>
        <circle cx="100" cy="100" r="50" fill="#3b82f6"/>
        <text x="100" y="105" text-anchor="middle" font-family="Arial" font-size="14" fill="white">
          AUDIO
        </text>
        <text x="100" y="160" text-anchor="middle" font-family="Arial" font-size="10" fill="#6b7280">
          ${Math.round(metadata.duration)}s
        </text>
        <text x="100" y="175" text-anchor="middle" font-family="Arial" font-size="10" fill="#6b7280">
          ${metadata.format.toUpperCase()}
        </text>
      </svg>
    `;

    return sharp(Buffer.from(svg))
      .png()
      .toBuffer();
  }

  private generateAudioFilename(originalName: string, targetFormat?: string): string {
    const ext = targetFormat || 'mp3';
    const baseName = originalName.replace(/\.[^/.]+$/, '');
    return `${baseName}.${ext}`;
  }

  private generateConvertedFilename(originalName: string, targetFormat: string): string {
    const baseName = originalName.replace(/\.[^/.]+$/, '');
    return `${baseName}_converted.${targetFormat}`;
  }

  private getTargetMimeType(format?: string): string {
    switch (format) {
      case 'mp3': return 'audio/mpeg';
      case 'wav': return 'audio/wav';
      case 'opus': return 'audio/opus';
      case 'm4a': return 'audio/m4a';
      default: return 'audio/mpeg';
    }
  }

  private getDefaultBitrate(format: string): number {
    switch (format) {
      case 'mp3': return 128;
      case 'wav': return 1411; // 无损
      case 'opus': return 96;
      case 'm4a': return 128;
      default: return 128;
    }
  }

  private getQualitySettings(quality: 'low' | 'medium' | 'high') {
    switch (quality) {
      case 'low':
        return { targetBitrate: 64, targetSampleRate: 22050 };
      case 'medium':
        return { targetBitrate: 128, targetSampleRate: 44100 };
      case 'high':
        return { targetBitrate: 256, targetSampleRate: 48000 };
    }
  }

  private generateAudioTags(request: AudioUploadRequest, metadata: AudioMetadata): string[] {
    const tags = ['audio'];
    
    if (request.callId) tags.push(`call:${request.callId}`);
    if (request.language) tags.push(`lang:${request.language}`);
    if (metadata.format) tags.push(`format:${metadata.format}`);
    if (metadata.duration) tags.push(`duration:${Math.round(metadata.duration)}`);
    
    return tags;
  }

  private async uploadWaveform(audioFileId: string, waveformData: Buffer, uploaderId: string): Promise<void> {
    try {
      await this.fileService.uploadFile({
        filename: `${audioFileId}_waveform.png`,
        data: waveformData,
        mimeType: 'image/png',
        uploaderId,
        fileType: FileType.IMAGE,
        tags: ['waveform', `audio:${audioFileId}`],
        storageTier: StorageTier.COOL
      });
    } catch (error) {
      logger.warn(`Failed to upload waveform for ${audioFileId}:`, error);
    }
  }

  private async uploadThumbnail(audioFileId: string, thumbnailData: Buffer, uploaderId: string): Promise<void> {
    try {
      await this.fileService.uploadFile({
        filename: `${audioFileId}_thumbnail.png`,
        data: thumbnailData,
        mimeType: 'image/png',
        uploaderId,
        fileType: FileType.IMAGE,
        tags: ['thumbnail', `audio:${audioFileId}`],
        storageTier: StorageTier.COOL
      });
    } catch (error) {
      logger.warn(`Failed to upload thumbnail for ${audioFileId}:`, error);
    }
  }

  private async getAudioMetadata(fileId: string): Promise<AudioMetadata | null> {
    // 这里应该从数据库或缓存获取音频元数据
    // 暂时返回null，实际实现需要集成数据库
    return null;
  }
}