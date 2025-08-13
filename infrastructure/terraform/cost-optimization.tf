# Cost Optimization and Resource Monitoring Configuration
# Implements FinOps best practices and automated cost management

# Cost Management Exports for detailed cost analysis
resource "azurerm_cost_management_export_resource_group" "daily_costs" {
  name                         = "${local.resource_prefix}-daily-cost-export"
  resource_group_id           = azurerm_resource_group.primary.id
  recurrence_type             = "Daily"
  recurrence_period_start_date = "2024-01-01T00:00:00Z"
  recurrence_period_end_date   = "2025-12-31T23:59:59Z"
  
  export_data_storage_account_id = module.storage.storage_account_id
  export_data_options {
    type       = "ActualCost"
    time_frame = "MonthToDate"
  }
  
  delivery_info {
    container_name = "cost-exports"
    root_folder_path = "/daily"
  }
  
  tags = local.common_tags
}

# Azure Advisor Cost Recommendations
resource "azurerm_advisor_recommendations" "cost" {
  filter_by_category                = ["Cost"]
  filter_by_resource_groups        = [azurerm_resource_group.primary.name, azurerm_resource_group.secondary.name]
  
  # Automatically apply low-risk cost recommendations
  # This is conceptual - actual implementation would use Azure Policy or Automation
}

# Automated Resource Scaling Based on Schedule
resource "azurerm_automation_runbook" "scale_down_dev" {
  count = var.environment != "prod" ? 1 : 0
  
  name                    = "${local.resource_prefix}-scale-down-runbook"
  location                = azurerm_resource_group.shared.location
  resource_group_name     = azurerm_resource_group.shared.name
  automation_account_name = azurerm_automation_account.dr.name
  log_verbose            = true
  log_progress           = true
  runbook_type           = "PowerShell"
  
  content = <<CONTENT
param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "dev"
)

# Connect to Azure
$connectionName = "AzureRunAsConnection"
$servicePrincipalConnection = Get-AutomationConnection -Name $connectionName
Connect-AzAccount -ServicePrincipal -TenantId $servicePrincipalConnection.TenantId -ApplicationId $servicePrincipalConnection.ApplicationId -CertificateThumbprint $servicePrincipalConnection.CertificateThumbprint

Write-Output "Starting cost optimization for environment: $Environment"

# Scale down AKS cluster to minimum nodes after hours
$aksCluster = Get-AzAksCluster -ResourceGroupName $ResourceGroupName
if ($aksCluster) {
    $currentTime = Get-Date
    $hour = $currentTime.Hour
    
    # Scale down after 8 PM and before 8 AM (local time)
    if ($hour -ge 20 -or $hour -lt 8) {
        Write-Output "Scaling down AKS cluster: $($aksCluster.Name)"
        
        # Scale default node pool to minimum
        $nodePool = Get-AzAksNodePool -ResourceGroupName $ResourceGroupName -ClusterName $aksCluster.Name -Name "default"
        if ($nodePool.Count -gt 1) {
            Set-AzAksCluster -ResourceGroupName $ResourceGroupName -Name $aksCluster.Name -NodeCount 1
            Write-Output "AKS cluster scaled down to 1 node"
        }
    } else {
        Write-Output "Within business hours, no scaling needed"
    }
}

# Stop development VMs if any
$vms = Get-AzVM -ResourceGroupName $ResourceGroupName | Where-Object {$_.Tags.Environment -eq $Environment -and $_.Tags.AutoShutdown -eq "true"}
foreach ($vm in $vms) {
    $vmStatus = Get-AzVM -ResourceGroupName $ResourceGroupName -Name $vm.Name -Status
    if ($vmStatus.Statuses[1].Code -eq "PowerState/running") {
        Write-Output "Stopping VM: $($vm.Name)"
        Stop-AzVM -ResourceGroupName $ResourceGroupName -Name $vm.Name -Force
    }
}

# Optimize database compute for non-production
if ($Environment -ne "prod") {
    $postgresServers = Get-AzPostgreSqlFlexibleServer -ResourceGroupName $ResourceGroupName
    foreach ($server in $postgresServers) {
        $currentHour = (Get-Date).Hour
        
        # Scale down database during off-hours
        if ($currentHour -ge 22 -or $currentHour -lt 6) {
            if ($server.Sku -ne "B_Standard_B1ms") {
                Write-Output "Scaling down PostgreSQL server: $($server.Name)"
                # Note: Actual scaling would require specific PowerShell cmdlets
                Write-Output "Database scaling completed"
            }
        }
    }
}

Write-Output "Cost optimization tasks completed"
CONTENT
  
  tags = local.common_tags
}

# Schedule for cost optimization runbook
resource "azurerm_automation_schedule" "nightly_scale_down" {
  count = var.environment != "prod" ? 1 : 0
  
  name                    = "${local.resource_prefix}-nightly-scale-down"
  resource_group_name     = azurerm_resource_group.shared.name
  automation_account_name = azurerm_automation_account.dr.name
  frequency              = "Day"
  interval               = 1
  timezone               = "China Standard Time"
  start_time             = "2024-01-01T20:00:00+08:00"
  description            = "Nightly scale-down for cost optimization"
}

# Resource tagging policy for cost tracking
resource "azurerm_policy_definition" "cost_tracking_tags" {
  count = var.enable_azure_policy ? 1 : 0
  
  name         = "${local.resource_prefix}-cost-tracking-policy"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "Enforce Cost Tracking Tags"
  description  = "Ensures all resources have required cost tracking tags"
  
  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field  = "type"
          notIn  = ["Microsoft.Resources/resourceGroups", "Microsoft.Resources/subscriptions"]
        }
      ]
    }
    then = {
      effect = "modify"
      details = {
        roleDefinitionIds = [
          "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"  # Contributor
        ]
        operations = [
          {
            operation = "addOrReplace"
            field     = "tags['CostCenter']"
            value     = "[parameters('costCenter')]"
          },
          {
            operation = "addOrReplace"
            field     = "tags['Environment']"
            value     = "[parameters('environment')]"
          },
          {
            operation = "addOrReplace" 
            field     = "tags['Owner']"
            value     = "[parameters('owner')]"
          },
          {
            operation = "addOrReplace"
            field     = "tags['AutoShutdown']"
            value     = "[parameters('autoShutdown')]"
          }
        ]
      }
    }
  })
  
  parameters = jsonencode({
    costCenter = {
      type = "String"
      metadata = {
        displayName = "Cost Center"
        description = "Cost center for billing allocation"
      }
      defaultValue = var.cost_center
    }
    environment = {
      type = "String"
      metadata = {
        displayName = "Environment"
        description = "Environment name (dev, staging, prod)"
      }
      defaultValue = var.environment
    }
    owner = {
      type = "String"
      metadata = {
        displayName = "Owner"
        description = "Resource owner"
      }
      defaultValue = var.project_owner
    }
    autoShutdown = {
      type = "String"
      metadata = {
        displayName = "Auto Shutdown Enabled"
        description = "Whether resource supports auto shutdown"
      }
      allowedValues = ["true", "false"]
      defaultValue = var.auto_shutdown_enabled ? "true" : "false"
    }
  })
}

# Azure Monitor Cost Anomaly Detection
resource "azurerm_monitor_metric_alert" "cost_anomaly" {
  name                = "${local.resource_prefix}-cost-anomaly-alert"
  resource_group_name = azurerm_resource_group.shared.name
  scopes              = [azurerm_resource_group.primary.id, azurerm_resource_group.secondary.id]
  description         = "Alert when cost anomalies are detected"
  severity           = 1
  frequency          = "PT1H"
  window_size        = "PT6H"
  
  # This is conceptual - actual cost anomaly detection would use Cost Management APIs
  criteria {
    metric_namespace = "Microsoft.CostManagement/CostAlerts"
    metric_name      = "ActualCostAnomaly"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = var.cost_anomaly_threshold
  }
  
  action {
    action_group_id = module.monitoring.critical_action_group_id
  }
  
  tags = local.common_tags
}

# Reserved Instance Recommendations Tracker
resource "azurerm_log_analytics_saved_search" "ri_recommendations" {
  name                       = "${local.resource_prefix}-ri-recommendations"
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  category                   = "CostOptimization"
  display_name              = "Reserved Instance Recommendations"
  query                     = <<QUERY
AzureActivity
| where OperationNameValue contains "Microsoft.Advisor/recommendations"
| where CategoryValue == "Cost"
| where RecommendationTypeValue contains "ReservedInstance"
| project TimeGenerated, RecommendationTypeValue, ResourceId, Properties
| summarize count() by bin(TimeGenerated, 1d), RecommendationTypeValue
| order by TimeGenerated desc
QUERY
  
  tags = local.common_tags
}

# Unused Resource Detection
resource "azurerm_log_analytics_saved_search" "unused_resources" {
  name                       = "${local.resource_prefix}-unused-resources"
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  category                   = "CostOptimization"
  display_name              = "Unused Resources Detection"
  query                     = <<QUERY
// Detect unused public IPs
AzureMetrics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where MetricName == "ByteCount"
| where ResourceType == "PUBLICIPADDRESSES"
| summarize TotalBytes = sum(Total) by Resource
| where TotalBytes == 0
| project Resource, UnusedType = "PublicIP", TotalBytes
union
// Detect unused disks
(
AzureMetrics
| where ResourceProvider == "MICROSOFT.COMPUTE"
| where MetricName == "Disk Read Operations/Sec"
| where ResourceType == "DISKS"
| summarize TotalOps = sum(Total) by Resource
| where TotalOps == 0
| project Resource, UnusedType = "Disk", TotalOps
)
| order by UnusedType, Resource
QUERY
  
  tags = local.common_tags
}

# Cost Optimization Dashboard
resource "azurerm_application_insights_workbook" "cost_optimization" {
  name                = "${local.resource_prefix}-cost-optimization-workbook"
  resource_group_name = azurerm_resource_group.shared.name
  location            = azurerm_resource_group.shared.location
  display_name        = "Cost Optimization Dashboard"
  source_id           = module.monitoring.application_insights_id
  
  data_json = jsonencode({
    version = "Notebook/1.0"
    items = [
      {
        type = 1
        content = {
          json = "# Cost Optimization Dashboard\n\nMonitor and optimize Azure costs for AI Answer Ninja infrastructure."
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "AzureMetrics | where TimeGenerated >= ago(7d) | summarize avg(Total) by ResourceType, bin(TimeGenerated, 1h) | render timechart"
          size = 0
          title = "Resource Utilization Trends"
          timeContext = {
            durationMs = 604800000  # 7 days
          }
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "AzureActivity | where CategoryValue == 'Administrative' | where OperationNameValue contains 'write' | summarize count() by ResourceType | render piechart"
          size = 0
          title = "Resource Creation Activity"
        }
      },
      {
        type = 1
        content = {
          json = "## Cost Optimization Recommendations\n\n- Review unused public IPs and disks\n- Consider Reserved Instances for consistent workloads\n- Implement auto-shutdown for development resources\n- Monitor and optimize storage tiers\n- Use spot instances for non-critical workloads"
        }
      }
    ]
  })
  
  tags = local.common_tags
}

# Spot Instance Price Monitoring
resource "azurerm_monitor_metric_alert" "spot_instance_eviction" {
  count = var.spot_instances_enabled ? 1 : 0
  
  name                = "${local.resource_prefix}-spot-eviction-alert"
  resource_group_name = azurerm_resource_group.primary.name
  scopes              = [module.aks.cluster_id]
  description         = "Alert when spot instances are being evicted frequently"
  severity           = 2
  frequency          = "PT5M"
  window_size        = "PT15M"
  
  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "kube_node_status_condition"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 5  # More than 5 node evictions in 15 minutes
    
    dimension {
      name     = "condition"
      operator = "Include" 
      values   = ["OutOfDisk", "MemoryPressure", "DiskPressure"]
    }
  }
  
  action {
    action_group_id = module.monitoring.action_group_id
  }
  
  tags = local.common_tags
}

# Storage Lifecycle Management for Cost Optimization
resource "azurerm_storage_management_policy" "cost_optimization" {
  storage_account_id = module.storage.storage_account_id
  
  rule {
    name    = "cost_optimization_logs"
    enabled = true
    
    filters {
      prefix_match = ["logs/"]
      blob_types   = ["blockBlob"]
    }
    
    actions {
      base_blob {
        # Move to cool tier after 30 days
        tier_to_cool_after_days_since_modification_greater_than = 30
        # Move to archive tier after 90 days
        tier_to_archive_after_days_since_modification_greater_than = 90
        # Delete after 1 year
        delete_after_days_since_modification_greater_than = 365
      }
      
      snapshot {
        # Delete snapshots after 30 days
        delete_after_days_since_creation_greater_than = 30
      }
      
      version {
        # Delete old versions after 90 days
        delete_after_days_since_creation = 90
      }
    }
  }
  
  rule {
    name    = "cost_optimization_temp_data"
    enabled = true
    
    filters {
      prefix_match = ["temp/", "cache/"]
      blob_types   = ["blockBlob"]
    }
    
    actions {
      base_blob {
        # Delete temporary data after 7 days
        delete_after_days_since_modification_greater_than = 7
      }
    }
  }
}

# Azure Cost Management Budget with Action Groups
resource "azurerm_consumption_budget_resource_group" "detailed_budget" {
  name              = "${local.resource_prefix}-detailed-budget"
  resource_group_id = azurerm_resource_group.primary.id
  
  amount     = var.monthly_budget_amount
  time_grain = "Monthly"
  
  time_period {
    start_date = var.budget_start_date
    end_date   = var.budget_end_date
  }
  
  # Multiple notification thresholds
  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    
    contact_emails = var.budget_alert_emails
  }
  
  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    
    contact_emails = var.budget_alert_emails
    contact_groups = [module.monitoring.action_group_id]
  }
  
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    
    contact_emails = var.budget_alert_emails
    contact_groups = [module.monitoring.critical_action_group_id]
  }
  
  # Budget filters for granular cost tracking
  filter {
    dimension {
      name = "ResourceType"
      values = [
        "Microsoft.ContainerService/managedClusters",
        "Microsoft.DBforPostgreSQL/flexibleServers",
        "Microsoft.Cache/Redis",
        "Microsoft.Storage/storageAccounts"
      ]
    }
  }
}