#!/bin/bash

# AI Answer Ninja 部署脚本
# 支持多环境部署：development, staging, production

set -euo pipefail

# 默认配置
ENVIRONMENT="staging"
SERVICES="all"
DEPLOYMENT_STRATEGY="rolling"
FORCE_DEPLOY=false
SKIP_TESTS=false
DRY_RUN=false

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
AI Answer Ninja 部署脚本

用法: $0 [选项]

选项:
    -e, --environment ENV     目标环境 (development|staging|production)
    -s, --services SERVICES   要部署的服务 (all|service1,service2,...)
    -t, --strategy STRATEGY   部署策略 (rolling|canary|blue-green)
    -f, --force              强制部署（跳过检查）
    --skip-tests             跳过测试
    --dry-run               演示模式（不实际部署）
    -h, --help              显示帮助信息

示例:
    $0 --environment staging --services phone-gateway,monitoring
    $0 --environment production --strategy canary
    $0 --environment development --force --skip-tests

EOF
}

# 解析命令行参数
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -s|--services)
                SERVICES="$2"
                shift 2
                ;;
            -t|--strategy)
                DEPLOYMENT_STRATEGY="$2"
                shift 2
                ;;
            -f|--force)
                FORCE_DEPLOY=true
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "未知参数: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# 验证环境
validate_environment() {
    case $ENVIRONMENT in
        development|staging|production)
            ;;
        *)
            log_error "无效的环境: $ENVIRONMENT"
            exit 1
            ;;
    esac
}

# 验证部署策略
validate_strategy() {
    case $DEPLOYMENT_STRATEGY in
        rolling|canary|blue-green)
            ;;
        *)
            log_error "无效的部署策略: $DEPLOYMENT_STRATEGY"
            exit 1
            ;;
    esac
}

# 检查依赖工具
check_dependencies() {
    local deps=("docker" "kubectl" "helm" "aws")
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "缺少依赖工具: $dep"
            exit 1
        fi
    done
    
    log_success "所有依赖工具检查通过"
}

# 检查环境健康状态
check_environment_health() {
    if [[ $ENVIRONMENT == "production" && $FORCE_DEPLOY != true ]]; then
        log_info "检查生产环境健康状态..."
        
        # 检查Kubernetes集群状态
        if ! kubectl cluster-info &> /dev/null; then
            log_error "无法连接到Kubernetes集群"
            exit 1
        fi
        
        # 检查数据库连接
        if ! kubectl exec -n $ENVIRONMENT deployment/postgres -- pg_isready; then
            log_error "数据库连接失败"
            exit 1
        fi
        
        log_success "环境健康检查通过"
    fi
}

# 运行预部署测试
run_pre_deployment_tests() {
    if [[ $SKIP_TESTS == true ]]; then
        log_warning "跳过预部署测试"
        return
    fi
    
    log_info "运行预部署测试..."
    
    # 运行单元测试
    if ! npm run test:unit; then
        log_error "单元测试失败"
        exit 1
    fi
    
    # 运行集成测试
    if ! npm run test:integration; then
        log_error "集成测试失败"
        exit 1
    fi
    
    # 生产环境额外检查
    if [[ $ENVIRONMENT == "production" ]]; then
        # 运行安全扫描
        if ! npm run security:scan; then
            log_error "安全扫描失败"
            exit 1
        fi
        
        # 运行性能测试
        if ! npm run test:performance; then
            log_error "性能测试失败"
            exit 1
        fi
    fi
    
    log_success "预部署测试通过"
}

# 构建Docker镜像
build_images() {
    log_info "构建Docker镜像..."
    
    local services_array
    if [[ $SERVICES == "all" ]]; then
        services_array=("phone-gateway" "configuration-service" "monitoring" "smart-whitelist-node")
    else
        IFS=',' read -ra services_array <<< "$SERVICES"
    fi
    
    for service in "${services_array[@]}"; do
        log_info "构建服务: $service"
        
        if [[ $DRY_RUN == true ]]; then
            log_info "[DRY RUN] 将构建镜像: $service"
            continue
        fi
        
        # 构建镜像
        local dockerfile="services/$service/Dockerfile"
        if [[ $ENVIRONMENT == "production" ]]; then
            dockerfile="services/$service/Dockerfile.production"
        fi
        
        local image_tag="ghcr.io/ai-answer-ninja/$service:$ENVIRONMENT-$(git rev-parse --short HEAD)"
        
        if ! docker build -t "$image_tag" -f "$dockerfile" "services/$service/"; then
            log_error "构建镜像失败: $service"
            exit 1
        fi
        
        # 推送镜像到注册表
        if ! docker push "$image_tag"; then
            log_error "推送镜像失败: $service"
            exit 1
        fi
        
        log_success "镜像构建完成: $service"
    done
}

# 执行滚动部署
deploy_rolling() {
    log_info "执行滚动部署..."
    
    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] 将执行滚动部署"
        return
    fi
    
    # 更新Helm chart
    helm upgrade --install "ai-answer-ninja-$ENVIRONMENT" helm/ai-answer-ninja \
        --namespace "$ENVIRONMENT" \
        --create-namespace \
        --values "helm/ai-answer-ninja/values-$ENVIRONMENT.yaml" \
        --set "image.tag=$ENVIRONMENT-$(git rev-parse --short HEAD)" \
        --wait --timeout=15m
    
    log_success "滚动部署完成"
}

# 执行金丝雀部署
deploy_canary() {
    log_info "执行金丝雀部署..."
    
    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] 将执行金丝雀部署"
        return
    fi
    
    # 部署金丝雀版本（10%流量）
    helm upgrade --install "ai-answer-ninja-$ENVIRONMENT-canary" helm/ai-answer-ninja \
        --namespace "$ENVIRONMENT" \
        --values "helm/ai-answer-ninja/values-$ENVIRONMENT.yaml" \
        --set "deployment.canary.enabled=true" \
        --set "deployment.canary.weight=10" \
        --set "image.tag=$ENVIRONMENT-$(git rev-parse --short HEAD)" \
        --wait --timeout=10m
    
    log_info "金丝雀版本部署完成，监控中..."
    
    # 监控5分钟
    sleep 300
    
    # 检查错误率和延迟
    local error_rate=$(kubectl exec -n "$ENVIRONMENT" deployment/ai-answer-ninja-canary -- curl -s http://localhost:9090/metrics | grep -o 'error_rate [0-9.]*' | cut -d' ' -f2 || echo "0")
    
    if (( $(echo "$error_rate > 0.05" | bc -l) )); then
        log_error "金丝雀版本错误率过高: $error_rate"
        log_info "回滚金丝雀部署..."
        helm uninstall "ai-answer-ninja-$ENVIRONMENT-canary" -n "$ENVIRONMENT"
        exit 1
    fi
    
    # 增加到50%流量
    log_info "增加金丝雀流量到50%..."
    helm upgrade "ai-answer-ninja-$ENVIRONMENT-canary" helm/ai-answer-ninja \
        --namespace "$ENVIRONMENT" \
        --set "deployment.canary.weight=50" \
        --wait --timeout=5m
    
    # 再次监控
    sleep 600
    
    # 完全切换
    log_info "完全切换到新版本..."
    helm upgrade "ai-answer-ninja-$ENVIRONMENT-canary" helm/ai-answer-ninja \
        --namespace "$ENVIRONMENT" \
        --set "deployment.canary.weight=100" \
        --wait --timeout=5m
    
    log_success "金丝雀部署完成"
}

# 执行蓝绿部署
deploy_blue_green() {
    log_info "执行蓝绿部署..."
    
    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] 将执行蓝绿部署"
        return
    fi
    
    # 部署绿色环境
    helm upgrade --install "ai-answer-ninja-$ENVIRONMENT-green" helm/ai-answer-ninja \
        --namespace "$ENVIRONMENT" \
        --values "helm/ai-answer-ninja/values-$ENVIRONMENT.yaml" \
        --set "deployment.color=green" \
        --set "image.tag=$ENVIRONMENT-$(git rev-parse --short HEAD)" \
        --set "ingress.hosts[0]=green-$ENVIRONMENT.ai-answer-ninja.com" \
        --wait --timeout=15m
    
    log_info "绿色环境部署完成，运行验证测试..."
    
    # 验证绿色环境
    if ! npm run test:smoke -- --target="https://green-$ENVIRONMENT.ai-answer-ninja.com"; then
        log_error "绿色环境验证失败"
        exit 1
    fi
    
    # 切换流量
    log_info "切换流量到绿色环境..."
    kubectl patch ingress "ai-answer-ninja-ingress" -n "$ENVIRONMENT" \
        -p '{"spec":{"rules":[{"host":"api-'$ENVIRONMENT'.ai-answer-ninja.com","http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"ai-answer-ninja-'$ENVIRONMENT'-green","port":{"number":80}}}}]}}]}}'
    
    # 等待DNS传播
    sleep 60
    
    # 验证流量切换
    if ! curl -f "https://api-$ENVIRONMENT.ai-answer-ninja.com/health"; then
        log_error "流量切换失败"
        exit 1
    fi
    
    # 清理蓝色环境
    helm uninstall "ai-answer-ninja-$ENVIRONMENT-blue" -n "$ENVIRONMENT" || true
    
    log_success "蓝绿部署完成"
}

# 执行部署
deploy() {
    case $DEPLOYMENT_STRATEGY in
        rolling)
            deploy_rolling
            ;;
        canary)
            deploy_canary
            ;;
        blue-green)
            deploy_blue_green
            ;;
    esac
}

# 运行部署后验证
run_post_deployment_verification() {
    log_info "运行部署后验证..."
    
    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] 将运行部署后验证"
        return
    fi
    
    # 健康检查
    local services_array
    if [[ $SERVICES == "all" ]]; then
        services_array=("phone-gateway" "configuration-service" "monitoring" "smart-whitelist-node")
    else
        IFS=',' read -ra services_array <<< "$SERVICES"
    fi
    
    for service in "${services_array[@]}"; do
        log_info "检查服务健康状态: $service"
        
        local health_url="https://api-$ENVIRONMENT.ai-answer-ninja.com/health/$service"
        if [[ $ENVIRONMENT == "development" ]]; then
            health_url="http://localhost:3000/health/$service"
        fi
        
        if ! curl -f "$health_url"; then
            log_error "服务健康检查失败: $service"
            exit 1
        fi
    done
    
    # 运行E2E测试
    if [[ $ENVIRONMENT != "development" ]]; then
        if ! npm run test:e2e -- --env="$ENVIRONMENT"; then
            log_error "E2E测试失败"
            exit 1
        fi
    fi
    
    log_success "部署后验证通过"
}

# 发送部署通知
send_notifications() {
    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] 将发送部署通知"
        return
    fi
    
    log_info "发送部署通知..."
    
    local status="SUCCESS"
    local message="✅ 部署成功完成"
    local color="good"
    
    # 发送Slack通知
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
        curl -X POST "$SLACK_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{
                \"channel\": \"#deployments\",
                \"text\": \"$message\",
                \"color\": \"$color\",
                \"fields\": [
                    {\"title\": \"Environment\", \"value\": \"$ENVIRONMENT\", \"short\": true},
                    {\"title\": \"Services\", \"value\": \"$SERVICES\", \"short\": true},
                    {\"title\": \"Strategy\", \"value\": \"$DEPLOYMENT_STRATEGY\", \"short\": true},
                    {\"title\": \"Commit\", \"value\": \"$(git rev-parse --short HEAD)\", \"short\": true}
                ]
            }"
    fi
    
    log_success "部署通知已发送"
}

# 主函数
main() {
    log_info "开始AI Answer Ninja部署流程"
    log_info "环境: $ENVIRONMENT"
    log_info "服务: $SERVICES" 
    log_info "策略: $DEPLOYMENT_STRATEGY"
    
    if [[ $DRY_RUN == true ]]; then
        log_warning "演示模式 - 不会实际执行部署"
    fi
    
    # 执行部署流程
    validate_environment
    validate_strategy
    check_dependencies
    check_environment_health
    run_pre_deployment_tests
    build_images
    deploy
    run_post_deployment_verification
    send_notifications
    
    log_success "部署流程完成！"
    
    if [[ $ENVIRONMENT == "production" ]]; then
        log_info "生产环境URL: https://api.ai-answer-ninja.com"
    elif [[ $ENVIRONMENT == "staging" ]]; then
        log_info "测试环境URL: https://staging.ai-answer-ninja.com"
    else
        log_info "开发环境URL: http://localhost:3000"
    fi
}

# 错误处理
trap 'log_error "部署过程中发生错误，退出代码: $?"' ERR

# 解析参数并执行主函数
parse_args "$@"
main