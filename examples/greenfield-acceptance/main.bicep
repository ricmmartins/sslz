targetScope = 'subscription'

@minLength(6)
@maxLength(16)
param runName string
param location string
param image string
param attemptId string

var groupName = 'rg-sslz-${runName}'
var tags = {
  project: 'sslz-acceptance'
  attemptId: attemptId
  lifecycle: 'temporary-acceptance'
}

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: groupName
  location: location
  tags: tags
}

module workload './workload.bicep' = {
  name: 'sslz-${runName}'
  scope: group
  params: {
    runName: runName
    location: location
    image: image
    tags: tags
  }
}

output resourceGroupName string = group.name
output appName string = workload.outputs.appName
output fqdn string = workload.outputs.fqdn
output managedResourceGroupName string = workload.outputs.managedResourceGroupName
