const { AIPerformanceManager } = require('./dist/index.js');

// 演示AI性能优化功能
async function demo() {
  console.log('🚀 AI性能优化基础设施演示');
  console.log('=====================================');
  
  // 初始化管理器
  const manager = new AIPerformanceManager();
  console.log('✅ AIPerformanceManager 初始化完成');
  
  // 模拟预测上下文
  const context = {
    userId: 'demo-user-123',
    callerPhone: '13800138000',
    recentIntents: [{
      category: 'sales_call',
      confidence: 0.9,
      urgency: 'low'
    }],
    conversationHistory: [{
      speaker: 'user',
      text: '你好，我想推荐一个产品给你',
      timestamp: Date.now(),
      intent: { category: 'sales_call', confidence: 0.85 }
    }],
    userProfile: {
      personality: 'polite',
      spamCategories: ['sales_call']
    }
  };
  
  console.log('\n📞 模拟来电场景:');
  console.log(`来电号码: ${context.callerPhone}`);
  console.log(`对话内容: "${context.conversationHistory[0].text}"`);
  console.log(`用户个性: ${context.userProfile.personality}`);
  
  try {
    console.log('\n🤖 生成优化响应...');
    const result = await manager.generateOptimizedResponse(context);
    
    console.log('\n✨ AI响应结果:');
    console.log(`📝 响应内容: "${result.response}"`);
    console.log(`⏱️  处理延迟: ${result.latency}ms`);
    console.log(`🎯 置信度: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`📊 优化策略: [${result.optimizations.join(', ')}]`);
    console.log(`💾 来自缓存: ${result.fromCache ? '是' : '否'}`);
    
    console.log('\n📈 系统性能报告:');
    const report = manager.getPerformanceReport();
    console.log(`平均延迟: ${report.overall.averageLatency}ms`);
    console.log(`缓存命中率: ${(report.overall.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`预测准确率: ${(report.overall.predictionAccuracy * 100).toFixed(1)}%`);
    
    console.log('\n🏥 系统健康检查:');
    const health = await manager.healthCheck();
    console.log(`总体状态: ${health.status === 'healthy' ? '✅ 健康' : '⚠️  异常'}`);
    console.log(`缓存服务: ${health.components.cache === 'healthy' ? '✅ 正常' : '❌ 异常'}`);
    console.log(`预测服务: ${health.components.predictor === 'healthy' ? '✅ 正常' : '❌ 异常'}`);
    console.log(`优化服务: ${health.components.optimizer === 'healthy' ? '✅ 正常' : '❌ 异常'}`);
    
    console.log('\n🔥 批量缓存预热测试:');
    const userIds = ['user1', 'user2', 'user3'];
    const warmupResult = await manager.warmupCaches(userIds);
    console.log(`预热用户: ${userIds.length}个`);
    console.log(`成功: ${warmupResult.successful}个`);
    console.log(`失败: ${warmupResult.failed}个`);
    console.log(`总耗时: ${warmupResult.totalTime}ms`);
    
    console.log('\n🧠 智能预计算启动:');
    await manager.startSmartPrecompute(['demo-user-123']);
    console.log('✅ 预计算任务已启动');
    
  } catch (error) {
    console.error('❌ 演示过程中出现错误:', error.message);
  }
  
  // 清理资源
  manager.destroy();
  console.log('\n🧹 资源清理完成');
  console.log('\n🎉 AI性能优化基础设施演示完成！');
  
  console.log('\n📚 功能特性总结:');
  console.log('• 🎯 智能意图识别和响应预测');
  console.log('• 💾 多级智能缓存系统');
  console.log('• ⚡ 延迟优化和性能监控');
  console.log('• 🔮 响应预计算和预热策略');
  console.log('• 📊 实时性能监控和健康检查');
  console.log('• 🚀 支持MVP(1.5s) -> 优化(1s) -> 生产(0.8s)的分阶段目标');
}

// 运行演示
demo().catch(console.error);