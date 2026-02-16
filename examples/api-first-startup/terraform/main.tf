# ==============================================================================
# API-First Startup Example — Terraform
# App Service + API Management (Consumption) + Cosmos DB + Redis + App Insights
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
  features {}
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

variable "apim_publisher_email" {
  description = "APIM publisher email"
  type        = string
}

variable "apim_publisher_name" {
  description = "APIM publisher name"
  type        = string
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}

locals {
  app_service_sku = var.environment == "prod" ? "P1v3" : "B1"

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

data "azurerm_client_config" "current" {}

# ==============================================================================
# Log Analytics + Application Insights
# ==============================================================================

resource "azurerm_log_analytics_workspace" "this" {
  name                = "law-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = local.tags
}

resource "azurerm_application_insights" "this" {
  name                = "ai-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  retention_in_days   = 90
  tags                = local.tags
}

# ==============================================================================
# App Service Plan + App
# ==============================================================================

resource "azurerm_service_plan" "this" {
  name                = "plan-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  os_type             = "Linux"
  sku_name            = local.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "this" {
  name                = "app-${var.app_name}-api-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  service_plan_id     = azurerm_service_plan.this.id
  https_only          = true
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on           = var.environment == "prod"
    ftps_state          = "Disabled"
    minimum_tls_version = "1.2"

    application_stack {
      node_version = "20-lts"
    }
  }

  app_settings = {
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.this.connection_string
    "COSMOS_ENDPOINT"                       = azurerm_cosmosdb_account.this.endpoint
  }
}

# Staging slot for zero-downtime deploys (prod only)
resource "azurerm_linux_web_app_slot" "staging" {
  count          = var.environment == "prod" ? 1 : 0
  name           = "staging"
  app_service_id = azurerm_linux_web_app.this.id
  https_only     = true
  tags           = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on           = false
    ftps_state          = "Disabled"
    minimum_tls_version = "1.2"

    application_stack {
      node_version = "20-lts"
    }
  }
}

# ==============================================================================
# API Management — Consumption tier
# ==============================================================================

resource "azurerm_api_management" "this" {
  name                = "apim-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  publisher_email     = var.apim_publisher_email
  publisher_name      = var.apim_publisher_name
  sku_name            = "Consumption_0"
  tags                = local.tags
}

# ==============================================================================
# Cosmos DB — Serverless (nonprod) or Autoscale (prod)
# ==============================================================================

resource "azurerm_cosmosdb_account" "this" {
  name                = "cosmos-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"
  minimal_tls_version = "Tls12"
  tags                = local.tags

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  dynamic "capabilities" {
    for_each = var.environment == "nonprod" ? ["EnableServerless"] : []
    content {
      name = capabilities.value
    }
  }
}

resource "azurerm_cosmosdb_sql_database" "this" {
  name                = var.app_name
  resource_group_name = data.azurerm_resource_group.this.name
  account_name        = azurerm_cosmosdb_account.this.name
}

resource "azurerm_cosmosdb_sql_container" "items" {
  name                = "items"
  resource_group_name = data.azurerm_resource_group.this.name
  account_name        = azurerm_cosmosdb_account.this.name
  database_name       = azurerm_cosmosdb_sql_database.this.name
  partition_key_paths = ["/tenantId"]

  dynamic "autoscale_settings" {
    for_each = var.environment == "prod" ? [1] : []
    content {
      max_throughput = 4000
    }
  }
}

# Grant App Service access to Cosmos DB (Cosmos DB Built-in Data Contributor)
resource "azurerm_cosmosdb_sql_role_assignment" "app_cosmos" {
  resource_group_name = data.azurerm_resource_group.this.name
  account_name        = azurerm_cosmosdb_account.this.name
  role_definition_id  = "${azurerm_cosmosdb_account.this.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_linux_web_app.this.identity[0].principal_id
  scope               = azurerm_cosmosdb_account.this.id
}

# ==============================================================================
# Redis — response caching
# ==============================================================================

resource "azurerm_redis_cache" "this" {
  name                 = "redis-${var.app_name}-${var.environment}"
  location             = var.location
  resource_group_name  = data.azurerm_resource_group.this.name
  capacity             = 0
  family               = "C"
  sku_name             = "Basic"
  non_ssl_port_enabled = false
  minimum_tls_version  = "1.2"
  tags                 = local.tags
}

# ==============================================================================
# Key Vault
# ==============================================================================

resource "azurerm_key_vault" "this" {
  name                       = "kv-${var.app_name}-${var.environment}"
  location                   = var.location
  resource_group_name        = data.azurerm_resource_group.this.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 30
  purge_protection_enabled   = false
  tags                       = local.tags

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }
}

# Grant App Service access to Key Vault secrets (Key Vault Secrets User)
resource "azurerm_role_assignment" "app_kv_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.this.identity[0].principal_id
}

# ==============================================================================
# Outputs
# ==============================================================================

output "app_url" {
  value = "https://${azurerm_linux_web_app.this.default_hostname}"
}

output "apim_gateway_url" {
  value = azurerm_api_management.this.gateway_url
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.this.endpoint
}

output "app_insights_connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}

output "redis_hostname" {
  value = azurerm_redis_cache.this.hostname
}
