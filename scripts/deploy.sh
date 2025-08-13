#!/bin/bash

# AI Answer Ninja 部署脚本
# 最大程度并行启动开发环境

set -e

echo "🚀 开始并行部署 AI Answer Ninja 系统..."
echo "=================================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}检查系统依赖...${NC}"
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker 未安装${NC}"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}❌ Docker Compose 未安装${NC}"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js 未安装${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ 系统依赖检查通过${NC}"
}

# 环境设置
setup_environment() {
    echo -e "${YELLOW}设置环境配置...${NC}"
    
    # 复制环境变量配置
    if [ ! -f .env ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ 已创建环境配置文件${NC}"
    fi
    
    # 创建必要目录
    mkdir -p logs/{services,nginx,database}
    mkdir -p storage/{audio,uploads,backups}
    mkdir -p database/backups
    
    echo -e "${GREEN}✅ 环境设置完成${NC}"
}

# 数据库初始化
init_database() {
    echo -e "${YELLOW}初始化数据库...${NC}"
    
    # 启动数据库服务
    docker-compose up -d postgres redis
    
    # 等待数据库启动
    echo "等待数据库启动..."
    sleep 10
    
    # 运行数据库迁移
    docker-compose exec -T postgres psql -U ai_ninja -d ai_ninja_db -f /migrations/001-create-users-table.sql
    docker-compose exec -T postgres psql -U ai_ninja -d ai_ninja_db -f /migrations/002-create-optimized-tables.sql
    
    echo -e "${GREEN}✅ 数据库初始化完成${NC}"
}

# 安装依赖 (并行)
install_dependencies() {
    echo -e "${YELLOW}并行安装所有服务依赖...${NC}"
    
    # 后端服务依赖安装 (并行)
    services=(
        "services/phone-gateway"
        "services/realtime-processor" 
        "services/conversation-engine"
        "services/profile-analytics"
        "services/user-management"
        "services/smart-whitelist-node"
        "services/configuration-service"
        "services/storage"
        "services/monitoring"
        "shared/security"
    )
    
    for service in "${services[@]}"; do
        (
            if [ -f "$service/package.json" ]; then
                echo "安装 $service 依赖..."
                cd "$service"
                npm install --silent
                echo -e "${GREEN}✅ $service 依赖安装完成${NC}"
            fi
        ) &
    done
    
    # 前端依赖安装
    (
        if [ -f "frontend/admin-panel/package.json" ]; then
            echo "安装前端依赖..."
            cd frontend/admin-panel
            npm install --silent
            echo -e "${GREEN}✅ 前端依赖安装完成${NC}"
        fi
    ) &
    
    # 等待所有安装任务完成
    wait
    
    echo -e "${GREEN}✅ 所有依赖安装完成${NC}"
}

# 构建服务 (并行)
build_services() {
    echo -e "${YELLOW}并行构建所有服务...${NC}"
    
    # 构建 Docker 镜像 (并行)
    services=(
        "phone-gateway"
        "realtime-processor"
        "conversation-engine" 
        "profile-analytics"
        "user-management"
        "smart-whitelist-node"
        "configuration-service"
        "storage"
        "monitoring"
    )
    
    for service in "${services[@]}"; do
        (
            echo "构建 $service 镜像..."
            docker-compose build "$service" --parallel
        ) &
    done
    
    # 构建前端
    (
        echo "构建前端应用..."
        cd frontend/admin-panel
        npm run build
        echo -e "${GREEN}✅ 前端构建完成${NC}"
    ) &
    
    wait
    echo -e "${GREEN}✅ 所有服务构建完成${NC}"
}

# 启动服务 (分批并行)
start_services() {
    echo -e "${YELLOW}分批启动服务...${NC}"
    
    # 第一批：基础设施服务
    echo "启动基础设施服务..."
    docker-compose up -d postgres redis nginx
    sleep 5
    
    # 第二批：核心业务服务
    echo "启动核心业务服务..."
    docker-compose up -d \
        user-management \
        configuration-service \
        storage \
        monitoring
    sleep 5
    
    # 第三批：处理服务
    echo "启动处理服务..."
    docker-compose up -d \
        phone-gateway \
        realtime-processor \
        conversation-engine \
        profile-analytics \
        smart-whitelist-node
    sleep 5
    
    # 启动前端 (如果是开发模式)
    if [ "${NODE_ENV:-development}" = "development" ]; then
        (
            cd frontend/admin-panel
            npm run dev &
        ) &
    fi
    
    echo -e "${GREEN}✅ 所有服务启动完成${NC}"
}

# 健康检查
health_check() {
    echo -e "${YELLOW}执行健康检查...${NC}"
    
    services=(
        "phone-gateway:3001"
        "realtime-processor:3002"
        "conversation-engine:3003"
        "profile-analytics:3004"
        "user-management:3005"
        "smart-whitelist-node:3006"
        "configuration-service:3007"
        "storage:3008"
        "monitoring:3009"
    )
    
    for service_port in "${services[@]}"; do
        service=$(echo $service_port | cut -d':' -f1)
        port=$(echo $service_port | cut -d':' -f2)
        
        echo -n "检查 $service..."
        if curl -f -s http://localhost:$port/health > /dev/null; then
            echo -e " ${GREEN}✅ 健康${NC}"
        else
            echo -e " ${RED}❌ 不健康${NC}"
        fi
    done
    
    echo -e "${GREEN}✅ 健康检查完成${NC}"
}

# 显示服务状态
show_status() {
    echo "=================================================="
    echo -e "${GREEN}🎉 AI Answer Ninja 部署完成!${NC}"
    echo "=================================================="
    echo ""
    echo "📊 服务状态："
    docker-compose ps
    echo ""
    echo "🌐 访问地址："
    echo "  • 管理面板: http://localhost:5173"
    echo "  • API网关:  http://localhost:8080"
    echo "  • 监控面板: http://localhost:3009/health"
    echo ""
    echo "🔧 有用的命令："
    echo "  • 查看日志: docker-compose logs -f [service-name]"
    echo "  • 重启服务: docker-compose restart [service-name]"
    echo "  • 停止所有: docker-compose down"
    echo "  • 查看状态: docker-compose ps"
    echo ""
    echo "📝 日志位置："
    echo "  • 服务日志: ./logs/services/"
    echo "  • 数据库日志: ./logs/database/"
    echo "  • Nginx日志: ./logs/nginx/"
}

# 主函数
main() {
    echo "AI Answer Ninja - 并行部署脚本"
    echo "作者: Claude AI Assistant"
    echo "时间: $(date)"
    echo ""
    
    # 执行部署步骤
    check_dependencies
    setup_environment
    init_database
    install_dependencies
    build_services
    start_services
    
    echo ""
    echo "等待服务完全启动..."
    sleep 10
    
    health_check
    show_status
    
    echo ""
    echo -e "${GREEN}🚀 部署完成! 系统已准备就绪!${NC}"
}

# 错误处理
trap 'echo -e "${RED}❌ 部署失败!${NC}"; exit 1' ERR

# 运行主函数
main "$@"