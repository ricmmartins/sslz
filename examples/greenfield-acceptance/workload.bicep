param runName string
param location string
param image string
param tags object

var storageName = 'sslz${uniqueString(resourceGroup().id)}'
var managedGroupName = 'ME_sslz_${runName}'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${runName}'
  location: location
  tags: tags
}

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${runName}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.242.0.0/24']
    }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: '10.242.0.0/27'
          delegations: [
            {
              name: 'container-apps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'endpoints'
        properties: {
          addressPrefix: '10.242.0.32/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Deny'
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 1
    }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'acceptance'
  properties: {
    publicAccess: 'None'
  }
}

resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(container.id, identity.id, 'blob-contributor')
  scope: container
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource privateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDns
  name: 'link-${runName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource endpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${runName}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: '${network.id}/subnets/endpoints'
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: ['blob']
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: endpoint
  name: 'blob'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: privateDns.id
        }
      }
    ]
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'env-${runName}'
  location: location
  tags: tags
  properties: {
    infrastructureResourceGroup: managedGroupName
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    vnetConfiguration: {
      infrastructureSubnetId: '${network.id}/subnets/apps'
      internal: false
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'app-${runName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'http'
      }
    }
    template: {
      containers: [
        {
          name: 'acceptance'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'BLOB_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
            { name: 'BLOB_CONTAINER', value: 'acceptance' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: { path: '/readyz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 10
              failureThreshold: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [blobAccess, dnsGroup, dnsLink]
}

output appName string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
output managedResourceGroupName string = managedGroupName
