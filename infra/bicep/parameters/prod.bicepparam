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
