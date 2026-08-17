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

output "container_apps_environment_id" {
  description = "Container Apps environment resource ID"
  value       = azurerm_container_app_environment.this.id
}

output "container_apps_infrastructure_subnet_id" {
  description = "Container Apps infrastructure subnet resource ID in private mode; empty in public mode"
  value       = var.deploy_private_endpoints ? var.container_apps_infrastructure_subnet_id : ""
}

output "private_endpoint_subnet_id" {
  description = "Private Endpoint subnet resource ID in private mode; empty in public mode"
  value       = var.deploy_private_endpoints ? var.private_endpoint_subnet_id : ""
}

output "private_dns_zone_ids" {
  description = "Private DNS zone resource IDs linked to the application VNet; empty in public mode"
  value = var.deploy_private_endpoints ? [
    azurerm_private_dns_zone.sql[0].id,
    azurerm_private_dns_zone.redis[0].id,
  ] : []
}
