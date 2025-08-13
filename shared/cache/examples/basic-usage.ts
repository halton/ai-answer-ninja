/**
 * 基本使用示例
 */

import { createDefaultCacheSystem } from '../src';

async function basicUsageExample() {
  console.log('=== AI Answer Ninja Cache System - Basic Usage Example ===\n');

  // 1. 创建缓存系统
  console.log('1. Creating cache system...');
  const cacheFactory = createDefaultCacheSystem({
    l2: {
      host: 'localhost',
      port: 6379
    },
    monitoring: {
      enabled: true,
      metricsInterval: 30000,
      alertThresholds: {
        hitRatio: 0.7,
        errorRate: 0.05,
        latency: 1000
      }
    }
  });

  try {
    // 2. 初始化系统
    console.log('2. Initializing cache system...');
    const { cache, monitor } = await cacheFactory.initialize();
    console.log('✅ Cache system initialized successfully\n');

    // 3. 基本缓存操作
    console.log('3. Basic cache operations:');
    
    // 设置用户资料
    const userKey = { namespace: 'user-profiles', key: 'user:123' };
    const userProfile = {
      id: '123',
      name: 'John Doe',
      phone: '+1234567890',
      personality: 'polite',
      preferences: {
        language: 'en',
        timezone: 'UTC'
      }
    };
    
    await cache.set(userKey, userProfile);
    console.log('✅ User profile cached');

    // 获取用户资料
    const retrievedProfile = await cache.get(userKey);
    console.log('✅ User profile retrieved:', retrievedProfile?.name);

    // 4. 垃圾号码检测缓存
    console.log('\n4. Spam detection cache:');
    
    const spamKey = { namespace: 'spam-profiles', key: 'phone:hash:abc123' };
    const spamProfile = {
      phoneHash: 'abc123',
      category: 'telemarketing',
      riskScore: 0.85,
      confidence: 0.92,
      features: {
        callFrequency: 'high',
        timePattern: 'business_hours',
        responseRate: 'low'
      }
    };
    
    await cache.set(spamKey, spamProfile, { ttl: 7200 }); // 2小时TTL
    console.log('✅ Spam profile cached');

    // 5. 白名单缓存
    console.log('\n5. Whitelist cache:');
    
    const whitelistKey = { namespace: 'whitelist', key: 'user:123' };
    const whitelist = {
      userId: '123',
      contacts: [
        { phone: '+1234567891', name: 'Alice', type: 'manual', confidence: 1.0 },
        { phone: '+1234567892', name: 'Bob', type: 'auto', confidence: 0.8 }
      ]
    };
    
    await cache.set(whitelistKey, whitelist, { ttl: 600 }); // 10分钟TTL
    console.log('✅ Whitelist cached');

    // 6. 批量操作
    console.log('\n6. Batch operations:');
    
    const batchKeys = [
      { namespace: 'user-profiles', key: 'user:123' },
      { namespace: 'spam-profiles', key: 'phone:hash:abc123' },
      { namespace: 'whitelist', key: 'user:123' }
    ];
    
    const batchResults = await cache.mget(batchKeys);
    console.log('✅ Batch get completed, results count:', batchResults.size);

    // 7. 缓存指标
    console.log('\n7. Cache metrics:');
    
    if (monitor) {
      const metrics = await monitor.getMetrics();
      console.log('📊 Cache metrics:');
      console.log(`   Hit ratio: ${(metrics.overall.hitRatio * 100).toFixed(1)}%`);
      console.log(`   Total requests: ${metrics.overall.totalRequests}`);
      console.log(`   Average latency: ${metrics.overall.avgLatency.toFixed(2)}ms`);
      console.log(`   Error rate: ${(metrics.overall.errorRate * 100).toFixed(2)}%`);
    }

    // 8. 健康检查
    console.log('\n8. Health check:');
    
    const health = await cache.getHealthStatus();
    console.log('🏥 System health:');
    console.log(`   Overall: ${health.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    console.log(`   L1 Cache: ${health.levels.l1.status}`);
    console.log(`   L2 Cache: ${health.levels.l2.status}`);

    // 9. 模拟实际业务场景
    console.log('\n9. Business scenario simulation:');
    
    // 模拟来电处理流程
    await simulateIncomingCall(cache);
    
    console.log('\n=== Example completed successfully! ===');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    // 清理资源
    console.log('\n10. Cleaning up...');
    await cacheFactory.shutdown();
    console.log('✅ Cache system shutdown complete');
  }
}

async function simulateIncomingCall(cache: any) {
  const callerPhone = '+1234567890';
  const userId = 'user:123';
  const callId = `call:${Date.now()}`;

  console.log(`📞 Simulating incoming call from ${callerPhone}`);

  // 1. 检查白名单
  const whitelistKey = { namespace: 'whitelist', key: userId };
  const whitelist = await cache.get(whitelistKey, async () => {
    console.log('   📋 Loading whitelist from database...');
    return {
      userId,
      contacts: [
        { phone: callerPhone, name: 'Known Contact', type: 'manual', confidence: 1.0 }
      ]
    };
  });

  const isWhitelisted = whitelist?.contacts.some((c: any) => c.phone === callerPhone);
  console.log(`   ✅ Whitelist check: ${isWhitelisted ? 'WHITELISTED' : 'NOT_WHITELISTED'}`);

  if (!isWhitelisted) {
    // 2. 检查垃圾号码
    const phoneHash = Buffer.from(callerPhone).toString('base64');
    const spamKey = { namespace: 'spam-profiles', key: `phone:hash:${phoneHash}` };
    
    const spamProfile = await cache.get(spamKey, async () => {
      console.log('   🔍 Analyzing spam profile...');
      return {
        phoneHash,
        category: 'telemarketing',
        riskScore: 0.75,
        confidence: 0.88
      };
    });

    console.log(`   ⚠️  Spam risk: ${spamProfile?.riskScore}`);

    // 3. 缓存对话上下文
    const conversationKey = { namespace: 'conversations', key: callId };
    const conversationContext = {
      callId,
      userId,
      callerPhone,
      startTime: Date.now(),
      isSpam: true,
      spamCategory: spamProfile?.category,
      aiStrategy: 'polite_decline'
    };

    await cache.set(conversationKey, conversationContext, { ttl: 1800 }); // 30分钟
    console.log('   💬 Conversation context cached');

    console.log('   🤖 AI will handle this spam call');
  } else {
    console.log('   📞 Call will be transferred to user');
  }
}

// 运行示例
if (require.main === module) {
  basicUsageExample().catch(console.error);
}

export { basicUsageExample };