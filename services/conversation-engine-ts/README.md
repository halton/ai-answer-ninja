# Conversation Engine TypeScript Service

AI驱动的对话引擎服务，专为处理骚扰电话而设计。提供智能意图识别、情感分析和个性化响应生成功能。

## 功能特性

### 🧠 智能意图识别
- **多层次分类算法**：融合关键词、语义和上下文分析
- **支持意图类型**：销售推广、贷款推销、投资理财、保险销售、调查访问、诈骗识别
- **高准确率**：置信度评分和备选意图推荐

### 💭 情感分析引擎
- **实时情感检测**：分析来电者的情感状态和强度
- **情感升级检测**：识别对话中的情感变化趋势
- **多维度分析**：情感效价、唤醒度和置信度评估

### 🎭 个性化响应生成
- **用户画像驱动**：基于个性类型生成符合用户特征的回复
- **Azure OpenAI集成**：利用GPT-4生成自然流畅的对话
- **响应模板系统**：预定义模板与AI生成相结合
- **多种个性支持**：礼貌型、直接型、幽默型、专业型、友好型

### 📝 对话上下文管理
- **状态跟踪**：完整的对话状态机管理
- **历史记录**：对话轮次和内容的持久化存储
- **智能终止**：基于多种策略的对话结束判断

### ⚡ 高性能架构
- **多级缓存**：内存缓存 + Redis缓存优化响应速度
- **并行处理**：意图识别和情感分析并行执行
- **预测缓存**：常见场景的预计算响应

## 技术栈

- **运行时**：Node.js 18+ / TypeScript 5.2+
- **Web框架**：Express.js
- **AI服务**：Azure OpenAI GPT-4
- **数据库**：PostgreSQL (对话数据) + Redis (缓存)
- **自然语言处理**：Natural.js, Sentiment.js
- **容器化**：Docker + Docker Compose

## 快速开始

### 环境要求
- Node.js 18+
- Docker & Docker Compose
- Azure OpenAI 服务账户

### 1. 环境配置
```bash
# 复制环境变量模板
cp .env.example .env

# 编辑环境变量
vim .env
```

必需的环境变量：
```env
# Azure OpenAI 配置
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4

# 数据库配置
DATABASE_URL=postgresql://postgres:password@localhost:5432/ai_ninja
REDIS_URL=redis://localhost:6379
```

### 2. 开发环境启动
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 或使用 Docker Compose
docker-compose up -d
```

### 3. 生产环境部署
```bash
# 构建生产镜像
docker-compose -f docker-compose.yml up -d

# 或使用单独构建
npm run build
npm start
```

## API 接口

### 对话处理
```http
POST /api/v1/conversation/process
Content-Type: application/json

{
  "callId": "call_123456",
  "userInput": "我想了解一下你们的理财产品",
  "metadata": {
    "userId": "user_789",
    "callerPhone": "+86138****1234",
    "sessionId": "session_abc"
  }
}
```

响应：
```json
{
  "success": true,
  "data": {
    "callId": "call_123456",
    "response": {
      "text": "谢谢您的介绍，但我现在不考虑理财产品。",
      "confidence": 0.89,
      "shouldTerminate": false,
      "nextStage": "polite_decline",
      "emotion": "polite",
      "metadata": {
        "strategy": "gentle_decline",
        "generationLatency": 245,
        "cacheHit": false
      }
    }
  }
}
```

### 对话统计
```http
GET /api/v1/conversation/{callId}/stats
```

### 批量处理
```http
POST /api/v1/conversation/batch
Content-Type: application/json

{
  "conversations": [
    {
      "callId": "call_001",
      "userInput": "了解贷款产品",
      "metadata": {}
    }
  ]
}
```

### 健康检查
```http
GET /health                 # 基础健康检查
GET /health/detailed        # 详细健康检查
GET /health/liveness        # Kubernetes 存活检查
GET /health/readiness       # Kubernetes 就绪检查
```

## 配置说明

### 性能配置
```env
MAX_CONVERSATION_TURNS=10          # 最大对话轮次
MAX_RESPONSE_LENGTH=200            # 最大响应长度
INTENT_CONFIDENCE_THRESHOLD=0.7    # 意图识别置信度阈值
CACHE_TTL=3600                     # 缓存生存时间(秒)
RESPONSE_CACHE_TTL=1800           # 响应缓存时间(秒)
```

### 个性化配置
支持的个性类型：
- `polite` - 礼貌型：温和友善，即使拒绝也很客气
- `direct` - 直接型：直截了当，不喜欢拐弯抹角
- `humorous` - 幽默型：善用幽默化解尴尬
- `professional` - 专业型：正式规范的交流方式
- `friendly` - 友好型：热情友好但知道设置界限

### 意图分类
支持的骚扰电话类型：
- `sales_call` - 销售推广
- `loan_offer` - 贷款推销
- `investment_pitch` - 投资理财
- `insurance_sales` - 保险销售
- `survey_request` - 调查访问
- `scam_attempt` - 诈骗嫌疑
- `legitimate_call` - 正当来电

## 监控和日志

### 健康监控
- 服务自身状态
- Azure OpenAI 连接状态
- Redis 缓存状态
- PostgreSQL 数据库状态
- 内存和磁盘使用情况

### 性能指标
- 响应生成延迟
- 意图识别准确率
- 缓存命中率
- 对话成功终止率

### 日志级别
```env
LOG_LEVEL=info              # debug, info, warn, error
LOG_FORMAT=json             # json, simple
ENABLE_REQUEST_LOGGING=true # 启用请求日志
```

## 开发指南

### 项目结构
```
src/
├── analysis/           # 情感分析模块
├── config/            # 配置管理
├── context/           # 对话上下文管理
├── controllers/       # HTTP 控制器
├── engine/            # 对话引擎核心
├── intent/            # 意图识别模块
├── response/          # 响应生成模块
├── routes/            # 路由配置
├── types/             # TypeScript 类型定义
├── utils/             # 工具函数
└── server.ts          # 主服务器文件
```

### 扩展新的意图类型
1. 在 `types/index.ts` 中添加新的 `IntentCategory`
2. 在 `IntentClassifier.ts` 中添加关键词模式
3. 在 `ResponseGenerator.ts` 中添加相应的响应模板

### 添加新的个性类型
1. 在 `types/index.ts` 中扩展 `PersonalityType`
2. 在 `ResponseGenerator.ts` 中添加个性化策略
3. 更新响应模板支持新个性

### 测试
```bash
# 运行单元测试
npm test

# 运行测试覆盖率
npm run test:coverage

# 运行 ESLint
npm run lint
```

## 性能优化

### 响应时间优化
- **并行处理**：意图识别和情感分析并行执行
- **智能缓存**：常见场景预计算缓存
- **模板优先**：简单场景使用模板避免AI调用
- **连接池**：数据库和Redis连接复用

### 内存优化
- **内存缓存限制**：防止内存泄漏
- **定期清理**：过期数据自动清理
- **分页查询**：大数据量分页处理

### 并发处理
- **速率限制**：防止API滥用
- **熔断机制**：外部服务故障时的降级处理
- **资源限制**：Docker容器资源限制

## 部署指南

### Docker 部署
```bash
# 单服务部署
docker build -t conversation-engine .
docker run -p 3003:3003 conversation-engine

# 完整环境部署
docker-compose up -d
```

### Kubernetes 部署
```yaml
# k8s-deployment.yaml 示例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: conversation-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: conversation-engine
  template:
    metadata:
      labels:
        app: conversation-engine
    spec:
      containers:
      - name: conversation-engine
        image: ai-ninja/conversation-engine:latest
        ports:
        - containerPort: 3003
        env:
        - name: NODE_ENV
          value: "production"
        resources:
          limits:
            memory: "1Gi"
            cpu: "500m"
          requests:
            memory: "512Mi"
            cpu: "250m"
        livenessProbe:
          httpGet:
            path: /health/liveness
            port: 3003
          initialDelaySeconds: 60
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health/readiness
            port: 3003
          initialDelaySeconds: 30
          periodSeconds: 10
```

### 环境变量管理
生产环境建议使用：
- Kubernetes Secrets
- HashiCorp Vault
- Azure Key Vault
- 环境变量加密

## 故障排除

### 常见问题

1. **Azure OpenAI 连接失败**
   - 检查 API 密钥和端点配置
   - 验证网络连接和防火墙设置
   - 确认部署模型名称正确

2. **响应延迟过高**
   - 检查 Redis 缓存状态
   - 监控 Azure OpenAI 响应时间
   - 调整并发处理参数

3. **内存使用过高**
   - 检查缓存大小设置
   - 监控对话上下文数量
   - 调整垃圾回收参数

### 日志分析
```bash
# 查看服务日志
docker-compose logs -f conversation-engine

# 过滤错误日志
docker-compose logs conversation-engine | grep ERROR

# 性能日志分析
docker-compose logs conversation-engine | grep "performance"
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 联系方式

- 项目主页：https://github.com/ai-answer-ninja/conversation-engine
- 问题反馈：https://github.com/ai-answer-ninja/conversation-engine/issues
- 邮箱：dev@ai-answer-ninja.com

---

**注意**：本服务需要 Azure OpenAI 服务支持，请确保已正确配置相关服务和API密钥。