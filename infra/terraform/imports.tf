import {
  to = module.security.azurerm_security_center_subscription_pricing.containers
  id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/Containers"
}

import {
  to = module.security.azurerm_security_center_subscription_pricing.sql
  id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/SqlServers"
}

import {
  to = module.security.azurerm_security_center_subscription_pricing.oss_db
  id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/OpenSourceRelationalDatabases"
}

import {
  to = module.security.azurerm_security_center_subscription_pricing.keyvault
  id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/KeyVaults"
}

import {
  to = module.security.azurerm_security_center_subscription_pricing.arm
  id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/Arm"
}

# IMPORTANT: VirtualMachines is conditional in your module because of count.
# Use ONE of these depending on var.enable_defender_for_servers resolution.

# If servers_standard is created (count = 1):
import {
  to = module.security.azurerm_security_center_subscription_pricing.servers_standard[0]
  id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/VirtualMachines"
}

# If servers_free is created (count = 1) instead:
# import {
#   to = module.security.azurerm_security_center_subscription_pricing.servers_free[0]
#   id = "/subscriptions/313dd062-1c1c-428a-afc4-4e271378679f/providers/Microsoft.Security/pricings/VirtualMachines"
# }
