variable "subscription_id" {
  description = "Azure subscription ID to deploy into"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid UUID."
  }
}

variable "resource_provider_registrations" {
  description = "AzureRM automatic resource provider registration mode. Manual deployments preserve the AzureRM v4 legacy behavior; approved agent plans set none."
  type        = string
  default     = "legacy"
  validation {
    condition     = contains(["core", "extended", "all", "legacy", "none"], var.resource_provider_registrations)
    error_message = "resource_provider_registrations must be core, extended, all, legacy, or none."
  }
}

variable "resource_providers_to_register" {
  description = "Additional Azure resource providers to register automatically. Approved agent plans require an empty list."
  type        = list(string)
  default     = []
}

variable "location" {
  description = "Primary Azure region"
  type        = string
  default     = "eastus2"
  validation {
    condition     = can(regex("^[a-z]+[a-z0-9]*$", var.location))
    error_message = "location must be a valid Azure region name (e.g., eastus2, westeurope)."
  }
}

variable "company_name" {
  description = "Company name used in resource naming (2-20 lowercase alphanumeric characters)"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,19}$", var.company_name))
    error_message = "company_name must be 2-20 lowercase alphanumeric characters, starting with a letter."
  }
}

variable "environment" {
  description = "Environment: prod or nonprod"
  type        = string
  validation {
    condition     = contains(["prod", "nonprod"], var.environment)
    error_message = "Environment must be 'prod' or 'nonprod'."
  }
}

variable "prefix" {
  description = "Resource naming prefix (defaults to company_name-environment)"
  type        = string
  default     = ""
}

variable "deploy_networking" {
  description = "Deploy VNet and networking resources"
  type        = bool
  default     = true
}

variable "log_retention_in_days" {
  description = "Log Analytics workspace retention in days"
  type        = number
  default     = 90
  validation {
    condition     = var.log_retention_in_days >= 30 && var.log_retention_in_days <= 730
    error_message = "log_retention_in_days must be between 30 and 730."
  }
}

variable "log_daily_quota_gb" {
  description = "Log Analytics daily ingestion quota in GB (-1 = unlimited)"
  type        = number
  default     = 5
}

variable "log_analytics_workspace_location" {
  description = "Explicit effective Log Analytics workspace region"
  type        = string
  default     = ""
}

variable "existing_log_analytics_workspace_id" {
  description = "Approved existing Log Analytics workspace resource ID; empty creates the deterministic regional workspace"
  type        = string
  default     = ""
}

variable "configure_defender_workspace" {
  description = "Bind Defender for Servers to the explicit workspace"
  type        = bool
  default     = null
}

variable "defender_workspace_association_managed_externally" {
  description = "Use the approved workspace association owned by another environment artifact in the same subscription"
  type        = bool
  default     = false
}

variable "defender_workspace_shared_subscription" {
  description = "Whether prod and nonprod share one subscription and must reuse one approved existing Defender workspace"
  type        = bool
  default     = false
}

variable "vnet_address_prefix" {
  description = "VNet address prefix (overrides default per-environment prefix)"
  type        = string
  default     = ""
  validation {
    condition     = var.vnet_address_prefix == "" || can(cidrhost(var.vnet_address_prefix, 0))
    error_message = "vnet_address_prefix must be a valid CIDR block (e.g., 10.0.0.0/16) or empty for the default."
  }
}

variable "app_subnet_delegation" {
  description = "Service delegation for the app subnet (e.g., Microsoft.Web/serverFarms for App Service, Microsoft.App/environments for Container Apps)"
  type        = string
  default     = "Microsoft.Web/serverFarms"
}

variable "monthly_budget_amount" {
  description = "Monthly budget amount in USD"
  type        = number
  default     = 5000
}

variable "budget_alert_emails" {
  description = "Email addresses for budget alerts"
  type        = list(string)
  default     = ["platform@example.com"]
  validation {
    condition     = length(var.budget_alert_emails) > 0
    error_message = "budget_alert_emails must contain at least one email address."
  }
}

variable "budget_start_date" {
  description = "Budget start date in ISO 8601 format (e.g., 2026-03-01T00:00:00Z). Must be the first of a month. Defaults to the 1st of the current month."
  type        = string
  default     = ""
  validation {
    condition     = var.budget_start_date == "" || can(regex("^\\d{4}-\\d{2}-01T00:00:00Z$", var.budget_start_date))
    error_message = "budget_start_date must be the first of a month in ISO 8601 format (e.g., 2026-03-01T00:00:00Z)."
  }
}

variable "security_contact_email" {
  description = "Email address for Defender for Cloud security alerts"
  type        = string
  default     = "security@example.com"
  validation {
    condition     = can(regex("^[^@]+@[^@]+\\.[^@]+$", var.security_contact_email))
    error_message = "security_contact_email must be a valid email address."
  }
}

variable "enable_defender_for_servers" {
  description = "Enable Defender for Servers P2 (recommended for prod)"
  type        = bool
  default     = null
}

variable "enable_defender_for_containers" {
  description = "Enable Defender for Containers (recommended if running AKS)"
  type        = bool
  default     = false
}

variable "enable_defender_for_databases" {
  description = "Enable Defender for Databases (recommended for prod)"
  type        = bool
  default     = null
}

variable "enable_defender_for_key_vault" {
  description = "Enable Defender for Key Vault (recommended, low cost)"
  type        = bool
  default     = true
}

variable "allowed_locations" {
  description = "Allowed Azure regions for resource deployment (defaults to the primary location)"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}

locals {
  prefix = var.prefix != "" ? var.prefix : "${var.company_name}-${var.environment}"

  # Defender defaults: enable Servers and Databases for prod (matches Bicep behavior)
  enable_defender_for_servers   = var.enable_defender_for_servers != null ? var.enable_defender_for_servers : var.environment == "prod"
  enable_defender_for_databases = var.enable_defender_for_databases != null ? var.enable_defender_for_databases : var.environment == "prod"

  budget_start_date = var.budget_start_date != "" ? var.budget_start_date : formatdate("YYYY-MM-01'T'00:00:00Z", plantimestamp())

  # Allowed locations: defaults to [var.location] to match Bicep's [location] behavior
  allowed_locations = length(var.allowed_locations) > 0 ? var.allowed_locations : [var.location]

  log_analytics_workspace_location       = var.log_analytics_workspace_location != "" ? var.log_analytics_workspace_location : var.location
  create_log_analytics_workspace         = var.existing_log_analytics_workspace_id == ""
  configure_defender_workspace           = var.configure_defender_workspace != null ? var.configure_defender_workspace : local.enable_defender_for_servers
  existing_workspace_reference_valid     = can(regex("(?i)^/subscriptions/[0-9a-f-]{36}/resourceGroups/[^/]+/providers/Microsoft\\.OperationalInsights/workspaces/[^/]+$", var.existing_log_analytics_workspace_id))
  safe_existing_workspace_id             = local.existing_workspace_reference_valid ? var.existing_log_analytics_workspace_id : "/subscriptions/${var.subscription_id}/resourceGroups/invalid/providers/Microsoft.OperationalInsights/workspaces/invalid"
  effective_log_analytics_workspace_id   = local.create_log_analytics_workspace ? module.log_analytics[0].workspace_id : local.safe_existing_workspace_id
  effective_log_analytics_workspace_name = local.create_log_analytics_workspace ? module.log_analytics[0].workspace_name : element(reverse(split("/", local.safe_existing_workspace_id)), 0)
  effective_monitoring_resource_group    = local.create_log_analytics_workspace ? azurerm_resource_group.monitoring[0].name : split("/", local.safe_existing_workspace_id)[4]

  vnet_address_prefix = var.vnet_address_prefix != "" ? var.vnet_address_prefix : (var.environment == "prod" ? "10.0.0.0/16" : "10.1.0.0/16")

  default_tags = {
    environment = var.environment
    managedBy   = "terraform"
    project     = "landing-zone"
    team        = "platform"
  }

  tags = merge(local.default_tags, var.tags)
}
