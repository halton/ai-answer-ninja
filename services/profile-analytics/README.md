# Profile Analytics Service

用户画像收集和管理系统，为AI Answer Ninja提供智能分析能力。

## 功能特性

### 核心功能
- 🎯 **来电者画像分析** - 智能识别和分类骚扰来电者
- 👤 **用户行为画像** - 分析用户响应模式和偏好
- 🤖 **机器学习预测** - 基于历史数据的智能预测
- ⚡ **实时更新机制** - 实时更新画像和分析结果
- 📊 **综合分析报告** - 生成详细的分析和趋势报告

### 技术特性
- **高性能缓存** - 多层缓存策略，毫秒级响应
- **批量数据处理** - 高效的批量分析流水线
- **可扩展架构** - 支持水平扩展和负载均衡
- **智能优化** - 自动调优和性能监控
- **容器化部署** - Docker和Kubernetes支持

## 快速开始

### 环境要求
- Python 3.9+
- PostgreSQL 12+
- Redis 6+
- 至少2GB内存

### 本地开发

1. **克隆代码并设置环境**
```bash
cd services/profile-analytics
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或 venv\Scripts\activate  # Windows
```

2. **安装依赖**
```bash
pip install -r requirements.txt
```

3. **配置环境变量**
```bash
cp .env.example .env
# 编辑.env文件，配置数据库和Redis连接
```

4. **启动服务**
```bash
# 使用启动脚本
./scripts/start.sh --dev

# 或直接运行
python main.py
```

### Docker部署

1. **使用Docker Compose**
```bash
# 启动完整环境（包括数据库和Redis）
docker-compose up -d

# 仅启动服务
docker-compose up profile-analytics
```

2. **查看日志**
```bash
docker-compose logs -f profile-analytics
```

### Kubernetes部署

```bash
# 应用配置
kubectl apply -f k8s-deployment.yaml

# 检查状态
kubectl get pods -n ai-ninja
kubectl logs -f deployment/profile-analytics -n ai-ninja
```

## API接口

### 健康检查
```bash
# 基础健康检查
curl http://localhost:3004/api/v1/health/

# 详细健康检查
curl http://localhost:3004/api/v1/health/detailed

# 就绪检查
curl http://localhost:3004/api/v1/health/readiness
```

### 画像分析
```bash
# 获取骚扰电话画像
curl http://localhost:3004/api/v1/profile/{phone_hash}

# 创建用户画像
curl -X POST http://localhost:3004/api/v1/profile/user \
  -H "Content-Type: application/json" \
  -d '{"user_id": "uuid", "personality_type": "polite"}'

# 实时分析
curl -X POST http://localhost:3004/api/v1/analytics/real-time \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "1234567890", "user_id": "uuid", "call_data": {}}'
```

### 综合分析
```bash
# 获取综合分析报告
curl -X POST http://localhost:3004/api/v1/analytics/comprehensive \
  -H "Content-Type: application/json" \
  -d '{"user_id": "uuid", "include_predictions": true}'

# 获取特征重要性
curl http://localhost:3004/api/v1/analytics/feature-importance
```

## 架构设计

### 系统架构
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   FastAPI App   │    │   ML Services    │    │  Cache Layer    │
│                 │    │                  │    │                 │
│ • REST APIs     │◄──►│ • Spam Classifier│◄──►│ • Redis Cache   │
│ • Health Checks │    │ • User Profiler  │    │ • Smart Caching │
│ • Monitoring    │    │ • Feature Engine │    │ • Optimization  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Database      │    │ Batch Processing │    │ Real-time Stream│
│                 │    │                  │    │                 │
│ • PostgreSQL    │    │ • Daily Analysis │    │ • Event Queue   │
│ • Partitioned   │    │ • Model Training │    │ • Live Updates  │
│ • Optimized     │    │ • Data Cleanup   │    │ • Notifications │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 数据流处理
```
来电数据 ──► 特征提取 ──► ML预测 ──► 画像更新 ──► 缓存同步
    │           │         │         │         │
    ▼           ▼         ▼         ▼         ▼
实时队列    特征工程   智能分类   数据库更新  API响应
```

## 机器学习模型

### 垃圾电话分类器
- **算法**: Ensemble (随机森林 + XGBoost + LightGBM)
- **特征**: 60+ 维度特征向量
- **性能**: F1-Score > 0.85, 准确率 > 0.90
- **更新**: 自动增量学习

### 用户画像分析
- **聚类算法**: K-means + DBSCAN
- **行为分析**: 时序模式识别
- **个性化**: 5种主要人格类型
- **效果评估**: 实时反馈优化

### 特征工程
```python
# 时间特征
- hour_of_day, day_of_week, is_business_hours
- cyclical_encoding (sin/cos transformation)

# 通话特征  
- duration, response_time, outcome
- conversation_patterns, termination_reasons

# 文本特征
- sentiment_analysis, keyword_matching
- TF-IDF vectors, linguistic_features

# 行为特征
- call_frequency, success_rate, user_feedback
- interaction_patterns, effectiveness_metrics
```

## 性能优化

### 缓存策略
- **多层缓存**: 内存缓存 + Redis分布式缓存
- **智能TTL**: 根据访问模式动态调整
- **预测缓存**: 基于访问模式的预加载
- **缓存命中率**: > 80% (生产环境)

### 数据库优化
- **分区表**: 按时间分区，提升查询性能60%
- **智能索引**: 覆盖索引和部分索引
- **读写分离**: 分析查询使用只读副本
- **连接池**: 优化的连接池配置

### API性能
- **响应时间**: P95 < 200ms
- **并发处理**: 支持1000+ QPS
- **背压处理**: 智能限流和降级
- **异步处理**: 全异步架构

## 监控与运维

### 关键指标
```yaml
业务指标:
  - 画像更新成功率: > 99%
  - ML预测准确率: > 85%
  - 实时分析延迟: < 500ms
  - 缓存命中率: > 80%

技术指标:
  - API响应时间: P95 < 200ms
  - 错误率: < 0.1%
  - 内存使用: < 2GB per instance
  - CPU使用: < 70% average
```

### 日志和追踪
- **结构化日志**: JSON格式，便于检索
- **链路追踪**: OpenTelemetry集成
- **错误监控**: 自动错误聚合和告警
- **性能分析**: 详细的性能指标

### 告警配置
- **服务异常**: 响应时间 > 1s, 错误率 > 1%
- **资源告警**: CPU > 80%, 内存 > 1.5GB
- **业务告警**: 预测准确率下降 > 10%
- **依赖告警**: 数据库/Redis连接失败

## 开发指南

### 代码结构
```
profile-analytics/
├── app/                    # 应用代码
│   ├── api/               # API路由
│   ├── core/              # 核心组件
│   ├── models/            # 数据模型
│   ├── services/          # 业务服务
│   └── middleware/        # 中间件
├── ml/                    # 机器学习
│   ├── models/            # ML模型
│   ├── features/          # 特征工程
│   └── pipelines/         # 数据流水线
├── tests/                 # 测试代码
├── scripts/               # 脚本工具
└── config/               # 配置文件
```

### 开发工作流
1. **创建特性分支**: `git checkout -b feature/new-feature`
2. **开发和测试**: 编写代码和单元测试
3. **代码检查**: `black .`, `flake8 .`, `mypy .`
4. **运行测试**: `pytest tests/`
5. **提交代码**: 遵循commit message规范
6. **创建PR**: 代码审查和CI检查

### 测试策略
```bash
# 运行所有测试
pytest

# 单元测试
pytest tests/unit/

# 集成测试
pytest tests/integration/

# 性能测试
pytest tests/performance/ --benchmark-only

# 覆盖率报告
pytest --cov=app --cov-report=html
```

## 部署和扩展

### 水平扩展
- **无状态设计**: 支持多实例部署
- **负载均衡**: 智能请求分发
- **自动扩缩容**: 基于CPU/内存/QPS
- **数据分片**: 支持数据库分片

### 容量规划
```yaml
单实例性能:
  - QPS: 1000 requests/second
  - 内存: 1-2GB RAM
  - CPU: 1-2 cores
  - 存储: 50GB+ (模型和数据)

集群推荐:
  - 生产环境: 3-5个实例
  - 高可用: 跨AZ部署
  - 数据库: 主从复制 + 读写分离
  - 缓存: Redis集群模式
```

### 灾难恢复
- **数据备份**: 自动化数据库备份
- **模型备份**: ML模型版本管理
- **快速恢复**: 5分钟内服务恢复
- **故障转移**: 自动故障检测和切换

## 故障排除

### 常见问题

**1. 服务启动失败**
```bash
# 检查依赖服务
docker-compose ps
curl http://localhost:5432  # PostgreSQL
redis-cli ping             # Redis

# 检查配置
cat .env | grep -E "DATABASE_URL|REDIS_URL"
```

**2. ML模型预测失败**
```bash
# 检查模型文件
ls -la ml/models/
python -c "from ml.models.spam_classifier import SpamClassifier; c=SpamClassifier(); print('Models OK')"

# 重新训练模型
curl -X POST http://localhost:3004/api/v1/ml/retrain
```

**3. 性能问题**
```bash
# 检查资源使用
docker stats profile-analytics
htop

# 检查缓存命中率
curl http://localhost:3004/api/v1/health/metrics | jq '.cache_metrics'

# 查看慢查询
tail -f logs/app.log | grep "slow_query"
```

**4. 数据库连接问题**
```bash
# 测试数据库连接
python -c "
import asyncio
from app.core.database import DatabaseHealthCheck
print(asyncio.run(DatabaseHealthCheck.check_connection()))
"

# 检查连接池状态
curl http://localhost:3004/api/v1/health/detailed | jq '.dependencies.database'
```

### 日志分析
```bash
# 查看应用日志
docker-compose logs -f profile-analytics

# 查看错误日志
grep ERROR logs/app.log | tail -20

# 分析性能日志
grep "request_duration" logs/app.log | awk '{print $5}' | sort -n
```

## 贡献指南

### 提交规范
```
feat: 新功能
fix: 错误修复
docs: 文档更新
style: 代码格式
refactor: 重构
perf: 性能优化
test: 测试相关
chore: 构建/工具链
```

### 代码标准
- **Python Style**: PEP 8 + Black formatter
- **Type Hints**: 强制使用类型注解
- **Documentation**: 完整的docstring
- **Testing**: 90%+ 代码覆盖率

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 联系方式

- **项目主页**: https://github.com/ai-answer-ninja/profile-analytics
- **问题反馈**: GitHub Issues
- **技术讨论**: GitHub Discussions