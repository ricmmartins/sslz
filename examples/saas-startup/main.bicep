// ============================================================================
// SaaS Startup Example
// Container Apps + Azure SQL Elastic Pool + Redis + Key Vault
// ============================================================================

@description('Azure region')
param location string = resourceGroup().location

@description('Application name prefix (lowercase alphanumeric, max 12 chars to fit resource naming limits)')
@minLength(2)
@maxLength(12)
param appName string

@description('Container image for the API')
param apiImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Container image for the web frontend')
param webImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('SQL administrator login name. Must NOT be a commonly guessed name (admin, administrator, sa, root). Azure will reject these at deployment time.')
@minLength(2)
param sqlAdminLogin string

@description('SQL admin password')
@secure()
param sqlAdminPassword string

@description('Environment: prod or nonprod')
@allowed(['prod', 'nonprod'])
param environment string = 'prod'

@description('Deploy Private Endpoints for SQL and Redis. When true, you MUST also provide privateEndpointSubnetId and vnetId.')
param deployPrivateEndpoints bool = false

@description('Subnet resource ID for Private Endpoints. Required when deployPrivateEndpoints is true. Example: /subscriptions/.../subnets/snet-data')
param privateEndpointSubnetId string = ''

@description('VNet resource ID for Private DNS Zone links. Required when deployPrivateEndpoints is true. Example: /subscriptions/.../virtualNetworks/vnet-prod')
param vnetId string = ''

@description('Resource tags applied to all deployed resources')
param tags object = {
  environment: environment
  team: 'engineering'
  project: appName
  managedBy: 'bicep'
}

// ============================================================================
// Log Analytics (for Container Apps)
// 30-day retention keeps costs low for startup workloads. Increase to 90 days
// for compliance or if you need longer investigative windows.
// ============================================================================

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ============================================================================
// Container Apps Environment
// ============================================================================

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// ============================================================================
// Container App — API
// ============================================================================

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${appName}-api'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: ['https://ca-${appName}-web.${cae.properties.defaultDomain}']
        }
      }
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: environment == 'prod' ? 1 : 0
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

// ============================================================================
// Container App — Web
// ============================================================================

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${appName}-web'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: environment == 'prod' ? 1 : 0
        maxReplicas: 5
      }
    }
  }
}

// ============================================================================
// Azure SQL — Elastic Pool
// ============================================================================

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: 'sql-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: deployPrivateEndpoints ? 'Disabled' : 'Enabled'
  }
}

// Allow Azure services to reach SQL when not using Private Endpoints
resource sqlFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (!deployPrivateEndpoints) {
  parent: sqlServer
  name: 'AllowAllAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource elasticPool 'Microsoft.Sql/servers/elasticPools@2023-08-01-preview' = {
  parent: sqlServer
  name: 'pool-${appName}'
  location: location
  tags: tags
  sku: {
    name: 'StandardPool'
    tier: 'Standard'
    capacity: 100 // 100 eDTU
  }
  properties: {
    perDatabaseSettings: {
      minCapacity: 0
      maxCapacity: 100
    }
  }
}

resource appDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: 'db-${appName}'
  location: location
  tags: tags
  sku: {
    name: 'ElasticPool'
    tier: 'Standard'
  }
  properties: {
    elasticPoolId: elasticPool.id
  }
}

// ============================================================================
// Azure Cache for Redis
// ============================================================================

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: 'redis-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: environment == 'prod' ? 'Standard' : 'Basic'
      family: 'C'
      capacity: environment == 'prod' ? 1 : 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: deployPrivateEndpoints ? 'Disabled' : 'Enabled'
  }
}

// ============================================================================
// Key Vault
// ============================================================================

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: environment == 'prod' ? true : null
    softDeleteRetentionInDays: 90
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

// Grant API app access to Key Vault secrets
resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, apiApp.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Diagnostic Settings — send audit logs to Log Analytics
// ============================================================================

resource sqlDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-sql'
  scope: appDb
  properties: {
    workspaceId: law.id
    logs: [
      {
        category: 'SQLSecurityAuditEvents'
        enabled: true
      }
    ]
  }
}

resource redisDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-redis'
  scope: redis
  properties: {
    workspaceId: law.id
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource kvDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-kv'
  scope: kv
  properties: {
    workspaceId: law.id
    logs: [
      {
        category: 'AuditEvent'
        enabled: true
      }
    ]
  }
}

// ============================================================================
// Resource Locks (prod only)
// ============================================================================

resource kvLock 'Microsoft.Authorization/locks@2020-05-01' = if (environment == 'prod') {
  name: 'protect-kv'
  scope: kv
  properties: {
    level: 'CanNotDelete'
    notes: 'Protects Key Vault from accidental deletion'
  }
}

resource sqlLock 'Microsoft.Authorization/locks@2020-05-01' = if (environment == 'prod') {
  name: 'protect-sql'
  scope: sqlServer
  properties: {
    level: 'CanNotDelete'
    notes: 'Protects SQL Server from accidental deletion'
  }
}

// ============================================================================
// Private Endpoints (opt-in)
// ============================================================================

resource sqlPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = if (deployPrivateEndpoints) {
  name: 'privatelink.database.windows.net'
  location: 'global'
  tags: tags
}

resource sqlPrivateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = if (deployPrivateEndpoints) {
  parent: sqlPrivateDnsZone
  name: 'link-sql'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnetId }
    registrationEnabled: false
  }
}

resource sqlPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = if (deployPrivateEndpoints) {
  name: 'pe-${sqlServer.name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'plsc-sql'
        properties: {
          privateLinkServiceId: sqlServer.id
          groupIds: ['sqlServer']
        }
      }
    ]
  }
}

resource sqlPeDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (deployPrivateEndpoints) {
  parent: sqlPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'config-sql'
        properties: {
          privateDnsZoneId: sqlPrivateDnsZone.id
        }
      }
    ]
  }
}

resource redisPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = if (deployPrivateEndpoints) {
  name: 'privatelink.redis.cache.windows.net'
  location: 'global'
  tags: tags
}

resource redisPrivateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = if (deployPrivateEndpoints) {
  parent: redisPrivateDnsZone
  name: 'link-redis'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnetId }
    registrationEnabled: false
  }
}

resource redisPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = if (deployPrivateEndpoints) {
  name: 'pe-${redis.name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'plsc-redis'
        properties: {
          privateLinkServiceId: redis.id
          groupIds: ['redisCache']
        }
      }
    ]
  }
}

resource redisPeDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (deployPrivateEndpoints) {
  parent: redisPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'config-redis'
        properties: {
          privateDnsZoneId: redisPrivateDnsZone.id
        }
      }
    ]
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('HTTPS URL of the API container app')
output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'

@description('HTTPS URL of the web frontend container app')
output webUrl string = 'https://${webApp.properties.configuration.ingress.fqdn}'

@description('Fully qualified domain name of the SQL Server')
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('Redis cache hostname')
output redisHostname string = redis.properties.hostName

@description('Key Vault URI for secret access')
output keyVaultUri string = kv.properties.vaultUri
