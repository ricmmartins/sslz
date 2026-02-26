# ==============================================================================
# Management Groups
# Deploy separately with: terraform apply -target=module.management_groups
# Requires tenant-level permissions
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

locals {
  display_name = var.display_name != "" ? var.display_name : "${var.company_name} Landing Zone"
}

resource "azurerm_management_group" "this" {
  name         = "mg-${var.company_name}"
  display_name = local.display_name

  subscription_ids = [
    var.prod_subscription_id,
    var.nonprod_subscription_id,
  ]
}
