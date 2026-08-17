mock_provider "azurerm" {
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.cspm
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.servers
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.containers
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.sql
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.oss_db
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.keyvault
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.arm
  }
  override_resource {
    target = module.security.azurerm_security_center_subscription_pricing.storage
  }
}

mock_provider "azurerm" {
  alias = "defender_workspace"

  override_resource {
    target = azurerm_security_center_workspace.defender[0]
  }
}

variables {
  subscription_id                  = "22222222-2222-2222-2222-222222222222"
  resource_provider_registrations  = "none"
  resource_providers_to_register   = []
  location                         = "eastus2"
  company_name                     = "contoso"
  environment                      = "prod"
  deploy_networking                = false
  monthly_budget_amount            = 500
  budget_alert_emails              = ["budget-alerts@example.invalid"]
  security_contact_email           = "security-alerts@example.invalid"
  budget_start_date                = "2026-08-01T00:00:00Z"
  allowed_locations                = ["eastus2", "centralus"]
  enable_defender_for_servers      = true
  configure_defender_workspace     = true
  log_analytics_workspace_location = "eastus2"
}

run "explicit_new_workspace" {
  command = plan

  assert {
    condition     = length(azurerm_resource_group.monitoring) == 1
    error_message = "Explicit new placement must create exactly one monitoring resource group."
  }

  assert {
    condition     = output.resource_group_monitoring == "rg-contoso-prod-monitoring"
    error_message = "The new workspace resource group must use the selected regional plan."
  }

  assert {
    condition     = output.defender_for_storage_tier == "Free"
    error_message = "Defender for Storage must default to the non-billable Free tier."
  }

  assert {
    condition     = output.defender_for_storage_subplan == null
    error_message = "The disabled Defender for Storage plan must not emit a paid subplan."
  }

  assert {
    condition     = output.defender_for_storage_enabled == false
    error_message = "The root output must report the default-off Defender for Storage decision."
  }
}

run "explicit_storage_defender_opt_in" {
  command = plan

  variables {
    enable_defender_for_storage = true
  }

  assert {
    condition     = output.defender_for_storage_tier == "Standard"
    error_message = "Explicit opt-in must select the paid Defender for Storage tier."
  }

  assert {
    condition     = output.defender_for_storage_subplan == "DefenderForStorageV2"
    error_message = "Explicit opt-in must select DefenderForStorageV2."
  }

  assert {
    condition     = output.defender_for_storage_enabled == true
    error_message = "The root output must report the explicit Defender for Storage opt-in."
  }
}

run "approved_existing_workspace" {
  command = plan

  override_data {
    target = data.azurerm_log_analytics_workspace.existing[0]
    values = {
      id       = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-centralus"
      location = "centralus"
    }
  }

  variables {
    allowed_locations                   = ["eastus2", "centralus"]
    log_analytics_workspace_location    = "centralus"
    existing_log_analytics_workspace_id = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-centralus"
  }

  assert {
    condition     = length(azurerm_resource_group.monitoring) == 0
    error_message = "An approved existing workspace must not create a duplicate monitoring resource group."
  }

  assert {
    condition     = output.defender_workspace_id == var.existing_log_analytics_workspace_id
    error_message = "Defender must use the approved existing workspace reference."
  }
}

run "defender_disabled" {
  command = plan

  variables {
    enable_defender_for_servers            = false
    configure_defender_workspace           = false
    defender_workspace_shared_subscription = true
  }

  assert {
    condition     = output.defender_workspace_id == null
    error_message = "Disabled Defender for Servers must not create a workspace association."
  }
}

run "shared_subscription_prod_owner_uses_existing_workspace" {
  command = plan

  override_data {
    target = data.azurerm_log_analytics_workspace.existing[0]
    values = {
      id       = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-eastus2"
      location = "eastus2"
    }
  }

  variables {
    defender_workspace_shared_subscription = true
    existing_log_analytics_workspace_id    = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-eastus2"
  }

  assert {
    condition     = length(azurerm_security_center_workspace.defender) == 1
    error_message = "The prod artifact must own the shared-subscription workspace singleton."
  }
}

run "denied_workspace_region_fails" {
  command = plan

  variables {
    log_analytics_workspace_location = "eastus"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "new_workspace_outside_primary_fails" {
  command = plan

  variables {
    log_analytics_workspace_location = "centralus"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "malformed_existing_workspace_fails" {
  command = plan

  variables {
    existing_log_analytics_workspace_id = "/subscriptions/not-a-workspace"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "nested_existing_workspace_id_fails" {
  command = plan

  variables {
    existing_log_analytics_workspace_id = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-compute/providers/Microsoft.Compute/virtualMachines/vm/providers/Microsoft.OperationalInsights/workspaces/law-nested"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "cross_subscription_workspace_fails" {
  command = plan

  variables {
    existing_log_analytics_workspace_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-other-subscription"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "defender_selection_mismatch_fails" {
  command = plan

  variables {
    configure_defender_workspace = false
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "shared_subscription_non_owner_uses_existing_workspace" {
  command = plan

  override_data {
    target = data.azurerm_log_analytics_workspace.existing[0]
    values = {
      id       = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-eastus2"
      location = "eastus2"
    }
  }

  variables {
    configure_defender_workspace                      = false
    defender_workspace_association_managed_externally = true
    defender_workspace_shared_subscription            = true
    environment                                       = "nonprod"
    existing_log_analytics_workspace_id               = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-eastus2"
  }

  assert {
    condition     = length(azurerm_security_center_workspace.defender) == 0
    error_message = "The non-owner environment must not manage the subscription workspace singleton."
  }
}

run "existing_workspace_actual_region_mismatch_fails" {
  command = plan

  override_data {
    target = data.azurerm_log_analytics_workspace.existing[0]
    values = {
      id       = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-eastus"
      location = "eastus"
    }
  }

  variables {
    log_analytics_workspace_location    = "centralus"
    existing_log_analytics_workspace_id = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-eastus"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "shared_subscription_new_workspace_fails" {
  command = plan

  variables {
    defender_workspace_shared_subscription = true
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "shared_subscription_nonprod_owner_fails" {
  command = plan

  override_data {
    target = data.azurerm_log_analytics_workspace.existing[0]
    values = {
      id       = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-eastus2"
      location = "eastus2"
    }
  }

  variables {
    defender_workspace_shared_subscription = true
    environment                            = "nonprod"
    existing_log_analytics_workspace_id    = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-eastus2"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}

run "primary_region_excluded_from_policy_fails" {
  command = plan

  variables {
    allowed_locations                   = ["centralus"]
    log_analytics_workspace_location    = "centralus"
    existing_log_analytics_workspace_id = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg-shared-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-approved-centralus"
  }

  expect_failures = [
    terraform_data.log_analytics_workspace_placement_guard,
  ]
}
