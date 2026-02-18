// ============================================================================
// SaaS Startup Example
// Container Apps + Azure SQL Elastic Pool + Redis + Key Vault
// ============================================================================

@description('Azure region')
param location string = resourceGroup().location

@description('Application name prefix')
param appName string

@description('Container image for the API')
param apiImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Container image for the web frontend')
param webImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('SQL administrator login name')
param sqlAdminLogin string = 'sqladmin'

@description('SQL admin password')
@secure()
param sqlAdminPassword string

@description('Environment: prod or nonprod')
@allowed(['prod', 'nonprod'])
param environment string = 'prod'

@description('Deploy Private Endpoints for SQL and Redis (requires VNet with data subnet)')
param deployPrivateEndpoints bool = false

@description('Subnet resource ID for Private Endpoints (required when deployPrivateEndpoints is true)')
param privateEndpointSubnetId string = ''

@description('VNet resource ID for Private DNS Zone links (required when deployPrivateEndpoints is true)')
param vnetId string = ''

param tags object = {
  environment: environment
  team: 'engineering'
  project: appName
}

// ============================================================================
// Log Analytics (for Container Apps)
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
          allowedOrigins: ['https://${appName}-web.${cae.properties.defaultDomain}']
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
    publicNetworkAccess: 'Disabled'
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
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
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
    softDeleteRetentionInDays: 30
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

output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
output webUrl string = 'https://${webApp.properties.configuration.ingress.fqdn}'
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output redisHostname string = redis.properties.hostName
