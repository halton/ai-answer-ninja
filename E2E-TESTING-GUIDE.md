# AI Answer Ninja E2E测试环境部署指南

## 概述

本指南提供了完整的E2E测试环境设置方案，包括Docker环境修复、服务选择和本地运行方案。

## 快速开始

### 选项1: Docker环境 (推荐)

```bash
# 1. 修复Docker环境
./docker-fix-and-alternatives.md  # 参考修复指南

# 2. 启动E2E测试环境
docker-compose -f docker-compose.e2e.yml up -d

# 3. 运行E2E测试
npm run test:e2e
```

### 选项2: 本地环境 (Docker问题时)

```bash
# 1. 启动本地服务
./local-e2e-setup.sh

# 2. 验证服务状态
node quick-test-services.js

# 3. 运行E2E测试
npm run test:e2e

# 4. 清理环境
./local-e2e-cleanup.sh
```

## 环境架构

### 选定的服务版本

基于分析结果，我们选择了以下服务版本：

| 服务 | 版本 | 语言 | 端口 | 状态 |
|------|------|------|------|------|
| phone-gateway | 原版 | TypeScript | 3001 | ✅ 已选择 |
| realtime-processor | 原版 | TypeScript | 3002 | ✅ 已选择 |
| conversation-engine-ts | 新选择 | TypeScript | 3003 | 🔄 替换Python版 |
| profile-analytics | 原版 | Python | 3004 | ✅ 保持ML功能 |
| user-management | 原版 | TypeScript | 3005 | ✅ 已选择 |
| smart-whitelist-node | 新选择 | TypeScript | 3006 | 🔄 替换Go版 |
| configuration-service | 原版 | TypeScript | 3007 | ✅ 已选择 |
| storage | 原版 | TypeScript | 3008 | ✅ 已选择 |
| monitoring | 原版 | TypeScript | 3009 | ✅ 已选择 |

### 支持服务

| 服务 | 端口 | 描述 |
|------|------|------|
| PostgreSQL | 5432 (本地) / 5433 (Docker) | 主数据库 |
| Redis | 6379 (本地) / 6380 (Docker) | 缓存和会话 |
| Azure Mock | 8080 | Azure服务模拟 |

## Azure Mock服务

### 功能特性

- ✅ **Speech Services Mock**
  - 语音转文字 (STT)
  - 文字转语音 (TTS)
  - 语音列表查询

- ✅ **OpenAI Services Mock**
  - Chat Completions API
  - 智能意图识别
  - 上下文感知响应

- ✅ **Communication Services Mock**
  - 电话连接管理
  - 通话状态模拟
  - Webhook事件模拟

### Mock API端点

```
Azure Mock Service (http://localhost:8080)
├── GET  /health                              # 健康检查
├── GET  /mock/status                         # Mock状态
├── POST /speech/stt                          # 语音转文字
├── POST /speech/tts                          # 文字转语音
├── GET  /speech/voices                       # 语音列表
├── POST /openai/chat/completions             # OpenAI聊天
├── POST /communication/calling/callConnections  # 创建通话
├── POST /mock/reset                          # 重置Mock
└── GET  /mock/stats                          # 统计信息
```

## 环境变量配置

### 必需环境变量

```bash
# 基础配置
NODE_ENV=test
LOG_LEVEL=warn

# 数据库配置
POSTGRES_URL=postgresql://postgres@localhost:5432/ai_ninja_test
REDIS_URL=redis://localhost:6379

# 认证配置
JWT_SECRET=test-jwt-secret-key-for-e2e-testing

# Azure Mock配置
AZURE_MOCK_MODE=true
AZURE_SPEECH_KEY=mock-key
AZURE_SPEECH_REGION=mock-region
AZURE_OPENAI_KEY=mock-key
AZURE_OPENAI_ENDPOINT=http://localhost:8080/openai
AZURE_COMMUNICATION_CONNECTION_STRING=mock://localhost:8080/communication
```

### 服务间通信配置

```bash
# 服务URL配置
USER_MANAGEMENT_URL=http://localhost:3005
SMART_WHITELIST_URL=http://localhost:3006
PHONE_GATEWAY_URL=http://localhost:3001
REALTIME_PROCESSOR_URL=http://localhost:3002
CONVERSATION_ENGINE_URL=http://localhost:3003
AZURE_MOCK_URL=http://localhost:8080
```

## 测试流程

### 1. 环境准备

```bash
# 检查系统依赖
node --version     # >= 18.0.0
npm --version      # >= 9.0.0
psql --version     # >= 12.0
redis-cli --version

# 检查服务状态
brew services list | grep -E "(postgresql|redis)"
```

### 2. 数据库初始化

```bash
# 创建测试数据库
createdb ai_ninja_test

# 运行初始化脚本
psql -d ai_ninja_test -f ./database/init/01-initialize-database.sql

# 清理Redis缓存
redis-cli flushall
```

### 3. 服务启动顺序

```bash
# 1. 启动Azure Mock (基础设施)
cd tests/mocks && npm install && npm start

# 2. 启动核心服务
cd services/user-management && npm install && npm run dev
cd services/smart-whitelist-node && npm install && npm run dev

# 3. 启动业务服务
cd services/conversation-engine-ts && npm install && npm run dev
cd services/realtime-processor && npm install && npm run dev
cd services/phone-gateway && npm install && npm run dev
```

### 4. 健康检查

```bash
# 运行服务健康检查
node quick-test-services.js

# 预期输出:
# ✅ Azure Mock - OK
# ✅ User Management - OK
# ✅ Smart Whitelist - OK
# ✅ Phone Gateway - OK
# ✅ Realtime Processor - OK
# ✅ Conversation Engine - OK
```

### 5. E2E测试执行

```bash
# 运行完整E2E测试套件
npm run test:e2e

# 运行特定测试
npm run test:e2e -- --grep "用户认证"
npm run test:e2e -- --grep "电话接入"
npm run test:e2e -- --grep "AI对话"
```

## 故障排除

### 常见问题

#### 1. Docker命令超时

```bash
# 重启Docker Desktop
osascript -e 'quit app "Docker"'
open -a Docker

# 或使用Colima替代
brew install colima
colima start --cpu 4 --memory 8
```

#### 2. 端口冲突

```bash
# 查找占用端口的进程
lsof -ti:3001

# 终止进程
kill $(lsof -ti:3001)
```

#### 3. 数据库连接失败

```bash
# 检查PostgreSQL状态
brew services list | grep postgresql

# 启动PostgreSQL
brew services start postgresql

# 检查连接
psql -h localhost -U postgres -d ai_ninja_test -c "SELECT 1"
```

#### 4. Redis连接失败

```bash
# 检查Redis状态
brew services list | grep redis

# 启动Redis
brew services start redis

# 检查连接
redis-cli ping
```

### 日志调试

```bash
# 查看服务日志
tail -f logs/user-management/*.log
tail -f logs/phone-gateway/*.log

# 查看数据库日志
tail -f /usr/local/var/log/postgresql@15.log

# 查看Redis日志
tail -f /usr/local/var/log/redis.log
```

## 性能基准

### 预期性能指标

```yaml
服务响应时间 (本地环境):
  - Azure Mock: < 100ms
  - User Management: < 200ms
  - Smart Whitelist: < 150ms
  - Phone Gateway: < 300ms
  - Realtime Processor: < 500ms
  - Conversation Engine: < 400ms

端到端流程:
  - 用户认证: < 500ms
  - 来电过滤: < 300ms
  - 电话接入: < 1000ms
  - AI响应生成: < 1500ms (Mock模式)
```

### 负载测试

```bash
# 安装artillery (可选)
npm install -g artillery

# 运行负载测试
artillery quick --count 10 --num 100 http://localhost:3001/health
```

## 下一步

1. **完善E2E测试用例**: 覆盖更多业务场景
2. **集成真实Azure服务**: 逐步替换Mock服务
3. **性能优化**: 基于测试结果优化服务性能
4. **CI/CD集成**: 将E2E测试集成到持续集成流程

## 支持

如有问题，请检查：

1. 📋 [服务选择分析](./service-selection-analysis.md)
2. 🔧 [Docker修复方案](./docker-fix-and-alternatives.md)
3. 🧪 [测试脚本](./quick-test-services.js)
4. 🔄 [环境清理脚本](./local-e2e-cleanup.sh)