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

run "private_aks_ingress_preserves_deny_by_default" {
  command = plan

  variables {
    location            = "eastus2"
    resource_group_name = "rg-contoso-prod-networking"
    vnet_name           = "vnet-contoso-prod"
    vnet_address_prefix = "10.0.0.0/16"
    aks_ingress_mode    = "private"
  }

  assert {
    condition = (
      length(output.aks_ingress_nsg_rules) == 2 &&
      output.aks_ingress_nsg_rules[0].name == "AllowVNetInbound" &&
      output.aks_ingress_nsg_rules[0].priority == 120 &&
      one(output.aks_ingress_nsg_rules[0].source_address_prefixes) == "VirtualNetwork" &&
      output.aks_ingress_nsg_rules[1].name == "DenyAllInbound" &&
      output.aks_ingress_nsg_rules[1].priority == 4096
    )
    error_message = "Private AKS ingress must allow only VNet traffic before deny-all."
  }
}

run "public_aks_ingress_uses_exact_probe_and_data_path" {
  command = plan

  variables {
    location                               = "eastus2"
    resource_group_name                    = "rg-contoso-prod-networking"
    vnet_name                              = "vnet-contoso-prod"
    vnet_address_prefix                    = "10.0.0.0/16"
    aks_ingress_mode                       = "public-azure-load-balancer"
    aks_ingress_frontend_port              = 80
    aks_ingress_backend_node_port          = 30080
    aks_ingress_health_probe_source_prefix = "AzureLoadBalancer"
    aks_ingress_source_prefixes            = ["203.0.113.0/24"]
  }

  assert {
    condition = (
      length(output.aks_ingress_nsg_rules) == 4 &&
      output.aks_ingress_nsg_rules[0].name == "AllowAzureLoadBalancerHealthProbe" &&
      output.aks_ingress_nsg_rules[0].priority == 100 &&
      output.aks_ingress_nsg_rules[0].protocol == "Tcp" &&
      one(output.aks_ingress_nsg_rules[0].source_address_prefixes) == "AzureLoadBalancer" &&
      output.aks_ingress_nsg_rules[0].destination_port_range == "30080" &&
      output.aks_ingress_nsg_rules[1].name == "AllowApprovedPublicIngress" &&
      output.aks_ingress_nsg_rules[1].priority == 110 &&
      output.aks_ingress_nsg_rules[1].protocol == "Tcp" &&
      one(output.aks_ingress_nsg_rules[1].source_address_prefixes) == "203.0.113.0/24" &&
      output.aks_ingress_nsg_rules[1].destination_port_range == "30080" &&
      output.aks_ingress_nsg_rules[2].name == "AllowVNetInbound" &&
      output.aks_ingress_nsg_rules[2].priority == 120 &&
      output.aks_ingress_nsg_rules[3].name == "DenyAllInbound" &&
      output.aks_ingress_nsg_rules[3].priority == 4096
    )
    error_message = "Public AKS ingress must emit exact provider-parity probe and NodePort rules."
  }
}

run "public_aks_ingress_rejects_priority_collision" {
  command = plan

  variables {
    location                               = "eastus2"
    resource_group_name                    = "rg-contoso-prod-networking"
    vnet_name                              = "vnet-contoso-prod"
    vnet_address_prefix                    = "10.0.0.0/16"
    aks_ingress_mode                       = "public-azure-load-balancer"
    aks_ingress_frontend_port              = 80
    aks_ingress_backend_node_port          = 30080
    aks_ingress_health_probe_source_prefix = "AzureLoadBalancer"
    aks_ingress_source_prefixes            = ["203.0.113.0/24"]
    aks_ingress_reserved_nsg_priorities    = [110]
  }

  expect_failures = [azurerm_network_security_group.aks]
}

run "public_aks_ingress_rejects_unproven_source" {
  command = plan

  variables {
    location                               = "eastus2"
    resource_group_name                    = "rg-contoso-prod-networking"
    vnet_name                              = "vnet-contoso-prod"
    vnet_address_prefix                    = "10.0.0.0/16"
    aks_ingress_mode                       = "public-azure-load-balancer"
    aks_ingress_frontend_port              = 80
    aks_ingress_backend_node_port          = 30080
    aks_ingress_health_probe_source_prefix = "AzureLoadBalancer"
    aks_ingress_source_prefixes            = ["unproven-source"]
  }

  expect_failures = [azurerm_network_security_group.aks]
}

run "public_aks_ingress_rejects_provider_mismatched_ipv6_source" {
  command = plan

  variables {
    location                               = "eastus2"
    resource_group_name                    = "rg-contoso-prod-networking"
    vnet_name                              = "vnet-contoso-prod"
    vnet_address_prefix                    = "10.0.0.0/16"
    aks_ingress_mode                       = "public-azure-load-balancer"
    aks_ingress_frontend_port              = 80
    aks_ingress_backend_node_port          = 30080
    aks_ingress_health_probe_source_prefix = "AzureLoadBalancer"
    aks_ingress_source_prefixes            = ["2001:db8::/32"]
  }

  expect_failures = [azurerm_network_security_group.aks]
}

run "public_aks_ingress_rejects_fractional_node_port" {
  command = plan

  variables {
    location                               = "eastus2"
    resource_group_name                    = "rg-contoso-prod-networking"
    vnet_name                              = "vnet-contoso-prod"
    vnet_address_prefix                    = "10.0.0.0/16"
    aks_ingress_mode                       = "public-azure-load-balancer"
    aks_ingress_frontend_port              = 80
    aks_ingress_backend_node_port          = 30080.5
    aks_ingress_health_probe_source_prefix = "AzureLoadBalancer"
    aks_ingress_source_prefixes            = ["203.0.113.0/24"]
  }

  expect_failures = [azurerm_network_security_group.aks]
}

run "public_aks_ingress_requires_health_probe" {
  command = plan

  variables {
    location                      = "eastus2"
    resource_group_name           = "rg-contoso-prod-networking"
    vnet_name                     = "vnet-contoso-prod"
    vnet_address_prefix           = "10.0.0.0/16"
    aks_ingress_mode              = "public-azure-load-balancer"
    aks_ingress_frontend_port     = 80
    aks_ingress_backend_node_port = 30080
    aks_ingress_source_prefixes   = ["203.0.113.0/24"]
  }

  expect_failures = [azurerm_network_security_group.aks]
}
