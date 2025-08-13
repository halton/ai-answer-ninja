#!/bin/bash

# Health check script for AI Answer Ninja Admin Panel
# This script performs basic health checks to ensure the application is running properly

set -e

# Configuration
HEALTH_ENDPOINT="http://localhost/health"
MAIN_ENDPOINT="http://localhost/"
TIMEOUT=3
MAX_RETRIES=3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Function to check HTTP endpoint
check_http_endpoint() {
    local endpoint=$1
    local expected_status=${2:-200}
    local retry_count=0
    
    while [ $retry_count -lt $MAX_RETRIES ]; do
        log_info "Checking endpoint: $endpoint (attempt $((retry_count + 1))/$MAX_RETRIES)"
        
        # Perform HTTP check
        if response=$(curl -s -f --max-time $TIMEOUT -w "%{http_code}" -o /dev/null "$endpoint" 2>/dev/null); then
            if [ "$response" = "$expected_status" ]; then
                log_info "✓ Endpoint $endpoint is healthy (HTTP $response)"
                return 0
            else
                log_warning "✗ Endpoint $endpoint returned HTTP $response (expected $expected_status)"
            fi
        else
            log_warning "✗ Failed to connect to $endpoint"
        fi
        
        retry_count=$((retry_count + 1))
        if [ $retry_count -lt $MAX_RETRIES ]; then
            sleep 1
        fi
    done
    
    log_error "✗ Endpoint $endpoint failed health check after $MAX_RETRIES attempts"
    return 1
}

# Function to check nginx process
check_nginx_process() {
    log_info "Checking nginx process..."
    
    if pgrep nginx > /dev/null; then
        log_info "✓ Nginx process is running"
        return 0
    else
        log_error "✗ Nginx process not found"
        return 1
    fi
}

# Function to check file permissions
check_file_permissions() {
    log_info "Checking file permissions..."
    
    local html_dir="/usr/share/nginx/html"
    
    if [ -d "$html_dir" ]; then
        if [ -r "$html_dir/index.html" ]; then
            log_info "✓ Main application files are accessible"
            return 0
        else
            log_error "✗ Main application files are not readable"
            return 1
        fi
    else
        log_error "✗ Application directory not found: $html_dir"
        return 1
    fi
}

# Function to check disk space
check_disk_space() {
    log_info "Checking disk space..."
    
    local usage=$(df /usr/share/nginx/html | awk 'NR==2 {print $5}' | sed 's/%//')
    local threshold=90
    
    if [ "$usage" -lt "$threshold" ]; then
        log_info "✓ Disk usage is acceptable ($usage%)"
        return 0
    else
        log_warning "✗ High disk usage: $usage% (threshold: $threshold%)"
        return 1
    fi
}

# Function to check memory usage
check_memory_usage() {
    log_info "Checking memory usage..."
    
    if command -v free >/dev/null 2>&1; then
        local memory_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2 }')
        local threshold=90
        
        if [ "$memory_usage" -lt "$threshold" ]; then
            log_info "✓ Memory usage is acceptable ($memory_usage%)"
            return 0
        else
            log_warning "✗ High memory usage: $memory_usage% (threshold: $threshold%)"
            return 1
        fi
    else
        log_info "ℹ Memory check skipped (free command not available)"
        return 0
    fi
}

# Function to validate application files
validate_app_files() {
    log_info "Validating application files..."
    
    local html_dir="/usr/share/nginx/html"
    local required_files=("index.html")
    
    for file in "${required_files[@]}"; do
        if [ -f "$html_dir/$file" ]; then
            log_info "✓ Required file exists: $file"
        else
            log_error "✗ Missing required file: $file"
            return 1
        fi
    done
    
    # Check if static assets directory exists
    if [ -d "$html_dir/assets" ]; then
        local asset_count=$(find "$html_dir/assets" -type f | wc -l)
        if [ "$asset_count" -gt 0 ]; then
            log_info "✓ Static assets found ($asset_count files)"
        else
            log_warning "✗ No static assets found"
            return 1
        fi
    else
        log_warning "✗ Assets directory not found"
    fi
    
    return 0
}

# Main health check function
main() {
    local exit_code=0
    
    log_info "Starting health check for AI Answer Ninja Admin Panel..."
    
    # Critical checks (must pass)
    if ! check_nginx_process; then
        exit_code=1
    fi
    
    if ! check_file_permissions; then
        exit_code=1
    fi
    
    if ! validate_app_files; then
        exit_code=1
    fi
    
    if ! check_http_endpoint "$HEALTH_ENDPOINT"; then
        exit_code=1
    fi
    
    if ! check_http_endpoint "$MAIN_ENDPOINT"; then
        exit_code=1
    fi
    
    # Non-critical checks (warnings only)
    check_disk_space || true
    check_memory_usage || true
    
    # Final result
    if [ $exit_code -eq 0 ]; then
        log_info "🎉 Health check passed - application is healthy"
        exit 0
    else
        log_error "💥 Health check failed - application is unhealthy"
        exit 1
    fi
}

# Run main function
main "$@"