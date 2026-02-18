output "policy_assignment_ids" {
  description = "Map of policy assignment resource IDs"
  value = {
    mcsb              = azurerm_subscription_policy_assignment.mcsb.id
    allowed_locations = azurerm_subscription_policy_assignment.allowed_locations.id
    activity_log_diag = azurerm_subscription_policy_assignment.activity_log_diag.id
  }
}
