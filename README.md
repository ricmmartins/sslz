# The Startup-Scale Landing Zone

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
| [CAF Terraform Module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) | Enterprise-scoped, in extended support (archived Aug 2026). Microsoft recommends migrating to [Azure Verified Modules](https://aka.ms/avm). |
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
├── snet-aks         10.0.0.0/20
├── snet-app         10.0.16.0/22
├── snet-data        10.0.20.0/22
└── snet-shared      10.0.24.0/24

nonprod-vnet (10.1.0.0/16)
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

Open `parameters/prod.local.bicepparam` and change these values:
- `companyName` — Your company name (e.g., `'acme'`). Used in all resource names.
- `securityContactEmail` — Email for Defender for Cloud alerts.
- `budgetAlertEmails` — List of emails for budget notifications.
- `monthlyBudgetAmount` — Your monthly budget in USD.

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

```bash
# Initialize Terraform
terraform init

# Preview what will be created (no changes made)
terraform plan -out=tfplan

# Deploy (review the plan output carefully before confirming)
terraform apply tfplan
```

> **Tip:** For production use, set up a remote backend for Terraform state so it persists across machines and CI/CD runs. Run `./scripts/bootstrap-backend.sh -s <storage-account-name>` to create the backend, then uncomment the `backend "azurerm"` block in `main.tf`.

### Step 4: Verify the Deployment (5 min)

After deployment completes, verify in the Azure Portal or CLI:

```bash
# Check resource groups were created
az group list --query "[?contains(name, 'yourcompany')].name" -o tsv

# Check Log Analytics workspace
az monitor log-analytics workspace list --query "[].name" -o tsv

# Check policy assignments
az policy assignment list --query "[?contains(name, 'mcsb')].displayName" -o tsv
```

### Step 5: Post-Deployment Setup (30 min)

See the [Day-1 Checklist](#day-1-checklist) below, and [CI/CD Setup](docs/ci-cd-setup.md) if you're configuring GitHub Actions.

### Teardown

To destroy all landing zone resources:

```bash
# Terraform
./scripts/teardown.sh --tool terraform --env nonprod

# Bicep
./scripts/teardown.sh --tool bicep --env nonprod
```

## Day-1 Checklist

### Pre-Deployment (30 min)
- [ ] Verify Entra ID tenant is set up, custom domain added
- [ ] Enable Security Defaults (Entra ID > Properties > Security Defaults)
- [ ] Create break-glass account with hardware MFA key
- [ ] Create security group `sg-azure-admins`, add 2-3 founders/leads

### Deploy Landing Zone (30 min)
- [ ] Run Bicep or Terraform deployment (creates policies, networking, monitoring, security, budgets)
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
- [CI/CD Setup](docs/ci-cd-setup.md) — Workload Identity Federation, GitHub Actions, secrets
- [Troubleshooting](docs/troubleshooting.md) — Common deployment errors and fixes
- [Graduation Guide](docs/graduation-guide.md) — When and how to migrate to full ESLZ

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We welcome PRs — especially real-world configurations from startup CTOs and platform engineers who've battle-tested this.

## License

[MIT](LICENSE)
