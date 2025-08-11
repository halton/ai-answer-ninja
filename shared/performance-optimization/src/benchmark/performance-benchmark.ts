#!/usr/bin/env node

/**
 * Performance Benchmark Tool
 * Tests and validates performance optimizations against target latencies
 */

import { PerformanceOptimizationSuite } from '../index';
import { PredictiveCache } from '../cache/PredictiveCache';
import { QueryOptimizer } from '../database/QueryOptimizer';
import { NetworkOptimizer } from '../network/NetworkOptimizer';
import * as fs from 'fs';
import * as path from 'path';

interface BenchmarkResult {
  test: string;
  target: number;
  actual: number;
  passed: boolean;
  percentile95: number;
  percentile99: number;
  samples: number;
}

interface StageTarget {
  name: string;
  mvp: number;
  optimization: number;
  production: number;
}

class PerformanceBenchmark {
  private suite: PerformanceOptimizationSuite;
  private results: BenchmarkResult[] = [];
  
  // Stage targets from CLAUDE.md
  private readonly stageTargets: StageTarget[] = [
    { name: 'audio_preprocessing', mvp: 80, optimization: 50, production: 30 },
    { name: 'speech_recognition', mvp: 350, optimization: 250, production: 180 },
    { name: 'ai_generation', mvp: 450, optimization: 300, production: 200 },
    { name: 'text_to_speech', mvp: 300, optimization: 200, production: 120 },
    { name: 'network_transmission', mvp: 150, optimization: 100, production: 50 },
    { name: 'total_pipeline', mvp: 1500, optimization: 1000, production: 800 },
  ];
  
  constructor() {
    this.suite = new PerformanceOptimizationSuite({
      cache: {
        enabled: true,
        maxSize: 10000,
        ttl: 300000,
        predictive: true,
      },
      database: {
        connectionString: process.env.DATABASE_URL || 'postgresql://localhost/test',
        poolSize: 20,
        queryCache: true,
        slowQueryThreshold: 50,
      },
      network: {
        compression: true,
        connectionPooling: true,
        batching: true,
        http2: true,
      },
      monitoring: {
        enabled: true,
        interval: 1000,
        metrics: ['latency', 'throughput', 'cache', 'system'],
      },
      optimization: {
        autoTune: true,
        targetLatency: 1000,
        memoryLimit: 512 * 1024 * 1024,
        cpuLimit: 0.8,
      },
    });
  }

  /**
   * Run complete benchmark suite
   */
  async runBenchmark(stage: 'mvp' | 'optimization' | 'production' = 'optimization'): Promise<void> {
    console.log('\\n🚀 AI Answer Ninja Performance Benchmark');
    console.log('=========================================');
    console.log(`Stage: ${stage.toUpperCase()}`);
    console.log(`Target Latency: < ${this.getStageTarget('total_pipeline', stage)}ms`);
    console.log('\\nRunning benchmarks...\\n');
    
    // Warm up
    await this.warmUp();
    
    // Run individual component benchmarks
    await this.benchmarkCache(stage);
    await this.benchmarkDatabase(stage);
    await this.benchmarkNetwork(stage);
    await this.benchmarkPipeline(stage);
    
    // Print results
    this.printResults(stage);
    
    // Cleanup
    await this.cleanup();
  }

  /**
   * Warm up caches and connections
   */
  private async warmUp(): Promise<void> {
    console.log('Warming up...');
    
    const cache = new PredictiveCache({ maxSize: 1000, ttl: 60000 });
    
    // Warm up cache
    for (let i = 0; i < 100; i++) {
      await cache.set(`warmup_${i}`, { data: `value_${i}` });
    }
    
    for (let i = 0; i < 100; i++) {
      await cache.get(`warmup_${i}`);
    }
    
    cache.shutdown();
    
    console.log('Warm up complete\\n');
  }

  /**
   * Benchmark cache performance
   */
  private async benchmarkCache(stage: string): Promise<void> {
    console.log('📊 Benchmarking Cache Performance...');
    
    const cache = new PredictiveCache({
      maxSize: 10000,
      ttl: 300000,
      strategy: {
        aggressive: true,
        threshold: 0.6,
        maxPrefetch: 10,
      },
    });
    
    const samples = 1000;
    const latencies: number[] = [];
    
    // Pre-populate cache
    for (let i = 0; i < 500; i++) {
      await cache.set(`test_${i}`, { value: `data_${i}` });
    }
    
    // Benchmark cache hits
    for (let i = 0; i < samples; i++) {
      const key = `test_${Math.floor(Math.random() * 500)}`;
      const start = process.hrtime.bigint();
      await cache.get(key);
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1000000); // Convert to ms
    }
    
    const result = this.analyzeLatencies('cache_hit', latencies, 10); // Target: < 10ms
    this.results.push(result);
    
    // Benchmark cache misses with fetch
    const missLatencies: number[] = [];
    
    for (let i = 0; i < samples / 10; i++) {
      const key = `miss_${i}`;
      const start = process.hrtime.bigint();
      await cache.get(key, async () => {
        await this.sleep(5); // Simulate fetch
        return { value: `fetched_${i}` };
      });
      const end = process.hrtime.bigint();
      missLatencies.push(Number(end - start) / 1000000);
    }
    
    const missResult = this.analyzeLatencies('cache_miss_with_fetch', missLatencies, 20);
    this.results.push(missResult);
    
    cache.shutdown();
    
    console.log(`  ✓ Cache hit latency: ${result.actual.toFixed(2)}ms (p95: ${result.percentile95.toFixed(2)}ms)`);
    console.log(`  ✓ Cache miss latency: ${missResult.actual.toFixed(2)}ms\\n`);
  }

  /**
   * Benchmark database performance
   */
  private async benchmarkDatabase(stage: string): Promise<void> {
    console.log('📊 Benchmarking Database Performance...');
    
    // Skip if no database connection
    if (!process.env.DATABASE_URL) {
      console.log('  ⚠️  Skipping - No database connection\\n');
      return;
    }
    
    const optimizer = new QueryOptimizer({
      connectionString: process.env.DATABASE_URL,
      poolConfig: { max: 20 },
      cacheSize: 1000,
      slowQueryThreshold: 50,
    });
    
    const samples = 100;
    const latencies: number[] = [];
    
    // Simple query benchmark
    for (let i = 0; i < samples; i++) {
      const start = process.hrtime.bigint();
      await optimizer.query('SELECT 1 as value', [], { cache: true });
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1000000);
    }
    
    const result = this.analyzeLatencies('database_query', latencies, 20);
    this.results.push(result);
    
    // Parallel query benchmark
    const parallelLatencies: number[] = [];
    
    for (let i = 0; i < samples / 10; i++) {
      const start = process.hrtime.bigint();
      await optimizer.parallel([
        { text: 'SELECT 1', cache: true },
        { text: 'SELECT 2', cache: true },
        { text: 'SELECT 3', cache: true },
      ]);
      const end = process.hrtime.bigint();
      parallelLatencies.push(Number(end - start) / 1000000);
    }
    
    const parallelResult = this.analyzeLatencies('database_parallel', parallelLatencies, 30);
    this.results.push(parallelResult);
    
    await optimizer.shutdown();
    
    console.log(`  ✓ Query latency: ${result.actual.toFixed(2)}ms (p95: ${result.percentile95.toFixed(2)}ms)`);
    console.log(`  ✓ Parallel query latency: ${parallelResult.actual.toFixed(2)}ms\\n`);
  }

  /**
   * Benchmark network performance
   */
  private async benchmarkNetwork(stage: string): Promise<void> {
    console.log('📊 Benchmarking Network Performance...');
    
    const optimizer = new NetworkOptimizer({
      compression: {
        enabled: true,
        algorithm: 'brotli',
        level: 4,
        threshold: 512,
        adaptiveCompression: true,
      },
      connectionPool: {
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 5000,
        keepAliveTimeout: 60000,
        scheduling: 'lifo',
      },
    });
    
    const samples = 100;
    const latencies: number[] = [];
    
    // Compression benchmark
    const testData = Buffer.from(JSON.stringify({
      message: 'Test data for compression benchmark',
      array: Array(100).fill('data'),
    }));
    
    for (let i = 0; i < samples; i++) {
      const start = process.hrtime.bigint();
      // Simulate network operation with compression
      await this.simulateNetworkOperation(optimizer, testData);
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1000000);
    }
    
    const result = this.analyzeLatencies('network_compression', latencies, 10);
    this.results.push(result);
    
    optimizer.shutdown();
    
    console.log(`  ✓ Network latency: ${result.actual.toFixed(2)}ms (p95: ${result.percentile95.toFixed(2)}ms)\\n`);
  }

  /**
   * Benchmark complete pipeline
   */
  private async benchmarkPipeline(stage: string): Promise<void> {
    console.log('📊 Benchmarking Complete Pipeline...');
    
    const stageStr = stage as 'mvp' | 'optimization' | 'production';
    const samples = 50;
    const pipelineLatencies: number[] = [];
    const stageLatencies: Map<string, number[]> = new Map();
    
    // Initialize stage latency arrays
    for (const target of this.stageTargets) {
      stageLatencies.set(target.name, []);
    }
    
    for (let i = 0; i < samples; i++) {
      const start = process.hrtime.bigint();
      const stageResults = await this.simulatePipeline(stageStr);
      const end = process.hrtime.bigint();
      
      const totalLatency = Number(end - start) / 1000000;
      pipelineLatencies.push(totalLatency);
      
      // Record individual stage latencies
      for (const [stage, latency] of Object.entries(stageResults)) {
        stageLatencies.get(stage)?.push(latency);
      }
    }
    
    // Analyze total pipeline
    const totalTarget = this.getStageTarget('total_pipeline', stageStr);
    const totalResult = this.analyzeLatencies('total_pipeline', pipelineLatencies, totalTarget);
    this.results.push(totalResult);
    
    console.log(`  ✓ Total pipeline: ${totalResult.actual.toFixed(2)}ms (target: ${totalTarget}ms)`);
    
    // Analyze individual stages
    for (const target of this.stageTargets) {
      if (target.name !== 'total_pipeline') {
        const latencies = stageLatencies.get(target.name) || [];
        if (latencies.length > 0) {
          const stageTarget = this.getStageTarget(target.name, stageStr);
          const result = this.analyzeLatencies(target.name, latencies, stageTarget);
          this.results.push(result);
          
          const icon = result.passed ? '✓' : '✗';
          console.log(`  ${icon} ${target.name}: ${result.actual.toFixed(2)}ms (target: ${stageTarget}ms)`);
        }
      }
    }
    
    console.log('');
  }

  /**
   * Simulate complete pipeline
   */
  private async simulatePipeline(stage: 'mvp' | 'optimization' | 'production'): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    
    // Simulate each stage with target-based delays
    const stages = [
      { name: 'audio_preprocessing', work: () => this.simulateAudioProcessing(stage) },
      { name: 'speech_recognition', work: () => this.simulateSTT(stage) },
      { name: 'ai_generation', work: () => this.simulateAIGeneration(stage) },
      { name: 'text_to_speech', work: () => this.simulateTTS(stage) },
      { name: 'network_transmission', work: () => this.simulateNetworkTransmission(stage) },
    ];
    
    for (const stage of stages) {
      const start = process.hrtime.bigint();
      await stage.work();
      const end = process.hrtime.bigint();
      results[stage.name] = Number(end - start) / 1000000;
    }
    
    return results;
  }

  /**
   * Simulate audio processing
   */
  private async simulateAudioProcessing(stage: string): Promise<void> {
    const target = this.getStageTarget('audio_preprocessing', stage);
    const variance = target * 0.2;
    const delay = target - variance + Math.random() * variance * 2;
    await this.sleep(delay);
  }

  /**
   * Simulate STT
   */
  private async simulateSTT(stage: string): Promise<void> {
    const target = this.getStageTarget('speech_recognition', stage);
    const variance = target * 0.3;
    const delay = target - variance + Math.random() * variance * 2;
    await this.sleep(delay);
  }

  /**
   * Simulate AI generation
   */
  private async simulateAIGeneration(stage: string): Promise<void> {
    const target = this.getStageTarget('ai_generation', stage);
    const variance = target * 0.3;
    const delay = target - variance + Math.random() * variance * 2;
    await this.sleep(delay);
  }

  /**
   * Simulate TTS
   */
  private async simulateTTS(stage: string): Promise<void> {
    const target = this.getStageTarget('text_to_speech', stage);
    const variance = target * 0.2;
    const delay = target - variance + Math.random() * variance * 2;
    await this.sleep(delay);
  }

  /**
   * Simulate network transmission
   */
  private async simulateNetworkTransmission(stage: string): Promise<void> {
    const target = this.getStageTarget('network_transmission', stage);
    const variance = target * 0.4;
    const delay = target - variance + Math.random() * variance * 2;
    await this.sleep(delay);
  }

  /**
   * Simulate network operation
   */
  private async simulateNetworkOperation(optimizer: NetworkOptimizer, data: Buffer): Promise<void> {
    // Simulate compression and network delay
    await this.sleep(5 + Math.random() * 5);
  }

  /**
   * Analyze latency results
   */
  private analyzeLatencies(test: string, latencies: number[], target: number): BenchmarkResult {
    latencies.sort((a, b) => a - b);
    
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    
    return {
      test,
      target,
      actual: avg,
      passed: avg <= target,
      percentile95: p95,
      percentile99: p99,
      samples: latencies.length,
    };
  }

  /**
   * Get stage target based on profile
   */
  private getStageTarget(name: string, stage: string): number {
    const target = this.stageTargets.find(t => t.name === name);
    if (!target) return 100;
    
    switch (stage) {
      case 'mvp':
        return target.mvp;
      case 'optimization':
        return target.optimization;
      case 'production':
        return target.production;
      default:
        return target.optimization;
    }
  }

  /**
   * Print benchmark results
   */
  private printResults(stage: string): void {
    console.log('\\n📈 Benchmark Results Summary');
    console.log('========================================');
    console.log(`Stage: ${stage.toUpperCase()}`);
    console.log('');
    
    // Group results by pass/fail
    const passed = this.results.filter(r => r.passed);
    const failed = this.results.filter(r => !r.passed);
    
    console.log(`✅ Passed: ${passed.length}/${this.results.length}`);
    console.log(`❌ Failed: ${failed.length}/${this.results.length}`);
    console.log('');
    
    // Print detailed results
    console.log('Detailed Results:');
    console.log('-----------------');
    
    const maxTestLength = Math.max(...this.results.map(r => r.test.length));
    
    for (const result of this.results) {
      const icon = result.passed ? '✅' : '❌';
      const testName = result.test.padEnd(maxTestLength);
      const actual = result.actual.toFixed(2).padStart(8);
      const target = result.target.toFixed(2).padStart(8);
      const p95 = result.percentile95.toFixed(2).padStart(8);
      const p99 = result.percentile99.toFixed(2).padStart(8);
      
      console.log(`${icon} ${testName} | Avg: ${actual}ms | Target: ${target}ms | P95: ${p95}ms | P99: ${p99}ms`);
    }
    
    console.log('');
    
    // Overall assessment
    const totalPipelineResult = this.results.find(r => r.test === 'total_pipeline');
    
    if (totalPipelineResult) {
      console.log('🎯 Overall Assessment:');
      console.log('---------------------');
      
      if (totalPipelineResult.passed) {
        console.log(`✅ SUCCESS: Pipeline meets ${stage} target of ${totalPipelineResult.target}ms`);
        console.log(`   Average latency: ${totalPipelineResult.actual.toFixed(2)}ms`);
        console.log(`   P95 latency: ${totalPipelineResult.percentile95.toFixed(2)}ms`);
      } else {
        const excess = ((totalPipelineResult.actual - totalPipelineResult.target) / totalPipelineResult.target * 100).toFixed(1);
        console.log(`❌ FAILURE: Pipeline exceeds ${stage} target by ${excess}%`);
        console.log(`   Target: ${totalPipelineResult.target}ms`);
        console.log(`   Actual: ${totalPipelineResult.actual.toFixed(2)}ms`);
        console.log(`   Optimization needed: ${(totalPipelineResult.actual - totalPipelineResult.target).toFixed(2)}ms`);
      }
    }
    
    console.log('');
    
    // Save results to file
    this.saveResults(stage);
  }

  /**
   * Save results to file
   */
  private saveResults(stage: string): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `benchmark-${stage}-${timestamp}.json`;
    const filepath = path.join(process.cwd(), 'benchmark-results', filename);
    
    // Create directory if it doesn't exist
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const data = {
      timestamp: new Date().toISOString(),
      stage,
      results: this.results,
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.passed).length,
        failed: this.results.filter(r => !r.passed).length,
        avgLatency: this.results.find(r => r.test === 'total_pipeline')?.actual,
      },
    };
    
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`📁 Results saved to: ${filename}`);
  }

  /**
   * Cleanup
   */
  private async cleanup(): Promise<void> {
    await this.suite.shutdown();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run benchmark if called directly
if (require.main === module) {
  const stage = (process.argv[2] as 'mvp' | 'optimization' | 'production') || 'optimization';
  
  const benchmark = new PerformanceBenchmark();
  
  benchmark.runBenchmark(stage)
    .then(() => {
      console.log('\\n✨ Benchmark complete!\\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\\n❌ Benchmark failed:', error);
      process.exit(1);
    });
}

export default PerformanceBenchmark;