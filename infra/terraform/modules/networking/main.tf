terraform {
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

  subnets = {
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
  }
}

# ==============================================================================
# NSGs
# ==============================================================================
resource "azurerm_network_security_group" "aks" {
  name                = "nsg-snet-aks"
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
