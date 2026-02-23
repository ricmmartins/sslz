# ==============================================================================
# Outputs
# ==============================================================================

output "app_url" {
  description = "HTTPS URL of the App Service API"
  value       = "https://${azurerm_linux_web_app.this.default_hostname}"
}

output "apim_gateway_url" {
  description = "API Management gateway URL for external consumers"
  value       = azurerm_api_management.this.gateway_url
}

output "cosmos_endpoint" {
  description = "Cosmos DB account endpoint URL"
  value       = azurerm_cosmosdb_account.this.endpoint
}

output "app_insights_connection_string" {
  description = "Application Insights connection string (sensitive)"
  value       = azurerm_application_insights.this.connection_string
  sensitive   = true
}

output "redis_hostname" {
  description = "Redis cache hostname for response caching"
  value       = azurerm_redis_cache.this.hostname
}

output "key_vault_uri" {
  description = "Key Vault URI for secret access"
  value       = azurerm_key_vault.this.vault_uri
}
