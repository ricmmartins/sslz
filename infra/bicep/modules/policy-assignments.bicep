// ============================================================================
// Azure Policy Assignments
// Minimal policy baseline: security benchmark (audit), required tags, allowed locations
// ============================================================================

targetScope = 'subscription'

@description('Azure region for policy assignment managed identity')
param location string

@description('Allowed Azure regions for resource deployment')
param allowedLocations string[]

@description('Log Analytics workspace ID for diagnostic settings policy')
param logAnalyticsWorkspaceId string

// ============================================================================
// Built-in Policy Definition IDs
// ============================================================================

var policyDefinitions = {
  // Microsoft Cloud Security Benchmark
  mcsb: '/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8'
  // Allowed locations
  allowedLocations: '/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c'
  // Allowed locations for resource groups
  allowedLocationsRg: '/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988'
  // Require tag on resource groups
  requireTagOnRg: '/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025'
  // Inherit tag from resource group
  inheritTag: '/providers/Microsoft.Authorization/policyDefinitions/cd3aa116-8754-49c9-a813-ad46512ece54'
  // Deploy Activity Log diagnostics to Log Analytics
  activityLogDiag: '/providers/Microsoft.Authorization/policyDefinitions/2465583e-4e78-4c15-b6be-a36cbc7c8b0f'
}

// ============================================================================
// Microsoft Cloud Security Benchmark — Audit Mode
// ============================================================================

resource mcsbAssignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'mcsb-audit'
  properties: {
    displayName: 'Microsoft Cloud Security Benchmark (Audit)'
    description: 'Audit resources against Microsoft Cloud Security Benchmark. Does not block deployments.'
    policyDefinitionId: policyDefinitions.mcsb
    enforcementMode: 'Default'
  }
}

// ============================================================================
// Allowed Locations — Deny Mode
// ============================================================================

resource allowedLocationsAssignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'allowed-locations'
  properties: {
    displayName: 'Allowed Locations'
    description: 'Restrict resource deployment to approved regions only.'
    policyDefinitionId: policyDefinitions.allowedLocations
    enforcementMode: 'Default'
    parameters: {
      listOfAllowedLocations: {
        value: allowedLocations
      }
    }
  }
}

resource allowedLocationsRgAssignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'allowed-locations-rg'
  properties: {
    displayName: 'Allowed Locations for Resource Groups'
    description: 'Restrict resource group creation to approved regions only.'
    policyDefinitionId: policyDefinitions.allowedLocationsRg
    enforcementMode: 'Default'
    parameters: {
      listOfAllowedLocations: {
        value: allowedLocations
      }
    }
  }
}

// ============================================================================
// Required Tags — Deny Mode
// ============================================================================

resource requireEnvironmentTag 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'require-env-tag-rg'
  properties: {
    displayName: 'Require environment tag on resource groups'
    description: 'All resource groups must have an environment tag for cost tracking.'
    policyDefinitionId: policyDefinitions.requireTagOnRg
    enforcementMode: 'Default'
    parameters: {
      tagName: {
        value: 'environment'
      }
    }
  }
}

resource requireTeamTag 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'require-team-tag-rg'
  properties: {
    displayName: 'Require team tag on resource groups'
    description: 'All resource groups must have a team tag for ownership tracking.'
    policyDefinitionId: policyDefinitions.requireTagOnRg
    enforcementMode: 'Default'
    parameters: {
      tagName: {
        value: 'team'
      }
    }
  }
}

// ============================================================================
// Tag Inheritance — Modify Mode
// ============================================================================

resource inheritEnvironmentTag 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'inherit-env-tag'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Inherit environment tag from resource group'
    description: 'Automatically propagate the environment tag from resource groups to child resources.'
    policyDefinitionId: policyDefinitions.inheritTag
    enforcementMode: 'Default'
    parameters: {
      tagName: {
        value: 'environment'
      }
    }
  }
}

resource inheritTeamTag 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'inherit-team-tag'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Inherit team tag from resource group'
    description: 'Automatically propagate the team tag from resource groups to child resources.'
    policyDefinitionId: policyDefinitions.inheritTag
    enforcementMode: 'Default'
    parameters: {
      tagName: {
        value: 'team'
      }
    }
  }
}

// ============================================================================
// Activity Log Diagnostics — DeployIfNotExists
// ============================================================================

resource activityLogDiagAssignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'activity-log-diag'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Deploy Activity Log diagnostics to Log Analytics'
    description: 'Automatically configure Activity Log to stream to Log Analytics workspace.'
    policyDefinitionId: policyDefinitions.activityLogDiag
    enforcementMode: 'Default'
    parameters: {
      logAnalytics: {
        value: logAnalyticsWorkspaceId
      }
    }
  }
}
