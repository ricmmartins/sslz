output "workspace_id" {
  description = "Log Analytics workspace resource ID"
  value       = azurerm_log_analytics_workspace.this.id
}

output "workspace_name" {
  description = "Log Analytics workspace name"
  value       = azurerm_log_analytics_workspace.this.name
}

output "workspace_customer_id" {
  description = "Log Analytics workspace customer ID (for agents and integrations)"
  value       = azurerm_log_analytics_workspace.this.workspace_id
}
