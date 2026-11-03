variable "location" {
  description = "Primary Azure region"
  type        = string
}
variable "allowed_locations" {
  description = "Allowed Azure regions for resource deployment"
  type        = list(string)
}
variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace resource ID"
  type        = string
}

variable "policy_assignment_prefix" {
  description = "Attempt-scoped prefix for policy assignments with location-bound identities"
  type        = string
  default     = ""
}
variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}
