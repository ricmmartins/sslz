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
    managedBy   = "terraform"
  }, var.tags)
}
