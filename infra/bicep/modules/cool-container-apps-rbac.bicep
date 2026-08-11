targetScope = 'resourceGroup'

param keyVaultName string
param managedIdentityPrincipalId string
param keyVaultRoleDefinitionId string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource keyVaultSecretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentityPrincipalId, keyVaultRoleDefinitionId)
  scope: keyVault
  properties: {
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultRoleDefinitionId
  }
}
