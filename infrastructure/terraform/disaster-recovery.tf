# Disaster Recovery Configuration - Multi-region deployment with automated failover

# Traffic Manager Profile for global load balancing and failover
resource "azurerm_traffic_manager_profile" "main" {
  name                   = "${local.resource_prefix}-tm"
  resource_group_name    = azurerm_resource_group.shared.name
  traffic_routing_method = "Priority"  # Primary-secondary failover
  
  dns_config {
    relative_name = "${local.resource_prefix}-global"
    ttl          = 30  # Low TTL for faster failover
  }
  
  monitor_config {
    protocol                     = "HTTPS"
    port                        = 443
    path                        = "/health"
    interval_in_seconds         = 30
    timeout_in_seconds          = 10
    tolerated_number_of_failures = 3
    
    # Custom headers for health check
    custom_header {
      name  = "X-Health-Check"
      value = "traffic-manager"
    }
  }
  
  tags = local.common_tags
}

# Primary region endpoint
resource "azurerm_traffic_manager_azure_endpoint" "primary" {
  name               = "${local.resource_prefix}-primary"
  profile_id         = azurerm_traffic_manager_profile.main.id
  priority           = 1
  weight             = 100
  target_resource_id = module.aks.application_gateway_public_ip_id
  
  custom_header {
    name  = "X-Region"
    value = local.primary_region
  }
}

# Secondary region infrastructure for DR
module "aks_secondary" {
  source = "./modules/aks"
  
  resource_group_name   = azurerm_resource_group.secondary.name
  location              = azurerm_resource_group.secondary.location
  resource_prefix       = "${local.resource_prefix}-dr"
  aks_subnet_id         = module.networking_secondary.aks_subnet_id
  key_vault_id          = module.security.key_vault_id
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  environment           = var.environment
  tags                  = merge(local.common_tags, { Purpose = "disaster-recovery" })
  
  # Smaller configuration for DR
  node_count_min        = 1
  node_count_max        = 10
  node_count_default    = 2
  node_vm_size          = "Standard_D2s_v3"  # Smaller instances for cost optimization
  
  depends_on = [
    module.networking_secondary,
    module.security
  ]
}

# Secondary region networking
module "networking_secondary" {
  source = "./modules/networking"
  
  resource_group_name     = azurerm_resource_group.secondary.name
  location               = azurerm_resource_group.secondary.location
  resource_prefix        = "${local.resource_prefix}-dr"
  vnet_address_space     = ["10.1.0.0/16"]  # Different address space
  aks_subnet_cidr        = "10.1.1.0/24"
  db_subnet_cidr         = "10.1.2.0/24"
  gateway_subnet_cidr    = "10.1.3.0/24"
  bastion_subnet_cidr    = "10.1.4.0/27"
  environment           = var.environment
  tags                  = merge(local.common_tags, { Purpose = "disaster-recovery" })
  
  # Simplified configuration for DR
  enable_bastion         = false
  enable_nat_gateway     = false
  enable_ddos_protection = false
}

# Secondary region endpoint (disabled by default)
resource "azurerm_traffic_manager_azure_endpoint" "secondary" {
  name               = "${local.resource_prefix}-secondary"
  profile_id         = azurerm_traffic_manager_profile.main.id
  priority           = 2
  weight             = 0  # No traffic by default
  target_resource_id = module.aks_secondary.application_gateway_public_ip_id
  enabled           = var.enable_secondary_region
  
  custom_header {
    name  = "X-Region"
    value = local.secondary_region
  }
}

# VNet Peering for cross-region connectivity
resource "azurerm_virtual_network_peering" "primary_to_secondary" {
  count = var.enable_cross_region_peering ? 1 : 0
  
  name                      = "${local.resource_prefix}-peer-to-secondary"
  resource_group_name       = azurerm_resource_group.primary.name
  virtual_network_name      = module.networking.vnet_name
  remote_virtual_network_id = module.networking_secondary.vnet_id
  
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  allow_gateway_transit        = false
  use_remote_gateways         = false
}

resource "azurerm_virtual_network_peering" "secondary_to_primary" {
  count = var.enable_cross_region_peering ? 1 : 0
  
  name                      = "${local.resource_prefix}-peer-to-primary"
  resource_group_name       = azurerm_resource_group.secondary.name
  virtual_network_name      = module.networking_secondary.vnet_name
  remote_virtual_network_id = module.networking.vnet_id
  
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  allow_gateway_transit        = false
  use_remote_gateways         = false
}

# Cross-region database replication
resource "azurerm_postgresql_flexible_server" "secondary" {
  count = var.enable_database_replication ? 1 : 0
  
  name                = "${local.resource_prefix}-psql-dr"
  resource_group_name = azurerm_resource_group.secondary.name
  location           = azurerm_resource_group.secondary.location
  version            = "14"
  delegated_subnet_id = module.networking_secondary.db_subnet_id
  private_dns_zone_id = azurerm_private_dns_zone.postgres_secondary[0].id
  
  create_mode       = "Replica"
  source_server_id  = module.storage.postgres_server_id
  
  zone = "1"
  
  tags = merge(local.common_tags, { Purpose = "disaster-recovery" })
  
  depends_on = [
    azurerm_private_dns_zone_virtual_network_link.postgres_secondary,
    module.storage
  ]
}

resource "azurerm_private_dns_zone" "postgres_secondary" {
  count = var.enable_database_replication ? 1 : 0
  
  name                = "${local.resource_prefix}-dr-postgres.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.secondary.name
  tags                = merge(local.common_tags, { Purpose = "disaster-recovery" })
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres_secondary" {
  count = var.enable_database_replication ? 1 : 0
  
  name                  = "${local.resource_prefix}-postgres-secondary-link"
  private_dns_zone_name = azurerm_private_dns_zone.postgres_secondary[0].name
  virtual_network_id    = module.networking_secondary.vnet_id
  resource_group_name   = azurerm_resource_group.secondary.name
  tags                  = merge(local.common_tags, { Purpose = "disaster-recovery" })
}

# Backup and Recovery Automation
resource "azurerm_automation_account" "dr" {
  name                = "${local.resource_prefix}-automation-dr"
  location            = azurerm_resource_group.shared.location
  resource_group_name = azurerm_resource_group.shared.name
  sku_name           = "Basic"
  
  identity {
    type = "SystemAssigned"
  }
  
  tags = local.common_tags
}

# Runbook for automated failover
resource "azurerm_automation_runbook" "failover" {
  name                    = "${local.resource_prefix}-failover-runbook"
  location                = azurerm_resource_group.shared.location
  resource_group_name     = azurerm_resource_group.shared.name
  automation_account_name = azurerm_automation_account.dr.name
  log_verbose            = true
  log_progress           = true
  runbook_type           = "PowerShell"
  
  content = <<CONTENT
param(
    [Parameter(Mandatory=$true)]
    [string]$TrafficManagerProfileName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$FailoverReason = "Manual failover"
)

# Connect to Azure
$connectionName = "AzureRunAsConnection"
$servicePrincipalConnection = Get-AutomationConnection -Name $connectionName
Connect-AzAccount -ServicePrincipal -TenantId $servicePrincipalConnection.TenantId -ApplicationId $servicePrincipalConnection.ApplicationId -CertificateThumbprint $servicePrincipalConnection.CertificateThumbprint

# Get Traffic Manager profile
$tmProfile = Get-AzTrafficManagerProfile -Name $TrafficManagerProfileName -ResourceGroupName $ResourceGroupName

# Get endpoints
$primaryEndpoint = $tmProfile.Endpoints | Where-Object {$_.Name -like "*primary*"}
$secondaryEndpoint = $tmProfile.Endpoints | Where-Object {$_.Name -like "*secondary*"}

# Perform failover
if ($primaryEndpoint.EndpointStatus -eq "Enabled") {
    Write-Output "Initiating failover from primary to secondary region"
    Write-Output "Reason: $FailoverReason"
    
    # Disable primary endpoint
    $primaryEndpoint.EndpointStatus = "Disabled"
    Set-AzTrafficManagerEndpoint -TrafficManagerEndpoint $primaryEndpoint
    
    # Enable secondary endpoint
    $secondaryEndpoint.EndpointStatus = "Enabled"
    Set-AzTrafficManagerEndpoint -TrafficManagerEndpoint $secondaryEndpoint
    
    Write-Output "Failover completed successfully"
    
    # Send notification (webhook or email)
    $webhookUrl = Get-AutomationVariable -Name "FailoverWebhookUrl"
    if ($webhookUrl) {
        $body = @{
            text = "🚨 AI Answer Ninja Failover Completed`nReason: $FailoverReason`nTime: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')"
        } | ConvertTo-Json
        
        Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType "application/json"
    }
} else {
    Write-Output "Primary endpoint is already disabled. No failover needed."
}
CONTENT
  
  tags = local.common_tags
}

# Runbook for automated failback
resource "azurerm_automation_runbook" "failback" {
  name                    = "${local.resource_prefix}-failback-runbook"
  location                = azurerm_resource_group.shared.location
  resource_group_name     = azurerm_resource_group.shared.name
  automation_account_name = azurerm_automation_account.dr.name
  log_verbose            = true
  log_progress           = true
  runbook_type           = "PowerShell"
  
  content = <<CONTENT
param(
    [Parameter(Mandatory=$true)]
    [string]$TrafficManagerProfileName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$FailbackReason = "Manual failback"
)

# Connect to Azure
$connectionName = "AzureRunAsConnection"
$servicePrincipalConnection = Get-AutomationConnection -Name $connectionName
Connect-AzAccount -ServicePrincipal -TenantId $servicePrincipalConnection.TenantId -ApplicationId $servicePrincipalConnection.ApplicationId -CertificateThumbprint $servicePrincipalConnection.CertificateThumbprint

# Get Traffic Manager profile
$tmProfile = Get-AzTrafficManagerProfile -Name $TrafficManagerProfileName -ResourceGroupName $ResourceGroupName

# Get endpoints
$primaryEndpoint = $tmProfile.Endpoints | Where-Object {$_.Name -like "*primary*"}
$secondaryEndpoint = $tmProfile.Endpoints | Where-Object {$_.Name -like "*secondary*"}

# Health check primary region before failback
$primaryHealthy = $false
try {
    $healthCheck = Invoke-WebRequest -Uri "https://$($primaryEndpoint.Target)/health" -TimeoutSec 10
    if ($healthCheck.StatusCode -eq 200) {
        $primaryHealthy = $true
        Write-Output "Primary region health check passed"
    }
} catch {
    Write-Output "Primary region health check failed: $($_.Exception.Message)"
}

if ($primaryHealthy -and $secondaryEndpoint.EndpointStatus -eq "Enabled") {
    Write-Output "Initiating failback from secondary to primary region"
    Write-Output "Reason: $FailbackReason"
    
    # Enable primary endpoint
    $primaryEndpoint.EndpointStatus = "Enabled"
    Set-AzTrafficManagerEndpoint -TrafficManagerEndpoint $primaryEndpoint
    
    # Disable secondary endpoint
    $secondaryEndpoint.EndpointStatus = "Disabled"
    Set-AzTrafficManagerEndpoint -TrafficManagerEndpoint $secondaryEndpoint
    
    Write-Output "Failback completed successfully"
    
    # Send notification
    $webhookUrl = Get-AutomationVariable -Name "FailoverWebhookUrl"
    if ($webhookUrl) {
        $body = @{
            text = "✅ AI Answer Ninja Failback Completed`nReason: $FailbackReason`nTime: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')"
        } | ConvertTo-Json
        
        Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType "application/json"
    }
} else {
    if (!$primaryHealthy) {
        Write-Output "Primary region is not healthy. Failback aborted."
    } else {
        Write-Output "Already running on primary region. No failback needed."
    }
}
CONTENT
  
  tags = local.common_tags
}

# Automation variables
resource "azurerm_automation_variable_string" "webhook_url" {
  name                    = "FailoverWebhookUrl"
  resource_group_name     = azurerm_resource_group.shared.name
  automation_account_name = azurerm_automation_account.dr.name
  value                  = var.failover_webhook_url
}

# Disaster Recovery Testing Schedule
resource "azurerm_automation_schedule" "dr_test" {
  count = var.enable_dr_testing ? 1 : 0
  
  name                    = "${local.resource_prefix}-dr-test-schedule"
  resource_group_name     = azurerm_resource_group.shared.name
  automation_account_name = azurerm_automation_account.dr.name
  frequency              = "Month"
  interval               = 1
  timezone               = "UTC"
  start_time             = "2024-01-01T02:00:00Z"
  description            = "Monthly DR testing schedule"
}

# Recovery Time Objective (RTO) and Recovery Point Objective (RPO) Monitoring
resource "azurerm_log_analytics_saved_search" "rto_monitoring" {
  name                       = "${local.resource_prefix}-rto-monitoring"
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  category                   = "DR"
  display_name              = "RTO Monitoring"
  query                     = <<QUERY
AzureActivity
| where OperationNameValue == "Microsoft.Network/trafficManagerProfiles/azureEndpoints/write"
| where ActivityStatusValue == "Success"
| extend FailoverTime = TimeGenerated
| project FailoverTime, Caller, ResourceId
| order by FailoverTime desc
QUERY
  
  tags = local.common_tags
}

# DR Documentation and Runbooks
resource "azurerm_storage_blob" "dr_playbook" {
  name                   = "disaster-recovery-playbook.md"
  storage_account_name   = module.storage.storage_account_name
  storage_container_name = "documentation"
  type                   = "Block"
  
  source_content = <<CONTENT
# Disaster Recovery Playbook - AI Answer Ninja

## Overview
This document outlines the disaster recovery procedures for the AI Answer Ninja application.

## RTO/RPO Objectives
- **RTO (Recovery Time Objective)**: 15 minutes
- **RPO (Recovery Point Objective)**: 5 minutes

## Failover Procedures

### Manual Failover
1. Access Azure Automation Account: `${azurerm_automation_account.dr.name}`
2. Run the failover runbook: `${azurerm_automation_runbook.failover.name}`
3. Monitor Traffic Manager for endpoint status changes
4. Verify application functionality in secondary region

### Automated Failover
- Configured monitoring alerts will trigger automatic failover
- Health check failures (3 consecutive) will initiate failover
- Database replication lag monitoring

## Failback Procedures
1. Verify primary region health
2. Run the failback runbook: `${azurerm_automation_runbook.failback.name}`
3. Monitor database synchronization
4. Update DNS TTL if necessary

## Testing Schedule
- Monthly DR tests on first Sunday of each month at 02:00 UTC
- Quarterly full disaster recovery simulations

## Contact Information
- On-call engineer: [Phone/Email]
- DR coordinator: [Phone/Email]
- Azure support: [Support case process]

## Recovery Checklist
- [ ] Verify secondary region health
- [ ] Check database replication status
- [ ] Confirm storage account accessibility
- [ ] Test application functionality
- [ ] Update monitoring dashboards
- [ ] Notify stakeholders
- [ ] Document incident details

## Monitoring and Alerting
- Traffic Manager health probes: 30-second intervals
- Database replication lag alerts: >5 minutes
- Storage replication status monitoring
- Application health checks: /health endpoint

## Dependencies
- Azure Traffic Manager
- PostgreSQL read replicas
- Geo-redundant storage accounts
- Cross-region VNet peering (if enabled)

## Recovery Validation
After failover/failback, verify:
1. Application accessibility via global endpoint
2. Database write operations
3. File upload/download functionality
4. AI service integrations
5. Monitoring and alerting systems

CONTENT
}