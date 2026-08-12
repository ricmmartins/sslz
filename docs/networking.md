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

### AKS ingress modes

Selecting AKS does not imply public exposure. Planning requires one explicit mode:

- `private`: the workload service is `ClusterIP`; the AKS subnet allows only `VirtualNetwork` traffic before deny-all.
  Public `LoadBalancer` and `NodePort` services are blocked by the planning contract.
- `public-azure-load-balancer`: one reviewed TCP `LoadBalancer` service exposes frontend port 80 or 443 and maps to one
  exact NodePort. The AKS subnet permits `AzureLoadBalancer` health probes to that NodePort and approved client source
  prefixes to the same NodePort, then retains the VNet allow and deny-all.

For example, a reviewed public service using NodePort `30080` and client CIDR `203.0.113.0/24` produces:

```
100   Inbound  Allow  AzureLoadBalancer  snet-aks  30080
110   Inbound  Allow  203.0.113.0/24     snet-aks  30080
120   Inbound  Allow  VirtualNetwork     snet-aks  *
4096  Inbound  Deny   *                  snet-aks  *
```

SSLZ never generates Internet-to-all-NodePort, arbitrary NodePort ranges, or generic HTTP-to-subnet rules. Missing
frontend/backend mapping, unproven source prefixes, a missing or mismatched probe, or a priority collision fails closed
for architecture review. Bicep and Terraform expose the same deterministic rule list through `aksIngressNsgRules` /
`aks_ingress_nsg_rules`. The `not-applicable` IaC default preserves legacy subnet behavior only for plans without AKS.

Planning records `not-observed` health and reachability placeholders and never claims live connectivity. Acceptance or
recovery must validate fresh evidence against both the canonical ingress decision and its signed manifest/approval
binding:

```bash
SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE=/protected/approval-public-key.pem \
  node scripts/aks-ingress-contract.mjs validate-postcheck postcheck.json acceptance \
  aks-ingress-decision.json deployment-manifest.json deployment-approval.json
```

The validator rejects omitted or replayed bindings, mutated service/frontend/NodePort expectations, stale evidence,
evidence observed more than 15 minutes ago or valid for more than 30 minutes, and missing health or reachability
observations.

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

### VNet Flow Logs

Enable [VNet Flow Logs](https://learn.microsoft.com/azure/network-watcher/vnet-flow-logs-overview) on your virtual networks and send them to your Log Analytics workspace. VNet flow logs replace the deprecated NSG flow logs, providing broader visibility across the entire VNet rather than per-NSG. This gives you:
- Network traffic visibility across the entire virtual network
- Connection troubleshooting
- Traffic analytics (optional, costs extra)

```bicep
// Illustrative — requires a Storage Account and Log Analytics Workspace
// to be deployed separately for flow log storage and analytics.
param vnetName string
param vnetId string
param storageAccountId string
param logAnalyticsWorkspaceId string

resource flowLog 'Microsoft.Network/networkWatchers/flowLogs@2024-05-01' = {
  name: 'nw-${location}/fl-${vnetName}'
  location: location
  properties: {
    targetResourceId: vnetId
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
| Centralized logging | Via VNet Flow Logs | Built-in |
| Threat intelligence | No | Yes |
| Good for startups? | **Yes** | **Not until compliance or hybrid demands it** |

Start with NSGs. They're free, they cover 95% of use cases, and they're per-subnet so failures are isolated. Add Azure Firewall when you have a specific compliance or operational requirement.

## Outbound Internet Access

### Default Outbound Access Retirement

Azure [retired default outbound internet access](https://learn.microsoft.com/azure/virtual-network/ip-services/default-outbound-access) for new VMs and subnets in September 2025. This means new VMs deployed into a subnet without an explicit outbound path (NAT Gateway, Load Balancer outbound rules, or public IP) will have **no internet connectivity**.

### How This Affects the Landing Zone

For most SSLZ workload patterns, this is **not a breaking issue** — here's why:

| Subnet | Typical Workload | Outbound Strategy | Impact |
|---|---|---|---|
| `snet-aks` | AKS with Standard Load Balancer | LB outbound rules handle egress automatically | ✅ Not affected |
| `snet-app` | App Service / Container Apps with VNet integration | Platform manages outbound connectivity | ✅ Not affected |
| `snet-data` | Private Endpoints | No outbound internet needed | ✅ Not affected |
| `snet-shared` | Jump boxes, CI/CD agents (VMs) | ⚠️ Needs explicit outbound if deploying VMs | ⚠️ Needs attention |

**Bottom line:** If your stack is PaaS-first (Container Apps, App Service, AKS with Load Balancer), outbound connectivity is handled by the platform and you don't need to take additional action. The only subnet where this matters is `snet-shared` — and only if you deploy VMs or VMSS into it.

### If You Need Outbound for VMs

If you deploy VMs into `snet-shared` (jump boxes, self-hosted CI/CD agents, etc.), you need one of these:

| Option | Cost | Best For |
|---|---|---|
| **NAT Gateway** | ~$32/month + data processing | Most scenarios — simple, per-subnet, static outbound IPs |
| **Standard Load Balancer** outbound rules | Included with LB | When you already have a Load Balancer |
| **Azure Firewall** (hub) | ~$900+/month | When you need L7 inspection and centralized egress (graduation path) |

**NAT Gateway** is the recommended option for startups. It's simple, cost-effective, and provides a predictable static outbound IP — useful for allowlisting with third-party APIs.

### Private Subnets (Optional Hardening)

You can explicitly set `defaultOutboundAccess: false` on subnets to make them "private" — blocking all outbound internet access unless a NAT Gateway or other explicit path is configured. This is a security best practice but only needed if you're deploying VMs and want to ensure no accidental outbound access.

For PaaS-only subnets (`snet-app`, `snet-data`), this setting has no practical effect since the platform services manage their own connectivity.

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
