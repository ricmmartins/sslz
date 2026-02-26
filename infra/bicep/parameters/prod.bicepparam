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
param enableDefenderForServers = true
param enableDefenderForContainers = false // set to true if running AKS
param enableDefenderForDatabases = true
param securityContactEmail = 'security@mycompany.com'
param allowedLocations = [
  'eastus2'
  'centralus' // DR region
]
// Budget start date — set explicitly after first deployment to avoid re-deployment drift.
// Format: YYYY-MM-DD (must be the 1st of a month). Defaults to 1st of current month if omitted.
// param budgetStartDate = '2026-02-01'
