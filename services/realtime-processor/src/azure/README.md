# Azure语音服务集成

这个模块提供了完整的Azure Speech Services集成，包括语音转文字（STT）、文字转语音（TTS）、配置管理和性能优化功能。

## 功能特性

### 🎤 语音转文字 (STT)
- **流式识别**: 支持实时音频流处理
- **多语言支持**: 支持中文、英文等多种语言
- **高精度识别**: 词级时间戳和置信度评分
- **音频质量检测**: 自动评估音频质量并提供反馈
- **会话管理**: 支持多并发识别会话

### 🔊 文字转语音 (TTS)
- **神经语音**: 支持Azure Neural Voice高质量合成
- **语音风格**: 支持多种情感风格和表达方式
- **韵律控制**: 精确控制语速、音调、音量
- **智能缓存**: 预计算常用回复，减少合成延迟
- **流式输出**: 支持流式音频生成

### ⚙️ 配置管理
- **动态配置**: 支持运行时配置变更
- **用户画像**: 根据用户特征推荐最佳语音
- **性能优化**: 延迟优化和质量平衡设置
- **多格式支持**: WAV、MP3、OPUS等音频格式

### 📊 监控和优化
- **性能监控**: 实时延迟和质量指标
- **健康检查**: 服务状态自动监控
- **缓存优化**: LRU缓存和预计算策略
- **错误处理**: 完善的错误恢复机制

## 快速开始

### 1. 基础使用

```typescript
import { AzureSpeechService } from './azure';

// 创建服务实例
const speechService = new AzureSpeechService({
  key: 'your-azure-speech-key',
  region: 'your-azure-region',
  endpoint: 'your-azure-endpoint',
  language: 'zh-CN'
});

// 初始化服务
await speechService.initialize();

// 处理音频
const result = await speechService.processAudio({
  id: 'req-001',
  callId: 'call-001',
  audioChunk: {
    id: 'chunk-001',
    callId: 'call-001',
    timestamp: Date.now(),
    audioData: audioBuffer, // Buffer or base64 string
    sequenceNumber: 1,
    sampleRate: 16000,
    channels: 1,
    format: 'wav'
  },
  userProfile: {
    userId: 'user-001',
    preferredVoice: 'zh-CN-XiaoxiaoNeural',
    personality: 'friendly',
    language: 'zh-CN'
  },
  options: {
    enableSTT: true,
    enableTTS: true,
    latencyOptimized: true
  }
});

console.log('识别结果:', result.transcript?.text);
console.log('回复音频:', result.response?.audioData);
console.log('处理延迟:', result.processingTime.total + 'ms');
```

### 2. 流式处理

```typescript
import { AzureSpeechService } from './azure';

const speechService = new AzureSpeechService(azureConfig);
await speechService.initialize();

// 开始流式处理
const sessionId = await speechService.processAudioStream({
  id: 'stream-001',
  callId: 'call-001',
  audioChunk: firstChunk,
  userProfile: userProfile,
  options: { streamingMode: true }
});

// 监听实时结果
speechService.on('streamingResponse', (data) => {
  console.log('实时转录:', data.transcript.text);
  console.log('AI回复:', data.responseText);
});

// 持续发送音频数据
for (const chunk of audioChunks) {
  await speechService.processStreamChunk(sessionId, chunk);
}

// 停止流式处理
const results = await speechService.stopStreaming(sessionId);
```

### 3. 独立使用STT服务

```typescript
import { AzureSTTService } from './azure';

const sttService = new AzureSTTService(azureConfig);
await sttService.initialize();

// 开始识别会话
const sessionId = await sttService.startSession({
  sessionId: 'stt-session-001',
  language: 'zh-CN',
  enableWordTimestamps: true,
  continuousRecognition: true
});

// 监听识别结果
sttService.on('finalResult', (result) => {
  console.log('识别文本:', result.text);
  console.log('置信度:', result.confidence);
  console.log('词级时间戳:', result.words);
});

// 发送音频数据
await sttService.processAudioStream(sessionId, audioChunk);

// 停止会话
const results = await sttService.stopSession(sessionId);
```

### 4. 独立使用TTS服务

```typescript
import { AzureTTSService } from './azure';

const ttsService = new AzureTTSService(azureConfig);
await ttsService.initialize();

// 语音合成
const result = await ttsService.synthesize({
  id: 'tts-001',
  text: '您好，我现在不方便接听电话。',
  voice: 'zh-CN-XiaoxiaoNeural',
  style: 'friendly',
  rate: 1.0,
  pitch: 0,
  volume: 1.0,
  format: 'wav',
  priority: 'high'
});

console.log('音频数据:', result.audioData);
console.log('音频时长:', result.duration + 'ms');
console.log('是否来自缓存:', result.cached);

// 流式合成
const streamSessionId = await ttsService.synthesizeStream({
  id: 'stream-tts-001',
  text: '这是一段较长的文本，将被流式合成为语音。',
  voice: 'zh-CN-XiaoxiaoNeural',
  streaming: true
});

// 获取音频流
ttsService.on('audioChunk', (data) => {
  console.log('音频块:', data.chunk);
  // 实时播放或处理音频块
});
```

### 5. 配置管理

```typescript
import { SpeechConfigManager } from './azure';

const configManager = new SpeechConfigManager(azureConfig);

// 设置识别语言
configManager.setRecognitionLanguage('zh-CN');

// 设置合成语音
configManager.setSynthesisVoice('zh-CN-XiaoxiaoNeural');

// 设置语音风格
configManager.setVoiceStyle('friendly', 1.2);

// 设置韵律
configManager.setProsody(1.1, 5, 0.9); // 语速, 音调, 音量

// 启用延迟优化
configManager.setLatencyOptimization(true);

// 设置音频格式
configManager.setAudioFormat('opus', 16000);

// 根据用户画像推荐语音
const recommendedVoice = configManager.recommendVoice({
  gender: 'female',
  personality: 'friendly',
  locale: 'zh-CN'
});

// 获取配置摘要
const summary = configManager.getConfigSummary();
console.log('当前配置:', summary);
```

## 高级功能

### 性能监控

```typescript
// 获取服务健康状态
const health = speechService.getHealthStatus();
console.log('STT状态:', health.stt.status);
console.log('TTS状态:', health.tts.status);
console.log('缓存命中率:', health.tts.cacheHitRate);

// 获取性能指标
const metrics = speechService.getPerformanceMetrics();
console.log('平均延迟:', metrics[0].latency.totalPipeline + 'ms');

// 监听性能事件
speechService.on('metricsUpdated', (healthStatus) => {
  if (healthStatus.overall.status === 'degraded') {
    console.warn('服务性能下降');
  }
});
```

### 缓存管理

```typescript
// 获取TTS缓存统计
const cacheStats = ttsService.getCacheStats();
console.log('缓存项目数:', cacheStats.totalItems);
console.log('缓存大小:', cacheStats.totalSize);
console.log('命中率:', cacheStats.hitRate);

// 获取预计算回复
const precomputedAudio = ttsService.getPrecomputedResponse('polite_decline');
if (precomputedAudio) {
  console.log('使用预计算回复');
}
```

### 错误处理

```typescript
speechService.on('error', (error) => {
  console.error('语音服务错误:', error);
  
  switch (error.code) {
    case 'AZURE_SPEECH_INIT_ERROR':
      // 初始化错误处理
      break;
    case 'AZURE_STT_TIMEOUT_ERROR':
      // STT超时处理
      break;
    case 'AZURE_TTS_SYNTHESIS_ERROR':
      // TTS合成错误处理
      break;
    default:
      // 通用错误处理
      break;
  }
});

// 服务恢复监听
speechService.on('initialized', () => {
  console.log('服务已恢复');
});
```

## 配置选项

### Azure配置

```typescript
interface AzureSpeechConfig {
  key: string;              // Azure Speech API密钥
  region: string;           // Azure区域 (如: 'eastasia')
  endpoint: string;         // Azure端点URL
  language: string;         // 默认语言 (如: 'zh-CN')
  outputFormat?: string;    // 输出格式
}
```

### 用户画像配置

```typescript
interface UserProfile {
  userId: string;           // 用户ID
  preferredVoice?: string;  // 首选语音
  personality?: string;     // 个性类型: 'friendly', 'professional', 'casual'
  speechStyle?: string;     // 语音风格: 'general', 'assistant', 'chat'
  language?: string;        // 语言偏好
}
```

### 处理选项

```typescript
interface ProcessingOptions {
  enableSTT?: boolean;      // 启用STT (默认: true)
  enableTTS?: boolean;      // 启用TTS (默认: true)
  streamingMode?: boolean;  // 流式模式 (默认: false)
  latencyOptimized?: boolean; // 延迟优化 (默认: false)
  qualityMode?: 'fast' | 'balanced' | 'high'; // 质量模式
  cacheEnabled?: boolean;   // 缓存启用 (默认: true)
}
```

## 性能优化建议

### 1. 延迟优化
- 启用流式处理模式
- 使用OPUS音频格式
- 开启预计算回复缓存
- 设置合适的音频采样率 (16kHz)

### 2. 质量优化
- 使用高质量音频输入
- 选择合适的神经语音
- 调整韵律参数
- 启用词级时间戳

### 3. 成本优化
- 使用缓存减少API调用
- 合理设置音频格式
- 批量处理非实时请求
- 监控API配额使用

## 故障排除

### 常见问题

1. **初始化失败**
   - 检查Azure密钥和区域配置
   - 验证网络连接
   - 确认API配额充足

2. **识别精度低**
   - 检查音频质量
   - 调整采样率设置
   - 使用合适的语言模型

3. **合成延迟高**
   - 启用缓存机制
   - 使用流式合成
   - 优化音频格式

4. **内存占用高**
   - 调整缓存大小限制
   - 及时清理过期会话
   - 使用流式处理

### 日志调试

```typescript
import { logger } from '../utils/logger';

// 启用详细日志
logger.level = 'debug';

// 监听详细事件
speechService.on('audioProcessed', (data) => {
  logger.debug('音频处理完成:', data);
});

speechService.on('cacheHit', (data) => {
  logger.debug('缓存命中:', data);
});
```

## API参考

详细的API文档请参考TypeScript接口定义：

- `AzureSpeechService` - 主要语音服务接口
- `AzureSTTService` - 语音转文字服务
- `AzureTTSService` - 文字转语音服务  
- `SpeechConfigManager` - 配置管理器
- `AzureSpeechUtils` - 工具函数集

## 许可证

本模块遵循项目主许可证。使用Azure Speech Services需要有效的Azure订阅和API密钥。