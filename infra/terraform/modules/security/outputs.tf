output "defender_for_storage_enabled" {
  description = "Whether the paid Defender for Storage V2 plan is enabled"
  value       = var.enable_defender_for_storage
}

output "defender_for_storage_tier" {
  description = "Configured Defender for Storage pricing tier"
  value       = azurerm_security_center_subscription_pricing.storage.tier
}

output "defender_for_storage_subplan" {
  description = "Configured Defender for Storage subplan, or null when disabled"
  value       = azurerm_security_center_subscription_pricing.storage.subplan
}
