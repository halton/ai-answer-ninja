#!/bin/bash
set -e

# Docker Build Script for AI Phone Answering System
# Builds all service images with proper tagging and optimization

# Configuration
REGISTRY="${DOCKER_REGISTRY:-ghcr.io/ai-ninja}"
VERSION="${VERSION:-$(git rev-parse --short HEAD)}"
BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
VCS_REF=$(git rev-parse --short HEAD)
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
PUSH_IMAGES="${PUSH_IMAGES:-false}"
BUILD_PARALLEL="${BUILD_PARALLEL:-true}"
CACHE_FROM="${CACHE_FROM:-true}"

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

# Function to build a single service
build_service() {
    local service_name=$1
    local dockerfile_path=$2
    local context_path=${3:-.}
    local target=${4:-production}
    
    log "Building $service_name (target: $target)..."
    
    # Determine base image tag
    local base_tag="$REGISTRY/ai-answer-ninja-$service_name"
    local version_tag="$base_tag:$VERSION"
    local branch_tag="$base_tag:$BRANCH_NAME"
    local latest_tag="$base_tag:latest"
    
    # Build arguments
    local build_args=(
        "--build-arg" "BUILD_DATE=$BUILD_DATE"
        "--build-arg" "VCS_REF=$VCS_REF" 
        "--build-arg" "VERSION=$VERSION"
        "--target" "$target"
        "--tag" "$version_tag"
        "--tag" "$branch_tag"
    )
    
    # Add latest tag for main branch
    if [[ "$BRANCH_NAME" == "main" ]]; then
        build_args+=("--tag" "$latest_tag")
    fi
    
    # Add cache configuration
    if [[ "$CACHE_FROM" == "true" ]]; then
        build_args+=("--cache-from" "$base_tag:cache")
        build_args+=("--cache-to" "type=registry,ref=$base_tag:cache,mode=max")
    fi
    
    # Platform support
    build_args+=("--platform" "linux/amd64,linux/arm64")
    
    # Execute build
    if docker buildx build \
        "${build_args[@]}" \
        -f "$dockerfile_path" \
        "$context_path"; then
        success "Built $service_name successfully"
        
        # Push if requested
        if [[ "$PUSH_IMAGES" == "true" ]]; then
            log "Pushing $service_name to registry..."
            docker push "$version_tag"
            docker push "$branch_tag"
            
            if [[ "$BRANCH_NAME" == "main" ]]; then
                docker push "$latest_tag"
            fi
            
            success "Pushed $service_name to registry"
        fi
        
        return 0
    else
        error "Failed to build $service_name"
        return 1
    fi
}

# Function to build all services in parallel
build_all_parallel() {
    local pids=()
    local services=(
        "realtime-processor:services/realtime-processor/Dockerfile"
        "user-management:services/user-management/Dockerfile"
        "smart-whitelist:services/smart-whitelist/Dockerfile"
        "conversation-engine:services/conversation-engine/Dockerfile"
        "profile-analytics:services/profile-analytics/Dockerfile"
        "conversation-analyzer:services/conversation-analyzer/Dockerfile"
    )
    
    log "Starting parallel builds for ${#services[@]} services..."
    
    for service_config in "${services[@]}"; do
        IFS=':' read -r service_name dockerfile_path <<< "$service_config"
        
        # Start background build
        (
            build_service "$service_name" "$dockerfile_path" "." "production"
        ) &
        
        pids+=($!)
        log "Started build for $service_name (PID: ${pids[-1]})"
    done
    
    # Wait for all builds to complete
    local failed_builds=()
    for i in "${!pids[@]}"; do
        local pid=${pids[$i]}
        local service_name=$(echo "${services[$i]}" | cut -d':' -f1)
        
        if wait $pid; then
            success "Parallel build completed for $service_name"
        else
            error "Parallel build failed for $service_name"
            failed_builds+=("$service_name")
        fi
    done
    
    # Report results
    if [[ ${#failed_builds[@]} -eq 0 ]]; then
        success "All parallel builds completed successfully!"
        return 0
    else
        error "Failed builds: ${failed_builds[*]}"
        return 1
    fi
}

# Function to build all services sequentially
build_all_sequential() {
    local services=(
        "realtime-processor:services/realtime-processor/Dockerfile"
        "user-management:services/user-management/Dockerfile"
        "smart-whitelist:services/smart-whitelist/Dockerfile"
        "conversation-engine:services/conversation-engine/Dockerfile"
        "profile-analytics:services/profile-analytics/Dockerfile"
        "conversation-analyzer:services/conversation-analyzer/Dockerfile"
    )
    
    local failed_builds=()
    
    for service_config in "${services[@]}"; do
        IFS=':' read -r service_name dockerfile_path <<< "$service_config"
        
        if ! build_service "$service_name" "$dockerfile_path" "." "production"; then
            failed_builds+=("$service_name")
        fi
    done
    
    if [[ ${#failed_builds[@]} -eq 0 ]]; then
        success "All sequential builds completed successfully!"
        return 0
    else
        error "Failed builds: ${failed_builds[*]}"
        return 1
    fi
}

# Function to build test images
build_test_images() {
    log "Building test images..."
    
    local test_images=(
        "test-runner:docker/Dockerfile.test-runner"
        "load-tester:docker/Dockerfile.load-tester"
    )
    
    for image_config in "${test_images[@]}"; do
        IFS=':' read -r image_name dockerfile_path <<< "$image_config"
        
        if ! build_service "$image_name" "$dockerfile_path" "." "latest"; then
            warning "Failed to build test image: $image_name"
        fi
    done
}

# Function to validate Docker environment
validate_docker() {
    log "Validating Docker environment..."
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        error "Docker is not running or not accessible"
        exit 1
    fi
    
    # Check if buildx is available
    if ! docker buildx version >/dev/null 2>&1; then
        error "Docker buildx is not available"
        exit 1
    fi
    
    # Create/use buildx builder for multi-platform builds
    if ! docker buildx inspect ai-ninja-builder >/dev/null 2>&1; then
        log "Creating buildx builder instance..."
        docker buildx create --name ai-ninja-builder --use
        docker buildx inspect --bootstrap
    else
        log "Using existing buildx builder..."
        docker buildx use ai-ninja-builder
    fi
    
    success "Docker environment validated"
}

# Function to clean up old images
cleanup_old_images() {
    log "Cleaning up old Docker images..."
    
    # Remove dangling images
    docker image prune -f
    
    # Remove old tagged images (keep last 5)
    for service in realtime-processor user-management smart-whitelist conversation-engine profile-analytics conversation-analyzer; do
        local image_name="$REGISTRY/ai-answer-ninja-$service"
        
        # Get all tags for this image, sort by date, and remove old ones
        docker images --format "table {{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" \
            --filter "reference=$image_name" | \
            tail -n +2 | \
            sort -k2 -r | \
            tail -n +6 | \
            awk '{print $1}' | \
            xargs -r docker rmi || true
    done
    
    success "Cleanup completed"
}

# Function to generate build report
generate_build_report() {
    log "Generating build report..."
    
    local report_file="build-report-$(date +%Y%m%d-%H%M%S).json"
    
    cat > "$report_file" << EOF
{
    "build_info": {
        "version": "$VERSION",
        "branch": "$BRANCH_NAME",
        "build_date": "$BUILD_DATE",
        "vcs_ref": "$VCS_REF",
        "registry": "$REGISTRY"
    },
    "images": [
EOF

    local first=true
    for service in realtime-processor user-management smart-whitelist conversation-engine profile-analytics conversation-analyzer; do
        if [[ "$first" == "false" ]]; then
            echo "," >> "$report_file"
        fi
        first=false
        
        local image_name="$REGISTRY/ai-answer-ninja-$service:$VERSION"
        local image_size=$(docker images --format "{{.Size}}" "$image_name" 2>/dev/null || echo "unknown")
        
        cat >> "$report_file" << EOF
        {
            "service": "$service",
            "image": "$image_name",
            "size": "$image_size"
        }
EOF
    done
    
    cat >> "$report_file" << EOF
    ]
}
EOF

    success "Build report generated: $report_file"
}

# Main execution
main() {
    log "Starting AI Phone Answering System Docker Build"
    log "Configuration:"
    log "  Registry: $REGISTRY"
    log "  Version: $VERSION"
    log "  Branch: $BRANCH_NAME"
    log "  Build Date: $BUILD_DATE"
    log "  VCS Ref: $VCS_REF"
    log "  Push Images: $PUSH_IMAGES"
    log "  Parallel Build: $BUILD_PARALLEL"
    
    # Validate environment
    validate_docker
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --push)
                PUSH_IMAGES=true
                shift
                ;;
            --sequential)
                BUILD_PARALLEL=false
                shift
                ;;
            --parallel)
                BUILD_PARALLEL=true
                shift
                ;;
            --cleanup)
                cleanup_old_images
                shift
                ;;
            --test-images)
                build_test_images
                shift
                ;;
            --service)
                # Build specific service
                if [[ -n $2 ]]; then
                    local service_dockerfile="services/$2/Dockerfile"
                    if [[ -f "$service_dockerfile" ]]; then
                        build_service "$2" "$service_dockerfile"
                    else
                        error "Service $2 not found or no Dockerfile"
                        exit 1
                    fi
                    shift 2
                else
                    error "--service requires a service name"
                    exit 1
                fi
                ;;
            --help|-h)
                echo "Usage: $0 [options]"
                echo "Options:"
                echo "  --push              Push images to registry"
                echo "  --sequential        Build services sequentially"
                echo "  --parallel          Build services in parallel (default)"
                echo "  --cleanup           Clean up old Docker images"
                echo "  --test-images       Build test images"
                echo "  --service NAME      Build specific service"
                echo "  --help              Show this help"
                exit 0
                ;;
            *)
                warning "Unknown option: $1"
                shift
                ;;
        esac
    done
    
    # Build all services
    if [[ "$BUILD_PARALLEL" == "true" ]]; then
        build_all_parallel
    else
        build_all_sequential
    fi
    
    # Generate build report
    generate_build_report
    
    success "Docker build process completed!"
}

# Handle script interruption
trap 'error "Build interrupted"; exit 130' INT TERM

# Execute main function
main "$@"