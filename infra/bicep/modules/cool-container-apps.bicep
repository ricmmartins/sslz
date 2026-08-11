targetScope = 'resourceGroup'

param location string
param managedEnvironmentName string
param containerAppName string
param managedIdentityResourceId string
param infrastructureSubnetResourceId string
param logAnalyticsWorkspaceResourceId string
param image string
param revisionMode string
param targetPort int
param transport string
param minReplicas int
param maxReplicas int
param cpu string
param memory string
param secretReferences array
param secretEnvironmentVariables array
param probes array
param diagnosticSettingName string
param tags object

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvironmentName
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetResourceId
      internal: true
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: revisionMode
      ingress: {
        external: false
        targetPort: targetPort
        transport: transport
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: [
        for secret in secretReferences: {
          name: secret.name
          keyVaultUrl: secret.keyVaultSecretUri
          identity: secret.identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: containerAppName
          image: image
          env: [
            for item in secretEnvironmentVariables: {
              name: item.name
              secretRef: item.secretRef
            }
          ]
          probes: [
            for probe in probes: {
              type: probe.type
              httpGet: {
                path: probe.path
                port: probe.port
              }
              initialDelaySeconds: probe.initialDelaySeconds
              periodSeconds: probe.intervalSeconds
              timeoutSeconds: probe.timeoutSeconds
              failureThreshold: probe.failureThreshold
            }
          ]
          resources: {
            cpu: json(cpu)
            memory: memory
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: diagnosticSettingName
  scope: environment
  properties: {
    workspaceId: logAnalyticsWorkspaceResourceId
    logs: [
      {
        category: 'ContainerAppConsoleLogs'
        enabled: true
      }
      {
        category: 'ContainerAppSystemLogs'
        enabled: true
      }
    ]
  }
}

output managedEnvironmentId string = environment.id
output containerAppId string = app.id
