using './main.bicep'

param appName = 'mysaas'
param environment = 'prod'
param apiImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param webImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param sqlAdminPassword = '<replace-with-secure-password>'
