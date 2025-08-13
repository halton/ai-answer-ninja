# Storage Module - Databases and Storage Resources with HA and DR

# PostgreSQL Server with High Availability
resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "${var.resource_prefix}-psql"
  resource_group_name    = var.primary_rg_name
  location              = var.primary_location
  version               = "14"
  delegated_subnet_id   = var.db_subnet_id
  private_dns_zone_id   = azurerm_private_dns_zone.postgres.id
  
  administrator_login    = "psqladmin"
  administrator_password = var.db_admin_password
  
  zone                   = "1"
  
  storage_mb            = var.storage_mb
  sku_name              = var.sku_name
  
  backup_retention_days        = var.backup_retention_days
  geo_redundant_backup_enabled = var.enable_geo_redundant_backup
  
  high_availability {
    mode                      = "ZoneRedundant"
    standby_availability_zone = "2"
  }
  
  maintenance_window {
    day_of_week  = 0
    start_hour   = 8
    start_minute = 0
  }
  
  tags = var.tags

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

# Private DNS Zone for PostgreSQL
resource "azurerm_private_dns_zone" "postgres" {
  name                = "${var.resource_prefix}-postgres.private.postgres.database.azure.com"
  resource_group_name = var.primary_rg_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "${var.resource_prefix}-postgres-link"
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = var.vnet_id
  resource_group_name   = var.primary_rg_name
  tags                  = var.tags
}

# PostgreSQL Database
resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "ai_answer_ninja"
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

# PostgreSQL read replica for analytics workloads
resource "azurerm_postgresql_flexible_server" "read_replica" {
  count = var.enable_read_replica ? 1 : 0
  
  name                = "${var.resource_prefix}-psql-read"
  resource_group_name = var.primary_rg_name
  location           = var.primary_location
  version            = "14"
  delegated_subnet_id = var.db_subnet_id
  private_dns_zone_id = azurerm_private_dns_zone.postgres.id
  
  create_mode        = "Replica"
  source_server_id   = azurerm_postgresql_flexible_server.main.id
  
  zone = "3"
  
  tags = var.tags
}

# Redis Cache for session management and caching
resource "azurerm_redis_cache" "main" {
  name                = "${var.resource_prefix}-redis"
  location            = var.primary_location
  resource_group_name = var.primary_rg_name
  capacity            = var.redis_capacity
  family              = var.redis_family
  sku_name            = var.redis_sku_name
  enable_non_ssl_port = false
  minimum_tls_version = "1.2"
  
  # High availability configuration
  replica_count       = var.redis_sku_name == "Premium" ? 1 : 0
  zones              = var.redis_sku_name == "Premium" ? ["1", "2"] : null
  
  # Network security
  subnet_id          = var.redis_subnet_id
  private_static_ip_address = var.redis_private_ip
  
  # Redis configuration
  redis_configuration {
    enable_authentication           = true
    maxmemory_reserved             = var.redis_sku_name == "Premium" ? 125 : 0
    maxmemory_delta               = var.redis_sku_name == "Premium" ? 125 : 0
    maxmemory_policy              = "allkeys-lru"
    notify_keyspace_events        = "Ex"
    rdb_backup_enabled            = var.redis_sku_name == "Premium" ? true : false
    rdb_backup_frequency          = var.redis_sku_name == "Premium" ? 60 : null
    rdb_backup_max_snapshot_count = var.redis_sku_name == "Premium" ? 1 : null
    rdb_storage_connection_string = var.redis_sku_name == "Premium" ? azurerm_storage_account.main.primary_blob_connection_string : null
  }
  
  # Patch schedule for maintenance
  patch_schedule {
    day_of_week    = "Sunday"
    start_hour_utc = 2
  }
  
  tags = var.tags
}

# Storage Account for file storage, backups, and logs
resource "azurerm_storage_account" "main" {
  name                     = "${replace(var.resource_prefix, "-", "")}storage"
  resource_group_name      = var.primary_rg_name
  location                = var.primary_location
  account_tier            = var.enable_premium_storage ? "Premium" : "Standard"
  account_replication_type = var.enable_geo_redundant_storage ? "GRS" : "LRS"
  account_kind            = "StorageV2"
  
  # Security settings
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  
  # Network access rules
  network_rules {
    default_action             = "Deny"
    ip_rules                   = var.storage_allowed_ips
    virtual_network_subnet_ids = [var.aks_subnet_id, var.db_subnet_id]
    bypass                     = ["AzureServices"]
  }
  
  # Blob properties for lifecycle management
  blob_properties {
    versioning_enabled  = true
    change_feed_enabled = true
    
    delete_retention_policy {
      days = 30
    }
    
    container_delete_retention_policy {
      days = 30
    }
  }
  
  tags = var.tags
}

# Storage containers for different data types
resource "azurerm_storage_container" "voice_recordings" {
  name                  = "voice-recordings"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "app_logs" {
  name                  = "application-logs"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "backups" {
  name                  = "database-backups"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "ai_models" {
  name                  = "ai-models"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# Storage lifecycle management policy
resource "azurerm_storage_management_policy" "main" {
  storage_account_id = azurerm_storage_account.main.id
  
  rule {
    name    = "voice_recordings_lifecycle"
    enabled = true
    
    filters {
      prefix_match = ["voice-recordings/"]
      blob_types   = ["blockBlob"]
    }
    
    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than    = 30
        tier_to_archive_after_days_since_modification_greater_than = 90
        delete_after_days_since_modification_greater_than          = 365
      }
      
      snapshot {
        delete_after_days_since_creation_greater_than = 30
      }
    }
  }
  
  rule {
    name    = "logs_lifecycle"
    enabled = true
    
    filters {
      prefix_match = ["application-logs/"]
      blob_types   = ["blockBlob"]
    }
    
    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than = 7
        tier_to_archive_after_days_since_modification_greater_than = 30
        delete_after_days_since_modification_greater_than = 90
      }
    }
  }
}

# Geo-redundant storage account for disaster recovery
resource "azurerm_storage_account" "dr" {
  count = var.enable_cross_region_replication ? 1 : 0
  
  name                     = "${replace(var.resource_prefix, "-", "")}storagedr"
  resource_group_name      = var.secondary_rg_name
  location                = var.secondary_location
  account_tier            = "Standard"
  account_replication_type = "LRS"
  account_kind            = "StorageV2"
  
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  
  tags = var.tags
}

# Cosmos DB for NoSQL document storage (optional, for analytics)
resource "azurerm_cosmosdb_account" "main" {
  count = var.enable_cosmos_db ? 1 : 0
  
  name                = "${var.resource_prefix}-cosmos"
  location            = var.primary_location
  resource_group_name = var.primary_rg_name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"
  
  enable_automatic_failover = true
  enable_multiple_write_locations = false
  
  consistency_policy {
    consistency_level       = "BoundedStaleness"
    max_interval_in_seconds = 86400
    max_staleness_prefix    = 1000000
  }
  
  geo_location {
    location          = var.primary_location
    failover_priority = 0
  }
  
  geo_location {
    location          = var.secondary_location
    failover_priority = 1
  }
  
  tags = var.tags
}

# Key Vault secrets for database connection strings
resource "azurerm_key_vault_secret" "postgres_connection_string" {
  name         = "postgres-connection-string"
  value        = "postgresql://${azurerm_postgresql_flexible_server.main.administrator_login}:${var.db_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${azurerm_postgresql_flexible_server_database.main.name}?sslmode=require"
  key_vault_id = var.key_vault_id
  
  tags = var.tags
}

resource "azurerm_key_vault_secret" "redis_connection_string" {
  name         = "redis-connection-string"
  value        = azurerm_redis_cache.main.primary_connection_string
  key_vault_id = var.key_vault_id
  
  tags = var.tags
}

resource "azurerm_key_vault_secret" "storage_connection_string" {
  name         = "storage-connection-string"
  value        = azurerm_storage_account.main.primary_connection_string
  key_vault_id = var.key_vault_id
  
  tags = var.tags
}

# Database monitoring and alerting
resource "azurerm_monitor_metric_alert" "postgres_cpu" {
  name                = "${var.resource_prefix}-postgres-cpu-alert"
  resource_group_name = var.primary_rg_name
  scopes              = [azurerm_postgresql_flexible_server.main.id]
  description         = "Action will be triggered when PostgreSQL CPU usage is greater than 80%."
  
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  
  action {
    action_group_id = var.action_group_id
  }
  
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "redis_memory" {
  name                = "${var.resource_prefix}-redis-memory-alert"
  resource_group_name = var.primary_rg_name
  scopes              = [azurerm_redis_cache.main.id]
  description         = "Action will be triggered when Redis memory usage is greater than 90%."
  
  criteria {
    metric_namespace = "Microsoft.Cache/redis"
    metric_name      = "usedmemorypercentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 90
  }
  
  action {
    action_group_id = var.action_group_id
  }
  
  tags = var.tags
}