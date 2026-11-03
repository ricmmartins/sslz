mock_provider "azurerm" {}

variables {
  subscription_id = "33333333-3333-3333-3333-333333333333"
  location        = "westus2"
  company_name    = "contoso"
}

run "disjoint_cidrs_pass" {
  command = plan

  variables {
    primary_vnet_address_prefix   = "10.0.0.0/16"
    secondary_vnet_address_prefix = "10.1.0.0/16"
  }
}

run "equal_cidrs_fail" {
  command = plan

  variables {
    primary_vnet_address_prefix   = "10.0.0.0/16"
    secondary_vnet_address_prefix = "10.0.0.0/16"
  }

  expect_failures = [var.secondary_vnet_address_prefix]
}

run "partial_overlap_fails" {
  command = plan

  variables {
    primary_vnet_address_prefix   = "10.0.0.0/16"
    secondary_vnet_address_prefix = "10.0.128.0/17"
  }

  expect_failures = [azurerm_resource_group.networking]
}

run "ipv6_fails" {
  command = plan

  variables {
    primary_vnet_address_prefix   = "fdad:3236:5555::/48"
    secondary_vnet_address_prefix = "10.1.0.0/16"
  }

  expect_failures = [var.primary_vnet_address_prefix]
}

run "malformed_cidr_fails" {
  command = plan

  variables {
    primary_vnet_address_prefix   = "not-a-cidr"
    secondary_vnet_address_prefix = "10.1.0.0/16"
  }

  expect_failures = [var.primary_vnet_address_prefix]
}
