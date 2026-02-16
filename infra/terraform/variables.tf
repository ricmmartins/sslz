variable "subscription_id" {
  description = "Azure subscription ID to deploy into"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid UUID."
  }
}

variable "location" {
  description = "Primary Azure region"
  type        = string
  default     = "eastus2"
}

variable "company_name" {
  description = "Company name used in resource naming"
  type        = string
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

variable "monthly_budget_amount" {
  description = "Monthly budget amount in USD"
  type        = number
  default     = 5000
}

variable "budget_alert_emails" {
  description = "Email addresses for budget alerts"
  type        = list(string)
}

variable "budget_start_date" {
  description = "Budget start date in ISO 8601 format (e.g., 2026-03-01T00:00:00Z). Must be the first of a month."
  type        = string
  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-01T00:00:00Z$", var.budget_start_date))
    error_message = "budget_start_date must be the first of a month in ISO 8601 format (e.g., 2026-03-01T00:00:00Z)."
  }
}

variable "security_contact_email" {
  description = "Email address for Defender for Cloud security alerts"
  type        = string
}

variable "enable_defender_for_servers" {
  description = "Enable Defender for Servers P2"
  type        = bool
  default     = false
}

variable "enable_defender_for_containers" {
  description = "Enable Defender for Containers"
  type        = bool
  default     = false
}

variable "enable_defender_for_databases" {
  description = "Enable Defender for Databases"
  type        = bool
  default     = false
}

variable "enable_defender_for_key_vault" {
  description = "Enable Defender for Key Vault (recommended, low cost)"
  type        = bool
  default     = true
}

variable "allowed_locations" {
  description = "Allowed Azure regions for resource deployment"
  type        = list(string)
  default     = ["eastus2", "centralus"]
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}

locals {
  prefix = var.prefix != "" ? var.prefix : "${var.company_name}-${var.environment}"

  default_tags = {
    environment = var.environment
    managedBy   = "terraform"
    project     = "landing-zone"
  }

  tags = merge(local.default_tags, var.tags)
}
