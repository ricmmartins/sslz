variable "subscription_id" {
  description = "Nonproduction Azure subscription ID"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid lowercase UUID."
  }
}

variable "resource_provider_registrations" {
  description = "Automatic provider registration is disabled for reviewed plans"
  type        = string
  default     = "none"
  validation {
    condition     = var.resource_provider_registrations == "none"
    error_message = "The cool foundation cannot register providers automatically."
  }
}

variable "resource_providers_to_register" {
  description = "Additional automatic provider registrations are prohibited"
  type        = list(string)
  default     = []
  validation {
    condition     = length(var.resource_providers_to_register) == 0
    error_message = "The cool foundation cannot request provider registration."
  }
}

variable "location" {
  description = "Secondary Azure region"
  type        = string
  validation {
    condition     = can(regex("^[a-z]+[a-z0-9]*$", var.location))
    error_message = "location must be a normalized Azure region name."
  }
}

variable "company_name" {
  description = "Company name used for deterministic resource naming"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,9}$", var.company_name))
    error_message = "company_name must be 2-10 lowercase alphanumeric characters."
  }
}

variable "environment" {
  description = "The cool foundation is restricted to nonproduction"
  type        = string
  default     = "nonprod"
  validation {
    condition     = var.environment == "nonprod"
    error_message = "cool-infrastructure is planning-only for nonprod."
  }
}

variable "primary_vnet_address_prefix" {
  description = "Primary VNet CIDR retained for isolation review"
  type        = string
  validation {
    condition     = can(cidrnetmask(var.primary_vnet_address_prefix))
    error_message = "primary_vnet_address_prefix must be a valid IPv4 CIDR."
  }
}

variable "secondary_vnet_address_prefix" {
  description = "Non-overlapping secondary VNet CIDR"
  type        = string
  validation {
    condition = (
      can(cidrnetmask(var.secondary_vnet_address_prefix)) &&
      var.secondary_vnet_address_prefix != var.primary_vnet_address_prefix
    )
    error_message = "secondary_vnet_address_prefix must be a valid IPv4 CIDR and differ from the primary CIDR."
  }
}

variable "app_subnet_delegation" {
  description = "Service delegation retained for later profile-specific modules"
  type        = string
  default     = "Microsoft.Web/serverFarms"
}

variable "log_retention_in_days" {
  description = "Log Analytics workspace retention"
  type        = number
  default     = 90
  validation {
    condition     = var.log_retention_in_days >= 30 && var.log_retention_in_days <= 730
    error_message = "log_retention_in_days must be between 30 and 730."
  }
}

variable "log_daily_quota_gb" {
  description = "Log Analytics daily ingestion quota"
  type        = number
  default     = 5
  validation {
    condition     = var.log_daily_quota_gb == -1 || var.log_daily_quota_gb >= 1
    error_message = "log_daily_quota_gb must be -1 or at least 1."
  }
}

variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}
