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

// Private mode requires two distinct subnets in the same VNet:
// - a dedicated /27-or-larger subnet delegated to Microsoft.App/environments
// - a separate subnet for SQL and Redis Private Endpoints
// param deployPrivateEndpoints = true
// param vnetId = '/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>'
// param containerAppsInfrastructureSubnetId = '${vnetId}/subnets/snet-container-apps'
// param privateEndpointSubnetId = '${vnetId}/subnets/snet-private-endpoints'
