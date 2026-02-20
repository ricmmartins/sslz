using './main.bicep'

// IMPORTANT: Copy this file to a .local.bicepparam before adding real values.
// Files matching *.local.bicepparam are git-ignored and won't be committed.
// Example: cp main.bicepparam main.local.bicepparam

param appName = 'mysaas'
param environment = 'prod'
param apiImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param webImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param sqlAdminLogin = '<replace-with-admin-username>'
// In production, use Key Vault references instead of inline passwords.
// See: https://learn.microsoft.com/azure/azure-resource-manager/bicep/key-vault-parameter
param sqlAdminPassword = '<replace-with-secure-password>'
