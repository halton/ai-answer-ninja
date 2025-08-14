# Docker问题诊断和修复方案

## 问题分析

当前Docker环境出现以下问题：
1. Docker命令超时，无法正常执行`docker ps`等基础命令
2. 有多个Backend进程运行，可能存在进程冲突
3. 需要为E2E测试提供快速可靠的环境

## Docker修复方案

### 方案1: 完全重启Docker Desktop (推荐)
```bash
# 1. 关闭Docker Desktop
osascript -e 'quit app "Docker"'

# 2. 清理Docker进程
sudo launchctl unload /Library/LaunchDaemons/com.docker.vmnetd.plist
sudo pkill -f docker

# 3. 重启Docker Desktop
open -a Docker

# 4. 等待Docker完全启动后测试
sleep 30
docker --version
```

### 方案2: 使用Colima替代Docker Desktop
```bash
# 安装Colima (更轻量级的Docker替代)
brew install colima docker

# 启动Colima
colima start --cpu 4 --memory 8

# 测试Docker功能
docker ps
```

### 方案3: 本地直接运行 (无Docker)
创建本地开发环境，直接运行Node.js和Python服务。

## 临时解决方案 - 本地运行

由于Docker问题，我们将创建一个本地运行的开发环境：

### 数据库准备
```bash
# 使用本地PostgreSQL和Redis
brew install postgresql redis

# 启动服务
brew services start postgresql
brew services start redis

# 创建数据库
createdb ai_ninja
```

### 环境变量配置
```bash
# 创建.env.local文件
export NODE_ENV=development
export POSTGRES_URL=postgresql://localhost:5432/ai_ninja
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=your-jwt-secret-here
```

## 检查清单

- [ ] Docker Desktop是否正常启动
- [ ] 是否有多余的Docker进程
- [ ] 本地数据库是否可用
- [ ] 环境变量是否正确配置
- [ ] 服务端口是否冲突