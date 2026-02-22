targetScope = 'subscription'

// ============================================================================
// Azure Landing Zone for Startups — Main Orchestrator
// Deploys: Resource Groups, Log Analytics, Networking, Budgets, Defender, Policies
// ============================================================================

@description('Primary Azure region for all resources')
param location string

@description('Company name used for naming resources (2-10 lowercase alphanumeric characters)')
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

@description('Allowed Azure regions for resource deployment')
param allowedLocations string[] = [location]

@description('Tags applied to all resources')
param tags object = {
  environment: environment
  managedBy: 'bicep'
  project: 'landing-zone'
}

// ============================================================================
// Variables
// ============================================================================

var prefix = '${companyName}-${environment}'
var rgMonitoring = 'rg-${prefix}-monitoring'
var rgNetworking = 'rg-${prefix}-networking'

// ============================================================================
// Resource Groups
// ============================================================================

resource rgMonitoringRes 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgMonitoring
  location: location
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

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'deploy-log-analytics'
  scope: rgMonitoringRes
  params: {
    location: location
    workspaceName: 'law-${prefix}'
    retentionInDays: 90
    dailyQuotaGb: 5
    tags: tags
  }
}

// ============================================================================
// Networking — VNet, Subnets, NSGs
// ============================================================================

module networking 'modules/networking.bicep' = if (deployNetworking) {
  name: 'deploy-networking'
  scope: rgNetworkingRes
  params: {
    location: location
    vnetName: 'vnet-${prefix}'
    vnetAddressPrefix: environment == 'prod' ? '10.0.0.0/16' : '10.1.0.0/16'
    appSubnetDelegation: appSubnetDelegation
    tags: tags
  }
}

// ============================================================================
// Security — Microsoft Defender for Cloud
// ============================================================================

module defender 'modules/defender.bicep' = {
  name: 'deploy-defender'
  params: {
    enableDefenderForServers: enableDefenderForServers
    enableDefenderForContainers: enableDefenderForContainers
    enableDefenderForDatabases: enableDefenderForDatabases
    enableDefenderForKeyVault: enableDefenderForKeyVault
    securityContactEmail: securityContactEmail
  }
}

// ============================================================================
// Cost Management — Budget Alerts
// ============================================================================

module budgets 'modules/budgets.bicep' = {
  name: 'deploy-budgets'
  params: {
    budgetName: 'budget-${prefix}-monthly'
    amount: monthlyBudgetAmount
    contactEmails: budgetAlertEmails
  }
}

// ============================================================================
// Activity Log — Diagnostic Setting (immediate, not waiting for DINE policy)
// ============================================================================

resource activityLogDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-activity-log-to-law'
  properties: {
    workspaceId: logAnalytics.outputs.workspaceId
    logs: [
      { category: 'Administrative', enabled: true }
      { category: 'Security', enabled: true }
      { category: 'Alert', enabled: true }
      { category: 'Policy', enabled: true }
    ]
  }
}

// ============================================================================
// Governance — Azure Policies
// ============================================================================

module policies 'modules/policy-assignments.bicep' = {
  name: 'deploy-policies'
  params: {
    location: location
    allowedLocations: allowedLocations
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Monitoring resource group name')
output resourceGroupMonitoring string = rgMonitoring
@description('Networking resource group name')
output resourceGroupNetworking string = deployNetworking ? rgNetworking : ''
@description('Log Analytics workspace resource ID')
output logAnalyticsWorkspaceId string = logAnalytics.outputs.workspaceId
@description('Log Analytics workspace name')
output logAnalyticsWorkspaceName string = logAnalytics.outputs.workspaceName
@description('Virtual network resource ID')
output vnetId string = deployNetworking ? networking.outputs.vnetId : ''
@description('Virtual network name')
output vnetName string = deployNetworking ? networking.outputs.vnetName : ''
