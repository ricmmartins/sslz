// ============================================================================
// API-First Startup Example
// App Service + API Management (Consumption) + Cosmos DB + App Insights
// ============================================================================

@description('Azure region')
param location string = resourceGroup().location

@description('Application name prefix')
param appName string

@description('Environment: prod or nonprod')
@allowed(['prod', 'nonprod'])
param environment string = 'prod'

@description('App Service plan SKU')
param appServiceSku string = environment == 'prod' ? 'P1v3' : 'B1'

@description('APIM publisher email')
param apimPublisherEmail string

@description('APIM publisher name')
param apimPublisherName string

param tags object = {
  environment: environment
  team: 'engineering'
  project: appName
}

// ============================================================================
// Application Insights + Log Analytics
// ============================================================================

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'ai-${appName}-${environment}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    RetentionInDays: 90
  }
}

// ============================================================================
// App Service Plan + App
// ============================================================================

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${appName}-${environment}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: appServiceSku
  }
  properties: {
    reserved: true // Linux
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-${appName}-api-${environment}'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      alwaysOn: environment == 'prod'
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmos.properties.documentEndpoint
        }
      ]
    }
  }
}

// Staging slot for zero-downtime deploys
resource stagingSlot 'Microsoft.Web/sites/slots@2023-12-01' = if (environment == 'prod') {
  parent: app
  name: 'staging'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      alwaysOn: false
    }
  }
}

// ============================================================================
// API Management — Consumption tier
// ============================================================================

resource apim 'Microsoft.ApiManagement/service@2023-09-01-preview' = {
  name: 'apim-${appName}-${environment}'
  location: location
  tags: tags
  sku: {
    name: 'Consumption'
    capacity: 0
  }
  properties: {
    publisherEmail: apimPublisherEmail
    publisherName: apimPublisherName
  }
}

// ============================================================================
// Cosmos DB — Serverless (dev) or Autoscale (prod)
// ============================================================================

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-${appName}-${environment}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    capabilities: environment == 'nonprod' ? [
      { name: 'EnableServerless' }
    ] : []
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: appName
  properties: {
    resource: {
      id: appName
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'items'
  properties: {
    resource: {
      id: 'items'
      partitionKey: {
        paths: ['/tenantId']
        kind: 'Hash'
      }
    }
    options: environment == 'prod' ? {
      autoscaleSettings: {
        maxThroughput: 4000
      }
    } : {}
  }
}

// Grant App Service access to Cosmos DB
resource cosmosRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cosmos.id, app.id, '00000000-0000-0000-0000-000000000002')
  scope: cosmos
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '00000000-0000-0000-0000-000000000002') // Cosmos DB Built-in Data Contributor
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Redis — response caching
// ============================================================================

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: 'redis-${appName}-${environment}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'Basic'
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
    softDeleteRetentionInDays: 30
  }
}

// Grant App Service access to Key Vault secrets
resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, app.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Outputs
// ============================================================================

output appUrl string = 'https://${app.properties.defaultHostName}'
output apimGatewayUrl string = apim.properties.gatewayUrl
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output redisHostname string = redis.properties.hostName
