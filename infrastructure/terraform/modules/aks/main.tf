# AKS Module - Auto-scaling Kubernetes Cluster for AI Answer Ninja

# Log Analytics Workspace for Container Insights
resource "azurerm_log_analytics_workspace" "aks" {
  count               = var.enable_container_insights ? 1 : 0
  name                = "${var.resource_prefix}-aks-logs"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = var.tags
}

# AKS Cluster with auto-scaling enabled
resource "azurerm_kubernetes_cluster" "main" {
  name                = "${var.resource_prefix}-aks"
  location            = var.location
  resource_group_name = var.resource_group_name
  dns_prefix          = "${var.resource_prefix}-dns"
  kubernetes_version  = var.kubernetes_version

  # Private cluster configuration for enhanced security
  private_cluster_enabled             = var.enable_private_cluster
  private_dns_zone_id                = var.enable_private_cluster ? "System" : null
  private_cluster_public_fqdn_enabled = false

  # Auto-scaling configuration
  automatic_channel_upgrade = "stable"
  node_resource_group       = "${var.resource_group_name}-nodes"

  # Default node pool with auto-scaling
  default_node_pool {
    name                = "default"
    node_count          = var.node_count_default
    min_count           = var.node_count_min
    max_count           = var.node_count_max
    vm_size             = var.node_vm_size
    type                = "VirtualMachineScaleSets"
    availability_zones  = ["1", "2", "3"]
    enable_auto_scaling = true
    
    # Network configuration
    vnet_subnet_id = var.aks_subnet_id
    
    # Node configuration for AI workloads
    os_disk_size_gb      = 128
    os_disk_type         = "Managed"
    max_pods             = 110
    enable_node_public_ip = false
    
    # Taints and labels for scheduling
    node_labels = {
      "workload-type" = "general"
      "environment"   = var.environment
    }
    
    upgrade_settings {
      max_surge = "10%"
    }
  }

  # Service Principal / Managed Identity
  identity {
    type = "SystemAssigned"
  }

  # Network configuration
  network_profile {
    network_plugin      = "azure"
    network_policy      = "azure"
    dns_service_ip      = "172.16.0.10"
    service_cidr        = "172.16.0.0/16"
    load_balancer_sku   = "standard"
    outbound_type       = "loadBalancer"
  }

  # RBAC configuration
  role_based_access_control_enabled = true
  
  azure_active_directory_role_based_access_control {
    managed                = true
    admin_group_object_ids = var.admin_group_object_ids
    azure_rbac_enabled     = true
  }

  # Add-ons configuration
  dynamic "oms_agent" {
    for_each = var.enable_container_insights ? [1] : []
    content {
      log_analytics_workspace_id = azurerm_log_analytics_workspace.aks[0].id
    }
  }

  dynamic "key_vault_secrets_provider" {
    for_each = var.key_vault_id != "" ? [1] : []
    content {
      secret_rotation_enabled = true
    }
  }

  ingress_application_gateway {
    gateway_name = "${var.resource_prefix}-agw"
    subnet_id    = var.gateway_subnet_id
  }

  # API Server configuration
  api_server_access_profile {
    authorized_ip_ranges = var.api_server_authorized_ip_ranges
  }

  # Auto-scaler profile
  auto_scaler_profile {
    balance_similar_node_groups      = true
    expander                        = "least-waste"
    max_graceful_termination_sec    = "600"
    max_node_provisioning_time      = "15m"
    max_unready_nodes              = 3
    max_unready_percentage         = 45
    new_pod_scale_up_delay         = "10s"
    scale_down_delay_after_add     = "10m"
    scale_down_delay_after_delete  = "10s"
    scale_down_delay_after_failure = "3m"
    scan_interval                  = "10s"
    scale_down_unneeded           = "10m"
    scale_down_unready            = "20m"
    scale_down_utilization_threshold = 0.5
  }

  tags = var.tags

  depends_on = [
    azurerm_log_analytics_workspace.aks
  ]
}

# AI/ML specialized node pool with GPU support
resource "azurerm_kubernetes_cluster_node_pool" "ai_workload" {
  name                  = "aipool"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = "Standard_NC6s_v3"  # GPU-enabled VMs
  node_count            = 0
  min_count            = 0
  max_count            = 5
  availability_zones   = ["1", "2", "3"]
  enable_auto_scaling  = true
  
  # AI workload specific configuration
  node_labels = {
    "workload-type" = "ai-ml"
    "gpu-enabled"   = "true"
    "environment"   = var.environment
  }
  
  node_taints = [
    "workload=ai-ml:NoSchedule"
  ]
  
  vnet_subnet_id = var.aks_subnet_id
  
  upgrade_settings {
    max_surge = "10%"
  }
  
  tags = var.tags
}

# High-memory node pool for data processing
resource "azurerm_kubernetes_cluster_node_pool" "memory_intensive" {
  name                  = "mempool"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = "Standard_E8s_v3"  # High-memory VMs
  node_count            = 0
  min_count            = 0
  max_count            = 10
  availability_zones   = ["1", "2", "3"]
  enable_auto_scaling  = true
  
  node_labels = {
    "workload-type" = "memory-intensive"
    "environment"   = var.environment
  }
  
  node_taints = [
    "workload=memory-intensive:NoSchedule"
  ]
  
  vnet_subnet_id = var.aks_subnet_id
  
  upgrade_settings {
    max_surge = "10%"
  }
  
  tags = var.tags
}

# Spot instance node pool for cost optimization
resource "azurerm_kubernetes_cluster_node_pool" "spot" {
  count = var.enable_spot_instances ? 1 : 0
  
  name                  = "spot"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = var.spot_node_vm_size
  priority              = "Spot"
  eviction_policy       = "Delete"
  spot_max_price        = var.spot_max_price
  
  node_count          = 0
  min_count          = 0
  max_count          = var.spot_max_nodes
  availability_zones = ["1", "2", "3"]
  enable_auto_scaling = true
  
  node_labels = {
    "workload-type" = "spot"
    "cost-optimized" = "true"
    "environment"   = var.environment
  }
  
  node_taints = [
    "kubernetes.azure.com/scalesetpriority=spot:NoSchedule"
  ]
  
  vnet_subnet_id = var.aks_subnet_id
  
  upgrade_settings {
    max_surge = "10%"
  }
  
  tags = var.tags
}

# Container Registry for storing Docker images
resource "azurerm_container_registry" "main" {
  name                = "${replace(var.resource_prefix, "-", "")}acr"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Premium"
  admin_enabled       = false
  
  # Geo-replication for high availability
  georeplications {
    location                = var.secondary_location
    zone_redundancy_enabled = true
    tags                   = var.tags
  }
  
  # Network access rules
  network_rule_set {
    default_action = "Allow"  # Change to "Deny" for production with proper IP allowlist
  }
  
  # Content trust and vulnerability scanning
  trust_policy {
    enabled = true
  }
  
  retention_policy {
    enabled = true
    days    = 30
  }
  
  tags = var.tags
}

# Grant AKS cluster access to ACR
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}

# Application Gateway for Ingress Controller
resource "azurerm_public_ip" "agw" {
  name                = "${var.resource_prefix}-agw-pip"
  resource_group_name = var.resource_group_name
  location            = var.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]
  tags                = var.tags
}

# Web Application Firewall Policy
resource "azurerm_web_application_firewall_policy" "main" {
  name                = "${var.resource_prefix}-waf"
  resource_group_name = var.resource_group_name
  location            = var.location

  policy_settings {
    enabled                     = true
    mode                       = "Prevention"
    request_body_check         = true
    file_upload_limit_in_mb    = 100
    max_request_body_size_in_kb = 128
  }

  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = "3.2"
    }
    managed_rule_set {
      type    = "Microsoft_BotManagerRuleSet"
      version = "0.1"
    }
  }

  tags = var.tags
}