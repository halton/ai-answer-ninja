import { PerformanceMonitor } from '../../services/realtime-processor/src/services/performanceMonitor';
import { ProcessingStage } from '../../services/realtime-processor/src/types';

describe('Enhanced Performance Monitor', () => {
  let performanceMonitor: PerformanceMonitor;

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor({
      metricsInterval: 1000, // 1 second for testing
      alertThresholds: {
        latency: 500,
        cpuUsage: 80,
        memoryUsage: 85,
        errorRate: 5
      },
      optimizationTargets: {
        totalPipelineLatency: 400,
        audioPreprocessing: 30,
        speechToText: 120,
        intentRecognition: 60,
        aiGeneration: 150,
        textToSpeech: 80
      }
    });
  });

  afterEach(() => {
    performanceMonitor.stop();
  });

  describe('Real-time Performance Monitoring', () => {
    test('should record latency with enhanced tracking', async () => {
      const connectionId = 'test-connection-1';
      const stage = ProcessingStage.SPEECH_TO_TEXT;
      const latency = 145;

      await performanceMonitor.recordLatency(connectionId, stage, latency);

      const stats = performanceMonitor.getLatencyStatistics(stage.toString());
      expect(stats.has(stage.toString())).toBe(true);
      
      const stageStats = stats.get(stage.toString());
      expect(stageStats?.samples).toBe(1);
      expect(stageStats?.mean).toBe(latency);
    });

    test('should detect performance bottlenecks', async () => {
      const connectionId = 'test-connection-2';
      
      // 记录超过阈值的延迟
      await performanceMonitor.recordLatency(connectionId, ProcessingStage.AI_GENERATION, 300); // 超过150ms目标
      await performanceMonitor.recordLatency(connectionId, ProcessingStage.AI_GENERATION, 350);
      await performanceMonitor.recordLatency(connectionId, ProcessingStage.AI_GENERATION, 400);

      return new Promise((resolve) => {
        performanceMonitor.on('bottlenecks_detected', (data) => {
          expect(data.bottlenecks).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                stage: ProcessingStage.AI_GENERATION.toString(),
                severity: expect.any(Number)
              })
            ])
          );
          resolve(undefined);
        });

        performanceMonitor.start();
        
        // 手动触发分析
        setTimeout(() => {
          (performanceMonitor as any).detectBottlenecks();
        }, 100);
      });
    });

    test('should provide optimization recommendations', () => {
      const connectionId = 'test-connection-3';
      
      // 添加一些性能数据
      performanceMonitor.recordStageLatency(ProcessingStage.SPEECH_TO_TEXT.toString(), 180); // 超过120ms目标
      performanceMonitor.recordStageLatency(ProcessingStage.SPEECH_TO_TEXT.toString(), 200);
      performanceMonitor.recordStageLatency(ProcessingStage.SPEECH_TO_TEXT.toString(), 190);

      const recommendations = performanceMonitor.getOptimizationRecommendations();
      
      expect(recommendations.length).toBeGreaterThan(0);
      const sttRecommendation = recommendations.find(r => r.stage === ProcessingStage.SPEECH_TO_TEXT.toString());
      expect(sttRecommendation).toBeDefined();
      expect(sttRecommendation?.actions).toContain('Increase Azure Speech connection pooling');
      expect(sttRecommendation?.confidence).toBeGreaterThan(0);
    });

    test('should emit latency violation events', (done) => {
      const connectionId = 'test-connection-4';
      
      performanceMonitor.on('latency_violation', (data) => {
        expect(data.stage).toBe(ProcessingStage.TEXT_TO_SPEECH.toString());
        expect(data.latency).toBe(200);
        expect(data.target).toBe(80);
        done();
      });

      performanceMonitor.recordStageLatency(ProcessingStage.TEXT_TO_SPEECH.toString(), 200); // 超过80ms目标的1.5倍
    });
  });

  describe('Advanced Analytics', () => {
    test('should calculate health status correctly', () => {
      // 添加正常性能数据
      performanceMonitor.recordStageLatency('preprocessing', 25);
      performanceMonitor.recordStageLatency('speech_to_text', 100);
      performanceMonitor.recordStageLatency('ai_generation', 130);

      const health = performanceMonitor.getHealthStatus();
      
      expect(health.status).toBe('healthy');
      expect(health.latency).toBeLessThan(400); // 总目标延迟
      expect(health.errorRate).toBeLessThan(5);
    });

    test('should handle concurrent performance monitoring', async () => {
      const promises = [];
      
      // 模拟并发性能记录
      for (let i = 0; i < 100; i++) {
        promises.push(
          performanceMonitor.recordLatency(`connection-${i}`, ProcessingStage.PREPROCESSING, Math.random() * 50 + 10)
        );
      }

      await Promise.all(promises);

      const stats = performanceMonitor.getLatencyStatistics(ProcessingStage.PREPROCESSING.toString());
      const preprocessingStats = stats.get(ProcessingStage.PREPROCESSING.toString());
      
      expect(preprocessingStats?.samples).toBe(100);
      expect(preprocessingStats?.mean).toBeGreaterThan(10);
      expect(preprocessingStats?.mean).toBeLessThan(60);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should record and track errors properly', async () => {
      const connectionId = 'test-connection-error';
      const error = new Error('Test processing error');

      await performanceMonitor.recordError(connectionId, ProcessingStage.AI_GENERATION, error, 500);

      const errorStats = performanceMonitor.getErrorStats();
      expect(errorStats.totalErrors).toBe(1);
      expect(errorStats.errorsByStage[ProcessingStage.AI_GENERATION.toString()]).toBe(1);
    });

    test('should reset metrics correctly', () => {
      // 添加一些数据
      performanceMonitor.recordStageLatency('test_stage', 100);
      performanceMonitor.recordThroughput({ messagesPerSecond: 50, audioChunksPerSecond: 20, bytesPerSecond: 1024, concurrentConnections: 5 });

      // 验证数据存在
      let stats = performanceMonitor.getLatencyStatistics();
      expect(stats.size).toBeGreaterThan(0);

      // 重置
      performanceMonitor.reset();

      // 验证数据已清空
      stats = performanceMonitor.getLatencyStatistics();
      expect(stats.size).toBe(0);
    });
  });

  describe('Auto-Optimization Features', () => {
    test('should trigger auto-optimization on latency violations', (done) => {
      const connectionId = 'test-auto-opt';
      
      // 监听自动优化事件
      performanceMonitor.on('optimization_required', (data) => {
        expect(data.stage).toBe(ProcessingStage.AI_GENERATION.toString());
        expect(data.recommendation).toBeDefined();
        expect(data.actions).toBeInstanceOf(Array);
        done();
      });

      // 记录触发自动优化的高延迟
      performanceMonitor.recordStageLatency(ProcessingStage.AI_GENERATION.toString(), 500); // 远超150ms目标
    });

    test('should provide stage-specific optimization actions', () => {
      const recommendations = performanceMonitor.getOptimizationRecommendations();
      
      // 添加各种stage的高延迟数据
      performanceMonitor.recordStageLatency(ProcessingStage.SPEECH_TO_TEXT.toString(), 250);
      performanceMonitor.recordStageLatency(ProcessingStage.AI_GENERATION.toString(), 400);
      performanceMonitor.recordStageLatency(ProcessingStage.TEXT_TO_SPEECH.toString(), 150);

      const newRecommendations = performanceMonitor.getOptimizationRecommendations();
      
      const sttRec = newRecommendations.find(r => r.stage === ProcessingStage.SPEECH_TO_TEXT.toString());
      const aiRec = newRecommendations.find(r => r.stage === ProcessingStage.AI_GENERATION.toString());
      const ttsRec = newRecommendations.find(r => r.stage === ProcessingStage.TEXT_TO_SPEECH.toString());

      if (sttRec) {
        expect(sttRec.actions).toContain('Enable streaming recognition mode');
      }
      
      if (aiRec) {
        expect(aiRec.actions).toContain('Enable response streaming');
      }
      
      if (ttsRec) {
        expect(ttsRec.actions).toContain('Implement TTS response caching');
      }
    });
  });
});