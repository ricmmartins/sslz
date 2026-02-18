output "management_group_id" {
  description = "Management group resource ID"
  value       = azurerm_management_group.this.id
}

output "management_group_name" {
  description = "Management group name"
  value       = azurerm_management_group.this.name
}
