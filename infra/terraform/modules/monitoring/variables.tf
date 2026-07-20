variable "location" {
  description = "Azure region"
  type        = string
}
variable "resource_group_name" {
  description = "Resource group name"
  type        = string
}
variable "workspace_name" {
  description = "Log Analytics workspace name"
  type        = string
}
variable "retention_in_days" {
  description = "Data retention in days"
  type        = number
  default     = 90
}
variable "daily_quota_gb" {
  description = "Daily ingestion quota in GB"
  type        = number
  default     = 5
}
variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
