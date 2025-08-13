# Multi-stage Dockerfile for AI Answer Ninja Admin Panel
# 生产环境优化的多阶段构建

# Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install pnpm for faster package management
RUN corepack enable
RUN apk add --no-cache git

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Copy source code
COPY . .

# Build arguments
ARG BUILD_VERSION=unknown
ARG BUILD_TIME
ENV VITE_BUILD_VERSION=${BUILD_VERSION}
ENV VITE_BUILD_TIME=${BUILD_TIME}

# Type check and lint
RUN pnpm run type-check
RUN pnpm run lint

# Build application
RUN pnpm run build

# Production stage
FROM nginx:1.25-alpine AS production

# Install additional tools
RUN apk add --no-cache \
    curl \
    jq \
    bash

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

# Copy custom nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/default.conf /etc/nginx/conf.d/default.conf

# Copy built application from builder stage
COPY --from=builder --chown=appuser:nodejs /app/dist /usr/share/nginx/html

# Copy health check script
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

# Security headers and optimizations
COPY docker/security-headers.conf /etc/nginx/conf.d/security-headers.conf

# Create logs directory
RUN mkdir -p /var/log/nginx && \
    chown -R appuser:nodejs /var/log/nginx

# Set permissions
RUN chown -R appuser:nodejs /usr/share/nginx/html && \
    chown -R appuser:nodejs /etc/nginx/conf.d && \
    chown -R appuser:nodejs /var/cache/nginx

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

# Labels for metadata
LABEL maintainer="AI Ninja Team" \
      version="${BUILD_VERSION}" \
      description="AI Answer Ninja Admin Panel" \
      build-date="${BUILD_TIME}"

# Start nginx
CMD ["nginx", "-g", "daemon off;"]