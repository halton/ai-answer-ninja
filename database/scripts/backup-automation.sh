#!/bin/bash

# AI Answer Ninja - Automated Backup Script
# Production-ready backup automation with error handling and monitoring
# Based on CLAUDE.md architecture specifications

set -euo pipefail

# ===========================================
# Configuration
# ===========================================

# Default values (can be overridden by environment variables)
BACKUP_TYPE="${BACKUP_TYPE:-full}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgresql}"
LOG_DIR="${LOG_DIR:-/var/log/ai-ninja-backup}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPRESS="${COMPRESS:-true}"
ENCRYPT="${ENCRYPT:-true}"
VERIFY="${VERIFY:-true}"
UPLOAD_TO_CLOUD="${UPLOAD_TO_CLOUD:-false}"

# Database connection settings
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ai_ninja}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"

# Notification settings
WEBHOOK_URL="${WEBHOOK_URL:-}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"
EMAIL_RECIPIENTS="${EMAIL_RECIPIENTS:-}"

# Performance settings
PARALLEL_JOBS="${PARALLEL_JOBS:-2}"
NICE_LEVEL="${NICE_LEVEL:-10}"
IONICE_CLASS="${IONICE_CLASS:-2}"
IONICE_PRIORITY="${IONICE_PRIORITY:-7}"

# ===========================================
# Utility Functions
# ===========================================

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

log_info() {
    log "INFO" "$@"
}

log_warn() {
    log "WARN" "$@"
}

log_error() {
    log "ERROR" "$@"
}

log_debug() {
    log "DEBUG" "$@"
}

# Error handling
handle_error() {
    local exit_code=$?
    local line_number=$1
    log_error "Script failed at line $line_number with exit code $exit_code"
    
    # Send failure notification
    send_notification "FAILURE" "Backup failed at line $line_number" "$exit_code"
    
    # Cleanup on failure
    cleanup_on_failure
    
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Cleanup function
cleanup_on_failure() {
    log_info "Performing cleanup after failure..."
    
    # Remove incomplete backup files
    if [ -n "${TEMP_BACKUP_FILE:-}" ] && [ -f "$TEMP_BACKUP_FILE" ]; then
        rm -f "$TEMP_BACKUP_FILE"
        log_info "Removed incomplete backup file: $TEMP_BACKUP_FILE"
    fi
    
    # Remove temporary files
    rm -f "${BACKUP_DIR}"/tmp_*
    
    log_info "Cleanup completed"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check required commands
    local required_commands=("pg_dump" "gzip" "sha256sum")
    
    if [ "$ENCRYPT" = "true" ]; then
        required_commands+=("openssl")
    fi
    
    if [ "$UPLOAD_TO_CLOUD" = "true" ]; then
        required_commands+=("aws" "curl")
    fi
    
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            log_error "Required command not found: $cmd"
            exit 1
        fi
    done
    
    # Check database connectivity
    if ! PGPASSWORD="$DB_PASSWORD" pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        log_error "Cannot connect to database"
        exit 1
    fi
    
    # Check disk space
    local available_space=$(df "$BACKUP_DIR" | awk 'NR==2 {print $4}')
    local required_space=1048576  # 1GB in KB
    
    if [ "$available_space" -lt "$required_space" ]; then
        log_error "Insufficient disk space. Available: ${available_space}KB, Required: ${required_space}KB"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# Setup environment
setup_environment() {
    log_info "Setting up environment..."
    
    # Create directories
    mkdir -p "$BACKUP_DIR" "$LOG_DIR"
    
    # Set process priority
    renice "$NICE_LEVEL" $$ &> /dev/null || true
    ionice -c "$IONICE_CLASS" -n "$IONICE_PRIORITY" -p $$ &> /dev/null || true
    
    # Generate backup filename
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    BACKUP_ID="backup_${timestamp}_$$"
    BACKUP_FILENAME="${BACKUP_ID}_${BACKUP_TYPE}.sql"
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILENAME"
    TEMP_BACKUP_FILE="${BACKUP_PATH}.tmp"
    
    # Setup logging
    LOG_FILE="$LOG_DIR/backup_${timestamp}.log"
    touch "$LOG_FILE"
    
    log_info "Environment setup completed"
    log_info "Backup ID: $BACKUP_ID"
    log_info "Backup path: $BACKUP_PATH"
}

# ===========================================
# Backup Functions
# ===========================================

# Perform full backup
perform_full_backup() {
    log_info "Starting full backup..."
    
    local start_time=$(date +%s)
    
    # Build pg_dump command
    local dump_cmd="PGPASSWORD='$DB_PASSWORD' pg_dump"
    dump_cmd+=" -h '$DB_HOST'"
    dump_cmd+=" -p '$DB_PORT'"
    dump_cmd+=" -U '$DB_USER'"
    dump_cmd+=" -d '$DB_NAME'"
    dump_cmd+=" --verbose"
    dump_cmd+=" --format=custom"
    dump_cmd+=" --no-owner"
    dump_cmd+=" --no-privileges"
    dump_cmd+=" --compress=6"
    dump_cmd+=" --file='$TEMP_BACKUP_FILE'"
    
    # Add parallel processing for large databases
    if [ "$PARALLEL_JOBS" -gt 1 ]; then
        dump_cmd+=" --jobs=$PARALLEL_JOBS"
    fi
    
    log_debug "Executing command: pg_dump [connection parameters] ..."
    
    # Execute backup
    if eval "$dump_cmd" 2>> "$LOG_FILE"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_info "Full backup completed in ${duration} seconds"
    else
        log_error "Full backup failed"
        return 1
    fi
}

# Perform incremental backup (WAL archiving)
perform_incremental_backup() {
    log_info "Starting incremental backup..."
    
    # This is a simplified implementation
    # In production, you would implement proper WAL archiving
    
    local start_time=$(date +%s)
    local wal_dir="/var/lib/postgresql/archive"
    local last_backup_time_file="$BACKUP_DIR/.last_backup_time"
    
    # Get timestamp of last backup
    local since_time=""
    if [ -f "$last_backup_time_file" ]; then
        since_time=$(cat "$last_backup_time_file")
    else
        log_warn "No previous backup timestamp found, performing full backup instead"
        perform_full_backup
        return $?
    fi
    
    # Find WAL files newer than last backup
    local wal_files=()
    while IFS= read -r -d '' file; do
        wal_files+=("$file")
    done < <(find "$wal_dir" -name "*.wal" -newer "$since_time" -print0 2>/dev/null || true)
    
    if [ ${#wal_files[@]} -eq 0 ]; then
        log_info "No new WAL files found, skipping incremental backup"
        return 0
    fi
    
    # Archive WAL files
    tar -czf "$TEMP_BACKUP_FILE" -C "$wal_dir" "${wal_files[@]##*/}" 2>> "$LOG_FILE"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_info "Incremental backup completed in ${duration} seconds (${#wal_files[@]} WAL files)"
}

# Process backup file (compress and encrypt)
process_backup_file() {
    log_info "Processing backup file..."
    
    local current_file="$TEMP_BACKUP_FILE"
    local final_file="$BACKUP_PATH"
    
    # Compress if enabled and not already compressed
    if [ "$COMPRESS" = "true" ] && [[ ! "$current_file" =~ \.gz$ ]]; then
        log_info "Compressing backup..."
        gzip -c "$current_file" > "${final_file}.gz"
        rm -f "$current_file"
        current_file="${final_file}.gz"
        final_file="${final_file}.gz"
    fi
    
    # Encrypt if enabled
    if [ "$ENCRYPT" = "true" ]; then
        if [ -z "$ENCRYPTION_KEY" ]; then
            log_error "Encryption enabled but no encryption key provided"
            return 1
        fi
        
        log_info "Encrypting backup..."
        openssl enc -aes-256-cbc -salt -pbkdf2 -in "$current_file" -out "${final_file}.enc" -k "$ENCRYPTION_KEY"
        rm -f "$current_file"
        final_file="${final_file}.enc"
    fi
    
    # Move to final location if needed
    if [ "$current_file" != "$final_file" ]; then
        mv "$current_file" "$final_file"
    fi
    
    BACKUP_PATH="$final_file"
    log_info "Backup file processing completed: $BACKUP_PATH"
}

# Calculate file checksum
calculate_checksum() {
    log_info "Calculating checksum..."
    
    BACKUP_CHECKSUM=$(sha256sum "$BACKUP_PATH" | cut -d' ' -f1)
    
    # Save checksum to file
    echo "$BACKUP_CHECKSUM  $(basename "$BACKUP_PATH")" > "${BACKUP_PATH}.sha256"
    
    log_info "Checksum calculated: $BACKUP_CHECKSUM"
}

# Verify backup integrity
verify_backup() {
    if [ "$VERIFY" != "true" ]; then
        log_info "Backup verification disabled"
        return 0
    fi
    
    log_info "Verifying backup integrity..."
    
    # Verify checksum
    if ! sha256sum -c "${BACKUP_PATH}.sha256" &> /dev/null; then
        log_error "Backup verification failed: checksum mismatch"
        return 1
    fi
    
    # For full backups, test restore to a temporary database
    if [ "$BACKUP_TYPE" = "full" ]; then
        verify_full_backup_restore
    fi
    
    log_info "Backup verification completed successfully"
}

# Verify full backup by test restore
verify_full_backup_restore() {
    local test_db="test_restore_$$"
    local backup_file="$BACKUP_PATH"
    
    log_info "Performing test restore verification..."
    
    # Prepare backup file for restore
    local restore_file="$backup_file"
    
    # Decrypt if necessary
    if [[ "$backup_file" =~ \.enc$ ]]; then
        restore_file="${backup_file%.enc}"
        openssl enc -aes-256-cbc -d -pbkdf2 -in "$backup_file" -out "$restore_file" -k "$ENCRYPTION_KEY"
    fi
    
    # Decompress if necessary
    if [[ "$restore_file" =~ \.gz$ ]]; then
        local temp_file="${restore_file%.gz}"
        gunzip -c "$restore_file" > "$temp_file"
        if [ "$restore_file" != "$backup_file" ]; then
            rm -f "$restore_file"
        fi
        restore_file="$temp_file"
    fi
    
    # Create test database and restore
    PGPASSWORD="$DB_PASSWORD" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$test_db" 2>> "$LOG_FILE"
    
    local restore_cmd="PGPASSWORD='$DB_PASSWORD' pg_restore"
    restore_cmd+=" -h '$DB_HOST'"
    restore_cmd+=" -p '$DB_PORT'"
    restore_cmd+=" -U '$DB_USER'"
    restore_cmd+=" -d '$test_db'"
    restore_cmd+=" --verbose"
    restore_cmd+=" --clean"
    restore_cmd+=" --if-exists"
    restore_cmd+=" --no-owner"
    restore_cmd+=" --no-privileges"
    restore_cmd+=" '$restore_file'"
    
    if eval "$restore_cmd" 2>> "$LOG_FILE"; then
        # Verify some data exists
        local table_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$test_db" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>> "$LOG_FILE" | tr -d ' ')
        
        if [ "$table_count" -gt 0 ]; then
            log_info "Test restore successful: $table_count tables restored"
        else
            log_error "Test restore failed: no tables found"
            return 1
        fi
    else
        log_error "Test restore failed"
        return 1
    fi
    
    # Cleanup
    PGPASSWORD="$DB_PASSWORD" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$test_db" 2>> "$LOG_FILE"
    
    if [ "$restore_file" != "$backup_file" ]; then
        rm -f "$restore_file"
    fi
}

# ===========================================
# Upload and Storage Functions
# ===========================================

# Upload to cloud storage
upload_to_cloud() {
    if [ "$UPLOAD_TO_CLOUD" != "true" ]; then
        log_info "Cloud upload disabled"
        return 0
    fi
    
    log_info "Uploading backup to cloud storage..."
    
    case "${CLOUD_PROVIDER:-aws}" in
        "aws")
            upload_to_aws
            ;;
        "azure")
            upload_to_azure
            ;;
        "gcp")
            upload_to_gcp
            ;;
        *)
            log_error "Unsupported cloud provider: ${CLOUD_PROVIDER:-aws}"
            return 1
            ;;
    esac
}

upload_to_aws() {
    local s3_bucket="${AWS_S3_BUCKET:-ai-ninja-backups}"
    local s3_key="database-backups/$(basename "$BACKUP_PATH")"
    
    aws s3 cp "$BACKUP_PATH" "s3://$s3_bucket/$s3_key" \
        --storage-class STANDARD_IA \
        --metadata "backup-id=$BACKUP_ID,backup-type=$BACKUP_TYPE,checksum=$BACKUP_CHECKSUM" \
        2>> "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log_info "Backup uploaded to AWS S3: s3://$s3_bucket/$s3_key"
    else
        log_error "Failed to upload backup to AWS S3"
        return 1
    fi
}

upload_to_azure() {
    # Implementation for Azure Blob Storage
    log_info "Azure upload implementation needed"
}

upload_to_gcp() {
    # Implementation for Google Cloud Storage
    log_info "GCP upload implementation needed"
}

# ===========================================
# Maintenance Functions
# ===========================================

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups (retention: $RETENTION_DAYS days)..."
    
    local cleanup_count=0
    
    # Find and remove old backup files
    while IFS= read -r -d '' old_file; do
        rm -f "$old_file"
        rm -f "${old_file}.sha256"
        ((cleanup_count++))
        log_debug "Removed old backup: $(basename "$old_file")"
    done < <(find "$BACKUP_DIR" -name "backup_*.sql*" -type f -mtime +$RETENTION_DAYS -print0 2>/dev/null)
    
    # Cleanup old log files
    find "$LOG_DIR" -name "backup_*.log" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    
    log_info "Cleanup completed: removed $cleanup_count old backup files"
}

# Update backup timestamp
update_backup_timestamp() {
    echo "$(date)" > "$BACKUP_DIR/.last_backup_time"
    echo "$BACKUP_ID" > "$BACKUP_DIR/.last_backup_id"
}

# ===========================================
# Notification Functions
# ===========================================

send_notification() {
    local status="$1"
    local message="$2"
    local details="${3:-}"
    
    local notification_msg="AI Ninja Database Backup $status: $message"
    
    if [ -n "$details" ]; then
        notification_msg="$notification_msg (Details: $details)"
    fi
    
    log_info "Sending notification: $notification_msg"
    
    # Send to webhook
    if [ -n "$WEBHOOK_URL" ]; then
        curl -X POST "$WEBHOOK_URL" \
             -H "Content-Type: application/json" \
             -d "{\"status\":\"$status\",\"message\":\"$message\",\"backup_id\":\"$BACKUP_ID\",\"timestamp\":\"$(date -Iseconds)\"}" \
             &> /dev/null || log_warn "Failed to send webhook notification"
    fi
    
    # Send to Slack
    if [ -n "$SLACK_WEBHOOK" ]; then
        local emoji="✅"
        [ "$status" = "FAILURE" ] && emoji="❌"
        [ "$status" = "WARNING" ] && emoji="⚠️"
        
        curl -X POST "$SLACK_WEBHOOK" \
             -H "Content-Type: application/json" \
             -d "{\"text\":\"$emoji $notification_msg\"}" \
             &> /dev/null || log_warn "Failed to send Slack notification"
    fi
    
    # Send email
    if [ -n "$EMAIL_RECIPIENTS" ] && command -v mail &> /dev/null; then
        echo "$notification_msg" | mail -s "AI Ninja Backup $status" "$EMAIL_RECIPIENTS" \
             || log_warn "Failed to send email notification"
    fi
}

# ===========================================
# Monitoring and Metrics
# ===========================================

collect_metrics() {
    local backup_size=$(stat -c%s "$BACKUP_PATH" 2>/dev/null || echo "0")
    local backup_duration=$(($(date +%s) - START_TIME))
    
    # Create metrics file
    cat > "${BACKUP_PATH}.metrics" << EOF
{
    "backup_id": "$BACKUP_ID",
    "backup_type": "$BACKUP_TYPE",
    "start_time": "$START_TIME",
    "end_time": "$(date +%s)",
    "duration_seconds": $backup_duration,
    "size_bytes": $backup_size,
    "compressed": $COMPRESS,
    "encrypted": $ENCRYPT,
    "verified": $VERIFY,
    "checksum": "$BACKUP_CHECKSUM",
    "path": "$BACKUP_PATH"
}
EOF
    
    log_info "Backup metrics collected"
    log_info "Backup size: $(numfmt --to=iec $backup_size)"
    log_info "Backup duration: ${backup_duration} seconds"
}

# ===========================================
# Main Backup Process
# ===========================================

main() {
    log_info "Starting AI Ninja database backup process"
    log_info "Backup type: $BACKUP_TYPE"
    
    START_TIME=$(date +%s)
    
    # Setup and checks
    setup_environment
    check_prerequisites
    
    # Perform backup based on type
    case "$BACKUP_TYPE" in
        "full")
            perform_full_backup
            ;;
        "incremental")
            perform_incremental_backup
            ;;
        "differential")
            # Differential backup would be implemented here
            log_warn "Differential backup not implemented, performing full backup"
            perform_full_backup
            ;;
        *)
            log_error "Unknown backup type: $BACKUP_TYPE"
            exit 1
            ;;
    esac
    
    # Process and verify backup
    process_backup_file
    calculate_checksum
    verify_backup
    
    # Upload and cleanup
    upload_to_cloud
    update_backup_timestamp
    cleanup_old_backups
    
    # Collect metrics and notify
    collect_metrics
    send_notification "SUCCESS" "Backup completed successfully" "ID: $BACKUP_ID"
    
    local total_duration=$(($(date +%s) - START_TIME))
    log_info "Backup process completed successfully in ${total_duration} seconds"
    log_info "Backup file: $BACKUP_PATH"
    log_info "Backup checksum: $BACKUP_CHECKSUM"
}

# ===========================================
# Script Execution
# ===========================================

# Handle command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --type)
            BACKUP_TYPE="$2"
            shift 2
            ;;
        --verify)
            VERIFY="true"
            shift
            ;;
        --no-verify)
            VERIFY="false"
            shift
            ;;
        --encrypt)
            ENCRYPT="true"
            shift
            ;;
        --no-encrypt)
            ENCRYPT="false"
            shift
            ;;
        --compress)
            COMPRESS="true"
            shift
            ;;
        --no-compress)
            COMPRESS="false"
            shift
            ;;
        --upload)
            UPLOAD_TO_CLOUD="true"
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --type TYPE        Backup type (full, incremental, differential)"
            echo "  --verify           Enable backup verification (default)"
            echo "  --no-verify        Disable backup verification"
            echo "  --encrypt          Enable encryption (default)"
            echo "  --no-encrypt       Disable encryption"
            echo "  --compress         Enable compression (default)"
            echo "  --no-compress      Disable compression"
            echo "  --upload           Upload to cloud storage"
            echo "  --help             Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate backup type
case "$BACKUP_TYPE" in
    "full"|"incremental"|"differential")
        ;;
    *)
        log_error "Invalid backup type: $BACKUP_TYPE"
        exit 1
        ;;
esac

# Run main function
main "$@"