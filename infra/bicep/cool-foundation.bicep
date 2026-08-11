targetScope = 'subscription'

@description('Secondary Azure region for the nonproduction cool foundation')
param location string

@description('Company name used for deterministic resource naming')
@minLength(2)
@maxLength(10)
param companyName string

@description('The cool foundation is restricted to nonproduction')
@allowed(['nonprod'])
param environment string = 'nonprod'

@description('Primary VNet CIDR used only to prove address-space isolation')
param primaryVnetAddressPrefix string

@description('Non-overlapping secondary VNet CIDR')
param secondaryVnetAddressPrefix string

@description('Service delegation retained for later profile-specific modules')
param appSubnetDelegation string = 'Microsoft.Web/serverFarms'

@description('Log Analytics workspace retention in days')
@minValue(30)
@maxValue(730)
param logRetentionInDays int = 90

@description('Log Analytics daily ingestion quota in GB (-1 = unlimited)')
param logDailyQuotaGb int = 5

@description('Tags applied to secondary foundation resources')
param tags object = {
  environment: environment
  managedBy: 'bicep'
  project: 'landing-zone'
  regionalRole: 'secondary'
  deploymentMode: 'cool-infrastructure'
}

var regionalSuffix = toLower(replace(location, ' ', ''))
var prefix = '${companyName}-${environment}-cool-${regionalSuffix}'
var monitoringResourceGroupName = 'rg-${prefix}-monitoring'
var networkingResourceGroupName = 'rg-${prefix}-networking'
var primaryRange = parseCidr(primaryVnetAddressPrefix)
var secondaryRange = parseCidr(secondaryVnetAddressPrefix)
var primaryRangeIsIpv4 = length(split(primaryRange.network, '.')) == 4
var secondaryRangeIsIpv4 = length(split(secondaryRange.network, '.')) == 4
var primaryNetworkOctets = primaryRangeIsIpv4
  ? split(primaryRange.network, '.')
  : fail('primaryVnetAddressPrefix must be a valid IPv4 CIDR.')
var primaryBroadcastOctets = primaryRangeIsIpv4
  ? split(primaryRange.broadcast, '.')
  : fail('primaryVnetAddressPrefix must be a valid IPv4 CIDR.')
var secondaryNetworkOctets = secondaryRangeIsIpv4
  ? split(secondaryRange.network, '.')
  : fail('secondaryVnetAddressPrefix must be a valid IPv4 CIDR.')
var secondaryBroadcastOctets = secondaryRangeIsIpv4
  ? split(secondaryRange.broadcast, '.')
  : fail('secondaryVnetAddressPrefix must be a valid IPv4 CIDR.')
var primaryNetworkValue = int(primaryNetworkOctets[0]) * 16777216 + int(primaryNetworkOctets[1]) * 65536 + int(primaryNetworkOctets[2]) * 256 + int(primaryNetworkOctets[3])
var primaryBroadcastValue = int(primaryBroadcastOctets[0]) * 16777216 + int(primaryBroadcastOctets[1]) * 65536 + int(primaryBroadcastOctets[2]) * 256 + int(primaryBroadcastOctets[3])
var secondaryNetworkValue = int(secondaryNetworkOctets[0]) * 16777216 + int(secondaryNetworkOctets[1]) * 65536 + int(secondaryNetworkOctets[2]) * 256 + int(secondaryNetworkOctets[3])
var secondaryBroadcastValue = int(secondaryBroadcastOctets[0]) * 16777216 + int(secondaryBroadcastOctets[1]) * 65536 + int(secondaryBroadcastOctets[2]) * 256 + int(secondaryBroadcastOctets[3])
var addressSpacesOverlap = primaryNetworkValue <= secondaryBroadcastValue && secondaryNetworkValue <= primaryBroadcastValue
var validatedSecondaryVnetAddressPrefix = !addressSpacesOverlap
  ? secondaryVnetAddressPrefix
  : fail('primaryVnetAddressPrefix and secondaryVnetAddressPrefix must not overlap.')

resource monitoringResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: monitoringResourceGroupName
  location: location
  tags: tags
}

resource networkingResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: networkingResourceGroupName
  location: location
  tags: tags
}

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'deploy-cool-log-analytics-${regionalSuffix}'
  scope: monitoringResourceGroup
  params: {
    location: location
    workspaceName: 'law-${prefix}'
    retentionInDays: logRetentionInDays
    dailyQuotaGb: logDailyQuotaGb
    tags: tags
  }
}

module networking 'modules/networking.bicep' = {
  name: 'deploy-cool-networking-${regionalSuffix}'
  scope: networkingResourceGroup
  params: {
    location: location
    vnetName: 'vnet-${prefix}'
    vnetAddressPrefix: validatedSecondaryVnetAddressPrefix
    appSubnetDelegation: appSubnetDelegation
    tags: tags
  }
}

@description('Primary CIDR retained in the compiled representation for review')
output primaryVnetAddressPrefix string = primaryVnetAddressPrefix
@description('Secondary CIDR represented by this foundation')
output secondaryVnetAddressPrefix string = secondaryVnetAddressPrefix
@description('Secondary monitoring resource group')
output resourceGroupMonitoring string = monitoringResourceGroup.name
@description('Secondary networking resource group')
output resourceGroupNetworking string = networkingResourceGroup.name
@description('Secondary Log Analytics workspace')
output logAnalyticsWorkspaceId string = logAnalytics.outputs.workspaceId
@description('Secondary virtual network')
output vnetId string = networking.outputs.vnetId
