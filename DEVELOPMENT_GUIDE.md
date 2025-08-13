# AI Answer Ninja - 并行开发指南

## 🚀 快速启动

### 一键部署 (推荐)
```bash
# 克隆项目后，直接运行部署脚本
./scripts/deploy.sh

# 或者分步执行
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### 手动启动
```bash
# 1. 安装依赖 (并行)
npm run install:all

# 2. 启动基础设施
docker-compose up -d postgres redis

# 3. 数据库迁移
npm run db:migrate

# 4. 启动所有服务
docker-compose up -d

# 5. 启动前端开发服务器
cd frontend/admin-panel && npm run dev
```

## 📁 项目结构

```
ai-answer-ninja/
├── services/                 # 微服务目录
│   ├── phone-gateway/        # 电话网关 (3001)
│   ├── realtime-processor/   # 实时处理 (3002)
│   ├── conversation-engine/  # 对话引擎 (3003)
│   ├── profile-analytics/    # 画像分析 (3004)
│   ├── user-management/      # 用户管理 (3005)
│   ├── smart-whitelist-node/ # 智能白名单 (3006)
│   ├── configuration-service/# 配置管理 (3007)
│   ├── storage/              # 存储服务 (3008)
│   └── monitoring/           # 监控服务 (3009)
├── frontend/admin-panel/     # 管理面板
├── shared/                   # 共享模块
│   ├── security/            # 安全模块
│   ├── database/            # 数据库工具
│   └── cache/               # 缓存工具
├── database/                # 数据库脚本
│   ├── migrations/          # 迁移脚本
│   └── seeds/               # 种子数据
├── infrastructure/          # 基础设施配置
│   ├── api-gateway/         # API网关
│   └── kubernetes/          # K8s配置
└── tests/                   # 测试套件
    ├── unit/                # 单元测试
    ├── integration/         # 集成测试
    └── e2e/                 # 端到端测试
```

## 🛠️ 开发工具链

### 必需工具
- **Node.js** 18+ (推荐使用 nvm)
- **Docker** & **Docker Compose**
- **PostgreSQL** 14+ (本地开发可用Docker)
- **Redis** 6+ (本地开发可用Docker)

### 推荐工具
- **VS Code** + TypeScript插件
- **Postman** (API测试)
- **Redis Desktop Manager** (Redis管理)
- **pgAdmin** (PostgreSQL管理)

## 🏗️ 架构概述

### 微服务架构
采用分层微服务架构，共9个核心服务：

#### 核心业务服务 (Core Services)
1. **Phone Gateway Service** - 电话接入、智能路由
2. **Real-time Processor Service** - 实时音频处理、STT/TTS
3. **Conversation Engine Service** - 对话管理、情感分析
4. **Profile Analytics Service** - 用户画像、通话分析

#### 支撑服务 (Support Services)
5. **User Management Service** - 用户认证、权限管理
6. **Smart Whitelist Service** - 智能白名单、风险评估

#### 平台服务 (Platform Services)
7. **Configuration Service** - 配置管理、功能开关
8. **Storage Service** - 文件存储、音频管理
9. **Monitoring Service** - 系统监控、性能分析

### 数据层
- **PostgreSQL** - 主数据库 (分区表优化)
- **Redis** - 缓存层 (多级缓存)
- **Azure Blob Storage** - 音频文件存储

### 外部服务集成
- **Azure Communication Services** - 电话系统
- **Azure Speech Services** - STT/TTS
- **Azure OpenAI** - 对话AI
- **Azure Storage** - 文件存储

## 📊 性能目标

### MVP阶段目标 (< 1500ms)
- 音频预处理: < 80ms
- 语音识别: < 350ms
- AI响应生成: < 450ms
- 语音合成: < 300ms
- 网络传输: < 150ms

### 优化阶段目标 (< 1000ms)
通过预测缓存、流式处理等优化技术达成

### 生产阶段目标 (< 800ms)
通过边缘计算、硬件加速等技术达成

## 🧪 测试策略

### 测试分层
```bash
# 运行所有测试
npm test

# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# 端到端测试
npm run test:e2e

# 性能测试
npm run test:performance
```

### 测试覆盖率目标
- **单元测试**: > 80%
- **集成测试**: > 70%
- **E2E测试**: 核心业务流程100%覆盖

## 🔒 安全考虑

### 数据保护
- **端到端加密** - 语音数据AES-256加密
- **传输安全** - TLS 1.3
- **存储安全** - 静态数据加密

### 访问控制
- **多因素认证** (MFA)
- **基于角色的权限控制** (RBAC)
- **API速率限制**

### 合规性
- **GDPR** 合规
- **数据最小化** 原则
- **审计日志** 完整记录

## 🚀 部署方案

### 开发环境
```bash
# 使用 Docker Compose
docker-compose up -d
```

### 生产环境
```bash
# 使用生产配置
docker-compose -f docker-compose.production.yml up -d

# 或者使用 Kubernetes
kubectl apply -f infrastructure/kubernetes/
```

## 📈 监控告警

### 关键指标
- **响应延迟** - P95 < 目标值
- **错误率** - < 1%
- **可用性** - > 99.9%
- **资源使用率** - CPU < 70%, 内存 < 80%

### 监控工具
- **Prometheus** - 指标收集
- **Grafana** - 仪表板可视化
- **Jaeger** - 分布式追踪
- **ELK Stack** - 日志分析

## 🔄 CI/CD流程

### 持续集成
```yaml
# GitHub Actions workflow
name: CI/CD Pipeline
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test
  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Build Docker images
        run: docker-compose build
```

### 部署策略
- **蓝绿部署** - 零停机部署
- **金丝雀发布** - 渐进式发布
- **回滚机制** - 快速故障恢复

## 📝 开发工作流

### 分支策略
```bash
# 主分支
main                 # 生产环境代码
develop             # 开发环境代码

# 功能分支
feature/user-auth   # 用户认证功能
feature/ai-dialog   # AI对话功能
hotfix/security-fix # 紧急安全修复
```

### 提交规范
```bash
# 提交格式
feat: 添加用户认证功能
fix: 修复语音识别延迟问题
docs: 更新API文档
test: 添加单元测试
refactor: 重构对话引擎
```

## 🛟 故障排查

### 常见问题

#### 服务无法启动
```bash
# 检查服务状态
docker-compose ps

# 查看服务日志
docker-compose logs [service-name]

# 重启服务
docker-compose restart [service-name]
```

#### 数据库连接问题
```bash
# 检查数据库状态
docker-compose exec postgres pg_isready

# 查看数据库日志
docker-compose logs postgres

# 重新初始化数据库
npm run db:reset
```

#### 性能问题
```bash
# 检查系统资源使用
docker stats

# 查看应用性能指标
curl http://localhost:3009/metrics

# 分析慢查询
docker-compose exec postgres pg_stat_statements
```

### 调试技巧
1. **使用调试端口** - 每个服务都暴露调试端口
2. **查看详细日志** - 设置LOG_LEVEL=debug
3. **使用性能分析工具** - 集成Node.js Profiler
4. **监控数据库查询** - 启用查询日志

## 📞 技术支持

### 文档资源
- [API文档](./API_DOCUMENTATION.md)
- [架构设计](./CLAUDE.md)
- [部署指南](./DEPLOYMENT-GUIDE.md)

### 社区支持
- **GitHub Issues** - 问题报告和功能请求
- **技术博客** - 最佳实践分享
- **代码审查** - 团队协作

---

*最后更新: 2025-08-13*
*作者: Claude AI Assistant*