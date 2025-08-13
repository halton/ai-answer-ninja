# 多阶段构建 Dockerfile for Conversation Engine TypeScript Service

# 构建阶段
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY tsconfig.json ./

# 安装依赖（包括开发依赖）
RUN npm ci --only=production=false

# 复制源代码
COPY src/ ./src/

# 构建项目
RUN npm run build

# 生产阶段
FROM node:18-alpine AS production

# 安装必要的系统包
RUN apk add --no-cache \
    dumb-init \
    && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S conversation-engine -u 1001

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --only=production && \
    npm cache clean --force

# 从构建阶段复制编译后的代码
COPY --from=builder /app/dist ./dist

# 创建日志目录
RUN mkdir -p logs && \
    chown -R conversation-engine:nodejs /app

# 切换到非 root 用户
USER conversation-engine

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3003/health/liveness', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# 暴露端口
EXPOSE 3003

# 启动命令
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

# 构建参数和标签
ARG BUILD_DATE
ARG GIT_COMMIT
ARG VERSION=1.0.0

LABEL maintainer="AI Answer Ninja Team" \
      org.opencontainers.image.title="Conversation Engine Service" \
      org.opencontainers.image.description="AI-powered conversation engine for spam call handling" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.revision=$GIT_COMMIT \
      org.opencontainers.image.vendor="AI Answer Ninja" \
      org.opencontainers.image.source="https://github.com/ai-answer-ninja/conversation-engine"