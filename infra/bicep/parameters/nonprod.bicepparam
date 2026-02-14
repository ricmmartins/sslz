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
param allowedLocations = [
  'eastus2'
  'centralus'
]
