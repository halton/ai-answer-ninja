# Phase 1 Deployment Guide - AI Answer Ninja

本文档描述如何部署和运行AI电话应答系统的第一阶段核心服务。

## 概述

Phase 1 包含了系统的核心基础服务架构，为后续功能开发奠定基础。

### 已实现的服务

1. **Phone Gateway Service** (端口: 3001)
   - 电话接入和路由控制
   - Azure Communication Services 集成
   - 来电过滤和决策

2. **Real-time Processor Service** (端口: 3002)
   - 实时音频处理
   - WebSocket 通信管理
   - AI 对话处理流水线

3. **Profile Analytics Service** (端口: 3004)
   - 用户画像分析
   - 通话数据分析
   - 机器学习模型服务

4. **Configuration Service** (端口: 3007)
   - 统一配置管理
   - 功能开关控制
   - 配置版本控制

## 系统要求

- Node.js >= 18.0.0
- Python >= 3.8 (用于 Profile Analytics Service)
- npm 或 yarn
- Redis (可选，用于缓存)
- PostgreSQL (可选，用于数据存储)

## 快速开始

### 方式 1: 自动化部署脚本

使用提供的部署脚本一键启动所有服务：

```bash
# 确保脚本可执行
chmod +x scripts/phase1-deployment.ts

# 运行部署脚本
npx ts-node scripts/phase1-deployment.ts
```

### 方式 2: 手动部署

#### 1. 安装依赖

```bash
# 安装根目录依赖
npm install

# 为每个服务安装依赖
cd services/phone-gateway && npm install && cd ../..
cd services/realtime-processor && npm install && cd ../..
cd services/configuration-service && npm install && cd ../..
cd services/profile-analytics && pip install -r requirements.txt && cd ../..
```

#### 2. 构建服务 (TypeScript 服务)

```bash
cd services/phone-gateway && npm run build && cd ../..
cd services/realtime-processor && npm run build && cd ../..
cd services/configuration-service && npm run build && cd ../..
```

#### 3. 启动服务

在不同终端窗口中启动每个服务：

```bash
# Terminal 1: Phone Gateway
cd services/phone-gateway && npm run dev

# Terminal 2: Real-time Processor
cd services/realtime-processor && npm run dev

# Terminal 3: Profile Analytics
cd services/profile-analytics && python main.py

# Terminal 4: Configuration Service
cd services/configuration-service && npm run dev
```

### 方式 3: Docker 部署 (推荐生产环境)

```bash
# 构建并启动所有服务
docker-compose -f docker-compose.dev.yml up --build

# 后台运行
docker-compose -f docker-compose.dev.yml up -d --build
```

## 服务验证

### 健康检查

访问以下 URL 验证服务是否正常运行：

- Phone Gateway: http://localhost:3001/health
- Real-time Processor: http://localhost:3002/health  
- Profile Analytics: http://localhost:3004/api/v1/health
- Configuration Service: http://localhost:3007/health

### API 文档

- Phone Gateway: http://localhost:3001/ (服务信息)
- Real-time Processor: http://localhost:3002/ (服务信息)
- Configuration Service: http://localhost:3007/ (服务信息)

### 集成测试

运行集成测试验证服务间通信：

```bash
npm test -- --testNamePattern="integration"
```

## 服务架构

```
Phone Gateway (3001)
├── 接收来电 Webhook
├── 路由决策引擎
└── Azure Communication Services

Real-time Processor (3002)  
├── WebSocket 连接管理
├── 音频流处理
└── AI 对话引擎

Profile Analytics (3004)
├── 用户画像分析
├── 通话数据处理
└── ML 模型服务

Configuration Service (3007)
├── 配置管理 API
├── 功能开关控制
└── 实时配置更新
```

## 环境配置

### 必需的环境变量

在每个服务目录创建 `.env` 文件：

#### Phone Gateway Service
```env
# Azure Communication Services
AZURE_COMMUNICATION_CONNECTION_STRING=your_connection_string
AZURE_COMMUNICATION_ENDPOINT=your_endpoint
AZURE_COMMUNICATION_RESOURCE_ID=your_resource_id

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_ninja
DB_USERNAME=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

#### Real-time Processor Service
```env
# WebSocket Configuration
WS_PORT=3002
MAX_CONNECTIONS=1000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Azure Services
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=your_region
AZURE_OPENAI_ENDPOINT=your_openai_endpoint
AZURE_OPENAI_KEY=your_openai_key
```

#### Profile Analytics Service
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_ninja

# Cache
REDIS_URL=redis://localhost:6379/0

# ML Models
MODEL_PATH=./ml/models/
```

#### Configuration Service
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_ninja_config
DB_USERNAME=postgres
DB_PASSWORD=your_password

# Encryption
CONFIG_ENCRYPTION_KEY=your_32_character_encryption_key

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 监控和日志

### 监控端点

- Metrics: http://localhost:3001/metrics (Prometheus格式)
- Health Checks: 各服务的 `/health` 端点
- Connection Stats: http://localhost:3002/connections

### 日志配置

所有服务使用结构化日志 (JSON 格式)，可通过 `LOG_LEVEL` 环境变量调整日志级别：

```env
LOG_LEVEL=info  # trace, debug, info, warn, error, fatal
```

## 故障排除

### 常见问题

1. **端口已被占用**
   ```bash
   # 查找占用端口的进程
   lsof -i :3001
   # 终止进程
   kill -9 <PID>
   ```

2. **Node.js 版本不兼容**
   ```bash
   # 检查版本
   node --version
   # 使用 nvm 切换版本
   nvm use 18
   ```

3. **Python 依赖问题**
   ```bash
   # 使用虚拟环境
   python -m venv venv
   source venv/bin/activate  # Linux/Mac
   # venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   ```

4. **数据库连接失败**
   - 确保 PostgreSQL 服务运行
   - 检查数据库凭据
   - 验证网络连接

### 日志分析

查看服务日志获取详细错误信息：

```bash
# 实时查看日志
tail -f services/phone-gateway/logs/app.log

# Docker 环境查看日志
docker-compose logs -f phone-gateway
```

### 性能调优

1. **内存使用优化**
   ```env
   NODE_OPTIONS="--max-old-space-size=2048"
   ```

2. **连接池配置**
   ```env
   DB_MAX_CONNECTIONS=20
   REDIS_MAX_CONNECTIONS=50
   ```

3. **缓存配置**
   ```env
   CACHE_TTL=300
   CACHE_ENABLED=true
   ```

## 下一步

Phase 1 完成后，可以继续进行：

1. **Phase 2 功能开发**
   - User Management Service
   - Smart Whitelist Service
   - Conversation Engine Service

2. **监控系统集成**
   - Prometheus + Grafana
   - 日志聚合 (ELK Stack)
   - 告警配置

3. **生产环境部署**
   - Kubernetes 配置
   - CI/CD 流水线
   - 安全加固

## 支持

如遇问题，请查看：

- 项目 Issues: [GitHub Issues](https://github.com/your-repo/issues)
- 架构文档: `CLAUDE.md`
- API 文档: 各服务根路径

---

**Phase 1 实现完成状态:** ✅ 基础架构已就绪，可继续后续开发