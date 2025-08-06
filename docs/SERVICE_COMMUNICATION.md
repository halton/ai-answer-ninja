# 服务间通信与负载均衡架构

## 概览

AI电话应答系统采用分布式微服务架构，通过统一的服务发现机制和负载均衡策略确保高可用性和可扩展性。

## 核心组件

### 1. 服务发现架构

#### Docker Compose 环境
```yaml
# 服务间通过容器名称自动发现
services:
  smart-whitelist:
    container_name: ai-ninja-smart-whitelist
    networks:
      - ai-ninja-network
  
  user-management:
    environment:
      - WHITELIST_SERVICE_URL=http://smart-whitelist:3006
```

#### Kubernetes 环境
```yaml
# 通过Service资源实现服务发现
apiVersion: v1
kind: Service
metadata:
  name: smart-whitelist
spec:
  selector:
    app: smart-whitelist
  ports:
    - port: 3006
      targetPort: 3006
```

### 2. API网关和负载均衡

#### Nginx 反向代理配置
- **位置**: `/config/nginx/nginx.conf`
- **功能**: 
  - API路由和负载均衡
  - SSL终止
  - 限流和安全防护
  - WebSocket支持

#### 负载均衡策略
```nginx
upstream smart-whitelist {
    least_conn;  # 最少连接数
    server smart-whitelist:3006 max_fails=3 fail_timeout=30s;
    keepalive 16;
}

upstream user-management {
    ip_hash;  # 会话亲和性
    server user-management:3005 max_fails=3 fail_timeout=30s;
    keepalive 16;
}
```

### 3. 服务通信客户端

#### ServiceClient 类
- **位置**: `/shared/service-client/index.js`
- **功能**:
  - 统一的HTTP客户端
  - 断路器模式
  - 自动重试
  - 链路追踪

#### 基本用法
```javascript
const ServiceClient = require('../shared/service-client');

const client = new ServiceClient({
  timeout: 5000,
  retries: 3
});

// 检查服务健康状态
const health = await client.healthCheck('smart-whitelist');

// 调用API
const result = await client.evaluatePhone('+1234567890');
```

## 服务映射表

| 服务名称 | 端口 | 健康检查 | 负载均衡策略 |
|---------|------|----------|-------------|
| phone-gateway | 3001 | /health | least_conn |
| realtime-processor | 3002 | /health | least_conn |
| conversation-engine | 3003 | /health | least_conn |
| profile-analytics | 3004 | /health | least_conn |
| user-management | 3005 | /health | ip_hash |
| smart-whitelist | 3006 | /health | least_conn |
| configuration | 3007 | /health | round_robin |
| storage | 3008 | /health | least_conn |
| monitoring | 3009 | /health | least_conn |

## API网关路由规则

```nginx
# 认证服务
location /api/auth/ {
    limit_req zone=auth burst=10 nodelay;
    proxy_pass http://user-management/api/v1/auth/;
}

# 白名单服务  
location /api/whitelist/ {
    limit_req zone=api burst=100 nodelay;
    proxy_pass http://smart-whitelist/api/v1/whitelist/;
}

# 实时处理服务 (支持WebSocket)
location /api/realtime/ {
    limit_req zone=api burst=200 nodelay;
    proxy_pass http://realtime-processor/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## 断路器配置

### 默认参数
```javascript
circuitBreakerOptions: {
  timeout: 3000,           // 超时时间
  errorThresholdPercentage: 50,  // 错误阈值
  resetTimeout: 30000      // 重置时间
}
```

### 监控指标
- `failures`: 失败次数
- `successes`: 成功次数
- `rejects`: 拒绝次数
- `fires`: 调用次数
- `percentiles`: 延迟分位数

## 健康检查机制

### 三级健康检查
1. **基础健康检查** (`/health`): 服务存活状态
2. **就绪检查** (`/health/ready`): 服务是否可以处理请求
3. **存活检查** (`/health/live`): Kubernetes存活探针

### 检查频率
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3006/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## 自动扩缩容

### Kubernetes HPA配置
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: realtime-processor-hpa
spec:
  minReplicas: 4
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### 扩缩容策略
- **realtime-processor**: 4-20副本，CPU 70%
- **smart-whitelist**: 3-15副本，CPU 75%  
- **conversation-engine**: 2-10副本，CPU 70%

## 故障恢复机制

### 1. 断路器模式
- 快速失败，避免级联故障
- 自动恢复检测
- 回退策略

### 2. 重试机制
- 指数退避算法
- 最大重试次数限制
- 可配置的重试条件

### 3. 负载均衡故障处理
```nginx
server smart-whitelist:3006 max_fails=3 fail_timeout=30s;
# max_fails: 最大失败次数
# fail_timeout: 故障恢复时间
```

## 监控和可观测性

### 关键指标
- **延迟**: 请求响应时间
- **吞吐量**: QPS/TPS
- **错误率**: 4xx/5xx响应比例
- **可用性**: 服务正常时间比例

### 日志链路追踪
```javascript
headers: {
  'X-Request-ID': this.generateRequestId(),
  'User-Agent': 'AI-Ninja-ServiceClient/1.0'
}
```

## 部署和测试

### 集成测试
```bash
# 运行服务通信测试
npm run test:integration

# 或者使用脚本
./scripts/test-integration.js
```

### 测试覆盖范围
- ✅ 服务健康检查
- ✅ API契约测试  
- ✅ 断路器功能
- ✅ 超时处理
- ✅ 服务发现
- ✅ 核心用户流程

### 性能测试
- 并发请求处理
- 断路器响应时间
- 负载均衡分发效果

## 最佳实践

### 1. 服务间通信
- 使用统一的ServiceClient
- 实现熔断和重试
- 添加请求链路追踪

### 2. 负载均衡
- 根据服务特性选择策略
- 配置合适的健康检查
- 设置故障转移参数

### 3. 监控告警
- 监控关键业务指标
- 设置合理告警阈值
- 建立故障响应流程

### 4. 容量规划
- 基于历史数据预估
- 设置自动扩缩容规则
- 预留资源缓冲

## 故障排查指南

### 1. 服务不可达
- 检查服务健康状态
- 验证网络连通性
- 查看负载均衡配置

### 2. 响应延迟高
- 分析服务性能指标
- 检查数据库连接池
- 优化网络配置

### 3. 断路器频繁触发
- 调整阈值参数
- 分析错误根因
- 优化服务稳定性