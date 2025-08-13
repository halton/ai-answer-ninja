/**
 * Performance Benchmark for Profile Analytics Service
 * 
 * This benchmark tests various components of the service to ensure
 * they meet performance requirements.
 */

import { Logger } from '../utils/Logger';
import { CacheManager } from '../utils/CacheManager';
import TrendAnalyzer from '../analytics/TrendAnalyzer';
import PredictiveModels from '../ml/PredictiveModels';

interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  memoryUsage: NodeJS.MemoryUsage;
}

class PerformanceBenchmark {
  private logger: Logger;
  private results: BenchmarkResult[];

  constructor() {
    this.logger = new Logger('PerformanceBenchmark');
    this.results = [];
  }

  /**
   * 运行所有基准测试
   */
  async runAllBenchmarks(): Promise<void> {
    this.logger.info('Starting performance benchmarks...');

    try {
      await this.benchmarkCacheOperations();
      await this.benchmarkTrendAnalysis();
      await this.benchmarkPredictiveModels();
      await this.benchmarkLogger();

      this.printResults();
    } catch (error) {
      this.logger.error('Benchmark failed', { error });
    }
  }

  /**
   * 缓存操作基准测试
   */
  private async benchmarkCacheOperations(): Promise<void> {
    this.logger.info('Benchmarking cache operations...');

    const cache = new CacheManager();
    const iterations = 10000;
    const testData = { key: 'test', value: 'benchmark_data_'.repeat(100) };

    // 测试 SET 操作
    await this.runBenchmark('cache_set', iterations, async () => {
      await cache.set(`test_key_${Math.random()}`, testData, 60);
    });

    // 预填充缓存
    for (let i = 0; i < 1000; i++) {
      await cache.set(`benchmark_key_${i}`, testData, 60);
    }

    // 测试 GET 操作
    await this.runBenchmark('cache_get', iterations, async () => {
      await cache.get(`benchmark_key_${Math.floor(Math.random() * 1000)}`);
    });

    // 测试批量操作
    const batchData = new Map();
    for (let i = 0; i < 100; i++) {
      batchData.set(`batch_key_${i}`, { value: testData, ttl: 60 });
    }

    await this.runBenchmark('cache_mset', 100, async () => {
      await cache.mset(batchData);
    });

    await cache.shutdown();
  }

  /**
   * 趋势分析基准测试
   */
  private async benchmarkTrendAnalysis(): Promise<void> {
    this.logger.info('Benchmarking trend analysis...');

    const trendAnalyzer = new TrendAnalyzer({
      windowSize: 24,
      seasonalityThreshold: 0.7,
      anomalyThreshold: 3.0,
      forecastHorizon: 48,
      enableRealTimeAnalysis: false
    });

    // 生成测试数据
    const generateTrendData = (size: number) => {
      const data = [];
      const baseTime = Date.now() - size * 3600000; // 往前推移小时数

      for (let i = 0; i < size; i++) {
        data.push({
          timestamp: new Date(baseTime + i * 3600000),
          value: Math.sin(i * 0.1) * 50 + 100 + Math.random() * 20,
          metadata: { index: i }
        });
      }

      return data;
    };

    const testData = generateTrendData(168); // 1周数据
    const context = {
      userId: 'benchmark_user',
      metric: 'test_metric',
      timeRange: {
        start: new Date(Date.now() - 7 * 24 * 3600000),
        end: new Date()
      },
      granularity: 'hour' as const
    };

    // 测试趋势分析
    await this.runBenchmark('trend_analysis', 100, async () => {
      await trendAnalyzer.analyzeTrend(testData, context);
    });

    // 测试异常检测
    await this.runBenchmark('anomaly_detection', 1000, async () => {
      const anomalyData = testData.map(point => ({
        ...point,
        value: point.value + (Math.random() > 0.95 ? 200 : 0) // 5%异常数据
      }));
      await (trendAnalyzer as any).detectAnomalies(anomalyData);
    });

    await trendAnalyzer.cleanup();
  }

  /**
   * 预测模型基准测试
   */
  private async benchmarkPredictiveModels(): Promise<void> {
    this.logger.info('Benchmarking predictive models...');

    const predictiveModels = new PredictiveModels();

    // 生成训练数据
    const generateTrainingData = (samples: number, features: number) => {
      const data = {
        features: [] as number[][],
        labels: [] as number[]
      };

      for (let i = 0; i < samples; i++) {
        const feature = [];
        for (let j = 0; j < features; j++) {
          feature.push(Math.random());
        }
        data.features.push(feature);
        data.labels.push(Math.random() > 0.5 ? 1 : 0);
      }

      return data;
    };

    const trainingData = generateTrainingData(1000, 10);

    // 测试模型训练
    await this.runBenchmark('model_training', 1, async () => {
      await predictiveModels.trainModel('benchmark_model', trainingData);
    });

    // 测试预测
    const testFeatures = trainingData.features[0];
    const model = { type: 'random_forest', trees: [] }; // 简化模型

    await this.runBenchmark('model_prediction', 10000, async () => {
      await predictiveModels.predict(model, testFeatures);
    });

    // 测试特征重要性计算
    await this.runBenchmark('feature_importance', 100, async () => {
      const featureNames = Array.from({ length: 10 }, (_, i) => `feature_${i}`);
      await predictiveModels.getFeatureImportance('benchmark_model', featureNames);
    });
  }

  /**
   * 日志系统基准测试
   */
  private async benchmarkLogger(): Promise<void> {
    this.logger.info('Benchmarking logger...');

    const testLogger = new Logger('BenchmarkLogger');
    const logData = { 
      complexObject: { 
        nested: { 
          data: 'test'.repeat(100) 
        } 
      } 
    };

    // 测试不同级别的日志记录
    await this.runBenchmark('logger_info', 10000, () => {
      testLogger.info('Benchmark info message', logData);
    });

    await this.runBenchmark('logger_debug', 10000, () => {
      testLogger.debug('Benchmark debug message', logData);
    });

    await this.runBenchmark('logger_error', 1000, () => {
      testLogger.error('Benchmark error message', logData);
    });

    await testLogger.shutdown();
  }

  /**
   * 运行单个基准测试
   */
  private async runBenchmark(
    operation: string, 
    iterations: number, 
    fn: () => void | Promise<void>
  ): Promise<void> {
    const times: number[] = [];
    const startMemory = process.memoryUsage();

    // 预热
    for (let i = 0; i < Math.min(iterations, 100); i++) {
      await fn();
    }

    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }

    // 实际测试
    const totalStart = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await fn();
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1000000); // 转换为毫秒
    }

    const totalEnd = process.hrtime.bigint();
    const totalTime = Number(totalEnd - totalStart) / 1000000; // 转换为毫秒
    const endMemory = process.memoryUsage();

    const result: BenchmarkResult = {
      operation,
      iterations,
      totalTime,
      averageTime: totalTime / iterations,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      throughput: iterations / (totalTime / 1000), // 每秒操作数
      memoryUsage: {
        rss: endMemory.rss - startMemory.rss,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        external: endMemory.external - startMemory.external,
        arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers
      }
    };

    this.results.push(result);
    this.logger.info(`Benchmark ${operation} completed`, {
      avgTime: `${result.averageTime.toFixed(3)}ms`,
      throughput: `${result.throughput.toFixed(0)} ops/sec`
    });
  }

  /**
   * 打印基准测试结果
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('PERFORMANCE BENCHMARK RESULTS');
    console.log('='.repeat(80));

    console.log(
      '| Operation'.padEnd(25) +
      '| Iterations'.padEnd(12) +
      '| Avg Time (ms)'.padEnd(15) +
      '| Throughput (ops/s)'.padEnd(20) +
      '| Memory (MB)'.padEnd(12) + '|'
    );
    console.log('|' + '-'.repeat(23) + '|' + '-'.repeat(10) + '|' + '-'.repeat(13) + '|' + '-'.repeat(18) + '|' + '-'.repeat(10) + '|');

    for (const result of this.results) {
      const memoryMB = (result.memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
      console.log(
        `| ${result.operation.padEnd(23)}` +
        `| ${result.iterations.toString().padEnd(10)}` +
        `| ${result.averageTime.toFixed(3).padEnd(13)}` +
        `| ${result.throughput.toFixed(0).padEnd(18)}` +
        `| ${memoryMB.padEnd(10)}|`
      );
    }

    console.log('='.repeat(80));

    // 性能分析
    console.log('\nPERFORMANCE ANALYSIS:');
    this.analyzeResults();
  }

  /**
   * 分析基准测试结果
   */
  private analyzeResults(): void {
    const issues: string[] = [];
    const recommendations: string[] = [];

    for (const result of this.results) {
      // 检查平均响应时间
      if (result.operation.includes('cache') && result.averageTime > 1) {
        issues.push(`Cache operation ${result.operation} is slow: ${result.averageTime.toFixed(3)}ms`);
        recommendations.push('Consider optimizing cache implementation or increasing memory allocation');
      }

      if (result.operation.includes('model_prediction') && result.averageTime > 10) {
        issues.push(`Model prediction is slow: ${result.averageTime.toFixed(3)}ms`);
        recommendations.push('Consider model optimization or using simpler algorithms for real-time predictions');
      }

      if (result.operation.includes('trend_analysis') && result.averageTime > 100) {
        issues.push(`Trend analysis is slow: ${result.averageTime.toFixed(3)}ms`);
        recommendations.push('Consider data sampling or incremental analysis for large datasets');
      }

      // 检查吞吐量
      if (result.operation.includes('cache') && result.throughput < 1000) {
        issues.push(`Low cache throughput: ${result.throughput.toFixed(0)} ops/sec`);
      }

      // 检查内存使用
      const memoryMB = result.memoryUsage.heapUsed / 1024 / 1024;
      if (memoryMB > 100) {
        issues.push(`High memory usage for ${result.operation}: ${memoryMB.toFixed(1)}MB`);
        recommendations.push('Consider implementing memory pooling or data streaming');
      }
    }

    if (issues.length === 0) {
      console.log('✅ All performance metrics are within acceptable ranges');
    } else {
      console.log('\n❌ Performance Issues Found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
      
      console.log('\n💡 Recommendations:');
      recommendations.forEach(rec => console.log(`  - ${rec}`));
    }

    // 计算总体评分
    const overallScore = this.calculateOverallScore();
    console.log(`\n📊 Overall Performance Score: ${overallScore}/100`);
    
    if (overallScore >= 90) {
      console.log('🚀 Excellent performance!');
    } else if (overallScore >= 70) {
      console.log('✅ Good performance with room for improvement');
    } else if (overallScore >= 50) {
      console.log('⚠️  Moderate performance, optimization recommended');
    } else {
      console.log('🔥 Poor performance, optimization required');
    }
  }

  /**
   * 计算总体性能评分
   */
  private calculateOverallScore(): number {
    let totalScore = 0;
    let weightSum = 0;

    for (const result of this.results) {
      let score = 100;
      let weight = 1;

      // 根据操作类型设置权重
      if (result.operation.includes('cache')) {
        weight = 3; // 缓存操作更重要
        if (result.averageTime > 1) score -= (result.averageTime - 1) * 10;
        if (result.throughput < 1000) score -= (1000 - result.throughput) / 10;
      } else if (result.operation.includes('prediction')) {
        weight = 2;
        if (result.averageTime > 10) score -= (result.averageTime - 10) * 2;
      } else {
        weight = 1;
        if (result.averageTime > 100) score -= (result.averageTime - 100) / 10;
      }

      // 内存使用惩罚
      const memoryMB = result.memoryUsage.heapUsed / 1024 / 1024;
      if (memoryMB > 50) {
        score -= (memoryMB - 50) * 0.5;
      }

      totalScore += Math.max(0, score) * weight;
      weightSum += weight;
    }

    return Math.round(totalScore / weightSum);
  }
}

// 运行基准测试
async function main() {
  const benchmark = new PerformanceBenchmark();
  await benchmark.runAllBenchmarks();
}

// 如果直接运行此文件
if (require.main === module) {
  main().catch(console.error);
}

export default PerformanceBenchmark;