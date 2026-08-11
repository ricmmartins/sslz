targetScope = 'subscription'

// ============================================================================
// Startup-Scale Landing Zone (SSLZ) — Main Orchestrator
// https://startupscalelanding.zone
// Deploys: Resource Groups, Log Analytics, Networking, Budgets, Defender, Policies
//
// NOTE: Management Groups
// -----------------------
// The management-groups module (modules/management-groups.bicep) is NOT called
// from this file because it requires *tenant-level* deployment scope, while this
// file deploys at subscription scope.
//
// Deploy management groups separately BEFORE running this main deployment:
//
//   az deployment tenant create \
//     --location <LOCATION> \
//     --template-file modules/management-groups.bicep \
//     --parameters \
//       companyName='<yourcompany>' \
//       prodSubscriptionId='<PROD_SUB_ID>' \
//       nonprodSubscriptionId='<NONPROD_SUB_ID>'
//
// After the management group exists, deploy this file per subscription:
//
//   az deployment sub create \
//     --location <LOCATION> \
//     --template-file main.bicep \
//     --parameters parameters/prod.local.bicepparam
//
// See: modules/management-groups.bicep
// ============================================================================

@description('Primary Azure region for all resources')
param location string

@description('Company name used for naming resources (2-10 lowercase alphanumeric characters). Must be ≤ 10 characters — keep this short if using `azd env new`.')
@minLength(2)
@maxLength(10)
param companyName string

@description('Environment: prod or nonprod')
@allowed(['prod', 'nonprod'])
param environment string

@description('Monthly budget amount in USD')
@minValue(1)
param monthlyBudgetAmount int

@description('Email addresses for budget alerts')
@minLength(1)
param budgetAlertEmails string[]

@description('Deploy VNet and networking resources')
param deployNetworking bool = true

@description('VNet address space — must be a /16 CIDR block. Subnet layout assumes /16.')
param vnetAddressPrefix string = environment == 'prod' ? '10.0.0.0/16' : '10.1.0.0/16'

@description('Service delegation for the app subnet (e.g., Microsoft.Web/serverFarms for App Service, Microsoft.App/environments for Container Apps)')
param appSubnetDelegation string = 'Microsoft.Web/serverFarms'

@description('Enable Defender for Servers P2 (recommended for prod)')
param enableDefenderForServers bool = environment == 'prod'

@description('Enable Defender for Containers (recommended if running AKS)')
param enableDefenderForContainers bool = false

@description('Enable Defender for Databases (recommended for prod)')
param enableDefenderForDatabases bool = environment == 'prod'

@description('Enable Defender for Key Vault (recommended, low cost)')
param enableDefenderForKeyVault bool = true

@description('Email address for Defender for Cloud security alerts')
param securityContactEmail string

@description('Budget start date (must be the 1st of a month in ISO 8601 format, e.g., 2026-01-01T00:00:00Z). Set this to a fixed date — using dynamic values causes redeployment failures because Azure rejects changes to startDate on existing budgets.')
param budgetStartDate string

@description('Allowed Azure regions for resource deployment')
param allowedLocations string[] = [location]

@description('Log Analytics workspace retention in days')
@minValue(30)
@maxValue(730)
param logRetentionInDays int = 90

@description('Log Analytics daily ingestion quota in GB (-1 = unlimited)')
param logDailyQuotaGb int = 5

@description('Explicit effective Log Analytics workspace region. New workspaces must use the selected primary region; approved existing central workspaces may use another allowed region.')
param logAnalyticsWorkspaceLocation string = location

@description('Approved existing Log Analytics workspace resource ID. Leave empty to create the deterministic regional workspace.')
param existingLogAnalyticsWorkspaceId string = ''

@description('Bind Defender for Servers to the explicit workspace instead of allowing an Azure default workspace.')
param configureDefenderWorkspace bool = enableDefenderForServers

@description('The same-subscription prod artifact owns the reviewed Defender workspace association for this environment.')
param defenderWorkspaceAssociationManagedExternally bool = false

@description('Whether prod and nonprod target the same subscription and must share one approved existing Defender workspace.')
param defenderWorkspaceSharedSubscription bool = false

@description('Tags applied to all resources. Override to change team name or add custom tags.')
param tags object = {
  environment: environment
  managedBy: 'bicep'
  project: 'landing-zone'
  team: 'platform' // change to your team name
}

// ============================================================================
// Variables
// ============================================================================

var prefix = '${companyName}-${environment}'
var rgMonitoring = 'rg-${prefix}-monitoring'
var rgNetworking = 'rg-${prefix}-networking'
var useExistingLogAnalyticsWorkspace = !empty(existingLogAnalyticsWorkspaceId)
var workspaceRegionGuard = contains(allowedLocations, logAnalyticsWorkspaceLocation)
  ? ''
  : fail('logAnalyticsWorkspaceLocation must be included in allowedLocations.')
var primaryRegionPolicyGuard = contains(allowedLocations, location)
  ? ''
  : fail('The selected primary location must be included in allowedLocations.')
var workspacePrimaryGuard = useExistingLogAnalyticsWorkspace || logAnalyticsWorkspaceLocation == location
  ? ''
  : fail('A new Log Analytics workspace must use the selected primary location.')
var workspaceReferenceIsSameSubscription = startsWith(toLower(existingLogAnalyticsWorkspaceId), '/subscriptions/${toLower(subscription().subscriptionId)}/resourcegroups/')
var workspaceReferenceIsLogAnalytics = contains(toLower(existingLogAnalyticsWorkspaceId), '/providers/microsoft.operationalinsights/workspaces/')
var workspaceReferenceHasExactSegments = length(split(existingLogAnalyticsWorkspaceId, '/')) == 9 && !empty(last(split(existingLogAnalyticsWorkspaceId, '/')))
var workspaceReferenceGuard = !useExistingLogAnalyticsWorkspace || (workspaceReferenceIsSameSubscription && workspaceReferenceIsLogAnalytics && workspaceReferenceHasExactSegments)
  ? ''
  : fail('existingLogAnalyticsWorkspaceId must be a Log Analytics workspace resource ID in the deployment subscription.')
var workspaceSelectionValid = enableDefenderForServers
  ? configureDefenderWorkspace != defenderWorkspaceAssociationManagedExternally
  : !configureDefenderWorkspace && !defenderWorkspaceAssociationManagedExternally
var workspaceSelectionGuard = workspaceSelectionValid
  ? ''
  : fail('Exactly one Defender workspace association owner is required when Defender for Servers is enabled.')
var externalWorkspaceReferenceGuard = !defenderWorkspaceAssociationManagedExternally || useExistingLogAnalyticsWorkspace
  ? ''
  : fail('An externally managed Defender workspace association requires an approved existing workspace reference.')
var prodOwnsSharedWorkspace = environment == 'prod' && configureDefenderWorkspace && !defenderWorkspaceAssociationManagedExternally
var nonprodUsesSharedWorkspace = environment == 'nonprod' && !configureDefenderWorkspace && defenderWorkspaceAssociationManagedExternally
var sharedEnvironmentRoleValid = prodOwnsSharedWorkspace || nonprodUsesSharedWorkspace
var sharedWorkspaceOwnershipValid = !enableDefenderForServers || !defenderWorkspaceSharedSubscription
  ? !defenderWorkspaceAssociationManagedExternally
  : useExistingLogAnalyticsWorkspace && sharedEnvironmentRoleValid
var sharedWorkspaceOwnershipGuard = sharedWorkspaceOwnershipValid
  ? ''
  : fail('A shared subscription requires one approved existing workspace, prod ownership, and nonprod external management.')
resource existingLogAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = if (useExistingLogAnalyticsWorkspace) {
  name: last(split(existingLogAnalyticsWorkspaceId, '/'))
  scope: resourceGroup(split(existingLogAnalyticsWorkspaceId, '/')[2], split(existingLogAnalyticsWorkspaceId, '/')[4])
}
var existingWorkspaceLocationGuard = !useExistingLogAnalyticsWorkspace || toLower(existingLogAnalyticsWorkspace!.location) == toLower(logAnalyticsWorkspaceLocation)
  ? ''
  : fail('The existing Log Analytics workspace actual location must match logAnalyticsWorkspaceLocation.')
var effectiveLogAnalyticsWorkspaceId = useExistingLogAnalyticsWorkspace
  ? '${existingLogAnalyticsWorkspaceId}${workspaceRegionGuard}${primaryRegionPolicyGuard}${workspacePrimaryGuard}${workspaceReferenceGuard}${workspaceSelectionGuard}${externalWorkspaceReferenceGuard}${sharedWorkspaceOwnershipGuard}${existingWorkspaceLocationGuard}'
  : logAnalytics!.outputs.workspaceId
var effectiveLogAnalyticsWorkspaceName = useExistingLogAnalyticsWorkspace
  ? last(split(existingLogAnalyticsWorkspaceId, '/'))
  : logAnalytics!.outputs.workspaceName
var effectiveMonitoringResourceGroup = useExistingLogAnalyticsWorkspace
  ? split(existingLogAnalyticsWorkspaceId, '/')[4]
  : rgMonitoring

// ============================================================================
// Resource Groups
// ============================================================================

resource rgMonitoringRes 'Microsoft.Resources/resourceGroups@2024-03-01' = if (!useExistingLogAnalyticsWorkspace) {
  name: '${rgMonitoring}${workspaceRegionGuard}${primaryRegionPolicyGuard}${workspacePrimaryGuard}${workspaceReferenceGuard}${workspaceSelectionGuard}${externalWorkspaceReferenceGuard}${sharedWorkspaceOwnershipGuard}'
  location: logAnalyticsWorkspaceLocation
  tags: tags
}

resource rgNetworkingRes 'Microsoft.Resources/resourceGroups@2024-03-01' = if (deployNetworking) {
  name: rgNetworking
  location: location
  tags: tags
}

// ============================================================================
// Monitoring — Log Analytics Workspace
// ============================================================================

module logAnalytics 'modules/log-analytics.bicep' = if (!useExistingLogAnalyticsWorkspace) {
  name: 'deploy-log-analytics-${environment}'
  scope: rgMonitoringRes
  params: {
    location: logAnalyticsWorkspaceLocation
    workspaceName: 'law-${prefix}'
    retentionInDays: logRetentionInDays
    dailyQuotaGb: logDailyQuotaGb
    tags: tags
  }
}

// ============================================================================
// Networking — VNet, Subnets, NSGs
// ============================================================================

module networking 'modules/networking.bicep' = if (deployNetworking) {
  name: 'deploy-networking-${environment}'
  scope: rgNetworkingRes
  params: {
    location: location
    vnetName: 'vnet-${prefix}'
    vnetAddressPrefix: vnetAddressPrefix
    appSubnetDelegation: appSubnetDelegation
    includeContainerAppsSubnet: false
    tags: tags
  }
}

// ============================================================================
// Security — Microsoft Defender for Cloud
// ============================================================================

module defender 'modules/defender.bicep' = {
  name: 'deploy-defender-${environment}'
  params: {
    enableDefenderForServers: enableDefenderForServers
    enableDefenderForContainers: enableDefenderForContainers
    enableDefenderForDatabases: enableDefenderForDatabases
    enableDefenderForKeyVault: enableDefenderForKeyVault
    securityContactEmail: securityContactEmail
    configureDefenderWorkspace: configureDefenderWorkspace
    logAnalyticsWorkspaceId: effectiveLogAnalyticsWorkspaceId
  }
}

// ============================================================================
// Cost Management — Budget Alerts
// ============================================================================

module budgets 'modules/budgets.bicep' = {
  name: 'deploy-budgets-${environment}'
  params: {
    budgetName: 'budget-${prefix}-monthly'
    amount: monthlyBudgetAmount
    contactEmails: budgetAlertEmails
    startDate: budgetStartDate
  }
}

// ============================================================================
// Activity Log — Diagnostic Setting (immediate, not waiting for DINE policy)
// ============================================================================

resource activityLogDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-activity-log-to-law'
  properties: {
    workspaceId: effectiveLogAnalyticsWorkspaceId
    logs: [
      { category: 'Administrative', enabled: true }
      { category: 'Security', enabled: true }
      { category: 'Alert', enabled: true }
      { category: 'Policy', enabled: true }
      { category: 'ServiceHealth', enabled: true }
      { category: 'Recommendation', enabled: true }
      { category: 'Autoscale', enabled: true }
      { category: 'ResourceHealth', enabled: true }
    ]
  }
}

// ============================================================================
// Governance — Azure Policies
// ============================================================================

module policies 'modules/policy-assignments.bicep' = {
  name: 'deploy-policies-${environment}'
  params: {
    location: location
    allowedLocations: allowedLocations
    logAnalyticsWorkspaceId: effectiveLogAnalyticsWorkspaceId
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Monitoring resource group name')
output resourceGroupMonitoring string = effectiveMonitoringResourceGroup
@description('Networking resource group name')
output resourceGroupNetworking string = deployNetworking ? rgNetworking : ''
@description('Log Analytics workspace resource ID')
output logAnalyticsWorkspaceId string = effectiveLogAnalyticsWorkspaceId
@description('Log Analytics workspace name')
output logAnalyticsWorkspaceName string = effectiveLogAnalyticsWorkspaceName
@description('Virtual network resource ID')
output vnetId string = deployNetworking ? networking!.outputs.vnetId : ''
@description('Virtual network name')
output vnetName string = deployNetworking ? networking!.outputs.vnetName : ''
