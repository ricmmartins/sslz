using './main.bicep'

param appName = 'myaiapp'
param environment = 'prod'
param systemNodeVmSize = 'Standard_D4s_v5'
param gpuNodeVmSize = 'Standard_NC6s_v3'
param gpuUseSpot = true
param sshPublicKey = '<replace-with-your-ssh-public-key>'
