# AI电话应答系统 - 备份系统

## 概述

这是AI电话应答系统的企业级数据备份和恢复解决方案，提供完整的数据保护、灾难恢复和业务连续性保障。

### 核心功能

- 🔄 **自动备份**: PostgreSQL和Redis的全量/增量备份
- 🔐 **数据加密**: 端到端加密备份，确保数据安全
- ⏰ **智能调度**: 基于业务负载的自动备份调度
- 🚀 **快速恢复**: PITR(点时间恢复)和选择性恢复
- ✅ **备份验证**: 自动化备份完整性检查
- 📊 **监控告警**: 实时监控和多渠道告警通知
- 🌐 **灾难恢复**: 跨区域自动故障转移

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PostgreSQL    │    │      Redis      │    │   Encryption    │
│ Backup Service  │    │ Backup Service  │    │    Service      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
         ┌───────────────────────▼───────────────────────┐
         │            Backup Scheduler Service           │
         └─────────────────────┬─────────────────────────┘
                               │
    ┌──────────────────────────┼──────────────────────────┐
    │                          │                          │
┌───▼──────────┐    ┌─────────▼────────┐    ┌───────────▼──┐
│   Recovery   │    │    Validation    │    │  Monitoring  │
│   Service    │    │     Service      │    │   Service    │
└──────────────┘    └──────────────────┘    └──────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
         ┌───────────────────────▼───────────────────────┐
         │         Disaster Recovery Service             │
         └───────────────────────────────────────────────┘
```

## 快速开始

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- Node.js 18+ (开发环境)
- PostgreSQL 12+
- Redis 6+

### 环境配置

1. **复制环境变量文件**
```bash
cp .env.example .env
```

2. **配置必要的环境变量**
```bash
# 数据库配置
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=ai_ninja
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=ai_ninja_db

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Azure存储配置 (推荐生产环境)
AZURE_STORAGE_ACCOUNT=your_storage_account
AZURE_STORAGE_KEY=your_storage_key
BACKUP_BUCKET=ai-ninja-backups

# 通知配置
ADMIN_EMAIL=admin@your-domain.com
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### 部署方式

#### 方式1: Docker Compose (推荐)

1. **启动完整系统**
```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f backup-system

# 检查状态
curl http://localhost:8080/health
```

2. **仅启动备份系统**
```bash
# 如果已有数据库实例
docker-compose up -d backup-system
```

#### 方式2: Kubernetes部署

```bash
# 应用配置
kubectl apply -f k8s/

# 查看部署状态
kubectl get pods -l app=ai-ninja-backup

# 查看日志
kubectl logs -f deployment/ai-ninja-backup-system
```

#### 方式3: 独立部署

```bash
# 安装依赖
npm install

# 构建
npm run build

# 启动
npm start
```

## 配置说明

### 主配置文件

配置文件位于 `config/backup-system-config.json`，支持环境变量替换:

```json
{
  "postgresql": {
    "database": {
      "host": "${POSTGRES_HOST:-localhost}",
      "password": "${POSTGRES_PASSWORD}"
    },
    "backup": {
      "retentionDays": 30,
      "encryptionEnabled": true
    }
  }
}
```

### 备份策略配置

#### PostgreSQL备份
- **全量备份**: 每周日凌晨2点
- **增量备份**: 每天2点、8点、14点、20点
- **WAL归档**: 每5分钟
- **保留策略**: 30天

#### Redis备份
- **RDB备份**: 每天1点、7点、13点、19点
- **AOF备份**: 每2小时
- **全量备份**: 每周日凌晨3点

### 监控告警配置

#### 告警规则
- **备份失败**: 高优先级，15分钟内升级
- **备份耗时过长**: 中优先级，超过1小时告警
- **系统负载过高**: 中优先级，CPU超过90%
- **存储空间不足**: 高优先级，超过85%使用率

#### 通知渠道
- **邮件**: SMTP集成
- **Slack**: Webhook集成
- **Webhook**: 自定义API集成
- **短信**: 集成第三方SMS服务

## 使用指南

### 手动备份

```bash
# 触发PostgreSQL全量备份
curl -X POST http://localhost:8080/api/backup/postgresql/full

# 触发Redis RDB备份
curl -X POST http://localhost:8080/api/backup/redis/rdb

# 查看备份状态
curl http://localhost:8080/api/backup/status
```

### 数据恢复

```bash
# PITR恢复到指定时间点
curl -X POST http://localhost:8080/api/recovery/pitr \
  -H "Content-Type: application/json" \
  -d '{
    "targetTime": "2024-01-15T10:30:00Z",
    "dryRun": false
  }'

# 选择性恢复指定数据库
curl -X POST http://localhost:8080/api/recovery/selective \
  -H "Content-Type: application/json" \
  -d '{
    "databases": ["user_data", "call_records"],
    "targetLocation": "/tmp/recovery"
  }'
```

### 备份验证

```bash
# 验证最新备份
curl -X POST http://localhost:8080/api/validation/verify

# 批量验证备份
curl -X POST http://localhost:8080/api/validation/batch \
  -H "Content-Type: application/json" \
  -d '{
    "backupPaths": ["/path/to/backup1", "/path/to/backup2"],
    "generateReport": true
  }'
```

### 灾难恢复测试

```bash
# 执行部分恢复测试
curl -X POST http://localhost:8080/api/disaster-recovery/test \
  -H "Content-Type: application/json" \
  -d '{
    "testType": "partial",
    "notifyStakeholders": true
  }'
```

## 监控仪表盘

### 健康检查端点
- **系统健康**: `GET /health`
- **就绪状态**: `GET /ready`
- **指标数据**: `GET /metrics` (Prometheus格式)

### Grafana仪表盘

访问 `http://localhost:3000` (默认用户名/密码: admin/admin)

预置仪表盘包括:
- **备份系统概览**: 系统状态、备份成功率、存储使用量
- **性能监控**: 备份耗时、系统资源使用、错误率
- **告警管理**: 活跃告警、告警历史、升级状态

## 运维指南

### 日常维护

1. **检查系统状态**
```bash
# 查看整体状态
docker-compose exec backup-system curl localhost:8080/health

# 查看日志
docker-compose logs --tail 100 backup-system
```

2. **清理过期备份**
```bash
# 手动触发清理
curl -X POST http://localhost:8080/api/maintenance/cleanup
```

3. **密钥轮转**
```bash
# 触发密钥轮转
curl -X POST http://localhost:8080/api/encryption/rotate-keys
```

### 故障排除

#### 常见问题

1. **备份失败**
   - 检查数据库连接
   - 验证存储权限
   - 查看磁盘空间

2. **恢复失败**
   - 确认备份文件完整性
   - 检查目标环境准备
   - 验证网络连通性

3. **告警不发送**
   - 验证SMTP/Webhook配置
   - 检查网络防火墙
   - 查看告警日志

#### 日志分析

```bash
# 查看错误日志
docker-compose logs backup-system | grep ERROR

# 查看备份相关日志
docker-compose logs backup-system | grep "backup"

# 查看恢复相关日志
docker-compose logs backup-system | grep "recovery"
```

### 性能优化

1. **备份性能**
   - 调整并发备份数量
   - 优化备份窗口时间
   - 启用压缩和去重

2. **存储优化**
   - 配置生命周期策略
   - 启用智能分层
   - 监控存储使用量

3. **网络优化**
   - 启用带宽限制
   - 使用CDN加速
   - 优化传输协议

## 安全考虑

### 数据保护
- **传输加密**: TLS 1.3加密传输
- **静态加密**: AES-256-GCM算法
- **密钥管理**: 自动密钥轮转，HSM支持
- **访问控制**: RBAC权限控制

### 合规性
- **GDPR**: 数据匿名化和删除
- **SOX**: 审计跟踪和合规报告
- **ISO 27001**: 安全控制框架
- **本地法规**: 数据本地化存储

### 审计日志
所有操作都会记录详细的审计日志，包括：
- 用户操作记录
- 系统状态变更
- 数据访问日志
- 安全事件记录

## 版本升级

### 升级步骤

1. **备份当前配置**
```bash
docker-compose exec backup-system cat /app/config/backup-system-config.json > backup-config.json
```

2. **更新镜像版本**
```bash
# 拉取新版本
docker-compose pull

# 停止旧版本
docker-compose down

# 启动新版本
docker-compose up -d
```

3. **验证升级结果**
```bash
# 检查版本
curl http://localhost:8080/health | jq '.version'

# 验证功能
curl -X POST http://localhost:8080/api/backup/test
```

## API文档

### 备份操作
- `POST /api/backup/postgresql/full` - 触发PostgreSQL全量备份
- `POST /api/backup/postgresql/incremental` - 触发PostgreSQL增量备份
- `POST /api/backup/redis/rdb` - 触发Redis RDB备份
- `POST /api/backup/redis/aof` - 触发Redis AOF备份
- `GET /api/backup/status` - 获取备份状态
- `GET /api/backup/history` - 获取备份历史

### 恢复操作
- `POST /api/recovery/pitr` - 执行PITR恢复
- `POST /api/recovery/full-system` - 执行完整系统恢复
- `POST /api/recovery/selective` - 执行选择性恢复
- `GET /api/recovery/points` - 获取可用恢复点
- `GET /api/recovery/status/{jobId}` - 获取恢复任务状态

### 验证操作
- `POST /api/validation/verify` - 验证备份文件
- `POST /api/validation/batch` - 批量验证备份
- `GET /api/validation/history` - 获取验证历史
- `GET /api/validation/reports` - 获取验证报告

### 监控操作
- `GET /health` - 系统健康检查
- `GET /ready` - 系统就绪检查
- `GET /metrics` - Prometheus指标
- `GET /api/monitoring/alerts` - 获取活跃告警
- `POST /api/monitoring/alerts/{alertId}/acknowledge` - 确认告警

### 灾难恢复操作
- `POST /api/disaster-recovery/trigger` - 触发灾难恢复
- `POST /api/disaster-recovery/test` - 执行恢复测试
- `GET /api/disaster-recovery/status` - 获取灾难恢复状态
- `POST /api/disaster-recovery/failback` - 执行故障回切

## 支持与联系

- **文档**: https://docs.ai-answer-ninja.com/backup
- **GitHub**: https://github.com/ai-answer-ninja/backup-system
- **Issue追踪**: https://github.com/ai-answer-ninja/backup-system/issues
- **邮件支持**: support@ai-answer-ninja.com
- **社区讨论**: https://community.ai-answer-ninja.com

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 更新日志

### v1.0.0 (2024-01-15)
- ✨ 初始版本发布
- 🔄 完整的PostgreSQL和Redis备份功能
- 🔐 端到端加密备份
- ⏰ 自动化备份调度
- 🚀 PITR和选择性恢复
- ✅ 自动备份验证
- 📊 实时监控和告警
- 🌐 灾难恢复支持

---

**AI电话应答系统备份服务** - 为您的业务数据提供企业级保护