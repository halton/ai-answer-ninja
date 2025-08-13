# CI/CD Pipeline Documentation

本文档描述了AI Answer Ninja项目的完整CI/CD流水线架构和配置。

## 概览

我们的CI/CD系统包含以下几个核心组件：

- **持续集成 (CI)**: 代码质量检查、安全扫描、单元测试
- **自动化测试**: 集成测试、端到端测试、性能测试、安全测试
- **暂存环境部署**: 自动部署到staging环境进行验证
- **生产环境部署**: 多种部署策略支持（滚动、金丝雀、蓝绿）
- **监控和告警**: 全面的系统监控和智能告警

## 工作流文件

### 1. ci.yml - 持续集成工作流

**触发条件**: 
- Push到main/develop分支
- Pull Request到main/develop分支
- 手动触发

**主要功能**:
- 代码质量分析（ESLint, Prettier, TypeScript）
- SonarQube代码扫描
- 单元测试和覆盖率报告
- 安全漏洞扫描（npm audit, Snyk, OWASP）
- CodeQL静态分析
- 构建验证
- 性能基准测试

**并行执行策略**: 
- 按微服务分组并行执行测试
- 独立的安全扫描流水线
- 构建验证支持多服务并行

### 2. test-automation.yml - 自动化测试工作流

**触发条件**:
- Push到main/develop分支
- Pull Request
- 每日定时执行
- 手动触发（支持选择测试套件）

**测试类型**:
- **集成测试**: 服务间集成验证
- **端到端测试**: 跨浏览器UI测试（Playwright）
- **性能测试**: K6负载测试 + Lighthouse CI
- **安全测试**: OWASP ZAP渗透测试
- **数据库测试**: 迁移和性能验证

**测试环境**: 
- PostgreSQL + Redis服务
- Docker化测试环境
- 多浏览器支持（Chromium, Firefox, WebKit）

### 3. cd-staging.yml - 暂存环境部署

**触发条件**:
- Push到develop分支
- 手动触发（支持服务选择）

**部署流程**:
1. **构建阶段**: 多架构Docker镜像构建和推送
2. **安全扫描**: 容器镜像安全扫描（Trivy, Snyk）
3. **预部署检查**: Kubernetes清单验证
4. **部署执行**: Helm图表部署到EKS集群
5. **烟雾测试**: 快速功能验证
6. **回滚机制**: 失败时自动回滚

**安全特性**:
- SBOM生成和上传
- 容器签名验证
- 漏洞扫描阈值控制

### 4. cd-production.yml - 生产环境部署

**触发条件**:
- Git标签发布（v*.*.* 格式）
- 手动触发（支持多种部署策略）

**部署策略**:
- **滚动部署**: 渐进式更新，零停机时间
- **金丝雀部署**: 流量逐步切换（10% → 50% → 100%）
- **蓝绿部署**: 完整环境切换

**安全检查**:
- 生产前置检查（staging健康状态、数据库兼容性）
- 安全合规验证
- 负载测试结果验证
- 容器镜像签名和SBOM

**监控集成**:
- 实时指标监控
- 自动回滚触发条件
- 部署状态追踪

## 部署脚本

### deploy.sh - 统一部署脚本

功能特性：
- 多环境支持（development/staging/production）
- 灵活的服务选择
- 多种部署策略
- 全面的健康检查
- 智能回滚机制
- 详细的日志输出

使用示例：
```bash
# 部署所有服务到staging环境
./scripts/deployment/deploy.sh --environment staging

# 金丝雀部署到生产环境
./scripts/deployment/deploy.sh --environment production --strategy canary

# 强制部署特定服务
./scripts/deployment/deploy.sh --environment staging --services phone-gateway,monitoring --force
```

## Docker配置

### docker-compose.test.yml - 测试环境

包含完整的测试服务栈：
- PostgreSQL 15 + Redis 7
- 4个核心微服务
- ML分类器Python服务
- Nginx API网关
- 完整的健康检查机制

### Nginx配置

- 负载均衡和反向代理
- WebSocket支持
- 压缩和缓存优化
- 详细的访问日志
- 健康检查端点

## 监控和告警

### Prometheus配置

**监控目标**:
- 所有微服务指标
- 数据库性能指标
- 系统资源使用
- Kubernetes集群状态
- 外部端点可用性

**关键指标**:
- 服务可用性（uptime）
- 响应时间分位数
- 错误率和成功率
- 业务指标（通话量、分类准确率）
- 资源使用率

### 告警规则

**告警分类**:
- **Critical**: 服务宕机、高错误率、安全事件
- **Warning**: 高延迟、资源使用率告警
- **Info**: 业务异常模式、趋势告警

**告警路由**:
- 按严重级别和环境路由
- 多渠道通知（Slack、邮件、Teams、PagerDuty）
- 智能抑制规则避免告警风暴

### Grafana仪表板

**核心面板**:
- 服务健康状态概览
- 实时通话量和处理延迟
- AI响应质量指标
- 数据库性能监控
- 安全事件追踪
- 资源使用趋势

## 环境要求

### 必要的GitHub Secrets

```
# Azure服务
AZURE_SPEECH_KEY
AZURE_SPEECH_KEY_TEST  
AZURE_OPENAI_KEY
AZURE_OPENAI_KEY_TEST

# AWS/Kubernetes
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY

# 容器注册表
GITHUB_TOKEN (自动提供)

# 安全扫描
SNYK_TOKEN
SONAR_TOKEN
SECURITY_SCAN_TOKEN

# 通知服务
SLACK_WEBHOOK_URL
MS_TEAMS_WEBHOOK_URL
PAGERDUTY_ROUTING_KEY

# 生产环境
PRODUCTION_API_KEY
PROD_DATABASE_URL_READ_ONLY
GRAFANA_API_KEY

# 监控
LHCI_GITHUB_APP_TOKEN
```

### 基础设施要求

**开发环境**:
- Docker和Docker Compose
- Node.js 20.x
- npm/yarn包管理器

**CI/CD环境**:
- GitHub Actions runners
- Docker支持
- 网络访问权限

**部署环境**:
- AWS EKS集群
- Helm 3.x
- kubectl客户端
- 容器镜像仓库访问

## 最佳实践

### 安全实践

1. **密钥管理**: 所有敏感信息使用GitHub Secrets
2. **权限控制**: 最小权限原则，环境隔离
3. **漏洞扫描**: 多层次安全扫描（代码、依赖、容器）
4. **审计日志**: 完整的部署和访问日志

### 性能优化

1. **并行执行**: 最大化CI/CD流水线并行度
2. **缓存策略**: Docker层缓存、依赖缓存
3. **增量构建**: 只构建变更的服务
4. **资源优化**: 合理的资源限制和请求

### 可靠性保证

1. **健康检查**: 多层次健康检查机制
2. **自动重试**: 临时失败的自动重试
3. **回滚策略**: 快速安全的回滚机制
4. **监控覆盖**: 全方位的监控和告警

### 开发工作流

1. **分支策略**: GitFlow分支模型
2. **代码审查**: 强制PR审查流程
3. **测试覆盖**: 高覆盖率的自动化测试
4. **文档更新**: 自动化文档生成和更新

## 故障排除

### 常见问题

**构建失败**:
- 检查依赖版本兼容性
- 验证环境变量配置
- 查看详细构建日志

**部署失败**:
- 检查Kubernetes集群状态
- 验证镜像可用性
- 确认网络连通性

**测试失败**:
- 检查测试环境状态
- 验证数据库迁移
- 查看服务健康状态

### 调试工具

- **GitHub Actions日志**: 详细的执行日志
- **Kubernetes仪表板**: 集群状态监控
- **Grafana监控**: 实时性能指标
- **日志聚合**: 集中化日志查看

## 更新和维护

定期维护任务：
- 更新依赖版本
- 审查安全漏洞
- 优化构建性能
- 更新监控规则

版本升级流程：
- 在staging环境测试
- 渐进式生产环境部署
- 监控和验证
- 文档更新

---

如需更详细的配置说明或遇到问题，请查看相应的配置文件或联系DevOps团队。