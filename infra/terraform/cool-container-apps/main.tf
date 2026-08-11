terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "yourStorageAccount"
    container_name       = "tfstate"
    key                  = "cool-container-apps.tfstate"
    use_oidc             = true
  }
}

provider "azurerm" {
  resource_provider_registrations = var.resource_provider_registrations
  resource_providers_to_register  = var.resource_providers_to_register
  subscription_id                 = var.subscription_id

  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

locals {
  secret_names              = toset([for secret in var.secret_references : secret.name])
  primary_address_octets    = try([for octet in split(".", split("/", var.primary_vnet_cidr)[0]) : tonumber(octet)], [0, 0, 0, 0])
  secondary_address_octets  = try([for octet in split(".", split("/", var.secondary_vnet_cidr)[0]) : tonumber(octet)], [0, 0, 0, 0])
  primary_prefix_length     = try(tonumber(split("/", var.primary_vnet_cidr)[1]), 0)
  secondary_prefix_length   = try(tonumber(split("/", var.secondary_vnet_cidr)[1]), 0)
  primary_address_value     = local.primary_address_octets[0] * 16777216 + local.primary_address_octets[1] * 65536 + local.primary_address_octets[2] * 256 + local.primary_address_octets[3]
  secondary_address_value   = local.secondary_address_octets[0] * 16777216 + local.secondary_address_octets[1] * 65536 + local.secondary_address_octets[2] * 256 + local.secondary_address_octets[3]
  primary_block_size        = pow(2, 32 - local.primary_prefix_length)
  secondary_block_size      = pow(2, 32 - local.secondary_prefix_length)
  primary_network_value     = floor(local.primary_address_value / local.primary_block_size) * local.primary_block_size
  secondary_network_value   = floor(local.secondary_address_value / local.secondary_block_size) * local.secondary_block_size
  primary_broadcast_value   = local.primary_network_value + local.primary_block_size - 1
  secondary_broadcast_value = local.secondary_network_value + local.secondary_block_size - 1
  address_spaces_overlap = (
    local.primary_network_value <= local.secondary_broadcast_value &&
    local.secondary_network_value <= local.primary_broadcast_value
  )
  tags = merge({
    environment    = "nonprod"
    managedBy      = "terraform"
    profile        = "container-apps"
    regionalRole   = "secondary"
    deploymentMode = "cool-container-apps"
  }, var.tags)
}

resource "azurerm_resource_group" "profile" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags

  lifecycle {
    precondition {
      condition = (
        strcontains(lower(var.resource_group_name), "-nonprod-cool-") &&
        !strcontains(lower(var.resource_group_name), "-primary")
      )
      error_message = "resource_group_name must be an isolated nonproduction secondary cool scope."
    }

    precondition {
      condition     = var.primary_scope != var.secondary_scope
      error_message = "primary_scope and secondary_scope must be isolated."
    }

    precondition {
      condition     = !local.address_spaces_overlap
      error_message = "primary_vnet_cidr and secondary_vnet_cidr must not overlap."
    }
  }
}

resource "azurerm_role_assignment" "key_vault_secret_access" {
  name               = uuidv5("url", "${var.key_vault_resource_id}/${var.managed_identity_principal_id}/${var.key_vault_role_definition_id}")
  scope              = var.key_vault_resource_id
  role_definition_id = var.key_vault_role_definition_id
  principal_id       = var.managed_identity_principal_id
  principal_type     = "ServicePrincipal"
}

resource "azurerm_container_app_environment" "profile" {
  name                           = var.managed_environment_name
  location                       = azurerm_resource_group.profile.location
  resource_group_name            = azurerm_resource_group.profile.name
  infrastructure_subnet_id       = var.infrastructure_subnet_resource_id
  internal_load_balancer_enabled = true
  tags                           = local.tags
}

resource "azurerm_container_app" "profile" {
  name                         = var.container_app_name
  container_app_environment_id = azurerm_container_app_environment.profile.id
  resource_group_name          = azurerm_resource_group.profile.name
  revision_mode                = var.revision_mode
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.managed_identity_resource_id]
  }

  dynamic "secret" {
    for_each = { for item in var.secret_references : item.name => item }
    content {
      name                = secret.value.name
      identity            = secret.value.identity_resource_id
      key_vault_secret_id = secret.value.key_vault_secret_uri
    }
  }

  ingress {
    external_enabled = false
    target_port      = var.target_port
    transport        = var.transport

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = var.container_app_name
      image  = var.image
      cpu    = var.cpu
      memory = var.memory

      dynamic "env" {
        for_each = { for item in var.secret_environment_variables : item.name => item }
        content {
          name        = env.value.name
          secret_name = env.value.secret_ref
        }
      }

      dynamic "startup_probe" {
        for_each = [for probe in var.probes : probe if probe.type == "Startup"]
        content {
          transport               = startup_probe.value.transport
          path                    = startup_probe.value.path
          port                    = startup_probe.value.port
          initial_delay           = startup_probe.value.initial_delay_seconds
          interval_seconds        = startup_probe.value.interval_seconds
          timeout                 = startup_probe.value.timeout_seconds
          failure_count_threshold = startup_probe.value.failure_threshold
        }
      }

      dynamic "readiness_probe" {
        for_each = [for probe in var.probes : probe if probe.type == "Readiness"]
        content {
          transport               = readiness_probe.value.transport
          path                    = readiness_probe.value.path
          port                    = readiness_probe.value.port
          initial_delay           = readiness_probe.value.initial_delay_seconds
          interval_seconds        = readiness_probe.value.interval_seconds
          timeout                 = readiness_probe.value.timeout_seconds
          failure_count_threshold = readiness_probe.value.failure_threshold
        }
      }

      dynamic "liveness_probe" {
        for_each = [for probe in var.probes : probe if probe.type == "Liveness"]
        content {
          transport               = liveness_probe.value.transport
          path                    = liveness_probe.value.path
          port                    = liveness_probe.value.port
          initial_delay           = liveness_probe.value.initial_delay_seconds
          interval_seconds        = liveness_probe.value.interval_seconds
          timeout                 = liveness_probe.value.timeout_seconds
          failure_count_threshold = liveness_probe.value.failure_threshold
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition = (
        strcontains(var.image, "@sha256:") &&
        !strcontains(lower(var.image), ":latest")
      )
      error_message = "image must be an immutable digest reference and cannot use a mutable tag."
    }

    precondition {
      condition = alltrue([
        for secret in var.secret_references :
        secret.identity_resource_id == var.managed_identity_resource_id
      ])
      error_message = "Every secret reference must use the bound managed identity."
    }

    precondition {
      condition = alltrue([
        for item in var.secret_environment_variables :
        contains(local.secret_names, item.secret_ref)
      ])
      error_message = "Every secret environment variable must reference a declared secret."
    }

    precondition {
      condition = (
        length(var.probes) == 3 &&
        toset([for probe in var.probes : probe.type]) == toset(["Startup", "Readiness", "Liveness"]) &&
        alltrue([for probe in var.probes : probe.port == var.target_port])
      )
      error_message = "Exactly one Startup, Readiness, and Liveness probe must target the container port."
    }
  }

  depends_on = [azurerm_role_assignment.key_vault_secret_access]
}

resource "azurerm_monitor_diagnostic_setting" "profile" {
  name                       = var.diagnostic_setting_name
  target_resource_id         = azurerm_container_app_environment.profile.id
  log_analytics_workspace_id = var.log_analytics_workspace_resource_id

  enabled_log {
    category = "ContainerAppConsoleLogs"
  }

  enabled_log {
    category = "ContainerAppSystemLogs"
  }
}
