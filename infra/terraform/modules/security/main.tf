variable "log_analytics_workspace_id" { type = string }
variable "security_contact_email" {
  description = "Email address for Defender for Cloud security alerts"
  type        = string
}
variable "enable_defender_for_servers" {
  type    = bool
  default = false
}
variable "enable_defender_for_containers" {
  type    = bool
  default = false
}
variable "enable_defender_for_databases" {
  type    = bool
  default = false
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

# Defender for Servers
resource "azurerm_security_center_subscription_pricing" "servers" {
  tier          = var.enable_defender_for_servers ? "Standard" : "Free"
  resource_type = "VirtualMachines"
  subplan       = var.enable_defender_for_servers ? "P2" : null
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
