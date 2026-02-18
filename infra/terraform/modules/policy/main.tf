locals {
  subscription_scope = "/subscriptions/${var.subscription_id}"

  # Built-in policy definition IDs
  policy_ids = {
    mcsb                 = "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8"
    allowed_locations    = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c"
    allowed_locations_rg = "/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988"
    require_tag_rg       = "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025"
    inherit_tag          = "/providers/Microsoft.Authorization/policyDefinitions/cd3aa116-8754-49c9-a813-ad46512ece54"
    activity_log_diag    = "/providers/Microsoft.Authorization/policyDefinitions/2465583e-4e78-4c15-b6be-a36cbc7c8b0f"
  }
}

# ==============================================================================
# Microsoft Cloud Security Benchmark — Audit
# ==============================================================================

resource "azurerm_subscription_policy_assignment" "mcsb" {
  name                 = "mcsb-audit"
  display_name         = "Microsoft Cloud Security Benchmark (Audit)"
  description          = "Audit resources against Microsoft Cloud Security Benchmark."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.mcsb
  enforce              = true
}

# ==============================================================================
# Allowed Locations
# ==============================================================================

resource "azurerm_subscription_policy_assignment" "allowed_locations" {
  name                 = "allowed-locations"
  display_name         = "Allowed Locations"
  description          = "Restrict resource deployment to approved regions only."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.allowed_locations
  enforce              = true

  parameters = jsonencode({
    listOfAllowedLocations = { value = var.allowed_locations }
  })
}

resource "azurerm_subscription_policy_assignment" "allowed_locations_rg" {
  name                 = "allowed-locations-rg"
  display_name         = "Allowed Locations for Resource Groups"
  description          = "Restrict resource group creation to approved regions only."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.allowed_locations_rg
  enforce              = true

  parameters = jsonencode({
    listOfAllowedLocations = { value = var.allowed_locations }
  })
}

# ==============================================================================
# Required Tags
# ==============================================================================

resource "azurerm_subscription_policy_assignment" "require_env_tag" {
  name                 = "require-env-tag-rg"
  display_name         = "Require environment tag on resource groups"
  description          = "All resource groups must have an environment tag."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.require_tag_rg
  enforce              = true

  parameters = jsonencode({
    tagName = { value = "environment" }
  })
}

resource "azurerm_subscription_policy_assignment" "require_team_tag" {
  name                 = "require-team-tag-rg"
  display_name         = "Require team tag on resource groups"
  description          = "All resource groups must have a team tag."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.require_tag_rg
  enforce              = true

  parameters = jsonencode({
    tagName = { value = "team" }
  })
}

# ==============================================================================
# Tag Inheritance
# ==============================================================================

resource "azurerm_subscription_policy_assignment" "inherit_env_tag" {
  name                 = "inherit-env-tag"
  display_name         = "Inherit environment tag from resource group"
  description          = "Auto-propagate environment tag from resource groups to resources."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.inherit_tag
  location             = var.location
  enforce              = true

  identity {
    type = "SystemAssigned"
  }

  parameters = jsonencode({
    tagName = { value = "environment" }
  })
}

resource "azurerm_subscription_policy_assignment" "inherit_team_tag" {
  name                 = "inherit-team-tag"
  display_name         = "Inherit team tag from resource group"
  description          = "Auto-propagate team tag from resource groups to resources."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.inherit_tag
  location             = var.location
  enforce              = true

  identity {
    type = "SystemAssigned"
  }

  parameters = jsonencode({
    tagName = { value = "team" }
  })
}

# ==============================================================================
# Activity Log Diagnostics
# ==============================================================================

resource "azurerm_subscription_policy_assignment" "activity_log_diag" {
  name                 = "activity-log-diag"
  display_name         = "Deploy Activity Log diagnostics to Log Analytics"
  description          = "Auto-configure Activity Log to stream to Log Analytics."
  subscription_id      = local.subscription_scope
  policy_definition_id = local.policy_ids.activity_log_diag
  location             = var.location
  enforce              = true

  identity {
    type = "SystemAssigned"
  }

  parameters = jsonencode({
    logAnalytics = { value = var.log_analytics_workspace_id }
  })
}
