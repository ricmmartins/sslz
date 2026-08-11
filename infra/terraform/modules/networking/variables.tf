variable "location" {
  description = "Azure region"
  type        = string
}
variable "resource_group_name" {
  description = "Resource group name"
  type        = string
}
variable "vnet_name" {
  description = "Virtual network name"
  type        = string
}
variable "vnet_address_prefix" {
  description = "VNet address prefix (e.g., 10.0.0.0/16)"
  type        = string
}
variable "app_subnet_delegation" {
  description = "Service delegation for the app subnet (e.g., Microsoft.Web/serverFarms for App Service, Microsoft.App/environments for Container Apps)"
  type        = string
  default     = "Microsoft.Web/serverFarms"
}
variable "include_container_apps_subnet" {
  description = "Include the dedicated nonproduction Container Apps cool-profile subnet"
  type        = bool
  default     = false
}
variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
