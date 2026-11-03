---
layout: page
title: "Graduation Guide"
nav_order: 7
description: "When and how to migrate to full ALZ"
---

# Graduation Guide: When and How to Migrate to Full ALZ (formerly ESLZ)

## Signals It's Time

You don't need all of these. If 2-3 apply simultaneously, start planning.

| Signal | Why It Matters |
|---|---|
| **Second independent workload** | Each workload should live in its own subscription. If you're deploying a second product, service, or team's workload, create a new subscription — don't colocate in the same one. Resource groups are not isolation boundaries. |
| **Engineering team > 50 people** | Different teams need different permissions, policies, and cost boundaries. A flat structure can't support this. |
| **Regulatory compliance** (SOC2 Type II, HIPAA, PCI-DSS, FedRAMP) | Compliance frameworks require specific controls: network segmentation, centralized logging, access reviews, change management. The starter landing zone doesn't cover these. |
| **Multi-region deployment** | Cross-region networking, global DNS, traffic routing — you need centralized network management. |
| **Hybrid connectivity** (on-prem, VPN, ExpressRoute) | Requires a Connectivity subscription with gateways and centralized DNS. |
| **5+ subscriptions** | Policy and RBAC management at scale needs a management group hierarchy. |
| **Dedicated platform/infrastructure team** | You have people whose job is the platform. Give them proper tools and separation. |
| **Enterprise customers asking about your cloud architecture** | Security questionnaires from enterprise buyers will probe your cloud governance maturity. |

## Migration Path

The good news: if you followed this guide, migration is incremental. You're adding layers, not rebuilding.

### Phase 0: Lightweight Management Group Split (Optional)

If your team is growing (20–50 engineers) and you're starting to see a natural separation between infrastructure/platform responsibilities and application/product teams, consider this intermediate step before going full ALZ.

**From:**
```
Tenant Root Group
└── mg-yourcompany
    ├── sub-prod
    └── sub-nonprod
```

**To:**
```
Tenant Root Group
└── mg-yourcompany
    ├── mg-platform          (cross-cutting: monitoring, security, shared infra)
    │   └── sub-prod
    └── mg-landing-zones     (workloads: application environments)
        └── sub-nonprod
```

**Why this helps:**
- Separates platform policies (security baselines, logging requirements) from workload policies (resource type restrictions, naming conventions)
- Gives infrastructure and product teams clear boundaries without the overhead of dedicated Platform subscriptions
- Makes the eventual move to full ALZ (Phase 1) smoother — the hierarchy is already in place

**Steps:**
1. Create `mg-platform` and `mg-landing-zones` under your root MG
2. Move `sub-prod` under `mg-platform` and `sub-nonprod` under `mg-landing-zones`
3. Reassign policies to the appropriate MG level
4. Verify policy inheritance works correctly

**Risk:** Low. Moving subscriptions between MGs is instant and doesn't affect running resources.

**When to skip this and go straight to Phase 1:** If you already need dedicated Connectivity or Management subscriptions, or have 5+ subscriptions, jump directly to the full ALZ hierarchy below.

### Phase 1: Full Management Group Hierarchy (Week 1)

**From:**
```
Tenant Root Group
└── mg-yourcompany
    ├── sub-prod
    └── sub-nonprod
```

**To:**
```
Tenant Root Group
└── mg-yourcompany
    ├── mg-platform
    │   ├── sub-management        (Log Analytics, Automation, Security)
    │   ├── sub-connectivity      (Hub VNet, Firewall, VPN/ER Gateway)
    │   └── sub-identity          (Domain controllers, if needed)
    ├── mg-landing-zones
    │   ├── mg-prod
    │   │   └── sub-prod
    │   └── mg-nonprod
    │       └── sub-nonprod
    └── mg-sandbox
        └── sub-sandbox
```

**Steps:**
1. Create new management groups
2. Move existing subscriptions under new hierarchy
3. Move policies from old MG to appropriate new MG level
4. Verify policy inheritance works correctly
5. Create new Platform subscriptions

**Risk:** Low. Moving subscriptions between MGs is instant and doesn't affect running resources. Policies may take up to 30 minutes to propagate.

### Phase 2: Connectivity Subscription + Hub Network (Week 2-3)

**What you're adding:**
- A dedicated Connectivity subscription
- A hub VNet with Azure Firewall, VPN Gateway, and/or ExpressRoute Gateway
- Azure DNS Private Resolver (replaces per-VNet DNS zone links)
- Azure Bastion in the hub

**Steps:**
1. Create the Connectivity subscription
2. Deploy hub VNet (`10.255.0.0/16` — use a range that doesn't overlap with existing VNets)
3. Deploy Azure Firewall in the hub
4. Create VNet peerings: hub ↔ prod, hub ↔ nonprod
5. Add UDRs on spoke subnets to route traffic through the firewall
6. Migrate Private DNS Zones to be linked to hub VNet
7. Deploy Azure DNS Private Resolver in hub
8. Test all existing workloads still function correctly

**Risk:** Medium. Networking changes can disrupt running services. Do this during a maintenance window. Test peering and DNS resolution thoroughly.

### Phase 3: Management Subscription (Week 3-4)

**What you're adding:**
- A dedicated Management subscription for centralized monitoring and security
- Central Log Analytics workspace (move from prod subscription)
- Azure Monitor baseline with workbooks and dashboards
- Microsoft Sentinel (SIEM) if needed

**Steps:**
1. Create the Management subscription
2. Deploy new Log Analytics workspace in Management sub
3. Reconfigure diagnostic settings to point to new workspace
4. Move alert rules and saved queries
5. (Optional) Enable Microsoft Sentinel on the workspace
6. Deprecate old workspace in prod after migration

**Risk:** Low-Medium. Logging disruption during migration. Run both workspaces in parallel for 2 weeks before cutting over.

### Phase 4: Policy Hardening (Week 4-5)

**What changes:**
- Move security policies from Audit to Deny mode
- Add compliance-specific policy initiatives (CIS, NIST, PCI, etc.)
- Add custom policies for organization-specific requirements
- Implement policy exemptions where needed

**Policies to flip from Audit to Deny:**

| Policy | When to Deny |
|---|---|
| Require HTTPS on storage accounts | Always safe to deny |
| Require TLS 1.2 minimum | After verifying no legacy clients |
| Deny public IP on NICs | After all VMs use Bastion or private access |
| Require Private Endpoints for PaaS | After migrating all PaaS to private networking |
| Deny resource types | When you want to prevent VMs in a PaaS-only subscription |

### Phase 5: Identity Hardening (Week 5-6)

**What you're adding:**
- Entra ID P2 (if not already)
- Privileged Identity Management (PIM) for just-in-time access
- Access Reviews for periodic verification of role assignments
- Conditional Access policies (beyond Security Defaults)
- Named locations for office/VPN IPs

**Conditional Access policies to implement:**

| Policy | Effect |
|---|---|
| Require MFA for all users | Replace Security Defaults with explicit CA |
| Block legacy authentication | Explicit block (Security Defaults does this but CA gives you more control) |
| Require compliant device for admin access | Admins must use managed devices |
| Block sign-in from risky locations | Block countries you don't operate in |
| Require MFA for risky sign-ins | Extra verification for unusual behavior |

## Cost of Full ALZ

Be aware of the additional monthly costs:

| Component | Estimated Monthly Cost |
|---|---|
| Azure Firewall (Standard) | $912 + data processing |
| VPN Gateway (VpnGw1) | $138 |
| ExpressRoute Gateway | $146+ |
| Azure Bastion (Standard) | $276 |
| Management subscription resources | $200-500 |
| Microsoft Sentinel | $2.46/GB ingested |
| Entra ID P2 | $9/user/month |
| **Total platform overhead** | **$1,500-3,000/month** |

This is why we don't start with full ALZ. At $1,500-3,000/month just for platform overhead, it needs to be justified by team size, compliance requirements, or operational needs.

## See Also

- [Architecture Decisions — Multi-Region and DR](/docs/architecture/#multi-region-and-disaster-recovery) — When and how to expand to multiple regions
- [Networking Deep Dive](/docs/networking/) — VNet design, hub-spoke, Private Endpoints
- [Security Baseline](/docs/security/) — Defender, RBAC, identity hardening
- [Cost Management](/docs/cost-management/) — RI guidance, Savings Plans, cost mistakes

## Resources

- [From Zero to Hero with Azure Landing Zones](https://techcommunity.microsoft.com/blog/startupsatmicrosoftblog/from-zero-to-hero-with-azure-landing-zones/4229195) — Step-by-step guide covering the full ALZ journey, from identity and RBAC to Platform and Application Landing Zones
- [Azure Landing Zones documentation](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/)
- [ALZ Bicep modules](https://github.com/Azure/ALZ-Bicep)
- [ALZ Terraform module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) (extended support, archived Aug 2026)
- [Azure Verified Modules for Landing Zones (Terraform)](https://aka.ms/alz/tf) — Microsoft's recommended replacement
- [Azure Landing Zone Vending Module](https://registry.terraform.io/modules/Azure/lz-vending/azurerm/latest)
- [Azure Architecture Center](https://learn.microsoft.com/azure/architecture/)
