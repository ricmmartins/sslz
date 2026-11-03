terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "yourStorageAccount"
    container_name       = "tfstate"
    key                  = "cool-foundation.tfstate"
    use_oidc             = true
  }
}

provider "azurerm" {
  resource_provider_registrations = var.resource_provider_registrations
  resource_providers_to_register  = var.resource_providers_to_register
  subscription_id                 = var.subscription_id

  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

locals {
  regional_suffix           = lower(replace(var.location, " ", ""))
  prefix                    = "${var.company_name}-${var.environment}-cool-${local.regional_suffix}"
  primary_address_octets    = try([for octet in split(".", split("/", var.primary_vnet_address_prefix)[0]) : tonumber(octet)], [0, 0, 0, 0])
  secondary_address_octets  = try([for octet in split(".", split("/", var.secondary_vnet_address_prefix)[0]) : tonumber(octet)], [0, 0, 0, 0])
  primary_prefix_length     = try(tonumber(split("/", var.primary_vnet_address_prefix)[1]), 0)
  secondary_prefix_length   = try(tonumber(split("/", var.secondary_vnet_address_prefix)[1]), 0)
  primary_address_value     = local.primary_address_octets[0] * 16777216 + local.primary_address_octets[1] * 65536 + local.primary_address_octets[2] * 256 + local.primary_address_octets[3]
  secondary_address_value   = local.secondary_address_octets[0] * 16777216 + local.secondary_address_octets[1] * 65536 + local.secondary_address_octets[2] * 256 + local.secondary_address_octets[3]
  primary_block_size        = pow(2, 32 - local.primary_prefix_length)
  secondary_block_size      = pow(2, 32 - local.secondary_prefix_length)
  primary_network_value     = floor(local.primary_address_value / local.primary_block_size) * local.primary_block_size
  secondary_network_value   = floor(local.secondary_address_value / local.secondary_block_size) * local.secondary_block_size
  primary_broadcast_value   = local.primary_network_value + local.primary_block_size - 1
  secondary_broadcast_value = local.secondary_network_value + local.secondary_block_size - 1
  address_spaces_overlap = (
    local.primary_network_value <= local.secondary_broadcast_value &&
    local.secondary_network_value <= local.primary_broadcast_value
  )
  default_tags = {
    environment    = var.environment
    managedBy      = "terraform"
    project        = "landing-zone"
    regionalRole   = "secondary"
    deploymentMode = "cool-infrastructure"
  }
  tags = merge(local.default_tags, var.tags)
}

resource "azurerm_resource_group" "monitoring" {
  name     = "rg-${local.prefix}-monitoring"
  location = var.location
  tags     = local.tags
}

resource "azurerm_resource_group" "networking" {
  name     = "rg-${local.prefix}-networking"
  location = var.location
  tags     = local.tags

  lifecycle {
    precondition {
      condition     = !local.address_spaces_overlap
      error_message = "primary_vnet_address_prefix and secondary_vnet_address_prefix must not overlap."
    }
  }
}

module "log_analytics" {
  source              = "../modules/monitoring"
  location            = var.location
  resource_group_name = azurerm_resource_group.monitoring.name
  workspace_name      = "law-${local.prefix}"
  retention_in_days   = var.log_retention_in_days
  daily_quota_gb      = var.log_daily_quota_gb
  tags                = local.tags
}

module "networking" {
  source                        = "../modules/networking"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.networking.name
  vnet_name                     = "vnet-${local.prefix}"
  vnet_address_prefix           = var.secondary_vnet_address_prefix
  app_subnet_delegation         = var.app_subnet_delegation
  include_container_apps_subnet = true
  tags                          = local.tags
}
