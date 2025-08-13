# Main Terraform Outputs - Production Infrastructure

# Resource Group Information
output "primary_resource_group_name" {
  description = "Name of the primary resource group"
  value       = azurerm_resource_group.primary.name
}

output "secondary_resource_group_name" {
  description = "Name of the secondary resource group"
  value       = azurerm_resource_group.secondary.name
}

output "shared_resource_group_name" {
  description = "Name of the shared resource group"
  value       = azurerm_resource_group.shared.name
}

# AKS Cluster Information
output "aks_cluster_name" {
  description = "Name of the primary AKS cluster"
  value       = module.aks.cluster_name
}

output "aks_cluster_fqdn" {
  description = "FQDN of the AKS cluster"
  value       = module.aks.cluster_fqdn
}

output "aks_cluster_id" {
  description = "ID of the AKS cluster"
  value       = module.aks.cluster_id
}

output "container_registry_login_server" {
  description = "Container Registry login server"
  value       = module.aks.container_registry_login_server
}

# Networking Information
output "virtual_network_id" {
  description = "ID of the virtual network"
  value       = module.networking.vnet_id
}

output "aks_subnet_id" {
  description = "ID of the AKS subnet"
  value       = module.networking.aks_subnet_id
}

output "application_gateway_public_ip" {
  description = "Public IP of the Application Gateway"
  value       = module.aks.application_gateway_public_ip
}

# Database Information
output "postgres_server_fqdn" {
  description = "PostgreSQL server FQDN"
  value       = module.storage.postgres_server_fqdn
  sensitive   = true
}

output "postgres_database_name" {
  description = "PostgreSQL database name"
  value       = module.storage.postgres_database_name
}

output "redis_hostname" {
  description = "Redis cache hostname"
  value       = module.storage.redis_hostname
  sensitive   = true
}

# Storage Information
output "storage_account_name" {
  description = "Storage account name"
  value       = module.storage.storage_account_name
}

output "storage_account_primary_endpoint" {
  description = "Storage account primary blob endpoint"
  value       = module.storage.storage_account_primary_endpoint
}

# Security Information
output "key_vault_name" {
  description = "Key Vault name"
  value       = module.security.key_vault_name
}

output "key_vault_uri" {
  description = "Key Vault URI"
  value       = module.security.key_vault_uri
}

# Monitoring Information
output "log_analytics_workspace_name" {
  description = "Log Analytics workspace name"
  value       = module.monitoring.log_analytics_workspace_name
}

output "application_insights_name" {
  description = "Application Insights name"
  value       = module.monitoring.application_insights_name
}

output "application_insights_instrumentation_key" {
  description = "Application Insights instrumentation key"
  value       = module.monitoring.application_insights_instrumentation_key
  sensitive   = true
}

output "application_insights_connection_string" {
  description = "Application Insights connection string"
  value       = module.monitoring.application_insights_connection_string
  sensitive   = true
}

# Traffic Manager and Disaster Recovery
output "traffic_manager_fqdn" {
  description = "Traffic Manager profile FQDN"
  value       = azurerm_traffic_manager_profile.main.fqdn
}

output "traffic_manager_profile_name" {
  description = "Traffic Manager profile name"
  value       = azurerm_traffic_manager_profile.main.name
}

output "dr_automation_account_name" {
  description = "Disaster Recovery automation account name"
  value       = azurerm_automation_account.dr.name
}

# Connection Strings (for application configuration)
output "database_connection_string_secret_name" {
  description = "Name of the database connection string secret in Key Vault"
  value       = "postgres-connection-string"
}

output "redis_connection_string_secret_name" {
  description = "Name of the Redis connection string secret in Key Vault"
  value       = "redis-connection-string"
}

output "storage_connection_string_secret_name" {
  description = "Name of the storage connection string secret in Key Vault"
  value       = "storage-connection-string"
}

# Kubernetes Configuration (for CI/CD)
output "kubeconfig_command" {
  description = "Command to get AKS credentials"
  value       = "az aks get-credentials --resource-group ${module.aks.cluster_name} --name ${module.aks.cluster_name}"
  sensitive   = true
}

# Cost Management
output "monthly_budget_amount" {
  description = "Monthly budget amount configured"
  value       = var.monthly_budget_amount
}

output "cost_export_storage_account" {
  description = "Storage account used for cost exports"
  value       = module.storage.storage_account_name
}

# Environment Information
output "environment" {
  description = "Environment name"
  value       = var.environment
}

output "primary_region" {
  description = "Primary deployment region"
  value       = var.primary_region
}

output "secondary_region" {
  description = "Secondary deployment region (DR)"
  value       = var.secondary_region
}

# DNS and Domain Information
output "domain_name" {
  description = "Domain name configured"
  value       = var.domain_name
}

# High-Level Configuration Summary
output "deployment_summary" {
  description = "Summary of deployment configuration"
  value = {
    environment                = var.environment
    primary_region            = var.primary_region
    secondary_region          = var.secondary_region
    aks_node_count_default    = var.aks_node_count_default
    aks_node_vm_size          = var.aks_node_vm_size
    postgres_sku              = var.postgres_sku_name
    redis_sku                 = var.redis_sku_name
    disaster_recovery_enabled = var.enable_secondary_region
    cost_optimization_enabled = var.enable_cost_optimization
    monitoring_enabled        = var.enable_container_insights
    security_features = {
      private_cluster     = var.enable_private_cluster
      azure_policy       = var.enable_azure_policy
      azure_defender     = var.enable_azure_defender
      network_security   = var.enable_network_security_groups
    }
  }
}

# Service Endpoints for Application Configuration
output "service_endpoints" {
  description = "Service endpoints for application configuration"
  value = {
    traffic_manager_endpoint = "https://${azurerm_traffic_manager_profile.main.fqdn}"
    primary_api_endpoint     = "https://${module.aks.application_gateway_public_ip}"
    key_vault_endpoint       = module.security.key_vault_uri
    storage_endpoint         = module.storage.storage_account_primary_endpoint
    container_registry       = module.aks.container_registry_login_server
    monitoring_endpoint      = "https://portal.azure.com/#@/resource${module.monitoring.application_insights_id}/overview"
  }
  sensitive = true
}

# Terraform State Information
output "terraform_state_info" {
  description = "Information about Terraform state management"
  value = {
    backend_type = "azurerm"
    environment  = var.environment
    last_updated = timestamp()
  }
}