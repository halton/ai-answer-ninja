#!/bin/bash

# AI Answer Ninja - Local E2E Test Environment Cleanup
# 清理本地E2E测试环境

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup_services() {
    print_status "Stopping E2E test services..."
    
    # Stop services using saved PIDs
    PID_FILES=(".azure-mock.pid" ".user-mgmt.pid" ".realtime.pid" ".whitelist.pid")
    
    for pid_file in "${PID_FILES[@]}"; do
        if [ -f "$pid_file" ]; then
            pid=$(cat "$pid_file")
            if ps -p "$pid" > /dev/null 2>&1; then
                print_status "Stopping process $pid..."
                kill "$pid" 2>/dev/null || print_warning "Failed to stop process $pid"
                sleep 2
                
                # Force kill if still running
                if ps -p "$pid" > /dev/null 2>&1; then
                    print_warning "Force killing process $pid..."
                    kill -9 "$pid" 2>/dev/null || true
                fi
            fi
            rm -f "$pid_file"
        fi
    done
    
    # Kill any remaining services by port
    services_ports=(4000 3005 3002 3006)
    
    for port in "${services_ports[@]}"; do
        pid=$(lsof -ti:$port 2>/dev/null || echo "")
        if [ ! -z "$pid" ]; then
            print_status "Stopping service on port $port (PID: $pid)..."
            kill "$pid" 2>/dev/null || true
            sleep 1
            
            # Force kill if still running
            if ps -p "$pid" > /dev/null 2>&1; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
    done
}

cleanup_docker() {
    print_status "Cleaning up E2E Docker containers..."
    
    # Stop and remove E2E test containers
    containers=("ai-ninja-postgres-e2e" "ai-ninja-redis-e2e")
    
    for container in "${containers[@]}"; do
        if docker ps -a --format "table {{.Names}}" | grep -q "^$container$" 2>/dev/null; then
            print_status "Stopping container $container..."
            docker stop "$container" 2>/dev/null || true
            docker rm "$container" 2>/dev/null || true
            print_success "Container $container removed"
        fi
    done
}

cleanup_temp_files() {
    print_status "Cleaning up temporary files..."
    
    # Remove log files
    rm -f *.log 2>/dev/null || true
    
    # Remove PID files
    rm -f .*.pid 2>/dev/null || true
    
    # Clean up node_modules in test directories (if they exist)
    if [ -d "tests/mocks/node_modules" ]; then
        print_status "Cleaning up mock service dependencies..."
        rm -rf tests/mocks/node_modules 2>/dev/null || true
    fi
    
    print_success "Temporary files cleaned up"
}

reset_environment() {
    print_status "Resetting environment variables..."
    
    unset NODE_ENV
    unset DATABASE_URL
    unset REDIS_URL
    unset AZURE_SPEECH_ENDPOINT
    unset AZURE_OPENAI_ENDPOINT
    unset AZURE_COMMUNICATION_ENDPOINT
    
    print_success "Environment variables reset"
}

verify_cleanup() {
    print_status "Verifying cleanup..."
    
    # Check if any services are still running
    services_ports=(4000 3005 3002 3006)
    running_services=0
    
    for port in "${services_ports[@]}"; do
        if lsof -ti:$port >/dev/null 2>&1; then
            print_warning "Service still running on port $port"
            running_services=$((running_services + 1))
        fi
    done
    
    if [ $running_services -eq 0 ]; then
        print_success "All E2E test services stopped"
    else
        print_warning "$running_services services may still be running"
    fi
    
    # Check Docker containers
    if command -v docker >/dev/null 2>&1; then
        running_containers=$(docker ps -q --filter "name=ai-ninja-*-e2e" 2>/dev/null | wc -l)
        if [ "$running_containers" -eq 0 ]; then
            print_success "No E2E Docker containers running"
        else
            print_warning "$running_containers E2E containers may still be running"
        fi
    fi
}

main() {
    echo "🧹 Cleaning Up AI Answer Ninja E2E Test Environment"
    echo "=================================================="
    
    cleanup_services
    
    # Only cleanup Docker if it's available
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        cleanup_docker
    else
        print_warning "Docker not available or not running, skipping Docker cleanup"
    fi
    
    cleanup_temp_files
    reset_environment
    verify_cleanup
    
    echo
    print_success "🎉 E2E Test Environment Cleanup Complete!"
    echo
    echo "=== Status ==="
    echo "✅ Services stopped"
    echo "✅ Docker containers removed"
    echo "✅ Temporary files cleaned"
    echo "✅ Environment variables reset"
    echo
    echo "To restart the E2E environment, run:"
    echo "./local-e2e-setup.sh"
}

# Handle script interruption
trap 'print_error "Cleanup interrupted!"; exit 1' INT TERM

# Run main function
main "$@"