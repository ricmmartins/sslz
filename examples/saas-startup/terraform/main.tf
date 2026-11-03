# ==============================================================================
# SaaS Startup Example — Terraform
# Container Apps + Azure SQL Elastic Pool + Redis + Key Vault
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
  subscription_id = var.subscription_id
}

# ==============================================================================
# Data source for existing resource group
# ==============================================================================

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

locals {
  container_apps_subnet_segments_candidate   = split("/", var.container_apps_infrastructure_subnet_id)
  private_endpoint_subnet_segments_candidate = split("/", var.private_endpoint_subnet_id)
  container_apps_subnet_id_valid             = length(local.container_apps_subnet_segments_candidate) == 11
  private_endpoint_subnet_id_valid           = length(local.private_endpoint_subnet_segments_candidate) == 11
  container_apps_subnet_segments             = local.container_apps_subnet_id_valid ? local.container_apps_subnet_segments_candidate : ["", "subscriptions", var.subscription_id, "resourceGroups", "invalid", "providers", "Microsoft.Network", "virtualNetworks", "invalid", "subnets", "invalid"]
  private_endpoint_subnet_segments           = local.private_endpoint_subnet_id_valid ? local.private_endpoint_subnet_segments_candidate : ["", "subscriptions", var.subscription_id, "resourceGroups", "invalid", "providers", "Microsoft.Network", "virtualNetworks", "invalid", "subnets", "invalid"]
  private_network_resource_ids_valid = (
    local.container_apps_subnet_id_valid &&
    local.private_endpoint_subnet_id_valid &&
    var.vnet_id != "" &&
    try(split("/", lower(var.vnet_id))[2] == lower(var.subscription_id), false) &&
    startswith(lower(var.container_apps_infrastructure_subnet_id), "${lower(var.vnet_id)}/subnets/") &&
    startswith(lower(var.private_endpoint_subnet_id), "${lower(var.vnet_id)}/subnets/") &&
    lower(var.container_apps_infrastructure_subnet_id) != lower(var.private_endpoint_subnet_id)
  )
  safe_container_apps_subnet_id   = local.private_network_resource_ids_valid ? var.container_apps_infrastructure_subnet_id : "/subscriptions/${var.subscription_id}/resourceGroups/invalid/providers/Microsoft.Network/virtualNetworks/invalid/subnets/invalid-container-apps"
  safe_private_endpoint_subnet_id = local.private_network_resource_ids_valid ? var.private_endpoint_subnet_id : "/subscriptions/${var.subscription_id}/resourceGroups/invalid/providers/Microsoft.Network/virtualNetworks/invalid/subnets/invalid-private-endpoints"
  safe_vnet_id                    = local.private_network_resource_ids_valid ? var.vnet_id : "/subscriptions/${var.subscription_id}/resourceGroups/invalid/providers/Microsoft.Network/virtualNetworks/invalid"
}

data "azurerm_subnet" "container_apps" {
  count                = var.deploy_private_endpoints && local.container_apps_subnet_id_valid ? 1 : 0
  name                 = local.container_apps_subnet_segments[10]
  virtual_network_name = local.container_apps_subnet_segments[8]
  resource_group_name  = local.container_apps_subnet_segments[4]
}

data "azurerm_subnet" "private_endpoints" {
  count                = var.deploy_private_endpoints && local.private_endpoint_subnet_id_valid ? 1 : 0
  name                 = local.private_endpoint_subnet_segments[10]
  virtual_network_name = local.private_endpoint_subnet_segments[8]
  resource_group_name  = local.private_endpoint_subnet_segments[4]
}

locals {
  container_apps_subnet_prefixes   = var.deploy_private_endpoints && length(data.azurerm_subnet.container_apps) == 1 ? try(data.azurerm_subnet.container_apps[0].address_prefixes, []) : []
  private_endpoint_subnet_prefixes = var.deploy_private_endpoints && length(data.azurerm_subnet.private_endpoints) == 1 ? try(data.azurerm_subnet.private_endpoints[0].address_prefixes, []) : []
  container_apps_subnet_has_single_prefix = (
    local.container_apps_subnet_prefixes != null &&
    try(length(local.container_apps_subnet_prefixes) == 1, false)
  )
  private_endpoint_subnet_has_single_prefix = (
    local.private_endpoint_subnet_prefixes != null &&
    try(length(local.private_endpoint_subnet_prefixes) == 1, false)
  )
  container_apps_subnet_prefix     = local.container_apps_subnet_has_single_prefix ? one(local.container_apps_subnet_prefixes) : "10.0.0.0/32"
  private_endpoint_subnet_prefix   = local.private_endpoint_subnet_has_single_prefix ? one(local.private_endpoint_subnet_prefixes) : "10.0.1.0/32"
  container_apps_prefix_parts      = split("/", local.container_apps_subnet_prefix)
  private_endpoint_prefix_parts    = split("/", local.private_endpoint_subnet_prefix)
  container_apps_address_octets    = try([for octet in split(".", local.container_apps_prefix_parts[0]) : tonumber(octet)], [0, 0, 0, 0])
  private_endpoint_address_octets  = try([for octet in split(".", local.private_endpoint_prefix_parts[0]) : tonumber(octet)], [0, 0, 0, 0])
  container_apps_prefix_length     = try(tonumber(local.container_apps_prefix_parts[1]), 32)
  private_endpoint_prefix_length   = try(tonumber(local.private_endpoint_prefix_parts[1]), 32)
  container_apps_address_value     = local.container_apps_address_octets[0] * 16777216 + local.container_apps_address_octets[1] * 65536 + local.container_apps_address_octets[2] * 256 + local.container_apps_address_octets[3]
  private_endpoint_address_value   = local.private_endpoint_address_octets[0] * 16777216 + local.private_endpoint_address_octets[1] * 65536 + local.private_endpoint_address_octets[2] * 256 + local.private_endpoint_address_octets[3]
  container_apps_block_size        = pow(2, 32 - local.container_apps_prefix_length)
  private_endpoint_block_size      = pow(2, 32 - local.private_endpoint_prefix_length)
  container_apps_network_value     = floor(local.container_apps_address_value / local.container_apps_block_size) * local.container_apps_block_size
  private_endpoint_network_value   = floor(local.private_endpoint_address_value / local.private_endpoint_block_size) * local.private_endpoint_block_size
  container_apps_broadcast_value   = local.container_apps_network_value + local.container_apps_block_size - 1
  private_endpoint_broadcast_value = local.private_endpoint_network_value + local.private_endpoint_block_size - 1
  private_subnets_overlap = (
    local.container_apps_network_value <= local.private_endpoint_broadcast_value &&
    local.private_endpoint_network_value <= local.container_apps_broadcast_value
  )
  reserved_container_apps_cidrs = [
    "169.254.0.0/16",
    "172.30.0.0/16",
    "172.31.0.0/16",
    "192.0.2.0/24",
    "100.100.0.0/17",
    "100.100.128.0/19",
    "100.100.160.0/19",
    "100.100.192.0/19",
  ]
  reserved_container_apps_ranges = [
    for cidr in local.reserved_container_apps_cidrs : {
      network_value = sum([
        for index, octet in split(".", split("/", cidr)[0]) :
        tonumber(octet) * pow(256, 3 - index)
      ])
      broadcast_value = sum([
        for index, octet in split(".", split("/", cidr)[0]) :
        tonumber(octet) * pow(256, 3 - index)
      ]) + pow(2, 32 - tonumber(split("/", cidr)[1])) - 1
    }
  ]
  container_apps_subnet_overlaps_reserved_range = anytrue([
    for reserved in local.reserved_container_apps_ranges :
    local.container_apps_network_value <= reserved.broadcast_value &&
    reserved.network_value <= local.container_apps_broadcast_value
  ])
}

# ==============================================================================
# Log Analytics
# 30-day retention keeps costs low for startup workloads. Increase to 90 days
# for compliance or if you need longer investigative windows.
# ==============================================================================

resource "azurerm_log_analytics_workspace" "this" {
  name                = "law-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# ==============================================================================
# Container Apps Environment
# ==============================================================================

resource "azurerm_container_app_environment" "this" {
  name                       = "cae-${var.app_name}-${var.environment}"
  location                   = var.location
  resource_group_name        = data.azurerm_resource_group.this.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  infrastructure_subnet_id   = var.deploy_private_endpoints ? local.safe_container_apps_subnet_id : null
  tags                       = local.tags

  lifecycle {
    precondition {
      condition = !var.deploy_private_endpoints || (
        local.private_network_resource_ids_valid &&
        local.container_apps_subnet_has_single_prefix &&
        local.private_endpoint_subnet_has_single_prefix &&
        local.container_apps_prefix_length <= 27 &&
        !local.container_apps_subnet_overlaps_reserved_range &&
        !local.private_subnets_overlap
      )
      error_message = "Private endpoint mode requires a /27-or-larger Container Apps IPv4 subnet that avoids reserved ranges and does not overlap the Private Endpoint subnet. The subnet must also be dedicated and delegated to Microsoft.App/environments; Azure validates delegation when the environment is created."
    }
  }
}

# ==============================================================================
# Container App — API
# ==============================================================================

resource "azurerm_container_app" "api" {
  name                         = "ca-${var.app_name}-api"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = data.azurerm_resource_group.this.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type = "SystemAssigned"
  }

  ingress {
    external_enabled = true
    target_port      = 80
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    # Allow requests from the web frontend (matches Bicep corsPolicy)
    cors {
      allowed_origins = ["https://ca-${var.app_name}-web.${azurerm_container_app_environment.this.default_domain}"]
    }
  }

  template {
    min_replicas = var.environment == "prod" ? 1 : 0
    max_replicas = 10

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.5
      memory = "1Gi"
    }

    http_scale_rule {
      name                = "http-scaling"
      concurrent_requests = "10"
    }
  }
}

# ==============================================================================
# Container App — Web
# ==============================================================================

resource "azurerm_container_app" "web" {
  name                         = "ca-${var.app_name}-web"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = data.azurerm_resource_group.this.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type = "SystemAssigned"
  }

  ingress {
    external_enabled = true
    target_port      = 80
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.environment == "prod" ? 1 : 0
    max_replicas = 5

    container {
      name   = "web"
      image  = var.web_image
      cpu    = 0.25
      memory = "0.5Gi"
    }
  }
}

# ==============================================================================
# Azure SQL — Elastic Pool
# ==============================================================================

resource "azurerm_mssql_server" "this" {
  name                          = "sql-${var.app_name}-${var.environment}"
  location                      = var.location
  resource_group_name           = data.azurerm_resource_group.this.name
  version                       = "12.0"
  administrator_login           = var.sql_admin_login
  administrator_login_password  = var.sql_admin_password
  minimum_tls_version           = "1.2"
  public_network_access_enabled = !var.deploy_private_endpoints
  tags                          = local.tags
}

# Allow Azure services to reach SQL when not using Private Endpoints
resource "azurerm_mssql_firewall_rule" "allow_azure" {
  count            = var.deploy_private_endpoints ? 0 : 1
  name             = "AllowAllAzureIps"
  server_id        = azurerm_mssql_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_elasticpool" "this" {
  name                = "pool-${var.app_name}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  server_name         = azurerm_mssql_server.this.name
  tags                = local.tags

  sku {
    name     = "StandardPool"
    tier     = "Standard"
    capacity = 100
  }

  per_database_settings {
    min_capacity = 0
    max_capacity = 100
  }
}

resource "azurerm_mssql_database" "app" {
  name            = "db-${var.app_name}"
  server_id       = azurerm_mssql_server.this.id
  elastic_pool_id = azurerm_mssql_elasticpool.this.id
  tags            = local.tags
}

# ==============================================================================
# Azure Cache for Redis
# ==============================================================================

resource "azurerm_redis_cache" "this" {
  name                          = "redis-${var.app_name}-${var.environment}"
  location                      = var.location
  resource_group_name           = data.azurerm_resource_group.this.name
  capacity                      = var.environment == "prod" ? 1 : 0
  family                        = "C"
  sku_name                      = var.environment == "prod" ? "Standard" : "Basic"
  non_ssl_port_enabled          = false
  minimum_tls_version           = "1.2"
  public_network_access_enabled = !var.deploy_private_endpoints
  tags                          = local.tags
}

# ==============================================================================
# Key Vault
# ==============================================================================

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                       = "kv-${var.app_name}-${var.environment}"
  location                   = var.location
  resource_group_name        = data.azurerm_resource_group.this.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 90
  purge_protection_enabled   = var.environment == "prod"
  tags                       = local.tags

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }
}

# Grant API app access to Key Vault secrets (Key Vault Secrets User)
resource "azurerm_role_assignment" "api_kv_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_container_app.api.identity[0].principal_id
}

# ==============================================================================
# Diagnostic Settings — send audit logs to Log Analytics
# ==============================================================================

resource "azurerm_monitor_diagnostic_setting" "sql" {
  name                       = "diag-sql"
  target_resource_id         = azurerm_mssql_database.app.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category = "SQLSecurityAuditEvents"
  }
}

resource "azurerm_monitor_diagnostic_setting" "redis" {
  name                       = "diag-redis"
  target_resource_id         = azurerm_redis_cache.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

resource "azurerm_monitor_diagnostic_setting" "kv" {
  name                       = "diag-kv"
  target_resource_id         = azurerm_key_vault.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category = "AuditEvent"
  }
}

# ==============================================================================
# Resource Locks (prod only)
# ==============================================================================

resource "azurerm_management_lock" "kv" {
  count      = var.environment == "prod" ? 1 : 0
  name       = "protect-kv"
  scope      = azurerm_key_vault.this.id
  lock_level = "CanNotDelete"
  notes      = "Protects Key Vault from accidental deletion"
}

resource "azurerm_management_lock" "sql" {
  count      = var.environment == "prod" ? 1 : 0
  name       = "protect-sql"
  scope      = azurerm_mssql_server.this.id
  lock_level = "CanNotDelete"
  notes      = "Protects SQL Server from accidental deletion"
}

# ==============================================================================
# Private Endpoints (opt-in)
# ==============================================================================

resource "azurerm_private_dns_zone" "sql" {
  count               = var.deploy_private_endpoints ? 1 : 0
  name                = "privatelink.database.windows.net"
  resource_group_name = data.azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "sql" {
  count                 = var.deploy_private_endpoints ? 1 : 0
  name                  = "link-sql"
  resource_group_name   = data.azurerm_resource_group.this.name
  private_dns_zone_name = azurerm_private_dns_zone.sql[0].name
  virtual_network_id    = local.safe_vnet_id
}

resource "azurerm_private_endpoint" "sql" {
  count               = var.deploy_private_endpoints ? 1 : 0
  name                = "pe-${azurerm_mssql_server.this.name}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  subnet_id           = local.safe_private_endpoint_subnet_id
  tags                = local.tags

  private_service_connection {
    name                           = "plsc-sql"
    private_connection_resource_id = azurerm_mssql_server.this.id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.sql[0].id]
  }
}

resource "azurerm_private_dns_zone" "redis" {
  count               = var.deploy_private_endpoints ? 1 : 0
  name                = "privatelink.redis.cache.windows.net"
  resource_group_name = data.azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "redis" {
  count                 = var.deploy_private_endpoints ? 1 : 0
  name                  = "link-redis"
  resource_group_name   = data.azurerm_resource_group.this.name
  private_dns_zone_name = azurerm_private_dns_zone.redis[0].name
  virtual_network_id    = local.safe_vnet_id
}

resource "azurerm_private_endpoint" "redis" {
  count               = var.deploy_private_endpoints ? 1 : 0
  name                = "pe-${azurerm_redis_cache.this.name}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  subnet_id           = local.safe_private_endpoint_subnet_id
  tags                = local.tags

  private_service_connection {
    name                           = "plsc-redis"
    private_connection_resource_id = azurerm_redis_cache.this.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis[0].id]
  }
}
