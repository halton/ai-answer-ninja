# Staging Environment Configuration - AI Answer Ninja
# This file contains staging-specific variables for testing production scenarios

# Project Configuration
project_owner = "ai-team"
cost_center   = "engineering"
environment   = "staging"

# Regional Configuration
primary_region   = "East Asia"
secondary_region = "Southeast Asia"

# Network Configuration
vnet_address_space  = ["10.10.0.0/16"]
aks_subnet_cidr     = "10.10.1.0/24"
db_subnet_cidr      = "10.10.2.0/24"
gateway_subnet_cidr = "10.10.3.0/24"
bastion_subnet_cidr = "10.10.4.0/27"

# AKS Staging Configuration
aks_node_count_min     = 2
aks_node_count_max     = 20
aks_node_count_default = 3
aks_node_vm_size       = "Standard_D4s_v3"  # 4 vCPU, 16 GB RAM
aks_kubernetes_version = "1.27"

# Database Staging Configuration
postgres_sku_name            = "GP_Standard_D4s_v3"  # 4 vCPU, 16 GB RAM
postgres_storage_mb          = 65536  # 64 GB
postgres_backup_retention_days = 14

# Redis Staging Configuration
redis_capacity = 2  # 2.5 GB Standard tier
redis_family   = "C"
redis_sku_name = "Standard"

# Security Configuration
enable_private_cluster           = true
enable_network_security_groups  = true
enable_azure_policy             = true

# Performance and Optimization
enable_premium_storage           = false
enable_accelerated_networking    = true
enable_cluster_autoscaler       = true
enable_horizontal_pod_autoscaler = true
enable_vertical_pod_autoscaler   = false

# High Availability Configuration
enable_geo_redundant_backup      = true
enable_cross_region_replication  = false

# Cost Optimization
enable_cost_optimization = true
spot_instances_enabled  = true  # Enabled for staging cost savings

# Monitoring Configuration
log_retention_days           = 30
enable_container_insights    = true
alert_email                 = "dev-team@company.com"

# Disaster Recovery Configuration
enable_secondary_region      = false  # Simplified DR for staging
enable_database_replication  = false
enable_cross_region_peering  = false
enable_dr_testing           = false

# SSL Configuration
ssl_certificate_name = "ai-answer-ninja-staging-ssl"
domain_name         = "staging-api.ai-answer-ninja.com"

# Compliance and Governance
enable_azure_defender    = false  # Disabled for cost savings
enable_azure_sentinel   = false
enable_compliance_policies = true

# Backup Configuration
backup_retention_days       = 30
point_in_time_restore_days = 7

# Auto-scaling Thresholds (Relaxed for Staging)
cpu_usage_threshold_percent    = 80
memory_usage_threshold_percent = 85
response_time_threshold_ms     = 3000
error_rate_threshold_percent   = 10

# Budget and Cost Management
enable_cost_alerts      = true
monthly_budget_amount   = 800  # $800 USD per month
budget_start_date      = "2024-01-01"
budget_end_date        = "2025-12-31"
budget_alert_emails    = ["dev-team@company.com"]

# Staging Alert Configuration
alert_emails = [
  "dev-team@company.com",
  "qa-team@company.com"
]

critical_alert_emails = [
  "dev-team@company.com"
]

# Webhook Integration (Development Slack)
webhook_urls = [
  "https://hooks.slack.com/services/YOUR/STAGING/WEBHOOK"
]

# Maintenance Window Configuration
enable_maintenance_suppression = true
maintenance_start_time        = "2024-01-01T03:00:00Z"
maintenance_end_time          = "2024-01-01T05:00:00Z"

# Network Access Control (More Permissive for Testing)
allowed_ip_ranges = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "0.0.0.0/0"  # Open for testing (NOT recommended for production)
]

# Application Insights Configuration
sampling_percentage = 100  # Full sampling for staging testing

# Storage Configuration
storage_allowed_ips = [
  "0.0.0.0/0"  # Open access for staging testing
]

# Advanced Features
enable_custom_metrics     = true
enable_distributed_tracing = true
enable_profiling         = true  # Enabled for performance testing

# Data Classification (Staging Environment)
data_classification_labels = {
  "public"       = "staging-public"
  "internal"     = "staging-internal"
  "confidential" = "staging-confidential"
  "restricted"   = "staging-restricted"
}