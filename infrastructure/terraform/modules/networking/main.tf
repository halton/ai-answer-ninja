# Networking Module - VPC, Subnets, Security Groups, and Load Balancers

# Virtual Network
resource "azurerm_virtual_network" "main" {
  name                = "${var.resource_prefix}-vnet"
  address_space       = var.vnet_address_space
  location            = var.location
  resource_group_name = var.resource_group_name
  
  tags = var.tags
}

# AKS Subnet
resource "azurerm_subnet" "aks" {
  name                 = "${var.resource_prefix}-aks-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.aks_subnet_cidr]
  
  # Enable service endpoints
  service_endpoints = [
    "Microsoft.Storage",
    "Microsoft.KeyVault",
    "Microsoft.ContainerRegistry",
    "Microsoft.Sql"
  ]
}

# Database Subnet with delegation
resource "azurerm_subnet" "database" {
  name                 = "${var.resource_prefix}-db-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.db_subnet_cidr]
  
  service_endpoints = [
    "Microsoft.Storage"
  ]
  
  delegation {
    name = "postgres-delegation"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# Application Gateway Subnet
resource "azurerm_subnet" "gateway" {
  name                 = "${var.resource_prefix}-agw-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.gateway_subnet_cidr]
}

# Azure Bastion Subnet (for secure management access)
resource "azurerm_subnet" "bastion" {
  name                 = "AzureBastionSubnet"  # Fixed name required by Azure
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.bastion_subnet_cidr]
}

# Network Security Groups
resource "azurerm_network_security_group" "aks" {
  name                = "${var.resource_prefix}-aks-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  
  # Allow inbound HTTPS traffic
  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
  
  # Allow inbound HTTP traffic (for health checks)
  security_rule {
    name                       = "AllowHTTP"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
  
  # Allow internal communication within AKS subnet
  security_rule {
    name                       = "AllowAKSInternal"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = var.aks_subnet_cidr
    destination_address_prefix = var.aks_subnet_cidr
  }
  
  # Deny all other inbound traffic
  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
  
  tags = var.tags
}

resource "azurerm_network_security_group" "database" {
  name                = "${var.resource_prefix}-db-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  
  # Allow PostgreSQL traffic from AKS subnet only
  security_rule {
    name                       = "AllowPostgreSQL"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5432"
    source_address_prefix      = var.aks_subnet_cidr
    destination_address_prefix = "*"
  }
  
  # Allow Redis traffic from AKS subnet only
  security_rule {
    name                       = "AllowRedis"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "6380"
    source_address_prefix      = var.aks_subnet_cidr
    destination_address_prefix = "*"
  }
  
  # Deny all other inbound traffic
  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
  
  tags = var.tags
}

resource "azurerm_network_security_group" "gateway" {
  name                = "${var.resource_prefix}-agw-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  
  # Allow Application Gateway management traffic
  security_rule {
    name                       = "AllowGatewayManager"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "65200-65535"
    source_address_prefix      = "GatewayManager"
    destination_address_prefix = "*"
  }
  
  # Allow HTTP and HTTPS traffic
  security_rule {
    name                       = "AllowHTTPSTraffic"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["80", "443"]
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
  
  tags = var.tags
}

# Associate NSGs with subnets
resource "azurerm_subnet_network_security_group_association" "aks" {
  count                     = var.enable_network_security_groups ? 1 : 0
  subnet_id                 = azurerm_subnet.aks.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

resource "azurerm_subnet_network_security_group_association" "database" {
  count                     = var.enable_network_security_groups ? 1 : 0
  subnet_id                 = azurerm_subnet.database.id
  network_security_group_id = azurerm_network_security_group.database.id
}

resource "azurerm_subnet_network_security_group_association" "gateway" {
  count                     = var.enable_network_security_groups ? 1 : 0
  subnet_id                 = azurerm_subnet.gateway.id
  network_security_group_id = azurerm_network_security_group.gateway.id
}

# Route Table for custom routing (optional)
resource "azurerm_route_table" "main" {
  name                          = "${var.resource_prefix}-rt"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  disable_bgp_route_propagation = false
  
  tags = var.tags
}

# Public IP for Azure Bastion
resource "azurerm_public_ip" "bastion" {
  count = var.enable_bastion ? 1 : 0
  
  name                = "${var.resource_prefix}-bastion-pip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]
  
  tags = var.tags
}

# Azure Bastion for secure management access
resource "azurerm_bastion_host" "main" {
  count = var.enable_bastion ? 1 : 0
  
  name                = "${var.resource_prefix}-bastion"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"
  
  ip_configuration {
    name                 = "configuration"
    subnet_id            = azurerm_subnet.bastion.id
    public_ip_address_id = azurerm_public_ip.bastion[0].id
  }
  
  tags = var.tags
}

# NAT Gateway for outbound internet access (optional)
resource "azurerm_public_ip" "nat" {
  count = var.enable_nat_gateway ? 1 : 0
  
  name                = "${var.resource_prefix}-nat-pip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]
  
  tags = var.tags
}

resource "azurerm_nat_gateway" "main" {
  count = var.enable_nat_gateway ? 1 : 0
  
  name                    = "${var.resource_prefix}-nat"
  location                = var.location
  resource_group_name     = var.resource_group_name
  sku_name                = "Standard"
  idle_timeout_in_minutes = 10
  zones                   = ["1", "2", "3"]
  
  tags = var.tags
}

resource "azurerm_nat_gateway_public_ip_association" "main" {
  count = var.enable_nat_gateway ? 1 : 0
  
  nat_gateway_id       = azurerm_nat_gateway.main[0].id
  public_ip_address_id = azurerm_public_ip.nat[0].id
}

resource "azurerm_subnet_nat_gateway_association" "aks" {
  count = var.enable_nat_gateway ? 1 : 0
  
  subnet_id      = azurerm_subnet.aks.id
  nat_gateway_id = azurerm_nat_gateway.main[0].id
}

# Private DNS Zone for internal name resolution
resource "azurerm_private_dns_zone" "main" {
  name                = "${var.resource_prefix}.internal"
  resource_group_name = var.resource_group_name
  
  tags = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "main" {
  name                  = "${var.resource_prefix}-dns-link"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.main.name
  virtual_network_id    = azurerm_virtual_network.main.id
  
  tags = var.tags
}

# Network Watcher for network monitoring and troubleshooting
resource "azurerm_network_watcher" "main" {
  count = var.enable_network_watcher ? 1 : 0
  
  name                = "${var.resource_prefix}-nw"
  location            = var.location
  resource_group_name = var.resource_group_name
  
  tags = var.tags
}

# Flow logs for network monitoring
resource "azurerm_network_watcher_flow_log" "main" {
  count = var.enable_network_watcher && var.enable_flow_logs ? 1 : 0
  
  network_watcher_name = azurerm_network_watcher.main[0].name
  resource_group_name  = var.resource_group_name
  
  network_security_group_id = azurerm_network_security_group.aks.id
  storage_account_id        = var.storage_account_id
  enabled                   = true
  
  retention_policy {
    enabled = true
    days    = 7
  }
  
  traffic_analytics {
    enabled               = true
    workspace_id          = var.log_analytics_workspace_id
    workspace_region      = var.location
    workspace_resource_id = var.log_analytics_workspace_id
    interval_in_minutes   = 10
  }
  
  tags = var.tags
}

# DDoS Protection Plan (optional for enhanced DDoS protection)
resource "azurerm_network_ddos_protection_plan" "main" {
  count = var.enable_ddos_protection ? 1 : 0
  
  name                = "${var.resource_prefix}-ddos"
  location            = var.location
  resource_group_name = var.resource_group_name
  
  tags = var.tags
}

# Update VNet with DDoS protection if enabled
resource "azurerm_virtual_network" "main_with_ddos" {
  count = var.enable_ddos_protection ? 1 : 0
  
  name                = "${var.resource_prefix}-vnet-ddos"
  address_space       = var.vnet_address_space
  location            = var.location
  resource_group_name = var.resource_group_name
  
  ddos_protection_plan {
    id     = azurerm_network_ddos_protection_plan.main[0].id
    enable = true
  }
  
  tags = var.tags
}