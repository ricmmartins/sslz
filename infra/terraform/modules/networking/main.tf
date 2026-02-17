variable "location" {
  description = "Azure region"
  type        = string
}
variable "resource_group_name" {
  description = "Resource group name"
  type        = string
}
variable "vnet_name" {
  description = "Virtual network name"
  type        = string
}
variable "vnet_address_prefix" {
  description = "VNet address prefix (e.g., 10.0.0.0/16)"
  type        = string
}
variable "app_subnet_delegation" {
  description = "Service delegation for the app subnet (e.g., Microsoft.Web/serverFarms for App Service, Microsoft.App/environments for Container Apps)"
  type        = string
  default     = "Microsoft.Web/serverFarms"
}
variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}

locals {
  # Extract base octets from the address prefix (e.g., "10.0" from "10.0.0.0/16")
  octets      = split(".", var.vnet_address_prefix)
  base_prefix = "${local.octets[0]}.${local.octets[1]}"

  subnets = {
    aks = {
      name           = "snet-aks"
      address_prefix = "${local.base_prefix}.0.0/18"
    }
    app = {
      name           = "snet-app"
      address_prefix = "${local.base_prefix}.4.0/22"
    }
    data = {
      name           = "snet-data"
      address_prefix = "${local.base_prefix}.8.0/22"
    }
    shared = {
      name           = "snet-shared"
      address_prefix = "${local.base_prefix}.12.0/24"
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
# VNet
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
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/action",
      ]
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

# ==============================================================================
# Outputs
# ==============================================================================

output "vnet_id" { value = azurerm_virtual_network.this.id }
output "vnet_name" { value = azurerm_virtual_network.this.name }
output "aks_subnet_id" { value = azurerm_subnet.aks.id }
output "app_subnet_id" { value = azurerm_subnet.app.id }
output "data_subnet_id" { value = azurerm_subnet.data.id }
output "shared_subnet_id" { value = azurerm_subnet.shared.id }
