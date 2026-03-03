// ============================================================================
// Networking — VNet, Subnets, NSGs
// Self-contained networking per subscription. No hub, no peering.
// ============================================================================

@description('Azure region')
param location string

@description('VNet name')
param vnetName string

@description('VNet address prefix (e.g., 10.0.0.0/16 for prod, 10.1.0.0/16 for nonprod)')
param vnetAddressPrefix string

@description('Service delegation for the app subnet (e.g., Microsoft.Web/serverFarms for App Service, Microsoft.App/environments for Container Apps)')
param appSubnetDelegation string = 'Microsoft.Web/serverFarms'

@description('Resource tags')
param tags object

// ============================================================================
// Variables — Subnet address ranges
// ============================================================================

var baseOctet = split(split(vnetAddressPrefix, '.')[0], '/')[0]
var secondOctet = split(vnetAddressPrefix, '.')[1]

/*
  IMPORTANT:
  If AKS subnet is /20 starting at x.y.0.0/20, it covers x.y.0.0 - x.y.15.255.
  Therefore, app/data/shared must start at x.y.16.0+ to avoid overlap.
*/
var subnets = {
  aks: {
    name: 'snet-aks'
    addressPrefix: '${baseOctet}.${secondOctet}.0.0/20'     // 10.x.0.0/20
  }
  app: {
    name: 'snet-app'
    addressPrefix: '${baseOctet}.${secondOctet}.16.0/22'    // 10.x.16.0/22
  }
  data: {
    name: 'snet-data'
    addressPrefix: '${baseOctet}.${secondOctet}.20.0/22'    // 10.x.20.0/22
  }
  shared: {
    name: 'snet-shared'
    addressPrefix: '${baseOctet}.${secondOctet}.24.0/24'    // 10.x.24.0/24
  }
}

// ============================================================================
// NSGs — One per subnet, deny-all-inbound by default
// ============================================================================

resource nsgAks 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: 'nsg-${subnets.aks.name}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowAzureLoadBalancerInbound'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
      {
        name: 'AllowVNetInbound'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '*'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource nsgApp 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: 'nsg-${subnets.app.name}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource nsgData 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: 'nsg-${subnets.data.name}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowFromAksSubnet'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: subnets.aks.addressPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRanges: ['1433', '5432', '6380', '443'] // SQL Server, PostgreSQL, Redis SSL, HTTPS
        }
      }
      {
        name: 'AllowFromAppSubnet'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: subnets.app.addressPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRanges: ['1433', '5432', '6380', '443'] // SQL Server, PostgreSQL, Redis SSL, HTTPS
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource nsgShared 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: 'nsg-${subnets.shared.name}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// ============================================================================
// VNet with Subnets
// ============================================================================

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [vnetAddressPrefix]
    }
    subnets: [
      {
        name: subnets.aks.name
        properties: {
          addressPrefix: subnets.aks.addressPrefix
          networkSecurityGroup: { id: nsgAks.id }
        }
      }
      {
        name: subnets.app.name
        properties: {
          addressPrefix: subnets.app.addressPrefix
          networkSecurityGroup: { id: nsgApp.id }
          delegations: [
            {
              name: 'delegation-web'
              properties: {
                serviceName: appSubnetDelegation
              }
            }
          ]
        }
      }
      {
        name: subnets.data.name
        properties: {
          addressPrefix: subnets.data.addressPrefix
          networkSecurityGroup: { id: nsgData.id }
        }
      }
      {
        name: subnets.shared.name
        properties: {
          addressPrefix: subnets.shared.addressPrefix
          networkSecurityGroup: { id: nsgShared.id }
        }
      }
    ]
  }
}

// ============================================================================
// Outputs
// ============================================================================

output vnetId string = vnet.id
output vnetName string = vnet.name
output aksSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, subnets.aks.name)
output appSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, subnets.app.name)
output dataSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, subnets.data.name)
output sharedSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, subnets.shared.name)
