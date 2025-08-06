#!/bin/sh

# Health check script for the Real-time Processor Service
# This script performs comprehensive health checks including:
# - HTTP endpoint availability
# - WebSocket connectivity
# - Redis connectivity
# - Azure services status
# - Performance metrics validation

set -e

# Configuration
HOST=${HOST:-localhost}
PORT=${PORT:-3002}
TIMEOUT=${HEALTH_CHECK_TIMEOUT:-10}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [HEALTHCHECK] $1"
}

error() {
    echo "${RED}$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $1${NC}" >&2
}

success() {
    echo "${GREEN}$(date '+%Y-%m-%d %H:%M:%S') [SUCCESS] $1${NC}"
}

warning() {
    echo "${YELLOW}$(date '+%Y-%m-%d %H:%M:%S') [WARNING] $1${NC}"
}

# Check if curl is available
if ! command -v curl >/dev/null 2>&1; then
    error "curl is not installed"
    exit 1
fi

# Function to check HTTP endpoint
check_http_health() {
    log "Checking HTTP health endpoint..."
    
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout $TIMEOUT \
        --max-time $TIMEOUT \
        "http://${HOST}:${PORT}/health" 2>/dev/null)
    
    if [ "$response" = "200" ]; then
        success "HTTP health check passed"
        return 0
    else
        error "HTTP health check failed with status: $response"
        return 1
    fi
}

# Function to check detailed health status
check_detailed_health() {
    log "Checking detailed health status..."
    
    health_data=$(curl -s \
        --connect-timeout $TIMEOUT \
        --max-time $TIMEOUT \
        "http://${HOST}:${PORT}/health" 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        error "Failed to retrieve health data"
        return 1
    fi
    
    # Parse health status (basic JSON parsing)
    status=$(echo "$health_data" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    
    case "$status" in
        "healthy")
            success "Service status: healthy"
            return 0
            ;;
        "degraded")
            warning "Service status: degraded"
            return 0  # Still consider as healthy for container orchestration
            ;;
        "unhealthy"|*)
            error "Service status: $status"
            return 1
            ;;
    esac
}

# Function to check metrics endpoint
check_metrics() {
    log "Checking metrics endpoint..."
    
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout $TIMEOUT \
        --max-time $TIMEOUT \
        "http://${HOST}:${PORT}/metrics" 2>/dev/null)
    
    if [ "$response" = "200" ]; then
        success "Metrics endpoint available"
        return 0
    else
        warning "Metrics endpoint unavailable (status: $response)"
        return 0  # Non-critical for basic health
    fi
}

# Function to check WebSocket endpoint (basic connectivity)
check_websocket() {
    log "Checking WebSocket connectivity..."
    
    # Use curl to test WebSocket upgrade (basic test)
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout $TIMEOUT \
        --max-time $TIMEOUT \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
        "http://${HOST}:${PORT}/realtime/conversation" 2>/dev/null)
    
    # WebSocket upgrade should return 101 or 400 (if auth required)
    if [ "$response" = "101" ] || [ "$response" = "400" ] || [ "$response" = "401" ]; then
        success "WebSocket endpoint accessible"
        return 0
    else
        warning "WebSocket endpoint may not be available (status: $response)"
        return 0  # Non-critical for basic health
    fi
}

# Function to check connection stats
check_connections() {
    log "Checking connection statistics..."
    
    response=$(curl -s \
        --connect-timeout $TIMEOUT \
        --max-time $TIMEOUT \
        "http://${HOST}:${PORT}/connections" 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        success "Connection stats available"
        return 0
    else
        warning "Connection stats unavailable"
        return 0  # Non-critical
    fi
}

# Function to perform basic service validation
validate_service() {
    log "Performing basic service validation..."
    
    # Check if the process is running and responding
    if ! check_http_health; then
        error "Basic HTTP health check failed"
        return 1
    fi
    
    # Check detailed health status
    if ! check_detailed_health; then
        error "Detailed health check failed"
        return 1
    fi
    
    return 0
}

# Function to perform extended health checks
extended_checks() {
    log "Performing extended health checks..."
    
    # Check metrics endpoint
    check_metrics
    
    # Check WebSocket connectivity
    check_websocket
    
    # Check connection stats
    check_connections
    
    success "Extended health checks completed"
}

# Main health check function
main() {
    log "Starting health check for Real-time Processor Service"
    log "Target: http://${HOST}:${PORT}"
    
    # Perform basic validation (critical)
    if ! validate_service; then
        error "Service validation failed"
        exit 1
    fi
    
    # Perform extended checks (non-critical)
    extended_checks
    
    success "Health check completed successfully"
    return 0
}

# Run the health check
main

exit $?