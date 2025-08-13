# 使用官方 Node.js 运行时作为父镜像
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production && npm cache clean --force

# 复制源代码
COPY . .

# 构建 TypeScript
RUN npm run build

# 运行阶段
FROM node:18-alpine AS runner

# 安装必要的系统包
RUN apk add --no-cache \
    tini \
    curl \
    && rm -rf /var/cache/apk/*

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S analytics -u 1001

# 设置工作目录
WORKDIR /app

# 从构建阶段复制文件
COPY --from=builder --chown=analytics:nodejs /app/dist ./dist
COPY --from=builder --chown=analytics:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=analytics:nodejs /app/package*.json ./

# 创建必要的目录
RUN mkdir -p /app/logs /app/data && \
    chown -R analytics:nodejs /app

# 切换到非root用户
USER analytics

# 暴露端口
EXPOSE 3004

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3004/health || exit 1

# 使用tini作为init系统
ENTRYPOINT ["/sbin/tini", "--"]

# 启动应用
CMD ["node", "dist/index.js"]

# 标签
LABEL maintainer="AI Answer Ninja Team" \
      version="1.0.0" \
      description="Advanced Profile Analytics Service with ML-powered insights" \
      org.opencontainers.image.title="Profile Analytics Service" \
      org.opencontainers.image.description="Advanced Profile Analytics Service with ML-powered insights and real-time processing" \
      org.opencontainers.image.vendor="AI Answer Ninja" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="MIT"