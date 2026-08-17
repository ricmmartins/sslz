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

  # Remote backend for shared state. Required for CI/CD.
  # Run ./scripts/bootstrap-backend.sh -s <storage-account-name> to create the storage account.
  # For local dev without backend, run: terraform init -backend=false
  backend "azurerm" {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "yourStorageAccount"
    container_name       = "tfstate"
    key                  = "landing-zone.tfstate"
    use_oidc             = true
  }
}

provider "azurerm" {
  resource_provider_registrations = var.resource_provider_registrations
  resource_providers_to_register  = var.resource_providers_to_register

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

provider "azurerm" {
  alias                           = "defender_workspace"
  subscription_id                 = var.subscription_id
  resource_provider_registrations = var.resource_provider_registrations
  resource_providers_to_register  = var.resource_providers_to_register

  features {
    skip_import_check_on_create_and_allow_overwriting_existing_resources = true
  }
}

# ==============================================================================
# Resource Groups
# ==============================================================================

resource "terraform_data" "log_analytics_workspace_placement_guard" {
  lifecycle {
    precondition {
      condition     = contains(local.allowed_locations, local.log_analytics_workspace_location)
      error_message = "log_analytics_workspace_location must be included in allowed_locations."
    }

    precondition {
      condition     = contains(local.allowed_locations, var.location)
      error_message = "The selected primary location must be included in allowed_locations."
    }

    precondition {
      condition     = !local.create_log_analytics_workspace || local.log_analytics_workspace_location == var.location
      error_message = "A new Log Analytics workspace must use the selected primary location."
    }

    precondition {
      condition     = local.create_log_analytics_workspace || local.existing_workspace_reference_valid
      error_message = "existing_log_analytics_workspace_id must be a Log Analytics workspace resource ID."
    }

    precondition {
      condition     = local.create_log_analytics_workspace || try(lower(split("/", var.existing_log_analytics_workspace_id)[2]) == lower(var.subscription_id), false)
      error_message = "existing_log_analytics_workspace_id must belong to the deployment subscription."
    }

    precondition {
      condition = local.enable_defender_for_servers ? (
        local.configure_defender_workspace != var.defender_workspace_association_managed_externally
        ) : (
        !local.configure_defender_workspace && !var.defender_workspace_association_managed_externally
      )
      error_message = "Exactly one Defender workspace association owner is required when Defender for Servers is enabled."
    }

    precondition {
      condition     = !var.defender_workspace_association_managed_externally || !local.create_log_analytics_workspace
      error_message = "An externally managed Defender workspace association requires an approved existing workspace reference."
    }

    precondition {
      condition = !local.enable_defender_for_servers || !var.defender_workspace_shared_subscription ? (
        !var.defender_workspace_association_managed_externally
        ) : (
        !local.create_log_analytics_workspace && (
          (var.environment == "prod" && local.configure_defender_workspace && !var.defender_workspace_association_managed_externally) ||
          (var.environment == "nonprod" && !local.configure_defender_workspace && var.defender_workspace_association_managed_externally)
        )
      )
      error_message = "A shared subscription requires one approved existing workspace, prod ownership, and nonprod external management."
    }

    precondition {
      condition = local.create_log_analytics_workspace || try(
        lower(data.azurerm_log_analytics_workspace.existing[0].id) == lower(var.existing_log_analytics_workspace_id) &&
        lower(data.azurerm_log_analytics_workspace.existing[0].location) == lower(local.log_analytics_workspace_location),
        false,
      )
      error_message = "The existing Log Analytics workspace actual ID and location must match the reviewed placement."
    }
  }
}

data "azurerm_log_analytics_workspace" "existing" {
  count               = local.create_log_analytics_workspace || !local.existing_workspace_reference_valid ? 0 : 1
  name                = element(reverse(split("/", local.safe_existing_workspace_id)), 0)
  resource_group_name = split("/", local.safe_existing_workspace_id)[4]
}

resource "azurerm_resource_group" "monitoring" {
  count    = local.create_log_analytics_workspace ? 1 : 0
  name     = "rg-${local.prefix}-monitoring"
  location = local.log_analytics_workspace_location
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
  count               = local.create_log_analytics_workspace ? 1 : 0
  source              = "./modules/monitoring"
  location            = local.log_analytics_workspace_location
  resource_group_name = azurerm_resource_group.monitoring[0].name
  workspace_name      = "law-${local.prefix}"
  retention_in_days   = var.log_retention_in_days
  daily_quota_gb      = var.log_daily_quota_gb
  tags                = local.tags
}

module "networking" {
  count                                  = var.deploy_networking ? 1 : 0
  source                                 = "./modules/networking"
  location                               = var.location
  resource_group_name                    = azurerm_resource_group.networking[0].name
  vnet_name                              = "vnet-${local.prefix}"
  vnet_address_prefix                    = local.vnet_address_prefix
  app_subnet_delegation                  = var.app_subnet_delegation
  aks_ingress_mode                       = var.aks_ingress_mode
  aks_ingress_frontend_port              = var.aks_ingress_frontend_port
  aks_ingress_backend_node_port          = var.aks_ingress_backend_node_port
  aks_ingress_health_probe_source_prefix = var.aks_ingress_health_probe_source_prefix
  aks_ingress_source_prefixes            = var.aks_ingress_source_prefixes
  aks_ingress_reserved_nsg_priorities    = var.aks_ingress_reserved_nsg_priorities
  include_container_apps_subnet          = false
  tags                                   = local.tags
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
  subscription_id                = var.subscription_id
  security_contact_email         = var.security_contact_email
  enable_defender_for_servers    = local.enable_defender_for_servers
  enable_defender_for_containers = var.enable_defender_for_containers
  enable_defender_for_databases  = local.enable_defender_for_databases
  enable_defender_for_key_vault  = var.enable_defender_for_key_vault
  enable_defender_for_storage    = var.enable_defender_for_storage
}

resource "azurerm_security_center_workspace" "defender" {
  count        = local.configure_defender_workspace ? 1 : 0
  provider     = azurerm.defender_workspace
  scope        = "/subscriptions/${var.subscription_id}"
  workspace_id = local.effective_log_analytics_workspace_id

  lifecycle {
    prevent_destroy = true
  }
}

module "policy" {
  source                     = "./modules/policy"
  location                   = var.location
  policy_assignment_prefix   = var.policy_assignment_prefix
  allowed_locations          = local.allowed_locations
  log_analytics_workspace_id = local.effective_log_analytics_workspace_id
  subscription_id            = var.subscription_id
}

# ==============================================================================
# Activity Log — Diagnostic Setting (immediate, not waiting for DINE policy)
# ==============================================================================

resource "azurerm_monitor_diagnostic_setting" "activity_log" {
  name                       = "diag-activity-log-to-law"
  target_resource_id         = "/subscriptions/${var.subscription_id}"
  log_analytics_workspace_id = local.effective_log_analytics_workspace_id

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
