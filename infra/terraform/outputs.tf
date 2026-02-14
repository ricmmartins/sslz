output "resource_group_monitoring" {
  description = "Monitoring resource group name"
  value       = azurerm_resource_group.monitoring.name
}

output "resource_group_networking" {
  description = "Networking resource group name"
  value       = var.deploy_networking ? azurerm_resource_group.networking[0].name : null
}
