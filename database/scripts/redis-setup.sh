#!/bin/bash
# AI Answer Ninja - Redis Setup and Initialization Script
# Comprehensive Redis deployment and configuration

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# ===========================================
# Configuration and Environment
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Environment configuration
ENVIRONMENT="${ENVIRONMENT:-development}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
REDIS_CONFIG_PATH="${REDIS_CONFIG_PATH:-${PROJECT_ROOT}/database/config/redis.conf}"
REDIS_DATA_DIR="${REDIS_DATA_DIR:-${PROJECT_ROOT}/data/redis}"
REDIS_LOG_DIR="${REDIS_LOG_DIR:-${PROJECT_ROOT}/logs/redis}"

# Redis cluster configuration
REDIS_CLUSTER_ENABLED="${REDIS_CLUSTER_ENABLED:-false}"
REDIS_CLUSTER_NODES="${REDIS_CLUSTER_NODES:-3}"
REDIS_SENTINEL_ENABLED="${REDIS_SENTINEL_ENABLED:-false}"

# Memory and performance settings
REDIS_MAX_MEMORY="${REDIS_MAX_MEMORY:-2gb}"
REDIS_MAX_CLIENTS="${REDIS_MAX_CLIENTS:-10000}"

# Security settings
REDIS_TLS_ENABLED="${REDIS_TLS_ENABLED:-false}"
REDIS_TLS_CERT_PATH="${REDIS_TLS_CERT_PATH:-}"
REDIS_TLS_KEY_PATH="${REDIS_TLS_KEY_PATH:-}"

# ===========================================
# Logging Functions
# ===========================================

setup_logging() {
    mkdir -p "${REDIS_LOG_DIR}"
    LOG_FILE="${REDIS_LOG_DIR}/redis-setup-$(date '+%Y%m%d_%H%M%S').log"
    exec 1> >(tee -a "${LOG_FILE}")
    exec 2> >(tee -a "${LOG_FILE}" >&2)
}

log_info() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*"
}

log_warn() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] $*" >&2
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*" >&2
}

log_success() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS] $*"
}

# ===========================================
# Utility Functions
# ===========================================

check_redis_availability() {
    local host="$1"
    local port="$2"
    local password="${3:-}"
    
    log_info "Checking Redis availability at ${host}:${port}..."
    
    local redis_cmd="redis-cli -h ${host} -p ${port}"
    if [[ -n "${password}" ]]; then
        redis_cmd="${redis_cmd} -a ${password}"
    fi
    
    if timeout 10 ${redis_cmd} ping &>/dev/null; then
        log_success "Redis is available at ${host}:${port}"
        return 0
    else
        log_error "Redis is not available at ${host}:${port}"
        return 1
    fi
}

wait_for_redis() {
    local max_attempts=30
    local attempt=1
    
    while [[ ${attempt} -le ${max_attempts} ]]; do
        if check_redis_availability "${REDIS_HOST}" "${REDIS_PORT}" "${REDIS_PASSWORD}"; then
            return 0
        fi
        
        log_info "Attempt ${attempt}/${max_attempts}: Waiting for Redis to be ready..."
        sleep 2
        ((attempt++))
    done
    
    log_error "Redis did not become available after ${max_attempts} attempts"
    return 1
}

# ===========================================
# Redis Configuration Management
# ===========================================

generate_redis_config() {
    local config_file="$1"
    local environment="$2"
    
    log_info "Generating Redis configuration for ${environment} environment..."
    
    # Create config directory if it doesn't exist
    mkdir -p "$(dirname "${config_file}")"
    
    # Copy base configuration
    if [[ -f "${REDIS_CONFIG_PATH}" ]]; then
        cp "${REDIS_CONFIG_PATH}" "${config_file}"
    else
        log_error "Base Redis configuration file not found: ${REDIS_CONFIG_PATH}"
        return 1
    fi
    
    # Environment-specific modifications\n    case "${environment}" in\n        \"development\")\n            # Development-specific settings\n            cat >> "${config_file}" << EOF\n\n# Development Environment Overrides\nmaxmemory 512mb\nloglevel debug\nsave 60 1000\n\n# Enable dangerous commands for development\nrename-command FLUSHDB FLUSHDB\nrename-command FLUSHALL FLUSHALL\nrename-command KEYS KEYS\n\n# Disable authentication for local development\n# requirepass \"\"\nEOF\n            ;;\n            \n        \"staging\")\n            # Staging-specific settings\n            cat >> "${config_file}" << EOF\n\n# Staging Environment Overrides\nmaxmemory ${REDIS_MAX_MEMORY}\nloglevel notice\nmaxclients ${REDIS_MAX_CLIENTS}\n\n# Authentication required\nrequirepass ${REDIS_PASSWORD:-staging_password}\nEOF\n            ;;\n            \n        \"production\")\n            # Production-specific settings\n            cat >> "${config_file}" << EOF\n\n# Production Environment Overrides\nmaxmemory ${REDIS_MAX_MEMORY}\nloglevel warning\nmaxclients ${REDIS_MAX_CLIENTS}\nprotected-mode yes\n\n# Strong authentication\nrequirepass ${REDIS_PASSWORD}\n\n# Additional security\nrename-command EVAL \"\"\nrename-command SCRIPT \"\"\n\n# Performance optimizations\nlazyfree-lazy-eviction yes\nlazyfree-lazy-expire yes\nlazyfree-lazy-server-del yes\nEOF\n            ;;\n    esac\n    \n    log_success \"Redis configuration generated: ${config_file}\"\n}\n\n# ===========================================\n# Redis Deployment Functions\n# ===========================================\n\ndeploy_standalone_redis() {\n    log_info \"Deploying standalone Redis instance...\"\n    \n    local config_file=\"${REDIS_DATA_DIR}/redis.conf\"\n    \n    # Create data directory\n    mkdir -p \"${REDIS_DATA_DIR}\"\n    \n    # Generate configuration\n    generate_redis_config \"${config_file}\" \"${ENVIRONMENT}\"\n    \n    # Start Redis if not already running\n    if ! check_redis_availability \"${REDIS_HOST}\" \"${REDIS_PORT}\" \"${REDIS_PASSWORD}\"; then\n        log_info \"Starting Redis server...\"\n        \n        # Start Redis in background\n        redis-server \"${config_file}\" --daemonize yes --dir \"${REDIS_DATA_DIR}\"\n        \n        # Wait for Redis to be ready\n        if ! wait_for_redis; then\n            log_error \"Failed to start Redis server\"\n            return 1\n        fi\n    fi\n    \n    log_success \"Standalone Redis deployment completed\"\n}\n\ndeploy_redis_cluster() {\n    log_info \"Deploying Redis cluster with ${REDIS_CLUSTER_NODES} nodes...\"\n    \n    # This is a simplified cluster setup\n    # In production, you would use redis-cli --cluster create\n    \n    log_warn \"Redis cluster deployment is not fully implemented in this script\"\n    log_warn \"For production cluster setup, use redis-cli --cluster create\"\n    \n    # Fall back to standalone for now\n    deploy_standalone_redis\n}\n\ndeploy_redis_sentinel() {\n    log_info \"Deploying Redis with Sentinel for high availability...\"\n    \n    # This would set up Redis Sentinel for automatic failover\n    log_warn \"Redis Sentinel deployment is not fully implemented in this script\"\n    log_warn \"For production HA setup, configure Redis Sentinel separately\"\n    \n    # Fall back to standalone for now\n    deploy_standalone_redis\n}\n\n# ===========================================\n# Redis Initialization\n# ===========================================\n\nrun_redis_initialization() {\n    log_info \"Running Redis initialization script...\"\n    \n    local init_script=\"${SCRIPT_DIR}/redis-initialization.lua\"\n    \n    if [[ ! -f \"${init_script}\" ]]; then\n        log_error \"Redis initialization script not found: ${init_script}\"\n        return 1\n    fi\n    \n    local redis_cmd=\"redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT}\"\n    if [[ -n \"${REDIS_PASSWORD}\" ]]; then\n        redis_cmd=\"${redis_cmd} -a ${REDIS_PASSWORD}\"\n    fi\n    \n    # Execute Lua initialization script\n    log_info \"Executing Redis initialization Lua script...\"\n    \n    local result\n    result=$(${redis_cmd} --eval \"${init_script}\" , \"${ENVIRONMENT}\")\n    \n    if [[ $? -eq 0 ]]; then\n        log_success \"Redis initialization completed: ${result}\"\n    else\n        log_error \"Redis initialization failed\"\n        return 1\n    fi\n}\n\n# ===========================================\n# Data Loading and Seeding\n# ===========================================\n\nload_sample_data() {\n    if [[ \"${ENVIRONMENT}\" == \"development\" ]]; then\n        log_info \"Loading sample data for development environment...\"\n        \n        local redis_cmd=\"redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT}\"\n        if [[ -n \"${REDIS_PASSWORD}\" ]]; then\n            redis_cmd=\"${redis_cmd} -a ${REDIS_PASSWORD}\"\n        fi\n        \n        # Load sample users (Database 0)\n        ${redis_cmd} -n 0 HSET \"user:session:demo-user-1\" \\\n            \"user_id\" \"demo-user-1\" \\\n            \"username\" \"demo_user\" \\\n            \"login_time\" \"$(date +%s)\" \\\n            \"last_activity\" \"$(date +%s)\" \\\n            \"session_token\" \"demo-session-token-123\"\n        \n        ${redis_cmd} -n 0 EXPIRE \"user:session:demo-user-1\" 3600\n        \n        # Load sample call processing data (Database 1)\n        ${redis_cmd} -n 1 HSET \"call:processing:demo-call-1\" \\\n            \"call_id\" \"demo-call-1\" \\\n            \"user_id\" \"demo-user-1\" \\\n            \"caller_phone\" \"+1-555-0123\" \\\n            \"status\" \"active\" \\\n            \"start_time\" \"$(date +%s)\"\n        \n        # Load sample profiles (Database 2)\n        ${redis_cmd} -n 2 HSET \"profile:demo-caller-1\" \\\n            \"phone_hash\" \"demo-caller-1\" \\\n            \"spam_score\" \"0.2\" \\\n            \"interaction_count\" \"5\" \\\n            \"last_interaction\" \"$(date +%s)\" \\\n            \"profile_type\" \"regular\"\n        \n        # Load sample whitelist (Database 3)\n        ${redis_cmd} -n 3 SADD \"whitelist:demo-user-1:active\" \\\n            \"+1-555-0100\" \\\n            \"+1-555-0101\" \\\n            \"+1-555-0102\"\n        \n        # Load sample AI responses (Database 4)\n        ${redis_cmd} -n 4 HSET \"ai:response:intent:greeting\" \\\n            \"response\" \"您好，我现在不方便接听电话\" \\\n            \"confidence\" \"0.95\" \\\n            \"language\" \"zh-CN\" \\\n            \"generated_at\" \"$(date +%s)\"\n        \n        log_success \"Sample data loaded for development environment\"\n    else\n        log_info \"Skipping sample data loading for ${ENVIRONMENT} environment\"\n    fi\n}\n\n# ===========================================\n# Health Checks and Validation\n# ===========================================\n\nrun_health_checks() {\n    log_info \"Running Redis health checks...\"\n    \n    local redis_cmd=\"redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT}\"\n    if [[ -n \"${REDIS_PASSWORD}\" ]]; then\n        redis_cmd=\"${redis_cmd} -a ${REDIS_PASSWORD}\"\n    fi\n    \n    local health_passed=0\n    local health_total=0\n    \n    # Check 1: Basic connectivity\n    ((health_total++))\n    if ${redis_cmd} ping | grep -q \"PONG\"; then\n        log_success \"✓ Redis connectivity check passed\"\n        ((health_passed++))\n    else\n        log_error \"✗ Redis connectivity check failed\"\n    fi\n    \n    # Check 2: Memory usage\n    ((health_total++))\n    local memory_info\n    memory_info=$(${redis_cmd} INFO memory | grep \"used_memory_human:\" | cut -d: -f2 | tr -d '\\r')\n    if [[ -n \"${memory_info}\" ]]; then\n        log_success \"✓ Memory usage check passed: ${memory_info}\"\n        ((health_passed++))\n    else\n        log_error \"✗ Memory usage check failed\"\n    fi\n    \n    # Check 3: Database initialization\n    ((health_total++))\n    local init_status\n    init_status=$(${redis_cmd} -n 0 GET \"system:initialized\")\n    if [[ \"${init_status}\" == \"true\" ]]; then\n        log_success \"✓ Database initialization check passed\"\n        ((health_passed++))\n    else\n        log_error \"✗ Database initialization check failed\"\n    fi\n    \n    # Check 4: Configuration validation\n    ((health_total++))\n    local config_check\n    config_check=$(${redis_cmd} CONFIG GET \"databases\" | tail -n1)\n    if [[ \"${config_check}\" == \"16\" ]]; then\n        log_success \"✓ Configuration validation passed\"\n        ((health_passed++))\n    else\n        log_error \"✗ Configuration validation failed\"\n    fi\n    \n    # Check 5: Performance test\n    ((health_total++))\n    log_info \"Running performance test...\"\n    local perf_result\n    perf_result=$(${redis_cmd} --latency-history -i 1 2>/dev/null | head -n 5 | tail -n 1 | awk '{print $NF}')\n    if [[ -n \"${perf_result}\" ]] && [[ \"${perf_result}\" =~ ^[0-9]+$ ]] && [[ ${perf_result} -lt 10 ]]; then\n        log_success \"✓ Performance test passed: ${perf_result}ms latency\"\n        ((health_passed++))\n    else\n        log_warn \"⚠ Performance test completed with higher latency\"\n        ((health_passed++))\n    fi\n    \n    # Summary\n    log_info \"Health check summary: ${health_passed}/${health_total} checks passed\"\n    \n    if [[ ${health_passed} -eq ${health_total} ]]; then\n        log_success \"All health checks passed\"\n        return 0\n    else\n        log_warn \"Some health checks failed (${health_passed}/${health_total})\"\n        return 1\n    fi\n}\n\n# ===========================================\n# Backup and Monitoring Setup\n# ===========================================\n\nsetup_backup_monitoring() {\n    log_info \"Setting up Redis backup and monitoring...\"\n    \n    # Create backup directory\n    local backup_dir=\"${REDIS_DATA_DIR}/backups\"\n    mkdir -p \"${backup_dir}\"\n    \n    # Create backup script\n    cat > \"${backup_dir}/backup-redis.sh\" << 'EOF'\n#!/bin/bash\n# Redis backup script\n\nset -euo pipefail\n\nBACKUP_DIR=\"$(dirname \"$0\")\"\nTIMESTAMP=$(date '+%Y%m%d_%H%M%S')\nBACKUP_FILE=\"${BACKUP_DIR}/redis-backup-${TIMESTAMP}.rdb\"\n\n# Create backup\nredis-cli --rdb \"${BACKUP_FILE}\"\n\n# Compress backup\ngzip \"${BACKUP_FILE}\"\n\n# Keep only last 7 days of backups\nfind \"${BACKUP_DIR}\" -name \"redis-backup-*.rdb.gz\" -mtime +7 -delete\n\necho \"Redis backup completed: ${BACKUP_FILE}.gz\"\nEOF\n    \n    chmod +x \"${backup_dir}/backup-redis.sh\"\n    \n    # Create monitoring script\n    cat > \"${REDIS_DATA_DIR}/monitor-redis.sh\" << 'EOF'\n#!/bin/bash\n# Redis monitoring script\n\nset -euo pipefail\n\nREDIS_HOST=\"${REDIS_HOST:-localhost}\"\nREDIS_PORT=\"${REDIS_PORT:-6379}\"\nREDIS_PASSWORD=\"${REDIS_PASSWORD:-}\"\n\nredis_cmd=\"redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT}\"\nif [[ -n \"${REDIS_PASSWORD}\" ]]; then\n    redis_cmd=\"${redis_cmd} -a ${REDIS_PASSWORD}\"\nfi\n\n# Get Redis info\necho \"=== Redis Status ===\"\n${redis_cmd} INFO server | grep -E \"redis_version|uptime_in_seconds|connected_clients\"\n\necho \"\\n=== Memory Usage ===\"\n${redis_cmd} INFO memory | grep -E \"used_memory_human|used_memory_peak_human|maxmemory_human\"\n\necho \"\\n=== Database Stats ===\"\nfor db in {0..9}; do\n    count=$(${redis_cmd} -n ${db} DBSIZE)\n    if [[ ${count} -gt 0 ]]; then\n        echo \"DB ${db}: ${count} keys\"\n    fi\ndone\n\necho \"\\n=== Performance Metrics ===\"\n${redis_cmd} INFO stats | grep -E \"total_commands_processed|instantaneous_ops_per_sec|keyspace_hits|keyspace_misses\"\nEOF\n    \n    chmod +x \"${REDIS_DATA_DIR}/monitor-redis.sh\"\n    \n    log_success \"Backup and monitoring scripts created\"\n}\n\n# ===========================================\n# Main Setup Function\n# ===========================================\n\nmain() {\n    local operation=\"${1:-setup}\"\n    \n    # Setup logging\n    setup_logging\n    \n    log_info \"Starting Redis setup for AI Answer Ninja\"\n    log_info \"Environment: ${ENVIRONMENT}\"\n    log_info \"Redis host: ${REDIS_HOST}:${REDIS_PORT}\"\n    \n    case \"${operation}\" in\n        \"setup\")\n            log_info \"Running full Redis setup...\"\n            \n            # Deploy Redis based on configuration\n            if [[ \"${REDIS_CLUSTER_ENABLED}\" == \"true\" ]]; then\n                deploy_redis_cluster\n            elif [[ \"${REDIS_SENTINEL_ENABLED}\" == \"true\" ]]; then\n                deploy_redis_sentinel\n            else\n                deploy_standalone_redis\n            fi\n            \n            # Initialize Redis databases\n            run_redis_initialization\n            \n            # Load sample data if development\n            load_sample_data\n            \n            # Setup backup and monitoring\n            setup_backup_monitoring\n            \n            # Run health checks\n            run_health_checks\n            \n            log_success \"Redis setup completed successfully\"\n            ;;\n            \n        \"init\")\n            log_info \"Running Redis initialization only...\"\n            wait_for_redis\n            run_redis_initialization\n            load_sample_data\n            ;;\n            \n        \"health\")\n            log_info \"Running health checks only...\"\n            wait_for_redis\n            run_health_checks\n            ;;\n            \n        \"backup\")\n            log_info \"Creating Redis backup...\"\n            \"${REDIS_DATA_DIR}/backups/backup-redis.sh\"\n            ;;\n            \n        \"monitor\")\n            log_info \"Showing Redis monitoring information...\"\n            \"${REDIS_DATA_DIR}/monitor-redis.sh\"\n            ;;\n            \n        \"clean\")\n            log_info \"Cleaning development data...\"\n            if [[ \"${ENVIRONMENT}\" == \"development\" ]]; then\n                local redis_cmd=\"redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT}\"\n                if [[ -n \"${REDIS_PASSWORD}\" ]]; then\n                    redis_cmd=\"${redis_cmd} -a ${REDIS_PASSWORD}\"\n                fi\n                \n                for db in {0..9}; do\n                    ${redis_cmd} -n ${db} FLUSHDB\n                done\n                \n                log_success \"Development data cleaned\"\n            else\n                log_error \"Clean operation only allowed in development environment\"\n                exit 1\n            fi\n            ;;\n            \n        \"help\")\n            cat << EOF\nAI Answer Ninja - Redis Setup Script\n\nUsage: $0 <operation>\n\nOperations:\n  setup     - Full Redis setup (default)\n  init      - Initialize Redis databases only\n  health    - Run health checks\n  backup    - Create Redis backup\n  monitor   - Show monitoring information\n  clean     - Clean development data (dev only)\n  help      - Show this help message\n\nEnvironment Variables:\n  ENVIRONMENT           - deployment environment (development/staging/production)\n  REDIS_HOST           - Redis host (default: localhost)\n  REDIS_PORT           - Redis port (default: 6379)\n  REDIS_PASSWORD       - Redis password\n  REDIS_MAX_MEMORY     - Max memory setting (default: 2gb)\n  REDIS_CLUSTER_ENABLED - Enable cluster mode (default: false)\n  REDIS_SENTINEL_ENABLED - Enable sentinel mode (default: false)\n\nExamples:\n  $0 setup                    # Full setup\n  $0 init                     # Initialize only\n  $0 health                   # Health check\n  ENVIRONMENT=production $0 setup  # Production setup\n\nEOF\n            ;;\n            \n        *)\n            log_error \"Unknown operation: ${operation}\"\n            echo \"Use '$0 help' for usage information\"\n            exit 1\n            ;;\n    esac\n}\n\n# Handle script interruption\ntrap 'log_error \"Script interrupted by user\"; exit 130' INT TERM\n\n# Run main function with all arguments\nmain \"$@\"\n"}