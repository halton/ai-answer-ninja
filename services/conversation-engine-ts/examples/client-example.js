/**
 * Conversation Engine Client Example
 * 演示如何调用对话引擎 API
 */

const axios = require('axios');

class ConversationEngineClient {
  constructor(baseUrl = 'http://localhost:3003') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 处理对话
   */
  async processConversation(callId, userInput, metadata = {}) {
    try {
      const response = await this.client.post('/api/v1/conversation/process', {
        callId,
        userInput,
        metadata
      });
      
      return response.data;
    } catch (error) {
      console.error('处理对话失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 获取对话统计
   */
  async getConversationStats(callId) {
    try {
      const response = await this.client.get(`/api/v1/conversation/${callId}/stats`);
      return response.data;
    } catch (error) {
      console.error('获取对话统计失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 结束对话
   */
  async endConversation(callId) {
    try {
      const response = await this.client.post(`/api/v1/conversation/${callId}/end`);
      return response.data;
    } catch (error) {
      console.error('结束对话失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      console.error('健康检查失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 批量处理对话
   */
  async batchProcess(conversations) {
    try {
      const response = await this.client.post('/api/v1/conversation/batch', {
        conversations
      });
      return response.data;
    } catch (error) {
      console.error('批量处理失败:', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * 示例使用场景
 */
async function demonstrateUsage() {
  const client = new ConversationEngineClient();

  console.log('🚀 对话引擎客户端示例\n');

  try {
    // 1. 健康检查
    console.log('1. 执行健康检查...');
    const health = await client.healthCheck();
    console.log('✅ 服务状态:', health.status);
    console.log('');

    // 2. 模拟骚扰电话对话
    const callId = `call_${Date.now()}`;
    const metadata = {
      userId: 'user_123',
      callerPhone: '+86138****1234',
      sessionId: `session_${Date.now()}`
    };

    console.log(`2. 开始处理对话 (CallID: ${callId})`);
    
    // 第一轮 - 销售推广
    let response = await client.processConversation(
      callId,
      '您好，我是XX理财公司的，想向您介绍我们的高收益理财产品',
      metadata
    );
    
    console.log('👤 来电者:', '您好，我是XX理财公司的，想向您介绍我们的高收益理财产品');
    console.log('🤖 AI回复:', response.data.response.text);
    console.log('📊 置信度:', response.data.response.confidence);
    console.log('📈 下一阶段:', response.data.response.nextStage);
    console.log('');

    // 第二轮 - 持续推销
    response = await client.processConversation(
      callId,
      '我们这个产品年化收益率15%，非常安全可靠，您了解一下吧',
      metadata
    );
    
    console.log('👤 来电者:', '我们这个产品年化收益率15%，非常安全可靠，您了解一下吧');
    console.log('🤖 AI回复:', response.data.response.text);
    console.log('📊 置信度:', response.data.response.confidence);
    console.log('📈 下一阶段:', response.data.response.nextStage);
    console.log('');

    // 第三轮 - 继续坚持
    response = await client.processConversation(
      callId,
      '就几分钟时间，我详细给您介绍一下，保证您会感兴趣的',
      metadata
    );
    
    console.log('👤 来电者:', '就几分钟时间，我详细给您介绍一下，保证您会感兴趣的');
    console.log('🤖 AI回复:', response.data.response.text);
    console.log('📊 置信度:', response.data.response.confidence);
    console.log('📈 下一阶段:', response.data.response.nextStage);
    console.log('🔚 应该终止:', response.data.response.shouldTerminate);
    console.log('');

    // 3. 获取对话统计
    console.log('3. 获取对话统计信息...');
    const stats = await client.getConversationStats(callId);
    console.log('📈 对话轮次:', stats.data.turnCount);
    console.log('⏱️  对话时长:', Math.round(stats.data.duration / 1000), '秒');
    console.log('🎯 当前阶段:', stats.data.currentStage);
    console.log('🧠 最后意图:', stats.data.lastIntent?.category);
    console.log('');

    // 4. 结束对话
    console.log('4. 结束对话...');
    const endResult = await client.endConversation(callId);
    console.log('✅ 对话已结束:', endResult.data.status);
    console.log('');

    // 5. 批量处理示例
    console.log('5. 批量处理示例...');
    const batchConversations = [
      {
        callId: `batch_call_1_${Date.now()}`,
        userInput: '我是银行客服，您的信用卡需要升级',
        metadata: { userId: 'user_456' }
      },
      {
        callId: `batch_call_2_${Date.now()}`,
        userInput: '恭喜您中奖了，请提供银行卡信息领取奖金',
        metadata: { userId: 'user_789' }
      }
    ];

    const batchResult = await client.batchProcess(batchConversations);
    console.log('📦 批量处理结果:');
    console.log('  - 处理总数:', batchResult.data.processed);
    console.log('  - 成功数量:', batchResult.data.successful);
    console.log('  - 失败数量:', batchResult.data.failed);
    
    batchResult.data.results.forEach((result, index) => {
      if (result.success) {
        console.log(`  - 批次${index + 1}: ✅ ${result.response.text.substring(0, 30)}...`);
      } else {
        console.log(`  - 批次${index + 1}: ❌ ${result.error}`);
      }
    });

  } catch (error) {
    console.error('❌ 示例执行失败:', error.message);
  }
}

/**
 * 不同个性类型的对话示例
 */
async function demonstratePersonalities() {
  const client = new ConversationEngineClient();

  console.log('\n🎭 个性化响应示例\n');

  const personalities = [
    { type: 'polite', name: '礼貌型', userId: 'user_polite' },
    { type: 'direct', name: '直接型', userId: 'user_direct' },
    { type: 'humorous', name: '幽默型', userId: 'user_humorous' },
    { type: 'professional', name: '专业型', userId: 'user_professional' }
  ];

  const testInput = '我们有很好的贷款产品，利息很低，您要不要了解一下？';

  for (const personality of personalities) {
    try {
      const callId = `personality_test_${personality.type}_${Date.now()}`;
      const metadata = {
        userId: personality.userId,
        callerPhone: '+86139****5678',
        personality: personality.type
      };

      const response = await client.processConversation(callId, testInput, metadata);
      
      console.log(`🎭 ${personality.name}用户回复:`);
      console.log(`   ${response.data.response.text}`);
      console.log(`   (置信度: ${response.data.response.confidence})`);
      console.log('');

    } catch (error) {
      console.error(`❌ ${personality.name}示例失败:`, error.message);
    }
  }
}

/**
 * 性能测试示例
 */
async function performanceTest() {
  const client = new ConversationEngineClient();
  
  console.log('\n⚡ 性能测试\n');

  const testCases = [
    '您好，我是保险公司的',
    '有一个投资机会想跟您分享',
    '我们做个市场调查',
    '恭喜您获得大奖',
    '您的贷款申请已通过'
  ];

  const startTime = Date.now();
  const promises = testCases.map((input, index) => 
    client.processConversation(
      `perf_test_${index}_${Date.now()}`,
      input,
      { userId: 'perf_user' }
    )
  );

  try {
    const results = await Promise.all(promises);
    const endTime = Date.now();
    const totalTime = endTime - startTime;

    console.log('📊 性能测试结果:');
    console.log(`   - 并发请求数: ${testCases.length}`);
    console.log(`   - 总耗时: ${totalTime}ms`);
    console.log(`   - 平均耗时: ${Math.round(totalTime / testCases.length)}ms`);
    console.log(`   - 成功率: ${results.length}/${testCases.length} (100%)`);
    console.log('');

    results.forEach((result, index) => {
      const latency = result.data.response.metadata.generationLatency;
      const cacheHit = result.data.response.metadata.cacheHit;
      console.log(`   ${index + 1}. ${latency}ms ${cacheHit ? '(缓存命中)' : '(实时生成)'}`);
    });

  } catch (error) {
    console.error('❌ 性能测试失败:', error.message);
  }
}

// 主函数
async function main() {
  console.log('🎯 AI Answer Ninja - Conversation Engine 客户端示例\n');
  
  try {
    await demonstrateUsage();
    await demonstratePersonalities();
    await performanceTest();
    
    console.log('🎉 所有示例执行完成！');
  } catch (error) {
    console.error('❌ 主程序执行失败:', error.message);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

module.exports = ConversationEngineClient;