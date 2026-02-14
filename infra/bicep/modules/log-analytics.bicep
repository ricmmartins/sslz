// ============================================================================
// Log Analytics Workspace
// Central monitoring for all resources in the subscription
// ============================================================================

@description('Azure region for the workspace')
param location string

@description('Name of the Log Analytics workspace')
param workspaceName string

@description('Data retention in days (30-730)')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

@description('Resource tags')
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    workspaceCapping: {
      dailyQuotaGb: 5 // Prevent runaway costs — adjust based on your ingestion
    }
  }
}

// NOTE: Activity Log diagnostic settings require subscription scope.
// This is handled by the policy assignment in policy-assignments.bicep
// (DeployIfNotExists policy: "Deploy Activity Log diagnostics to Log Analytics").

output workspaceId string = workspace.id
output workspaceName string = workspace.name
