// ⚠️  EXAMPLE VALUES — copy to prod.local.bicepparam and customize before deploying.
using '../main.bicep'

// ============================================================================
// SECTION 1: REQUIRED. Review and change every value in this section.
// ============================================================================
param companyName = 'mycompany'
param environment = 'prod'
param location = 'eastus2'
param securityContactEmail = 'security@mycompany.com'
param monthlyBudgetAmount = 5000
param budgetAlertEmails = [
  'platform-team@mycompany.com'
  'cto@mycompany.com'
]
param budgetStartDate = '2026-03-01T00:00:00Z' // must be the 1st of your deployment month

// ============================================================================
// SECTION 2: OPTIONAL. Defaults are defined in main.bicep (see @description).
// ============================================================================
param deployNetworking = true // false skips the VNet and networking resources
param enableDefenderForServers = true
param enableDefenderForContainers = false // set to true if running AKS
param enableDefenderForDatabases = true
param enableDefenderForStorage = false // opt in only when storage threat protection justifies the added cost
param allowedLocations = [
  'eastus2'
  'centralus' // DR region
]
param logAnalyticsWorkspaceLocation = 'eastus2'
param defenderWorkspaceSharedSubscription = false

// Other optional parameters (uncomment to override the default):
// param vnetAddressPrefix = '10.0.0.0/16'                       // must be a /16
// param appSubnetDelegation = 'Microsoft.Web/serverFarms'       // service that hosts apps in snet-app: 'Microsoft.Web/serverFarms' (App Service) or 'Microsoft.App/environments' (Container Apps)
// param logRetentionInDays = 90                                 // 30-730
// param logDailyQuotaGb = 5                                     // -1 = unlimited
// param existingLogAnalyticsWorkspaceId = ''                    // reuse a central workspace
// param enableDefenderForKeyVault = true
// param tags = { owner: 'platform-team' }
