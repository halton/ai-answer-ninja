# 存储服务 (Storage Service)

统一存储管理服务，提供文件存储、音频处理、数据归档和生命周期管理功能。

## 功能特性

### 🗂️ 文件存储管理
- **单文件上传**: 支持各种文件类型的安全上传
- **分块上传**: 大文件分块上传，支持断点续传
- **多格式支持**: 音频、图片、视频、文档等多种格式
- **智能压缩**: 自动检测并压缩适合的文件类型
- **端到端加密**: 敏感文件自动加密存储

### 🎵 音频专用处理
- **格式转换**: MP3、WAV、Opus、M4A之间互转
- **音质优化**: 音频标准化、降噪处理
- **波形生成**: 自动生成音频波形图
- **片段提取**: 精确提取音频片段
- **元数据提取**: 自动提取音频时长、采样率等信息

### ☁️ Azure云集成
- **Blob存储**: 集成Azure Blob Storage
- **多层存储**: 热存储、冷存储、归档存储自动切换
- **CDN加速**: 支持Azure CDN内容分发
- **全球分布**: 支持多区域部署

### 🔄 数据生命周期管理
- **自动归档**: 基于访问频率和文件年龄的智能归档
- **存储优化**: 自动迁移到最经济的存储层级
- **定时清理**: 定期清理过期和临时文件
- **成本控制**: 显著降低存储成本

### 🚀 性能优化
- **多级缓存**: Redis缓存 + CDN加速
- **并行处理**: 支持并发上传和处理
- **智能压缩**: 根据文件类型智能选择压缩算法
- **网络优化**: 自适应传输优化

## 快速开始

### 环境要求

- Node.js 18+
- TypeScript 5+
- Redis 6+
- Azure Storage Account
- FFmpeg (音频处理)

### 安装和配置

1. **安装依赖**
```bash
cd services/storage
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，配置Azure和Redis连接信息
```

3. **编译和启动**
```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

### Docker部署

```yaml
# docker-compose.yml
version: '3.8'
services:
  storage-service:
    build: .
    ports:
      - "3008:3008"
    environment:
      - AZURE_STORAGE_CONNECTION_STRING=${AZURE_STORAGE_CONNECTION_STRING}
      - REDIS_HOST=redis
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

## API使用指南

### 认证

所有API请求都需要在请求头中包含用户ID：

```http
X-User-ID: your-user-id
```

### 1. 文件上传

#### 单文件上传
```http
POST /api/v1/storage/upload
Content-Type: multipart/form-data

{
  "file": <文件数据>,
  "filename": "document.pdf",
  "fileType": "document",
  "storageTier": "hot",
  "encrypt": true,
  "compress": true,
  "tags": ["important", "contract"]
}
```

#### 分块上传（大文件）
```bash
# 1. 初始化分块上传
curl -X POST /api/v1/storage/upload/multipart/init \
  -H "X-User-ID: user123" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "large-video.mp4",
    "totalSize": 1073741824,
    "chunkSize": 10485760,
    "mimeType": "video/mp4"
  }'

# 2. 上传分块
curl -X POST /api/v1/storage/upload/multipart/{uploadId}/chunk/0 \
  -H "X-User-ID: user123" \
  -F "chunk=@chunk-0.bin"

# 3. 完成上传
curl -X POST /api/v1/storage/upload/multipart/{uploadId}/complete \
  -H "X-User-ID: user123" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "large-video.mp4",
    "mimeType": "video/mp4"
  }'
```

### 2. 音频处理

#### 音频上传与处理
```http
POST /api/v1/storage/upload/audio
Content-Type: multipart/form-data

{
  "audio": <音频文件>,
  "filename": "recording.wav",
  "callId": "call-123",
  "language": "zh-CN",
  "targetFormat": "mp3",
  "targetBitrate": 128,
  "normalizeAudio": true,
  "generateWaveform": true
}
```

#### 获取音频波形
```http
GET /api/v1/storage/audio/{fileId}/waveform
X-User-ID: user123

# 返回PNG格式的波形图
```

#### 提取音频片段
```http
POST /api/v1/storage/audio/{fileId}/extract
X-User-ID: user123
Content-Type: application/json

{
  "startTime": 30.5,
  "duration": 60.0
}
```

#### 转换音频格式
```http
POST /api/v1/storage/audio/{fileId}/convert
X-User-ID: user123
Content-Type: application/json

{
  "targetFormat": "opus",
  "bitrate": 96,
  "quality": "high"
}
```

### 3. 文件管理

#### 搜索文件
```http
GET /api/v1/storage/files/search?fileType=audio&storageTier=hot&page=1&limit=20
X-User-ID: user123
```

#### 下载文件
```http
GET /api/v1/storage/download/{fileId}
X-User-ID: user123

# 支持HTTP缓存和ETag
```

#### 生成临时访问URL
```http
POST /api/v1/storage/files/{fileId}/access-url
X-User-ID: user123
Content-Type: application/json

{
  "expirationMinutes": 60
}
```

#### 更改存储层级
```http
PATCH /api/v1/storage/files/{fileId}/tier
X-User-ID: user123
Content-Type: application/json

{
  "tier": "cool"
}
```

### 4. 数据归档

#### 获取存储统计
```http
GET /api/v1/storage/stats
X-User-ID: user123
```

#### 执行归档任务
```http
POST /api/v1/storage/archive/execute/old_audio_archive
X-User-ID: user123
Content-Type: application/json

{
  "dryRun": false
}
```

#### 查看归档规则
```http
GET /api/v1/storage/archive/rules
X-User-ID: user123
```

## 架构设计

### 服务架构
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │────│  Storage API    │────│  File Service   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Audio Service   │    │ Archive Service │
                       └─────────────────┘    └─────────────────┘
                                │                       │
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Azure Blob      │    │ Redis Cache     │
                       │ Storage         │    │                 │
                       └─────────────────┘    └─────────────────┘
```

### 存储层级策略
```yaml
热存储 (Hot):
  - 最近上传的文件 (30天内)
  - 频繁访问的文件
  - 成本: 高访问速度，较高存储成本

冷存储 (Cool):
  - 中等访问频率的文件 (30-90天)
  - 偶尔访问的备份文件
  - 成本: 中等访问速度，中等存储成本

归档存储 (Archive):
  - 长期存储的文件 (90天+)
  - 很少访问的历史数据
  - 成本: 较慢访问速度，最低存储成本
```

### 数据生命周期
```
上传 → 热存储 → (30天) → 冷存储 → (90天) → 归档存储
  ↓        ↓                ↓                ↓
压缩    智能压缩         额外压缩           长期保存
加密    访问统计         成本优化           合规性
```

## 配置说明

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `AZURE_STORAGE_CONNECTION_STRING` | Azure存储连接字符串 | 必须 |
| `AZURE_STORAGE_CONTAINER` | 容器名称 | ai-answer-ninja-storage |
| `AZURE_CDN_ENDPOINT` | CDN端点 | 可选 |
| `REDIS_HOST` | Redis主机地址 | localhost |
| `REDIS_PORT` | Redis端口 | 6379 |
| `PORT` | 服务端口 | 3008 |
| `MAX_FILE_SIZE` | 最大文件大小 | 500MB |
| `ENABLE_COMPRESSION` | 启用压缩 | true |
| `ENABLE_ENCRYPTION` | 启用加密 | true |

### 归档策略配置

```javascript
// 默认归档策略
const archivePolicies = [
  {
    name: 'old_audio_archive',
    schedule: '0 2 * * 0', // 每周日凌晨2点
    conditions: {
      fileAge: 30,      // 30天前的文件
      fileTypes: ['audio'],
      sizeLargerThan: 10 * 1024 * 1024 // 大于10MB
    },
    actions: {
      moveToTier: 'archive',
      compress: true,
      encrypt: true
    }
  }
];
```

## 性能优化

### 缓存策略
- **L1缓存**: 应用内存缓存 (文件元数据)
- **L2缓存**: Redis缓存 (用户数据、访问统计)
- **L3缓存**: CDN缓存 (静态资源、公共文件)

### 上传优化
- **分块上传**: 大文件自动分块，支持并发上传
- **断点续传**: 网络中断后可继续上传
- **智能压缩**: 根据文件类型选择最优压缩算法
- **预处理**: 上传前进行格式验证和预处理

### 下载优化
- **CDN分发**: 全球内容分发网络加速
- **HTTP缓存**: 支持ETag和条件请求
- **范围请求**: 支持部分内容下载
- **并发下载**: 支持多线程下载

## 监控和运维

### 健康检查
```http
GET /health
```

### 关键指标
- 上传成功率
- 下载响应时间
- 存储使用量
- 归档任务执行状态
- 错误率和异常监控

### 日志管理
- 结构化日志记录
- 错误堆栈跟踪
- 性能指标采集
- 安全事件记录

## 安全特性

### 数据保护
- **端到端加密**: AES-256-GCM加密算法
- **传输安全**: HTTPS/TLS 1.3
- **访问控制**: 基于用户的权限验证
- **数据完整性**: SHA-256校验和验证

### 合规性
- **GDPR合规**: 支持数据删除和导出
- **数据定位**: 支持数据本地化存储
- **审计日志**: 完整的操作审计记录
- **隐私保护**: 敏感数据自动脱敏

## 成本优化

### 存储成本
- **智能分层**: 自动迁移到最经济的存储层级
- **压缩优化**: 最高可节省30-50%存储空间
- **生命周期管理**: 自动清理过期数据

### 网络成本
- **CDN优化**: 减少源站流量
- **区域优化**: 就近存储访问
- **传输优化**: 智能压缩传输数据

### 预估成本节省
- 存储成本: 40-60%
- 网络成本: 30-40%
- 运维成本: 50-70%

## 故障排除

### 常见问题

#### 上传失败
```bash
# 检查文件大小限制
Error: File size exceeds maximum limit

# 检查网络连接
Error: Network timeout

# 检查Azure连接
Error: Azure Storage connection failed
```

#### 音频处理失败
```bash
# 检查FFmpeg安装
Error: FFmpeg not found

# 检查音频格式支持
Error: Unsupported audio format

# 检查处理超时
Error: Audio processing timeout
```

#### 缓存问题
```bash
# 检查Redis连接
Error: Redis connection refused

# 清理缓存
npm run cache:clear
```

### 性能调优

#### 上传性能
- 调整分块大小
- 启用并发上传
- 优化网络配置

#### 存储性能
- 选择合适的存储层级
- 启用CDN加速
- 优化访问模式

## 开发指南

### 项目结构
```
services/storage/
├── src/
│   ├── api/           # API路由和中间件
│   ├── services/      # 核心业务服务
│   ├── azure/         # Azure集成
│   ├── cleanup/       # 数据归档服务
│   ├── utils/         # 工具类
│   ├── types/         # TypeScript类型定义
│   └── index.ts       # 服务入口
├── tests/             # 测试文件
├── package.json
└── README.md
```

### 添加新功能

1. **定义类型**: 在 `types/index.ts` 中添加类型定义
2. **实现服务**: 在 `services/` 目录下创建服务类
3. **添加API**: 在 `api/routes.ts` 中添加路由
4. **编写测试**: 在 `tests/` 目录下添加测试
5. **更新文档**: 更新README和API文档

### 测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- --grep "FileStorageService"

# 测试覆盖率
npm run test:coverage
```

## 许可证

MIT License

## 联系方式

如有问题或建议，请通过以下方式联系：
- 邮箱: support@ai-answer-ninja.com
- 文档: https://docs.ai-answer-ninja.com
- 问题反馈: https://github.com/ai-answer-ninja/issues