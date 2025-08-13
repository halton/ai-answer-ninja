# Storage Module Variables

variable "primary_rg_name" {
  description = "Primary resource group name"
  type        = string
}

variable "secondary_rg_name" {
  description = "Secondary resource group name"
  type        = string
}

variable "primary_location" {
  description = "Primary Azure region"
  type        = string
}

variable "secondary_location" {
  description = "Secondary Azure region"
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

# Network Configuration
variable "db_subnet_id" {
  description = "Database subnet ID"
  type        = string
}

variable "redis_subnet_id" {
  description = "Redis subnet ID"
  type        = string
  default     = ""
}

variable "aks_subnet_id" {
  description = "AKS subnet ID for storage access"
  type        = string
}

variable "vnet_id" {
  description = "Virtual Network ID"
  type        = string
}

# PostgreSQL Configuration
variable "db_admin_password" {
  description = "PostgreSQL admin password"
  type        = string
  sensitive   = true
}

variable "sku_name" {
  description = "PostgreSQL SKU name"
  type        = string
  default     = "GP_Standard_D2s_v3"
}

variable "storage_mb" {
  description = "PostgreSQL storage in MB"
  type        = number
  default     = 32768
}

variable "backup_retention_days" {
  description = "Backup retention period in days"
  type        = number
  default     = 35
}

variable "enable_geo_redundant_backup" {
  description = "Enable geo-redundant backup"
  type        = bool
  default     = true
}

variable "enable_read_replica" {
  description = "Enable PostgreSQL read replica"
  type        = bool
  default     = false
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

variable "redis_private_ip" {
  description = "Redis private IP address"
  type        = string
  default     = ""
}

# Storage Configuration
variable "enable_premium_storage" {
  description = "Enable premium storage"
  type        = bool
  default     = false
}

variable "enable_geo_redundant_storage" {
  description = "Enable geo-redundant storage"
  type        = bool
  default     = true
}

variable "enable_cross_region_replication" {
  description = "Enable cross-region replication"
  type        = bool
  default     = false
}

variable "storage_allowed_ips" {
  description = "Allowed IP addresses for storage access"
  type        = list(string)
  default     = []
}

# Optional Services
variable "enable_cosmos_db" {
  description = "Enable Cosmos DB for analytics"
  type        = bool
  default     = false
}

# Security
variable "key_vault_id" {
  description = "Key Vault ID for storing secrets"
  type        = string
}

# Monitoring
variable "action_group_id" {
  description = "Action group ID for alerts"
  type        = string
  default     = ""
}