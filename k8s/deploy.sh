#!/bin/bash

# AI Answer Ninja - Kubernetes Deployment Script
# This script deploys the entire AI Answer Ninja system to Kubernetes

set -euo pipefail

# Configuration
NAMESPACE=${NAMESPACE:-ai-ninja}
ENVIRONMENT=${ENVIRONMENT:-production}
HELM_CHART_PATH=${HELM_CHART_PATH:-./helm-charts/ai-ninja}
VALUES_FILE=${VALUES_FILE:-values-${ENVIRONMENT}.yaml}
DRY_RUN=${DRY_RUN:-false}
SKIP_BUILD=${SKIP_BUILD:-false}
BUILD_TAG=${BUILD_TAG:-latest}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠️  $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ❌ $1${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if kubectl is installed and configured
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check if helm is installed
    if ! command -v helm &> /dev/null; then
        error "helm is not installed or not in PATH"
        exit 1
    fi
    
    # Check if docker is installed (for building images)
    if [[ "$SKIP_BUILD" != "true" ]] && ! command -v docker &> /dev/null; then
        error "docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check kubectl connection
    if ! kubectl cluster-info &> /dev/null; then
        error "kubectl is not connected to a cluster"
        exit 1
    fi
    
    # Check if running in correct context
    CURRENT_CONTEXT=$(kubectl config current-context)
    log "Current kubectl context: $CURRENT_CONTEXT"
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        read -p "⚠️  You are deploying to PRODUCTION. Are you sure? (yes/no): " confirm
        if [[ "$confirm" != "yes" ]]; then
            error "Deployment cancelled"
            exit 1
        fi
    fi
    
    success "Prerequisites check passed"
}

# Function to build and push Docker images
build_images() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        warning "Skipping image build as requested"
        return 0
    fi
    
    log "Building Docker images..."
    
    # Services to build
    services=(
        "phone-gateway"
        "realtime-processor" 
        "conversation-engine"
        "profile-analytics"
        "user-management"
        "smart-whitelist"
        "configuration-service"
        "storage-service"
        "monitoring-service"
    )
    
    for service in "${services[@]}"; do
        log "Building $service:$BUILD_TAG"
        
        # Build image
        if [[ -f "services/$service/Dockerfile" ]]; then
            docker build -t "ai-ninja/$service:$BUILD_TAG" services/$service/
        else
            warning "Dockerfile not found for $service, skipping..."
            continue
        fi
        
        # Push image (if registry is configured)
        if [[ -n "${DOCKER_REGISTRY:-}" ]]; then
            docker tag "ai-ninja/$service:$BUILD_TAG" "$DOCKER_REGISTRY/$service:$BUILD_TAG"
            docker push "$DOCKER_REGISTRY/$service:$BUILD_TAG"
            log "Pushed $DOCKER_REGISTRY/$service:$BUILD_TAG"
        fi
    done
    
    success "Docker images built successfully"
}

# Function to prepare secrets
prepare_secrets() {
    log "Preparing secrets..."
    
    # Check if secrets already exist
    if kubectl get secret app-secrets -n $NAMESPACE &> /dev/null; then
        warning "Secrets already exist, skipping creation"
        return 0
    fi
    
    # Create namespace if it doesn't exist
    kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
    
    # Create secrets from environment variables or files
    if [[ -f "environments/$ENVIRONMENT/secrets/.env" ]]; then
        log "Creating secrets from environment file"
        kubectl create secret generic app-secrets \
            --from-env-file="environments/$ENVIRONMENT/secrets/.env" \
            -n $NAMESPACE
    else
        warning "No secrets file found at environments/$ENVIRONMENT/secrets/.env"
        warning "Please create secrets manually before deployment"
    fi
    
    success "Secrets prepared"
}

# Function to install dependencies
install_dependencies() {
    log "Installing Helm chart dependencies..."
    
    # Add required Helm repositories
    helm repo add bitnami https://charts.bitnami.com/bitnami
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo add grafana https://grafana.github.io/helm-charts
    helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
    helm repo update
    
    # Install or update dependencies
    if [[ -f "$HELM_CHART_PATH/Chart.yaml" ]]; then
        helm dependency update $HELM_CHART_PATH
    fi
    
    success "Dependencies installed"
}

# Function to deploy using Helm
deploy_helm() {
    log "Deploying with Helm..."
    
    # Construct helm command
    HELM_CMD="helm upgrade --install ai-ninja $HELM_CHART_PATH"
    HELM_CMD="$HELM_CMD --namespace $NAMESPACE --create-namespace"
    
    # Add values files
    if [[ -f "$HELM_CHART_PATH/$VALUES_FILE" ]]; then
        HELM_CMD="$HELM_CMD --values $HELM_CHART_PATH/$VALUES_FILE"
    elif [[ -f "environments/$ENVIRONMENT/$VALUES_FILE" ]]; then
        HELM_CMD="$HELM_CMD --values environments/$ENVIRONMENT/$VALUES_FILE"
    else
        HELM_CMD="$HELM_CMD --values $HELM_CHART_PATH/values.yaml"
    fi
    
    # Add environment-specific overrides
    HELM_CMD="$HELM_CMD --set global.environment=$ENVIRONMENT"
    HELM_CMD="$HELM_CMD --set image.tag=$BUILD_TAG"
    
    # Add registry override if specified
    if [[ -n "${DOCKER_REGISTRY:-}" ]]; then
        HELM_CMD="$HELM_CMD --set global.imageRegistry=$DOCKER_REGISTRY"
    fi
    
    # Add dry-run flag if requested
    if [[ "$DRY_RUN" == "true" ]]; then
        HELM_CMD="$HELM_CMD --dry-run --debug"
    fi
    
    log "Executing: $HELM_CMD"
    eval $HELM_CMD
    
    if [[ "$DRY_RUN" != "true" ]]; then
        success "Deployment completed successfully"
    else
        success "Dry-run completed successfully"
    fi
}

# Function to verify deployment
verify_deployment() {
    if [[ "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    
    log "Verifying deployment..."
    
    # Wait for deployments to be ready
    log "Waiting for deployments to be ready..."
    kubectl wait --for=condition=available --timeout=600s deployment --all -n $NAMESPACE
    
    # Check pod status
    log "Checking pod status..."
    kubectl get pods -n $NAMESPACE
    
    # Check service status
    log "Checking services..."
    kubectl get svc -n $NAMESPACE
    
    # Check ingress (if enabled)
    if kubectl get ingress -n $NAMESPACE &> /dev/null; then
        log "Checking ingress..."
        kubectl get ingress -n $NAMESPACE
    fi
    
    # Run health checks
    log "Running health checks..."
    sleep 30  # Wait for services to start
    
    # Get service endpoints and test them
    services=(
        "phone-gateway-service:3001"
        "realtime-processor-service:3002"
        "conversation-engine-service:3003"
        "profile-analytics-service:3004"
        "user-management-service:3005"
        "smart-whitelist-service:3006"
        "configuration-service:3007"
        "storage-service:3008"
        "monitoring-service:3009"
    )
    
    for service in "${services[@]}"; do
        service_name=$(echo $service | cut -d':' -f1)
        port=$(echo $service | cut -d':' -f2)
        
        log "Testing health endpoint for $service_name"
        if kubectl exec -n $NAMESPACE deployment/$(echo $service_name | sed 's/-service//') -- curl -sf "http://localhost:$port/health" &> /dev/null; then
            success "$service_name health check passed"
        else
            warning "$service_name health check failed"
        fi
    done
    
    success "Deployment verification completed"
}

# Function to show deployment information
show_info() {
    if [[ "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    
    log "Deployment Information:"
    echo ""
    echo "Namespace: $NAMESPACE"
    echo "Environment: $ENVIRONMENT"
    echo "Image Tag: $BUILD_TAG"
    echo ""
    
    # Show service endpoints
    log "Service Endpoints:"
    kubectl get svc -n $NAMESPACE -o wide
    echo ""
    
    # Show ingress information
    if kubectl get ingress -n $NAMESPACE &> /dev/null; then
        log "Ingress Information:"
        kubectl get ingress -n $NAMESPACE
        echo ""
    fi
    
    # Show monitoring access
    log "Monitoring Access:"
    echo "Grafana: kubectl port-forward svc/grafana-service 3000:3000 -n $NAMESPACE"
    echo "Prometheus: kubectl port-forward svc/prometheus-service 9090:9090 -n $NAMESPACE"
    echo ""
    
    # Show logs command
    log "To view logs:"
    echo "kubectl logs -f deployment/<service-name> -n $NAMESPACE"
    echo ""
    
    success "Deployment completed successfully! 🎉"
}

# Function to cleanup on failure
cleanup_on_failure() {
    error "Deployment failed! Rolling back..."
    
    if [[ "$DRY_RUN" != "true" ]]; then
        helm rollback ai-ninja -n $NAMESPACE 2>/dev/null || true
    fi
    
    exit 1
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENVIRONMENT   Set deployment environment (default: production)"
    echo "  -n, --namespace NAMESPACE       Set Kubernetes namespace (default: ai-ninja)"
    echo "  -t, --tag TAG                  Set image tag (default: latest)"
    echo "  -d, --dry-run                  Perform a dry run without making changes"
    echo "  -s, --skip-build               Skip Docker image building"
    echo "  -h, --help                     Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  DOCKER_REGISTRY                Docker registry prefix for images"
    echo "  HELM_CHART_PATH                Path to Helm chart (default: ./helm-charts/ai-ninja)"
    echo ""
    echo "Examples:"
    echo "  $0                             Deploy to production with default settings"
    echo "  $0 -e staging -t v1.0.0        Deploy version v1.0.0 to staging"
    echo "  $0 -d                          Perform a dry run"
    echo "  $0 -s -t latest                Deploy without building images"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -t|--tag)
            BUILD_TAG="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -s|--skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            error "Unknown option $1"
            show_usage
            exit 1
            ;;
    esac
done

# Set error handler
trap cleanup_on_failure ERR

# Main execution
main() {
    log "Starting AI Answer Ninja deployment..."
    log "Environment: $ENVIRONMENT"
    log "Namespace: $NAMESPACE"
    log "Image Tag: $BUILD_TAG"
    log "Dry Run: $DRY_RUN"
    
    check_prerequisites
    build_images
    prepare_secrets
    install_dependencies
    deploy_helm
    verify_deployment
    show_info
}

# Run main function
main "$@"