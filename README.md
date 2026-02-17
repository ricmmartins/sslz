# Azure Landing Zone for Startups

A stripped-down, opinionated, **deployable** Azure Landing Zone for digital-native companies and startups. Based on Microsoft's Enterprise Scale Landing Zone (ESLZ), minus the enterprise complexity.

> Built for teams of 5-50 engineers who need to get Azure right from day one without spending two months on "cloud foundations."

## TL;DR

- **One management group, two subscriptions** (Prod + Non-Prod) is all you need to start. Don't over-engineer your hierarchy.
- **Skip the hub network, Azure Firewall, and dedicated Connectivity subscription** until you actually have hybrid/on-prem requirements or 10+ workloads.
- **Enable Defender for Cloud CSPM (free) + Defender for Servers P2 on prod only.** Turn on diagnostic settings to a single Log Analytics workspace. That's your security baseline.
- **Set budget alerts at 50%, 80%, and 100% of your monthly burn.** Tag everything with `environment` and `team`. No exceptions.
- **Deploy this in under 1 hour with Bicep or Terraform.** Graduate to full ESLZ when you hit ~50 engineers, multi-region, or regulatory compliance requirements.

## Why This Exists

| What Exists Today | The Problem |
|---|---|
| [ALZ (Enterprise Scale)](https://aka.ms/alz) | 100+ modules, months to understand, built for 10k-seat enterprises |
| [ALZ-Bicep](https://github.com/Azure/ALZ-Bicep) | Still enterprise-scoped, overwhelming for a 10-person startup |
| [CAF Terraform Module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) | Enterprise-scoped, entering extended support (archived Aug 2026). Microsoft now recommends [Azure Verified Modules](https://aka.ms/avm). |
| **This project** | **Deploys in 1 hour. Grows with you. Written for engineers, not consultants.** |

## Architecture

```
Tenant Root Group
└── mg-<yourcompany>              ← Baseline policies applied here
    ├── sub-<yourcompany>-prod    ← Production workloads
    └── sub-<yourcompany>-nonprod ← Dev, staging, QA
```

```
prod-vnet (10.0.0.0/16)
├── snet-aks         10.0.0.0/18
├── snet-app         10.0.4.0/22
├── snet-data        10.0.8.0/22
└── snet-shared      10.0.12.0/24

nonprod-vnet (10.1.0.0/16)
└── (same layout)
```

No hub. No Azure Firewall. No VNet peering. Each subscription is self-contained. [Read more →](docs/architecture.md)

## Quick Start

### Prerequisites

- Azure CLI (`az`) installed and authenticated
- Permissions: Owner on the Tenant Root Group (for management groups) or on the target subscriptions
- Two subscriptions created (Prod + Non-Prod)

### Option 1: Bicep

```bash
# Clone
git clone https://github.com/<your-org>/azure-landing-zone-startups.git
cd azure-landing-zone-startups/infra/bicep

# Edit parameters
cp parameters/prod.bicepparam parameters/prod.local.bicepparam
# Edit prod.local.bicepparam with your values

# Deploy
az deployment sub create \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam
```

### Option 2: Terraform

```bash
cd infra/terraform

cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

## Day-1 Checklist

### Pre-Deployment (30 min)
- [ ] Verify Entra ID tenant is set up, custom domain added
- [ ] Enable Security Defaults (Entra ID > Properties > Security Defaults)
- [ ] Create break-glass account with hardware MFA key
- [ ] Create security group `sg-azure-admins`, add 2-3 founders/leads

### Deploy Landing Zone (30 min)
- [ ] Run Bicep or Terraform deployment (creates management groups, policies, networking, monitoring, budgets)
- [ ] Verify resources in Azure Portal

### Post-Deployment (30 min)
- [ ] Assign `sg-azure-admins` as Owner on the management group
- [ ] Create Entra ID groups: `sg-azure-developers`, `sg-azure-readers`
- [ ] Assign RBAC roles (see [Security docs](docs/security.md))
- [ ] Set up CI/CD with Workload Identity Federation
- [ ] Test a sample deployment end-to-end

## What's Included

| Component | What You Get |
|---|---|
| **Management Groups** | Single MG with two subscriptions underneath |
| **Azure Policy** | Microsoft Cloud Security Benchmark (audit), required tags, allowed locations |
| **Networking** | VNet + subnets per subscription, NSGs with deny-all-inbound default |
| **Monitoring** | Log Analytics workspace, Activity Log forwarding, diagnostic settings policy |
| **Security** | Defender for Cloud CSPM, Defender for Servers P2 (prod), MFA via Security Defaults |
| **Cost Management** | Budget alerts at 50/80/100%, tagging enforcement |
| **CI/CD** | GitHub Actions workflows for Bicep and Terraform |

## What's NOT Included (By Design)

These are enterprise components you should add later when needed:

| Component | Add When... |
|---|---|
| Hub VNet + Azure Firewall | Hybrid connectivity or centralized egress control required |
| ExpressRoute / VPN Gateway | On-prem connectivity needed |
| Multiple MG layers | 5+ subscriptions with different policy needs |
| Private DNS Zones at scale | 3+ PaaS services using Private Endpoints across VNets |
| Advanced Conditional Access | 30+ Azure users or regulated customer data |
| PIM (Privileged Identity Management) | You need just-in-time admin access (Series B+) |

See [Graduation Guide](docs/graduation-guide.md) for detailed migration paths to full ESLZ.

## Examples

Pre-built configurations for common startup archetypes:

| Example | Description |
|---|---|
| [SaaS Startup](examples/saas-startup/) | Container Apps + Azure SQL Elastic Pool + Redis + Key Vault |
| [AI Startup](examples/ai-startup/) | AKS with GPU node pools + Azure OpenAI + Blob Storage |
| [API-First Startup](examples/api-first-startup/) | App Service + API Management + Cosmos DB |

## Documentation

- [Architecture Decisions](docs/architecture.md) — Why this layout, what we skipped, and when to revisit
- [Networking Deep Dive](docs/networking.md) — VNet design, NSGs, when you need a hub
- [Security Baseline](docs/security.md) — Defender, RBAC, logging, network security
- [Cost Management](docs/cost-management.md) — Budgets, RI guidance, common mistakes
- [Graduation Guide](docs/graduation-guide.md) — When and how to migrate to full ESLZ

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We welcome PRs — especially real-world configurations from startup CTOs and platform engineers who've battle-tested this.

## License

[MIT](LICENSE)
