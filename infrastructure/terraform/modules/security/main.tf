# Security Module - Key Vault, RBAC, and Security Policies

# Key Vault for secrets management
resource "azurerm_key_vault" "main" {
  name                = "${var.resource_prefix}-kv-${var.key_vault_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  
  sku_name                   = "premium"
  soft_delete_retention_days = 7
  purge_protection_enabled   = true
  
  # Network access restrictions
  network_acls {
    bypass         = "AzureServices"
    default_action = "Deny"
    ip_rules       = var.allowed_ip_ranges
    virtual_network_subnet_ids = var.trusted_subnet_ids
  }
  
  # Advanced security features
  enable_rbac_authorization = true
  
  tags = var.tags
}

# Key Vault access policy for Terraform service principal
resource "azurerm_key_vault_access_policy" "terraform" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = var.tenant_id
  object_id    = var.object_id
  
  key_permissions = [
    "Get", "List", "Create", "Update", "Delete", "Backup", "Restore", "Recover", "Purge"
  ]
  
  secret_permissions = [
    "Get", "List", "Set", "Delete", "Backup", "Restore", "Recover", "Purge"
  ]
  
  certificate_permissions = [
    "Get", "List", "Create", "Update", "Delete", "ManageContacts", "ManageIssuers",
    "GetIssuers", "ListIssuers", "SetIssuers", "DeleteIssuers", "Backup", "Restore",
    "Recover", "Purge"
  ]
}

# Managed Identity for AKS to access Key Vault
resource "azurerm_user_assigned_identity" "aks" {
  name                = "${var.resource_prefix}-aks-identity"
  location            = var.location
  resource_group_name = var.resource_group_name
  
  tags = var.tags
}

# Role assignments for AKS managed identity
resource "azurerm_role_assignment" "aks_key_vault_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.aks.principal_id
}

resource "azurerm_role_assignment" "aks_key_vault_crypto_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Crypto User"
  principal_id         = azurerm_user_assigned_identity.aks.principal_id
}

# Generate encryption keys
resource "azurerm_key_vault_key" "storage_encryption" {
  name         = "storage-encryption-key"
  key_vault_id = azurerm_key_vault.main.id
  key_type     = "RSA"
  key_size     = 2048
  
  key_opts = [
    "decrypt", "encrypt", "sign", "unwrapKey", "verify", "wrapKey"
  ]
  
  tags = var.tags
  
  depends_on = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_key" "database_encryption" {
  name         = "database-encryption-key"
  key_vault_id = azurerm_key_vault.main.id
  key_type     = "RSA"
  key_size     = 2048
  
  key_opts = [
    "decrypt", "encrypt", "sign", "unwrapKey", "verify", "wrapKey"
  ]
  
  tags = var.tags
  
  depends_on = [azurerm_key_vault_access_policy.terraform]
}

# SSL Certificate for HTTPS termination
resource "azurerm_key_vault_certificate" "ssl" {
  count = var.ssl_certificate_name != "" ? 1 : 0
  
  name         = var.ssl_certificate_name
  key_vault_id = azurerm_key_vault.main.id
  
  certificate_policy {
    issuer_parameters {
      name = "Self"
    }
    
    key_properties {
      exportable = true
      key_size   = 2048
      key_type   = "RSA"
      reuse_key  = true
    }
    
    lifetime_action {
      action {
        action_type = "AutoRenew"
      }
      
      trigger {
        days_before_expiry = 30
      }
    }
    
    secret_properties {
      content_type = "application/x-pkcs12"
    }
    
    x509_certificate_properties {
      key_usage = [
        "cRLSign", "dataEncipherment", "digitalSignature", "keyAgreement",
        "keyCertSign", "keyEncipherment"
      ]
      
      subject            = "CN=${var.domain_name}"
      validity_in_months = 12
      
      subject_alternative_names {
        dns_names = [var.domain_name, "*.${var.domain_name}"]
      }
    }
  }
  
  tags = var.tags
  
  depends_on = [azurerm_key_vault_access_policy.terraform]
}

# Azure Policy for governance and compliance
resource "azurerm_policy_definition" "ai_security_policy" {
  count = var.enable_azure_policy ? 1 : 0
  
  name         = "${var.resource_prefix}-security-policy"
  policy_type  = "Custom"
  mode         = "All"
  display_name = "AI Answer Ninja Security Policy"
  description  = "Custom security policy for AI Answer Ninja infrastructure"
  
  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field  = "type"
          equals = "Microsoft.Storage/storageAccounts"
        }
      ]
    }
    then = {
      effect = "deny"
      details = {
        condition = {
          field  = "Microsoft.Storage/storageAccounts/supportsHttpsTrafficOnly"
          equals = "false"
        }
      }
    }
  })
  
  metadata = jsonencode({
    category = "Storage"
  })
}

# Policy Assignment
resource "azurerm_policy_assignment" "ai_security_policy" {
  count = var.enable_azure_policy ? 1 : 0
  
  name                 = "${var.resource_prefix}-security-assignment"
  scope                = var.policy_assignment_scope
  policy_definition_id = azurerm_policy_definition.ai_security_policy[0].id
  description          = "Assignment of AI Answer Ninja security policy"
  display_name         = "AI Security Policy Assignment"
  
  identity {
    type = "SystemAssigned"
  }
  
  location = var.location
}

# Azure Defender (Security Center) configuration
resource "azurerm_security_center_subscription_pricing" "storage" {
  count = var.enable_azure_defender ? 1 : 0
  
  tier          = "Standard"
  resource_type = "StorageAccounts"
}

resource "azurerm_security_center_subscription_pricing" "kubernetes" {
  count = var.enable_azure_defender ? 1 : 0
  
  tier          = "Standard"
  resource_type = "KubernetesService"
}

resource "azurerm_security_center_subscription_pricing" "container_registry" {
  count = var.enable_azure_defender ? 1 : 0
  
  tier          = "Standard"
  resource_type = "ContainerRegistry"
}

resource "azurerm_security_center_subscription_pricing" "key_vault" {
  count = var.enable_azure_defender ? 1 : 0
  
  tier          = "Standard"
  resource_type = "KeyVaults"
}

# Azure Sentinel (SIEM) workspace connection
resource "azurerm_log_analytics_solution" "sentinel" {
  count = var.enable_azure_sentinel ? 1 : 0
  
  solution_name         = "SecurityInsights"
  location              = var.location
  resource_group_name   = var.resource_group_name
  workspace_resource_id = var.log_analytics_workspace_id
  workspace_name        = var.log_analytics_workspace_name
  
  plan {
    publisher = "Microsoft"
    product   = "OMSGallery/SecurityInsights"
  }
  
  tags = var.tags
}

# Custom RBAC roles for fine-grained access control
resource "azurerm_role_definition" "ai_operator" {
  count = var.create_custom_roles ? 1 : 0
  
  name        = "${var.resource_prefix}-ai-operator"
  scope       = var.role_definition_scope
  description = "Custom role for AI Answer Ninja operators"
  
  permissions {
    actions = [
      "Microsoft.ContainerService/managedClusters/read",
      "Microsoft.ContainerService/managedClusters/listClusterUserCredential/action",
      "Microsoft.Storage/storageAccounts/read",
      "Microsoft.Storage/storageAccounts/listKeys/action",
      "Microsoft.Cache/redis/read",
      "Microsoft.Cache/redis/listKeys/action",
      "Microsoft.KeyVault/vaults/read",
      "Microsoft.KeyVault/vaults/secrets/read"
    ]
    
    not_actions = [
      "Microsoft.ContainerService/managedClusters/delete",
      "Microsoft.Storage/storageAccounts/delete",
      "Microsoft.KeyVault/vaults/delete"
    ]
    
    data_actions = [
      "Microsoft.KeyVault/vaults/secrets/getSecret/action"
    ]
    
    not_data_actions = [
      "Microsoft.KeyVault/vaults/secrets/setSecret/action"
    ]
  }
  
  assignable_scopes = [
    var.role_definition_scope
  ]
}

resource "azurerm_role_definition" "ai_developer" {
  count = var.create_custom_roles ? 1 : 0
  
  name        = "${var.resource_prefix}-ai-developer"
  scope       = var.role_definition_scope
  description = "Custom role for AI Answer Ninja developers"
  
  permissions {
    actions = [
      "Microsoft.ContainerService/managedClusters/read",
      "Microsoft.ContainerService/managedClusters/listClusterUserCredential/action",
      "Microsoft.ContainerRegistry/registries/read",
      "Microsoft.ContainerRegistry/registries/push/write",
      "Microsoft.ContainerRegistry/registries/pull/read",
      "Microsoft.Storage/storageAccounts/read",
      "Microsoft.Cache/redis/read",
      "Microsoft.KeyVault/vaults/read",
      "Microsoft.KeyVault/vaults/secrets/read"
    ]
    
    not_actions = []
    
    data_actions = [
      "Microsoft.KeyVault/vaults/secrets/getSecret/action"
    ]
    
    not_data_actions = []
  }
  
  assignable_scopes = [
    var.role_definition_scope
  ]
}

# Diagnostic settings for Key Vault
resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name               = "${var.resource_prefix}-kv-diagnostics"
  target_resource_id = azurerm_key_vault.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id
  
  enabled_log {
    category = "AuditEvent"
  }
  
  enabled_log {
    category = "AzurePolicyEvaluationDetails"
  }
  
  metric {
    category = "AllMetrics"
    enabled  = true
  }
  
  depends_on = [azurerm_key_vault.main]
}