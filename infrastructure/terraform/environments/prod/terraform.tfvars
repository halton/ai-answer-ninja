# Production Environment Configuration - AI Answer Ninja
# This file contains production-specific variables and settings

# Project Configuration
project_owner = "ai-team"
cost_center   = "engineering"
environment   = "prod"

# Regional Configuration
primary_region   = "East Asia"
secondary_region = "Southeast Asia"

# Network Configuration
vnet_address_space  = ["10.0.0.0/16"]
aks_subnet_cidr     = "10.0.1.0/24"
db_subnet_cidr      = "10.0.2.0/24"
gateway_subnet_cidr = "10.0.3.0/24"
bastion_subnet_cidr = "10.0.4.0/27"

# AKS Production Configuration
aks_node_count_min     = 3
aks_node_count_max     = 50
aks_node_count_default = 6
aks_node_vm_size       = "Standard_D8s_v3"  # 8 vCPU, 32 GB RAM
aks_kubernetes_version = "1.27"

# Database Production Configuration
postgres_sku_name            = "GP_Standard_D8s_v3"  # 8 vCPU, 32 GB RAM
postgres_storage_mb          = 131072  # 128 GB
postgres_backup_retention_days = 35

# Redis Production Configuration
redis_capacity = 6  # 6 GB Premium tier
redis_family   = "P"
redis_sku_name = "Premium"

# Security Configuration
enable_private_cluster           = true
enable_network_security_groups  = true
enable_azure_policy             = true

# Performance and Optimization
enable_premium_storage           = true
enable_accelerated_networking    = true
enable_cluster_autoscaler       = true
enable_horizontal_pod_autoscaler = true
enable_vertical_pod_autoscaler   = true

# High Availability Configuration
enable_geo_redundant_backup      = true
enable_cross_region_replication  = true

# Cost Optimization
enable_cost_optimization = true
spot_instances_enabled  = false  # Disabled for production reliability

# Monitoring Configuration
log_retention_days           = 90
enable_container_insights    = true
alert_email                 = "ops-team@company.com"

# Disaster Recovery Configuration
enable_secondary_region      = true
enable_database_replication  = true
enable_cross_region_peering  = true
enable_dr_testing           = true

# SSL Configuration
ssl_certificate_name = "ai-answer-ninja-ssl"
domain_name         = "api.ai-answer-ninja.com"

# Compliance and Governance
enable_azure_defender    = true
enable_azure_sentinel   = false  # Enable if SIEM is required
enable_compliance_policies = true

# Backup Configuration
backup_retention_days       = 90
point_in_time_restore_days = 35

# Auto-scaling Thresholds (Production Tuned)
cpu_usage_threshold_percent    = 70
memory_usage_threshold_percent = 75
response_time_threshold_ms     = 1500
error_rate_threshold_percent   = 2

# Budget and Cost Management
enable_cost_alerts      = true
monthly_budget_amount   = 3000  # $3000 USD per month
budget_start_date      = "2024-01-01"
budget_end_date        = "2025-12-31"
budget_alert_emails    = ["finance@company.com", "ops-team@company.com"]

# Production Alert Configuration
alert_emails = [
  "ops-team@company.com",
  "devops@company.com",
  "oncall@company.com"
]

critical_alert_emails = [
  "ops-team@company.com",
  "cto@company.com",
  "oncall@company.com"
]

# SMS Alerts for Critical Issues
critical_alert_phone_numbers = [
  {
    country_code = "86"
    phone_number = "13800138000"
  }
]

# Webhook Integration
webhook_urls = [
  "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
]

# Maintenance Window Configuration
enable_maintenance_suppression = true
maintenance_start_time        = "2024-01-01T02:00:00Z"
maintenance_end_time          = "2024-01-01T04:00:00Z"

# Network Access Control
allowed_ip_ranges = [
  "10.0.0.0/8",     # Internal networks
  "172.16.0.0/12",  # Private networks
  "1.2.3.4/32"      # Office IP (example)
]

# Application Insights Configuration
sampling_percentage = 50  # Reduced sampling for cost optimization in production

# DR Failover Configuration
failover_webhook_url = "https://hooks.slack.com/services/YOUR/DR/WEBHOOK"

# Storage Configuration
storage_allowed_ips = [
  "10.0.0.0/8"      # Only allow internal access
]

# Advanced Features
enable_custom_metrics     = true
enable_distributed_tracing = true
enable_profiling         = false  # Disabled for performance in production

# Data Classification
data_classification_labels = {
  "public"       = "public"
  "internal"     = "internal-use-only"
  "confidential" = "confidential-restricted"
  "restricted"   = "highly-restricted"
}