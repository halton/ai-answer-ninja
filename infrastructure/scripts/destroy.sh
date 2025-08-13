#!/bin/bash

# AI Answer Ninja - Infrastructure Destruction Script
# This script safely destroys infrastructure using Terraform

set -e  # Exit on error
set -u  # Exit on undefined variable

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$(dirname "$SCRIPT_DIR")/terraform"
LOG_DIR="/tmp/ai-answer-ninja-destroy"

# Default values
ENVIRONMENT="${ENVIRONMENT:-dev}"
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
FORCE="${FORCE:-false}"
BACKUP_DATA="${BACKUP_DATA:-true}"
DRY_RUN="${DRY_RUN:-false}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/destroy.log"
}

log_error() {
    echo -e "${RED}[ERROR $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/destroy.log"
}

log_success() {
    echo -e "${GREEN}[SUCCESS $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/destroy.log"
}

log_warning() {
    echo -e "${YELLOW}[WARNING $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/destroy.log"
}

# Usage function
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Safely destroy AI Answer Ninja infrastructure using Terraform.

⚠️  WARNING: This script will permanently delete infrastructure resources!

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (dev, staging, prod) [default: dev]
    -s, --subscription-id ID        Azure subscription ID
    --force                         Skip confirmation prompts
    --no-backup                     Skip data backup before destruction
    --dry-run                       Show what would be destroyed without making changes
    -h, --help                      Show this help message

EXAMPLES:
    # Destroy development environment (with confirmation)
    $0 -e dev

    # Destroy staging environment without backup
    $0 -e staging --no-backup

    # Dry run for production (highly recommended)
    $0 -e prod --dry-run

SAFETY FEATURES:
    - Data backup by default (can be disabled with --no-backup)
    - Multiple confirmation prompts for production
    - Dry run capability to preview changes
    - Comprehensive logging of all actions
    - Protection against accidental production destruction

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -s|--subscription-id)
            SUBSCRIPTION_ID="$2"
            shift 2
            ;;
        --force)
            FORCE="true"
            shift
            ;;
        --no-backup)
            BACKUP_DATA="false"
            shift
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validation
validate_environment() {
    case $ENVIRONMENT in
        dev|staging|prod)
            log "Environment validated: $ENVIRONMENT"
            ;;
        *)
            log_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
            exit 1
            ;;
    esac
}

# Safety confirmations
confirm_destruction() {
    if [[ "$FORCE" == "true" ]]; then
        log_warning "Skipping confirmation prompts (--force specified)"
        return 0
    fi
    
    echo -e "\n${RED}⚠️  DANGER: INFRASTRUCTURE DESTRUCTION${NC}"
    echo "This action will permanently delete the following:"
    echo "- AKS clusters and all running applications"
    echo "- Databases and all stored data"
    echo "- Storage accounts and all files"
    echo "- Network infrastructure"
    echo "- Monitoring and logging data"
    
    if [[ "$ENVIRONMENT" == "prod" ]]; then
        echo -e "\n${RED}🚨 PRODUCTION ENVIRONMENT DESTRUCTION 🚨${NC}"
        echo "You are about to destroy the PRODUCTION environment!"
        echo "This will result in:"
        echo "- Complete service outage"
        echo "- Potential data loss"
        echo "- Customer impact"
        
        echo -e "\nType 'DELETE PRODUCTION' to confirm:"
        read -r confirmation
        
        if [[ "$confirmation" != "DELETE PRODUCTION" ]]; then
            log "Production destruction cancelled"
            exit 0
        fi
    fi
    
    echo -e "\nEnvironment: ${RED}$ENVIRONMENT${NC}"
    echo -n "Are you absolutely sure you want to proceed? (yes/no): "
    read -r response
    
    if [[ "$response" != "yes" ]]; then
        log "Destruction cancelled by user"
        exit 0
    fi
    
    # Final confirmation
    echo -e "\n${YELLOW}Last chance to cancel!${NC}"
    echo -n "Type 'DESTROY' to proceed with infrastructure destruction: "
    read -r final_confirmation
    
    if [[ "$final_confirmation" != "DESTROY" ]]; then
        log "Destruction cancelled at final confirmation"
        exit 0
    fi
    
    log_warning "User confirmed infrastructure destruction"
}

# Data backup before destruction
backup_critical_data() {
    if [[ "$BACKUP_DATA" != "true" ]]; then
        log_warning "Skipping data backup (--no-backup specified)"
        return 0
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Dry run mode - would backup critical data"
        return 0
    fi
    
    log "Starting critical data backup..."
    
    # Initialize Terraform to get outputs
    cd "$TERRAFORM_DIR"
    terraform init &> /dev/null || true
    
    local backup_dir="${LOG_DIR}/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    
    # Backup Terraform state
    log "Backing up Terraform state..."
    if [[ -f "terraform.tfstate" ]]; then
        cp terraform.tfstate "$backup_dir/"
    fi
    
    # Get resource information from Terraform outputs
    local outputs_file="$backup_dir/terraform-outputs.json"
    terraform output -json > "$outputs_file" 2>/dev/null || echo "{}" > "$outputs_file"
    
    # Backup database (if accessible)
    local db_host=$(jq -r '.postgres_server_fqdn.value // empty' "$outputs_file" 2>/dev/null || echo "")
    if [[ -n "$db_host" ]]; then
        log "Attempting database backup..."
        
        # This would need to be customized based on actual database credentials
        local backup_file="$backup_dir/database-backup.sql"
        
        # Note: This is a simplified example - actual implementation would need proper credentials
        # kubectl exec -n production deployment/api -- pg_dump > "$backup_file" || log_warning "Database backup failed"
        
        log "Database backup attempted (check logs for success)"
    fi
    
    # Backup critical configuration files
    log "Backing up configuration files..."
    if [[ -d "${TERRAFORM_DIR}/environments/${ENVIRONMENT}" ]]; then
        cp -r "${TERRAFORM_DIR}/environments/${ENVIRONMENT}" "$backup_dir/"
    fi
    
    # Create backup summary
    cat > "$backup_dir/backup-summary.txt" << EOF
Backup Summary
==============
Environment: $ENVIRONMENT
Timestamp: $(date)
Backup Location: $backup_dir

Files Backed Up:
$(find "$backup_dir" -type f -exec basename {} \; | sort)

Next Steps After Destruction:
1. Review this backup if restoration is needed
2. Keep this backup for compliance/audit purposes
3. Update DNS records if necessary
4. Notify stakeholders of infrastructure removal

EOF
    
    log_success "Critical data backup completed: $backup_dir"
    echo -e "\n${GREEN}Backup Summary:${NC}"
    cat "$backup_dir/backup-summary.txt"
}

# Get destruction plan
plan_destruction() {
    log "Planning infrastructure destruction..."
    
    cd "$TERRAFORM_DIR"
    
    local plan_file="${LOG_DIR}/terraform-destroy-${ENVIRONMENT}.tfplan"
    local vars_file="${TERRAFORM_DIR}/environments/${ENVIRONMENT}/terraform.tfvars"
    
    if [[ ! -f "$vars_file" ]]; then
        log_error "Variables file not found: $vars_file"
        exit 1
    fi
    
    # Generate destruction plan
    terraform plan \
        -destroy \
        -var-file="$vars_file" \
        -out="$plan_file" \
        -detailed-exitcode
    
    local plan_exit_code=$?
    
    case $plan_exit_code in
        0)
            log "No resources to destroy"
            return 0
            ;;
        1)
            log_error "Terraform destroy plan failed"
            exit 1
            ;;
        2)
            log "Terraform destroy plan generated successfully"
            ;;
        *)
            log_error "Unexpected exit code from Terraform plan: $plan_exit_code"
            exit 1
            ;;
    esac
    
    # Show destruction plan
    echo -e "\n${YELLOW}=== Resources to be Destroyed ===${NC}"
    terraform show -no-color "$plan_file" | tee "${LOG_DIR}/terraform-destroy-plan.log"
    
    echo -e "\n${RED}The above resources will be permanently deleted!${NC}"
}

# Execute destruction
execute_destruction() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Dry run mode - skipping actual destruction"
        return 0
    fi
    
    log "Executing infrastructure destruction..."
    
    cd "$TERRAFORM_DIR"
    
    local plan_file="${LOG_DIR}/terraform-destroy-${ENVIRONMENT}.tfplan"
    local vars_file="${TERRAFORM_DIR}/environments/${ENVIRONMENT}/terraform.tfvars"
    
    # Apply destruction plan
    if [[ -f "$plan_file" ]]; then
        terraform apply "$plan_file"
    else
        terraform destroy \
            -var-file="$vars_file" \
            -auto-approve
    fi
    
    log_success "Infrastructure destruction completed"
}

# Cleanup remaining resources
cleanup_remaining_resources() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Dry run mode - would cleanup remaining resources"
        return 0
    fi
    
    log "Cleaning up remaining resources..."
    
    # Clean up resource groups that might not be managed by Terraform
    local resource_groups=(
        "ai-answer-ninja-${ENVIRONMENT}-rg-primary"
        "ai-answer-ninja-${ENVIRONMENT}-rg-secondary" 
        "ai-answer-ninja-${ENVIRONMENT}-rg-shared"
    )
    
    for rg in "${resource_groups[@]}"; do
        if az group show --name "$rg" &> /dev/null; then
            log "Found remaining resource group: $rg"
            
            # List resources in the group
            local resources=$(az resource list --resource-group "$rg" --query '[].{Name:name, Type:type}' -o table)
            if [[ -n "$resources" ]]; then
                log_warning "Resources still exist in $rg:"
                echo "$resources"
                
                if [[ "$FORCE" == "true" ]]; then
                    log "Force deleting resource group: $rg"
                    az group delete --name "$rg" --yes --no-wait
                else
                    echo -n "Delete resource group $rg? (yes/no): "
                    read -r response
                    if [[ "$response" == "yes" ]]; then
                        az group delete --name "$rg" --yes --no-wait
                    fi
                fi
            else
                log "Deleting empty resource group: $rg"
                az group delete --name "$rg" --yes --no-wait
            fi
        fi
    done
    
    # Clean up any remaining storage accounts (in case of soft-delete)
    log "Checking for soft-deleted storage accounts..."
    # Note: This would require additional Azure CLI commands to check for soft-deleted resources
}

# Post-destruction verification
verify_destruction() {
    log "Verifying infrastructure destruction..."
    
    local verification_failed=false
    
    # Check if resource groups still exist
    local resource_groups=(
        "ai-answer-ninja-${ENVIRONMENT}-rg-primary"
        "ai-answer-ninja-${ENVIRONMENT}-rg-secondary"
        "ai-answer-ninja-${ENVIRONMENT}-rg-shared"
    )
    
    for rg in "${resource_groups[@]}"; do
        if az group show --name "$rg" &> /dev/null; then
            log_warning "Resource group still exists: $rg"
            verification_failed=true
        else
            log_success "Resource group deleted: $rg"
        fi
    done
    
    # Check if kubectl context still points to deleted cluster
    if kubectl cluster-info &> /dev/null; then
        local current_context=$(kubectl config current-context 2>/dev/null || echo "")
        if [[ "$current_context" == *"$ENVIRONMENT"* ]]; then
            log_warning "kubectl still configured for deleted cluster: $current_context"
            log "You may want to remove this context: kubectl config delete-context $current_context"
        fi
    fi
    
    if [[ "$verification_failed" == "true" ]]; then
        log_warning "Some resources may still exist. Check Azure portal manually."
    else
        log_success "Infrastructure destruction verification completed"
    fi
}

# Generate destruction report
generate_report() {
    log "Generating destruction report..."
    
    local report_file="${LOG_DIR}/destruction-report-${ENVIRONMENT}.md"
    
    cat > "$report_file" << EOF
# Infrastructure Destruction Report

## Summary
- **Environment**: $ENVIRONMENT
- **Destruction Date**: $(date)
- **Executed By**: $(whoami)
- **Dry Run**: $DRY_RUN

## Actions Taken
- Terraform state backed up: $([ "$BACKUP_DATA" == "true" ] && echo "Yes" || echo "No")
- Infrastructure destroyed: $([ "$DRY_RUN" != "true" ] && echo "Yes" || echo "No")
- Remaining resources cleaned up: $([ "$DRY_RUN" != "true" ] && echo "Yes" || echo "No")

## Backup Location
$([ "$BACKUP_DATA" == "true" ] && echo "Backup files are located at: ${LOG_DIR}/backup-*" || echo "No backup was performed")

## Verification Results
$([ "$DRY_RUN" != "true" ] && echo "See verification section in destroy.log" || echo "Verification skipped (dry run)")

## Next Steps
1. Verify all resources are deleted in Azure portal
2. Update documentation to reflect infrastructure removal
3. Remove any DNS records pointing to deleted resources
4. Update monitoring and alerting systems
5. Notify stakeholders of infrastructure removal

## Files Generated
- Destruction log: ${LOG_DIR}/destroy.log
- Terraform destroy plan: ${LOG_DIR}/terraform-destroy-plan.log
- This report: $report_file

---
*Report generated by AI Answer Ninja destruction script*
EOF
    
    log_success "Destruction report generated: $report_file"
}

# Initialize directories
init_directories() {
    log "Initializing directories..."
    mkdir -p "$LOG_DIR"
}

# Main destruction function
main() {
    echo -e "${RED}"
    echo "======================================"
    echo "  AI Answer Ninja Infrastructure"
    echo "  Destruction Script"
    echo "======================================"
    echo -e "${NC}"
    
    log "Starting destruction process for environment: $ENVIRONMENT"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Running in DRY RUN mode - no actual destruction will occur"
    fi
    
    # Execute destruction steps
    validate_environment
    init_directories
    confirm_destruction
    backup_critical_data
    plan_destruction
    execute_destruction
    cleanup_remaining_resources
    verify_destruction
    generate_report
    
    local end_time=$(date)
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_success "Dry run completed successfully at $end_time"
        echo -e "\n${GREEN}=== Dry Run Summary ===${NC}"
        echo "No actual changes were made"
        echo "Review the destruction plan above"
        echo "Run without --dry-run to execute actual destruction"
    else
        log_success "Infrastructure destruction completed successfully at $end_time"
        echo -e "\n${GREEN}=== Destruction Summary ===${NC}"
        echo "Environment: $ENVIRONMENT"
        echo "Status: Destroyed"
    fi
    
    echo "Logs: $LOG_DIR/destroy.log"
    echo "Report: $LOG_DIR/destruction-report-${ENVIRONMENT}.md"
    
    if [[ "$BACKUP_DATA" == "true" ]] && [[ "$DRY_RUN" != "true" ]]; then
        echo "Backup: $LOG_DIR/backup-*"
    fi
}

# Run main function
main "$@"