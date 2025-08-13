# AI电话应答系统 - 完整可观测性方案

## 概述

本文档描述了为AI电话应答系统实现的完整可观测性方案，包含Prometheus指标收集、Grafana仪表板、AlertManager告警、Jaeger分布式追踪和长期存储策略。

## 架构组件

### 核心监控服务 (monitoring-service:3009)
- **PrometheusExporter**: 增强的Prometheus指标导出
- **CustomMetricsService**: 自定义指标收集和聚合
- **IntelligentAlertingService**: 智能告警系统
- **JaegerIntegration**: 分布式链路追踪
- **LongTermStorageStrategy**: 监控数据长期存储

### 外部依赖组件
- **Prometheus**: 指标存储和查询引擎
- **Grafana**: 可视化仪表板
- **AlertManager**: 告警管理和通知
- **Jaeger**: 分布式追踪收集器

## 功能特性

### 1. 增强的Prometheus集成

#### 核心业务指标
```typescript
// 通话相关指标
ai_phone_calls_total{service, call_type, status}
ai_phone_call_duration_seconds{service, call_type}
ai_response_time_seconds{service, model_type, intent}

// 白名单和垃圾检测
whitelist_checks_total{service, result, list_type}
spam_detection_total{service, spam_category, confidence_level}

// 用户交互指标
user_interactions_total{service, interaction_type, result}
```

#### 系统性能指标
```typescript
// HTTP请求指标
http_requests_total{service, method, endpoint, status_code}
http_request_duration_seconds{service, method, endpoint}

// 数据库性能
database_connections_active{service, database_type}
database_query_duration_seconds{service, operation, table}

// 缓存性能
cache_hit_rate{service, cache_type, cache_layer}
```

#### 资源利用率指标
```typescript
// CPU和内存
process_cpu_usage_percent{service, instance}
process_memory_usage_bytes{service, instance, type}

// 网络和存储
network_bytes_total{service, direction, protocol}
disk_usage_bytes{service, mount_point, type}
```

### 2. Grafana仪表板模板

#### 系统总览仪表板
- **用途**: 为高管和运营团队提供系统整体状况
- **关键指标**: 今日通话总数、通话成功率、平均AI响应时间、系统健康状态
- **刷新频率**: 30秒

#### AI性能分析仪表板
- **用途**: AI系统性能指标和质量分析
- **关键指标**: AI响应时间分布、意图识别准确率、模型置信度、对话轮次分布
- **刷新频率**: 15秒

#### 基础设施监控仪表板
- **用途**: 系统资源使用和基础设施健康监控
- **关键指标**: CPU/内存使用率、数据库连接数、缓存命中率、队列长度
- **刷新频率**: 30秒

#### 业务指标仪表板
- **用途**: 关键业务指标和KPI监控
- **关键指标**: 每日收入、用户满意度、转接成功率、每通话成本
- **刷新频率**: 5分钟

#### 安全监控仪表板
- **用途**: 系统安全事件和威胁监控
- **关键指标**: 认证失败次数、可疑IP数量、骚扰电话置信度分布
- **刷新频率**: 1分钟

### 3. 智能告警系统

#### 多层次告警规则
```typescript
interface SmartAlertRule {
  conditions: AlertCondition[];           // 触发条件
  correlations?: CorrelationRule[];       // 告警关联
  suppressions?: SuppressionRule[];       // 抑制规则
  escalation?: EscalationRule;           // 升级策略
  machineLearning?: MLBasedRule;         // 机器学习
  businessImpact?: BusinessImpactRule;   // 业务影响
}
```

#### 智能决策引擎
- **趋势分析**: 自动分析指标趋势，预测问题发展
- **关联分析**: 识别相关告警，避免重复通知
- **业务上下文**: 结合业务高峰期、维护窗口等上下文
- **ML增强**: 使用机器学习提高告警准确性

#### 通知渠道
- **钉钉群通知**: 紧急告警实时推送
- **邮件通知**: 详细告警报告
- **Slack集成**: 团队协作通知
- **Webhook**: 集成内部系统

### 4. 分布式链路追踪

#### 业务操作追踪
```typescript
// 电话处理全链路
tracePhoneCall(callId, callerPhone, operation)

// AI处理链路
traceAIProcessing(callId, intent, operation)

// 白名单检查链路
traceWhitelistCheck(userId, callerPhone, operation)

// 语音处理链路
traceVoiceProcessing(audioId, processingType, operation)
```

#### 链路分析功能
- **性能瓶颈识别**: 自动识别慢查询和性能问题
- **错误链路分析**: 追踪错误在服务间的传播
- **依赖关系图**: 可视化服务依赖和调用关系
- **业务流程洞察**: 分析业务流程执行效率

### 5. 长期存储策略

#### 分层存储架构
```typescript
// 存储层级
Hot Storage (7天):    实时查询，高性能SSD，$0.5/GB
Warm Storage (30天):  快速访问，标准SSD，$0.15/GB  
Cold Storage (1年):   非频繁访问，S3 IA，$0.023/GB
Archive Storage (7年): 长期归档，Azure Archive，$0.004/GB
```

#### 数据生命周期管理
- **自动转换**: 基于数据年龄自动在存储层间转换
- **智能压缩**: 根据存储层级应用不同压缩算法
- **成本优化**: 平衡存储成本和查询性能
- **合规保留**: 满足数据保留的法规要求

## API接口

### 监控指标 API
```bash
# 获取Prometheus指标
GET /monitoring/metrics/prometheus

# 自定义指标操作
GET /monitoring/metrics/custom
POST /monitoring/metrics/custom

# 指标聚合查询
GET /monitoring/metrics?service=ai-conversation&metric=response_time&from=2024-01-01&to=2024-01-02
```

### 仪表板 API
```bash
# 获取所有仪表板配置
GET /monitoring/dashboards

# 获取特定仪表板
GET /monitoring/dashboards/{id}

# 获取Grafana模板
GET /monitoring/dashboards/grafana/templates
```

### 智能告警 API
```bash
# 智能告警规则管理
GET /monitoring/alerts/smart
POST /monitoring/alerts/smart
PUT /monitoring/alerts/smart/{ruleId}

# 告警洞察分析
GET /monitoring/alerts/smart/{ruleId}/insights
```

### 链路追踪 API
```bash
# 追踪查询
GET /monitoring/tracing/traces?service=phone-gateway&startTime=2024-01-01T00:00:00Z

# 获取特定链路
GET /monitoring/tracing/traces/{traceId}

# 链路分析
GET /monitoring/tracing/traces/{traceId}/analyze
```

### 存储管理 API
```bash
# 存储统计
GET /monitoring/storage/statistics

# 存储策略
GET /monitoring/storage/policies
POST /monitoring/storage/policies/{policyId}/trigger

# 存储层级
GET /monitoring/storage/tiers
```

## 部署配置

### 环境变量
```bash
# Prometheus配置
PROMETHEUS_URL=http://prometheus:9090

# AlertManager配置  
ALERTMANAGER_URL=http://alertmanager:9093

# Jaeger配置
JAEGER_ENDPOINT=http://jaeger-collector:14268/api/traces
JAEGER_QUERY_ENDPOINT=http://jaeger-query:16686

# Grafana配置
GRAFANA_URL=http://grafana:3000
GRAFANA_API_KEY=your_grafana_api_key

# 通知配置
DINGTALK_CRITICAL_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=xxx
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
OPS_TEAM_EMAILS=ops@company.com,admin@company.com
```

### Docker Compose 示例
```yaml
version: '3.8'
services:
  monitoring-service:
    build: ./services/monitoring
    ports:
      - "3009:3009"
    environment:
      - PROMETHEUS_URL=http://prometheus:9090
      - ALERTMANAGER_URL=http://alertmanager:9093
      - JAEGER_ENDPOINT=http://jaeger-collector:14268/api/traces
    depends_on:
      - prometheus
      - alertmanager
      - jaeger-all-in-one

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./configs/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin123
    volumes:
      - grafana_data:/var/lib/grafana

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./configs/alertmanager.yml:/etc/alertmanager/alertmanager.yml

  jaeger-all-in-one:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "14268:14268"
    environment:
      - COLLECTOR_ZIPKIN_HOST_PORT=:9411

volumes:
  prometheus_data:
  grafana_data:
```

## 使用指南

### 1. 监控系统启动
```bash
# 启动完整监控栈
docker-compose up -d

# 验证服务状态
curl http://localhost:3009/monitoring/health/comprehensive
```

### 2. Grafana仪表板导入
```bash
# 获取预定义仪表板
curl http://localhost:3009/monitoring/dashboards/grafana/templates

# 导入到Grafana
curl -X POST http://admin:admin123@localhost:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @dashboard-template.json
```

### 3. 告警规则配置
```bash
# 创建智能告警规则
curl -X POST http://localhost:3009/monitoring/alerts/smart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "id": "ai-response-slow",
    "name": "AI响应时间过慢",
    "conditions": [
      {
        "metric": "ai_response_time_seconds",
        "operator": "gt", 
        "value": 2,
        "duration": "3m"
      }
    ],
    "machineLearning": {
      "enabled": true,
      "model": "anomaly_detection"
    }
  }'
```

### 4. 链路追踪查询
```bash
# 查询最近的追踪
curl "http://localhost:3009/monitoring/tracing/traces?service=phone-gateway&limit=10"

# 分析特定链路
curl http://localhost:3009/monitoring/tracing/traces/{traceId}/analyze
```

## 最佳实践

### 1. 指标设计原则
- **业务相关**: 优先监控对业务有直接影响的指标
- **可操作性**: 确保每个指标都有对应的处理动作
- **适度粒度**: 平衡指标精度和存储成本
- **标准化命名**: 使用一致的命名规范

### 2. 告警策略
- **分层告警**: 根据严重程度设置不同的通知渠道
- **避免疲劳**: 使用智能抑制避免告警风暴
- **上下文相关**: 结合业务上下文调整告警敏感度
- **持续优化**: 基于历史数据持续优化告警规则

### 3. 存储优化
- **热点数据**: 保持最近7天数据在高速存储
- **归档策略**: 定期归档历史数据以控制成本
- **压缩配置**: 根据查询频率选择合适的压缩级别
- **成本监控**: 定期审查存储成本和使用模式

### 4. 性能调优
- **批量处理**: 使用批量操作提高写入性能
- **索引优化**: 为常用查询字段创建适当索引
- **缓存策略**: 实现多级缓存减少数据库负载
- **资源分配**: 根据负载模式调整资源配置

## 故障排查

### 常见问题
1. **Prometheus指标丢失**: 检查服务发现和网络连接
2. **Grafana图表空白**: 验证数据源配置和查询语法
3. **告警不触发**: 检查告警规则和阈值设置
4. **链路追踪缺失**: 确认Jaeger Agent配置和网络可达性

### 日志位置
- **监控服务日志**: `/var/log/monitoring-service/`
- **Prometheus日志**: Docker容器日志
- **告警处理日志**: 监控服务中的alert相关日志

### 健康检查
```bash
# 全面健康检查
curl http://localhost:3009/monitoring/health/comprehensive

# 各组件单独检查
curl http://localhost:3009/monitoring/alertmanager/health
curl http://localhost:3009/monitoring/tracing/health
```

## 扩展指南

### 添加自定义指标
```typescript
// 注册新指标
customMetricsService.registerMetric({
  id: 'business-conversion-rate',
  name: 'business_conversion_rate',
  type: 'gauge',
  description: '业务转化率',
  labels: ['service', 'channel']
});

// 记录指标值
customMetricsService.recordMetric({
  metricId: 'business-conversion-rate',
  value: 0.85,
  labels: { service: 'phone-gateway', channel: 'inbound' }
});
```

### 创建自定义仪表板
```typescript
// 定义仪表板配置
const customDashboard = {
  id: 'custom-business-dashboard',
  name: '自定义业务仪表板',
  widgets: [
    {
      id: 'conversion-rate-widget',
      type: 'metric',
      title: '转化率',
      dataSource: {
        type: 'prometheus',
        query: 'business_conversion_rate'
      },
      visualization: {
        chartType: 'gauge'
      }
    }
  ]
};

dashboardConfigs.addDashboardConfig(customDashboard);
```

## 总结

这套完整的可观测性方案为AI电话应答系统提供了：

1. **全面监控**: 覆盖业务、技术和基础设施各个层面
2. **智能告警**: 基于机器学习的智能告警减少噪音
3. **深度洞察**: 分布式追踪提供端到端的性能分析
4. **成本优化**: 分层存储策略平衡性能和成本
5. **易于扩展**: 模块化设计支持功能扩展

通过这套方案，团队能够：
- 快速发现和解决系统问题
- 深入了解用户体验质量
- 优化系统性能和资源利用
- 确保服务可靠性和业务连续性