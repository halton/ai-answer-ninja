#!/bin/bash

# AI Answer Ninja Cache System - Development Startup Script

set -e

echo "🚀 Starting AI Answer Ninja Cache System Development Environment..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# 检查并创建必要的目录
echo -e "${BLUE}📁 Creating necessary directories...${NC}"
mkdir -p monitoring/grafana/dashboards
mkdir -p monitoring/grafana/datasources

# 设置环境变量
export REDIS_PASSWORD=${REDIS_PASSWORD:-"ai-ninja-cache-dev"}

echo -e "${BLUE}🔧 Environment Configuration:${NC}"
echo -e "   Redis Password: ${REDIS_PASSWORD}"

# 启动基础服务
echo -e "${BLUE}🐳 Starting Redis...${NC}"
docker-compose up -d redis

# 等待Redis启动
echo -e "${YELLOW}⏳ Waiting for Redis to be ready...${NC}"
timeout=30
counter=0
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    sleep 1
    counter=$((counter + 1))
    if [ $counter -gt $timeout ]; then
        echo -e "${RED}❌ Redis failed to start within ${timeout} seconds${NC}"
        docker-compose logs redis
        exit 1
    fi
done

echo -e "${GREEN}✅ Redis is ready!${NC}"

# 安装依赖并构建
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

echo -e "${BLUE}🔨 Building TypeScript...${NC}"
npm run build

# 运行基础示例
echo -e "${BLUE}🎯 Running basic usage example...${NC}"
node dist/examples/basic-usage.js

echo -e "${GREEN}🎉 Development environment started successfully!${NC}"
echo ""
echo -e "${BLUE}Available services:${NC}"
echo -e "   Redis:        localhost:6379"
echo -e "   Password:     ${REDIS_PASSWORD}"
echo ""
echo -e "${BLUE}Available commands:${NC}"
echo -e "   ${YELLOW}npm test${NC}                    - Run tests"
echo -e "   ${YELLOW}npm run dev${NC}                 - Development mode"
echo -e "   ${YELLOW}npm run example:basic${NC}       - Run basic example"
echo -e "   ${YELLOW}npm run example:advanced${NC}    - Run advanced example"
echo ""
echo -e "${BLUE}Docker commands:${NC}"
echo -e "   ${YELLOW}docker-compose up -d redis-commander${NC}  - Start Redis UI (localhost:8081)"
echo -e "   ${YELLOW}docker-compose --profile monitoring up -d${NC}  - Start monitoring stack"
echo -e "   ${YELLOW}docker-compose --profile test up${NC}           - Run tests in Docker"
echo ""
echo -e "${GREEN}Happy caching! 🚀${NC}"