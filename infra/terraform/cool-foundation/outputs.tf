output "primary_vnet_address_prefix" {
  description = "Primary CIDR retained for review"
  value       = var.primary_vnet_address_prefix
}

output "secondary_vnet_address_prefix" {
  description = "Secondary CIDR represented by this foundation"
  value       = var.secondary_vnet_address_prefix
}

output "resource_group_monitoring" {
  description = "Secondary monitoring resource group"
  value       = azurerm_resource_group.monitoring.name
}

output "resource_group_networking" {
  description = "Secondary networking resource group"
  value       = azurerm_resource_group.networking.name
}

output "log_analytics_workspace_id" {
  description = "Secondary Log Analytics workspace"
  value       = module.log_analytics.workspace_id
}

output "vnet_id" {
  description = "Secondary virtual network"
  value       = module.networking.vnet_id
}
