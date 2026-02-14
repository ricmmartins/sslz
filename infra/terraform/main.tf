# ==============================================================================
# Azure Landing Zone for Startups — Terraform Main
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Uncomment and configure for remote state
  # backend "azurerm" {
  #   resource_group_name  = "rg-terraform-state"
  #   storage_account_name = "stterraformstate"
  #   container_name       = "tfstate"
  #   key                  = "landing-zone.tfstate"
  # }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# ==============================================================================
# Resource Groups
# ==============================================================================

resource "azurerm_resource_group" "monitoring" {
  name     = "rg-${var.prefix}-monitoring"
  location = var.location
  tags     = var.tags
}

resource "azurerm_resource_group" "networking" {
  count    = var.deploy_networking ? 1 : 0
  name     = "rg-${var.prefix}-networking"
  location = var.location
  tags     = var.tags
}

# ==============================================================================
# Modules
# ==============================================================================

module "log_analytics" {
  source              = "./modules/monitoring"
  location            = var.location
  resource_group_name = azurerm_resource_group.monitoring.name
  workspace_name      = "law-${var.prefix}"
  retention_in_days   = 90
  daily_quota_gb      = 5
  tags                = var.tags
}

module "networking" {
  count               = var.deploy_networking ? 1 : 0
  source              = "./modules/networking"
  location            = var.location
  resource_group_name = azurerm_resource_group.networking[0].name
  vnet_name           = "vnet-${var.prefix}"
  vnet_address_prefix = var.environment == "prod" ? "10.0.0.0/16" : "10.1.0.0/16"
  tags                = var.tags
}

module "security" {
  source                        = "./modules/security"
  log_analytics_workspace_id    = module.log_analytics.workspace_id
  enable_defender_for_servers    = var.enable_defender_for_servers
  enable_defender_for_containers = var.enable_defender_for_containers
  enable_defender_for_databases  = var.enable_defender_for_databases
}

module "policy" {
  source                     = "./modules/policy"
  location                   = var.location
  allowed_locations          = var.allowed_locations
  log_analytics_workspace_id = module.log_analytics.workspace_id
  subscription_id            = var.subscription_id
}

# ==============================================================================
# Budget
# ==============================================================================

resource "azurerm_consumption_budget_subscription" "monthly" {
  name            = "budget-${var.prefix}-monthly"
  subscription_id = "/subscriptions/${var.subscription_id}"
  amount          = var.monthly_budget_amount
  time_grain      = "Monthly"

  time_period {
    start_date = "${formatdate("YYYY-MM", timestamp())}-01T00:00:00Z"
  }

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
  }

  notification {
    enabled        = true
    threshold      = 100
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

  lifecycle {
    ignore_changes = [time_period]
  }
}

# ==============================================================================
# Outputs
# ==============================================================================

output "log_analytics_workspace_id" {
  value = module.log_analytics.workspace_id
}

output "log_analytics_workspace_name" {
  value = module.log_analytics.workspace_name
}

output "vnet_id" {
  value = var.deploy_networking ? module.networking[0].vnet_id : null
}

output "vnet_name" {
  value = var.deploy_networking ? module.networking[0].vnet_name : null
}
