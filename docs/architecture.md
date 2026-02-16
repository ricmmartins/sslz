# Architecture Decisions

## Why This Layout

This landing zone makes deliberate trade-offs: simplicity over completeness, speed over perfection. Every decision below is reversible. None of them will paint you into a corner.

## Management Groups

### What We Deploy

```
Tenant Root Group
└── mg-<yourcompany>
    ├── sub-<yourcompany>-prod
    └── sub-<yourcompany>-nonprod
```

### Why a Single Management Group

Enterprise Scale Landing Zone uses a deep hierarchy:

```
Tenant Root Group
└── mg-company
    ├── mg-platform
    │   ├── mg-management
    │   ├── mg-connectivity
    │   └── mg-identity
    ├── mg-landing-zones
    │   ├── mg-corp
    │   └── mg-online
    ├── mg-sandbox
    └── mg-decommissioned
```

This exists because enterprises have hundreds of subscriptions owned by different teams with different compliance requirements. You don't. You have 2-5 subscriptions and one team making all the decisions.

A single management group gives you:
- **One place to apply policies** that cover everything
- **Zero hierarchy to maintain** or explain to new hires
- **Easy migration later** — moving subscriptions between management groups is a 10-second operation

### When to Add More

Add a second management group level when:
- You have 5+ subscriptions and need different policies for different teams
- Compliance requirements differ between workloads (e.g., PCI vs non-PCI)
- You hire a dedicated platform team that needs its own governance scope

## Subscription Topology

### Two Subscriptions: Prod and Non-Prod

| Subscription | Contains | RBAC |
|---|---|---|
| `yourcompany-prod` | Production workloads, production databases, customer-facing services | Admins: Owner, Developers: Reader, CI/CD: Contributor |
| `yourcompany-nonprod` | Dev, staging, QA, CI/CD agents, experiments | Admins: Owner, Developers: Contributor |

### Why Not One Subscription?

The subscription is Azure's strongest isolation boundary. Separating prod from non-prod gives you:

1. **Cost isolation for free** — No tagging gymnastics to figure out dev vs prod spend
2. **RBAC without custom roles** — Developers get Contributor on non-prod, Reader on prod
3. **Blast radius containment** — `az group delete` in dev can't touch prod
4. **Quota isolation** — Non-prod experiments won't consume prod resource quotas

### Why Not Three+ Subscriptions?

You can. Common third subscriptions:
- **Sandbox** — For unrestricted experimentation (no policies, auto-delete after 30 days)
- **Data** — If you have a dedicated data platform (Databricks, Synapse, data lakes)
- **Shared Services** — If you have cross-cutting services (container registry, key vault)

But don't create them until you feel the pain of not having them. Each subscription is more RBAC to manage, more policies to assign, more cost to track.

## Networking

### No Hub VNet

The full ESLZ deploys a hub-spoke topology:

```
Hub VNet (Connectivity subscription)
├── Azure Firewall
├── VPN Gateway / ExpressRoute Gateway
├── Azure Bastion
└── Peered to all spoke VNets

Spoke VNets (Landing Zone subscriptions)
├── Peered to hub
└── All egress routes through hub firewall
```

This costs ~$1,500/month minimum (Azure Firewall alone is $900+) and adds operational complexity you don't need.

### What We Deploy Instead

Self-contained VNets per subscription with no peering:

```
prod-vnet (10.0.0.0/16)          nonprod-vnet (10.1.0.0/16)
├── snet-aks      /18            ├── snet-aks      /18
├── snet-app      /22            ├── snet-app      /22
├── snet-data     /22            ├── snet-data     /22
└── snet-shared   /24            └── snet-shared   /24
```

Each VNet is an island. Subnets are sized for growth:
- `/18` for AKS (16k IPs — enough for large clusters with Azure CNI)
- `/22` for App Service / Container Apps VNet integration
- `/22` for Private Endpoints (databases, storage, caches)
- `/24` for shared services (CI/CD agents, jump boxes)

### When You Need a Hub

Add a hub VNet when any of these apply:
- **VPN/ExpressRoute** — You need hybrid connectivity to on-prem or another cloud
- **Centralized egress filtering** — Compliance requires all outbound traffic to go through a firewall
- **DNS resolution at scale** — You have 5+ Private DNS Zones that need to be shared across VNets
- **Cross-subscription communication** — Workloads in prod need to talk to shared services in another subscription

## Identity

### Entra ID Essentials

| Component | What to Do | Why |
|---|---|---|
| Security Defaults | Enable | Free MFA for everyone, blocks legacy auth |
| Break-glass account | Create 1 | Cloud-only Global Admin with hardware key, for emergencies |
| Named admin groups | Create `sg-azure-admins` | Never assign roles to individuals, always groups |
| Workload Identity Federation | Use for CI/CD | No secrets to rotate, OIDC-based, supported by GitHub Actions and Azure DevOps |

### What About Entra ID P1/P2?

- **P1** (included with M365 Business Premium): Adds Conditional Access, self-service password reset. Worth it when you have 15+ users.
- **P2**: Adds PIM (just-in-time access), Access Reviews, Identity Protection. Worth it at Series B or when compliance demands it.

Don't buy P2 to check a box. Buy it when you have an actual operational need for just-in-time admin access.

## Policy Baseline

We assign a minimal set of policies at the management group level:

| Policy | Mode | Purpose |
|---|---|---|
| Microsoft Cloud Security Benchmark | Audit | Security recommendations without blocking deployments |
| Require tag: `environment` on resource groups | Deny | Cost tracking and resource lifecycle management |
| Require tag: `team` on resource groups | Deny | Ownership tracking and cost allocation |
| Inherit tag: `environment` from resource group | Modify | Auto-propagate tags to child resources |
| Allowed locations | Deny | Prevent accidental deployments to wrong regions |
| Deploy diagnostic settings for Activity Log | DeployIfNotExists | Ensure all control plane actions are logged |

### Why Audit Mode for Security Benchmark?

Because Deny mode on security policies will block legitimate deployments and create friction that drives engineers to find workarounds. Start with Audit to understand your posture, then selectively move specific policies to Deny as your team matures.

### Policies We Intentionally Skip

- CIS Benchmark — Overlaps heavily with MCSB, adds noise
- NIST / ISO / PCI initiatives — Add when compliance requires it
- Custom policies — Write them when built-in ones don't cover a specific need
