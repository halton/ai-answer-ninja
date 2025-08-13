# AI Answer Ninja - Production Infrastructure
# Multi-region Azure deployment with auto-scaling and disaster recovery

terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
  
  backend "azurerm" {
    # Backend configuration will be provided via -backend-config
  }
}

# Configure Azure Provider
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

# Data sources
data "azurerm_client_config" "current" {}

# Local variables
locals {
  project_name = "ai-answer-ninja"
  common_tags = {
    Project     = local.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = var.project_owner
    CostCenter  = var.cost_center
    CreatedDate = formatdate("YYYY-MM-DD", timestamp())
  }
  
  # Naming convention
  resource_prefix = "${local.project_name}-${var.environment}"
  
  # Multi-region configuration
  primary_region   = var.primary_region
  secondary_region = var.secondary_region
  
  # Network configuration
  vnet_address_space     = var.vnet_address_space
  aks_subnet_cidr        = var.aks_subnet_cidr
  db_subnet_cidr         = var.db_subnet_cidr
  gateway_subnet_cidr    = var.gateway_subnet_cidr
  bastion_subnet_cidr    = var.bastion_subnet_cidr
}

# Primary Resource Group
resource "azurerm_resource_group" "primary" {
  name     = "${local.resource_prefix}-rg-primary"
  location = local.primary_region
  tags     = local.common_tags
}

# Secondary Resource Group (for DR)
resource "azurerm_resource_group" "secondary" {
  name     = "${local.resource_prefix}-rg-secondary"
  location = local.secondary_region
  tags     = merge(local.common_tags, { Purpose = "disaster-recovery" })
}

# Shared Resource Group (for cross-region resources)
resource "azurerm_resource_group" "shared" {
  name     = "${local.resource_prefix}-rg-shared"
  location = local.primary_region
  tags     = merge(local.common_tags, { Purpose = "shared-resources" })
}

# Random resources for unique naming
resource "random_id" "key_vault" {
  byte_length = 4
  keepers = {
    environment = var.environment
  }
}

resource "random_password" "db_admin" {
  length  = 20
  special = true
  keepers = {
    environment = var.environment
  }
}

# Module calls
module "networking" {
  source = "./modules/networking"
  
  resource_group_name     = azurerm_resource_group.primary.name
  location               = azurerm_resource_group.primary.location
  resource_prefix        = local.resource_prefix
  vnet_address_space     = local.vnet_address_space
  aks_subnet_cidr        = local.aks_subnet_cidr
  db_subnet_cidr         = local.db_subnet_cidr
  gateway_subnet_cidr    = local.gateway_subnet_cidr
  bastion_subnet_cidr    = local.bastion_subnet_cidr
  environment           = var.environment
  tags                  = local.common_tags
}

module "security" {
  source = "./modules/security"
  
  resource_group_name    = azurerm_resource_group.shared.name
  location              = azurerm_resource_group.shared.location
  resource_prefix       = local.resource_prefix
  key_vault_suffix      = random_id.key_vault.hex
  tenant_id             = data.azurerm_client_config.current.tenant_id
  object_id             = data.azurerm_client_config.current.object_id
  environment           = var.environment
  tags                  = local.common_tags
}

module "storage" {
  source = "./modules/storage"
  
  primary_rg_name       = azurerm_resource_group.primary.name
  secondary_rg_name     = azurerm_resource_group.secondary.name
  primary_location      = azurerm_resource_group.primary.location
  secondary_location    = azurerm_resource_group.secondary.location
  resource_prefix       = local.resource_prefix
  db_subnet_id          = module.networking.db_subnet_id
  db_admin_password     = random_password.db_admin.result
  key_vault_id          = module.security.key_vault_id
  environment           = var.environment
  tags                  = local.common_tags
}

module "aks" {
  source = "./modules/aks"
  
  resource_group_name   = azurerm_resource_group.primary.name
  location              = azurerm_resource_group.primary.location
  resource_prefix       = local.resource_prefix
  aks_subnet_id         = module.networking.aks_subnet_id
  key_vault_id          = module.security.key_vault_id
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  environment           = var.environment
  tags                  = local.common_tags
  
  # Auto-scaling configuration
  node_count_min        = var.aks_node_count_min
  node_count_max        = var.aks_node_count_max
  node_count_default    = var.aks_node_count_default
  node_vm_size          = var.aks_node_vm_size
}

module "monitoring" {
  source = "./modules/monitoring"
  
  resource_group_name   = azurerm_resource_group.shared.name
  location              = azurerm_resource_group.shared.location
  resource_prefix       = local.resource_prefix
  aks_cluster_id        = module.aks.cluster_id
  postgres_server_id    = module.storage.postgres_server_id
  redis_cache_id        = module.storage.redis_cache_id
  key_vault_id          = module.security.key_vault_id
  environment           = var.environment
  tags                  = local.common_tags
}