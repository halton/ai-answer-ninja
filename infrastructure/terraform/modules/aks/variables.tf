# AKS Module Variables

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
}

variable "location" {
  description = "Azure region for resources"
  type        = string
}

variable "secondary_location" {
  description = "Secondary Azure region for geo-replication"
  type        = string
  default     = "Southeast Asia"
}

variable "resource_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "aks_subnet_id" {
  description = "Subnet ID for AKS cluster"
  type        = string
}

variable "gateway_subnet_id" {
  description = "Subnet ID for Application Gateway"
  type        = string
  default     = ""
}

variable "key_vault_id" {
  description = "Key Vault ID for secrets integration"
  type        = string
  default     = ""
}

variable "log_analytics_workspace_id" {
  description = "Log Analytics Workspace ID"
  type        = string
  default     = ""
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

# AKS Configuration
variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.27"
}

variable "node_count_min" {
  description = "Minimum number of nodes"
  type        = number
  default     = 2
}

variable "node_count_max" {
  description = "Maximum number of nodes"
  type        = number
  default     = 20
}

variable "node_count_default" {
  description = "Default number of nodes"
  type        = number
  default     = 3
}

variable "node_vm_size" {
  description = "VM size for worker nodes"
  type        = string
  default     = "Standard_D4s_v3"
}

variable "enable_private_cluster" {
  description = "Enable private cluster"
  type        = bool
  default     = true
}

variable "enable_container_insights" {
  description = "Enable container insights"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Log retention period in days"
  type        = number
  default     = 30
}

variable "admin_group_object_ids" {
  description = "Azure AD group object IDs for admin access"
  type        = list(string)
  default     = []
}

variable "api_server_authorized_ip_ranges" {
  description = "Authorized IP ranges for API server access"
  type        = list(string)
  default     = []
}

# Spot Instance Configuration
variable "enable_spot_instances" {
  description = "Enable spot instances for cost optimization"
  type        = bool
  default     = false
}

variable "spot_node_vm_size" {
  description = "VM size for spot instances"
  type        = string
  default     = "Standard_D2s_v3"
}

variable "spot_max_price" {
  description = "Maximum price for spot instances (-1 for current on-demand price)"
  type        = number
  default     = -1
}

variable "spot_max_nodes" {
  description = "Maximum number of spot instances"
  type        = number
  default     = 10
}