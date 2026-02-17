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
# Variables
# ==============================================================================

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to deploy into"
  type        = string
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus2"
}

variable "app_name" {
  description = "Application name prefix"
  type        = string
}

variable "environment" {
  description = "Environment: prod or nonprod"
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["prod", "nonprod"], var.environment)
    error_message = "Environment must be 'prod' or 'nonprod'."
  }
}

variable "api_image" {
  description = "Container image for the API"
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "web_image" {
  description = "Container image for the web frontend"
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "sql_admin_login" {
  description = "SQL administrator login name"
  type        = string
  default     = "sqladmin"
}

variable "sql_admin_password" {
  description = "SQL administrator password"
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}

locals {
  tags = merge({
    environment = var.environment
    team        = "engineering"
    project     = var.app_name
  }, var.tags)
}

# ==============================================================================
# Data source for existing resource group
# ==============================================================================

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

# ==============================================================================
# Log Analytics
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
  tags                       = local.tags
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
    transport        = "http"

    traffic_weight {
      latest_revision = true
      percentage      = 100
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

  ingress {
    external_enabled = true
    target_port      = 80
    transport        = "http"

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
  public_network_access_enabled = false
  tags                          = local.tags
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
  name                 = "redis-${var.app_name}-${var.environment}"
  location             = var.location
  resource_group_name  = data.azurerm_resource_group.this.name
  capacity             = 0
  family               = "C"
  sku_name             = var.environment == "prod" ? "Standard" : "Basic"
  non_ssl_port_enabled = false
  minimum_tls_version  = "1.2"
  tags                 = local.tags
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
  soft_delete_retention_days = 30
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
# Outputs
# ==============================================================================

output "api_url" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "web_url" {
  value = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}

output "sql_server_fqdn" {
  value = azurerm_mssql_server.this.fully_qualified_domain_name
}

output "redis_hostname" {
  value = azurerm_redis_cache.this.hostname
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}
