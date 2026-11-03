mock_provider "azurerm" {}

variables {
  subscription_id                     = "33333333-3333-3333-3333-333333333333"
  location                            = "westus2"
  resource_group_name                 = "rg-contoso-nonprod-cool-westus2-container-apps"
  managed_environment_name            = "cae-contoso-nonprod-cool-westus2"
  container_app_name                  = "ca-contoso-nonprod-cool-westus2"
  managed_identity_resource_id        = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-cool-westus2-container-apps/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-contoso-nonprod-cool-westus2"
  managed_identity_principal_id       = "44444444-4444-4444-4444-444444444444"
  key_vault_resource_id               = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-security/providers/Microsoft.KeyVault/vaults/kv-contoso-nonprod"
  key_vault_role_definition_id        = "/subscriptions/33333333-3333-3333-3333-333333333333/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"
  infrastructure_subnet_resource_id   = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-cool-westus2-networking/providers/Microsoft.Network/virtualNetworks/vnet-contoso-nonprod-cool-westus2/subnets/snet-container-apps"
  log_analytics_workspace_resource_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-cool-westus2-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-contoso-nonprod-cool-westus2"
  primary_scope                       = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-primary/providers/Microsoft.Resources/deployments/primary"
  secondary_scope                     = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-cool-westus2-container-apps/providers/Microsoft.Resources/deployments/profile"
  primary_vnet_cidr                   = "10.0.0.0/16"
  secondary_vnet_cidr                 = "10.1.0.0/16"
  image                               = "contoso.azurecr.io/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  target_port                         = 8080
  secret_references = [{
    name                 = "database-url"
    key_vault_secret_uri = "https://kv-contoso-nonprod.vault.azure.net/secrets/database-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    identity_resource_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-cool-westus2-container-apps/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-contoso-nonprod-cool-westus2"
  }]
  secret_environment_variables = [{
    name       = "DATABASE_URL"
    secret_ref = "database-url"
  }]
  probes = [
    {
      type                  = "Startup"
      transport             = "HTTP"
      path                  = "/startup"
      port                  = 8080
      initial_delay_seconds = 5
      interval_seconds      = 10
      timeout_seconds       = 5
      failure_threshold     = 6
    },
    {
      type                  = "Readiness"
      transport             = "HTTP"
      path                  = "/ready"
      port                  = 8080
      initial_delay_seconds = 0
      interval_seconds      = 10
      timeout_seconds       = 5
      failure_threshold     = 3
    },
    {
      type                  = "Liveness"
      transport             = "HTTP"
      path                  = "/health"
      port                  = 8080
      initial_delay_seconds = 10
      interval_seconds      = 20
      timeout_seconds       = 5
      failure_threshold     = 3
    }
  ]
  diagnostic_setting_name = "diag-container-apps"
  decision_digest         = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  source_digest           = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "minimum_viable_profile_passes" {
  command = plan
}

run "mutable_image_fails" {
  command = plan

  variables {
    image = "contoso.azurecr.io/api:latest"
  }

  expect_failures = [var.image]
}

run "wrong_profile_subnet_fails" {
  command = plan

  variables {
    infrastructure_subnet_resource_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-cool-westus2-networking/providers/Microsoft.Network/virtualNetworks/vnet-contoso-nonprod-cool-westus2/subnets/snet-app"
  }

  expect_failures = [var.infrastructure_subnet_resource_id]
}

run "primary_scope_reuse_fails" {
  command = plan

  variables {
    secondary_scope = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-contoso-nonprod-primary/providers/Microsoft.Resources/deployments/primary"
  }

  expect_failures = [azurerm_resource_group.profile]
}

run "partial_address_overlap_fails" {
  command = plan

  variables {
    secondary_vnet_cidr = "10.0.128.0/17"
  }

  expect_failures = [azurerm_resource_group.profile]
}

run "secret_identity_mismatch_fails" {
  command = plan

  variables {
    secret_references = [{
      name                 = "database-url"
      key_vault_secret_uri = "https://kv-contoso-nonprod.vault.azure.net/secrets/database-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      identity_resource_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-other/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-other"
    }]
  }

  expect_failures = [azurerm_container_app.profile]
}
