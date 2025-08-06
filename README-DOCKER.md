# AI Answer Ninja - Docker 部署指南

## 快速开始

### 1. 环境准备

```bash
# 确保已安装 Docker 和 Docker Compose
docker --version
docker-compose --version

# 克隆项目并进入目录
cd ai-answer-ninja

# 初始化项目环境
make setup
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置Azure服务信息
nano .env
```

**必须配置的关键环境变量：**
```bash
# Azure服务配置
AZURE_COMMUNICATION_CONNECTION_STRING=your_connection_string
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=eastasia
AZURE_OPENAI_KEY=your_openai_key
AZURE_OPENAI_ENDPOINT=your_openai_endpoint

# 安全配置
POSTGRES_PASSWORD=your_secure_password
JWT_SECRET=your_32_character_jwt_secret
```

### 3. 启动服务

```bash
# 开发环境 - 启动所有服务
make up

# 或仅启动核心服务
make up-core

# 生产环境部署
make ENV=production prod-deploy
```

## 服务架构

### 核心服务 (端口 3001-3004)
- **phone-gateway** (3001): 电话接入和路由
- **realtime-processor** (3002): 实时音频处理
- **conversation-engine** (3003): AI对话管理
- **profile-analytics** (3004): 用户画像分析

### 支撑服务 (端口 3005-3006)
- **user-management** (3005): 用户认证管理
- **smart-whitelist** (3006): 智能白名单

### 平台服务 (端口 3007-3009)
- **configuration** (3007): 统一配置管理
- **storage** (3008): 文件存储服务
- **monitoring** (3009): 系统监控

### 数据层
- **postgres** (5432): 主数据库
- **redis** (6379): 缓存和消息队列

### 基础设施
- **nginx** (80/443): 反向代理和负载均衡

## 常用命令

### 服务管理
```bash
# 查看服务状态
make status

# 查看健康状态
make health

# 重启服务
make restart

# 重启指定服务
make restart-service service=phone-gateway
```

### 日志管理
```bash
# 查看所有日志
make logs

# 查看指定服务日志
make logs-service service=realtime-processor

# 实时监控日志
docker-compose logs -f phone-gateway
```

### 调试和维护
```bash
# 进入服务容器
make exec service=phone-gateway

# 执行特定命令
make exec service=postgres cmd="psql -U postgres ai_ninja"

# 数据库备份
make db-backup

# 数据库恢复
make db-restore file=backup_20231201_120000.sql
```

### 扩缩容
```bash
# 扩容实时处理服务到3个实例
make scale service=realtime-processor replicas=3

# 查看扩容结果
make status
```

## 开发环境特性

### 开发工具访问
启动开发工具：
```bash
make dev-tools
```

访问地址：
- **pgAdmin**: http://localhost:8080 (数据库管理)
- **Redis Commander**: http://localhost:8081 (Redis管理)
- **Swagger UI**: http://localhost:8082 (API文档)
- **Kibana**: http://localhost:5601 (日志分析)
- **Grafana**: http://localhost:3000 (监控面板)

### 热重载支持
开发环境默认启用热重载，代码修改后自动重启服务。

### 调试配置
```bash
# 启用调试日志
DEBUG=ai-ninja:* make up

# 查看详细日志
LOG_LEVEL=debug make up
```

## 生产环境部署

### 自动部署
```bash
# 一键生产部署
make ENV=production prod-deploy
```

### 手动部署步骤
```bash
# 1. 切换到生产配置
export ENV=production

# 2. 构建生产镜像
make build

# 3. 启动生产服务
make up

# 4. 检查健康状态
make health

# 5. 监控服务状态
make status
```

### 生产环境优化
- 服务副本数：根据负载自动调整
- 资源限制：CPU和内存限制
- 健康检查：自动故障恢复
- 日志收集：集中化日志管理
- 监控告警：Prometheus + Grafana

## 监控和维护

### 健康检查
每个服务都配置了健康检查端点：
```bash
# 检查单个服务
curl http://localhost:3001/health

# 检查所有服务健康状态
make health
```

### 性能监控
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000
- **Node Exporter**: http://localhost:9100
- **cAdvisor**: http://localhost:8083

### 日志管理
日志文件位置：
```
logs/
├── phone-gateway/
├── realtime-processor/
├── conversation-engine/
├── profile-analytics/
├── user-management/
├── smart-whitelist/
├── configuration/
├── storage/
├── monitoring/
└── nginx/
```

## 故障排除

### 常见问题

**1. 服务启动失败**
```bash
# 查看详细日志
make logs-service service=failing-service

# 检查配置
make exec service=failing-service cmd="env"
```

**2. 数据库连接问题**
```bash
# 检查数据库状态
make exec service=postgres cmd="pg_isready -U postgres"

# 查看数据库日志
make logs-service service=postgres
```

**3. Redis连接问题**
```bash
# 测试Redis连接
make exec service=redis cmd="redis-cli ping"

# 查看Redis配置
make exec service=redis cmd="redis-cli config get '*'"
```

**4. 网络问题**
```bash
# 检查网络配置
docker network ls
docker network inspect ai-ninja_ai-ninja-network

# 测试服务间连通性
make exec service=phone-gateway cmd="curl http://user-management:3005/health"
```

### 清理和重置
```bash
# 清理未使用资源
make clean

# 完全重置(危险操作)
make clean-all

# 重新初始化
make setup && make up
```

## 安全注意事项

### 生产环境安全
1. **更换默认密码**: 修改 .env 中的所有密码
2. **SSL证书**: 配置 nginx SSL证书
3. **防火墙**: 仅开放必要端口
4. **访问控制**: 配置适当的网络访问策略

### 敏感数据保护
- 环境变量文件 (.env) 不要提交到版本控制
- 定期轮换密钥和密码
- 使用 Docker secrets 管理敏感配置

## 性能调优

### 资源配置
生产环境资源配置建议：
```yaml
realtime-processor: 2 CPU, 1GB内存, 3副本
phone-gateway: 1 CPU, 512MB内存, 2副本
postgres: 2 CPU, 2GB内存
redis: 1 CPU, 512MB内存
```

### 数据库优化
```bash
# 查看数据库性能统计
make exec service=postgres cmd="psql -U postgres -d ai_ninja -c 'SELECT * FROM pg_stat_activity;'"

# 优化查询性能
make exec service=postgres cmd="psql -U postgres -d ai_ninja -c 'EXPLAIN ANALYZE SELECT * FROM call_records LIMIT 100;'"
```

## 备份和恢复

### 自动备份
```bash
# 设置定期备份(crontab)
0 2 * * * cd /path/to/ai-answer-ninja && make db-backup
```

### 灾难恢复
```bash
# 1. 停止服务
make down

# 2. 恢复数据
make db-restore file=latest_backup.sql

# 3. 重启服务
make up

# 4. 验证数据完整性
make health
```

## 扩展指南

### 添加新服务
1. 在 `services/` 目录创建新服务
2. 在 `docker-compose.yml` 添加服务配置
3. 更新 `Makefile` 中的服务列表
4. 配置服务发现和负载均衡

### 多环境管理
支持多个部署环境：
- `development`: 开发环境
- `staging`: 测试环境  
- `production`: 生产环境

每个环境可以有独立的配置文件。