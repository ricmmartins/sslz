# ==============================================================================
# Variables
# ==============================================================================

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid UUID."
  }
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
  description = "Application name prefix (lowercase alphanumeric, max 12 chars to fit resource naming limits)"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,11}$", var.app_name))
    error_message = "app_name must be 2-12 lowercase alphanumeric characters, starting with a letter."
  }
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
  description = "SQL administrator login name (avoid common names like 'admin' or 'sa')"
  type        = string
  validation {
    condition     = !contains(["admin", "administrator", "sa", "root"], lower(var.sql_admin_login))
    error_message = "sql_admin_login must not be a commonly guessed name (admin, administrator, sa, root)."
  }
}

variable "sql_admin_password" {
  description = "SQL administrator password"
  type        = string
  sensitive   = true
}

variable "deploy_private_endpoints" {
  description = "Deploy Private Endpoints for SQL and Redis (requires VNet with data subnet)"
  type        = bool
  default     = false
}

variable "private_endpoint_subnet_id" {
  description = "Subnet resource ID for Private Endpoints (required when deploy_private_endpoints is true)"
  type        = string
  default     = ""
}

variable "vnet_id" {
  description = "VNet resource ID for Private DNS Zone links (required when deploy_private_endpoints is true)"
  type        = string
  default     = ""
}

check "private_endpoint_config" {
  assert {
    condition     = !var.deploy_private_endpoints || (var.private_endpoint_subnet_id != "" && var.vnet_id != "")
    error_message = "private_endpoint_subnet_id and vnet_id are required when deploy_private_endpoints is true."
  }
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
