# ==============================================================================
# Outputs
# ==============================================================================

output "resource_group_monitoring" {
  description = "Monitoring resource group name"
  value       = local.effective_monitoring_resource_group
}

output "resource_group_networking" {
  description = "Networking resource group name"
  value       = var.deploy_networking ? azurerm_resource_group.networking[0].name : null
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace resource ID"
  value       = local.effective_log_analytics_workspace_id
}

output "log_analytics_workspace_name" {
  description = "Log Analytics workspace name"
  value       = local.effective_log_analytics_workspace_name
}

output "defender_workspace_id" {
  description = "Log Analytics workspace explicitly associated with Defender for Servers"
  value       = local.configure_defender_workspace ? azurerm_security_center_workspace.defender[0].workspace_id : null
}

output "vnet_id" {
  description = "Virtual network resource ID"
  value       = var.deploy_networking ? module.networking[0].vnet_id : null
}

output "vnet_name" {
  description = "Virtual network name"
  value       = var.deploy_networking ? module.networking[0].vnet_name : null
}
