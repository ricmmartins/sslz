// ============================================================================
// Microsoft Defender for Cloud
// Enables security plans based on startup needs
// ============================================================================

targetScope = 'subscription'

@description('Enable Defender for Servers P2')
param enableDefenderForServers bool

@description('Enable Defender for Containers')
param enableDefenderForContainers bool

@description('Enable Defender for Databases (SQL + OSS)')
param enableDefenderForDatabases bool

@description('Enable Defender for Key Vault (recommended, low cost)')
param enableDefenderForKeyVault bool = true

@description('Email address for Defender for Cloud security alerts')
param securityContactEmail string

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

// Defender for Servers P2 (Standard) or Free — separate resources to avoid
// sending subPlan when tier is Free, which the API rejects.
resource defenderServersStandard 'Microsoft.Security/pricings@2024-01-01' = if (enableDefenderForServers) {
  name: 'VirtualMachines'
  properties: {
    pricingTier: 'Standard'
    subPlan: 'P2'
  }
}

resource defenderServersFree 'Microsoft.Security/pricings@2024-01-01' = if (!enableDefenderForServers) {
  name: 'VirtualMachines'
  properties: {
    pricingTier: 'Free'
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
    pricingTier: enableDefenderForKeyVault ? 'Standard' : 'Free'
  }
}

// Defender for ARM — detect suspicious control plane activity
resource defenderArm 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'Arm'
  properties: {
    pricingTier: 'Standard' // Free-ish, very low cost, always worth enabling
  }
}

// Defender for Storage — detect malicious uploads and anomalous access
resource defenderStorage 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'StorageAccounts'
  properties: {
    pricingTier: 'Standard'
    subPlan: 'DefenderForStorageV2'
  }
}

// ============================================================================
// Security Contact
// ============================================================================

resource securityContact 'Microsoft.Security/securityContacts@2023-12-01-preview' = {
  name: 'default'
  properties: {
    emails: securityContactEmail
    isEnabled: true
    notificationsByRole: {
      state: 'On'
      roles: ['Owner']
    }
    notificationsSources: [
      {
        sourceType: 'Alert'
        minimalSeverity: 'Medium'
      }
    ]
  }
}
