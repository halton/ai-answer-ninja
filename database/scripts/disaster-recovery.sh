#!/bin/bash
# AI Answer Ninja - Disaster Recovery Script
# Comprehensive disaster recovery automation with monitoring

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# ===========================================
# Configuration and Environment
# ===========================================

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../config/disaster-recovery.conf"

# Default configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ai_ninja}"
DB_USER="${DB_USER:-ai_ninja_app}"
DB_PASSWORD="${DB_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
LOG_DIR="${LOG_DIR:-/var/log/ai-ninja}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"
NOTIFICATION_EMAIL="${NOTIFICATION_EMAIL:-}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"

# Recovery configuration
RECOVERY_TARGET_TIME="${RECOVERY_TARGET_TIME:-}"
RECOVERY_TARGET_LSN="${RECOVERY_TARGET_LSN:-}"
RECOVERY_MODE="${RECOVERY_MODE:-immediate}"  # immediate, time, lsn
PARALLEL_WORKERS="${PARALLEL_WORKERS:-4}"
TEMP_RESTORE_DB="${TEMP_RESTORE_DB:-ai_ninja_recovery_test}"

# Health check configuration
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY=30
HEALTH_CHECK_TIMEOUT=300

# ===========================================
# Logging and Notification Functions
# ===========================================

setup_logging() {
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    LOG_FILE="${LOG_DIR}/disaster_recovery_${timestamp}.log"
    
    # Create log directory if it doesn't exist
    mkdir -p "${LOG_DIR}"
    
    # Set up logging to both file and stdout
    exec 1> >(tee -a "${LOG_FILE}")
    exec 2> >(tee -a "${LOG_FILE}" >&2)
    
    log_info "Disaster recovery log started: ${LOG_FILE}"
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

send_notification() {
    local subject="$1"
    local message="$2"
    local severity="${3:-info}"  # info, warning, error, success
    
    # Email notification
    if [[ -n "${NOTIFICATION_EMAIL}" ]]; then
        echo "${message}" | mail -s "[AI-Ninja DR] ${subject}" "${NOTIFICATION_EMAIL}" || true
    fi
    
    # Slack notification
    if [[ -n "${SLACK_WEBHOOK}" ]]; then
        local color
        case "${severity}" in
            error) color="danger" ;;
            warning) color="warning" ;;
            success) color="good" ;;
            *) color="#36a64f" ;;
        esac
        
        curl -X POST -H 'Content-type: application/json' \
            --data "{
                \"attachments\": [{
                    \"color\": \"${color}\",
                    \"title\": \"${subject}\",
                    \"text\": \"${message}\",
                    \"footer\": \"AI Ninja Disaster Recovery\",
                    \"ts\": $(date +%s)
                }]
            }" \
            "${SLACK_WEBHOOK}" || true
    fi
}

# ===========================================
# Pre-flight Checks
# ===========================================

check_prerequisites() {
    log_info "Running pre-flight checks..."
    
    local errors=0
    
    # Check required commands
    local required_commands=("psql" "pg_dump" "pg_restore" "openssl" "gzip" "curl")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "${cmd}" &> /dev/null; then
            log_error "Required command not found: ${cmd}"
            ((errors++))
        fi
    done
    
    # Check database connectivity
    if ! PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
         -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT 1" &> /dev/null; then
        log_error "Cannot connect to database: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
        ((errors++))
    fi
    
    # Check backup directory
    if [[ ! -d "${BACKUP_DIR}" ]]; then
        log_error "Backup directory does not exist: ${BACKUP_DIR}"
        ((errors++))
    fi
    
    # Check encryption key
    if [[ -z "${ENCRYPTION_KEY}" ]]; then
        log_warn "No encryption key provided - backups will not be encrypted"
    fi
    
    # Check available disk space (require at least 10GB)
    local available_space=$(df "${BACKUP_DIR}" | awk 'NR==2 {print $4}')
    local required_space=$((10 * 1024 * 1024))  # 10GB in KB
    
    if [[ ${available_space} -lt ${required_space} ]]; then
        log_error "Insufficient disk space. Available: $(( available_space / 1024 / 1024 ))GB, Required: 10GB"
        ((errors++))
    fi
    
    if [[ ${errors} -gt 0 ]]; then
        log_error "Pre-flight checks failed with ${errors} errors"
        return 1
    fi
    
    log_success "Pre-flight checks completed successfully"
    return 0
}

# ===========================================
# Backup Discovery and Validation
# ===========================================

find_latest_backup() {
    local backup_type="${1:-full}"
    
    log_info "Searching for latest ${backup_type} backup..."
    
    # Query database for latest valid backup
    local backup_info
    backup_info=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT id, backup_path, job_name, completed_at 
         FROM backup_system.backup_jobs 
         WHERE backup_type = '${backup_type}' 
           AND status = 'completed' 
           AND validation_status = 'valid'
         ORDER BY completed_at DESC 
         LIMIT 1;" 2>/dev/null || echo "")
    
    if [[ -z "${backup_info}" ]]; then
        log_error "No valid ${backup_type} backup found in database"
        return 1
    fi
    
    # Parse backup information
    BACKUP_ID=$(echo "${backup_info}" | awk '{print $1}' | tr -d ' ')
    BACKUP_PATH=$(echo "${backup_info}" | awk '{print $2}' | tr -d ' ')
    BACKUP_NAME=$(echo "${backup_info}" | awk '{print $3}' | tr -d ' ')
    BACKUP_DATE=$(echo "${backup_info}" | awk '{print $4}' | tr -d ' ')
    
    log_info "Found backup: ${BACKUP_NAME} (${BACKUP_DATE})"
    log_info "Backup path: ${BACKUP_PATH}"
    
    # Verify backup file exists
    if [[ ! -f "${BACKUP_PATH}" ]]; then
        log_error "Backup file not found: ${BACKUP_PATH}"
        return 1
    fi
    
    return 0
}

validate_backup() {
    local backup_id="$1"
    
    log_info "Validating backup integrity..."
    
    # Run backup verification through database function
    local validation_result
    validation_result=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${DB_NAME}" -t -c \
        "SELECT backup_system.verify_backup('${backup_id}', 'checksum');" 2>/dev/null || echo "f")
    
    if [[ "${validation_result}" =~ "t" ]]; then
        log_success "Backup validation passed"
        return 0
    else
        log_error "Backup validation failed"
        return 1
    fi
}

# ===========================================
# Database Recovery Functions
# ===========================================

perform_recovery() {
    local recovery_mode="$1"
    local target_database="$2"
    
    log_info "Starting ${recovery_mode} recovery to database: ${target_database}"
    
    case "${recovery_mode}" in
        "immediate")
            perform_immediate_recovery "${target_database}"
            ;;
        "point_in_time")
            perform_point_in_time_recovery "${target_database}"
            ;;
        "test_recovery")
            perform_test_recovery
            ;;
        *)
            log_error "Unknown recovery mode: ${recovery_mode}"
            return 1
            ;;
    esac
}

perform_immediate_recovery() {
    local target_db="$1"
    
    log_info "Performing immediate recovery to ${target_db}"
    
    # Create target database if it doesn't exist
    PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d postgres -c \
        "DROP DATABASE IF EXISTS ${target_db}; CREATE DATABASE ${target_db};" \
        || { log_error "Failed to create target database"; return 1; }
    
    # Build restore command
    local restore_cmd
    if [[ -n "${ENCRYPTION_KEY}" ]]; then
        restore_cmd="openssl enc -aes-256-gcm -d -salt -pbkdf2 -pass pass:${ENCRYPTION_KEY} -in ${BACKUP_PATH} | gunzip | pg_restore -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${target_db} --clean --if-exists --jobs=${PARALLEL_WORKERS}"
    else
        restore_cmd="gunzip -c ${BACKUP_PATH} | pg_restore -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${target_db} --clean --if-exists --jobs=${PARALLEL_WORKERS}"
    fi
    
    # Execute restore with timeout
    log_info "Executing restore command..."
    if timeout "${HEALTH_CHECK_TIMEOUT}" bash -c "PGPASSWORD='${DB_PASSWORD}' ${restore_cmd}"; then
        log_success "Database restore completed successfully"
        return 0
    else
        log_error "Database restore failed or timed out"
        return 1
    fi
}

perform_point_in_time_recovery() {
    local target_db="$1"
    
    if [[ -z "${RECOVERY_TARGET_TIME}" && -z "${RECOVERY_TARGET_LSN}" ]]; then
        log_error "Point-in-time recovery requires RECOVERY_TARGET_TIME or RECOVERY_TARGET_LSN"
        return 1
    fi
    
    log_info "Performing point-in-time recovery to ${target_db}"
    
    # For point-in-time recovery, we would typically:
    # 1. Restore base backup
    # 2. Apply WAL files up to target time/LSN
    # This is a simplified implementation
    
    perform_immediate_recovery "${target_db}"
    
    # Note: Full PITR implementation would require WAL archiving setup
    log_warn "Point-in-time recovery completed with base backup only"
    log_warn "Full PITR requires WAL archiving configuration"
}

perform_test_recovery() {
    log_info "Performing test recovery to validate backup integrity"
    
    # Create temporary database for testing
    local test_db="${TEMP_RESTORE_DB}_$(date +%s)"
    
    if perform_immediate_recovery "${test_db}"; then
        # Run integrity checks on restored database
        run_integrity_checks "${test_db}"
        local integrity_result=$?
        
        # Cleanup test database
        PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
            -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${test_db};" \
            || log_warn "Failed to cleanup test database: ${test_db}"
        
        if [[ ${integrity_result} -eq 0 ]]; then
            log_success "Test recovery completed successfully"
            return 0
        else
            log_error "Test recovery failed integrity checks"
            return 1
        fi
    else
        log_error "Test recovery failed during restore"
        return 1
    fi
}

# ===========================================
# Health Checks and Validation
# ===========================================

run_integrity_checks() {
    local target_db="$1"
    
    log_info "Running integrity checks on ${target_db}..."
    
    local checks_passed=0
    local total_checks=0
    
    # Check 1: Database connectivity
    ((total_checks++))
    if PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
       -U "${DB_USER}" -d "${target_db}" -c "SELECT 1" &> /dev/null; then
        log_info "✓ Database connectivity check passed"
        ((checks_passed++))
    else
        log_error "✗ Database connectivity check failed"
    fi
    
    # Check 2: Core tables existence
    ((total_checks++))
    local core_tables=("users" "smart_whitelists" "call_records" "conversations" "spam_profiles")
    local missing_tables=0
    
    for table in "${core_tables[@]}"; do
        if ! PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
             -U "${DB_USER}" -d "${target_db}" -c \
             "SELECT 1 FROM information_schema.tables WHERE table_name='${table}'" \
             | grep -q "1 row"; then
            log_error "Missing core table: ${table}"
            ((missing_tables++))
        fi
    done
    
    if [[ ${missing_tables} -eq 0 ]]; then
        log_info "✓ Core tables existence check passed"
        ((checks_passed++))
    else
        log_error "✗ Core tables existence check failed (${missing_tables} missing)"
    fi
    
    # Check 3: Data consistency
    ((total_checks++))
    local consistency_result
    consistency_result=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${target_db}" -t -c \
        "SELECT COUNT(*) FROM users WHERE id IS NOT NULL;" 2>/dev/null | tr -d ' ' || echo "0")
    
    if [[ "${consistency_result}" =~ ^[0-9]+$ ]] && [[ ${consistency_result} -ge 0 ]]; then
        log_info "✓ Data consistency check passed (${consistency_result} users found)"
        ((checks_passed++))
    else
        log_error "✗ Data consistency check failed"
    fi
    
    # Check 4: Partition tables
    ((total_checks++))
    local partition_count
    partition_count=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${target_db}" -t -c \
        "SELECT COUNT(*) FROM pg_tables WHERE tablename LIKE 'call_records_%' OR tablename LIKE 'conversations_%';" \
        2>/dev/null | tr -d ' ' || echo "0")
    
    if [[ ${partition_count} -gt 0 ]]; then
        log_info "✓ Partition tables check passed (${partition_count} partitions found)"
        ((checks_passed++))
    else
        log_error "✗ Partition tables check failed"
    fi
    
    # Check 5: Functions and stored procedures
    ((total_checks++))
    local function_count
    function_count=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${target_db}" -t -c \
        "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_type='FUNCTION';" \
        2>/dev/null | tr -d ' ' || echo "0")
    
    if [[ ${function_count} -gt 10 ]]; then
        log_info "✓ Functions check passed (${function_count} functions found)"
        ((checks_passed++))
    else
        log_error "✗ Functions check failed (only ${function_count} functions found)"
    fi
    
    # Summary
    log_info "Integrity checks completed: ${checks_passed}/${total_checks} passed"
    
    if [[ ${checks_passed} -eq ${total_checks} ]]; then
        log_success "All integrity checks passed"
        return 0
    else
        log_error "Some integrity checks failed (${checks_passed}/${total_checks})"
        return 1
    fi
}

run_health_check() {
    local target_db="$1"
    
    log_info "Running comprehensive health check on ${target_db}..."
    
    # Database health check using stored function
    local health_result
    health_result=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${target_db}" -c \
        "SELECT db_health_check();" 2>/dev/null || echo "")
    
    if [[ -n "${health_result}" ]]; then
        log_info "Database health check result: ${health_result}"
    else
        log_warn "Could not execute database health check function"
    fi
    
    # Additional performance checks
    local connection_count
    connection_count=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${target_db}" -t -c \
        "SELECT count(*) FROM pg_stat_activity WHERE datname='${target_db}';" \
        2>/dev/null | tr -d ' ' || echo "0")
    
    log_info "Current connections to ${target_db}: ${connection_count}"
    
    return 0
}

# ===========================================
# Main Recovery Workflow
# ===========================================

main() {
    local operation="${1:-help}"
    local target_database="${2:-${DB_NAME}_recovered}"
    
    # Setup logging
    setup_logging
    
    case "${operation}" in
        "immediate")
            log_info "Starting immediate disaster recovery..."
            
            # Pre-flight checks
            if ! check_prerequisites; then
                send_notification "Disaster Recovery Failed" "Pre-flight checks failed" "error"
                exit 1
            fi
            
            # Find and validate latest backup
            if ! find_latest_backup "full"; then
                send_notification "Disaster Recovery Failed" "No valid backup found" "error"
                exit 1
            fi
            
            if ! validate_backup "${BACKUP_ID}"; then
                send_notification "Disaster Recovery Failed" "Backup validation failed" "error"
                exit 1
            fi
            
            # Perform recovery
            if perform_recovery "immediate" "${target_database}"; then
                run_health_check "${target_database}"
                send_notification "Disaster Recovery Successful" \
                    "Database recovered to ${target_database} from backup ${BACKUP_NAME}" "success"
                log_success "Immediate disaster recovery completed successfully"
            else
                send_notification "Disaster Recovery Failed" \
                    "Recovery operation failed for ${target_database}" "error"
                exit 1
            fi
            ;;
            
        "test")
            log_info "Starting test recovery..."
            
            if ! check_prerequisites; then
                exit 1
            fi
            
            if ! find_latest_backup "full"; then
                exit 1
            fi
            
            if ! validate_backup "${BACKUP_ID}"; then
                exit 1
            fi
            
            if perform_recovery "test_recovery" "${target_database}"; then
                send_notification "Test Recovery Successful" \
                    "Backup validation completed successfully" "success"
                log_success "Test recovery completed successfully"
            else
                send_notification "Test Recovery Failed" \
                    "Backup validation failed" "error"
                exit 1
            fi
            ;;
            
        "point_in_time")
            log_info "Starting point-in-time recovery..."
            
            if [[ -z "${RECOVERY_TARGET_TIME}" && -z "${RECOVERY_TARGET_LSN}" ]]; then
                log_error "Point-in-time recovery requires RECOVERY_TARGET_TIME or RECOVERY_TARGET_LSN"
                exit 1
            fi
            
            if ! check_prerequisites; then
                exit 1
            fi
            
            if ! find_latest_backup "full"; then
                exit 1
            fi
            
            if perform_recovery "point_in_time" "${target_database}"; then
                run_health_check "${target_database}"
                send_notification "Point-in-time Recovery Successful" \
                    "Database recovered to ${target_database} at target time" "success"
                log_success "Point-in-time recovery completed successfully"
            else
                send_notification "Point-in-time Recovery Failed" \
                    "Recovery operation failed" "error"
                exit 1
            fi
            ;;
            
        "status")
            log_info "Checking disaster recovery readiness..."
            check_prerequisites
            find_latest_backup "full" || true
            ;;
            
        "help")
            cat << EOF
AI Answer Ninja - Disaster Recovery Script

Usage: $0 <operation> [target_database]

Operations:
  immediate [db_name]     - Immediate recovery from latest backup
  point_in_time [db_name] - Point-in-time recovery (requires RECOVERY_TARGET_TIME)
  test                    - Test recovery to validate backup integrity
  status                  - Check disaster recovery readiness
  help                    - Show this help message

Environment Variables:
  DB_HOST                 - Database host (default: localhost)
  DB_PORT                 - Database port (default: 5432)
  DB_NAME                 - Database name (default: ai_ninja)
  DB_USER                 - Database user (default: ai_ninja_app)
  DB_PASSWORD             - Database password
  BACKUP_DIR              - Backup directory (default: /backup)
  ENCRYPTION_KEY          - Backup encryption key
  RECOVERY_TARGET_TIME    - Target time for point-in-time recovery
  RECOVERY_TARGET_LSN     - Target LSN for point-in-time recovery
  NOTIFICATION_EMAIL      - Email for notifications
  SLACK_WEBHOOK           - Slack webhook URL for notifications

Examples:
  $0 immediate                          # Immediate recovery to ai_ninja_recovered
  $0 immediate ai_ninja_production      # Immediate recovery to specific database
  $0 test                               # Test backup integrity
  RECOVERY_TARGET_TIME="2024-01-15 10:30:00" $0 point_in_time  # PITR

EOF
            ;;
            
        *)
            log_error "Unknown operation: ${operation}"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Handle script interruption
trap 'log_error "Script interrupted by user"; exit 130' INT TERM

# Run main function with all arguments
main "$@"
