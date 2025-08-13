#!/bin/bash

# AI Answer Ninja - Development Environment Startup Script
# 快速启动开发环境的脚本

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose >/dev/null 2>&1; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    print_warning ".env file not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        print_success ".env file created. Please update the values in .env file before running again."
        print_warning "Don't forget to set your Azure service keys and database passwords!"
        exit 1
    else
        print_error ".env.example file not found. Please create your .env file manually."
        exit 1
    fi
fi

print_status "Starting AI Answer Ninja Development Environment..."
print_status "This will start all core services: Database, Redis, and Core Microservices"

# Stop any existing containers
print_status "Stopping existing containers..."
docker-compose -f docker-compose.dev.yml down --remove-orphans

# Pull the latest images
print_status "Pulling latest Docker images..."
docker-compose -f docker-compose.dev.yml pull

# Build and start services
print_status "Building and starting services..."
docker-compose -f docker-compose.dev.yml up --build -d

# Wait for services to be ready
print_status "Waiting for services to be ready..."
sleep 10

# Check service health
print_status "Checking service health..."

services=(
    "postgres:5432"
    "redis:6379"
    "realtime-processor:3002"
    "conversation-engine:3003"
    "user-management:3005"
    "smart-whitelist:3006"
)

for service in "${services[@]}"; do
    service_name=$(echo $service | cut -d':' -f1)
    port=$(echo $service | cut -d':' -f2)
    
    if docker-compose -f docker-compose.dev.yml ps | grep -q "$service_name.*Up"; then
        print_success "$service_name is running"
    else
        print_warning "$service_name may not be ready yet"
    fi
done

# Show service URLs
echo
print_success "🚀 AI Answer Ninja Development Environment Started!"
echo
echo "=== 服务访问地址 ==="
echo "📊 PgAdmin (Database Admin):  http://localhost:8080"
echo "🔴 Redis Commander:           http://localhost:8081"
echo "🎧 Realtime Processor:        http://localhost:3002"
echo "🤖 Conversation Engine:       http://localhost:3003"
echo "👥 User Management:           http://localhost:3005"
echo "🛡️  Smart Whitelist:           http://localhost:3006"
echo
echo "=== 健康检查 ==="
echo "curl http://localhost:3002/health  # Realtime Processor"
echo "curl http://localhost:3003/health  # Conversation Engine"
echo "curl http://localhost:3005/health  # User Management"
echo "curl http://localhost:3006/ping    # Smart Whitelist"
echo
echo "=== 日志查看 ==="
echo "docker-compose -f docker-compose.dev.yml logs -f [service-name]"
echo "docker-compose -f docker-compose.dev.yml logs -f realtime-processor"
echo
echo "=== 停止服务 ==="
echo "docker-compose -f docker-compose.dev.yml down"
echo

# Optional: Run health checks
if command -v curl >/dev/null 2>&1; then
    echo "=== 自动健康检查 ==="
    sleep 5
    
    health_endpoints=(
        "http://localhost:3002/health:Realtime Processor"
        "http://localhost:3005/health:User Management"
        "http://localhost:3006/ping:Smart Whitelist"
    )
    
    for endpoint in "${health_endpoints[@]}"; do
        url=$(echo $endpoint | cut -d':' -f1-2)
        name=$(echo $endpoint | cut -d':' -f3)
        
        if curl -s -f "$url" > /dev/null; then
            print_success "$name - 健康检查通过"
        else
            print_warning "$name - 健康检查失败 (可能仍在启动中)"
        fi
    done
else
    print_warning "curl not available. Please manually check service health using the URLs above."
fi

print_status "Environment setup completed! Check the logs if any service fails to start."
print_status "Use 'docker-compose -f docker-compose.dev.yml logs -f' to monitor all services."