# AI Answer Ninja - Terraform Variables

# Project Configuration
variable "project_owner" {
  description = "Project owner for tagging and billing"
  type        = string
  default     = "ai-team"
}

variable "cost_center" {
  description = "Cost center for billing allocation"
  type        = string
  default     = "engineering"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

# Regional Configuration
variable "primary_region" {
  description = "Primary Azure region"
  type        = string
  default     = "East Asia"
}

variable "secondary_region" {
  description = "Secondary Azure region for disaster recovery"
  type        = string
  default     = "Southeast Asia"
}

# Network Configuration
variable "vnet_address_space" {
  description = "Address space for the virtual network"
  type        = list(string)
  default     = ["10.0.0.0/16"]
}

variable "aks_subnet_cidr" {
  description = "CIDR block for AKS subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "db_subnet_cidr" {
  description = "CIDR block for database subnet"
  type        = string
  default     = "10.0.2.0/24"
}

variable "gateway_subnet_cidr" {
  description = "CIDR block for application gateway subnet"
  type        = string
  default     = "10.0.3.0/24"
}

variable "bastion_subnet_cidr" {
  description = "CIDR block for bastion subnet"
  type        = string
  default     = "10.0.4.0/27"
}

# AKS Configuration
variable "aks_node_count_min" {
  description = "Minimum number of nodes in the AKS cluster"
  type        = number
  default     = 2
}

variable "aks_node_count_max" {
  description = "Maximum number of nodes in the AKS cluster"
  type        = number
  default     = 20
}

variable "aks_node_count_default" {
  description = "Default number of nodes in the AKS cluster"
  type        = number
  default     = 3
}

variable "aks_node_vm_size" {
  description = "VM size for AKS nodes"
  type        = string
  default     = "Standard_D4s_v3"
}

variable "aks_kubernetes_version" {
  description = "Kubernetes version for AKS cluster"
  type        = string
  default     = "1.27"
}

# Database Configuration
variable "postgres_sku_name" {
  description = "PostgreSQL SKU name"
  type        = string
  default     = "GP_Standard_D4s_v3"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage in MB"
  type        = number
  default     = 32768
}

variable "postgres_backup_retention_days" {
  description = "Backup retention period in days"
  type        = number
  default     = 35
}

# Redis Configuration
variable "redis_capacity" {
  description = "Redis cache capacity"
  type        = number
  default     = 1
}

variable "redis_family" {
  description = "Redis cache family"
  type        = string
  default     = "C"
}

variable "redis_sku_name" {
  description = "Redis cache SKU name"
  type        = string
  default     = "Standard"
}

# Cost Optimization
variable "enable_cost_optimization" {
  description = "Enable cost optimization features"
  type        = bool
  default     = true
}

variable "auto_shutdown_enabled" {
  description = "Enable auto-shutdown for non-production environments"
  type        = bool
  default     = false
}

variable "spot_instances_enabled" {
  description = "Enable spot instances for cost savings"
  type        = bool
  default     = false
}

# Security Configuration
variable "enable_private_cluster" {
  description = "Enable private AKS cluster"
  type        = bool
  default     = true
}

variable "enable_network_security_groups" {
  description = "Enable network security groups"
  type        = bool
  default     = true
}

variable "enable_azure_policy" {
  description = "Enable Azure Policy for governance"
  type        = bool
  default     = true
}

# Monitoring Configuration
variable "log_retention_days" {
  description = "Log Analytics workspace retention in days"
  type        = number
  default     = 30
}

variable "enable_container_insights" {
  description = "Enable container insights for AKS"
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Email address for monitoring alerts"
  type        = string
  default     = "ops@company.com"
}

# Backup Configuration
variable "backup_retention_days" {
  description = "Backup retention period in days"
  type        = number
  default     = 30
}

variable "point_in_time_restore_days" {
  description = "Point-in-time restore period in days"
  type        = number
  default     = 7
}

# Auto-scaling Configuration
variable "enable_cluster_autoscaler" {
  description = "Enable cluster autoscaler"
  type        = bool
  default     = true
}

variable "enable_horizontal_pod_autoscaler" {
  description = "Enable horizontal pod autoscaler"
  type        = bool
  default     = true
}

variable "enable_vertical_pod_autoscaler" {
  description = "Enable vertical pod autoscaler"
  type        = bool
  default     = false
}

# Performance Configuration
variable "enable_premium_storage" {
  description = "Enable premium storage for better performance"
  type        = bool
  default     = false
}

variable "enable_accelerated_networking" {
  description = "Enable accelerated networking for VMs"
  type        = bool
  default     = true
}

# Disaster Recovery Configuration
variable "enable_geo_redundant_backup" {
  description = "Enable geo-redundant backup"
  type        = bool
  default     = true
}

variable "enable_cross_region_replication" {
  description = "Enable cross-region replication"
  type        = bool
  default     = false
}