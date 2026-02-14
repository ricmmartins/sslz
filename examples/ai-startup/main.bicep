// ============================================================================
// AI Startup Example
// AKS with GPU node pools + Azure OpenAI + Blob Storage
// ============================================================================

@description('Azure region')
param location string = resourceGroup().location

@description('Application name prefix')
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

@description('SSH public key for AKS nodes')
param sshPublicKey string

param tags object = {
  environment: environment
  team: 'ml-engineering'
  project: appName
}

// ============================================================================
// Log Analytics
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

resource aks 'Microsoft.ContainerService/managedClusters@2024-06-02-preview' = {
  name: 'aks-${appName}-${environment}'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    dnsPrefix: '${appName}-${environment}'
    kubernetesVersion: '1.30'
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
      adminUsername: 'azureuser'
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
resource gpuNodePool 'Microsoft.ContainerService/managedClusters/agentPools@2024-06-02-preview' = {
  parent: aks
  name: 'gpu'
  properties: {
    mode: 'User'
    count: 1
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

// ============================================================================
// Azure Container Registry
// ============================================================================

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
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
    publicNetworkAccess: 'Enabled'
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

// ============================================================================
// Outputs
// ============================================================================

output aksClusterName string = aks.name
output aksClusterFqdn string = aks.properties.fqdn
output acrLoginServer string = acr.properties.loginServer
output openaiEndpoint string = openai.properties.endpoint
output storageAccountName string = storage.name
output redisHostname string = redis.properties.hostName
