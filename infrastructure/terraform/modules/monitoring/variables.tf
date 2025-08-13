# Monitoring Module Variables

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
}

variable "resource_group_id" {
  description = "ID of the resource group"
  type        = string
  default     = ""
}

variable "location" {
  description = "Azure region for resources"
  type        = string
}

variable "resource_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# Log Analytics Configuration
variable "log_retention_days" {
  description = "Log retention period in days"
  type        = number
  default     = 30
}

variable "daily_quota_gb" {
  description = "Daily data ingestion quota in GB (-1 for unlimited)"
  type        = number
  default     = -1
}

# Application Insights Configuration
variable "sampling_percentage" {
  description = "Sampling percentage for Application Insights"
  type        = number
  default     = 100
  validation {
    condition     = var.sampling_percentage >= 0 && var.sampling_percentage <= 100
    error_message = "Sampling percentage must be between 0 and 100."
  }
}

# Resource IDs for monitoring
variable "aks_cluster_id" {
  description = "AKS cluster ID"
  type        = string
}

variable "postgres_server_id" {
  description = "PostgreSQL server ID"
  type        = string
  default     = ""
}

variable "redis_cache_id" {
  description = "Redis cache ID"
  type        = string
  default     = ""
}

variable "key_vault_id" {
  description = "Key Vault ID"
  type        = string
  default     = ""
}

# Alert Configuration
variable "alert_emails" {
  description = "Email addresses for alert notifications"
  type        = list(string)
  default     = []
}

variable "critical_alert_emails" {
  description = "Email addresses for critical alert notifications"
  type        = list(string)
  default     = []
}

variable "alert_phone_numbers" {
  description = "Phone numbers for SMS alerts"
  type = list(object({
    country_code = string
    phone_number = string
  }))
  default = []
}

variable "critical_alert_phone_numbers" {
  description = "Phone numbers for critical SMS alerts"
  type = list(object({
    country_code = string
    phone_number = string
  }))
  default = []
}

variable "webhook_urls" {
  description = "Webhook URLs for alert integrations"
  type        = list(string)
  default     = []
}

variable "azure_function_receivers" {
  description = "Azure Function receivers for alerts"
  type = list(object({
    name                     = string
    function_app_resource_id = string
    function_name           = string
    http_trigger_url        = string
  }))
  default = []
}

# Cost Management
variable "enable_cost_alerts" {
  description = "Enable cost management alerts"
  type        = bool
  default     = true
}

variable "subscription_id" {
  description = "Azure subscription ID for cost alerts"
  type        = string
  default     = ""
}

variable "monthly_budget_amount" {
  description = "Monthly budget amount in USD"
  type        = number
  default     = 1000
}

variable "budget_start_date" {
  description = "Budget start date (YYYY-MM-DD)"
  type        = string
  default     = "2024-01-01"
}

variable "budget_end_date" {
  description = "Budget end date (YYYY-MM-DD)"
  type        = string
  default     = "2025-12-31"
}

variable "budget_alert_emails" {
  description = "Email addresses for budget alerts"
  type        = list(string)
  default     = []
}

# Maintenance Window Configuration
variable "enable_maintenance_suppression" {
  description = "Enable alert suppression during maintenance windows"
  type        = bool
  default     = true
}

variable "maintenance_start_time" {
  description = "Maintenance window start time (ISO 8601 format)"
  type        = string
  default     = "2024-01-01T02:00:00Z"
}

variable "maintenance_end_time" {
  description = "Maintenance window end time (ISO 8601 format)"
  type        = string
  default     = "2024-01-01T04:00:00Z"
}

# Advanced Monitoring Features
variable "enable_custom_metrics" {
  description = "Enable custom metrics collection"
  type        = bool
  default     = true
}

variable "enable_distributed_tracing" {
  description = "Enable distributed tracing"
  type        = bool
  default     = true
}

variable "enable_profiling" {
  description = "Enable application profiling"
  type        = bool
  default     = false
}

# Performance Thresholds
variable "response_time_threshold_ms" {
  description = "Response time threshold in milliseconds"
  type        = number
  default     = 2000
}

variable "error_rate_threshold_percent" {
  description = "Error rate threshold in percentage"
  type        = number
  default     = 5
}

variable "cpu_usage_threshold_percent" {
  description = "CPU usage threshold in percentage"
  type        = number
  default     = 80
}

variable "memory_usage_threshold_percent" {
  description = "Memory usage threshold in percentage"
  type        = number
  default     = 85
}