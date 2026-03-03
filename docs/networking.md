---
layout: page
title: "Networking Deep Dive"
nav_order: 2
description: "VNet design, NSGs, and when you actually need a hub"
---

# Networking Deep Dive

> See also: [Architecture Decisions](architecture.md#networking) for details on why this layout was chosen.

## Do You Even Need a VNet?

Seriously. If your entire stack is:
- Azure Container Apps or App Service (with built-in auth)
- Azure SQL or Cosmos DB (with service-level firewall)
- Azure Storage (with service-level firewall)
- Azure Cache for Redis (with access keys + TLS)

Then you can run production without a VNet. Use service-level firewalls to restrict access to your app's outbound IPs and your team's office/VPN IPs.

**Move to VNets when:**
- You need Private Endpoints (usually when an enterprise customer's security questionnaire asks "is your database on a private network?")
- You're running AKS (requires a VNet)
- You need VNet integration for App Service/Container Apps (to reach private resources)
- Compliance mandates network-level isolation

## VNet Design

### Address Space

| VNet | CIDR | Available IPs |
|---|---|---|
| `vnet-<co>-prod` | `10.0.0.0/16` | 65,536 |
| `vnet-<co>-nonprod` | `10.1.0.0/16` | 65,536 |

Use `10.x.0.0/16` ranges. They're private (RFC 1918), don't conflict with most corporate networks, and give you room to grow. **Do not use `172.16.0.0/12` or `192.168.0.0/16`** — they're more likely to conflict if you ever need VPN to an office network.

### Subnet Layout

```
vnet-<co>-prod 10.0.0.0/16
│
├── snet-aks           10.0.0.0/20    (4,091 usable IPs)
│   └── For AKS nodes + Azure CNI pods (pod IPs come from the subnet)
│
├── snet-app           10.0.16.0/22   (1,019 usable IPs)
│   └── App Service / Container Apps VNet integration
│
├── snet-data          10.0.20.0/22   (1,019 usable IPs)
│   └── Private Endpoints for SQL, Redis, Storage, Key Vault
│
└── snet-shared        10.0.24.0/24   (251 usable IPs)
    └── CI/CD agents, jump boxes, Bastion subnet
```

**Why `/20` for AKS?** With Azure CNI, pods consume IPs from the subnet. A modest cluster with 10 nodes and 30 pods each is ~300 pod IPs. Add headroom for upgrades (surge nodes), system components, and future node pools. A /20 gives you ~4k usable IPs (Azure reserves 5 per subnet), which is a solid default for most startup-scale clusters. If you expect a much larger cluster (high node count, multiple pools, high max-pods), bump AKS to `/19` or `/18`.

**Why `/22` for data?** Each Private Endpoint uses one IP. You'll have 5-20 Private Endpoints in a typical startup. `/22` gives you 1,019 usable IPs — way more than you need, but subnets are free and re-sizing them later is painful.

### Subnet Delegation

Some subnets need delegation to specific Azure services:

| Subnet | Delegation | Notes |
|---|---|---|
| `snet-app` | `Microsoft.Web/serverFarms` | Required for App Service VNet integration |
| `snet-aks` | None | AKS manages its own NICs |
| `snet-data` | None | Private Endpoints don't require delegation |
| `snet-shared` | None | General purpose |

If using Container Apps with VNet integration, delegate to `Microsoft.App/environments` instead.

## Network Security Groups (NSGs)

### Default Rules

Every subnet gets an NSG with these custom rules:

```
Priority  Direction  Action  Source              Destination        Port
4096      Inbound    Deny    *                   *                  *
```

Yes, deny everything inbound by default. Then add explicit allow rules for what you need.

### Common Allow Rules

**For AKS subnet:**
```
110  Inbound  Allow  AzureLoadBalancer  snet-aks  *          (health probes)
120  Inbound  Allow  Internet           snet-aks  80,443     (if using LoadBalancer service)
```

**For App Service subnet (VNet integration — outbound only):**
```
No inbound rules needed — VNet integration is outbound only.
```

**For data subnet:**
```
110  Inbound  Allow  snet-aks    snet-data  1433,5432,6380,443  (SQL, PostgreSQL, Redis, Storage)
120  Inbound  Allow  snet-app    snet-data  1433,5432,6380,443
```

**For shared subnet:**
```
110  Inbound  Allow  VirtualNetwork  snet-shared  22  (SSH to jump box, if needed)
```

### NSG Flow Logs

Enable NSG Flow Logs version 2 on all NSGs and send them to your Log Analytics workspace. This gives you:
- Network traffic visibility
- Connection troubleshooting
- Traffic analytics (optional, costs extra)

```bicep
// Illustrative — requires a Storage Account and Log Analytics Workspace
// to be deployed separately for flow log storage and analytics.
param nsgName string
param nsgId string
param storageAccountId string
param logAnalyticsWorkspaceId string

resource flowLog 'Microsoft.Network/networkWatchers/flowLogs@2023-11-01' = {
  name: 'nw-${location}/fl-${nsgName}'
  location: location
  properties: {
    targetResourceId: nsgId
    storageId: storageAccountId
    enabled: true
    format: { type: 'JSON', version: 2 }
    retentionPolicy: { days: 30, enabled: true }
    flowAnalyticsConfiguration: {
      networkWatcherFlowAnalyticsConfiguration: {
        enabled: false  // enable later if you want Traffic Analytics
        workspaceResourceId: logAnalyticsWorkspaceId
        trafficAnalyticsInterval: 60
      }
    }
  }
}
```

## Private Endpoint Warning

> **Important:** Setting `publicNetworkAccess: 'Disabled'` on services like Azure SQL or Redis **requires** Private Endpoints or VNet integration to be configured. Without them, all connectivity (including from your application) will be blocked.
>
> If you're not deploying Private Endpoints yet, keep `publicNetworkAccess: 'Enabled'` and use service-level firewall rules to restrict access to known IPs. See `deploy_private_endpoints` in the SaaS example for an opt-in Private Endpoint setup.

## DNS

### Default (No Custom DNS)

By default, Azure VNets use Azure-provided DNS (`168.63.129.16`). This resolves:
- Public DNS names normally
- Azure Private DNS Zones linked to the VNet

This is fine for most startups. Don't set up custom DNS unless you need it.

### Private DNS Zones

When you create Private Endpoints, you need Private DNS Zones so `yourdb.database.windows.net` resolves to the private IP instead of the public one.

Common Private DNS Zones:

| Service | Zone |
|---|---|
| Azure SQL | `privatelink.database.windows.net` |
| Cosmos DB | `privatelink.documents.azure.com` |
| Storage (blob) | `privatelink.blob.core.windows.net` |
| Key Vault | `privatelink.vaultcore.azure.net` |
| Redis | `privatelink.redis.cache.windows.net` |
| ACR | `privatelink.azurecr.io` |

Link each zone to both VNets (prod and nonprod) if resources in both need to resolve them.

### When to Centralize DNS

When you have 5+ Private DNS Zones and 3+ VNets, managing zone links becomes tedious. That's when you create a hub VNet with a DNS forwarder (or use Azure DNS Private Resolver) and point all VNets to it.

## When to Add a Hub

```
Before (what we deploy):

    vnet-<co>-prod ←──── (no connection) ────→ vnet-<co>-nonprod

After (when you graduate):

    vnet-<co>-prod ←── peering ──→ hub-vnet ←── peering ──→ vnet-<co>-nonprod
                                  │
                            Azure Firewall
                            VPN Gateway
                            DNS Private Resolver
                            Azure Bastion
```

**Triggers for adding a hub:**
1. You need VPN or ExpressRoute (gateway goes in the hub)
2. Compliance requires centralized egress filtering (firewall goes in the hub)
3. You have 3+ VNets that need to communicate
4. DNS management across VNets is becoming painful

**Hub is NOT needed for:**
- Internet-facing apps behind Application Gateway or Front Door
- PaaS-only architectures
- Two VNets that don't need to talk to each other

## Azure Firewall vs NSGs

| Feature | NSGs | Azure Firewall |
|---|---|---|
| Cost | Free | ~$900/month minimum |
| L3/L4 filtering | Yes | Yes |
| L7 (FQDN) filtering | No | Yes |
| TLS inspection | No | Yes (Premium) |
| Centralized logging | Via Flow Logs | Built-in |
| Threat intelligence | No | Yes |
| Good for startups? | **Yes** | **Not until compliance or hybrid demands it** |

Start with NSGs. They're free, they cover 95% of use cases, and they're per-subnet so failures are isolated. Add Azure Firewall when you have a specific compliance or operational requirement.

> **See also:** The [SaaS Startup example](../examples/saas-startup/) demonstrates opt-in Private Endpoints for SQL and Redis with DNS zone configuration.

## Front Door vs Application Gateway

| Feature | Azure Front Door | Application Gateway |
|---|---|---|
| Scope | Global (anycast) | Regional |
| WAF | Yes (Standard/Premium) | Yes (v2) |
| SSL offload | Yes | Yes |
| Caching / CDN | Yes (built-in) | No |
| Best for | Global apps, multi-region, CDN | Single-region apps, internal LBs |
| Starting cost | ~$35/month (Standard) | ~$175/month (v2) |

**Recommendation:** If your app is internet-facing and you want WAF, start with Front Door Standard. It's cheaper, global, and includes CDN. Use Application Gateway only if you need it inside a VNet for internal routing.
