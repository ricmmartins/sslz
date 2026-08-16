# The Startup-Scale Landing Zone

[![Validate IaC](https://github.com/ricmmartins/sslz/workflows/Validate%20IaC/badge.svg)](https://github.com/ricmmartins/sslz/actions/workflows/validate.yml)
[![Deploy Landing Zone (Bicep)](https://github.com/ricmmartins/sslz/workflows/Deploy%20Landing%20Zone%20(Bicep)/badge.svg)](https://github.com/ricmmartins/sslz/actions/workflows/deploy-bicep.yml)
[![Deploy Landing Zone (Terraform)](https://github.com/ricmmartins/sslz/workflows/Deploy%20Landing%20Zone%20(Terraform)/badge.svg)](https://github.com/ricmmartins/sslz/actions/workflows/deploy-terraform.yml)

A stripped-down, opinionated, **deployable** Azure Landing Zone for digital-native companies and startups. Based on Microsoft's [Azure Landing Zone (ALZ)](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/) — formerly Enterprise-Scale Landing Zone (ESLZ) — minus the enterprise complexity.

> Built for teams of 5-50 engineers who need to get Azure right from day one without spending two months on "cloud foundations."

## TL;DR

- **One management group, two subscriptions** (Prod + Non-Prod) is all you need to start. Don't over-engineer your hierarchy.
- **Skip the hub network, Azure Firewall, and dedicated Connectivity subscription** until you actually have hybrid/on-prem requirements or 10+ workloads.
- **Enable Defender for Cloud CSPM (free) + Defender for Servers P2 on prod only.** Turn on diagnostic settings to a single Log Analytics workspace. That's your security baseline.
- **Set budget alerts at 50%, 80%, and 100% of your monthly burn.** Tag everything with `environment` and `team`. No exceptions.
- **Deploy this in under 1 hour with Bicep or Terraform.** Graduate to full ALZ when you hit ~50 engineers, multi-region, or regulatory compliance requirements.

## Agent-aware journey on `main`

The current `main` branch includes delivered account/topology preflight, workload and regional planning, PostgreSQL
fallback, IaC review, approval-gated provider remediation and primary baseline deployment paths, regional retry, and AKS
ingress/postcheck contracts. Phase 7 secondary-region artifacts and the PostgreSQL migration, container image/CI/CD, and
dual-cloud programs are planning-only and execution-disabled.

The canonical greenfield report is version `2.0.0`. It references a separately emitted, execution-disabled
program-lineage envelope for PostgreSQL migration, image/CI, and dual-cloud connectivity by exact envelope and program
identity digests, without extending the signed primary-baseline authority.
See the [authoritative implementation and evidence matrix](docs/implementation-status.md) before interpreting a passing
plan or test as live readiness. Run the package-free synthetic end-to-end validation with:

```bash
node scripts/validate-greenfield-journey.mjs
```

This command uses deterministic fixtures and mocks, writes review artifacts only under ignored `.sslz/` paths, performs
no Azure operations, and needs no Azure login or live tenant. It is local synthetic evidence, not a live deployment,
migration, recovery, image-promotion, or connectivity test. It requires Node.js and the local Bicep CLI installed by
`az bicep install`, but no npm install or project dependency restore. Its sanitized v2 report follows
[`agent/schemas/greenfield-journey-report.schema.json`](agent/schemas/greenfield-journey-report.schema.json) and
separates baseline deployment readiness from non-executable migration and dual-cloud planning readiness.

These capabilities describe the latest `main`; a tagged release contains only the features documented by that tag.
The [Quick Start](#quick-start) below is a direct operator Bicep/Terraform path. It does not invoke the agent plan,
provider-remediation approval, or signed deployment approval; the operator owns its access, review, state, validation,
and rollback.

## Background

For a comprehensive walkthrough of the full Azure Landing Zone journey — from identity and RBAC to Platform and Application Landing Zones — see [From Zero to Hero with Azure Landing Zones](https://techcommunity.microsoft.com/blog/startupsatmicrosoftblog/from-zero-to-hero-with-azure-landing-zones/4229195). This project takes that foundation and distills it into a deployable starting point for startups.

## Why This Exists

| What Exists Today | The Problem |
|---|---|
| [ALZ (Enterprise Scale)](https://aka.ms/alz) | 100+ modules, months to understand, built for 10k-seat enterprises |
| [ALZ-Bicep](https://github.com/Azure/ALZ-Bicep) | Still enterprise-scoped, overwhelming for a 10-person startup |
| [CAF Terraform Module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) | Enterprise-scoped, in extended support (archived Aug 2026). Microsoft recommends migrating to [Azure Verified Modules](https://aka.ms/avm). |
| **This project** | **Deploys in 1 hour. Grows with you. Written for engineers, not consultants.** |

> **⚠️ Important:** This project is **not** a replacement or competitor to [Azure Landing Zones (ALZ)](https://aka.ms/alz) or the [Trey Research](https://github.com/Azure/Enterprise-Scale/tree/main/docs/reference/treyresearch) small-enterprise reference. It targets a different profile entirely: very early-stage startups (pre-seed to Series A), 5–15 engineers, no dedicated platform team, typically a single workload in a single region, and no hybrid connectivity requirements. For those teams, the alternative isn't ALZ — it's usually a single subscription with zero governance. This project provides a minimal but secure baseline to start with, and an explicit [graduation guide](docs/graduation-guide.md) for when they're ready to evolve into the full ALZ architecture.

## Architecture

```
Tenant Root Group
└── mg-<yourcompany>              ← Baseline policies applied here
    ├── sub-<yourcompany>-prod    ← Production workloads
    └── sub-<yourcompany>-nonprod ← Dev, staging, QA
```

```
vnet-<co>-prod (10.0.0.0/16)
├── snet-aks         10.0.0.0/20
├── snet-app         10.0.16.0/22
├── snet-data        10.0.20.0/22
└── snet-shared      10.0.24.0/24

vnet-<co>-nonprod (10.1.0.0/16)
└── (same layout)
```

No hub. No Azure Firewall. No VNet peering. Each subscription is self-contained. [Read more →](docs/architecture.md)

## Quick Start

### Step 1: Check Prerequisites (5 min)

You need:
- **Azure CLI** — [Install guide](https://learn.microsoft.com/cli/azure/install-azure-cli)
- **Terraform** >= 1.5.0 — [Install guide](https://developer.hashicorp.com/terraform/install) (only for Terraform option)
- **Two Azure subscriptions** — One for prod, one for non-prod. [Create a subscription](https://learn.microsoft.com/azure/cost-management-billing/manage/create-subscription)
- **Permissions** — Owner on both subscriptions (or Owner on the Tenant Root Group if deploying management groups)

Run the pre-flight check to verify everything:

```bash
git clone https://github.com/ricmmartins/sslz.git
cd sslz

# Login to Azure
az login
az account set --subscription <YOUR_PROD_SUBSCRIPTION_ID>

# Check all prerequisites
./scripts/validate-prerequisites.sh
```

If the script reports errors, fix them before proceeding. See [Troubleshooting](docs/troubleshooting.md) for common issues.

### Step 2: Deploy Management Groups (Optional, 5 min)

This step creates the management group hierarchy shown in the [Architecture](#architecture) diagram. It requires **tenant-level permissions** (Owner or Management Group Contributor on the Tenant Root Group). Skip this if you don't have tenant-level access — the landing zone works without it.

#### Option A: Bicep

```bash
az deployment tenant create \
  --location eastus2 \
  --template-file infra/bicep/modules/management-groups.bicep \
  --parameters \
    companyName='<yourcompany>' \
    prodSubscriptionId='<PROD_SUBSCRIPTION_ID>' \
    nonprodSubscriptionId='<NONPROD_SUBSCRIPTION_ID>'
```

#### Option B: Terraform

```bash
cd infra/terraform/modules/management-groups
terraform init
terraform apply \
  -var='subscription_id=<ANY_SUBSCRIPTION_ID>' \
  -var='company_name=<yourcompany>' \
  -var='prod_subscription_id=<PROD_SUBSCRIPTION_ID>' \
  -var='nonprod_subscription_id=<NONPROD_SUBSCRIPTION_ID>'
cd ../../../..
```

> **Note:** The `subscription_id` is required by the azurerm provider for authentication, even though management groups are tenant-level resources. You can use either your prod or non-prod subscription ID.

### Step 3: Deploy the Landing Zone (20 min)

Choose **one** option: Bicep or Terraform.

#### Option A: Bicep

```bash
cd infra/bicep

# Copy and edit the parameter file for your environment
cp parameters/prod.bicepparam parameters/prod.local.bicepparam
```

Open `parameters/prod.local.bicepparam` and change these values (the `.local.` copy keeps your settings out of version control):
- `companyName` — Your company name (e.g., `'acme'`). Used in all resource names.
- `securityContactEmail` — Email for Defender for Cloud alerts.
- `budgetAlertEmails` — List of emails for budget notifications.
- `monthlyBudgetAmount` — Your monthly budget in USD.
- `enableDefenderForStorage` — Keep `false` for the startup baseline; set `true` only after reviewing the paid Defender for Storage V2 plan and current pricing.

```bash
# Preview what will be created (no changes made)
az deployment sub what-if \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam

# Deploy
az deployment sub create \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam
```

Repeat for non-prod by creating a `nonprod.local.bicepparam` file with `environment = 'nonprod'` and switching subscriptions:
```bash
az account set --subscription <YOUR_NONPROD_SUBSCRIPTION_ID>
```

#### Option B: Terraform

```bash
cd infra/terraform

# Copy and edit the variables file
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` and fill in the **REQUIRED** values (marked in the file):
- `subscription_id` — Your Azure subscription UUID
- `company_name` — Your company name (e.g., `"acme"`)
- `environment` — `"prod"` or `"nonprod"`
- `budget_alert_emails` — List of email addresses
- `security_contact_email` — Email for security alerts
- `enable_defender_for_storage` — Keep `false` unless you explicitly opt into the paid Defender for Storage V2 plan

```bash
# Initialize Terraform
terraform init

# Preview what will be created (no changes made)
terraform plan -out=tfplan

# Deploy (review the plan output carefully before confirming)
terraform apply tfplan
```

> **Important:** For CI/CD and team use, set up a remote backend for Terraform state. Run `./scripts/bootstrap-backend.sh -s <storage-account-name>` to create the backend storage, then configure your workflow with the storage account name. For local dev without a backend, run `terraform init -backend=false`. See [CI/CD Setup](docs/ci-cd-setup.md) for full instructions.

### Step 4: Verify the Deployment (5 min)

After deployment completes, verify in the Azure Portal or CLI:

```bash
# Check resource groups were created
az group list --query "[?contains(name, 'yourcompany')].name" -o tsv

# Check Log Analytics workspace
az monitor log-analytics workspace list --query "[].name" -o tsv

# Check policy assignments
az policy assignment list --query "[].displayName" -o tsv

# Check Defender plans enabled
az security pricing list --query "value[?pricingTier=='Standard'].{Name:name, Tier:pricingTier}" -o table

# Check security contact
az security contact show --name default --query "{Email:emails, Roles:notificationsByRole.roles}" -o table

# Check budget
az consumption budget list --query "[].{Name:name, Amount:amount, TimeGrain:timeGrain}" -o table

# Check NSG rules
az network nsg list --query "[].name" -o tsv
```

### Step 5: Post-Deployment Setup (30 min)

See the [Day-1 Checklist](#day-1-checklist) below, and [CI/CD Setup](docs/ci-cd-setup.md) if you're configuring GitHub Actions.

### Teardown

To destroy all landing zone resources:

```bash
# Terraform
./scripts/teardown.sh --tool terraform --env nonprod --company yourcompany

# Bicep
./scripts/teardown.sh --tool bicep --env nonprod --company yourcompany
```

## Day-1 Checklist

### Pre-Deployment (30 min)
- [ ] [Verify Entra ID tenant is set up](https://learn.microsoft.com/entra/fundamentals/whatis), [custom domain added](https://learn.microsoft.com/entra/fundamentals/add-custom-domain)
- [ ] [Enable Security Defaults](https://learn.microsoft.com/entra/fundamentals/security-defaults) (Entra ID > Properties > Security Defaults)
- [ ] [Create break-glass account](https://learn.microsoft.com/entra/identity/role-based-access-control/security-emergency-access) with hardware MFA key
- [ ] [Create security group](https://learn.microsoft.com/entra/fundamentals/groups-view-azure-portal) `sg-azure-admins`, add 2-3 founders/leads

### Deploy Landing Zone (30 min)
- [ ] Run [Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-to-subscription) or [Terraform](https://learn.microsoft.com/azure/developer/terraform/overview) deployment — see [Step 3](#step-3-deploy-the-landing-zone-20-min) above
- [ ] Verify resources in Azure Portal

### Post-Deployment (30 min)
- [ ] [Assign](https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal) `sg-azure-admins` as Owner on the management group
- [ ] Create Entra ID groups: `sg-azure-developers`, `sg-azure-readers`
- [ ] Assign [RBAC roles](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles) (see [Security docs](docs/security.md))
- [ ] Set up [CI/CD](docs/ci-cd-setup.md) with [Workload Identity Federation](https://learn.microsoft.com/entra/workload-id/workload-identity-federation)
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

See [Graduation Guide](docs/graduation-guide.md) for detailed migration paths to full ALZ.

## Examples

Pre-built configurations for common startup archetypes:

| Example | Description |
|---|---|
| [SaaS Startup](examples/saas-startup/) | Container Apps + Azure SQL Elastic Pool + Redis + Key Vault |
| [AI Startup](examples/ai-startup/) | AKS with GPU node pools + Azure OpenAI + Blob Storage |
| [API-First Startup](examples/api-first-startup/) | App Service + API Management + Cosmos DB |

## Documentation

- [Implementation and Evidence Status](docs/implementation-status.md) — Authoritative delivery, authority, evidence, and next-gate matrix
- [Architecture Decisions](docs/architecture.md) — Why this layout, what we skipped, and when to revisit
- [Resource Inventory](docs/resource-inventory.md) — Complete list of every Azure resource created
- [Networking Deep Dive](docs/networking.md) — VNet design, NSGs, when you need a hub
- [Security Baseline](docs/security.md) — Defender, RBAC, logging, network security
- [Cost Management](docs/cost-management.md) — Budgets, RI guidance, common mistakes
- [CI/CD Setup](docs/ci-cd-setup.md) — Workload Identity Federation, GitHub Actions, secrets
- [Troubleshooting](docs/troubleshooting.md) — Common deployment errors and fixes
- [Graduation Guide](docs/graduation-guide.md) — When and how to migrate to full ALZ

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We welcome PRs — especially real-world configurations from startup CTOs and platform engineers who've battle-tested this.

## License

[MIT](LICENSE)
