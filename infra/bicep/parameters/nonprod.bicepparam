using '../main.bicep'

param location = 'eastus2'
param companyName = 'mycompany'
param environment = 'nonprod'
param monthlyBudgetAmount = 2000
param budgetAlertEmails = [
  'platform-team@mycompany.com'
]
param deployNetworking = true
param enableDefenderForServers = false
param enableDefenderForContainers = false
param enableDefenderForDatabases = false
param securityContactEmail = 'security@mycompany.com'
param allowedLocations = [
  'eastus2'
  'centralus'
]
// Budget start date — set explicitly after first deployment to avoid re-deployment drift.
// Format: YYYY-MM-DD (must be the 1st of a month). Defaults to 1st of current month if omitted.
// param budgetStartDate = '2026-02-01'
