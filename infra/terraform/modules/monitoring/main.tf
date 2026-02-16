variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "workspace_name" { type = string }
variable "retention_in_days" {
  type    = number
  default = 90
}
variable "daily_quota_gb" {
  type    = number
  default = 5
}
variable "tags" {
  type    = map(string)
  default = {}
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

output "workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}

output "workspace_name" {
  value = azurerm_log_analytics_workspace.this.name
}
