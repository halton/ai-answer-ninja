# Security Module Outputs

# Key Vault Outputs
output "key_vault_id" {
  description = "Key Vault ID"
  value       = azurerm_key_vault.main.id
}

output "key_vault_name" {
  description = "Key Vault name"
  value       = azurerm_key_vault.main.name
}

output "key_vault_uri" {
  description = "Key Vault URI"
  value       = azurerm_key_vault.main.vault_uri
}

# Managed Identity Outputs
output "aks_managed_identity_id" {
  description = "AKS managed identity ID"
  value       = azurerm_user_assigned_identity.aks.id
}

output "aks_managed_identity_client_id" {
  description = "AKS managed identity client ID"
  value       = azurerm_user_assigned_identity.aks.client_id
}

output "aks_managed_identity_principal_id" {
  description = "AKS managed identity principal ID"
  value       = azurerm_user_assigned_identity.aks.principal_id
}

# Encryption Keys Outputs
output "storage_encryption_key_id" {
  description = "Storage encryption key ID"
  value       = azurerm_key_vault_key.storage_encryption.id
}

output "database_encryption_key_id" {
  description = "Database encryption key ID"
  value       = azurerm_key_vault_key.database_encryption.id
}

# SSL Certificate Outputs
output "ssl_certificate_id" {
  description = "SSL certificate ID"
  value       = var.ssl_certificate_name != "" ? azurerm_key_vault_certificate.ssl[0].id : ""
}

output "ssl_certificate_thumbprint" {
  description = "SSL certificate thumbprint"
  value       = var.ssl_certificate_name != "" ? azurerm_key_vault_certificate.ssl[0].thumbprint : ""
  sensitive   = true
}

# Policy Outputs
output "security_policy_definition_id" {
  description = "Security policy definition ID"
  value       = var.enable_azure_policy ? azurerm_policy_definition.ai_security_policy[0].id : ""
}

output "security_policy_assignment_id" {
  description = "Security policy assignment ID"
  value       = var.enable_azure_policy ? azurerm_policy_assignment.ai_security_policy[0].id : ""
}

# Custom Role Outputs
output "ai_operator_role_id" {
  description = "AI Operator custom role ID"
  value       = var.create_custom_roles ? azurerm_role_definition.ai_operator[0].role_definition_resource_id : ""
}

output "ai_developer_role_id" {
  description = "AI Developer custom role ID"
  value       = var.create_custom_roles ? azurerm_role_definition.ai_developer[0].role_definition_resource_id : ""
}

# Sentinel Outputs
output "sentinel_workspace_id" {
  description = "Azure Sentinel workspace ID"
  value       = var.enable_azure_sentinel ? azurerm_log_analytics_solution.sentinel[0].workspace_resource_id : ""
}