# ==============================================================================
# Startup-Scale Landing Zone (SSLZ) — Terraform Root Module
# https://startupscalelanding.zone
# ==============================================================================
#
# NOTE: Management Groups
# -----------------------
# The management-groups module (./modules/management-groups) is NOT called from
# this root config because it requires *tenant-level* permissions that most
# service principals do not have.
#
# Deploy it separately BEFORE running this main deployment:
#
#   cd infra/terraform/modules/management-groups
#   terraform init
#   terraform apply \
#     -var='subscription_id=<ANY_SUB_ID>' \
#     -var='company_name=yourcompany' \
#     -var='prod_subscription_id=<PROD_SUB_ID>' \
#     -var='nonprod_subscription_id=<NONPROD_SUB_ID>'
#
# After the management group exists, come back here and run normally:
#
#   cd infra/terraform
#   terraform apply
#
# See: ./modules/management-groups/main.tf
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Remote backend — uncomment and update storage_account_name with your value.
  # Run ./scripts/bootstrap-backend.sh to create the storage account, then
  # uncomment this block and run: terraform init -migrate-state
  # backend "azurerm" {
  #   resource_group_name  = "rg-terraform-state"
  #   storage_account_name = "REPLACE_WITH_YOUR_STORAGE_ACCOUNT"
  #   container_name       = "tfstate"
  #   key                  = "landing-zone.tfstate"
  #   use_oidc             = true
  # }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
  subscription_id = var.subscription_id
}

# ==============================================================================
# Resource Groups
# ==============================================================================

resource "azurerm_resource_group" "monitoring" {
  name     = "rg-${local.prefix}-monitoring"
  location = var.location
  tags     = local.tags
}

resource "azurerm_resource_group" "networking" {
  count    = var.deploy_networking ? 1 : 0
  name     = "rg-${local.prefix}-networking"
  location = var.location
  tags     = local.tags
}

# ==============================================================================
# Modules
# ==============================================================================

module "log_analytics" {
  source              = "./modules/monitoring"
  location            = var.location
  resource_group_name = azurerm_resource_group.monitoring.name
  workspace_name      = "law-${local.prefix}"
  retention_in_days   = var.log_retention_in_days
  daily_quota_gb      = var.log_daily_quota_gb
  tags                = local.tags
}

module "networking" {
  count                 = var.deploy_networking ? 1 : 0
  source                = "./modules/networking"
  location              = var.location
  resource_group_name   = azurerm_resource_group.networking[0].name
  vnet_name             = "vnet-${local.prefix}"
  vnet_address_prefix   = local.vnet_address_prefix
  app_subnet_delegation = var.app_subnet_delegation
  tags                  = local.tags
}

# Defender pricing resources (Microsoft.Security/pricings/*) already exist on every
# Azure subscription at "Free" tier. They must be imported into Terraform state.
import {
  to = module.security.azurerm_security_center_subscription_pricing.cspm
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/CloudPosture"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.servers
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/VirtualMachines"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.containers
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/Containers"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.sql
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/SqlServers"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.oss_db
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/OpenSourceRelationalDatabases"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.keyvault
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/KeyVaults"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.arm
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/Arm"
}
import {
  to = module.security.azurerm_security_center_subscription_pricing.storage
  id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/pricings/StorageAccounts"
}

# securityContacts/default does NOT exist on a clean subscription.
# On FIRST deploy, leave this import block commented out — Terraform will create it.
# If you get "already exists" errors on subsequent deploys, uncomment this block
# to adopt the existing resource into Terraform state.
# import {
#   to = module.security.azurerm_security_center_contact.default
#   id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Security/securityContacts/default"
# }

module "security" {
  source                         = "./modules/security"
  security_contact_email         = var.security_contact_email
  enable_defender_for_servers    = local.enable_defender_for_servers
  enable_defender_for_containers = var.enable_defender_for_containers
  enable_defender_for_databases  = local.enable_defender_for_databases
  enable_defender_for_key_vault  = var.enable_defender_for_key_vault
}

module "policy" {
  source                     = "./modules/policy"
  location                   = var.location
  allowed_locations          = local.allowed_locations
  log_analytics_workspace_id = module.log_analytics.workspace_id
  subscription_id            = var.subscription_id
}

# ==============================================================================
# Activity Log — Diagnostic Setting (immediate, not waiting for DINE policy)
# ==============================================================================

resource "azurerm_monitor_diagnostic_setting" "activity_log" {
  name                       = "diag-activity-log-to-law"
  target_resource_id         = "/subscriptions/${var.subscription_id}"
  log_analytics_workspace_id = module.log_analytics.workspace_id

  enabled_log {
    category = "Administrative"
  }
  enabled_log {
    category = "Security"
  }
  enabled_log {
    category = "Alert"
  }
  enabled_log {
    category = "Policy"
  }
  enabled_log {
    category = "ServiceHealth"
  }
  enabled_log {
    category = "Recommendation"
  }
  enabled_log {
    category = "Autoscale"
  }
  enabled_log {
    category = "ResourceHealth"
  }
}

# ==============================================================================
# Budget
# For cost anomaly detection, enable it in the Azure Portal:
# Cost Management → Cost alerts → Anomaly alerts (no Terraform resource available).
# See docs/cost-management.md for details.
# ==============================================================================

resource "azurerm_consumption_budget_subscription" "monthly" {
  name            = "budget-${local.prefix}-monthly"
  subscription_id = "/subscriptions/${var.subscription_id}"
  amount          = var.monthly_budget_amount
  time_grain      = "Monthly"

  time_period {
    start_date = local.budget_start_date
  }

  lifecycle {
    ignore_changes = [time_period]
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

}
