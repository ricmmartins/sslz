// ============================================================================
// Management Groups
// Single management group with prod and nonprod subscriptions.
//
// This module deploys at TENANT scope and must be deployed separately from the
// main landing zone (which deploys at subscription scope).
//
// Usage:
//   az deployment tenant create \
//     --location <LOCATION> \
//     --template-file modules/management-groups.bicep \
//     --parameters \
//       companyName='<yourcompany>' \
//       prodSubscriptionId='<PROD_SUB_ID>' \
//       nonprodSubscriptionId='<NONPROD_SUB_ID>'
//
// Requires: Owner or Management Group Contributor on the Tenant Root Group.
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
