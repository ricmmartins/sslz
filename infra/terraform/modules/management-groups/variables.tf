variable "subscription_id" {
  description = "Azure subscription ID (required by the azurerm provider for authentication, even though management groups are tenant-level resources)"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a valid UUID."
  }
}

variable "company_name" {
  description = "Company name used in management group naming"
  type        = string
}
variable "display_name" {
  description = "Management group display name (defaults to '<company_name> Landing Zone')"
  type        = string
  default     = ""
}
variable "prod_subscription_id" {
  description = "Production subscription ID to place under this management group"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.prod_subscription_id))
    error_message = "prod_subscription_id must be a valid UUID."
  }
}
variable "nonprod_subscription_id" {
  description = "Non-production subscription ID to place under this management group"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.nonprod_subscription_id))
    error_message = "nonprod_subscription_id must be a valid UUID."
  }
}
