terraform {
  required_version = ">= 1.5.0"

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
  regional_suffix = lower(replace(var.location, " ", ""))
  prefix          = "${var.company_name}-${var.environment}-cool-${local.regional_suffix}"
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
  source                = "../modules/networking"
  location              = var.location
  resource_group_name   = azurerm_resource_group.networking.name
  vnet_name             = "vnet-${local.prefix}"
  vnet_address_prefix   = var.secondary_vnet_address_prefix
  app_subnet_delegation = var.app_subnet_delegation
  tags                  = local.tags
}
