terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

locals {
  # Build non-overlapping subnets from the VNet CIDR.
  # Assumes the VNet is at least /16 (default in this repo is /16).
  # Layout:
  # - AKS:   /20  (netnum 0)   -> 10.x.0.0/20
  # - APP:   /22  (netnum 4)   -> 10.x.16.0/22
  # - DATA:  /22  (netnum 5)   -> 10.x.20.0/22
  # - SHARED /24  (netnum 24)  -> 10.x.24.0/24

  subnets = merge({
    aks = {
      name           = "snet-aks"
      address_prefix = cidrsubnet(var.vnet_address_prefix, 4, 0)
    }
    app = {
      name           = "snet-app"
      address_prefix = cidrsubnet(var.vnet_address_prefix, 6, 4)
    }
    data = {
      name           = "snet-data"
      address_prefix = cidrsubnet(var.vnet_address_prefix, 6, 5)
    }
    shared = {
      name           = "snet-shared"
      address_prefix = cidrsubnet(var.vnet_address_prefix, 8, 24)
    }
    }, var.include_container_apps_subnet ? {
    container_apps = {
      name           = "snet-container-apps"
      address_prefix = cidrsubnet(var.vnet_address_prefix, 7, 16)
    }
  } : {})

  aks_public_ingress       = var.aks_ingress_mode == "public-azure-load-balancer"
  aks_private_ingress      = var.aks_ingress_mode == "private"
  aks_generated_priorities = local.aks_public_ingress ? [100, 110, 120, 4096] : [120, 4096]
  aks_reserved_priorities_valid = (
    length(distinct(var.aks_ingress_reserved_nsg_priorities)) == length(var.aks_ingress_reserved_nsg_priorities) &&
    alltrue([
      for priority in var.aks_ingress_reserved_nsg_priorities :
      priority == floor(priority) && priority >= 100 && priority <= 4096
    ])
  )
  aks_priority_collision = length(setintersection(
    toset(local.aks_generated_priorities),
    toset(var.aks_ingress_reserved_nsg_priorities),
  )) > 0
  aks_ingress_shape_valid = var.aks_ingress_mode == "not-applicable" ? (
    var.aks_ingress_frontend_port == 0 &&
    var.aks_ingress_backend_node_port == 0 &&
    var.aks_ingress_health_probe_source_prefix == "" &&
    length(var.aks_ingress_source_prefixes) == 0
    ) : local.aks_private_ingress ? (
    var.aks_ingress_frontend_port == 0 &&
    var.aks_ingress_backend_node_port == 0 &&
    var.aks_ingress_health_probe_source_prefix == "" &&
    length(var.aks_ingress_source_prefixes) == 0
    ) : (
    contains([80, 443], var.aks_ingress_frontend_port) &&
    var.aks_ingress_backend_node_port == floor(var.aks_ingress_backend_node_port) &&
    var.aks_ingress_backend_node_port >= 30000 &&
    var.aks_ingress_backend_node_port <= 32767 &&
    var.aks_ingress_health_probe_source_prefix == "AzureLoadBalancer" &&
    length(distinct(var.aks_ingress_source_prefixes)) == length(var.aks_ingress_source_prefixes) &&
    alltrue([
      for prefix in var.aks_ingress_source_prefixes :
      prefix == "Internet" || (
        can(regex("^((25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})\\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})/(3[0-2]|[12]?[0-9])$", prefix)) &&
        can(cidrhost(prefix, 0))
      )
    ]) &&
    length(var.aks_ingress_source_prefixes) > 0
  )
  aks_legacy_rules = [
    {
      name                    = "AllowAzureLoadBalancerInbound"
      priority                = 110
      protocol                = "*"
      source_address_prefixes = ["AzureLoadBalancer"]
      destination_port_range  = "*"
    },
    {
      name                    = "AllowVNetInbound"
      priority                = 120
      protocol                = "*"
      source_address_prefixes = ["VirtualNetwork"]
      destination_port_range  = "*"
    },
    {
      name                    = "DenyAllInbound"
      priority                = 4096
      protocol                = "*"
      source_address_prefixes = ["*"]
      destination_port_range  = "*"
    },
  ]
  aks_private_rules = [
    {
      name                    = "AllowVNetInbound"
      priority                = 120
      protocol                = "*"
      source_address_prefixes = ["VirtualNetwork"]
      destination_port_range  = "*"
    },
    {
      name                    = "DenyAllInbound"
      priority                = 4096
      protocol                = "*"
      source_address_prefixes = ["*"]
      destination_port_range  = "*"
    },
  ]
  aks_public_rules = [
    {
      name                    = "AllowAzureLoadBalancerHealthProbe"
      priority                = 100
      protocol                = "Tcp"
      source_address_prefixes = ["AzureLoadBalancer"]
      destination_port_range  = tostring(var.aks_ingress_backend_node_port)
    },
    {
      name                    = "AllowApprovedPublicIngress"
      priority                = 110
      protocol                = "Tcp"
      source_address_prefixes = sort(var.aks_ingress_source_prefixes)
      destination_port_range  = tostring(var.aks_ingress_backend_node_port)
    },
    {
      name                    = "AllowVNetInbound"
      priority                = 120
      protocol                = "*"
      source_address_prefixes = ["VirtualNetwork"]
      destination_port_range  = "*"
    },
    {
      name                    = "DenyAllInbound"
      priority                = 4096
      protocol                = "*"
      source_address_prefixes = ["*"]
      destination_port_range  = "*"
    },
  ]
  aks_security_rules = var.aks_ingress_mode == "not-applicable" ? local.aks_legacy_rules : (
    local.aks_private_ingress ? local.aks_private_rules : local.aks_public_rules
  )
}

# ==============================================================================
# NSGs
# ==============================================================================
resource "azurerm_network_security_group" "aks" {
  name                = "nsg-snet-aks"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  dynamic "security_rule" {
    for_each = { for rule in local.aks_security_rules : rule.name => rule }
    content {
      name                       = security_rule.value.name
      priority                   = security_rule.value.priority
      direction                  = "Inbound"
      access                     = security_rule.value.name == "DenyAllInbound" ? "Deny" : "Allow"
      protocol                   = security_rule.value.protocol
      source_address_prefix      = length(security_rule.value.source_address_prefixes) == 1 ? one(security_rule.value.source_address_prefixes) : null
      source_address_prefixes    = length(security_rule.value.source_address_prefixes) > 1 ? security_rule.value.source_address_prefixes : null
      source_port_range          = "*"
      destination_address_prefix = security_rule.value.name == "AllowVNetInbound" ? "VirtualNetwork" : "*"
      destination_port_range     = security_rule.value.destination_port_range
    }
  }

  lifecycle {
    precondition {
      condition     = local.aks_ingress_shape_valid
      error_message = "AKS ingress must use the supported private or exact public Azure Load Balancer contract."
    }
    precondition {
      condition     = local.aks_reserved_priorities_valid && !local.aks_priority_collision
      error_message = "AKS ingress NSG priorities conflict with an existing reserved rule."
    }
  }
}

resource "azurerm_network_security_group" "app" {
  name                = "nsg-snet-app"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "*"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

resource "azurerm_network_security_group" "data" {
  name                = "nsg-snet-data"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  security_rule {
    name                       = "AllowFromAksSubnet"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_address_prefix      = local.subnets.aks.address_prefix
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_ranges    = ["1433", "5432", "6380", "443"]
  }

  security_rule {
    name                       = "AllowFromAppSubnet"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_address_prefix      = local.subnets.app.address_prefix
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_ranges    = ["1433", "5432", "6380", "443"]
  }

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "*"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

resource "azurerm_network_security_group" "shared" {
  name                = "nsg-snet-shared"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "*"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

resource "azurerm_network_security_group" "container_apps" {
  count               = var.include_container_apps_subnet ? 1 : 0
  name                = "nsg-snet-container-apps"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  security_rule {
    name                       = "AllowAzureLoadBalancerInbound"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_address_prefix      = "AzureLoadBalancer"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }

  security_rule {
    name                       = "AllowVNetInbound"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_address_prefix      = "VirtualNetwork"
    source_port_range          = "*"
    destination_address_prefix = "VirtualNetwork"
    destination_port_range     = "*"
  }

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "*"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

# ==============================================================================
# VNet + Subnets
# ==============================================================================
resource "azurerm_virtual_network" "this" {
  name                = var.vnet_name
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = [var.vnet_address_prefix]
  tags                = var.tags
}

resource "azurerm_subnet" "aks" {
  name                 = local.subnets.aks.name
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [local.subnets.aks.address_prefix]
}

resource "azurerm_subnet_network_security_group_association" "aks" {
  subnet_id                 = azurerm_subnet.aks.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

resource "azurerm_subnet" "app" {
  name                 = local.subnets.app.name
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [local.subnets.app.address_prefix]

  delegation {
    name = "delegation-web"
    service_delegation {
      name = var.app_subnet_delegation
    }
  }
}

resource "azurerm_subnet_network_security_group_association" "app" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.app.id
}

resource "azurerm_subnet" "data" {
  name                 = local.subnets.data.name
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [local.subnets.data.address_prefix]
}

resource "azurerm_subnet_network_security_group_association" "data" {
  subnet_id                 = azurerm_subnet.data.id
  network_security_group_id = azurerm_network_security_group.data.id
}

resource "azurerm_subnet" "shared" {
  name                 = local.subnets.shared.name
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [local.subnets.shared.address_prefix]
}

resource "azurerm_subnet_network_security_group_association" "shared" {
  subnet_id                 = azurerm_subnet.shared.id
  network_security_group_id = azurerm_network_security_group.shared.id
}

resource "azurerm_subnet" "container_apps" {
  count                = var.include_container_apps_subnet ? 1 : 0
  name                 = local.subnets.container_apps.name
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [local.subnets.container_apps.address_prefix]
}

resource "azurerm_subnet_network_security_group_association" "container_apps" {
  count                     = var.include_container_apps_subnet ? 1 : 0
  subnet_id                 = azurerm_subnet.container_apps[0].id
  network_security_group_id = azurerm_network_security_group.container_apps[0].id
}
