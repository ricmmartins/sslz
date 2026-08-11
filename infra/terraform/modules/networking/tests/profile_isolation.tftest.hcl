mock_provider "azurerm" {}

run "primary_default_excludes_container_apps" {
  command = plan

  variables {
    location            = "eastus"
    resource_group_name = "rg-contoso-prod-networking"
    vnet_name           = "vnet-contoso-prod"
    vnet_address_prefix = "10.0.0.0/16"
  }

  assert {
    condition     = length(azurerm_network_security_group.container_apps) == 0
    error_message = "Primary/default networking must not create the Container Apps NSG."
  }

  assert {
    condition     = length(azurerm_subnet.container_apps) == 0
    error_message = "Primary/default networking must not create the Container Apps subnet."
  }

  assert {
    condition     = length(azurerm_subnet_network_security_group_association.container_apps) == 0
    error_message = "Primary/default networking must not create a Container Apps NSG association."
  }

  assert {
    condition     = output.container_apps_subnet_id == null
    error_message = "Primary/default networking must not expose a Container Apps subnet ID."
  }
}

run "cool_profile_includes_container_apps" {
  command = plan

  variables {
    location                      = "westus2"
    resource_group_name           = "rg-contoso-nonprod-cool-networking"
    vnet_name                     = "vnet-contoso-nonprod-cool"
    vnet_address_prefix           = "10.42.0.0/16"
    include_container_apps_subnet = true
  }

  assert {
    condition     = length(azurerm_network_security_group.container_apps) == 1
    error_message = "Cool networking must include exactly one Container Apps NSG."
  }

  assert {
    condition     = length(azurerm_subnet.container_apps) == 1
    error_message = "Cool networking must include exactly one Container Apps subnet."
  }

  assert {
    condition     = one(azurerm_subnet.container_apps[0].address_prefixes) == "10.42.32.0/23"
    error_message = "Cool networking must use the dedicated /23 profile subnet."
  }

  assert {
    condition     = length(azurerm_subnet_network_security_group_association.container_apps) == 1
    error_message = "Cool networking must include the Container Apps NSG association."
  }
}
