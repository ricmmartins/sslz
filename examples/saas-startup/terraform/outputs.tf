# ==============================================================================
# Outputs
# ==============================================================================

output "api_url" {
  description = "HTTPS URL of the API container app"
  value       = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "web_url" {
  description = "HTTPS URL of the web frontend container app"
  value       = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}

output "sql_server_fqdn" {
  description = "Fully qualified domain name of the SQL Server"
  value       = azurerm_mssql_server.this.fully_qualified_domain_name
}

output "redis_hostname" {
  description = "Redis cache hostname"
  value       = azurerm_redis_cache.this.hostname
}

output "key_vault_uri" {
  description = "Key Vault URI for secret access"
  value       = azurerm_key_vault.this.vault_uri
}
