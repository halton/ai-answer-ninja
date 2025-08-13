# AI Answer Ninja - Multi-Level Cache System

高性能多级缓存系统，专为AI Answer Ninja项目设计，提供L1(内存) + L2(Redis) + L3(数据库)架构，支持智能缓存策略、预测式缓存和分布式一致性保证。

## 特性

### 🚀 多级缓存架构
- **L1缓存**: 内存缓存，亚毫秒级响应
- **L2缓存**: Redis集群，毫秒级响应
- **L3缓存**: 数据库回退，自动回填机制

### 🧠 智能缓存策略
- 频率驱动缓存策略
- LRU自适应策略
- 时间模式感知策略
- 业务上下文优化策略
- 预测式缓存策略

### 📊 预测式缓存系统
- 用户行为模式学习
- ML驱动的预加载
- 智能预热机制
- 访问序列分析

### 📈 性能监控与分析
- 实时性能指标收集
- Prometheus集成
- 智能告警系统
- 热点数据分析
- 性能趋势预测

### 🔄 分布式一致性
- 向量时钟同步
- 冲突自动解决
- 最终一致性保证
- 强一致性可选

## 快速开始

### 安装

```bash
npm install @ai-ninja/shared-cache
```

### 基本使用

```typescript
import { createDefaultCacheSystem } from '@ai-ninja/shared-cache';

// 创建缓存系统
const cacheFactory = createDefaultCacheSystem({
  l2: {
    host: 'localhost',
    port: 6379,
    password: 'your-redis-password'
  }
});

// 初始化
const { cache } = await cacheFactory.initialize();

// 使用缓存
await cache.set(
  { namespace: 'users', key: 'user:123' }, 
  { id: '123', name: 'John Doe' }
);

const user = await cache.get({ namespace: 'users', key: 'user:123' });
console.log(user); // { id: '123', name: 'John Doe' }
```

### 高级配置

```typescript
import { CacheSystemFactory } from '@ai-ninja/shared-cache';

const cacheFactory = new CacheSystemFactory({
  // L1内存缓存配置
  l1: {
    maxSize: 2000,        // 最大键数量
    ttl: 1800000,         // 30分钟TTL
    checkPeriod: 120      // 清理间隔(秒)
  },
  
  // L2 Redis配置
  l2: {
    host: 'localhost',
    port: 6379,
    password: 'password',
    ttl: 3600,            // 1小时TTL
    // Redis集群配置
    cluster: {
      nodes: [
        { host: 'redis-1', port: 6379 },
        { host: 'redis-2', port: 6379 },
        { host: 'redis-3', port: 6379 }
      ]
    }
  },
  
  // 数据压缩
  compression: {
    enabled: true,
    threshold: 1024,      // 1KB阈值
    algorithm: 'gzip'
  },
  
  // 性能监控
  monitoring: {
    enabled: true,
    metricsInterval: 30000,
    alertThresholds: {
      hitRatio: 0.8,      // 命中率阈值
      errorRate: 0.02,    // 错误率阈值
      latency: 500        // 延迟阈值(ms)
    }
  },
  
  // 预测式缓存
  predictiveCaching: {
    enabled: true,
    warmupConfig: {
      enabled: true,
      strategies: [{
        name: 'user-behavior',
        priority: 1,
        schedule: '*/10 * * * *', // 每10分钟
        batchSize: 50,
        concurrency: 5
      }]
    }
  },
  
  // 分布式一致性
  consistency: {
    enabled: true,
    nodeId: 'node-1',
    policy: {
      type: 'eventual',
      conflictResolution: 'last-write-wins'
    }
  }
});
```

## 业务场景优化

### 用户资料缓存

```typescript
// 用户登录时预热相关数据
await cache.set(
  { namespace: 'user-profiles', key: userId },
  userProfile,
  { ttl: 1800 } // 30分钟
);

// 白名单检查优化
const whitelist = await cache.get(
  { namespace: 'whitelist', key: `user:${userId}` },
  async () => {
    // 缓存未命中时的数据库查询
    return await whitelistService.getByUserId(userId);
  }
);
```

### 垃圾号码识别缓存

```typescript
// 垃圾号码特征缓存(2小时TTL)
await cache.set(
  { namespace: 'spam-profiles', key: phoneHash },
  {
    category: 'telemarketing',
    riskScore: 0.85,
    features: { /* ML特征 */ }
  },
  { ttl: 7200 }
);
```

### 对话上下文缓存

```typescript
// 实时对话上下文(10分钟TTL)
await cache.set(
  { namespace: 'conversations', key: callId },
  {
    history: conversationHistory,
    context: aiContext,
    lastIntent: 'sales_call'
  },
  { ttl: 600 }
);
```

## API 参考

### MultiLevelCache

核心缓存类，提供统一的多级缓存接口。

#### Methods

```typescript
// 基本操作
async get<T>(key: CacheKey, fallback?: () => Promise<T>): Promise<T | null>
async set<T>(key: CacheKey, value: T, options?: SetOptions): Promise<boolean>
async delete(key: CacheKey): Promise<boolean>

// 批量操作
async mget<T>(keys: CacheKey[]): Promise<Map<string, T | null>>
async mset<T>(entries: Array<{key: CacheKey, value: T, ttl?: number}>): Promise<boolean>

// 模式操作
async clear(pattern?: string): Promise<number>

// 健康检查
async getHealthStatus(): Promise<CacheHealthStatus>
async getMetrics(): Promise<CacheMetrics>
```

### CacheKey 接口

```typescript
interface CacheKey {
  namespace: string;  // 命名空间
  key: string;        // 键名
  version?: string;   // 可选版本号
}
```

### 监控指标

```typescript
interface CacheMetrics {
  l1: LevelMetrics;     // L1缓存指标
  l2: LevelMetrics;     // L2缓存指标
  l3: LevelMetrics;     // L3缓存指标
  overall: {
    hitRatio: number;   // 总命中率
    avgLatency: number; // 平均延迟
    errorRate: number;  // 错误率
    totalRequests: number; // 总请求数
  };
}
```

## 性能优化建议

### 1. 缓存键设计
```typescript
// ✅ 好的键设计
{ namespace: 'user-profiles', key: 'user:123' }
{ namespace: 'spam-detection', key: 'phone:hash:abc123' }

// ❌ 避免的设计
{ namespace: 'data', key: 'some-very-long-key-with-lots-of-data' }
```

### 2. TTL策略
```typescript
// 根据数据特点设置合适的TTL
const ttlStrategies = {
  'user-profiles': 1800,     // 30分钟 - 用户资料
  'spam-profiles': 7200,     // 2小时 - 垃圾号码特征
  'whitelist': 600,          // 10分钟 - 白名单
  'conversations': 1800,     // 30分钟 - 对话上下文
  'system-configs': 3600     // 1小时 - 系统配置
};
```

### 3. 批量操作
```typescript
// ✅ 使用批量操作提高性能
const results = await cache.mget([
  { namespace: 'users', key: 'user:1' },
  { namespace: 'users', key: 'user:2' },
  { namespace: 'users', key: 'user:3' }
]);

// ❌ 避免循环单个操作
for (const userId of userIds) {
  await cache.get({ namespace: 'users', key: `user:${userId}` });
}
```

## 监控和告警

### Prometheus指标

系统自动暴露以下Prometheus指标：

- `cache_hits_total`: 缓存命中数
- `cache_misses_total`: 缓存未命中数
- `cache_operation_duration_seconds`: 操作延迟分布
- `cache_size_bytes`: 缓存大小
- `cache_errors_total`: 错误计数

### 告警配置

```yaml
# prometheus-alerts.yml
groups:
- name: cache-alerts
  rules:
  - alert: CacheHitRateLow
    expr: (rate(cache_hits_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))) < 0.7
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "缓存命中率过低"
      
  - alert: CacheHighLatency
    expr: histogram_quantile(0.95, cache_operation_duration_seconds_bucket) > 0.1
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "缓存延迟过高"
```

## 故障排除

### 常见问题

1. **Redis连接失败**
   ```bash
   # 检查Redis连接
   redis-cli -h localhost -p 6379 ping
   ```

2. **内存使用过高**
   ```typescript
   // 调整L1缓存大小
   const config = {
     l1: { maxSize: 500 } // 减少到500
   };
   ```

3. **命中率低**
   ```typescript
   // 检查TTL设置和缓存策略
   const metrics = await cache.getMetrics();
   console.log('Hit ratio:', metrics.overall.hitRatio);
   ```

### 性能调优

1. **L1/L2平衡调优**
   ```typescript
   // 根据访问模式调整L1大小
   if (l1HitRatio < 0.3 && l2HitRatio > 0.8) {
     // 增加L1缓存大小
     config.l1.maxSize *= 2;
   }
   ```

2. **批量预热**
   ```typescript
   // 在高峰期前预热热点数据
   await predictiveSystem.warmup([
     { key: { namespace: 'hot-data', key: 'popular' }, probability: 0.9 }
   ]);
   ```

## 开发和测试

### 运行测试

```bash
npm test                    # 运行所有测试
npm run test:watch         # 监视模式
npm run test:coverage      # 覆盖率报告
```

### 开发模式

```bash
npm run dev                # 开发模式
npm run build             # 构建
npm run lint              # 代码检查
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。

## 贡献

欢迎提交 Pull Requests 和 Issues！

---

更多详细信息请参考：
- [架构设计文档](docs/architecture.md)
- [性能测试报告](docs/performance.md)
- [API完整文档](docs/api.md)