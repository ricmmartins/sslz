variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace resource ID"
  type        = string
}
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

# CSPM Free — always enabled
resource "azurerm_security_center_subscription_pricing" "cspm" {
  tier          = "Free"
  resource_type = "CloudPosture"
}

# Defender for Servers — Standard P2 when enabled
resource "azurerm_security_center_subscription_pricing" "servers_standard" {
  count         = var.enable_defender_for_servers ? 1 : 0
  tier          = "Standard"
  resource_type = "VirtualMachines"
  subplan       = "P2"
}

# Defender for Servers — Free when disabled (subplan not applicable)
resource "azurerm_security_center_subscription_pricing" "servers_free" {
  count         = var.enable_defender_for_servers ? 0 : 1
  tier          = "Free"
  resource_type = "VirtualMachines"
}

# Defender for Containers
resource "azurerm_security_center_subscription_pricing" "containers" {
  tier          = var.enable_defender_for_containers ? "Standard" : "Free"
  resource_type = "Containers"
}

# Defender for Azure SQL
resource "azurerm_security_center_subscription_pricing" "sql" {
  tier          = var.enable_defender_for_databases ? "Standard" : "Free"
  resource_type = "SqlServers"
}

# Defender for OSS Databases
resource "azurerm_security_center_subscription_pricing" "oss_db" {
  tier          = var.enable_defender_for_databases ? "Standard" : "Free"
  resource_type = "OpenSourceRelationalDatabases"
}

# Defender for Key Vault
resource "azurerm_security_center_subscription_pricing" "keyvault" {
  tier          = var.enable_defender_for_key_vault ? "Standard" : "Free"
  resource_type = "KeyVaults"
}

# Defender for ARM
resource "azurerm_security_center_subscription_pricing" "arm" {
  tier          = "Standard"
  resource_type = "Arm"
}

# Security contact
resource "azurerm_security_center_contact" "default" {
  name                = "default"
  email               = var.security_contact_email
  alert_notifications = true
  alerts_to_admins    = true
}
