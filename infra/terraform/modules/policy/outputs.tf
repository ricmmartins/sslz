output "policy_assignment_ids" {
  description = "Map of policy assignment resource IDs"
  value = {
    mcsb                 = azurerm_subscription_policy_assignment.mcsb.id
    allowed_locations    = azurerm_subscription_policy_assignment.allowed_locations.id
    allowed_locations_rg = azurerm_subscription_policy_assignment.allowed_locations_rg.id
    require_env_tag      = azurerm_subscription_policy_assignment.require_env_tag.id
    require_team_tag     = azurerm_subscription_policy_assignment.require_team_tag.id
    inherit_env_tag      = azurerm_subscription_policy_assignment.inherit_env_tag.id
    inherit_team_tag     = azurerm_subscription_policy_assignment.inherit_team_tag.id
    activity_log_diag    = azurerm_subscription_policy_assignment.activity_log_diag.id
  }
}

output "policy_assignment_names" {
  description = "Map of policy assignment names"
  value = {
    mcsb                 = azurerm_subscription_policy_assignment.mcsb.name
    allowed_locations    = azurerm_subscription_policy_assignment.allowed_locations.name
    allowed_locations_rg = azurerm_subscription_policy_assignment.allowed_locations_rg.name
    require_env_tag      = azurerm_subscription_policy_assignment.require_env_tag.name
    require_team_tag     = azurerm_subscription_policy_assignment.require_team_tag.name
    inherit_env_tag      = azurerm_subscription_policy_assignment.inherit_env_tag.name
    inherit_team_tag     = azurerm_subscription_policy_assignment.inherit_team_tag.name
    activity_log_diag    = azurerm_subscription_policy_assignment.activity_log_diag.name
  }
}
