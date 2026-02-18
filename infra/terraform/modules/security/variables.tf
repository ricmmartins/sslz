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
  description = "Enable Defender for Databases (SQL + OSS)"
  type        = bool
  default     = false
}
variable "enable_defender_for_key_vault" {
  description = "Enable Defender for Key Vault (recommended for prod, low cost)"
  type        = bool
  default     = true
}
