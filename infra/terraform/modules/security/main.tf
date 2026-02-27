terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
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

# Security contact — Azure auto-creates securityContacts/default with empty values
# when any Defender plan is enabled. Terraform will adopt it on first apply.
resource "azurerm_security_center_contact" "default" {
  name                = "default"
  email               = var.security_contact_email
  alert_notifications = true
  alerts_to_admins    = true
}
