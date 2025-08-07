# Conversation Analyzer Service

通话内容分析和总结服务，提供实时和批量的通话分析功能。

## 功能特性

### 核心分析功能
- **语音转文字**: 集成Azure Speech Services进行高精度转录
- **内容智能分析**: 意图识别、情感分析、关键信息提取
- **通话效果评估**: AI响应质量评估、用户满意度分析
- **智能总结生成**: 通话摘要、关键事件、处理建议

### 技术特性
- **实时处理**: 支持流式音频分析和实时反馈
- **批量处理**: 异步队列处理历史通话数据
- **多级缓存**: Redis缓存 + 内存缓存优化性能
- **机器学习**: 基于spaCy和transformers的NLP流水线

## 架构设计

```
conversation-analyzer/
├── app/
│   ├── api/v1/          # REST API endpoints
│   ├── core/            # 核心配置和基础服务
│   ├── models/          # 数据模型
│   ├── services/        # 业务服务层
│   ├── pipelines/       # 分析流水线
│   └── middleware/      # 中间件
├── ml/
│   ├── models/          # ML模型
│   ├── processors/      # 数据预处理器
│   └── analyzers/       # 分析器
├── config/              # 配置文件
└── tests/               # 测试用例
```

## API 接口

### 分析接口
- `POST /api/v1/analysis/transcribe` - 音频转录
- `POST /api/v1/analysis/content` - 内容分析
- `POST /api/v1/analysis/effectiveness` - 效果评估
- `POST /api/v1/analysis/summary` - 生成总结

### 查询接口
- `GET /api/v1/results/{call_id}` - 获取分析结果
- `GET /api/v1/reports/summary/{user_id}` - 用户分析报告
- `GET /api/v1/metrics/performance` - 性能指标

### 批量处理
- `POST /api/v1/batch/analyze` - 批量分析任务
- `GET /api/v1/batch/status/{task_id}` - 任务状态查询

## 环境变量

```env
# Azure Services
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=your_region
AZURE_OPENAI_ENDPOINT=your_openai_endpoint
AZURE_OPENAI_API_KEY=your_api_key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_ninja
REDIS_URL=redis://localhost:6379

# Service Configuration
SERVICE_PORT=3010
SERVICE_NAME=conversation-analyzer
LOG_LEVEL=INFO

# ML Models
HUGGINGFACE_CACHE_DIR=/app/cache/huggingface
SPACY_MODEL=zh_core_web_sm
```

## 性能目标

- 音频转录延迟: < 300ms (实时流)
- 内容分析延迟: < 200ms 
- 总结生成延迟: < 500ms
- 批量处理吞吐: > 100 calls/min
- 缓存命中率: > 80%

## 部署

### Docker部署
```bash
cd /Users/halton/work/ai-answer-ninja/services/conversation-analyzer
docker build -t conversation-analyzer .
docker run -p 3010:3010 conversation-analyzer
```

### Kubernetes部署
```bash
kubectl apply -f k8s-deployment.yaml
```

## 依赖服务

- **PostgreSQL**: 分析结果存储
- **Redis**: 缓存和消息队列
- **Azure Speech Services**: 语音转录
- **Azure OpenAI**: AI分析和总结
- **profile-analytics**: 用户画像服务
- **realtime-processor**: 实时处理服务