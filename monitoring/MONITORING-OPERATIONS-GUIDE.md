# AI Answer Ninja - 监控系统运维指南

## 概述

本指南提供AI Answer Ninja监控系统的完整运维指导，包括日常维护、故障排查、性能优化和最佳实践。

## 目录

1. [系统架构概览](#系统架构概览)
2. [日常运维任务](#日常运维任务)
3. [监控指标解读](#监控指标解读)
4. [告警处理流程](#告警处理流程)
5. [故障排查指南](#故障排查指南)
6. [性能优化建议](#性能优化建议)
7. [备份与恢复](#备份与恢复)
8. [升级与维护](#升级与维护)
9. [最佳实践](#最佳实践)

## 系统架构概览

### 监控组件架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Answer Ninja 监控系统                     │
├─────────────────────────────────────────────────────────────────┤
│  数据收集层                                                      │
│  ├─ Prometheus (指标收集)                                        │
│  ├─ Node Exporter (系统指标)                                    │
│  ├─ Application Metrics (业务指标)                              │
│  └─ Custom Collectors (自定义收集器)                            │
├─────────────────────────────────────────────────────────────────┤
│  数据存储层                                                      │
│  ├─ Prometheus TSDB (时序数据)                                  │
│  ├─ Elasticsearch (日志数据)                                    │
│  └─ Redis (缓存和临时数据)                                      │
├─────────────────────────────────────────────────────────────────┤
│  数据处理层                                                      │
│  ├─ Monitoring Service (智能分析)                               │
│  ├─ Alert Manager (告警管理)                                    │
│  ├─ Anomaly Detection (异常检测)                                │
│  └─ Auto Remediation (自动修复)                                 │
├─────────────────────────────────────────────────────────────────┤
│  可视化层                                                       │
│  ├─ Grafana (监控面板)                                         │
│  ├─ Jaeger (链路追踪)                                          │
│  ├─ Kibana (日志查询)                                          │
│  └─ Custom Dashboards (自定义面板)                             │
└─────────────────────────────────────────────────────────────────┘
```

### 核心监控指标

#### 业务指标 (Golden Signals)
- **成功率**: `ai_ninja_calls_successful / ai_ninja_calls_total * 100`
- **响应时间**: `histogram_quantile(0.95, ai_response_latency_seconds_bucket)`
- **错误率**: `rate(http_requests_total{status=~"5.."}[5m])`
- **吞吐量**: `rate(ai_ninja_calls_total[5m])`

#### 系统指标 (USE Method)
- **利用率**: CPU, Memory, Disk, Network使用率
- **饱和度**: 队列长度, 连接数, 资源等待
- **错误**: 系统级错误, 组件失败

## 日常运维任务

### 每日检查清单

#### 🌅 晨间检查 (9:00 AM)

```bash
#!/bin/bash
# 日常健康检查脚本

echo "=== AI Answer Ninja 系统健康检查 ==="
echo "检查时间: $(date)"

# 1. 检查核心服务状态
echo "1. 检查核心服务状态..."
kubectl get pods -n ai-ninja -o wide
kubectl get pods -n ai-ninja-monitoring -o wide

# 2. 检查关键指标
echo "2. 检查关键业务指标..."
curl -s 'http://prometheus:9090/api/v1/query?query=rate(ai_ninja_calls_successful[5m])/rate(ai_ninja_calls_total[5m])*100' | jq '.data.result[0].value[1]' | xargs printf "通话成功率: %.2f%%\n"

curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,rate(ai_response_latency_seconds_bucket[5m]))' | jq '.data.result[0].value[1]' | xargs printf "P95响应时间: %.3fs\n"

# 3. 检查活跃告警
echo "3. 检查活跃告警..."
curl -s 'http://alertmanager:9093/api/v1/alerts' | jq '.data[] | select(.status.state=="active") | {alertname: .labels.alertname, severity: .labels.severity, startsAt: .startsAt}'

# 4. 检查资源使用
echo "4. 检查资源使用..."
kubectl top nodes
kubectl top pods -n ai-ninja --sort-by=cpu
kubectl top pods -n ai-ninja --sort-by=memory

# 5. 检查存储空间
echo "5. 检查存储空间..."
df -h | grep -E "(prometheus|grafana|elasticsearch)"

echo "=== 健康检查完成 ==="
```

#### 📊 指标监控

每日需要关注的关键指标：

| 指标 | 正常范围 | 警告阈值 | 严重阈值 | 处理建议 |
|------|----------|----------|----------|----------|
| 通话成功率 | >95% | <95% | <90% | 检查AI服务和网络连接 |
| P95响应时间 | <1.5s | >1.5s | >3.0s | 分析性能瓶颈 |
| CPU使用率 | <70% | >80% | >90% | 考虑扩容或优化 |
| 内存使用率 | <80% | >85% | >95% | 检查内存泄漏 |
| 磁盘使用率 | <80% | >85% | >90% | 清理日志和数据 |
| 错误率 | <1% | >2% | >5% | 紧急故障排查 |

### 每周维护任务

#### 🔧 周维护清单

```bash
#!/bin/bash
# 周维护任务脚本

echo "=== AI Answer Ninja 周维护任务 ==="

# 1. 更新告警规则和阈值
echo "1. 检查并更新告警规则..."
kubectl apply -f monitoring/alerting/rules/

# 2. 清理过期数据
echo "2. 清理过期监控数据..."
# Elasticsearch索引清理 (保留30天)
curl -X DELETE "http://elasticsearch:9200/ai-ninja-logs-$(date -d '30 days ago' +%Y.%m.%d)"
curl -X DELETE "http://elasticsearch:9200/ai-ninja-errors-$(date -d '30 days ago' +%Y.%m.%d)"

# 3. 备份重要配置
echo "3. 备份Grafana仪表板..."
mkdir -p backups/$(date +%Y%m%d)
./scripts/backup-grafana-dashboards.sh backups/$(date +%Y%m%d)/

# 4. 性能基线更新
echo "4. 更新性能基线..."
curl -X POST "http://monitoring-service:3009/api/baselines/update"

# 5. 检查证书有效期
echo "5. 检查SSL证书..."
openssl x509 -in ssl/monitoring.crt -noout -dates

# 6. 存储使用分析
echo "6. 存储使用分析..."
du -sh data/* | sort -hr

echo "=== 周维护任务完成 ==="
```

### 每月检查任务

#### 📈 月度报告

```bash
#!/bin/bash
# 月度监控报告生成

echo "=== 生成月度监控报告 ==="

REPORT_DATE=$(date +%Y-%m)
REPORT_FILE="reports/monthly-report-${REPORT_DATE}.md"

mkdir -p reports

cat > "$REPORT_FILE" << EOF
# AI Answer Ninja 监控月报 - ${REPORT_DATE}

## 服务概览

### SLA达成情况
- 系统可用性: $(curl -s 'http://prometheus:9090/api/v1/query?query=avg_over_time(up{job="phone-gateway"}[30d])*100' | jq -r '.data.result[0].value[1]' | cut -c1-5)%
- 通话成功率: $(curl -s 'http://prometheus:9090/api/v1/query?query=avg_over_time(rate(ai_ninja_calls_successful[5m])/rate(ai_ninja_calls_total[5m])[30d:])*100' | jq -r '.data.result[0].value[1]' | cut -c1-5)%
- 平均响应时间: $(curl -s 'http://prometheus:9090/api/v1/query?query=avg_over_time(histogram_quantile(0.95,rate(ai_response_latency_seconds_bucket[5m]))[30d:])' | jq -r '.data.result[0].value[1]' | cut -c1-5)s

### 业务指标
- 总通话次数: $(curl -s 'http://prometheus:9090/api/v1/query?query=increase(ai_ninja_calls_total[30d])' | jq -r '.data.result[0].value[1]')
- 拦截垃圾电话: $(curl -s 'http://prometheus:9090/api/v1/query?query=increase(ai_ninja_spam_blocked_total[30d])' | jq -r '.data.result[0].value[1]')
- 新增用户: $(curl -s 'http://prometheus:9090/api/v1/query?query=increase(ai_ninja_new_users_total[30d])' | jq -r '.data.result[0].value[1]')

### 告警统计
- 总告警数: $(curl -s 'http://prometheus:9090/api/v1/query?query=increase(prometheus_notifications_total[30d])' | jq -r '.data.result[0].value[1]')
- Critical告警: $(curl -s 'http://alertmanager:9093/api/v1/alerts' | jq '[.data[] | select(.labels.severity=="critical")] | length')
- 平均修复时间: [需要从数据库查询]

### 性能趋势
[生成性能趋势图表]

### 改进建议
[基于数据生成优化建议]

EOF

echo "月度报告已生成: $REPORT_FILE"
```

## 监控指标解读

### 业务指标深度解析

#### 通话成功率指标

```promql
# 实时成功率
rate(ai_ninja_calls_successful[5m]) / rate(ai_ninja_calls_total[5m]) * 100

# 按服务分组的成功率
sum(rate(ai_ninja_calls_successful[5m])) by (service) / 
sum(rate(ai_ninja_calls_total[5m])) by (service) * 100

# 成功率趋势分析
avg_over_time((rate(ai_ninja_calls_successful[5m]) / rate(ai_ninja_calls_total[5m]) * 100)[24h:5m])
```

**解读指南：**
- `>98%`: 优秀 - 系统运行正常
- `95-98%`: 良好 - 可能存在轻微问题
- `90-95%`: 警告 - 需要调查和优化
- `<90%`: 严重 - 紧急处理

#### AI响应延迟分析

```promql
# 各百分位响应时间
histogram_quantile(0.50, rate(ai_response_latency_seconds_bucket[5m])) # P50中位数
histogram_quantile(0.95, rate(ai_response_latency_seconds_bucket[5m])) # P95
histogram_quantile(0.99, rate(ai_response_latency_seconds_bucket[5m])) # P99

# 按组件分析延迟
histogram_quantile(0.95, rate(ai_component_latency_seconds_bucket[5m])) by (component)

# 延迟分布直方图
rate(ai_response_latency_seconds_bucket[5m])
```

**延迟评级标准：**
- **P95 < 1.0s**: 优秀性能
- **P95 1.0-1.5s**: 良好性能
- **P95 1.5-3.0s**: 可接受性能
- **P95 > 3.0s**: 性能问题

#### 错误率监控

```promql
# 总体错误率
sum(rate(http_requests_total{status=~"5.."}[5m])) / 
sum(rate(http_requests_total[5m])) * 100

# 按服务错误率
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service) / 
sum(rate(http_requests_total[5m])) by (service) * 100

# 错误趋势
increase(http_requests_total{status=~"5.."}[1h])
```

### 系统指标监控

#### 资源利用率

```promql
# CPU使用率
100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# 磁盘使用率
(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100

# 网络I/O
rate(node_network_receive_bytes_total[5m])
rate(node_network_transmit_bytes_total[5m])
```

#### 应用性能指标

```promql
# JVM内存使用 (如果使用Java服务)
jvm_memory_used_bytes / jvm_memory_max_bytes * 100

# Node.js事件循环延迟
nodejs_eventloop_lag_seconds

# 数据库连接池
pg_stat_database_numbackends
redis_connected_clients

# 队列长度
ai_ninja_queue_length
```

## 告警处理流程

### 告警分级和响应时间

| 等级 | 响应时间 | 处理人员 | 通知方式 | 升级策略 |
|------|----------|----------|----------|----------|
| **Critical** | 5分钟 | 当班SRE | Slack + 短信 + PagerDuty | 15分钟升级到经理 |
| **Warning** | 30分钟 | 开发团队 | Slack + Email | 2小时升级 |
| **Info** | 24小时 | 相关团队 | Email | 不升级 |

### 告警处理标准流程

#### 1. 告警接收和确认

```bash
# 告警确认模板
echo "收到告警: $ALERT_NAME"
echo "严重程度: $SEVERITY"
echo "服务: $SERVICE"
echo "开始时间: $START_TIME"

# 确认告警
curl -X POST "http://alertmanager:9093/api/v1/alerts" \
  -H "Content-Type: application/json" \
  -d '{"status": "acknowledged", "comment": "SRE已确认并开始处理"}'
```

#### 2. 初步诊断

```bash
#!/bin/bash
# 快速诊断脚本

ALERT_SERVICE=$1
echo "=== 快速诊断: $ALERT_SERVICE ==="

# 检查服务状态
echo "1. 服务状态检查..."
kubectl get pods -l app=$ALERT_SERVICE -o wide

# 检查最近日志
echo "2. 最近错误日志..."
kubectl logs -l app=$ALERT_SERVICE --tail=50 --since=10m | grep -i error

# 检查资源使用
echo "3. 资源使用情况..."
kubectl top pods -l app=$ALERT_SERVICE

# 检查相关指标
echo "4. 关键指标..."
curl -s "http://prometheus:9090/api/v1/query?query=up{job=\"$ALERT_SERVICE\"}"
curl -s "http://prometheus:9090/api/v1/query?query=rate(http_requests_total{service=\"$ALERT_SERVICE\"}[5m])"

echo "=== 诊断完成 ==="
```

#### 3. 问题修复

常见问题的标准修复流程：

##### 服务不可用
```bash
# 1. 重启Pod
kubectl rollout restart deployment/$SERVICE_NAME -n ai-ninja

# 2. 检查配置
kubectl get configmap $SERVICE_NAME-config -o yaml

# 3. 扩容服务
kubectl scale deployment $SERVICE_NAME --replicas=3 -n ai-ninja

# 4. 验证恢复
curl -f http://$SERVICE_NAME/health
```

##### 高延迟问题
```bash
# 1. 检查数据库连接
kubectl exec -it $DB_POD -- psql -c "SELECT count(*) FROM pg_stat_activity;"

# 2. 检查缓存状态
kubectl exec -it $REDIS_POD -- redis-cli info stats

# 3. 分析慢查询
kubectl logs $SERVICE_POD | grep "slow query"

# 4. 临时扩容
kubectl patch hpa $SERVICE_NAME -p '{"spec":{"minReplicas":5}}'
```

##### 内存泄漏
```bash
# 1. 内存使用分析
kubectl top pods --sort-by=memory

# 2. 生成heap dump (for Node.js)
kubectl exec $POD_NAME -- kill -USR2 $PID

# 3. 重启高内存使用的Pod
kubectl delete pod $HIGH_MEMORY_POD

# 4. 监控内存趋势
curl "http://prometheus:9090/api/v1/query_range?query=container_memory_usage_bytes{pod=\"$POD_NAME\"}&start=$(date -d '1 hour ago' +%s)&end=$(date +%s)&step=60"
```

#### 4. 事后处理

```bash
# 生成事故报告
cat > "incident-report-$(date +%Y%m%d-%H%M).md" << EOF
# 事故报告 - $(date)

## 基本信息
- 事故ID: INC-$(date +%Y%m%d%H%M)
- 发现时间: $DISCOVERY_TIME
- 解决时间: $RESOLUTION_TIME
- 影响时长: $DURATION
- 严重等级: $SEVERITY

## 事故描述
$DESCRIPTION

## 根本原因
$ROOT_CAUSE

## 解决方案
$RESOLUTION

## 预防措施
$PREVENTION_MEASURES

## 经验教训
$LESSONS_LEARNED
EOF
```

### 自动化响应配置

#### 服务自愈配置

```yaml
# monitoring-service配置
autoRemediation:
  enabled: true
  rules:
    - name: restart-unhealthy-pods
      conditions:
        - metric: up{job=~"phone-gateway|realtime-processor"}
          operator: "=="
          value: 0
          duration: 2m
      actions:
        - type: kubectl
          command: "rollout restart deployment/{service} -n ai-ninja"
        - type: notify
          message: "自动重启了不健康的服务: {service}"
      cooldown: 10m

    - name: scale-on-high-load
      conditions:
        - metric: rate(http_requests_total[1m])
          operator: ">"
          value: 100
          duration: 5m
      actions:
        - type: kubectl
          command: "scale deployment/{service} --replicas=5 -n ai-ninja"
        - type: notify
          message: "由于高负载自动扩容服务: {service}"
      cooldown: 15m
```

## 故障排查指南

### 常见问题排查手册

#### 问题：AI响应延迟过高

**症状：**
- P95响应时间 > 3秒
- 用户投诉响应慢
- 队列积压

**排查步骤：**

1. **确认问题范围**
```bash
# 检查各组件延迟
curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,rate(ai_component_latency_seconds_bucket[5m]))' | jq '.data.result[] | {component: .metric.component, latency: .value[1]}'
```

2. **分析瓶颈组件**
```bash
# STT服务延迟
curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,rate(ai_component_latency_seconds_bucket{component="stt"}[5m]))'

# AI生成延迟
curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,rate(ai_component_latency_seconds_bucket{component="ai_generation"}[5m]))'

# TTS服务延迟
curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,rate(ai_component_latency_seconds_bucket{component="tts"}[5m]))'
```

3. **检查外部依赖**
```bash
# Azure服务健康状态
curl -s 'http://monitoring-service:3009/api/azure/health'

# 数据库性能
kubectl exec -it postgres-pod -- psql -c "
SELECT query, calls, mean_exec_time, rows, 100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;"
```

**修复方案：**
1. **短期修复** - 扩容相关服务
2. **中期优化** - 优化慢查询和算法
3. **长期改进** - 架构优化和缓存策略

#### 问题：内存使用过高

**排查流程：**

1. **识别高内存使用的Pod**
```bash
kubectl top pods --sort-by=memory -A | head -20
```

2. **分析内存使用模式**
```bash
# Node.js内存分析
kubectl exec $POD_NAME -- node -e "console.log(process.memoryUsage())"

# 检查内存泄漏
curl "http://prometheus:9090/api/v1/query_range?query=container_memory_usage_bytes{pod=\"$POD_NAME\"}&start=$(date -d '24 hours ago' +%s)&end=$(date +%s)&step=300"
```

3. **生成内存分析报告**
```bash
# 创建内存分析脚本
./scripts/memory-analysis.sh $POD_NAME
```

#### 问题：数据库性能下降

**诊断查询：**

```sql
-- 活跃连接数
SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active';

-- 慢查询
SELECT query, calls, total_exec_time, mean_exec_time, rows 
FROM pg_stat_statements 
WHERE mean_exec_time > 1000 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- 锁等待
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_statement,
       blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.GRANTED;

-- 表膨胀检查
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE schemaname = 'public' 
ORDER BY n_distinct DESC;
```

### 性能基线偏离分析

当性能指标偏离基线时，使用以下分析框架：

#### 1. 时间序列分析

```promql
# 对比当前值与历史基线
(current_metric_value - avg_over_time(metric[7d] offset 7d)) / avg_over_time(metric[7d] offset 7d) * 100

# 例：响应时间基线偏离
(histogram_quantile(0.95, rate(ai_response_latency_seconds_bucket[5m])) - 
 histogram_quantile(0.95, avg_over_time(rate(ai_response_latency_seconds_bucket[5m])[7d] offset 7d))) / 
 histogram_quantile(0.95, avg_over_time(rate(ai_response_latency_seconds_bucket[5m])[7d] offset 7d)) * 100
```

#### 2. 异常检测结果查询

```bash
# 获取异常检测结果
curl -s 'http://monitoring-service:3009/api/anomalies/recent' | jq '.anomalies[] | select(.score > 0.8)'

# 查看性能基线报告
curl -s 'http://monitoring-service:3009/api/baselines/report'
```

## 性能优化建议

### 监控系统自身优化

#### Prometheus优化

```yaml
# prometheus.yml 优化配置
global:
  scrape_interval: 15s       # 根据需要调整采集间隔
  evaluation_interval: 15s
  external_labels:
    cluster: 'ai-ninja-production'

# 存储优化
storage:
  tsdb:
    retention.time: 30d      # 数据保留期
    retention.size: 50GB     # 存储大小限制
    wal-compression: true    # 启用WAL压缩
    
# 查询优化
query:
  max-concurrency: 20       # 并发查询数限制
  timeout: 2m               # 查询超时时间
  lookback-delta: 5m        # 回溯窗口
```

#### Grafana优化

```ini
# grafana.ini 性能优化
[database]
max_open_conn = 300
max_idle_conn = 300
conn_max_lifetime = 14400

[dataproxy]
timeout = 30
keep_alive_seconds = 30

[caching]
enabled = true

[panels]
disable_sanitize_html = true

[feature_toggles]
enable = publicDashboards,panelsBar
```

#### 监控数据优化策略

1. **数据采集优化**
```yaml
# 高频采集 (5-15秒)
high_frequency_metrics:
  - ai_response_latency
  - active_calls
  - error_rates

# 中频采集 (30-60秒)  
medium_frequency_metrics:
  - system_resources
  - business_metrics
  - queue_lengths

# 低频采集 (5分钟+)
low_frequency_metrics:
  - daily_statistics
  - user_metrics
  - cost_metrics
```

2. **存储分层策略**
```yaml
storage_tiers:
  hot_data:     # 最近7天，高频访问
    retention: 7d
    resolution: 15s
    storage: SSD
    
  warm_data:    # 最近30天，中频访问  
    retention: 30d
    resolution: 1m
    storage: HDD
    
  cold_data:    # 历史数据，低频访问
    retention: 1y
    resolution: 5m
    storage: Object Storage
```

### 告警优化建议

#### 智能告警配置

```yaml
# 防抖动配置
anti_flapping:
  min_duration: 2m          # 最小持续时间
  hysteresis: 10%           # 迟滞百分比
  
# 告警分组
grouping:
  by: ['service', 'severity', 'environment']
  wait: 30s                 # 组内等待时间
  interval: 5m              # 组间间隔

# 智能抑制
inhibition:
  - source_matchers:
      severity: critical
    target_matchers:
      severity: warning
    equal: ['service', 'instance']
```

#### 告警质量提升

1. **可操作性检查清单**
   - [ ] 告警信息包含足够的上下文
   - [ ] 提供明确的处理建议
   - [ ] 包含相关的仪表板链接
   - [ ] 设置合理的阈值和持续时间

2. **告警降噪策略**
   - 实施告警依赖关系
   - 使用维护窗口静默
   - 配置业务时间感知告警
   - 定期审查和优化阈值

## 备份与恢复

### 备份策略

#### 自动化备份脚本

```bash
#!/bin/bash
# 监控系统备份脚本

BACKUP_DIR="/backup/monitoring/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

echo "=== 开始监控系统备份 ==="

# 1. Grafana仪表板备份
echo "备份Grafana仪表板..."
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "http://grafana:3000/api/search?type=dash-db" | \
  jq -r '.[].uid' | \
  while read uid; do
    curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
      "http://grafana:3000/api/dashboards/uid/$uid" | \
      jq '.dashboard' > "$BACKUP_DIR/dashboard-$uid.json"
  done

# 2. Prometheus配置备份
echo "备份Prometheus配置..."
kubectl get configmap prometheus-config -o yaml > "$BACKUP_DIR/prometheus-config.yaml"
cp -r alerting/rules "$BACKUP_DIR/alert-rules"

# 3. 告警配置备份
echo "备份告警配置..."
kubectl get configmap alertmanager-config -o yaml > "$BACKUP_DIR/alertmanager-config.yaml"

# 4. 监控服务配置备份
echo "备份监控服务配置..."
kubectl get deployment monitoring-service -o yaml > "$BACKUP_DIR/monitoring-service-config.yaml"

# 5. 数据库Schema备份
echo "备份数据库Schema..."
kubectl exec postgres-pod -- pg_dump -s ai_ninja > "$BACKUP_DIR/monitoring-schema.sql"

# 6. 重要数据备份
echo "备份关键数据..."
kubectl exec postgres-pod -- pg_dump -t performance_baselines -t alert_rules ai_ninja > "$BACKUP_DIR/monitoring-data.sql"

# 7. 压缩备份
echo "压缩备份文件..."
tar -czf "${BACKUP_DIR}.tar.gz" -C "$(dirname $BACKUP_DIR)" "$(basename $BACKUP_DIR)"
rm -rf "$BACKUP_DIR"

# 8. 上传到云存储 (可选)
if [[ -n "$AWS_S3_BUCKET" ]]; then
  aws s3 cp "${BACKUP_DIR}.tar.gz" "s3://$AWS_S3_BUCKET/monitoring-backups/"
fi

echo "=== 备份完成: ${BACKUP_DIR}.tar.gz ==="
```

### 恢复流程

#### 灾难恢复步骤

```bash
#!/bin/bash
# 监控系统恢复脚本

BACKUP_FILE=$1
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "错误: 备份文件不存在: $BACKUP_FILE"
  exit 1
fi

echo "=== 开始监控系统恢复 ==="

# 1. 解压备份
RESTORE_DIR="/tmp/restore-$(date +%s)"
mkdir -p "$RESTORE_DIR"
tar -xzf "$BACKUP_FILE" -C "$RESTORE_DIR"

# 2. 恢复Prometheus配置
echo "恢复Prometheus配置..."
kubectl apply -f "$RESTORE_DIR/prometheus-config.yaml"
kubectl rollout restart deployment/prometheus -n ai-ninja-monitoring

# 3. 恢复告警配置
echo "恢复告警配置..."
kubectl apply -f "$RESTORE_DIR/alertmanager-config.yaml"
kubectl rollout restart deployment/alertmanager -n ai-ninja-monitoring

# 4. 恢复Grafana仪表板
echo "恢复Grafana仪表板..."
for dashboard in "$RESTORE_DIR"/dashboard-*.json; do
  if [[ -f "$dashboard" ]]; then
    curl -X POST \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $GRAFANA_API_KEY" \
      -d @"$dashboard" \
      "http://grafana:3000/api/dashboards/db"
  fi
done

# 5. 恢复数据库数据
echo "恢复数据库数据..."
kubectl exec -i postgres-pod -- psql ai_ninja < "$RESTORE_DIR/monitoring-data.sql"

# 6. 重启监控服务
echo "重启监控服务..."
kubectl rollout restart deployment/monitoring-service -n ai-ninja-monitoring

# 7. 验证恢复
echo "验证系统恢复..."
sleep 30
kubectl get pods -n ai-ninja-monitoring
curl -f http://grafana:3000/api/health
curl -f http://prometheus:9090/-/healthy

# 清理临时文件
rm -rf "$RESTORE_DIR"

echo "=== 恢复完成 ==="
```

## 升级与维护

### 滚动升级流程

#### Prometheus升级

```bash
#!/bin/bash
# Prometheus滚动升级

NEW_VERSION="v2.46.0"
echo "升级Prometheus到版本: $NEW_VERSION"

# 1. 备份当前配置
kubectl get configmap prometheus-config -o yaml > prometheus-config-backup.yaml

# 2. 更新镜像版本
kubectl set image deployment/prometheus prometheus=prom/prometheus:$NEW_VERSION -n ai-ninja-monitoring

# 3. 监控升级进度
kubectl rollout status deployment/prometheus -n ai-ninja-monitoring

# 4. 验证升级
sleep 30
kubectl exec deployment/prometheus -- prometheus --version
curl -f http://prometheus:9090/-/healthy

# 5. 如果升级失败，回滚
if [[ $? -ne 0 ]]; then
  echo "升级失败，执行回滚..."
  kubectl rollout undo deployment/prometheus -n ai-ninja-monitoring
  exit 1
fi

echo "Prometheus升级成功"
```

#### 监控服务升级

```bash
#!/bin/bash
# 监控服务升级脚本

NEW_IMAGE="ai-ninja/monitoring-service:v2.1.0"

echo "=== 升级监控服务 ==="

# 1. 构建新镜像
docker build -t "$NEW_IMAGE" monitoring-service/

# 2. 推送到镜像仓库
docker push "$NEW_IMAGE"

# 3. 更新deployment
kubectl set image deployment/monitoring-service monitoring-service="$NEW_IMAGE" -n ai-ninja-monitoring

# 4. 监控升级状态
kubectl rollout status deployment/monitoring-service -n ai-ninja-monitoring --timeout=300s

# 5. 健康检查
sleep 30
for i in {1..10}; do
  if curl -f http://monitoring-service:3009/health; then
    echo "健康检查通过"
    break
  fi
  if [[ $i -eq 10 ]]; then
    echo "健康检查失败，执行回滚"
    kubectl rollout undo deployment/monitoring-service -n ai-ninja-monitoring
    exit 1
  fi
  sleep 10
done

echo "=== 升级完成 ==="
```

### 维护窗口规划

#### 定期维护时间表

```yaml
maintenance_schedule:
  weekly:
    day: Sunday
    time: "02:00-04:00 UTC"
    tasks:
      - update_alert_thresholds
      - cleanup_old_data
      - backup_configurations
      
  monthly:
    day: "First Sunday"
    time: "01:00-05:00 UTC"
    tasks:
      - system_updates
      - performance_optimization
      - security_patches
      
  quarterly:
    tasks:
      - major_version_upgrades
      - architecture_reviews
      - disaster_recovery_tests
```

## 最佳实践

### 监控原则

#### 1. 黄金信号优先
专注于四个关键信号：
- **延迟** (Latency): 用户请求处理时间
- **流量** (Traffic): 系统处理的请求量
- **错误** (Errors): 请求失败的比例  
- **饱和度** (Saturation): 系统资源使用程度

#### 2. USE方法论
- **利用率** (Utilization): 资源繁忙程度
- **饱和度** (Saturation): 排队等待程度
- **错误** (Errors): 错误事件数量

#### 3. RED方法论  
- **请求速率** (Rate): 每秒请求数
- **错误率** (Errors): 错误请求比例
- **持续时间** (Duration): 请求处理时间分布

### 告警设计原则

#### SMART告警
- **S**pecific: 具体明确的问题描述
- **M**easurable: 可量化的指标阈值  
- **A**ctionable: 提供明确的处理步骤
- **R**elevant: 与业务影响相关
- **T**ime-bound: 设置合理的时间窗口

#### 告警疲劳预防
```yaml
alert_fatigue_prevention:
  # 1. 告警分层
  severity_levels:
    - critical: "立即响应 - 影响用户"
    - warning: "计划处理 - 潜在问题"
    - info: "信息记录 - 状态变化"
  
  # 2. 智能分组
  grouping_strategy:
    by: ['service', 'environment', 'severity']
    interval: 5m
    
  # 3. 自动抑制
  inhibition_rules:
    - source: "service_down"
      target: "high_latency" 
      reason: "服务宕机时抑制延迟告警"
```

### 性能调优建议

#### 查询优化

```promql
# 好的做法：使用rate()计算速率
rate(http_requests_total[5m])

# 避免：使用increase()除以时间
increase(http_requests_total[5m]) / (5 * 60)

# 好的做法：限制时间范围
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# 避免：长时间范围查询
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[1d]))

# 好的做法：使用by子句聚合
sum by (service) (rate(http_requests_total[5m]))

# 避免：不必要的高基数聚合
sum(rate(http_requests_total[5m])) by (method, path, status)
```

#### 存储优化

```yaml
# 保留策略优化
retention_policies:
  raw_metrics:
    retention: 15d
    resolution: 15s
    
  downsampled_5m:
    retention: 90d  
    resolution: 5m
    
  downsampled_1h:
    retention: 1y
    resolution: 1h

# 压缩设置
compression:
  enabled: true
  algorithm: snappy
  
# 分区策略  
partitioning:
  strategy: time_based
  interval: 1d
```

### 安全最佳实践

#### 访问控制

```yaml
security_config:
  # 1. 基于角色的访问控制
  rbac:
    admin:
      - read:all
      - write:all
      - admin:all
    sre:
      - read:all
      - write:alerts
      - admin:alerts
    developer:
      - read:own_service
      - write:none
    viewer:
      - read:dashboards
      
  # 2. 网络访问限制
  network_policies:
    - allow_from: ["ai-ninja", "ai-ninja-monitoring"]
    - deny_from: ["default", "public"]
    
  # 3. 数据脱敏
  data_anonymization:
    - mask_user_data: true
    - hash_phone_numbers: true
    - encrypt_pii: true
```

#### API安全

```yaml
api_security:
  authentication:
    method: jwt
    expiry: 1h
    
  rate_limiting:
    per_user: 1000/hour
    per_ip: 100/minute
    
  input_validation:
    enabled: true
    schema_validation: true
    
  audit_logging:
    enabled: true
    include_request_body: false
    retention: 90d
```

### 文档维护

#### 运维文档更新流程

1. **每月审查** - 检查文档准确性
2. **版本控制** - 使用Git管理文档版本
3. **协作更新** - 团队成员共同维护
4. **自动化检查** - 自动验证配置示例

#### 知识库建设

```markdown
# 知识库结构
knowledge_base/
├── runbooks/              # 应急处理手册
├── troubleshooting/       # 故障排查指南  
├── architecture/          # 架构文档
├── configuration/         # 配置参考
├── best-practices/        # 最佳实践
└── tutorials/            # 教程指南
```

---

## 总结

本运维指南涵盖了AI Answer Ninja监控系统的完整运维流程，从日常监控到应急响应，从性能优化到安全保护。通过遵循这些最佳实践和标准流程，可以确保监控系统的高可用性和有效性。

关键成功因素：
- 🎯 专注于业务关键指标
- ⚡ 快速响应和自动化
- 📊 数据驱动的决策
- 🔄 持续改进和优化
- 👥 团队协作和知识共享

记住：监控不是目的，而是保障业务稳定运行的手段。始终以用户体验和业务价值为核心，构建高效可靠的监控体系。