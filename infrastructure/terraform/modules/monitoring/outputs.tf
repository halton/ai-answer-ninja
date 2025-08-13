# Monitoring Module Outputs

# Log Analytics Workspace Outputs
output "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID"
  value       = azurerm_log_analytics_workspace.main.id
}

output "log_analytics_workspace_name" {
  description = "Log Analytics workspace name"
  value       = azurerm_log_analytics_workspace.main.name
}

output "log_analytics_workspace_key" {
  description = "Log Analytics workspace primary key"
  value       = azurerm_log_analytics_workspace.main.primary_shared_key
  sensitive   = true
}

output "log_analytics_customer_id" {
  description = "Log Analytics workspace customer ID"
  value       = azurerm_log_analytics_workspace.main.workspace_id
}

# Application Insights Outputs
output "application_insights_id" {
  description = "Application Insights ID"
  value       = azurerm_application_insights.main.id
}

output "application_insights_name" {
  description = "Application Insights name"
  value       = azurerm_application_insights.main.name
}

output "application_insights_instrumentation_key" {
  description = "Application Insights instrumentation key"
  value       = azurerm_application_insights.main.instrumentation_key
  sensitive   = true
}

output "application_insights_connection_string" {
  description = "Application Insights connection string"
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "application_insights_app_id" {
  description = "Application Insights application ID"
  value       = azurerm_application_insights.main.app_id
}

# Action Group Outputs
output "action_group_id" {
  description = "Main action group ID"
  value       = azurerm_monitor_action_group.main.id
}

output "critical_action_group_id" {
  description = "Critical action group ID"
  value       = azurerm_monitor_action_group.critical.id
}

# Alert Rule Outputs
output "aks_cpu_alert_id" {
  description = "AKS CPU alert rule ID"
  value       = azurerm_monitor_metric_alert.aks_cpu_usage.id
}

output "aks_memory_alert_id" {
  description = "AKS memory alert rule ID"
  value       = azurerm_monitor_metric_alert.aks_memory_usage.id
}

output "app_response_time_alert_id" {
  description = "Application response time alert rule ID"
  value       = azurerm_monitor_metric_alert.app_response_time.id
}

output "app_failure_rate_alert_id" {
  description = "Application failure rate alert rule ID"
  value       = azurerm_monitor_metric_alert.app_failure_rate.id
}

# Database Alert Outputs
output "postgres_connections_alert_id" {
  description = "PostgreSQL connections alert rule ID"
  value       = var.postgres_server_id != "" ? azurerm_monitor_metric_alert.postgres_connections[0].id : ""
}

output "postgres_storage_alert_id" {
  description = "PostgreSQL storage alert rule ID"
  value       = var.postgres_server_id != "" ? azurerm_monitor_metric_alert.postgres_storage[0].id : ""
}

# Redis Alert Outputs
output "redis_cpu_alert_id" {
  description = "Redis CPU alert rule ID"
  value       = var.redis_cache_id != "" ? azurerm_monitor_metric_alert.redis_cpu[0].id : ""
}

# Cost Management Outputs
output "budget_id" {
  description = "Subscription budget ID"
  value       = var.enable_cost_alerts ? azurerm_consumption_budget_subscription.main[0].id : ""
}

# Workbook Outputs
output "workbook_id" {
  description = "Application Insights workbook ID"
  value       = azurerm_application_insights_workbook.main.id
}

# Saved Search Outputs
output "error_search_id" {
  description = "Error search query ID"
  value       = azurerm_log_analytics_saved_search.errors.id
}

output "performance_search_id" {
  description = "Performance search query ID"
  value       = azurerm_log_analytics_saved_search.performance.id
}

# Alert Processing Rule Outputs
output "maintenance_suppression_rule_id" {
  description = "Maintenance window suppression rule ID"
  value       = var.enable_maintenance_suppression ? azurerm_monitor_alert_processing_rule_suppression.maintenance_window[0].id : ""
}