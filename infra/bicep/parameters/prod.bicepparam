// ⚠️  EXAMPLE VALUES — copy to prod.local.bicepparam and customize before deploying.
using '../main.bicep'

param location = 'eastus2'
param companyName = 'mycompany'
param environment = 'prod'
param monthlyBudgetAmount = 5000
param budgetAlertEmails = [
  'platform-team@mycompany.com'
  'cto@mycompany.com'
]
param deployNetworking = true
param budgetStartDate = '2026-03-01T00:00:00Z' // set to 1st of your deployment month
param enableDefenderForServers = true
param enableDefenderForContainers = false // set to true if running AKS
param enableDefenderForDatabases = true
param enableDefenderForStorage = false // opt in only when storage threat protection justifies the added cost
param securityContactEmail = 'security@mycompany.com'
param allowedLocations = [
  'eastus2'
  'centralus' // DR region
]
param logAnalyticsWorkspaceLocation = 'eastus2'
param defenderWorkspaceSharedSubscription = false
