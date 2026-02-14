// ============================================================================
// Management Groups
// Single management group with prod and nonprod subscriptions
// Deploy at tenant scope: az deployment tenant create
// ============================================================================

targetScope = 'tenant'

@description('Company name for the management group')
param companyName string

@description('Display name for the management group')
param displayName string = '${companyName} Landing Zone'

@description('Production subscription ID')
param prodSubscriptionId string

@description('Non-production subscription ID')
param nonprodSubscriptionId string

// ============================================================================
// Management Group
// ============================================================================

resource mg 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: 'mg-${companyName}'
  properties: {
    displayName: displayName
  }
}

// ============================================================================
// Subscription Placement
// ============================================================================

resource prodSubscription 'Microsoft.Management/managementGroups/subscriptions@2023-04-01' = {
  parent: mg
  name: prodSubscriptionId
}

resource nonprodSubscription 'Microsoft.Management/managementGroups/subscriptions@2023-04-01' = {
  parent: mg
  name: nonprodSubscriptionId
}

// ============================================================================
// Outputs
// ============================================================================

output managementGroupId string = mg.id
output managementGroupName string = mg.name
