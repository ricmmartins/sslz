targetScope = 'subscription'

@description('Secondary nonproduction Azure region')
param location string

@description('Nonproduction profile resource group')
param resourceGroupName string

@description('Container Apps managed environment name')
param managedEnvironmentName string

@description('Container App name')
param containerAppName string

@description('Existing user-assigned managed identity resource ID')
param managedIdentityResourceId string

@description('Expected managed identity principal ID')
param managedIdentityPrincipalId string

@description('Existing Key Vault subscription ID')
param keyVaultSubscriptionId string

@description('Existing Key Vault resource group')
param keyVaultResourceGroupName string

@description('Existing Key Vault name')
param keyVaultName string

@description('Role definition resource ID scoped to the Key Vault')
param keyVaultRoleDefinitionId string

@description('Existing dedicated Container Apps infrastructure subnet resource ID')
param infrastructureSubnetResourceId string

@description('Secondary foundation Log Analytics workspace resource ID')
param logAnalyticsWorkspaceResourceId string

@description('Primary scope retained only for isolation validation')
param primaryScope string

@description('Secondary profile scope')
param secondaryScope string

@description('Primary VNet CIDR retained only for isolation validation')
param primaryVnetCidr string

@description('Secondary VNet CIDR')
param secondaryVnetCidr string

@description('Immutable container image reference')
param image string

@description('Single revision mode is required for deterministic rollback')
@allowed(['Single'])
param revisionMode string = 'Single'

@description('Internal ingress target port')
@minValue(1)
@maxValue(65535)
param targetPort int

@description('Container Apps ingress transport')
@allowed(['auto', 'http', 'http2', 'tcp'])
param transport string = 'auto'

@description('Minimum replicas for the cool footprint')
@minValue(0)
@maxValue(1)
param minReplicas int = 0

@description('Maximum replicas for the cool footprint')
@minValue(1)
@maxValue(3)
param maxReplicas int = 1

@description('Container vCPU')
@allowed(['0.25', '0.5', '0.75', '1'])
param cpu string = '0.25'

@description('Container memory')
@allowed(['0.5Gi', '1Gi', '1.5Gi', '2Gi'])
param memory string = '0.5Gi'

@description('Key Vault secret references only; values are prohibited')
param secretReferences array

@description('Environment variables bound only to named secret references')
param secretEnvironmentVariables array

@description('Startup, readiness, and liveness probe definitions')
param probes array

@description('Diagnostic setting name')
param diagnosticSettingName string

@description('Canonical provider-equivalent decision digest')
param decisionDigest string

@description('Exact Bicep source digest')
param sourceDigest string

@description('Secondary profile tags')
param tags object = {
  environment: 'nonprod'
  managedBy: 'bicep'
  profile: 'container-apps'
  regionalRole: 'secondary'
  deploymentMode: 'cool-container-apps'
}

var imageIsImmutable = contains(image, '@sha256:') && !contains(image, ':latest')
var validatedImage = imageIsImmutable
  ? image
  : fail('image must be an immutable digest reference and cannot use a mutable tag.')
var scopeIsSecondary = contains(toLower(resourceGroupName), '-nonprod-cool-') && !contains(toLower(resourceGroupName), '-primary')
var validatedResourceGroupName = scopeIsSecondary
  ? resourceGroupName
  : fail('resourceGroupName must be an isolated nonproduction secondary cool scope.')
var scopesAreIsolated = primaryScope != secondaryScope
var validatedSecondaryScope = scopesAreIsolated
  ? secondaryScope
  : fail('primaryScope and secondaryScope must be isolated.')
var primaryRange = parseCidr(primaryVnetCidr)
var secondaryRange = parseCidr(secondaryVnetCidr)
var primaryNetworkOctets = length(split(primaryRange.network, '.')) == 4
  ? split(primaryRange.network, '.')
  : fail('primaryVnetCidr must be a valid IPv4 CIDR.')
var primaryBroadcastOctets = length(split(primaryRange.broadcast, '.')) == 4
  ? split(primaryRange.broadcast, '.')
  : fail('primaryVnetCidr must be a valid IPv4 CIDR.')
var secondaryNetworkOctets = length(split(secondaryRange.network, '.')) == 4
  ? split(secondaryRange.network, '.')
  : fail('secondaryVnetCidr must be a valid IPv4 CIDR.')
var secondaryBroadcastOctets = length(split(secondaryRange.broadcast, '.')) == 4
  ? split(secondaryRange.broadcast, '.')
  : fail('secondaryVnetCidr must be a valid IPv4 CIDR.')
var primaryNetworkValue = int(primaryNetworkOctets[0]) * 16777216 + int(primaryNetworkOctets[1]) * 65536 + int(primaryNetworkOctets[2]) * 256 + int(primaryNetworkOctets[3])
var primaryBroadcastValue = int(primaryBroadcastOctets[0]) * 16777216 + int(primaryBroadcastOctets[1]) * 65536 + int(primaryBroadcastOctets[2]) * 256 + int(primaryBroadcastOctets[3])
var secondaryNetworkValue = int(secondaryNetworkOctets[0]) * 16777216 + int(secondaryNetworkOctets[1]) * 65536 + int(secondaryNetworkOctets[2]) * 256 + int(secondaryNetworkOctets[3])
var secondaryBroadcastValue = int(secondaryBroadcastOctets[0]) * 16777216 + int(secondaryBroadcastOctets[1]) * 65536 + int(secondaryBroadcastOctets[2]) * 256 + int(secondaryBroadcastOctets[3])
var addressSpacesOverlap = primaryNetworkValue <= secondaryBroadcastValue && secondaryNetworkValue <= primaryBroadcastValue
var validatedSecondaryVnetCidr = !addressSpacesOverlap
  ? secondaryVnetCidr
  : fail('primaryVnetCidr and secondaryVnetCidr must not overlap.')
var subnetIsContainerApps = endsWith(toLower(infrastructureSubnetResourceId), '/subnets/snet-container-apps')
var validatedSubnetResourceId = subnetIsContainerApps
  ? infrastructureSubnetResourceId
  : fail('infrastructureSubnetResourceId must reference the dedicated Container Apps subnet.')
var identityReferencesMatch = length(filter(secretReferences, secret => secret.identityResourceId != managedIdentityResourceId)) == 0
var validatedSecretReferences = identityReferencesMatch
  ? secretReferences
  : fail('Every secret reference must use the bound managed identity.')
var secretNames = map(secretReferences, secret => secret.name)
var environmentReferencesMatch = length(filter(secretEnvironmentVariables, item => !contains(secretNames, item.secretRef))) == 0
var validatedSecretEnvironmentVariables = environmentReferencesMatch
  ? secretEnvironmentVariables
  : fail('Every secret environment variable must reference a declared secret.')
var probeTypes = map(probes, probe => probe.type)
var probesComplete = length(probes) == 3 && contains(probeTypes, 'Startup') && contains(probeTypes, 'Readiness') && contains(probeTypes, 'Liveness') && length(filter(probes, probe => probe.port != targetPort)) == 0
var validatedProbes = probesComplete
  ? probes
  : fail('Exactly one Startup, Readiness, and Liveness probe must target the container port.')

resource profileResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: validatedResourceGroupName
  location: location
  tags: tags
}

module profile 'modules/cool-container-apps.bicep' = {
  name: 'represent-cool-container-apps-${location}'
  scope: profileResourceGroup
  params: {
    location: location
    managedEnvironmentName: managedEnvironmentName
    containerAppName: containerAppName
    managedIdentityResourceId: managedIdentityResourceId
    infrastructureSubnetResourceId: validatedSubnetResourceId
    logAnalyticsWorkspaceResourceId: logAnalyticsWorkspaceResourceId
    image: validatedImage
    revisionMode: revisionMode
    targetPort: targetPort
    transport: transport
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    cpu: cpu
    memory: memory
    secretReferences: validatedSecretReferences
    secretEnvironmentVariables: validatedSecretEnvironmentVariables
    probes: validatedProbes
    diagnosticSettingName: diagnosticSettingName
    tags: tags
  }
  dependsOn: [
    keyVaultAccess
  ]
}

module keyVaultAccess 'modules/cool-container-apps-rbac.bicep' = {
  name: 'represent-cool-container-apps-rbac-${location}'
  scope: resourceGroup(keyVaultSubscriptionId, keyVaultResourceGroupName)
  params: {
    keyVaultName: keyVaultName
    managedIdentityPrincipalId: managedIdentityPrincipalId
    keyVaultRoleDefinitionId: keyVaultRoleDefinitionId
  }
}

output profileResourceGroupId string = profileResourceGroup.id
output managedEnvironmentId string = profile.outputs.managedEnvironmentId
output containerAppId string = profile.outputs.containerAppId
output managedIdentityResourceId string = managedIdentityResourceId
output decisionDigest string = decisionDigest
output sourceDigest string = sourceDigest
output executionEnabled bool = false
output secondaryScope string = validatedSecondaryScope
output secondaryVnetCidr string = validatedSecondaryVnetCidr
