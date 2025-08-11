# AI电话应答系统 - 备份系统 Dockerfile
FROM node:18-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache python3 make g++ postgresql-client redis-tools

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
COPY tsconfig.json ./

# 安装依赖
RUN npm ci --only=production && npm cache clean --force

# 复制源代码
COPY . .

# 构建TypeScript
RUN npm run build

# 生产镜像
FROM node:18-alpine AS production

# 安装运行时依赖
RUN apk add --no-cache \
    postgresql-client \
    redis-tools \
    curl \
    bash \
    gzip \
    openssl \
    ca-certificates \
    tzdata

# 安装WAL-G备份工具
RUN wget -O /usr/local/bin/wal-g https://github.com/wal-g/wal-g/releases/latest/download/wal-g-pg-ubuntu-20.04-amd64 && \
    chmod +x /usr/local/bin/wal-g

# 创建应用用户
RUN addgroup -g 1001 -S backup && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G backup -g backup backup

# 设置工作目录
WORKDIR /app

# 复制构建结果
COPY --from=builder --chown=backup:backup /app/dist ./dist
COPY --from=builder --chown=backup:backup /app/node_modules ./node_modules
COPY --from=builder --chown=backup:backup /app/package.json ./package.json

# 复制配置和脚本
COPY --chown=backup:backup config/ ./config/
COPY --chown=backup:backup scripts/ ./scripts/

# 创建必要的目录
RUN mkdir -p \
    /opt/ai-ninja/backups/{postgresql,redis,encrypted,metadata} \
    /opt/ai-ninja/security/keys \
    /opt/ai-ninja/wal-archive \
    /tmp/ai-ninja-recovery \
    /var/log/ai-ninja-backup && \
    chown -R backup:backup \
    /opt/ai-ninja \
    /tmp/ai-ninja-recovery \
    /var/log/ai-ninja-backup

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 环境变量
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV HEALTH_CHECK_PORT=8080
ENV METRICS_PORT=9090

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${HEALTH_CHECK_PORT}/health || exit 1

# 切换到应用用户
USER backup

# 暴露端口
EXPOSE 8080 9090

# 入口点
CMD ["node", "dist/scripts/start-backup-system.js"]

# 标签
LABEL maintainer="AI Answer Ninja Team <admin@ai-answer-ninja.com>"
LABEL version="1.0.0"
LABEL description="AI电话应答系统备份服务"
LABEL org.opencontainers.image.title="AI Answer Ninja Backup System"
LABEL org.opencontainers.image.description="Comprehensive backup and disaster recovery system"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.authors="AI Answer Ninja Team"
LABEL org.opencontainers.image.source="https://github.com/ai-answer-ninja/backup-system"