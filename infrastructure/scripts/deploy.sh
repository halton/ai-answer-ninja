#!/bin/bash

# AI Answer Ninja - Infrastructure Deployment Script
# This script deploys the complete infrastructure using Terraform

set -e  # Exit on error
set -u  # Exit on undefined variable

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$(dirname "$SCRIPT_DIR")/terraform"
LOG_DIR="/tmp/ai-answer-ninja-deploy"

# Default values
ENVIRONMENT="${ENVIRONMENT:-dev}"
REGION="${REGION:-eastasia}"
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
RESOURCE_GROUP_PREFIX="ai-answer-ninja"
SKIP_PLAN="${SKIP_PLAN:-false}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"
DRY_RUN="${DRY_RUN:-false}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/deploy.log"
}

log_error() {
    echo -e "${RED}[ERROR $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/deploy.log"
}

log_success() {
    echo -e "${GREEN}[SUCCESS $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/deploy.log"
}

log_warning() {
    echo -e "${YELLOW}[WARNING $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_DIR}/deploy.log"
}

# Usage function
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy AI Answer Ninja infrastructure using Terraform.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (dev, staging, prod) [default: dev]
    -r, --region REGION             Azure region [default: eastasia]
    -s, --subscription-id ID        Azure subscription ID
    --skip-plan                     Skip Terraform plan step
    --auto-approve                  Auto approve Terraform apply
    --dry-run                      Show what would be deployed without making changes
    -h, --help                     Show this help message

EXAMPLES:
    # Deploy to development environment
    $0 -e dev

    # Deploy to production with auto-approve
    $0 -e prod --auto-approve

    # Dry run for staging environment
    $0 -e staging --dry-run

ENVIRONMENT VARIABLES:
    ENVIRONMENT         Target environment
    REGION              Azure region
    SUBSCRIPTION_ID     Azure subscription ID
    SKIP_PLAN          Skip Terraform plan
    AUTO_APPROVE       Auto approve deployment
    DRY_RUN            Perform dry run only

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -s|--subscription-id)
            SUBSCRIPTION_ID="$2"
            shift 2
            ;;
        --skip-plan)
            SKIP_PLAN="true"
            shift
            ;;
        --auto-approve)
            AUTO_APPROVE="true"
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

validate_prerequisites() {
    log "Validating prerequisites..."

    # Check if required tools are installed
    local required_tools=("az" "terraform" "kubectl" "jq")
    for tool in "${required_tools[@]}"; do
        if ! command -v $tool &> /dev/null; then
            log_error "$tool is not installed or not in PATH"
            exit 1
        fi
    done

    # Check Azure CLI login
    if ! az account show &> /dev/null; then
        log_error "Not logged in to Azure CLI. Please run 'az login' first."
        exit 1
    fi

    # Set subscription if provided
    if [[ -n "$SUBSCRIPTION_ID" ]]; then
        log "Setting Azure subscription to: $SUBSCRIPTION_ID"
        az account set --subscription "$SUBSCRIPTION_ID"
    fi

    # Verify Terraform version
    local tf_version=$(terraform version -json | jq -r '.terraform_version')
    log "Using Terraform version: $tf_version"

    log_success "Prerequisites validated successfully"
}

# Initialize directories
init_directories() {
    log "Initializing directories..."
    
    mkdir -p "$LOG_DIR"
    
    # Ensure Terraform directory exists
    if [[ ! -d "$TERRAFORM_DIR" ]]; then
        log_error "Terraform directory not found: $TERRAFORM_DIR"
        exit 1
    fi
    
    log_success "Directories initialized"
}

# Setup Terraform backend
setup_terraform_backend() {
    log "Setting up Terraform backend..."
    
    local backend_rg="${RESOURCE_GROUP_PREFIX}-terraform-state"
    local backend_sa="${RESOURCE_GROUP_PREFIX//-/}tfstate"
    local backend_container="terraform-state"
    
    # Create resource group for Terraform state if it doesn't exist
    if ! az group show --name "$backend_rg" &> /dev/null; then
        log "Creating Terraform state resource group: $backend_rg"
        az group create --name "$backend_rg" --location "$REGION"
    fi
    
    # Create storage account for Terraform state if it doesn't exist
    if ! az storage account show --name "$backend_sa" --resource-group "$backend_rg" &> /dev/null; then
        log "Creating Terraform state storage account: $backend_sa"
        az storage account create \
            --name "$backend_sa" \
            --resource-group "$backend_rg" \
            --location "$REGION" \
            --sku Standard_LRS \
            --kind StorageV2 \
            --https-only true \
            --min-tls-version TLS1_2
    fi
    
    # Create container for Terraform state
    local account_key=$(az storage account keys list --resource-group "$backend_rg" --account-name "$backend_sa" --query '[0].value' -o tsv)
    az storage container create \
        --name "$backend_container" \
        --account-name "$backend_sa" \
        --account-key "$account_key" \
        --public-access off \
        &> /dev/null || true
    
    log_success "Terraform backend setup completed"
}

# Initialize Terraform
init_terraform() {
    log "Initializing Terraform..."
    
    cd "$TERRAFORM_DIR"
    
    # Copy environment-specific backend configuration
    local backend_config="${TERRAFORM_DIR}/environments/${ENVIRONMENT}/backend.tf"
    if [[ -f "$backend_config" ]]; then
        log "Using backend configuration: $backend_config"
    else
        log_warning "No backend configuration found for environment: $ENVIRONMENT"
    fi
    
    # Initialize Terraform with backend configuration
    terraform init \
        -backend-config="resource_group_name=${RESOURCE_GROUP_PREFIX}-terraform-state" \
        -backend-config="storage_account_name=${RESOURCE_GROUP_PREFIX//-/}tfstate" \
        -backend-config="container_name=terraform-state" \
        -backend-config="key=${ENVIRONMENT}/terraform.tfstate"
    
    log_success "Terraform initialized"
}

# Validate Terraform configuration
validate_terraform() {
    log "Validating Terraform configuration..."
    
    cd "$TERRAFORM_DIR"
    
    # Format check
    if ! terraform fmt -check=true -diff=true; then
        log_warning "Terraform configuration formatting issues found"
        if [[ "$DRY_RUN" != "true" ]]; then
            terraform fmt -recursive
            log "Terraform configuration formatted"
        fi
    fi
    
    # Validate configuration
    terraform validate
    
    log_success "Terraform configuration validated"
}

# Plan Terraform deployment
plan_terraform() {
    if [[ "$SKIP_PLAN" == "true" ]]; then
        log "Skipping Terraform plan as requested"
        return 0
    fi
    
    log "Planning Terraform deployment..."
    
    cd "$TERRAFORM_DIR"
    
    local plan_file="${LOG_DIR}/terraform-${ENVIRONMENT}.tfplan"
    local vars_file="${TERRAFORM_DIR}/environments/${ENVIRONMENT}/terraform.tfvars"
    
    if [[ ! -f "$vars_file" ]]; then
        log_error "Variables file not found: $vars_file"
        exit 1
    fi
    
    # Generate plan
    terraform plan \
        -var-file="$vars_file" \
        -out="$plan_file" \
        -detailed-exitcode
    
    local plan_exit_code=$?
    
    case $plan_exit_code in
        0)
            log_success "No changes detected in Terraform plan"
            ;;
        1)
            log_error "Terraform plan failed"
            exit 1
            ;;
        2)
            log_success "Terraform plan generated successfully with changes"
            ;;
        *)
            log_error "Unexpected exit code from Terraform plan: $plan_exit_code"
            exit 1
            ;;
    esac
    
    # Show plan summary
    terraform show -no-color "$plan_file" | tee "${LOG_DIR}/terraform-plan-output.log"
}

# Apply Terraform deployment
apply_terraform() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Dry run mode - skipping Terraform apply"
        return 0
    fi
    
    log "Applying Terraform deployment..."
    
    cd "$TERRAFORM_DIR"
    
    local plan_file="${LOG_DIR}/terraform-${ENVIRONMENT}.tfplan"
    local vars_file="${TERRAFORM_DIR}/environments/${ENVIRONMENT}/terraform.tfvars"
    
    # Prompt for confirmation if not auto-approved
    if [[ "$AUTO_APPROVE" != "true" ]]; then
        echo -e "\n${YELLOW}WARNING: This will deploy infrastructure to the ${ENVIRONMENT} environment.${NC}"
        echo "Review the plan above carefully before proceeding."
        echo -n "Do you want to continue? (yes/no): "
        read -r response
        
        if [[ "$response" != "yes" ]]; then
            log "Deployment cancelled by user"
            exit 0
        fi
    fi
    
    # Apply using plan file if it exists, otherwise apply directly
    if [[ -f "$plan_file" ]] && [[ "$SKIP_PLAN" != "true" ]]; then
        terraform apply "$plan_file"
    else
        terraform apply \
            -var-file="$vars_file" \
            -auto-approve
    fi
    
    log_success "Terraform deployment completed"
}

# Save deployment outputs
save_outputs() {
    log "Saving deployment outputs..."
    
    cd "$TERRAFORM_DIR"
    
    local outputs_file="${LOG_DIR}/terraform-outputs-${ENVIRONMENT}.json"
    terraform output -json > "$outputs_file"
    
    log "Deployment outputs saved to: $outputs_file"
    
    # Display key outputs
    echo -e "\n${GREEN}=== Deployment Outputs ===${NC}"
    terraform output
}

# Configure kubectl for AKS
configure_kubectl() {
    log "Configuring kubectl for AKS..."
    
    cd "$TERRAFORM_DIR"
    
    # Get AKS cluster name and resource group from Terraform outputs
    local cluster_name=$(terraform output -raw aks_cluster_name 2>/dev/null || echo "")
    local resource_group=$(terraform output -raw primary_resource_group_name 2>/dev/null || echo "")
    
    if [[ -n "$cluster_name" ]] && [[ -n "$resource_group" ]]; then
        az aks get-credentials \
            --resource-group "$resource_group" \
            --name "$cluster_name" \
            --overwrite-existing
        
        # Verify connection
        kubectl cluster-info --request-timeout=10s
        
        log_success "kubectl configured for AKS cluster: $cluster_name"
    else
        log_warning "Could not retrieve AKS cluster information from Terraform outputs"
    fi
}

# Post-deployment verification
verify_deployment() {
    log "Verifying deployment..."
    
    local health_checks=0
    local failed_checks=0
    
    # Check if this is a Kubernetes deployment
    if kubectl cluster-info &> /dev/null; then
        # Check cluster nodes
        log "Checking AKS cluster nodes..."
        if kubectl get nodes &> /dev/null; then
            local ready_nodes=$(kubectl get nodes --no-headers | grep -c " Ready")
            log_success "$ready_nodes nodes are ready"
            ((health_checks++))
        else
            log_error "Failed to get cluster nodes"
            ((failed_checks++))
        fi
        
        # Check system pods
        log "Checking system pods..."
        local system_pods=$(kubectl get pods -n kube-system --field-selector=status.phase!=Running --no-headers 2>/dev/null | wc -l)
        if [[ "$system_pods" -eq 0 ]]; then
            log_success "All system pods are running"
            ((health_checks++))
        else
            log_warning "$system_pods system pods are not running"
        fi
    fi
    
    # Check if application endpoints are accessible (if outputs available)
    cd "$TERRAFORM_DIR"
    local app_endpoint=$(terraform output -raw traffic_manager_fqdn 2>/dev/null || echo "")
    if [[ -n "$app_endpoint" ]]; then
        log "Checking application endpoint: $app_endpoint"
        if curl -f -s --max-time 30 "https://${app_endpoint}/health" &> /dev/null; then
            log_success "Application endpoint is accessible"
            ((health_checks++))
        else
            log_warning "Application endpoint is not accessible (this may be expected for new deployments)"
        fi
    fi
    
    echo -e "\n${GREEN}=== Verification Summary ===${NC}"
    echo "Health checks passed: $health_checks"
    if [[ "$failed_checks" -gt 0 ]]; then
        echo -e "${RED}Failed checks: $failed_checks${NC}"
        log_warning "Some verification checks failed. Please review the logs."
    else
        log_success "All verification checks passed"
    fi
}

# Cleanup function
cleanup() {
    log "Cleaning up temporary files..."
    # Remove sensitive plan files
    rm -f "${LOG_DIR}"/terraform-*.tfplan
}

# Main deployment function
main() {
    echo -e "${BLUE}"
    echo "======================================"
    echo "  AI Answer Ninja Infrastructure"
    echo "  Deployment Script"
    echo "======================================"
    echo -e "${NC}"
    
    log "Starting deployment for environment: $ENVIRONMENT"
    log "Target region: $REGION"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Running in DRY RUN mode - no changes will be made"
    fi
    
    # Set trap for cleanup
    trap cleanup EXIT
    
    # Execute deployment steps
    validate_environment
    validate_prerequisites
    init_directories
    setup_terraform_backend
    init_terraform
    validate_terraform
    plan_terraform
    apply_terraform
    save_outputs
    configure_kubectl
    verify_deployment
    
    local end_time=$(date)
    log_success "Deployment completed successfully at $end_time"
    
    echo -e "\n${GREEN}=== Deployment Summary ===${NC}"
    echo "Environment: $ENVIRONMENT"
    echo "Region: $REGION"
    echo "Logs: $LOG_DIR/deploy.log"
    echo "Outputs: $LOG_DIR/terraform-outputs-${ENVIRONMENT}.json"
    
    if [[ "$ENVIRONMENT" == "prod" ]]; then
        echo -e "\n${YELLOW}Production Deployment Notes:${NC}"
        echo "- Monitor the system closely for the next 30 minutes"
        echo "- Check all critical alerts and dashboards"
        echo "- Verify disaster recovery endpoints are configured"
        echo "- Run smoke tests against all critical functionality"
    fi
}

# Run main function
main "$@"