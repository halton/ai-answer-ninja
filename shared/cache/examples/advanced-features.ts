/**
 * 高级特性示例 - 预测式缓存、一致性管理、性能监控
 */

import { CacheSystemFactory } from '../src';

async function advancedFeaturesExample() {
  console.log('=== AI Answer Ninja Cache System - Advanced Features Example ===\n');

  // 高级配置
  const cacheFactory = new CacheSystemFactory({
    l1: {
      maxSize: 2000,
      ttl: 1800000, // 30分钟
      checkPeriod: 120
    },
    l2: {
      host: 'localhost',
      port: 6379,
      ttl: 3600, // 1小时
      cluster: {
        nodes: [
          { host: 'localhost', port: 6379 }
        ]
      }
    },
    l3: {
      enabled: false
    },
    compression: {
      enabled: true,
      threshold: 1024,
      algorithm: 'gzip'
    },
    monitoring: {
      enabled: true,
      metricsInterval: 15000, // 15秒
      alertThresholds: {
        hitRatio: 0.8,
        errorRate: 0.02,
        latency: 500
      }
    },
    predictiveCaching: {
      enabled: true,
      warmupConfig: {
        enabled: true,
        strategies: [
          {
            name: 'user-behavior-prediction',
            priority: 1,
            schedule: '*/1 * * * *', // 每分钟
            batchSize: 20,
            concurrency: 5
          },
          {
            name: 'spam-pattern-analysis',
            priority: 2,
            schedule: '*/2 * * * *', // 每2分钟
            batchSize: 50,
            concurrency: 3
          }
        ],
        triggers: [
          { event: 'user-login', handler: 'preload-user-data' },
          { event: 'call-incoming', handler: 'preload-call-data' }
        ]
      }
    },
    consistency: {
      enabled: true,
      nodeId: 'advanced-example-node',
      policy: {
        type: 'eventual',
        syncTimeout: 5000,
        conflictResolution: 'last-write-wins',
        replicationFactor: 2
      },
      syncBatchSize: 15,
      syncInterval: 20000,
      conflictRetryAttempts: 3,
      enableVersioning: true,
      enableEventualConsistency: true
    }
  });

  try {
    console.log('1. Initializing advanced cache system...');
    const { 
      cache, 
      strategyManager, 
      predictiveSystem, 
      monitor, 
      consistencyManager 
    } = await cacheFactory.initialize();
    console.log('✅ Advanced cache system initialized\n');

    // 2. 智能缓存策略演示
    console.log('2. Smart caching strategies:');
    await demonstrateCachingStrategies(cache, strategyManager);

    // 3. 预测式缓存演示
    console.log('\n3. Predictive caching:');
    if (predictiveSystem) {
      await demonstratePredictiveCaching(cache, predictiveSystem);
    }

    // 4. 性能监控演示
    console.log('\n4. Performance monitoring:');
    if (monitor) {
      await demonstratePerformanceMonitoring(cache, monitor);
    }

    // 5. 一致性管理演示
    console.log('\n5. Consistency management:');
    if (consistencyManager) {
      await demonstrateConsistencyManagement(cache, consistencyManager);
    }

    // 6. 压力测试
    console.log('\n6. Stress testing:');
    await performStressTest(cache);

    // 7. 热点数据分析
    console.log('\n7. Hotspot analysis:');
    if (monitor) {
      const hotspots = monitor.getHotspotAnalysis();
      console.log(`📊 Found ${hotspots.length} hotspot keys`);
      hotspots.slice(0, 5).forEach(hotspot => {
        console.log(`   🔥 ${hotspot.namespace}:${hotspot.key} - ${hotspot.accessCount} accesses, ${(hotspot.hitRatio * 100).toFixed(1)}% hit ratio`);
      });
    }

    // 8. 系统状态报告
    console.log('\n8. System status report:');
    const systemStatus = await cacheFactory.getSystemStatus();
    console.log('📋 System Status:');
    console.log(`   Initialized: ${systemStatus.initialized ? '✅' : '❌'}`);
    console.log('   Components:');
    Object.entries(systemStatus.components).forEach(([name, enabled]) => {
      console.log(`     ${name}: ${enabled ? '✅' : '❌'}`);
    });

    if (systemStatus.health) {
      console.log(`   Overall Health: ${systemStatus.health.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    }

    console.log('\n=== Advanced features demonstration completed! ===');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    console.log('\n9. Shutdown...');
    await cacheFactory.shutdown();
    console.log('✅ Advanced cache system shutdown complete');
  }
}

async function demonstrateCachingStrategies(cache: any, strategyManager: any) {
  const userKey = { namespace: 'user-profiles', key: 'strategic-user:456' };
  const userData = {
    id: '456',
    name: 'Strategy Test User',
    activity: 'high',
    preferences: { cacheable: true }
  };

  // 使用策略管理器评估缓存决策
  const shouldCache = await strategyManager.shouldCache(userKey, userData);
  const optimalTTL = await strategyManager.getTTL(userKey);
  const priority = await strategyManager.evaluatePriority(userKey);

  console.log(`   🧠 Strategy evaluation for ${userKey.key}:`);
  console.log(`      Should cache: ${shouldCache ? '✅' : '❌'}`);
  console.log(`      Optimal TTL: ${optimalTTL}s`);
  console.log(`      Priority score: ${priority.toFixed(2)}`);

  if (shouldCache) {
    await cache.set(userKey, userData, { ttl: optimalTTL });
    console.log('   ✅ Data cached using intelligent strategy');
  }
}

async function demonstratePredictiveCaching(cache: any, predictiveSystem: any) {
  // 模拟用户行为模式
  const userId = 'predictive-user-789';
  const sessionId = 'session-123';
  
  const context = {
    userId,
    sessionId,
    timestamp: Date.now(),
    patterns: [
      { key: 'user-profiles:user:789', frequency: 15, lastAccessed: Date.now() - 300000 },
      { key: 'whitelist:user:789', frequency: 8, lastAccessed: Date.now() - 180000 },
      { key: 'conversations:recent-789', frequency: 5, lastAccessed: Date.now() - 60000 }
    ]
  };

  // 记录访问模式
  predictiveSystem.recordAccess({ namespace: 'user-profiles', key: 'user:789' }, context);
  console.log('   📈 User access pattern recorded');

  // 执行预测
  const predictions = await predictiveSystem.predict(context);
  console.log(`   🔮 Generated ${predictions.length} predictions:`);
  
  predictions.slice(0, 3).forEach(prediction => {
    console.log(`      ${prediction.key.namespace}:${prediction.key.key} - ${(prediction.probability * 100).toFixed(1)}% probability`);
  });

  // 执行预热
  if (predictions.length > 0) {
    await predictiveSystem.warmup(predictions.slice(0, 2));
    console.log('   🔥 Cache warmup completed');
  }

  // 显示统计
  const stats = predictiveSystem.getStats();
  console.log(`   📊 Predictive caching stats:`);
  console.log(`      Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`      Predictions: ${stats.predictions}`);
  console.log(`      Active patterns: ${stats.activePatterns}`);
}

async function demonstratePerformanceMonitoring(cache: any, monitor: any) {
  // 生成一些缓存活动来展示监控功能
  const testKeys = Array.from({ length: 20 }, (_, i) => ({
    namespace: 'performance-test',
    key: `test-key-${i}`
  }));

  // 并行执行缓存操作
  const operations = testKeys.map(async (key, index) => {
    const value = { index, timestamp: Date.now(), data: `test-data-${index}` };
    await cache.set(key, value);
    
    // 随机访问一些键来模拟真实流量
    if (Math.random() > 0.5) {
      await cache.get(key);
    }
  });

  await Promise.all(operations);
  console.log('   ⚡ Generated test cache operations');

  // 等待指标收集
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 获取性能报告
  const performanceReport = await monitor.getPerformanceReport();
  console.log('   📊 Performance Report:');
  console.log(`      Overall health score: ${performanceReport.summary.overallHealth.toFixed(1)}`);
  console.log(`      Hit ratio: ${(performanceReport.summary.performance.hitRatio * 100).toFixed(1)}%`);
  console.log(`      Avg latency: ${performanceReport.summary.performance.avgLatency.toFixed(2)}ms`);
  console.log(`      Throughput: ${performanceReport.summary.performance.throughput} ops/min`);

  if (performanceReport.alerts.length > 0) {
    console.log(`   ⚠️  Active alerts: ${performanceReport.alerts.length}`);
  }

  if (performanceReport.recommendations.length > 0) {
    console.log('   💡 Recommendations:');
    performanceReport.recommendations.slice(0, 2).forEach(rec => {
      console.log(`      - ${rec}`);
    });
  }
}

async function demonstrateConsistencyManagement(cache: any, consistencyManager: any) {
  const testKey = { namespace: 'consistency-test', key: 'distributed-data' };
  const testValue = {
    version: 1,
    data: 'original-value',
    timestamp: Date.now()
  };

  // 同步设置到分布式节点
  console.log('   🔄 Synchronizing data across nodes...');
  const syncSuccess = await consistencyManager.syncSet(testKey, testValue);
  console.log(`   ${syncSuccess ? '✅' : '❌'} Sync operation: ${syncSuccess ? 'SUCCESS' : 'FAILED'}`);

  // 模拟冲突检测和解决
  console.log('   🔍 Checking for consistency conflicts...');
  const conflictResolved = await consistencyManager.detectAndResolveConflicts(testKey);
  console.log(`   ${conflictResolved ? '✅' : '❌'} Conflict resolution: ${conflictResolved ? 'SUCCESS' : 'FAILED'}`);

  // 获取一致性状态
  const consistencyStatus = await consistencyManager.getConsistencyStatus();
  console.log('   📋 Consistency Status:');
  console.log(`      Is consistent: ${consistencyStatus.isConsistent ? '✅' : '❌'}`);
  console.log(`      Inconsistent keys: ${consistencyStatus.inconsistentKeys.length}`);
  console.log(`      Pending operations: ${consistencyStatus.pendingOperations}`);
  console.log(`      Last sync: ${new Date(consistencyStatus.lastSyncTime).toLocaleTimeString()}`);
}

async function performStressTest(cache: any) {
  const operations = 100;
  const concurrency = 10;
  const startTime = Date.now();

  console.log(`   ⚡ Starting stress test: ${operations} operations with ${concurrency} concurrency`);

  const tasks = Array.from({ length: operations }, async (_, i) => {
    const key = { namespace: 'stress-test', key: `stress-key-${i % 20}` }; // 重复键以测试命中率
    const value = { id: i, data: `stress-data-${i}`, timestamp: Date.now() };

    // 随机操作：70% set, 30% get
    if (Math.random() > 0.3) {
      await cache.set(key, value);
    } else {
      await cache.get(key);
    }
  });

  // 分批执行以控制并发
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    await Promise.all(batch);
  }

  const duration = Date.now() - startTime;
  const throughput = (operations / duration) * 1000; // ops/second

  console.log(`   ✅ Stress test completed:`);
  console.log(`      Duration: ${duration}ms`);
  console.log(`      Throughput: ${throughput.toFixed(1)} ops/sec`);
  console.log(`      Avg latency per op: ${(duration / operations).toFixed(2)}ms`);
}

// 运行示例
if (require.main === module) {
  advancedFeaturesExample().catch(console.error);
}

export { advancedFeaturesExample };