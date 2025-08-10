#!/bin/sh
# 健康检查脚本 - Realtime Processor Service

set -e

SERVICE_NAME="Realtime Processor"
HEALTH_ENDPOINT="http://localhost:3002/health"
TIMEOUT=10

echo "[$SERVICE_NAME] Starting health check..."

# 检查服务进程
if ! pgrep -f "node.*src/app.js" > /dev/null 2>&1; then
    echo "[$SERVICE_NAME] ❌ Process not running"
    exit 1
fi

echo "[$SERVICE_NAME] ✅ Health check completed successfully"
exit 0