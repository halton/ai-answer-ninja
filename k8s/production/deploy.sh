#!/bin/bash
set -e

# Production Deployment Script for AI Phone Answering System
# Deploys the complete Kubernetes production environment

# Configuration
NAMESPACE="ai-ninja"
MONITORING_NAMESPACE="ai-ninja-monitoring"
CLUSTER_CONTEXT="${CLUSTER_CONTEXT:-production}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_CONFIRMATION="${SKIP_CONFIRMATION:-false}"
COMPONENT="${COMPONENT:-all}"  # all, core, monitoring, networking, storage

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
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

info() {
    echo -e "${PURPLE}[$(date +'%Y-%m-%d %H:%M:%S')] ℹ️  $1${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if kubectl is installed
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed"
        exit 1
    fi
    
    # Check if kubectl can connect to cluster
    if ! kubectl cluster-info &> /dev/null; then
        error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check if correct context is set
    current_context=$(kubectl config current-context)
    if [[ "$current_context" != "$CLUSTER_CONTEXT" ]]; then
        warning "Current context is '$current_context', expected '$CLUSTER_CONTEXT'"
        if [[ "$SKIP_CONFIRMATION" != "true" ]]; then
            read -p "Continue with current context? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    fi
    
    # Check if cert-manager is installed (for SSL certificates)
    if ! kubectl get crd certificates.cert-manager.io &> /dev/null; then
        warning "cert-manager CRDs not found. SSL certificates may not work."
    fi
    
    # Check if NGINX Ingress Controller is installed
    if ! kubectl get namespace ingress-nginx &> /dev/null; then
        warning "NGINX Ingress Controller namespace not found."
    fi
    
    success "Prerequisites check completed"
}

# Function to validate configuration files
validate_configs() {
    log "Validating configuration files..."
    
    local config_files=(
        "namespace.yaml"
        "core-services.yaml"
        "services.yaml"
        "storage.yaml"
        "autoscaling.yaml"
        "ingress.yaml"
        "monitoring.yaml"
        "config-security.yaml"
    )
    
    for file in "${config_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            error "Configuration file '$file' not found"
            exit 1
        fi
        
        # Validate YAML syntax
        if ! kubectl apply --dry-run=client -f "$file" &> /dev/null; then
            error "Invalid YAML syntax in '$file'"
            exit 1
        fi
    done
    
    success "Configuration validation completed"
}

# Function to create namespaces
deploy_namespaces() {
    log "Creating namespaces..."
    
    kubectl apply -f namespace.yaml
    
    # Create monitoring namespace
    kubectl create namespace "$MONITORING_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Label namespaces
    kubectl label namespace "$NAMESPACE" istio-injection=enabled --overwrite
    kubectl label namespace "$NAMESPACE" name="$NAMESPACE" --overwrite
    kubectl label namespace "$MONITORING_NAMESPACE" name="$MONITORING_NAMESPACE" --overwrite
    
    success "Namespaces created"
}

# Function to deploy storage components
deploy_storage() {
    log "Deploying storage components..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        kubectl apply --dry-run=client -f storage.yaml
    else
        kubectl apply -f storage.yaml
        
        # Wait for StorageClasses to be available
        kubectl wait --for=condition=Available storageclass/fast-ssd --timeout=60s || warning "fast-ssd StorageClass not ready"
        kubectl wait --for=condition=Available storageclass/standard-ssd --timeout=60s || warning "standard-ssd StorageClass not ready"
    fi
    
    success "Storage deployment completed"
}

# Function to deploy core services
deploy_core_services() {
    log "Deploying core services..."
    
    # Apply configuration and secrets first
    if [[ "$DRY_RUN" == "true" ]]; then
        kubectl apply --dry-run=client -f config-security.yaml
        kubectl apply --dry-run=client -f core-services.yaml
    else
        kubectl apply -f config-security.yaml
        kubectl apply -f core-services.yaml
        
        # Wait for deployments to be ready
        log "Waiting for core services to be ready..."
        kubectl rollout status deployment/user-management -n "$NAMESPACE" --timeout=300s
        kubectl rollout status deployment/smart-whitelist -n "$NAMESPACE" --timeout=300s
        kubectl rollout status deployment/realtime-processor -n "$NAMESPACE" --timeout=300s
        kubectl rollout status deployment/conversation-engine -n "$NAMESPACE" --timeout=300s
        kubectl rollout status deployment/profile-analytics -n "$NAMESPACE" --timeout=300s
        kubectl rollout status deployment/conversation-analyzer -n "$NAMESPACE" --timeout=300s
    fi
    
    success "Core services deployment completed"
}

# Function to deploy services and networking
deploy_networking() {
    log "Deploying services and networking..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        kubectl apply --dry-run=client -f services.yaml
        kubectl apply --dry-run=client -f ingress.yaml
    else
        kubectl apply -f services.yaml
        kubectl apply -f ingress.yaml
        
        # Wait for services to have endpoints
        log "Waiting for services to have endpoints..."
        local services=("user-management" "smart-whitelist" "realtime-processor" "conversation-engine" "profile-analytics" "conversation-analyzer")
        
        for service in "${services[@]}"; do
            kubectl wait --for=condition=Ready endpoints/"$service" -n "$NAMESPACE" --timeout=120s || warning "Service $service endpoints not ready"
        done
    fi
    
    success "Networking deployment completed"
}

# Function to deploy autoscaling
deploy_autoscaling() {
    log "Deploying autoscaling configuration..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        kubectl apply --dry-run=client -f autoscaling.yaml
    else
        kubectl apply -f autoscaling.yaml
        
        # Verify HPA is working
        log "Verifying HPA configuration..."
        kubectl get hpa -n "$NAMESPACE"
    fi
    
    success "Autoscaling deployment completed"
}

# Function to deploy monitoring
deploy_monitoring() {
    log "Deploying monitoring stack..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        kubectl apply --dry-run=client -f monitoring.yaml
    else
        kubectl apply -f monitoring.yaml
        
        # Wait for monitoring components
        log "Waiting for monitoring components to be ready..."
        kubectl rollout status deployment/prometheus -n "$MONITORING_NAMESPACE" --timeout=300s
        kubectl rollout status deployment/grafana -n "$MONITORING_NAMESPACE" --timeout=300s
        kubectl rollout status deployment/jaeger -n "$MONITORING_NAMESPACE" --timeout=300s
    fi
    
    success "Monitoring deployment completed"
}

# Function to verify deployment
verify_deployment() {
    log "Verifying deployment..."
    
    # Check namespace
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        error "Namespace '$NAMESPACE' not found"
        return 1
    fi
    
    # Check all pods are running
    local not_ready_pods=$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running --no-headers 2>/dev/null | wc -l)
    if [[ $not_ready_pods -gt 0 ]]; then
        warning "$not_ready_pods pods are not in Running state"
        kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running
    fi
    
    # Check services have endpoints
    local services_without_endpoints=$(kubectl get endpoints -n "$NAMESPACE" --no-headers | grep '<none>' | wc -l)
    if [[ $services_without_endpoints -gt 0 ]]; then
        warning "$services_without_endpoints services have no endpoints"
        kubectl get endpoints -n "$NAMESPACE" | grep '<none>'
    fi
    
    # Check ingress
    if kubectl get ingress -n "$NAMESPACE" &> /dev/null; then
        info "Ingress resources:"
        kubectl get ingress -n "$NAMESPACE"
    fi
    
    # Check certificates
    if command -v kubectl &> /dev/null && kubectl get crd certificates.cert-manager.io &> /dev/null; then
        local cert_status=$(kubectl get certificates -n "$NAMESPACE" --no-headers 2>/dev/null | grep -v "True" | wc -l)
        if [[ $cert_status -gt 0 ]]; then
            warning "Some certificates are not ready"
            kubectl get certificates -n "$NAMESPACE"
        fi
    fi
    
    success "Deployment verification completed"
}

# Function to show deployment summary
show_summary() {
    log "Deployment Summary"
    echo
    
    info "Core Services:"
    kubectl get deployments -n "$NAMESPACE" -o wide
    echo
    
    info "Services:"
    kubectl get services -n "$NAMESPACE"
    echo
    
    info "Persistent Volumes:"
    kubectl get pvc -n "$NAMESPACE"
    echo
    
    info "Ingress:"
    kubectl get ingress -n "$NAMESPACE"
    echo
    
    if kubectl get namespace "$MONITORING_NAMESPACE" &> /dev/null; then
        info "Monitoring:"
        kubectl get deployments -n "$MONITORING_NAMESPACE"
        echo
    fi
    
    info "Resource Usage:"
    kubectl top nodes 2>/dev/null || echo "Metrics not available"
    kubectl top pods -n "$NAMESPACE" 2>/dev/null || echo "Pod metrics not available"
    echo
}

# Function to rollback deployment
rollback_deployment() {
    log "Rolling back deployment..."
    
    if [[ "$SKIP_CONFIRMATION" != "true" ]]; then
        read -p "Are you sure you want to rollback? This will delete all resources (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    # Delete in reverse order
    kubectl delete -f autoscaling.yaml --ignore-not-found=true
    kubectl delete -f ingress.yaml --ignore-not-found=true
    kubectl delete -f services.yaml --ignore-not-found=true
    kubectl delete -f core-services.yaml --ignore-not-found=true
    kubectl delete -f config-security.yaml --ignore-not-found=true
    kubectl delete -f storage.yaml --ignore-not-found=true
    kubectl delete -f monitoring.yaml --ignore-not-found=true
    
    # Delete namespaces (this will delete everything in them)
    kubectl delete namespace "$NAMESPACE" --ignore-not-found=true
    kubectl delete namespace "$MONITORING_NAMESPACE" --ignore-not-found=true
    
    success "Rollback completed"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo
    echo "Options:"
    echo "  --component COMP     Deploy specific component (all,core,monitoring,networking,storage)"
    echo "  --dry-run           Perform a dry run without making changes"
    echo "  --skip-confirmation Skip confirmation prompts"
    echo "  --context CONTEXT   Kubernetes context to use"
    echo "  --rollback          Rollback the deployment"
    echo "  --verify            Verify existing deployment"
    echo "  --help              Show this help message"
    echo
    echo "Examples:"
    echo "  $0                                    # Deploy everything"
    echo "  $0 --component core                   # Deploy only core services"
    echo "  $0 --dry-run                         # Dry run deployment"
    echo "  $0 --rollback                        # Rollback deployment"
    echo "  $0 --context staging                 # Deploy to staging context"
}

# Main deployment function
main() {
    log "Starting AI Ninja Production Deployment"
    log "Component: $COMPONENT"
    log "Cluster Context: $CLUSTER_CONTEXT"
    log "Dry Run: $DRY_RUN"
    
    case "$COMPONENT" in
        "all")
            check_prerequisites
            validate_configs
            deploy_namespaces
            deploy_storage
            deploy_core_services
            deploy_networking
            deploy_autoscaling
            deploy_monitoring
            verify_deployment
            show_summary
            ;;
        "core")
            check_prerequisites
            validate_configs
            deploy_namespaces
            deploy_core_services
            verify_deployment
            ;;
        "monitoring")
            check_prerequisites
            deploy_monitoring
            ;;
        "networking")
            check_prerequisites
            deploy_networking
            ;;
        "storage")
            check_prerequisites
            deploy_storage
            ;;
        "verify")
            verify_deployment
            show_summary
            ;;
        "rollback")
            rollback_deployment
            ;;
        *)
            error "Unknown component: $COMPONENT"
            show_usage
            exit 1
            ;;
    esac
    
    success "Deployment completed successfully!"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --component)
            COMPONENT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --skip-confirmation)
            SKIP_CONFIRMATION="true"
            shift
            ;;
        --context)
            CLUSTER_CONTEXT="$2"
            shift 2
            ;;
        --rollback)
            COMPONENT="rollback"
            shift
            ;;
        --verify)
            COMPONENT="verify"
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            warning "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Confirmation prompt for production
if [[ "$CLUSTER_CONTEXT" == "production" && "$SKIP_CONFIRMATION" != "true" && "$DRY_RUN" != "true" ]]; then
    warning "You are about to deploy to PRODUCTION environment!"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Deployment cancelled"
        exit 0
    fi
fi

# Execute main function
main