# Security Module Variables

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
}

variable "location" {
  description = "Azure region for resources"
  type        = string
}

variable "resource_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "key_vault_suffix" {
  description = "Suffix for Key Vault name (to ensure uniqueness)"
  type        = string
}

variable "tenant_id" {
  description = "Azure AD tenant ID"
  type        = string
}

variable "object_id" {
  description = "Object ID of the service principal"
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

# Network Security
variable "allowed_ip_ranges" {
  description = "Allowed IP ranges for Key Vault access"
  type        = list(string)
  default     = []
}

variable "trusted_subnet_ids" {
  description = "Subnet IDs trusted for Key Vault access"
  type        = list(string)
  default     = []
}

# SSL Configuration
variable "ssl_certificate_name" {
  description = "Name for SSL certificate"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Domain name for SSL certificate"
  type        = string
  default     = "example.com"
}

# Azure Policy
variable "enable_azure_policy" {
  description = "Enable Azure Policy for governance"
  type        = bool
  default     = true
}

variable "policy_assignment_scope" {
  description = "Scope for policy assignment"
  type        = string
  default     = ""
}

# Azure Defender
variable "enable_azure_defender" {
  description = "Enable Azure Defender for enhanced security"
  type        = bool
  default     = true
}

# Azure Sentinel
variable "enable_azure_sentinel" {
  description = "Enable Azure Sentinel for SIEM"
  type        = bool
  default     = false
}

variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID for Sentinel"
  type        = string
  default     = ""
}

variable "log_analytics_workspace_name" {
  description = "Log Analytics workspace name for Sentinel"
  type        = string
  default     = ""
}

# Custom RBAC Roles
variable "create_custom_roles" {
  description = "Create custom RBAC roles"
  type        = bool
  default     = true
}

variable "role_definition_scope" {
  description = "Scope for custom role definitions"
  type        = string
  default     = ""
}

# Compliance and Security Standards
variable "enable_compliance_policies" {
  description = "Enable compliance policies (SOC2, GDPR, etc.)"
  type        = bool
  default     = true
}

variable "data_classification_labels" {
  description = "Data classification labels for compliance"
  type        = map(string)
  default = {
    "public"       = "public"
    "internal"     = "internal"
    "confidential" = "confidential"
    "restricted"   = "restricted"
  }
}