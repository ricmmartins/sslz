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
variable "aks_ingress_mode" {
  description = "Explicit AKS ingress mode"
  type        = string
  default     = "not-applicable"
  validation {
    condition     = contains(["not-applicable", "private", "public-azure-load-balancer"], var.aks_ingress_mode)
    error_message = "aks_ingress_mode must be not-applicable, private, or public-azure-load-balancer."
  }
}
variable "aks_ingress_frontend_port" {
  description = "Reviewed public frontend port; zero when not applicable"
  type        = number
  default     = 0
}
variable "aks_ingress_backend_node_port" {
  description = "Exact AKS backend NodePort; zero when not applicable"
  type        = number
  default     = 0
}
variable "aks_ingress_health_probe_source_prefix" {
  description = "Azure Load Balancer health probe service tag; empty when public ingress is not selected"
  type        = string
  default     = ""
}
variable "aks_ingress_source_prefixes" {
  description = "Reviewed public client source prefixes for the exact NodePort"
  type        = list(string)
  default     = []
}
variable "aks_ingress_reserved_nsg_priorities" {
  description = "Existing AKS NSG priorities that generated rules must not collide with"
  type        = list(number)
  default     = []
}
variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
