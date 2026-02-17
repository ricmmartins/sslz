# ==============================================================================
# Management Groups
# Deploy separately with: terraform apply -target=module.management_groups
# Requires tenant-level permissions
# ==============================================================================

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
}
variable "nonprod_subscription_id" {
  description = "Non-production subscription ID to place under this management group"
  type        = string
}

locals {
  display_name = var.display_name != "" ? var.display_name : "${var.company_name} Landing Zone"
}

resource "azurerm_management_group" "this" {
  name         = "mg-${var.company_name}"
  display_name = local.display_name

  subscription_ids = [
    var.prod_subscription_id,
    var.nonprod_subscription_id,
  ]
}

output "management_group_id" { value = azurerm_management_group.this.id }
output "management_group_name" { value = azurerm_management_group.this.name }
