# ==============================================================================
# Outputs
# ==============================================================================

output "aks_cluster_name" {
  description = "AKS cluster name (use with az aks get-credentials)"
  value       = azurerm_kubernetes_cluster.this.name
}

output "aks_cluster_fqdn" {
  description = "AKS cluster FQDN for API server access"
  value       = azurerm_kubernetes_cluster.this.fqdn
}

output "acr_login_server" {
  description = "Container registry login server (use with docker push)"
  value       = azurerm_container_registry.this.login_server
}

output "openai_endpoint" {
  description = "Azure OpenAI service endpoint URL"
  value       = azurerm_cognitive_account.openai.endpoint
}

output "storage_account_name" {
  description = "Storage account name for model artifacts and datasets"
  value       = azurerm_storage_account.this.name
}

output "redis_hostname" {
  description = "Redis cache hostname for inference caching"
  value       = azurerm_redis_cache.this.hostname
}

output "key_vault_uri" {
  description = "Key Vault URI for secret access"
  value       = azurerm_key_vault.this.vault_uri
}
