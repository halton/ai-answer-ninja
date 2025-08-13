# Development Environment Configuration - AI Answer Ninja
# This file contains development-specific variables optimized for cost and flexibility

# Project Configuration
project_owner = "ai-team"
cost_center   = "engineering"
environment   = "dev"

# Regional Configuration
primary_region   = "East Asia"
secondary_region = "Southeast Asia"

# Network Configuration
vnet_address_space  = ["10.20.0.0/16"]
aks_subnet_cidr     = "10.20.1.0/24"
db_subnet_cidr      = "10.20.2.0/24"
gateway_subnet_cidr = "10.20.3.0/24"
bastion_subnet_cidr = "10.20.4.0/27"

# AKS Development Configuration (Minimal Resources)
aks_node_count_min     = 1
aks_node_count_max     = 10
aks_node_count_default = 2
aks_node_vm_size       = "Standard_D2s_v3"  # 2 vCPU, 8 GB RAM
aks_kubernetes_version = "1.27"

# Database Development Configuration
postgres_sku_name            = "B_Standard_B1ms"  # Burstable, 1 vCPU, 2 GB RAM
postgres_storage_mb          = 32768  # 32 GB
postgres_backup_retention_days = 7

# Redis Development Configuration
redis_capacity = 0  # 250 MB Basic tier
redis_family   = "C"
redis_sku_name = "Basic"

# Security Configuration
enable_private_cluster           = false  # Simplified for development
enable_network_security_groups  = false
enable_azure_policy             = false

# Performance and Optimization
enable_premium_storage           = false
enable_accelerated_networking    = false
enable_cluster_autoscaler       = true
enable_horizontal_pod_autoscaler = false
enable_vertical_pod_autoscaler   = false

# High Availability Configuration
enable_geo_redundant_backup      = false
enable_cross_region_replication  = false

# Cost Optimization
enable_cost_optimization = true
spot_instances_enabled  = true
auto_shutdown_enabled   = true  # Enable auto-shutdown for development

# Monitoring Configuration
log_retention_days           = 7
enable_container_insights    = false  # Disabled for cost savings
alert_email                 = "dev-team@company.com"

# Disaster Recovery Configuration
enable_secondary_region      = false
enable_database_replication  = false
enable_cross_region_peering  = false
enable_dr_testing           = false

# SSL Configuration
ssl_certificate_name = ""  # No SSL for development
domain_name         = "dev-api.ai-answer-ninja.local"

# Compliance and Governance
enable_azure_defender    = false
enable_azure_sentinel   = false
enable_compliance_policies = false

# Backup Configuration
backup_retention_days       = 7
point_in_time_restore_days = 1

# Auto-scaling Thresholds (Relaxed for Development)
cpu_usage_threshold_percent    = 90
memory_usage_threshold_percent = 95
response_time_threshold_ms     = 5000
error_rate_threshold_percent   = 20

# Budget and Cost Management
enable_cost_alerts      = true
monthly_budget_amount   = 200  # $200 USD per month
budget_start_date      = "2024-01-01"
budget_end_date        = "2025-12-31"
budget_alert_emails    = ["dev-team@company.com"]

# Development Alert Configuration
alert_emails = [
  "dev-team@company.com"
]

critical_alert_emails = [
  "dev-team@company.com"
]

# Webhook Integration (Development)
webhook_urls = [
  "https://hooks.slack.com/services/YOUR/DEV/WEBHOOK"
]

# Maintenance Window Configuration
enable_maintenance_suppression = false  # No maintenance windows for dev

# Network Access Control (Open for Development)
allowed_ip_ranges = [
  "0.0.0.0/0"  # Completely open for development
]

# Application Insights Configuration
sampling_percentage = 100  # Full sampling for development debugging

# Storage Configuration
storage_allowed_ips = [
  "0.0.0.0/0"  # Open access for development
]

# Advanced Features
enable_custom_metrics     = false
enable_distributed_tracing = false
enable_profiling         = true  # Enabled for debugging

# Data Classification (Development Environment)
data_classification_labels = {
  "public"       = "dev-public"
  "internal"     = "dev-internal"
  "confidential" = "dev-confidential"
  "restricted"   = "dev-restricted"
}