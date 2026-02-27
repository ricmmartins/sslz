// ============================================================================
// API-First Startup Example
// App Service + API Management (Consumption) + Cosmos DB + App Insights
// ============================================================================

@description('Azure region')
param location string = resourceGroup().location

@description('Application name prefix (lowercase alphanumeric, max 12 chars to fit resource naming limits)')
@minLength(2)
@maxLength(12)
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

@description('Resource tags applied to all deployed resources')
param tags object = {
  environment: environment
  team: 'engineering'
  project: appName
  managedBy: 'bicep'
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
    // 30-day retention keeps costs low for startup workloads. Increase to 90 days
    // for compliance or if you need longer investigative windows.
    retentionInDays: 30
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
    RetentionInDays: 30
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
        {
          name: 'REDIS_HOSTNAME'
          value: redis.properties.hostName
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
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmos.properties.documentEndpoint
        }
        {
          name: 'REDIS_HOSTNAME'
          value: redis.properties.hostName
        }
      ]
    }
  }
}

// ============================================================================
// API Management — Consumption tier
// ============================================================================

resource apim 'Microsoft.ApiManagement/service@2024-03-01' = {
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
    // Public access is disabled for security. In production, deploy a Private
    // Endpoint so App Service can reach Cosmos DB over the VNet. Without a PE,
    // Cosmos DB is unreachable — add one or change to 'Enabled' with IP rules.
    publicNetworkAccess: 'Disabled'
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

// Grant App Service access to Cosmos DB (SQL built-in Data Contributor role)
resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, app.id, 'cosmos-data-contributor')
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: app.identity.principalId
    scope: cosmos.id
  }
}

resource cosmosRoleAssignmentStaging 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = if (environment == 'prod') {
  parent: cosmos
  name: guid(cosmos.id, stagingSlot.id, 'cosmos-data-contributor-staging')
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: stagingSlot.identity.principalId
    scope: cosmos.id
  }
}

// ============================================================================
// Redis — response caching
// Standard C1 for prod (SLA, replication), Basic C0 for nonprod.
// The app works without cache (just slower), so this is optional.
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
    publicNetworkAccess: 'Disabled'
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

resource kvRoleAssignmentStaging 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (environment == 'prod') {
  name: guid(kv.id, stagingSlot.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: stagingSlot.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Diagnostic Settings— send audit logs to Log Analytics
// ============================================================================

resource cosmosDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-cosmos'
  scope: cosmos
  properties: {
    workspaceId: law.id
    logs: [
      {
        category: 'DataPlaneRequests'
        enabled: true
      }
      {
        category: 'QueryRuntimeStatistics'
        enabled: true
      }
    ]
  }
}

resource apimDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-apim'
  scope: apim
  properties: {
    workspaceId: law.id
    logs: [
      {
        category: 'GatewayLogs'
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

resource kvLock 'Microsoft.Authorization/locks@2020-05-01' = if (environment == 'prod') {
  name: 'protect-kv'
  scope: kv
  properties: {
    level: 'CanNotDelete'
    notes: 'Protects Key Vault from accidental deletion'
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('HTTPS URL of the App Service API')
output appUrl string = 'https://${app.properties.defaultHostName}'

@description('API Management gateway URL for external consumers')
output apimGatewayUrl string = apim.properties.gatewayUrl

@description('Cosmos DB account endpoint URL')
output cosmosEndpoint string = cosmos.properties.documentEndpoint

// Note: App Insights connection string is intentionally omitted from outputs
// because Bicep does not support secure outputs. Retrieve it from the Azure
// portal or via: az monitor app-insights component show --app <name> --query connectionString

@description('Redis cache hostname for response caching')
output redisHostname string = redis.properties.hostName

@description('Key Vault URI for secret access')
output keyVaultUri string = kv.properties.vaultUri
