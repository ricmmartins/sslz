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
