// ⚠️  EXAMPLE VALUES — copy to nonprod.local.bicepparam and customize before deploying.
using '../main.bicep'

param location = 'eastus2'
param companyName = 'mycompany'
param environment = 'nonprod'
param monthlyBudgetAmount = 2000
param budgetAlertEmails = [
  'platform-team@mycompany.com'
]
param deployNetworking = true
param budgetStartDate = '2026-03-01T00:00:00Z' // set to 1st of your deployment month
param enableDefenderForServers = false
param enableDefenderForContainers = false
param enableDefenderForDatabases = false
param securityContactEmail = 'security@mycompany.com'
param allowedLocations = [
  'eastus2'
  'centralus'
]
param logAnalyticsWorkspaceLocation = 'eastus2'
param defenderWorkspaceSharedSubscription = false
