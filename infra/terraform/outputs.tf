# ==============================================================================
# Outputs
# ==============================================================================

output "resource_group_monitoring" {
  description = "Monitoring resource group name"
  value       = azurerm_resource_group.monitoring.name
}

output "resource_group_networking" {
  description = "Networking resource group name"
  value       = var.deploy_networking ? azurerm_resource_group.networking[0].name : null
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace resource ID"
  value       = module.log_analytics.workspace_id
}

output "log_analytics_workspace_name" {
  description = "Log Analytics workspace name"
  value       = module.log_analytics.workspace_name
}

output "vnet_id" {
  description = "Virtual network resource ID"
  value       = var.deploy_networking ? module.networking[0].vnet_id : null
}

output "vnet_name" {
  description = "Virtual network name"
  value       = var.deploy_networking ? module.networking[0].vnet_name : null
}
