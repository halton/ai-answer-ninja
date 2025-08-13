#!/bin/bash

# AI电话应答系统管理面板部署脚本
# 版本: 1.0.0
# 作者: AI Ninja Team

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示帮助信息
show_help() {
    cat << EOF
AI电话应答系统管理面板部署脚本

用法: $0 [选项] <环境>

环境:
    dev         开发环境
    staging     测试环境
    production  生产环境

选项:
    -h, --help     显示帮助信息
    -c, --clean    清理构建缓存
    -s, --skip     跳过依赖安装
    -b, --backup   部署前备份
    -v, --verbose  详细输出

示例:
    $0 production              # 部署到生产环境
    $0 --clean --backup prod   # 清理缓存并备份后部署到生产环境
    $0 -h                      # 显示帮助

EOF
}

# 检查系统要求
check_requirements() {
    log_info "检查系统要求..."
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装，请先安装 Node.js >= 16.0.0"
        exit 1
    fi
    
    local node_version=$(node -v | cut -d'v' -f2)
    local required_version="16.0.0"
    
    if ! node -e "process.exit(require('semver').gte('$node_version', '$required_version') ? 0 : 1)" 2>/dev/null; then
        log_error "Node.js 版本过低，当前版本: $node_version，要求版本: >= $required_version"
        exit 1
    fi
    
    # 检查npm
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装"
        exit 1
    fi
    
    log_success "系统要求检查通过"
}

# 清理缓存
clean_cache() {
    log_info "清理构建缓存..."
    
    # 清理node_modules
    if [ -d "node_modules" ]; then
        rm -rf node_modules
        log_info "已清理 node_modules"
    fi
    
    # 清理构建输出
    if [ -d "dist" ]; then
        rm -rf dist
        log_info "已清理 dist 目录"
    fi
    
    # 清理npm缓存
    npm cache clean --force
    
    log_success "缓存清理完成"
}

# 安装依赖
install_dependencies() {
    log_info "安装项目依赖..."
    
    # 使用npm ci进行快速、可靠的安装
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        log_warning "package-lock.json 不存在，使用 npm install"
        npm install
    fi
    
    log_success "依赖安装完成"
}

# 代码检查
run_lint() {
    log_info "运行代码检查..."
    
    npm run lint
    
    if [ $? -eq 0 ]; then
        log_success "代码检查通过"
    else
        log_error "代码检查失败，请修复后重试"
        exit 1
    fi
}

# 类型检查
run_type_check() {
    log_info "运行类型检查..."
    
    npm run type-check
    
    if [ $? -eq 0 ]; then
        log_success "类型检查通过"
    else
        log_error "类型检查失败，请修复后重试"
        exit 1
    fi
}

# 构建项目
build_project() {
    local env=$1
    log_info "构建项目 (环境: $env)..."
    
    # 设置环境变量
    case $env in
        "dev"|"development")
            export NODE_ENV=development
            export VITE_API_BASE_URL=${VITE_API_BASE_URL:-"http://localhost:3000"}
            export VITE_WS_URL=${VITE_WS_URL:-"ws://localhost:3002"}
            ;;
        "staging")
            export NODE_ENV=production
            export VITE_API_BASE_URL=${VITE_API_BASE_URL:-"https://api-staging.ai-ninja.com"}
            export VITE_WS_URL=${VITE_WS_URL:-"wss://ws-staging.ai-ninja.com"}
            ;;
        "production"|"prod")
            export NODE_ENV=production
            export VITE_API_BASE_URL=${VITE_API_BASE_URL:-"https://api.ai-ninja.com"}
            export VITE_WS_URL=${VITE_WS_URL:-"wss://ws.ai-ninja.com"}
            ;;
        *)
            log_error "未知环境: $env"
            exit 1
            ;;
    esac
    
    # 执行构建
    npm run build
    
    if [ $? -eq 0 ]; then
        log_success "项目构建完成"
        
        # 显示构建产物信息
        if [ -d "dist" ]; then
            local size=$(du -sh dist | cut -f1)
            log_info "构建产物大小: $size"
            
            # 显示主要文件
            log_info "主要文件:"
            find dist -name "*.js" -o -name "*.css" | head -10 | while read file; do
                local file_size=$(du -h "$file" | cut -f1)
                echo "  - $(basename "$file"): $file_size"
            done
        fi
    else
        log_error "项目构建失败"
        exit 1
    fi
}

# 备份现有部署
backup_deployment() {
    local backup_dir="/var/backups/ai-ninja-admin-panel"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$backup_dir/backup_$timestamp"
    
    log_info "创建部署备份..."
    
    # 创建备份目录
    sudo mkdir -p "$backup_dir"
    
    # 如果目标目录存在，进行备份
    if [ -d "/var/www/ai-ninja-admin-panel" ]; then
        sudo cp -r /var/www/ai-ninja-admin-panel "$backup_path"
        log_success "备份已创建: $backup_path"
        
        # 保留最近5个备份
        sudo find "$backup_dir" -maxdepth 1 -type d -name "backup_*" | sort -r | tail -n +6 | sudo xargs rm -rf
        log_info "已清理旧备份，保留最近5个备份"
    else
        log_info "目标目录不存在，跳过备份"
    fi
}

# 部署到服务器
deploy_to_server() {
    local env=$1
    log_info "部署到 $env 环境..."
    
    case $env in
        "dev"|"development")
            local target_dir="/var/www/ai-ninja-admin-panel-dev"
            ;;
        "staging")
            local target_dir="/var/www/ai-ninja-admin-panel-staging"
            ;;
        "production"|"prod")
            local target_dir="/var/www/ai-ninja-admin-panel"
            ;;
        *)
            log_error "未知环境: $env"
            exit 1
            ;;
    esac
    
    # 创建目标目录
    sudo mkdir -p "$target_dir"
    
    # 复制构建产物
    sudo cp -r dist/* "$target_dir/"
    
    # 设置权限
    sudo chown -R www-data:www-data "$target_dir"
    sudo chmod -R 755 "$target_dir"
    
    log_success "部署完成: $target_dir"
}

# 更新Nginx配置
update_nginx_config() {
    local env=$1
    log_info "更新Nginx配置..."
    
    local config_template="nginx/admin-panel-${env}.conf"
    local config_target="/etc/nginx/sites-available/ai-ninja-admin-panel-${env}"
    
    if [ -f "$config_template" ]; then
        sudo cp "$config_template" "$config_target"
        
        # 启用站点
        sudo ln -sf "$config_target" "/etc/nginx/sites-enabled/"
        
        # 测试配置
        sudo nginx -t
        
        if [ $? -eq 0 ]; then
            sudo systemctl reload nginx
            log_success "Nginx配置已更新"
        else
            log_error "Nginx配置测试失败"
            exit 1
        fi
    else
        log_warning "Nginx配置模板不存在: $config_template"
    fi
}

# 健康检查
health_check() {
    local env=$1
    log_info "执行健康检查..."
    
    case $env in
        "dev"|"development")
            local url="http://localhost:3100"
            ;;
        "staging")
            local url="https://admin-staging.ai-ninja.com"
            ;;
        "production"|"prod")
            local url="https://admin.ai-ninja.com"
            ;;
        *)
            log_warning "跳过健康检查，未知环境: $env"
            return 0
            ;;
    esac
    
    # 等待服务启动
    sleep 5
    
    # 检查HTTP状态
    local status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")
    
    if [ "$status_code" = "200" ]; then
        log_success "健康检查通过: $url"
    else
        log_error "健康检查失败: $url (状态码: $status_code)"
        exit 1
    fi
}

# 主函数
main() {
    local env=""
    local clean_cache_flag=false
    local skip_install=false
    local backup_flag=false
    local verbose=false
    
    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -c|--clean)
                clean_cache_flag=true
                shift
                ;;
            -s|--skip)
                skip_install=true
                shift
                ;;
            -b|--backup)
                backup_flag=true
                shift
                ;;
            -v|--verbose)
                verbose=true
                set -x
                shift
                ;;
            dev|development|staging|production|prod)
                env=$1
                shift
                ;;
            *)
                log_error "未知参数: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # 检查环境参数
    if [ -z "$env" ]; then
        log_error "请指定部署环境"
        show_help
        exit 1
    fi
    
    log_info "开始部署 AI电话应答系统管理面板"
    log_info "目标环境: $env"
    log_info "时间: $(date)"
    
    # 执行部署步骤
    check_requirements
    
    if [ "$clean_cache_flag" = true ]; then
        clean_cache
    fi
    
    if [ "$skip_install" = false ]; then
        install_dependencies
    fi
    
    run_lint
    run_type_check
    
    if [ "$backup_flag" = true ]; then
        backup_deployment
    fi
    
    build_project "$env"
    deploy_to_server "$env"
    update_nginx_config "$env"
    health_check "$env"
    
    log_success "部署完成！"
    log_info "访问地址根据环境配置"
    
    # 显示部署信息
    case $env in
        "dev"|"development")
            log_info "开发环境: http://localhost:3100"
            ;;
        "staging")
            log_info "测试环境: https://admin-staging.ai-ninja.com"
            ;;
        "production"|"prod")
            log_info "生产环境: https://admin.ai-ninja.com"
            ;;
    esac
}

# 执行主函数
main "$@"