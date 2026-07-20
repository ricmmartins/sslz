// ============================================================================
// AI Startup Example
// AKS with GPU node pools + Azure OpenAI + Blob Storage
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

@description('AKS system node VM size')
param systemNodeVmSize string = 'Standard_D4s_v5'

@description('GPU node VM size')
param gpuNodeVmSize string = 'Standard_NC6s_v3'

@description('Use Spot VMs for GPU node pool')
param gpuUseSpot bool = true

@description('Use Spot VMs for CPU burst node pool')
param cpuUseSpot bool = true

@description('CPU burst node pool VM size')
param cpuNodeVmSize string = 'Standard_D4s_v5'

@description('Kubernetes version')
param kubernetesVersion string = '1.30'

@description('SSH public key for AKS nodes')
param sshPublicKey string

@description('Linux admin username for AKS nodes')
param aksAdminUsername string = 'azureuser'

@description('Resource tags applied to all deployed resources')
param tags object = {
  environment: environment
  team: 'ml-engineering'
  project: appName
  managedBy: 'bicep'
}

// ============================================================================
// Log Analytics
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
// AKS Cluster
// ============================================================================

resource aks 'Microsoft.ContainerService/managedClusters@2024-09-01' = {
  name: 'aks-${appName}-${environment}'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    dnsPrefix: '${appName}-${environment}'
    kubernetesVersion: kubernetesVersion
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'calico'
      serviceCidr: '172.16.0.0/16'
      dnsServiceIP: '172.16.0.10'
    }
    agentPoolProfiles: [
      {
        name: 'system'
        mode: 'System'
        count: 2
        minCount: 2
        maxCount: 5
        enableAutoScaling: true
        vmSize: systemNodeVmSize
        osType: 'Linux'
        osSKU: 'AzureLinux'
        nodeTaints: []
      }
    ]
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: law.id
        }
      }
    }
    linuxProfile: {
      adminUsername: aksAdminUsername
      ssh: {
        publicKeys: [
          {
            keyData: sshPublicKey
          }
        ]
      }
    }
  }
}

// GPU node pool — separate resource for independent scaling
resource gpuNodePool 'Microsoft.ContainerService/managedClusters/agentPools@2024-09-01' = {
  parent: aks
  name: 'gpu'
  properties: {
    mode: 'User'
    count: 0
    minCount: 0
    maxCount: 3
    enableAutoScaling: true
    vmSize: gpuNodeVmSize
    osType: 'Linux'
    osSKU: 'AzureLinux'
    scaleSetPriority: gpuUseSpot ? 'Spot' : 'Regular'
    scaleSetEvictionPolicy: gpuUseSpot ? 'Delete' : null
    spotMaxPrice: gpuUseSpot ? json('-1') : null
    nodeTaints: [
      'sku=gpu:NoSchedule'
    ]
    nodeLabels: {
      'accelerator': 'nvidia'
      'workload-type': 'gpu'
    }
  }
}

// CPU burst node pool for data preprocessing
resource cpuNodePool 'Microsoft.ContainerService/managedClusters/agentPools@2024-09-01' = {
  parent: aks
  name: 'cpu'
  properties: {
    mode: 'User'
    count: 0
    minCount: 0
    maxCount: 10
    enableAutoScaling: true
    vmSize: cpuNodeVmSize
    osType: 'Linux'
    osSKU: 'AzureLinux'
    scaleSetPriority: cpuUseSpot ? 'Spot' : 'Regular'
    scaleSetEvictionPolicy: cpuUseSpot ? 'Delete' : null
    spotMaxPrice: cpuUseSpot ? json('-1') : null
    nodeLabels: {
      'workload-type': 'cpu-batch'
    }
  }
}

// ============================================================================
// Azure Container Registry
// ============================================================================

// NOTE: Standard tier is cost-effective for startups. Upgrade to Premium if you
// need Private Endpoints (to match OpenAI/Cosmos private access) or geo-replication.
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01' = {
  name: replace('acr${appName}${environment}', '-', '')
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    adminUserEnabled: false
  }
}

// Grant AKS pull access to ACR
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, aks.id, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') // AcrPull
    principalId: aks.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Azure OpenAI
// ============================================================================

resource openai 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: 'oai-${appName}-${environment}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    // Public access is disabled for security. In production, deploy a Private
    // Endpoint so AKS pods can reach OpenAI over the VNet. Without a PE,
    // the service is unreachable — add one or change to 'Enabled' with IP rules.
    publicNetworkAccess: 'Disabled'
    customSubDomainName: 'oai-${appName}-${environment}'
  }
}

resource gpt4o 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openai
  name: 'gpt-4o'
  sku: {
    name: 'Standard'
    capacity: 30 // 30K TPM
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-08-06'
    }
  }
}

// ============================================================================
// Blob Storage — models, datasets, outputs
// ============================================================================

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: replace('st${appName}${environment}', '-', '')
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    networkRuleSet: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

resource modelsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storage.name}/default/models'
  properties: {
    publicAccess: 'None'
  }
}

resource datasetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storage.name}/default/datasets'
  properties: {
    publicAccess: 'None'
  }
}

// ============================================================================
// Redis — inference caching
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
// Diagnostic Settings — send audit logs to Log Analytics
// ============================================================================

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource storageBlobDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-blob'
  scope: blobService
  properties: {
    workspaceId: law.id
    logs: [
      {
        category: 'StorageRead'
        enabled: true
      }
      {
        category: 'StorageWrite'
        enabled: true
      }
      {
        category: 'StorageDelete'
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

// ============================================================================
// Outputs
// ============================================================================

@description('AKS cluster name (use with az aks get-credentials)')
output aksClusterName string = aks.name

@description('AKS cluster FQDN for API server access')
output aksClusterFqdn string = aks.properties.fqdn

@description('Container registry login server (use with docker push)')
output acrLoginServer string = acr.properties.loginServer

@description('Azure OpenAI service endpoint URL')
output openaiEndpoint string = openai.properties.endpoint

@description('Storage account name for model artifacts and datasets')
output storageAccountName string = storage.name

@description('Redis cache hostname for inference caching')
output redisHostname string = redis.properties.hostName

@description('Key Vault URI for secret access')
output keyVaultUri string = kv.properties.vaultUri
