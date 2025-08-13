import zlib from 'zlib';
import { promisify } from 'util';
import logger from './logger';

// 异步压缩函数
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

export type CompressionAlgorithm = 'gzip' | 'brotli';

export interface CompressionResult {
  compressed: Buffer;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  algorithm: CompressionAlgorithm;
}

export class CompressionUtils {
  private static readonly MIN_COMPRESSION_SIZE = 1024; // 1KB
  private static readonly COMPRESSION_THRESHOLD = 0.9; // 如果压缩率>90%则认为不值得压缩

  /**
   * 智能压缩数据
   * 根据数据大小和类型选择最佳压缩算法
   */
  static async compress(
    data: Buffer,
    algorithm: CompressionAlgorithm = 'gzip',
    options?: {
      level?: number;
      minSize?: number;
    }
  ): Promise<CompressionResult> {
    const minSize = options?.minSize || this.MIN_COMPRESSION_SIZE;
    
    // 如果数据太小，不进行压缩
    if (data.length < minSize) {
      logger.debug(`Data too small (${data.length} bytes), skipping compression`);
      return {
        compressed: data,
        originalSize: data.length,
        compressedSize: data.length,
        compressionRatio: 1.0,
        algorithm
      };
    }

    try {
      let compressed: Buffer;
      const startTime = Date.now();

      switch (algorithm) {
        case 'gzip':
          compressed = await gzip(data, {
            level: options?.level || zlib.constants.Z_BEST_COMPRESSION
          });
          break;
        case 'brotli':
          compressed = await brotliCompress(data, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: options?.level || 11
            }
          });
          break;
        default:
          throw new Error(`Unsupported compression algorithm: ${algorithm}`);
      }

      const compressionTime = Date.now() - startTime;
      const compressionRatio = compressed.length / data.length;

      // 如果压缩效果不佳，返回原始数据
      if (compressionRatio > this.COMPRESSION_THRESHOLD) {
        logger.debug(
          `Poor compression ratio (${compressionRatio.toFixed(2)}), returning original data`
        );
        return {
          compressed: data,
          originalSize: data.length,
          compressedSize: data.length,
          compressionRatio: 1.0,
          algorithm
        };
      }

      logger.debug(
        `Compression successful: ${data.length} -> ${compressed.length} bytes ` +
        `(${(compressionRatio * 100).toFixed(1)}%) in ${compressionTime}ms`
      );

      return {
        compressed,
        originalSize: data.length,
        compressedSize: compressed.length,
        compressionRatio,
        algorithm
      };
    } catch (error) {
      logger.error('Compression failed:', error);
      throw new Error(`Failed to compress data with ${algorithm}: ${error.message}`);
    }
  }

  /**
   * 解压缩数据
   */
  static async decompress(
    compressedData: Buffer,
    algorithm: CompressionAlgorithm
  ): Promise<Buffer> {
    try {
      const startTime = Date.now();
      let decompressed: Buffer;

      switch (algorithm) {
        case 'gzip':
          decompressed = await gunzip(compressedData);
          break;
        case 'brotli':
          decompressed = await brotliDecompress(compressedData);
          break;
        default:
          throw new Error(`Unsupported compression algorithm: ${algorithm}`);
      }

      const decompressionTime = Date.now() - startTime;
      logger.debug(
        `Decompression successful: ${compressedData.length} -> ${decompressed.length} bytes ` +
        `in ${decompressionTime}ms`
      );

      return decompressed;
    } catch (error) {
      logger.error('Decompression failed:', error);
      throw new Error(`Failed to decompress data with ${algorithm}: ${error.message}`);
    }
  }

  /**
   * 检测最佳压缩算法
   * 对小样本数据进行测试压缩，选择压缩效果最好的算法
   */
  static async detectBestAlgorithm(
    sampleData: Buffer,
    algorithms: CompressionAlgorithm[] = ['gzip', 'brotli']
  ): Promise<CompressionAlgorithm> {
    // 使用数据的前几KB进行测试
    const testSize = Math.min(sampleData.length, 4096);
    const testData = sampleData.subarray(0, testSize);

    let bestAlgorithm: CompressionAlgorithm = 'gzip';
    let bestRatio = 1.0;

    for (const algorithm of algorithms) {
      try {
        const result = await this.compress(testData, algorithm, { minSize: 0 });
        if (result.compressionRatio < bestRatio) {
          bestRatio = result.compressionRatio;
          bestAlgorithm = algorithm;
        }
      } catch (error) {
        logger.warn(`Failed to test compression with ${algorithm}:`, error);
      }
    }

    logger.debug(
      `Best compression algorithm for sample: ${bestAlgorithm} ` +
      `(ratio: ${(bestRatio * 100).toFixed(1)}%)`
    );

    return bestAlgorithm;
  }

  /**
   * 估算压缩后大小（不实际压缩）
   * 基于数据类型和大小的启发式估算
   */
  static estimateCompressedSize(
    originalSize: number,
    mimeType: string,
    algorithm: CompressionAlgorithm = 'gzip'
  ): number {
    // 不同文件类型的典型压缩率
    const compressionRates: Record<string, number> = {
      'text/plain': 0.3,
      'text/html': 0.25,
      'text/css': 0.2,
      'text/javascript': 0.35,
      'application/json': 0.15,
      'application/xml': 0.2,
      'audio/wav': 0.85,
      'audio/mpeg': 0.95,
      'image/jpeg': 0.98,
      'image/png': 0.95,
      'video/mp4': 0.98,
      'application/pdf': 0.9,
      'application/zip': 0.99
    };

    // Brotli通常比gzip有更好的压缩率
    const algorithmMultiplier = algorithm === 'brotli' ? 0.85 : 1.0;

    // 查找匹配的MIME类型
    let compressionRate = 0.6; // 默认压缩率
    for (const [type, rate] of Object.entries(compressionRates)) {
      if (mimeType.startsWith(type)) {
        compressionRate = rate;
        break;
      }
    }

    // 大文件通常有更好的压缩率
    const sizeMultiplier = originalSize > 1024 * 1024 ? 0.9 : 1.0;

    const estimatedSize = Math.round(
      originalSize * compressionRate * algorithmMultiplier * sizeMultiplier
    );

    return Math.min(estimatedSize, originalSize);
  }

  /**
   * 检查是否值得压缩
   */
  static shouldCompress(size: number, mimeType: string): boolean {
    // 太小的文件不压缩
    if (size < this.MIN_COMPRESSION_SIZE) {
      return false;
    }

    // 已经压缩的格式不再压缩
    const preCompressedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/mp4',
      'video/mp4',
      'video/mpeg',
      'video/webm',
      'application/zip',
      'application/gzip',
      'application/x-rar-compressed',
      'application/x-7z-compressed'
    ];

    return !preCompressedTypes.some(type => mimeType.startsWith(type));
  }
}