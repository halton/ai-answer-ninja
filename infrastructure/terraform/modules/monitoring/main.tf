# Monitoring Module - Comprehensive monitoring, alerting, and observability

# Log Analytics Workspace for centralized logging
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.resource_prefix}-logs"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  daily_quota_gb      = var.daily_quota_gb
  
  tags = var.tags
}

# Application Insights for application performance monitoring
resource "azurerm_application_insights" "main" {
  name                = "${var.resource_prefix}-appinsights"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  
  # Sampling configuration for cost optimization
  sampling_percentage = var.sampling_percentage
  
  tags = var.tags
}

# Action Group for alert notifications
resource "azurerm_monitor_action_group" "main" {
  name                = "${var.resource_prefix}-alerts"
  resource_group_name = var.resource_group_name
  short_name          = "aianswerng"
  
  # Email notifications
  dynamic "email_receiver" {
    for_each = var.alert_emails
    content {
      name          = "email-${email_receiver.key}"
      email_address = email_receiver.value
    }
  }
  
  # SMS notifications for critical alerts
  dynamic "sms_receiver" {
    for_each = var.alert_phone_numbers
    content {
      name         = "sms-${sms_receiver.key}"
      country_code = sms_receiver.value.country_code
      phone_number = sms_receiver.value.phone_number
    }
  }
  
  # Webhook for integration with external systems
  dynamic "webhook_receiver" {
    for_each = var.webhook_urls
    content {
      name        = "webhook-${webhook_receiver.key}"
      service_uri = webhook_receiver.value
    }
  }
  
  # Azure Function integration
  dynamic "azure_function_receiver" {
    for_each = var.azure_function_receivers
    content {
      name                     = azure_function_receiver.value.name
      function_app_resource_id = azure_function_receiver.value.function_app_resource_id
      function_name           = azure_function_receiver.value.function_name
      http_trigger_url        = azure_function_receiver.value.http_trigger_url
    }
  }
  
  tags = var.tags
}

# Action Group for critical alerts (24/7 response)
resource "azurerm_monitor_action_group" "critical" {
  name                = "${var.resource_prefix}-critical-alerts"
  resource_group_name = var.resource_group_name
  short_name          = "aicritical"
  
  # Critical email notifications
  dynamic "email_receiver" {
    for_each = var.critical_alert_emails
    content {
      name          = "critical-email-${email_receiver.key}"
      email_address = email_receiver.value
    }
  }
  
  # Critical SMS notifications
  dynamic "sms_receiver" {
    for_each = var.critical_alert_phone_numbers
    content {
      name         = "critical-sms-${sms_receiver.key}"
      country_code = sms_receiver.value.country_code
      phone_number = sms_receiver.value.phone_number
    }
  }
  
  tags = var.tags
}

# AKS Cluster Monitoring Alerts
resource "azurerm_monitor_metric_alert" "aks_cpu_usage" {
  name                = "${var.resource_prefix}-aks-cpu-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_cluster_id]
  description         = "AKS cluster CPU usage is above 80%"
  severity           = 2
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_cpu_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
  
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "aks_memory_usage" {
  name                = "${var.resource_prefix}-aks-memory-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_cluster_id]
  description         = "AKS cluster memory usage is above 85%"
  severity           = 2
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_memory_working_set_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
  
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "aks_pod_restart" {
  name                = "${var.resource_prefix}-aks-pod-restarts"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_cluster_id]
  description         = "High number of pod restarts detected"
  severity           = 1
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "kube_pod_status_ready"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 0.9
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.critical.id
  }
  
  tags = var.tags
}

# Database Monitoring Alerts
resource "azurerm_monitor_metric_alert" "postgres_connections" {
  count = var.postgres_server_id != "" ? 1 : 0
  
  name                = "${var.resource_prefix}-postgres-connections-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL connection count is above 80% of limit"
  severity           = 2
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "active_connections"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
  
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "postgres_storage" {
  count = var.postgres_server_id != "" ? 1 : 0
  
  name                = "${var.resource_prefix}-postgres-storage-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL storage usage is above 90%"
  severity           = 1
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "storage_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 90
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.critical.id
  }
  
  tags = var.tags
}

# Redis Cache Monitoring
resource "azurerm_monitor_metric_alert" "redis_cpu" {
  count = var.redis_cache_id != "" ? 1 : 0
  
  name                = "${var.resource_prefix}-redis-cpu-high"
  resource_group_name = var.resource_group_name
  scopes              = [var.redis_cache_id]
  description         = "Redis CPU usage is above 80%"
  severity           = 2
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.Cache/redis"
    metric_name      = "percentProcessorTime"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
  
  tags = var.tags
}

# Application Performance Monitoring
resource "azurerm_monitor_metric_alert" "app_response_time" {
  name                = "${var.resource_prefix}-app-response-time-high"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_application_insights.main.id]
  description         = "Application response time is above 2 seconds"
  severity           = 2
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.Insights/components"
    metric_name      = "requests/duration"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 2000  # 2 seconds in milliseconds
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }
  
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "app_failure_rate" {
  name                = "${var.resource_prefix}-app-failure-rate-high"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_application_insights.main.id]
  description         = "Application failure rate is above 5%"
  severity           = 1
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.Insights/components"
    metric_name      = "requests/failed"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 5
  }
  
  action {
    action_group_id = azurerm_monitor_action_group.critical.id
  }
  
  tags = var.tags
}

# Cost Management Alerts
resource "azurerm_consumption_budget_subscription" "main" {
  count = var.enable_cost_alerts ? 1 : 0
  
  name            = "${var.resource_prefix}-budget"
  subscription_id = var.subscription_id
  
  amount     = var.monthly_budget_amount
  time_grain = "Monthly"
  
  time_period {
    start_date = var.budget_start_date
    end_date   = var.budget_end_date
  }
  
  filter {
    dimension {
      name = "ResourceGroupName"
      values = [
        var.resource_group_name
      ]
    }
  }
  
  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    
    contact_emails = var.budget_alert_emails
  }
  
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    
    contact_emails = var.budget_alert_emails
  }
}

# Custom Log Analytics Queries
resource "azurerm_log_analytics_saved_search" "errors" {
  name                       = "${var.resource_prefix}-error-search"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  category                   = "Application"
  display_name              = "Application Errors"
  query                     = <<QUERY
AppTraces
| where SeverityLevel >= 3
| summarize count() by bin(TimeGenerated, 1h), SeverityLevel
| order by TimeGenerated desc
QUERY
  
  tags = var.tags
}

resource "azurerm_log_analytics_saved_search" "performance" {
  name                       = "${var.resource_prefix}-performance-search"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  category                   = "Application"
  display_name              = "Performance Issues"
  query                     = <<QUERY
AppRequests
| where DurationMs > 2000
| summarize avg(DurationMs), count() by bin(TimeGenerated, 1h), OperationName
| order by TimeGenerated desc
QUERY
  
  tags = var.tags
}

# Diagnostic Settings for comprehensive logging
resource "azurerm_monitor_diagnostic_setting" "aks" {
  name               = "${var.resource_prefix}-aks-diagnostics"
  target_resource_id = var.aks_cluster_id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  
  # Enable all available log categories
  enabled_log {
    category = "kube-apiserver"
  }
  
  enabled_log {
    category = "kube-controller-manager"
  }
  
  enabled_log {
    category = "kube-scheduler"
  }
  
  enabled_log {
    category = "kube-audit"
  }
  
  enabled_log {
    category = "kube-audit-admin"
  }
  
  enabled_log {
    category = "guard"
  }
  
  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

# Workbook for custom dashboards
resource "azurerm_application_insights_workbook" "main" {
  name                = "${var.resource_prefix}-workbook"
  resource_group_name = var.resource_group_name
  location            = var.location
  display_name        = "AI Answer Ninja Dashboard"
  source_id           = azurerm_application_insights.main.id
  
  data_json = jsonencode({
    version = "Notebook/1.0"
    items = [
      {
        type = 1
        content = {
          json = "# AI Answer Ninja Monitoring Dashboard\n\nThis workbook provides comprehensive monitoring for the AI Answer Ninja application."
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "AppRequests | summarize count() by bin(timestamp, 1h) | render timechart"
          size = 0
          title = "Request Volume"
          timeContext = {
            durationMs = 86400000
          }
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "AppRequests | summarize avg(duration) by bin(timestamp, 1h) | render timechart"
          size = 0
          title = "Average Response Time"
          timeContext = {
            durationMs = 86400000
          }
        }
      }
    ]
  })
  
  tags = var.tags
}

# Alert Processing Rules for intelligent alert management
resource "azurerm_monitor_alert_processing_rule_suppression" "maintenance_window" {
  count = var.enable_maintenance_suppression ? 1 : 0
  
  name                = "${var.resource_prefix}-maintenance-suppression"
  resource_group_name = var.resource_group_name
  scopes             = [var.resource_group_id]
  
  # Suppress alerts during maintenance window
  schedule {
    effective_from  = var.maintenance_start_time
    effective_until = var.maintenance_end_time
    time_zone      = "UTC"
    
    recurrence {
      weekly {
        days_of_week = ["Sunday"]
      }
    }
  }
  
  description = "Suppress alerts during scheduled maintenance"
  enabled     = true
  
  tags = var.tags
}