#!/bin/bash
set -e

# Environment Configuration Management and Deployment Automation Script
# Manages multi-environment deployments for AI Phone Answering System

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVIRONMENTS_DIR="$PROJECT_ROOT/environments"
K8S_DIR="$PROJECT_ROOT/k8s"
DOCKER_DIR="$PROJECT_ROOT/docker"

# Default values
ENVIRONMENT="${ENVIRONMENT:-development}"
ACTION="${ACTION:-deploy}"
SERVICE="${SERVICE:-all}"
DRY_RUN="${DRY_RUN:-false}"
FORCE="${FORCE:-false}"
PARALLEL_BUILDS="${PARALLEL_BUILDS:-true}"
SKIP_TESTS="${SKIP_TESTS:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
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

debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo -e "${CYAN}[$(date +'%Y-%m-%d %H:%M:%S')] 🔍 $1${NC}"
    fi
}

# Function to load environment configuration
load_environment_config() {
    local env=$1
    local config_file="$ENVIRONMENTS_DIR/$env/config.yaml"
    
    if [[ ! -f "$config_file" ]]; then
        error "Environment configuration file not found: $config_file"
        return 1
    fi
    
    log "Loading configuration for environment: $env"
    
    # Export environment variables from config file
    # This is a simplified version - in production you'd use a proper YAML parser
    eval "$(grep -E '^[A-Z_].*=' "$config_file" | sed 's/^/export /')" 2>/dev/null || true
    
    # Set environment-specific defaults
    export ENVIRONMENT="$env"
    export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-$env}"
    export DOCKER_REGISTRY="${DOCKER_REGISTRY:-ghcr.io/ai-ninja}"
    export VERSION="${VERSION:-$(git rev-parse --short HEAD)}"
    
    success "Configuration loaded for environment: $env"
}

# Function to validate environment prerequisites
validate_prerequisites() {
    local env=$1
    
    log "Validating prerequisites for environment: $env"
    
    # Check required tools
    local required_tools=("kubectl" "docker" "git")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            error "Required tool not found: $tool"
            return 1
        fi
    done
    
    # Check Docker daemon
    if ! docker info >/dev/null 2>&1; then
        error "Docker daemon is not running"
        return 1
    fi
    
    # Check Kubernetes connection for non-local environments
    if [[ "$env" != "development" ]]; then
        if ! kubectl cluster-info >/dev/null 2>&1; then
            error "Cannot connect to Kubernetes cluster for environment: $env"
            return 1
        fi
        
        # Verify we're connected to the right cluster
        local current_context=$(kubectl config current-context)
        debug "Current Kubernetes context: $current_context"
        
        if [[ "$env" == "production" && "$current_context" != *"prod"* ]]; then
            warning "Production deployment detected but context doesn't contain 'prod': $current_context"
            if [[ "$FORCE" != "true" ]]; then
                read -p "Continue anyway? (y/N): " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    exit 1
                fi
            fi
        fi
    fi
    
    # Check environment-specific prerequisites
    case "$env" in
        "development")
            # Check if Docker Compose is available
            if ! command -v docker-compose &> /dev/null; then
                warning "docker-compose not found, some development features may not work"
            fi
            ;;
        "staging"|"production")
            # Check if required secrets exist
            local secrets_dir="$ENVIRONMENTS_DIR/$env/secrets"
            if [[ ! -d "$secrets_dir" ]]; then
                error "Secrets directory not found: $secrets_dir"
                return 1
            fi
            
            # Check for required secret files
            local required_secrets=("database.env" "api-keys.env" "jwt-secrets.env")
            for secret in "${required_secrets[@]}"; do
                if [[ ! -f "$secrets_dir/$secret" ]]; then
                    error "Required secret file not found: $secrets_dir/$secret"
                    return 1
                fi
            done
            ;;
    esac
    
    success "Prerequisites validated for environment: $env"
}

# Function to build Docker images
build_images() {
    local env=$1
    local version="${VERSION:-$(git rev-parse --short HEAD)}"
    
    log "Building Docker images for environment: $env (version: $version)"
    
    # Set build arguments based on environment
    local build_args=""
    case "$env" in
        "development")
            build_args="--target development"
            ;;
        "staging")
            build_args="--target production"
            export PUSH_IMAGES=true
            ;;
        "production")
            build_args="--target production"
            export PUSH_IMAGES=true
            export CACHE_FROM=true
            ;;
    esac
    
    # Build images
    if [[ "$PARALLEL_BUILDS" == "true" ]]; then
        export BUILD_PARALLEL=true
    else
        export BUILD_PARALLEL=false
    fi
    
    export VERSION="$version"
    export BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    export VCS_REF=$(git rev-parse --short HEAD)
    
    if [[ "$DRY_RUN" == "true" ]]; then
        info "DRY RUN: Would build images with args: $build_args"
    else
        "$SCRIPT_DIR/build-docker-images.sh" $build_args
    fi
    
    success "Docker images built for environment: $env"
}

# Function to run tests
run_tests() {
    local env=$1
    
    if [[ "$SKIP_TESTS" == "true" ]]; then
        warning "Skipping tests as requested"
        return 0
    fi
    
    log "Running tests for environment: $env"
    
    case "$env" in
        "development")
            # Run unit tests only in development
            log "Running unit tests..."
            if [[ "$DRY_RUN" == "true" ]]; then
                info "DRY RUN: Would run unit tests"
            else
                npm run test:unit || {
                    error "Unit tests failed"
                    return 1
                }
            fi
            ;;
        "staging")
            # Run integration tests in staging
            log "Running integration tests..."
            if [[ "$DRY_RUN" == "true" ]]; then
                info "DRY RUN: Would run integration tests"
            else
                npm run test:integration || {
                    error "Integration tests failed"
                    return 1
                }
            fi
            ;;
        "production")
            # Run smoke tests in production
            log "Running smoke tests..."
            if [[ "$DRY_RUN" == "true" ]]; then
                info "DRY RUN: Would run smoke tests"
            else
                npm run test:smoke || {
                    error "Smoke tests failed"
                    return 1
                }
            fi
            ;;
    esac
    
    success "Tests passed for environment: $env"
}

# Function to apply environment-specific configurations
apply_configurations() {
    local env=$1
    local config_dir="$ENVIRONMENTS_DIR/$env"
    
    log "Applying configurations for environment: $env"
    
    # Apply ConfigMaps
    if [[ -d "$config_dir/configmaps" ]]; then
        for config_file in "$config_dir/configmaps"/*.yaml; do
            if [[ -f "$config_file" ]]; then
                if [[ "$DRY_RUN" == "true" ]]; then
                    info "DRY RUN: Would apply ConfigMap: $config_file"
                else
                    kubectl apply -f "$config_file"
                fi
            fi
        done
    fi
    
    # Apply Secrets
    if [[ -d "$config_dir/secrets" ]]; then
        for secret_file in "$config_dir/secrets"/*.yaml; do
            if [[ -f "$secret_file" ]]; then
                if [[ "$DRY_RUN" == "true" ]]; then
                    info "DRY RUN: Would apply Secret: $secret_file"
                else
                    kubectl apply -f "$secret_file"
                fi
            fi
        done
    fi
    
    # Apply environment-specific Kubernetes manifests
    if [[ -d "$config_dir/k8s" ]]; then
        for k8s_file in "$config_dir/k8s"/*.yaml; do
            if [[ -f "$k8s_file" ]]; then
                if [[ "$DRY_RUN" == "true" ]]; then
                    info "DRY RUN: Would apply K8s manifest: $k8s_file"
                else
                    kubectl apply -f "$k8s_file"
                fi
            fi
        done
    fi
    
    success "Configurations applied for environment: $env"
}

# Function to deploy to Kubernetes
deploy_to_kubernetes() {
    local env=$1
    
    log "Deploying to Kubernetes for environment: $env"
    
    local deploy_script=""
    case "$env" in
        "development")
            # Use docker-compose for local development
            if [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
                if [[ "$DRY_RUN" == "true" ]]; then
                    info "DRY RUN: Would run docker-compose up"
                else
                    docker-compose -f "$PROJECT_ROOT/docker-compose.yml" up -d
                fi
            fi
            ;;
        "staging"|"production")
            # Use Kubernetes deployment script
            deploy_script="$K8S_DIR/$env/deploy.sh"
            if [[ ! -f "$deploy_script" ]]; then
                deploy_script="$K8S_DIR/production/deploy.sh"  # Fallback to production script
            fi
            
            if [[ -f "$deploy_script" ]]; then
                local deploy_args=""
                if [[ "$DRY_RUN" == "true" ]]; then
                    deploy_args="--dry-run"
                fi
                
                if [[ "$SERVICE" != "all" ]]; then
                    deploy_args="$deploy_args --component $SERVICE"
                fi
                
                chmod +x "$deploy_script"
                "$deploy_script" $deploy_args
            else
                error "Deployment script not found: $deploy_script"
                return 1
            fi
            ;;
    esac
    
    success "Deployment completed for environment: $env"
}

# Function to perform health checks
perform_health_checks() {
    local env=$1
    
    log "Performing health checks for environment: $env"
    
    case "$env" in
        "development")
            # Check if services are running via docker-compose
            if [[ "$DRY_RUN" == "true" ]]; then
                info "DRY RUN: Would check docker-compose services"
            else
                docker-compose ps | grep -q "Up" || {
                    warning "Some services may not be running properly"
                }
            fi
            ;;
        "staging"|"production")
            # Check Kubernetes deployments
            if [[ "$DRY_RUN" == "true" ]]; then
                info "DRY RUN: Would check Kubernetes deployments"
            else
                local namespace="${NAMESPACE:-ai-ninja}"
                
                # Check if all pods are running
                local not_running_pods=$(kubectl get pods -n "$namespace" --field-selector=status.phase!=Running --no-headers 2>/dev/null | wc -l)
                if [[ $not_running_pods -gt 0 ]]; then
                    warning "$not_running_pods pods are not in Running state"
                    kubectl get pods -n "$namespace" --field-selector=status.phase!=Running
                fi
                
                # Check service health endpoints
                local services=("user-management" "smart-whitelist" "realtime-processor" "conversation-engine" "profile-analytics")
                for service in "${services[@]}"; do
                    local health_url="http://$service.$namespace.svc.cluster.local:8080/health"
                    kubectl run health-check-$service --rm -i --restart=Never --image=curlimages/curl -- curl -f "$health_url" >/dev/null 2>&1 || {
                        warning "Health check failed for service: $service"
                    }
                done
            fi
            ;;
    esac
    
    success "Health checks completed for environment: $env"
}

# Function to rollback deployment
rollback_deployment() {
    local env=$1
    
    warning "Rolling back deployment for environment: $env"
    
    case "$env" in
        "development")
            if [[ "$DRY_RUN" == "true" ]]; then
                info "DRY RUN: Would stop docker-compose services"
            else
                docker-compose -f "$PROJECT_ROOT/docker-compose.yml" down
            fi
            ;;
        "staging"|"production")
            local deploy_script="$K8S_DIR/$env/deploy.sh"
            if [[ ! -f "$deploy_script" ]]; then
                deploy_script="$K8S_DIR/production/deploy.sh"
            fi
            
            if [[ -f "$deploy_script" ]]; then
                local rollback_args="--rollback"
                if [[ "$DRY_RUN" == "true" ]]; then
                    rollback_args="$rollback_args --dry-run"
                fi
                
                chmod +x "$deploy_script"
                "$deploy_script" $rollback_args
            else
                error "Deployment script not found for rollback: $deploy_script"
                return 1
            fi
            ;;
    esac
    
    success "Rollback completed for environment: $env"
}

# Function to show deployment status
show_status() {
    local env=$1
    
    log "Showing deployment status for environment: $env"
    
    case "$env" in
        "development")
            echo "=== Docker Compose Status ==="
            docker-compose ps 2>/dev/null || echo "No docker-compose services found"
            ;;
        "staging"|"production")
            local namespace="${NAMESPACE:-ai-ninja}"
            
            echo "=== Kubernetes Status ==="
            kubectl get all -n "$namespace" 2>/dev/null || echo "Namespace not found: $namespace"
            
            echo "=== Resource Usage ==="
            kubectl top pods -n "$namespace" 2>/dev/null || echo "Metrics not available"
            
            echo "=== Ingress Status ==="
            kubectl get ingress -n "$namespace" 2>/dev/null || echo "No ingress found"
            ;;
    esac
    
    info "Status display completed for environment: $env"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [options]

Environment Management:
  --environment ENV    Target environment (development, staging, production)
  --action ACTION      Action to perform (deploy, rollback, status, build, test)
  --service SERVICE    Specific service to deploy (default: all)

Build Options:
  --parallel-builds    Build images in parallel (default: true)
  --skip-tests        Skip running tests

Deployment Options:
  --dry-run           Perform a dry run without making changes
  --force             Skip confirmation prompts
  --version VERSION   Specific version to deploy

Examples:
  $0 --environment development --action deploy
  $0 --environment staging --action build --parallel-builds
  $0 --environment production --action deploy --dry-run
  $0 --environment production --action rollback --force
  $0 --environment staging --action status
  $0 --environment development --action test

Environment Files:
  environments/\${ENV}/config.yaml     - Environment configuration
  environments/\${ENV}/secrets/       - Secret files directory
  environments/\${ENV}/k8s/           - Environment-specific K8s manifests

EOF
}

# Main deployment orchestration function
main() {
    log "Starting deployment orchestration"
    log "Environment: $ENVIRONMENT"
    log "Action: $ACTION"
    log "Service: $SERVICE"
    log "Dry Run: $DRY_RUN"
    
    # Load environment configuration
    load_environment_config "$ENVIRONMENT"
    
    # Validate prerequisites
    validate_prerequisites "$ENVIRONMENT"
    
    case "$ACTION" in
        "deploy")
            build_images "$ENVIRONMENT"
            run_tests "$ENVIRONMENT"
            apply_configurations "$ENVIRONMENT"
            deploy_to_kubernetes "$ENVIRONMENT"
            perform_health_checks "$ENVIRONMENT"
            show_status "$ENVIRONMENT"
            ;;
        "build")
            build_images "$ENVIRONMENT"
            ;;
        "test")
            run_tests "$ENVIRONMENT"
            ;;
        "rollback")
            rollback_deployment "$ENVIRONMENT"
            ;;
        "status")
            show_status "$ENVIRONMENT"
            ;;
        *)
            error "Unknown action: $ACTION"
            show_usage
            exit 1
            ;;
    esac
    
    success "Deployment orchestration completed successfully!"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --action)
            ACTION="$2"
            shift 2
            ;;
        --service)
            SERVICE="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --force)
            FORCE="true"
            shift
            ;;
        --parallel-builds)
            PARALLEL_BUILDS="true"
            shift
            ;;
        --skip-tests)
            SKIP_TESTS="true"
            shift
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --debug)
            DEBUG="true"
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

# Validate environment
case "$ENVIRONMENT" in
    "development"|"staging"|"production")
        ;;
    *)
        error "Invalid environment: $ENVIRONMENT"
        error "Valid environments: development, staging, production"
        exit 1
        ;;
esac

# Production safety check
if [[ "$ENVIRONMENT" == "production" && "$FORCE" != "true" && "$DRY_RUN" != "true" ]]; then
    warning "You are about to $ACTION to PRODUCTION environment!"
    read -p "Are you sure you want to continue? Type 'PRODUCTION' to confirm: " confirm
    if [[ "$confirm" != "PRODUCTION" ]]; then
        log "Operation cancelled"
        exit 0
    fi
fi

# Execute main function
main