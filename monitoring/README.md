# AI Answer Ninja - Complete Monitoring System

## 概述

这是一个为AI电话应答系统设计的企业级监控和可观测性平台，提供全面的系统健康监控、性能分析、智能告警和自动化响应能力。

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   微服务架构    │───▶│   监控服务      │───▶│   告警系统      │
│  AI Ninja 9服务 │    │  Prometheus    │    │  AlertManager   │
└─────────────────┘    │  Grafana       │    │  通知渠道       │
                       │  Jaeger        │    └─────────────────┘
                       │  Elasticsearch │
                       └─────────────────┘
                                │
                       ┌─────────────────┐
                       │   自动化响应    │
                       │  Auto-remediation│
                       │  自动扩缩容     │
                       └─────────────────┘
```

## 核心特性

### 🔍 全方位监控
- **系统级监控**: CPU、内存、磁盘、网络
- **服务级监控**: API响应时间、错误率、吞吐量
- **业务级监控**: 通话成功率、AI响应质量、用户满意度
- **依赖监控**: Azure服务健康状态、数据库性能

### 📊 智能分析
- **异常检测**: 基于机器学习的性能基线和异常识别
- **趋势分析**: 历史数据分析和未来性能预测
- **根因分析**: 分布式链路追踪和日志关联

### 🚨 多层告警
- **智能降噪**: 告警聚合、去重和相关性分析
- **分级升级**: 基于严重程度的自动升级机制
- **多渠道通知**: Email、Slack、短信、PagerDuty

### 🤖 自动化运维
- **故障自愈**: 服务重启、扩容、流量切换
- **预测性维护**: 基于趋势的主动干预
- **合规性保证**: SLA/SLO监控和报告

## 目录结构

```
monitoring/
├── alerting/                      # 告警配置
│   └── rules/
│       ├── core-services.yml      # 核心服务告警规则
│       ├── business-metrics.yml   # 业务指标告警
│       └── azure-services.yml     # Azure服务监控
├── grafana/                       # Grafana配置
│   └── dashboards/
│       ├── business-overview.json # 业务总览仪表板
│       └── technical-overview.json# 技术监控仪表板
├── monitoring-service/            # 核心监控服务
│   ├── src/
│   │   ├── services/              # 监控核心服务
│   │   │   ├── alertManager.ts    # 智能告警管理
│   │   │   ├── notificationService.ts # 多渠道通知
│   │   │   ├── autoRemediationService.ts # 自动化修复
│   │   │   ├── tracingService.ts  # 分布式追踪
│   │   │   ├── logAggregationService.ts # 日志聚合
│   │   │   └── anomalyDetectionService.ts # 异常检测
│   │   └── types/                 # 类型定义
├── prometheus.yml                 # Prometheus配置
└── docs/                         # 文档和运行手册
    ├── runbooks/                 # 故障处理手册
    ├── architecture.md           # 架构说明
    └── troubleshooting.md        # 故障排查指南
```

## 快速开始

### 1. 环境准备

确保具备以下环境：
- Docker & Docker Compose
- Kubernetes 集群 (生产环境)
- Node.js 18+
- PostgreSQL 13+
- Redis 6+

### 2. 配置环境变量

复制环境变量模板：
```bash
cp .env.example .env
```

配置必要的环境变量：
```env
# 监控服务配置
PORT=3009
NODE_ENV=production
LOG_LEVEL=info

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_ninja_monitoring
DB_USER=monitoring
DB_PASSWORD=your_password

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Prometheus配置
PROMETHEUS_URL=http://prometheus:9090
PUSHGATEWAY_URL=http://pushgateway:9091

# Grafana配置
GRAFANA_URL=http://grafana:3000
GRAFANA_API_KEY=your_grafana_api_key

# 通知渠道配置
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
EMAIL_SMTP_HOST=smtp.example.com
EMAIL_SMTP_USER=alerts@company.com
EMAIL_SMTP_PASS=email_password

# Azure服务监控
AZURE_SUBSCRIPTION_ID=your_subscription_id
AZURE_SPEECH_ENDPOINT=https://your-region.api.cognitive.microsoft.com
AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com

# 功能开关
FEATURE_ANOMALY_DETECTION=true
FEATURE_AUTO_REMEDIATION=true
FEATURE_DISTRIBUTED_TRACING=true
FEATURE_LOG_AGGREGATION=true
```

### 3. 部署监控系统

#### 开发环境部署
```bash
# 安装依赖
cd monitoring/monitoring-service
npm install

# 启动开发服务
npm run dev
```

#### Docker部署
```bash
# 构建镜像
docker build -t ai-ninja-monitoring monitoring/monitoring-service/

# 启动服务
docker-compose up -d
```

#### Kubernetes部署
```bash
# 应用配置
kubectl apply -f k8s/production/namespace.yaml
kubectl apply -f k8s/production/configmaps.yaml
kubectl apply -f k8s/production/secrets.yaml

# 部署监控组件
kubectl apply -f k8s/production/monitoring.yaml
kubectl apply -f k8s/production/core-services.yaml

# 验证部署
kubectl get pods -n ai-ninja
kubectl get services -n ai-ninja
```

### 4. 验证安装

检查服务健康状态：
```bash
# 监控服务健康检查
curl http://localhost:3009/health

# Prometheus指标检查
curl http://localhost:3009/metrics

# 深度健康检查
curl http://localhost:3009/health/deep
```

访问监控界面：
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)
- **Jaeger**: http://localhost:16686
- **监控API**: http://localhost:3009

## 监控指标

### 系统级指标
```yaml
基础设施:
  - cpu_usage_percent: CPU使用率
  - memory_usage_percent: 内存使用率
  - disk_usage_percent: 磁盘使用率
  - network_io_bytes: 网络I/O
  - up: 服务可用性

数据库:
  - pg_stat_database_numbackends: 活跃连接数
  - pg_stat_database_tup_fetched: 查询行数
  - pg_locks_count: 锁等待数量

缓存:
  - redis_connected_clients: Redis连接数
  - redis_memory_used_bytes: Redis内存使用
  - redis_commands_processed_total: 命令处理数
```

### 业务级指标
```yaml
通话质量:
  - ai_ninja_calls_total: 总通话数
  - ai_ninja_calls_successful: 成功通话数
  - ai_ninja_call_duration_seconds: 通话时长
  - ai_ninja_caller_satisfaction_score: 来电者满意度

AI性能:
  - ai_response_latency_seconds: AI响应延迟
  - ai_ninja_stt_accuracy_rate: 语音识别准确率
  - ai_ninja_tts_quality_score: 语音合成质量
  - ai_ninja_conversation_turns: 对话轮数

用户体验:
  - ai_ninja_user_retention_7day: 7天用户留存
  - ai_ninja_subscription_churn_rate: 订阅流失率
  - ai_ninja_support_tickets_total: 支持工单数

垃圾识别:
  - ai_ninja_spam_detection_accuracy: 垃圾识别准确率
  - ai_ninja_false_positive_rate: 误判率
  - ai_ninja_spam_blocked_total: 拦截垃圾电话数
```

## 告警策略

### 告警等级定义

| 等级 | 定义 | 响应时间 | 通知渠道 | 升级策略 |
|------|------|----------|----------|----------|
| **Critical** | 服务不可用、数据丢失、安全漏洞 | 即时 | Slack + 短信 + PagerDuty | 15分钟升级到经理 |
| **Warning** | 性能下降、错误率上升 | 5分钟内 | Slack + Email | 1小时升级 |
| **Info** | 状态变化、维护通知 | 15分钟内 | Slack | 不升级 |

### 核心告警规则

#### 服务可用性告警
```yaml
- alert: ServiceDown
  expr: up{job=~"phone-gateway|realtime-processor|conversation-engine"} == 0
  for: 30s
  labels:
    severity: critical
  annotations:
    summary: "关键服务 {{ $labels.job }} 不可用"
    impact: "高 - 核心功能受影响"
    action: "立即调查服务状态并重启"
```

#### 业务指标告警
```yaml
- alert: CallSuccessRateDropped
  expr: rate(ai_ninja_calls_successful[10m]) / rate(ai_ninja_calls_total[10m]) < 0.95
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "通话成功率低于95%"
    current_rate: "{{ $value | humanizePercentage }}"
    business_impact: "高 - 客户体验下降"
```

#### 性能告警
```yaml
- alert: AIResponseLatencyHigh
  expr: histogram_quantile(0.95, rate(ai_response_latency_seconds_bucket[5m])) > 1.5
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "AI响应延迟过高"
    current_p95: "{{ $value }}s"
    threshold: "1.5s"
```

### 告警降噪策略

1. **相关性过滤**: 当父级告警触发时，自动抑制子级告警
2. **频率限制**: 相同告警5分钟内最多发送一次
3. **维护窗口**: 维护期间自动静默非关键告警
4. **依赖抑制**: Azure服务不可用时抑制相关应用告警

## 自动化响应

### 自动修复场景

#### 服务重启
```yaml
触发条件: ServiceDown告警
自动动作:
  1. kubectl rollout restart deployment/${service}
  2. 等待30秒验证恢复
  3. 发送通知确认修复结果
冷却时间: 10分钟
```

#### 自动扩容
```yaml
触发条件: CPU > 80% 持续5分钟
自动动作:
  1. 检查当前副本数
  2. 增加2个副本 (不超过最大限制)
  3. 监控负载变化
冷却时间: 15分钟
```

#### 数据库连接清理
```yaml
触发条件: 数据库连接数 > 90%
自动动作:
  1. 终止空闲超过10分钟的连接
  2. 记录操作日志
  3. 监控连接池状态
冷却时间: 5分钟
```

### 预防性维护

- **磁盘空间清理**: 自动清理过期日志和临时文件
- **缓存预热**: 在流量高峰前预热Redis缓存
- **连接池优化**: 动态调整数据库连接池大小
- **证书更新**: SSL证书到期前自动续期

## 性能基线和异常检测

### 异常检测算法

1. **统计异常检测**: 基于Z-Score的异常识别
2. **季节性分析**: 考虑时间模式的异常检测
3. **业务规则**: 特定业务场景的异常判定
4. **机器学习**: 基于历史数据的模式识别

### 性能基线管理

```javascript
// 创建性能基线
const baseline = {
  metric: 'ai_response_latency_seconds',
  service: 'realtime-processor',
  baseline: 0.8,  // 基线值 (秒)
  threshold: {
    warning: 1.2,  // 警告阈值
    critical: 1.8  // 严重阈值
  },
  confidence: 0.95  // 置信度
};
```

### 异常处理流程

1. **检测**: 实时监控指标偏离基线
2. **分析**: 确定异常严重程度和影响范围  
3. **通知**: 发送分级告警给相关团队
4. **响应**: 触发自动修复或人工干预
5. **学习**: 更新基线和检测模型

## 日志聚合和分析

### 日志格式标准化

```json
{
  "@timestamp": "2025-08-10T10:30:00.123Z",
  "level": "error",
  "service": "realtime-processor",
  "message": "AI generation timeout",
  "metadata": {
    "userId": "user123",
    "callId": "call456",
    "duration": 5000,
    "error": "Request timeout"
  },
  "traceId": "trace789",
  "spanId": "span012"
}
```

### 智能日志分析

#### 错误模式识别
- **认证失败**: 检测暴力破解攻击
- **数据库错误**: 识别连接和查询问题  
- **AI服务错误**: 监控Azure服务异常
- **内存泄漏**: 检测内存使用异常

#### 安全事件检测
- **注入攻击**: SQL注入、XSS尝试
- **权限提升**: 未授权访问尝试
- **异常IP**: 恶意IP地址访问
- **数据泄露**: 敏感数据访问异常

### 日志查询API

```bash
# 查询错误日志
GET /api/logs/query
{
  "services": ["realtime-processor"],
  "levels": ["error"],
  "startTime": "2025-08-10T00:00:00Z",
  "endTime": "2025-08-10T23:59:59Z",
  "searchText": "timeout",
  "limit": 100
}

# 日志聚合分析
GET /api/logs/aggregate
{
  "query": { /* 查询条件 */ },
  "aggregations": [
    {"field": "service", "size": 10},
    {"field": "@timestamp", "interval": "1h"}
  ]
}
```

## 分布式链路追踪

### 追踪范围

- **HTTP请求**: API调用的完整链路
- **数据库操作**: SQL查询执行时间
- **缓存操作**: Redis读写性能
- **AI服务调用**: Azure服务调用链路
- **微服务通信**: 服务间调用关系

### 关键指标追踪

```javascript
// 电话处理全链路追踪
const callFlow = {
  'call.incoming': '来电接收',
  'call.whitelist_check': '白名单检查',
  'call.ai_processing': 'AI处理',
  'ai.stt': '语音识别',
  'ai.intent_recognition': '意图识别',
  'ai.response_generation': 'AI响应生成',
  'ai.tts': '语音合成',
  'call.response_sent': '响应发送',
  'call.end': '通话结束'
};
```

### 性能分析

- **热点分析**: 识别最慢的服务和操作
- **依赖分析**: 服务调用关系和瓶颈
- **错误分析**: 追踪错误传播路径
- **容量分析**: 服务处理能力评估

## 故障处理手册

### 常见故障场景

#### 1. 服务不响应
**症状**: up指标为0，健康检查失败
**排查步骤**:
1. 检查Pod状态: `kubectl get pods -n ai-ninja`
2. 查看Pod日志: `kubectl logs <pod-name> -n ai-ninja`
3. 检查资源使用: `kubectl top pods -n ai-ninja`
4. 验证配置: `kubectl get configmap -n ai-ninja`

**修复方案**:
```bash
# 重启服务
kubectl rollout restart deployment/<service-name> -n ai-ninja

# 扩容服务
kubectl scale deployment/<service-name> --replicas=3 -n ai-ninja

# 检查恢复状态
kubectl get pods -n ai-ninja -w
```

#### 2. 数据库连接问题
**症状**: 数据库连接超时，查询失败
**排查步骤**:
1. 检查连接池: 查看`pg_stat_database`指标
2. 检查慢查询: 查看`pg_stat_activity`
3. 检查锁等待: 查看`pg_locks`
4. 检查磁盘空间: 查看存储使用率

**修复方案**:
```sql
-- 终止长时间运行的查询
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE state = 'active' AND query_start < now() - interval '10 minutes';

-- 清理空闲连接
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE state = 'idle' AND state_change < now() - interval '30 minutes';
```

#### 3. Azure服务异常
**症状**: AI响应超时，语音服务错误
**排查步骤**:
1. 检查Azure服务状态页面
2. 查看配额使用情况
3. 检查API密钥有效性
4. 验证网络连接

**修复方案**:
- 切换到备用区域
- 增加请求超时时间
- 实施断路器模式
- 联系Azure技术支持

### 紧急响应流程

#### P0 (Critical) - 服务完全不可用
1. **5分钟内**: 确认问题范围和影响
2. **15分钟内**: 实施临时修复或降级方案
3. **1小时内**: 完成根因分析
4. **24小时内**: 实施永久修复方案

#### P1 (High) - 功能严重受损
1. **30分钟内**: 确认问题和评估影响
2. **2小时内**: 实施修复方案
3. **24小时内**: 完成根因分析和预防措施

### 灾难恢复计划

#### 数据备份策略
- **数据库**: 每日全量备份 + 增量备份
- **配置**: 版本控制管理
- **监控数据**: 7天本地 + 30天云存储
- **日志**: 实时同步到备份系统

#### 恢复测试
- **月度**: 备份恢复测试
- **季度**: 灾难恢复演练
- **年度**: 完整系统恢复测试

## 监控最佳实践

### 1. 监控设计原则

#### USE方法论
- **Utilization**: 资源利用率监控
- **Saturation**: 饱和度监控  
- **Errors**: 错误率监控

#### RED方法论
- **Rate**: 请求速率
- **Errors**: 错误率
- **Duration**: 响应时间

#### 四个黄金信号
1. **延迟**: 服务处理请求的时间
2. **流量**: 系统处理的请求量
3. **错误**: 失败请求的比例
4. **饱和度**: 系统资源的使用程度

### 2. 告警设置指南

#### 告警质量标准
- **可操作性**: 每个告警都应有明确的处理方案
- **上下文相关**: 告警信息包含足够的调试信息
- **抑制噪音**: 避免告警风暴和无用告警
- **分级处理**: 根据严重程度设置不同响应级别

#### 告警阈值设置
```yaml
指标类型        警告阈值    严重阈值    说明
CPU使用率       > 70%      > 85%      持续5分钟
内存使用率       > 80%      > 90%      持续5分钟
磁盘使用率       > 80%      > 90%      持续1分钟
响应时间        > 1.5s     > 3.0s     P95超过阈值
错误率          > 1%       > 5%       持续3分钟
通话成功率      < 98%      < 95%      持续5分钟
```

### 3. 仪表板设计

#### 层次化监控
1. **高级总览**: 业务健康度一览
2. **服务监控**: 各微服务详细状态
3. **基础设施**: 底层资源监控
4. **依赖监控**: 外部服务状态

#### 可视化最佳实践
- **颜色编码**: 使用一致的颜色表示状态
- **时间窗口**: 提供多时间粒度视图
- **交互式**: 支持下钻分析
- **自适应**: 根据异常自动调整视图

### 4. 性能优化

#### 监控系统优化
- **采样策略**: 高频指标使用采样
- **数据压缩**: 历史数据压缩存储
- **查询优化**: 优化Prometheus查询
- **缓存策略**: 缓存常用查询结果

#### 资源管理
- **存储规划**: 基于数据量规划存储
- **网络带宽**: 考虑指标传输带宽
- **计算资源**: 监控系统自身的资源使用

## 安全考虑

### 访问控制
- **身份认证**: RBAC权限管理
- **网络隔离**: 监控系统网络分段
- **数据加密**: 传输和存储加密
- **审计日志**: 记录所有访问和操作

### 敏感数据保护
- **数据脱敏**: 日志中的敏感信息脱敏
- **访问权限**: 基于最小权限原则
- **数据保留**: 遵循数据保留策略
- **合规要求**: 满足GDPR等法规要求

## 维护和更新

### 定期维护任务

#### 每日任务
- [ ] 检查监控系统健康状态
- [ ] 审查关键告警和异常
- [ ] 验证备份完整性
- [ ] 清理过期临时文件

#### 每周任务
- [ ] 更新告警规则和阈值
- [ ] 分析监控性能趋势
- [ ] 检查存储空间使用
- [ ] 测试告警通知渠道

#### 每月任务
- [ ] 更新监控组件版本
- [ ] 优化慢查询和性能瓶颈
- [ ] 审查和更新文档
- [ ] 进行灾难恢复测试

### 版本升级策略

#### 滚动升级
```bash
# 监控服务零停机升级
kubectl set image deployment/monitoring-service \
  monitoring-service=ai-ninja-monitoring:v2.0.0 \
  -n ai-ninja

# 验证升级状态
kubectl rollout status deployment/monitoring-service -n ai-ninja

# 必要时回滚
kubectl rollout undo deployment/monitoring-service -n ai-ninja
```

## 故障排查工具

### 诊断命令集合

```bash
#!/bin/bash
# 一键健康检查脚本

echo "=== AI Ninja 监控系统健康检查 ==="

# 检查服务状态
echo "1. 检查服务状态..."
kubectl get pods -n ai-ninja

# 检查资源使用
echo "2. 检查资源使用..."
kubectl top pods -n ai-ninja

# 检查最近的告警
echo "3. 检查最近告警..."
curl -s http://localhost:9093/api/v1/alerts | jq '.data[].labels.alertname'

# 检查Prometheus目标状态
echo "4. 检查监控目标..."
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[].health' | sort | uniq -c

# 检查关键指标
echo "5. 检查关键指标..."
curl -s 'http://localhost:9090/api/v1/query?query=up' | jq '.data.result[] | select(.value[1] == "0") | .metric'

echo "健康检查完成！"
```

### 性能分析工具

```javascript
// 性能分析查询集合
const performanceQueries = {
  // 响应时间分析
  latencyAnalysis: `
    histogram_quantile(0.95, 
      sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
    )
  `,
  
  // 错误率分析
  errorRateAnalysis: `
    sum(rate(http_requests_total{status=~"5.."}[5m])) by (service) /
    sum(rate(http_requests_total[5m])) by (service)
  `,
  
  // 资源使用分析
  resourceUsage: `
    max by (instance) (
      100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
    )
  `,
  
  // 业务指标分析
  businessMetrics: `
    rate(ai_ninja_calls_total[5m]) and
    rate(ai_ninja_calls_successful[5m]) / rate(ai_ninja_calls_total[5m])
  `
};
```

## 团队协作

### 角色和职责

| 角色 | 职责 | 权限 |
|------|------|------|
| **SRE工程师** | 监控系统维护、告警处理、性能优化 | 完整系统访问权限 |
| **开发工程师** | 应用监控集成、指标定义、问题修复 | 应用监控访问权限 |
| **运维工程师** | 基础设施监控、部署管理、故障响应 | 基础设施监控权限 |
| **产品经理** | 业务指标定义、SLA制定、趋势分析 | 业务仪表板访问权限 |

### 值班轮换制度

#### 一线值班 (7×24小时)
- **响应时间**: P0 < 5分钟, P1 < 15分钟
- **职责**: 告警响应、初步诊断、升级决策
- **工具**: PagerDuty、Slack、监控仪表板

#### 二线支持 (工作时间)
- **响应时间**: P0 < 15分钟, P1 < 1小时
- **职责**: 深度分析、修复实施、根因分析
- **工具**: 完整监控系统、开发环境

### 沟通协议

#### 告警通知模板
```
🚨 [{{ .severity }}] {{ .alertname }}

服务: {{ .service }}
描述: {{ .description }}
影响: {{ .impact }}
持续时间: {{ .duration }}

处理建议: {{ .action }}
运行手册: {{ .runbook_url }}
仪表板: {{ .dashboard_url }}

值班工程师: @{{ .oncall_engineer }}
```

#### 事故报告模板
```markdown
# 事故报告 - {{ .incident_id }}

## 基本信息
- 事故ID: {{ .incident_id }}
- 发生时间: {{ .start_time }}
- 恢复时间: {{ .end_time }}
- 持续时长: {{ .duration }}
- 严重等级: {{ .severity }}
- 影响范围: {{ .impact }}

## 事故描述
{{ .description }}

## 根本原因
{{ .root_cause }}

## 解决方案
{{ .resolution }}

## 预防措施
{{ .prevention_measures }}

## 经验教训
{{ .lessons_learned }}
```

## 成本优化

### 监控成本管理

#### 数据保留策略
```yaml
高频指标 (15秒):
  保留时间: 7天
  用途: 实时告警和短期分析

中频指标 (1分钟):
  保留时间: 30天
  用途: 趋势分析和容量规划

低频指标 (5分钟):
  保留时间: 1年
  用途: 历史分析和合规报告
```

#### 成本优化建议
1. **存储层级化**: 热数据SSD、温数据HDD、冷数据对象存储
2. **数据压缩**: 启用时间序列数据压缩
3. **查询优化**: 避免高基数标签和低效查询
4. **资源调度**: 非高峰期降低监控频率

### ROI评估
- **故障预防**: 减少平均故障恢复时间50%
- **自动化运维**: 减少人工干预80%
- **性能优化**: 提升系统吞吐量30%
- **合规保证**: 确保99.5% SLA达成率

---

## 联系信息

**监控团队**:
- 技术负责人: SRE Team Lead
- 紧急联系: on-call@company.com
- Slack频道: #ai-ninja-monitoring
- 文档仓库: https://github.com/company/ai-ninja-monitoring

**更新记录**:
- v2.0.0: 完整监控系统实现 (2025-08-10)
- v1.1.0: 异常检测和自动化响应 (2025-08-05)
- v1.0.0: 基础监控和告警系统 (2025-08-01)

---

*本文档将随系统演进持续更新，请定期检查最新版本。*