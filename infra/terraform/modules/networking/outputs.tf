output "vnet_id" {
  description = "Virtual network resource ID"
  value       = azurerm_virtual_network.this.id
}

output "vnet_name" {
  description = "Virtual network name"
  value       = azurerm_virtual_network.this.name
}

output "aks_subnet_id" {
  description = "AKS subnet resource ID"
  value       = azurerm_subnet.aks.id
}

output "app_subnet_id" {
  description = "App subnet resource ID"
  value       = azurerm_subnet.app.id
}

output "data_subnet_id" {
  description = "Data subnet resource ID"
  value       = azurerm_subnet.data.id
}

output "shared_subnet_id" {
  description = "Shared subnet resource ID"
  value       = azurerm_subnet.shared.id
}

output "container_apps_subnet_id" {
  description = "Dedicated nondelegated /23 Container Apps infrastructure subnet resource ID"
  value       = azurerm_subnet.container_apps.id
}
