terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

resource "azurerm_log_analytics_workspace" "this" {
  name                            = var.workspace_name
  location                        = var.location
  resource_group_name             = var.resource_group_name
  sku                             = "PerGB2018"
  retention_in_days               = var.retention_in_days
  daily_quota_gb                  = var.daily_quota_gb
  allow_resource_only_permissions = true
  tags                            = var.tags
}
