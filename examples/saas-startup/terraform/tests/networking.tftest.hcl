mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id       = "11111111-1111-1111-1111-111111111111"
      object_id       = "22222222-2222-2222-2222-222222222222"
      subscription_id = "33333333-3333-3333-3333-333333333333"
    }
  }
}

variables {
  subscription_id     = "33333333-3333-3333-3333-333333333333"
  resource_group_name = "rg-saas-test"
  location            = "eastus2"
  app_name            = "mysaas"
  environment         = "nonprod"
  sql_admin_login     = "appadmin"
  sql_admin_password  = "not-a-real-secret"
}

run "public_default_preserves_internet_path" {
  command = plan

  assert {
    condition     = azurerm_container_app_environment.this.infrastructure_subnet_id == null
    error_message = "Public mode must not inject the Container Apps environment into a caller VNet."
  }

  assert {
    condition     = azurerm_mssql_server.this.public_network_access_enabled
    error_message = "Public mode must retain SQL public network access."
  }

  assert {
    condition     = azurerm_redis_cache.this.public_network_access_enabled
    error_message = "Public mode must retain Redis public network access."
  }

  assert {
    condition     = length(azurerm_private_endpoint.sql) == 0 && length(azurerm_private_endpoint.redis) == 0
    error_message = "Public mode must not create Private Endpoints."
  }

  assert {
    condition     = length(output.private_dns_zone_ids) == 0
    error_message = "Public mode must not expose private DNS zones."
  }
}

run "private_mode_builds_complete_runtime_path" {
  command = plan

  variables {
    deploy_private_endpoints                = true
    vnet_id                                 = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas"
    container_apps_infrastructure_subnet_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-container-apps"
    private_endpoint_subnet_id              = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-private-endpoints"
  }

  override_data {
    target = data.azurerm_subnet.container_apps[0]
    values = {
      address_prefixes = ["10.42.0.0/23"]
    }
  }

  override_data {
    target = data.azurerm_subnet.private_endpoints[0]
    values = {
      address_prefixes = ["10.42.2.0/27"]
    }
  }

  assert {
    condition     = azurerm_container_app_environment.this.infrastructure_subnet_id == var.container_apps_infrastructure_subnet_id
    error_message = "Private mode must inject Container Apps into the dedicated infrastructure subnet."
  }

  assert {
    condition     = !azurerm_mssql_server.this.public_network_access_enabled && !azurerm_redis_cache.this.public_network_access_enabled
    error_message = "Private mode must disable SQL and Redis public network access."
  }

  assert {
    condition     = length(azurerm_private_endpoint.sql) == 1 && length(azurerm_private_endpoint.redis) == 1
    error_message = "Private mode must create SQL and Redis Private Endpoints."
  }

  assert {
    condition = (
      azurerm_private_dns_zone_virtual_network_link.sql[0].virtual_network_id == var.vnet_id &&
      azurerm_private_dns_zone_virtual_network_link.redis[0].virtual_network_id == var.vnet_id
    )
    error_message = "Private mode must link both private DNS zones to the Container Apps VNet."
  }

  assert {
    condition     = length(output.private_dns_zone_ids) == 2
    error_message = "Private mode must expose both private DNS zone IDs."
  }
}

run "private_mode_requires_aca_injection" {
  command = plan

  variables {
    deploy_private_endpoints   = true
    vnet_id                    = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas"
    private_endpoint_subnet_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-private-endpoints"
  }

  expect_failures = [
    check.private_endpoint_config,
    azurerm_container_app_environment.this,
  ]
}

run "private_mode_rejects_overlapping_subnets" {
  command = plan

  variables {
    deploy_private_endpoints                = true
    vnet_id                                 = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas"
    container_apps_infrastructure_subnet_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-container-apps"
    private_endpoint_subnet_id              = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-private-endpoints"
  }

  override_data {
    target = data.azurerm_subnet.container_apps[0]
    values = {
      address_prefixes = ["10.42.0.0/23"]
    }
  }

  override_data {
    target = data.azurerm_subnet.private_endpoints[0]
    values = {
      address_prefixes = ["10.42.0.32/27"]
    }
  }

  expect_failures = [azurerm_container_app_environment.this]
}

run "private_mode_rejects_undersized_aca_subnet" {
  command = plan

  variables {
    deploy_private_endpoints                = true
    vnet_id                                 = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas"
    container_apps_infrastructure_subnet_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-container-apps"
    private_endpoint_subnet_id              = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-private-endpoints"
  }

  override_data {
    target = data.azurerm_subnet.container_apps[0]
    values = {
      address_prefixes = ["10.42.0.0/28"]
    }
  }

  override_data {
    target = data.azurerm_subnet.private_endpoints[0]
    values = {
      address_prefixes = ["10.42.2.0/27"]
    }
  }

  expect_failures = [azurerm_container_app_environment.this]
}

run "private_mode_rejects_reserved_aca_range" {
  command = plan

  variables {
    deploy_private_endpoints                = true
    vnet_id                                 = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas"
    container_apps_infrastructure_subnet_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-container-apps"
    private_endpoint_subnet_id              = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-saas/subnets/snet-private-endpoints"
  }

  override_data {
    target = data.azurerm_subnet.container_apps[0]
    values = {
      address_prefixes = ["100.100.0.0/24"]
    }
  }

  override_data {
    target = data.azurerm_subnet.private_endpoints[0]
    values = {
      address_prefixes = ["10.42.2.0/27"]
    }
  }

  expect_failures = [azurerm_container_app_environment.this]
}
