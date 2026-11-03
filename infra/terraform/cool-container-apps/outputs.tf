output "profile_resource_group_id" {
  description = "Isolated nonproduction profile resource group ID"
  value       = azurerm_resource_group.profile.id
}

output "managed_environment_id" {
  description = "Internal Container Apps managed environment ID"
  value       = azurerm_container_app_environment.profile.id
}

output "container_app_id" {
  description = "Secondary Container App ID"
  value       = azurerm_container_app.profile.id
}

output "managed_identity_resource_id" {
  description = "Bound user-assigned managed identity ID"
  value       = var.managed_identity_resource_id
}

output "decision_digest" {
  description = "Canonical provider-equivalent decision digest"
  value       = var.decision_digest
}

output "source_digest" {
  description = "Exact Terraform source digest"
  value       = var.source_digest
}

output "execution_enabled" {
  description = "This representation cannot execute from the planning workflow"
  value       = false
}
