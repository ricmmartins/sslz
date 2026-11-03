// ============================================================================
// SaaS Startup Example
// Container Apps + Azure SQL Elastic Pool + Redis + Key Vault
// ============================================================================

func isVnetResourceId(resourceId string) bool => length(split(resourceId, '/')) == 9 ? empty(split(resourceId, '/')[0]) && toLower(split(resourceId, '/')[1]) == 'subscriptions' && !empty(split(resourceId, '/')[2]) && toLower(split(resourceId, '/')[3]) == 'resourcegroups' && !empty(split(resourceId, '/')[4]) && toLower(split(resourceId, '/')[5]) == 'providers' && toLower(split(resourceId, '/')[6]) == 'microsoft.network' && toLower(split(resourceId, '/')[7]) == 'virtualnetworks' && !empty(split(resourceId, '/')[8]) : false
func isSubnetResourceId(resourceId string) bool => length(split(resourceId, '/')) == 11 ? isVnetResourceId(join(take(split(resourceId, '/'), 9), '/')) && toLower(split(resourceId, '/')[9]) == 'subnets' && !empty(split(resourceId, '/')[10]) : false
func ipv4AddressValue(address string) int => int(split(address, '.')[0]) * 16777216 + int(split(address, '.')[1]) * 65536 + int(split(address, '.')[2]) * 256 + int(split(address, '.')[3])

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

@description('Deploy Private Endpoints for SQL and Redis and inject Container Apps into the same VNet. When true, all three network resource IDs are required.')
param deployPrivateEndpoints bool = false

@description('Dedicated subnet resource ID for the Container Apps environment. Required in private mode, must be /27 or larger, delegated to Microsoft.App/environments, and must not overlap Azure Container Apps reserved ranges.')
param containerAppsInfrastructureSubnetId string = ''

@description('Dedicated subnet resource ID for SQL and Redis Private Endpoints. Required in private mode and must be distinct from the Container Apps infrastructure subnet.')
param privateEndpointSubnetId string = ''

@description('VNet resource ID shared by the Container Apps infrastructure subnet, Private Endpoint subnet, and Private DNS Zone links.')
param vnetId string = ''

@description('Resource tags applied to all deployed resources')
param tags object = {
  environment: environment
  team: 'engineering'
  project: appName
  managedBy: 'bicep'
}

var vnetResourceIdValid = isVnetResourceId(vnetId)
var containerAppsSubnetResourceIdValid = isSubnetResourceId(containerAppsInfrastructureSubnetId)
var privateEndpointSubnetResourceIdValid = isSubnetResourceId(privateEndpointSubnetId)
var containerAppsSubnetVnetId = containerAppsSubnetResourceIdValid ? join(take(split(containerAppsInfrastructureSubnetId, '/'), 9), '/') : ''
var privateEndpointSubnetVnetId = privateEndpointSubnetResourceIdValid ? join(take(split(privateEndpointSubnetId, '/'), 9), '/') : ''
var vnetSubscriptionMatches = vnetResourceIdValid ? toLower(split(vnetId, '/')[2]) == toLower(subscription().subscriptionId) : false
var privateNetworkResourceIdsValid = vnetResourceIdValid && containerAppsSubnetResourceIdValid && privateEndpointSubnetResourceIdValid && vnetSubscriptionMatches && toLower(containerAppsSubnetVnetId) == toLower(vnetId) && toLower(privateEndpointSubnetVnetId) == toLower(vnetId) && toLower(containerAppsInfrastructureSubnetId) != toLower(privateEndpointSubnetId)
var safeContainerAppsSubnetSegments = privateNetworkResourceIdsValid ? split(containerAppsInfrastructureSubnetId, '/') : ['', 'subscriptions', subscription().subscriptionId, 'resourceGroups', resourceGroup().name, 'providers', 'Microsoft.Network', 'virtualNetworks', 'invalid', 'subnets', 'invalid']
var safePrivateEndpointSubnetSegments = privateNetworkResourceIdsValid ? split(privateEndpointSubnetId, '/') : ['', 'subscriptions', subscription().subscriptionId, 'resourceGroups', resourceGroup().name, 'providers', 'Microsoft.Network', 'virtualNetworks', 'invalid', 'subnets', 'invalid']

resource containerAppsInfrastructureSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = if (deployPrivateEndpoints && privateNetworkResourceIdsValid) {
  scope: resourceGroup(safeContainerAppsSubnetSegments[2], safeContainerAppsSubnetSegments[4])
  name: '${safeContainerAppsSubnetSegments[8]}/${safeContainerAppsSubnetSegments[10]}'
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = if (deployPrivateEndpoints && privateNetworkResourceIdsValid) {
  scope: resourceGroup(safePrivateEndpointSubnetSegments[2], safePrivateEndpointSubnetSegments[4])
  name: '${safePrivateEndpointSubnetSegments[8]}/${safePrivateEndpointSubnetSegments[10]}'
}

var containerAppsSubnetAddressPrefix = deployPrivateEndpoints && privateNetworkResourceIdsValid
  ? containerAppsInfrastructureSubnet!.properties.addressPrefix ?? (length(containerAppsInfrastructureSubnet!.properties.addressPrefixes ?? []) == 1 ? first(containerAppsInfrastructureSubnet!.properties.addressPrefixes!) : '')
  : '10.0.0.0/27'
var privateEndpointSubnetAddressPrefix = deployPrivateEndpoints && privateNetworkResourceIdsValid
  ? privateEndpointSubnet!.properties.addressPrefix ?? (length(privateEndpointSubnet!.properties.addressPrefixes ?? []) == 1 ? first(privateEndpointSubnet!.properties.addressPrefixes!) : '')
  : '10.0.1.0/27'
var containerAppsSubnetHasSinglePrefix = !empty(containerAppsSubnetAddressPrefix)
var privateEndpointSubnetHasSinglePrefix = !empty(privateEndpointSubnetAddressPrefix)
var containerAppsSubnetRange = parseCidr(containerAppsSubnetHasSinglePrefix ? containerAppsSubnetAddressPrefix : '10.0.0.0/27')
var privateEndpointSubnetRange = parseCidr(privateEndpointSubnetHasSinglePrefix ? privateEndpointSubnetAddressPrefix : '10.0.1.0/27')
var containerAppsSubnetPrefixLength = containerAppsSubnetRange.cidr
var containerAppsSubnetDelegations = deployPrivateEndpoints && privateNetworkResourceIdsValid ? map(containerAppsInfrastructureSubnet!.properties.delegations ?? [], delegation => toLower(delegation.properties.serviceName)) : ['microsoft.app/environments']
var containerAppsSubnetIsDelegated = contains(containerAppsSubnetDelegations, 'microsoft.app/environments')
var reservedContainerAppsRanges = map([
  '169.254.0.0/16'
  '172.30.0.0/16'
  '172.31.0.0/16'
  '192.0.2.0/24'
  '100.100.0.0/17'
  '100.100.128.0/19'
  '100.100.160.0/19'
  '100.100.192.0/19'
], cidr => parseCidr(cidr))
var containerAppsNetworkValue = ipv4AddressValue(containerAppsSubnetRange.network)
var containerAppsBroadcastValue = ipv4AddressValue(containerAppsSubnetRange.broadcast)
var containerAppsSubnetOverlapsReservedRange = length(filter(reservedContainerAppsRanges, reservedRange => containerAppsNetworkValue <= ipv4AddressValue(reservedRange.broadcast) && ipv4AddressValue(reservedRange.network) <= containerAppsBroadcastValue)) > 0
var privateEndpointNetworkValue = ipv4AddressValue(privateEndpointSubnetRange.network)
var privateEndpointBroadcastValue = ipv4AddressValue(privateEndpointSubnetRange.broadcast)
var privateSubnetsOverlap = containerAppsNetworkValue <= privateEndpointBroadcastValue && privateEndpointNetworkValue <= containerAppsBroadcastValue
var privateNetworkConfigValid = privateNetworkResourceIdsValid && containerAppsSubnetHasSinglePrefix && privateEndpointSubnetHasSinglePrefix && containerAppsSubnetPrefixLength <= 27 && containerAppsSubnetIsDelegated && !containerAppsSubnetOverlapsReservedRange && !privateSubnetsOverlap
var validatedContainerAppsInfrastructureSubnetId = !deployPrivateEndpoints || privateNetworkConfigValid
  ? containerAppsInfrastructureSubnetId
  : fail('Private endpoint mode requires valid, distinct subnet IDs in vnetId. The Container Apps subnet must have one /27-or-larger IPv4 prefix, be delegated to Microsoft.App/environments, avoid reserved Container Apps ranges, and not overlap the Private Endpoint subnet.')
var validatedPrivateEndpointSubnetId = !deployPrivateEndpoints || privateNetworkConfigValid
  ? privateEndpointSubnetId
  : fail('Private endpoint mode requires valid, distinct subnet IDs in vnetId. The Container Apps subnet must have one /27-or-larger IPv4 prefix, be delegated to Microsoft.App/environments, avoid reserved Container Apps ranges, and not overlap the Private Endpoint subnet.')

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
  properties: union({
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }, deployPrivateEndpoints ? {
    vnetConfiguration: {
      infrastructureSubnetId: validatedContainerAppsInfrastructureSubnetId
    }
  } : {})
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
    subnet: { id: validatedPrivateEndpointSubnetId }
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
    subnet: { id: validatedPrivateEndpointSubnetId }
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

@description('Container Apps environment resource ID')
output containerAppsEnvironmentId string = cae.id

@description('Container Apps infrastructure subnet resource ID in private mode; empty in public mode')
output containerAppsInfrastructureSubnetId string = deployPrivateEndpoints ? validatedContainerAppsInfrastructureSubnetId : ''

@description('Private Endpoint subnet resource ID in private mode; empty in public mode')
output privateEndpointSubnetId string = deployPrivateEndpoints ? validatedPrivateEndpointSubnetId : ''

@description('Private DNS zone resource IDs linked to the application VNet; empty in public mode')
output privateDnsZoneIds array = deployPrivateEndpoints ? [
  sqlPrivateDnsZone.id
  redisPrivateDnsZone.id
] : []
