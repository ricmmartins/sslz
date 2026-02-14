// ============================================================================
// Microsoft Defender for Cloud
// Enables security plans based on startup needs
// ============================================================================

targetScope = 'subscription'

@description('Log Analytics workspace ID for Defender data')
param logAnalyticsWorkspaceId string

@description('Enable Defender for Servers P2')
param enableDefenderForServers bool

@description('Enable Defender for Containers')
param enableDefenderForContainers bool

@description('Enable Defender for Databases (SQL + OSS)')
param enableDefenderForDatabases bool

// ============================================================================
// Defender Plans
// ============================================================================

// CSPM Free — always enabled
resource defenderCspm 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'CloudPosture'
  properties: {
    pricingTier: 'Free'
  }
}

// Defender for Servers P2
resource defenderServers 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'VirtualMachines'
  properties: {
    pricingTier: enableDefenderForServers ? 'Standard' : 'Free'
    subPlan: enableDefenderForServers ? 'P2' : null
  }
}

// Defender for Containers
resource defenderContainers 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'Containers'
  properties: {
    pricingTier: enableDefenderForContainers ? 'Standard' : 'Free'
  }
}

// Defender for Azure SQL
resource defenderSqlServers 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'SqlServers'
  properties: {
    pricingTier: enableDefenderForDatabases ? 'Standard' : 'Free'
  }
}

// Defender for OSS Databases (PostgreSQL, MySQL, MariaDB)
resource defenderOssDatabases 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'OpenSourceRelationalDatabases'
  properties: {
    pricingTier: enableDefenderForDatabases ? 'Standard' : 'Free'
  }
}

// Defender for Key Vault — cheap, always enable on prod
resource defenderKeyVault 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'KeyVaults'
  properties: {
    pricingTier: enableDefenderForServers ? 'Standard' : 'Free' // piggyback on the servers flag for prod
  }
}

// Defender for ARM — detect suspicious control plane activity
resource defenderArm 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'Arm'
  properties: {
    pricingTier: 'Standard' // Free-ish, very low cost, always worth enabling
  }
}

// ============================================================================
// Auto-provisioning — send Defender data to Log Analytics
// ============================================================================

resource autoProvisioningLaw 'Microsoft.Security/autoProvisioningSettings@2017-08-01-preview' = {
  name: 'default'
  properties: {
    autoProvision: 'On'
  }
}

resource securityContact 'Microsoft.Security/securityContacts@2020-01-01-preview' = {
  name: 'default'
  properties: {
    emails: ''
    notificationsByRole: {
      state: 'On'
      roles: ['Owner', 'Contributor']
    }
    alertNotifications: {
      state: 'On'
      minimalSeverity: 'Medium'
    }
  }
}
