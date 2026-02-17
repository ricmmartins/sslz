variable "location" {
  description = "Azure region"
  type        = string
}
variable "resource_group_name" {
  description = "Resource group name"
  type        = string
}
variable "workspace_name" {
  description = "Log Analytics workspace name"
  type        = string
}
variable "retention_in_days" {
  description = "Data retention in days"
  type        = number
  default     = 90
}
variable "daily_quota_gb" {
  description = "Daily ingestion quota in GB"
  type        = number
  default     = 5
}
variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
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
