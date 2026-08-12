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

@description('Include the dedicated nonproduction Container Apps cool-profile subnet')
param includeContainerAppsSubnet bool = false

@description('Explicit AKS ingress mode')
@allowed(['not-applicable', 'private', 'public-azure-load-balancer'])
param aksIngressMode string = 'not-applicable'

@description('Reviewed public frontend port; zero when AKS public ingress is not selected')
param aksIngressFrontendPort int = 0

@description('Exact AKS backend NodePort; zero when AKS public ingress is not selected')
param aksIngressBackendNodePort int = 0

@description('Azure Load Balancer health probe service tag; empty when public ingress is not selected')
param aksIngressHealthProbeSourcePrefix string = ''

@description('Reviewed public client source prefixes for the exact NodePort')
param aksIngressSourcePrefixes string[] = []

@description('Existing AKS NSG priorities that generated rules must not collide with')
param aksIngressReservedNsgPriorities int[] = []

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
var baseSubnets = {
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
var subnets = union(baseSubnets, includeContainerAppsSubnet ? {
  containerApps: {
    name: 'snet-container-apps'
    addressPrefix: '${baseOctet}.${secondOctet}.32.0/23'    // 10.x.32.0/23
  }
} : {})
var aksPublicIngress = aksIngressMode == 'public-azure-load-balancer'
var aksPrivateIngress = aksIngressMode == 'private'
var aksIngressPriorityCollision = contains(aksIngressReservedNsgPriorities, 120) || contains(aksIngressReservedNsgPriorities, 4096) || (aksPublicIngress && (contains(aksIngressReservedNsgPriorities, 100) || contains(aksIngressReservedNsgPriorities, 110)))
var validAksReservedPriorities = filter(
  aksIngressReservedNsgPriorities,
  priority => priority >= 100 && priority <= 4096
)
var aksReservedPrioritiesValid = length(union(aksIngressReservedNsgPriorities, aksIngressReservedNsgPriorities)) == length(aksIngressReservedNsgPriorities) && length(validAksReservedPriorities) == length(aksIngressReservedNsgPriorities)
var parsedAksSourcePrefixes = map(
  aksIngressSourcePrefixes,
  prefix => prefix == 'Internet' ? 'Internet' : parseCidr(prefix).netmask
)
var provenAksSourcePrefixes = filter(
  aksIngressSourcePrefixes,
  prefix => prefix == 'Internet' || (contains(prefix, '.') && contains(prefix, '/'))
)
var uniqueAksSourcePrefixes = union(aksIngressSourcePrefixes, aksIngressSourcePrefixes)
var publicAksIngressShapeValid = (aksIngressFrontendPort == 80 || aksIngressFrontendPort == 443) && aksIngressBackendNodePort >= 30000 && aksIngressBackendNodePort <= 32767 && !empty(aksIngressSourcePrefixes) && length(uniqueAksSourcePrefixes) == length(aksIngressSourcePrefixes) && aksIngressHealthProbeSourcePrefix == 'AzureLoadBalancer' && length(parsedAksSourcePrefixes) == length(aksIngressSourcePrefixes) && length(provenAksSourcePrefixes) == length(aksIngressSourcePrefixes)
var aksIngressShapeValid = aksIngressMode == 'not-applicable'
  ? aksIngressFrontendPort == 0 && aksIngressBackendNodePort == 0 && empty(aksIngressHealthProbeSourcePrefix) && empty(aksIngressSourcePrefixes)
  : aksPrivateIngress
    ? aksIngressFrontendPort == 0 && aksIngressBackendNodePort == 0 && empty(aksIngressHealthProbeSourcePrefix) && empty(aksIngressSourcePrefixes)
    : publicAksIngressShapeValid
var aksIngressGuard = aksIngressShapeValid && aksReservedPrioritiesValid && !aksIngressPriorityCollision
  ? ''
  : fail('AKS ingress must use the supported private or exact public Azure Load Balancer contract with collision-free NSG priorities.')
var legacyAksRules = [
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
var privateAksRules = [
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
var publicAksRules = [
  {
    name: 'AllowAzureLoadBalancerHealthProbe'
    properties: {
      priority: 100
      direction: 'Inbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourceAddressPrefix: 'AzureLoadBalancer'
      sourcePortRange: '*'
      destinationAddressPrefix: '*'
      destinationPortRange: string(aksIngressBackendNodePort)
    }
  }
  {
    name: 'AllowApprovedPublicIngress'
    properties: {
      priority: 110
      direction: 'Inbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourceAddressPrefixes: sort(aksIngressSourcePrefixes, (left, right) => left < right)
      sourcePortRange: '*'
      destinationAddressPrefix: '*'
      destinationPortRange: string(aksIngressBackendNodePort)
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
var aksSecurityRules = aksIngressMode == 'not-applicable'
  ? legacyAksRules
  : aksPrivateIngress
    ? privateAksRules
    : publicAksRules

// ============================================================================
// NSGs — One per subnet, deny-all-inbound by default
// ============================================================================

resource nsgAks 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: 'nsg-${subnets.aks.name}${aksIngressGuard}'
  location: location
  tags: tags
  properties: {
    securityRules: aksSecurityRules
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

resource nsgContainerApps 'Microsoft.Network/networkSecurityGroups@2024-01-01' = if (includeContainerAppsSubnet) {
  name: 'nsg-${subnets.containerApps.name}'
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
    subnets: concat([
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
    ], includeContainerAppsSubnet ? [
      {
        name: subnets.containerApps.name
        properties: {
          addressPrefix: subnets.containerApps.addressPrefix
          networkSecurityGroup: { id: nsgContainerApps.id }
        }
      }
    ] : [])
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
output containerAppsSubnetId string = includeContainerAppsSubnet
  ? resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, subnets.containerApps.name)
  : ''
output aksIngressNsgRules array = aksSecurityRules
