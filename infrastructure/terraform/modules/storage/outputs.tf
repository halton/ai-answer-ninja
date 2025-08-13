# Storage Module Outputs

# PostgreSQL Outputs
output "postgres_server_id" {
  description = "PostgreSQL server ID"
  value       = azurerm_postgresql_flexible_server.main.id
}

output "postgres_server_fqdn" {
  description = "PostgreSQL server FQDN"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "postgres_database_name" {
  description = "PostgreSQL database name"
  value       = azurerm_postgresql_flexible_server_database.main.name
}

output "postgres_connection_string_secret_id" {
  description = "PostgreSQL connection string secret ID"
  value       = azurerm_key_vault_secret.postgres_connection_string.id
}

output "postgres_read_replica_fqdn" {
  description = "PostgreSQL read replica FQDN"
  value       = var.enable_read_replica ? azurerm_postgresql_flexible_server.read_replica[0].fqdn : ""
}

# Redis Outputs
output "redis_cache_id" {
  description = "Redis cache ID"
  value       = azurerm_redis_cache.main.id
}

output "redis_hostname" {
  description = "Redis hostname"
  value       = azurerm_redis_cache.main.hostname
}

output "redis_port" {
  description = "Redis port"
  value       = azurerm_redis_cache.main.port
}

output "redis_ssl_port" {
  description = "Redis SSL port"
  value       = azurerm_redis_cache.main.ssl_port
}

output "redis_primary_access_key" {
  description = "Redis primary access key"
  value       = azurerm_redis_cache.main.primary_access_key
  sensitive   = true
}

output "redis_connection_string_secret_id" {
  description = "Redis connection string secret ID"
  value       = azurerm_key_vault_secret.redis_connection_string.id
}

# Storage Account Outputs
output "storage_account_id" {
  description = "Storage account ID"
  value       = azurerm_storage_account.main.id
}

output "storage_account_name" {
  description = "Storage account name"
  value       = azurerm_storage_account.main.name
}

output "storage_account_primary_endpoint" {
  description = "Storage account primary blob endpoint"
  value       = azurerm_storage_account.main.primary_blob_endpoint
}

output "storage_connection_string_secret_id" {
  description = "Storage connection string secret ID"
  value       = azurerm_key_vault_secret.storage_connection_string.id
}

output "storage_containers" {
  description = "Storage container names"
  value = {
    voice_recordings = azurerm_storage_container.voice_recordings.name
    app_logs         = azurerm_storage_container.app_logs.name
    backups          = azurerm_storage_container.backups.name
    ai_models        = azurerm_storage_container.ai_models.name
  }
}

# DR Storage Account Outputs
output "dr_storage_account_id" {
  description = "DR storage account ID"
  value       = var.enable_cross_region_replication ? azurerm_storage_account.dr[0].id : ""
}

output "dr_storage_account_name" {
  description = "DR storage account name"
  value       = var.enable_cross_region_replication ? azurerm_storage_account.dr[0].name : ""
}

# Cosmos DB Outputs
output "cosmos_db_id" {
  description = "Cosmos DB account ID"
  value       = var.enable_cosmos_db ? azurerm_cosmosdb_account.main[0].id : ""
}

output "cosmos_db_endpoint" {
  description = "Cosmos DB endpoint"
  value       = var.enable_cosmos_db ? azurerm_cosmosdb_account.main[0].endpoint : ""
}

output "cosmos_db_primary_key" {
  description = "Cosmos DB primary key"
  value       = var.enable_cosmos_db ? azurerm_cosmosdb_account.main[0].primary_key : ""
  sensitive   = true
}

# Private DNS Zone Outputs
output "postgres_private_dns_zone_id" {
  description = "PostgreSQL private DNS zone ID"
  value       = azurerm_private_dns_zone.postgres.id
}