# The Startup-Scale Landing Zone

[![Validate IaC](https://github.com/ricmmartins/sslz/actions/workflows/validate.yml/badge.svg?branch=main)](https://github.com/ricmmartins/sslz/actions/workflows/validate.yml?query=branch%3Amain)
[![Deploy to GitHub Pages](https://github.com/ricmmartins/sslz/actions/workflows/github-pages.yml/badge.svg?branch=main)](https://github.com/ricmmartins/sslz/actions/workflows/github-pages.yml?query=branch%3Amain)
[![Bicep deploy: manual and approval-gated](https://img.shields.io/badge/Bicep_deploy-manual_%7C_approval--gated-0078D4)](docs/ci-cd-setup.md#automate-the-classic-direct-operator-path)
[![Terraform deploy: manual and approval-gated](https://img.shields.io/badge/Terraform_deploy-manual_%7C_approval--gated-844FBA)](docs/ci-cd-setup.md#automate-the-classic-direct-operator-path)

A stripped-down, opinionated, **deployable** Azure Landing Zone for digital-native companies and startups. Based on Microsoft's [Azure Landing Zone (ALZ)](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/) — formerly Enterprise-Scale Landing Zone (ESLZ) — minus the enterprise complexity.

> Built for teams of 5-50 engineers who need to get Azure right from day one without spending two months on "cloud foundations."

Want guided setup? [Use the SSLZ Agent](use-sslz-agent.md) to start with founder-friendly questions, read-only
planning, and an approval-bound infrastructure plan. Start from that launch page before following the classic deployment
Quick Start below. Initial planning needs Git and GitHub Copilot CLI authenticated with a GitHub account that has Copilot
access; it does not require Azure CLI, an Azure subscription, or Azure login. Node.js is needed for local planners and
tests, and Azure tooling is needed only for later operations that explicitly require it.

## TL;DR

- **One management group, two subscriptions** (Prod + Non-Prod) is all you need to start. Don't over-engineer your hierarchy.
- **Skip the hub network, Azure Firewall, and dedicated Connectivity subscription** until you actually have hybrid/on-prem requirements or 10+ workloads.
- **Enable Defender for Cloud CSPM (free) + Defender for Servers P2 on prod only.** Turn on diagnostic settings to a single Log Analytics workspace. That's your security baseline.
- **Set budget alerts at 50%, 80%, and 100% of your monthly burn.** Tag everything with `environment` and `team`. No exceptions.
- **Deploy this in under 1 hour with Bicep or Terraform.** Graduate to full ALZ when you hit ~50 engineers, multi-region, or regulatory compliance requirements.

## Background

For a full walkthrough of the Azure Landing Zone journey, from identity and RBAC to Platform and Application Landing Zones, see [From Zero to Hero with Azure Landing Zones](https://techcommunity.microsoft.com/blog/startupsatmicrosoftblog/from-zero-to-hero-with-azure-landing-zones/4229195). This project distills that foundation into a deployable starting point for startups.

## Why This Exists

| What Exists Today | The Problem |
|---|---|
| [ALZ (Enterprise Scale)](https://aka.ms/alz) | 100+ modules, months to understand, built for 10k-seat enterprises |
| [ALZ-Bicep](https://github.com/Azure/ALZ-Bicep) | Still enterprise-scoped, overwhelming for a 10-person startup |
| [CAF Terraform Module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) | Enterprise-scoped, in extended support (archived Aug 2026). Microsoft recommends migrating to [Azure Verified Modules](https://aka.ms/avm). |
| **This project** | **Deploys in 1 hour, grows with you, and is written for engineers.** |

> **⚠️ Important:** This project is **not** a replacement or competitor to [Azure Landing Zones (ALZ)](https://aka.ms/alz) or the [Trey Research](https://github.com/Azure/Enterprise-Scale/tree/main/docs/reference/treyresearch) small-enterprise reference. It targets a different profile: very early-stage startups (pre-seed to Series A), 5–15 engineers, no dedicated platform team, typically a single workload in a single region, and no hybrid connectivity requirements. For those teams, the usual alternative is a single subscription with zero governance. This project provides a minimal but secure baseline to start with, and an explicit [graduation guide](docs/graduation-guide.md) for when they're ready to evolve into the full ALZ architecture.

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

There is no hub, Azure Firewall, or VNet peering. Each subscription is self-contained. [Read more →](docs/architecture.md)

## Plan with SSLZ Agent

[Use SSLZ Agent](https://startupscalelanding.zone/use-sslz-agent/) explains how to run the repository profile in local
GitHub Copilot CLI. Clone the `main` branch to get the profile, planners, and documentation together. Start with a
conversation and local planning without Azure CLI or Azure login. Live reads and later write-capable operations require
separate review and approval. The Quick Start below remains the direct operator deployment path.

## Quick Start

These Bash commands deploy the platform baseline under your Azure identity,
without SSLZ Agent signed approvals. Use Bash, Azure Cloud Shell, or WSL with the
required tools installed in that environment. Start each provider option from the
repository root. The time estimates assume completed prerequisites; they are not
a measured end-to-end production-readiness guarantee.

### Step 1: Check Prerequisites (5 min)

You need:
- **Azure CLI** — [Install guide](https://learn.microsoft.com/cli/azure/install-azure-cli)
- **Terraform** >= 1.5.0 — [Install guide](https://developer.hashicorp.com/terraform/install) (only for Terraform option)
- **Two Azure subscriptions** — One for prod, one for non-prod. [Create a subscription](https://learn.microsoft.com/azure/cost-management-billing/manage/create-subscription)
- **Permissions** — Owner on both subscriptions (or Owner on the Tenant Root Group if deploying management groups). If you created the subscriptions yourself you are Owner by default; otherwise see [how to assign roles](https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal).
- **Windows users** — Install [Git for Windows](https://git-scm.com/download/win) and run every command in **Git Bash**. The `.sh` scripts do not run in PowerShell or Command Prompt.

Run the pre-flight check to verify everything:

```bash
git clone https://github.com/ricmmartins/sslz.git
cd sslz

# Login to Azure
az login
az account set --subscription <YOUR_PROD_SUBSCRIPTION_ID>

# Check all prerequisites
./scripts/validate-prerequisites.sh --tool bicep
# Use --tool terraform instead when choosing Terraform.

# Repeat the read-only check for the non-production subscription.
az account set --subscription <YOUR_NONPROD_SUBSCRIPTION_ID>
./scripts/validate-prerequisites.sh --tool bicep
# Use --tool terraform instead when choosing Terraform.
```

If the script reports errors, fix them before proceeding. See [Troubleshooting](docs/troubleshooting.md) for common issues.
The script checks only the currently selected subscription; repeat it for both
targets. These checks are read-only and do not establish deployment
authorization, quota, capacity or cost readiness. Review effective write
permissions and the preview for each selected subscription before deploying.

### Step 2: Deploy Management Groups (Optional, 5 min)

This step creates the management group hierarchy shown in the [Architecture](#architecture) diagram. It requires **tenant-level permissions** (Owner or Management Group Contributor on the Tenant Root Group). Skip this if you don't have tenant-level access — the landing zone works without it.

The templates also associate the supplied existing prod/non-prod subscriptions
with the new management groups. This changes their parent hierarchy and can
change inherited policy and RBAC for every resource in those subscriptions.
Inventory current parent groups and inherited assignments first; do not run this
step for shared or already governed subscriptions without tenant-owner review
and explicit approval. The landing-zone teardown commands below do not remove
management groups or reverse subscription associations.

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
- `budgetStartDate` — **Required change.** The example date is old. Set it to the first day of the current month (for example `'2026-11-01T00:00:00Z'`) or the budget deployment fails.
- `location`, `allowedLocations`, `logAnalyticsWorkspaceLocation` — Review the deployment and workspace regions together; changing the CLI deployment location alone does not move resources.
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

For non-prod, use the dedicated parameter sample. It keeps Defender for
Servers, Containers, Databases, and Storage disabled; review those plans before
enabling them in a non-production subscription. Set the company name, alert
addresses, budget, deployment-month start date, and regions in the local copy:
```bash
cp parameters/nonprod.bicepparam parameters/nonprod.local.bicepparam
# Edit parameters/nonprod.local.bicepparam before running these commands.
az account set --subscription <YOUR_NONPROD_SUBSCRIPTION_ID>
az deployment sub what-if \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/nonprod.local.bicepparam
az deployment sub create \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/nonprod.local.bicepparam
```

#### Option B: Terraform

```bash
cd infra/terraform

# Copy and edit the variables file
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` and edit the six values in **section 1** of the file. Section 2 is optional; the defaults are fine. `budget_start_date` is set automatically, so leave it commented out.
- `subscription_id` — Your Azure subscription UUID
- `company_name` — Your company name (e.g., `"acme"`)
- `environment` — `"prod"` or `"nonprod"`
- `budget_alert_emails` — List of email addresses
- `security_contact_email` — Email for security alerts
- `enable_defender_for_storage` — Keep `false` unless you explicitly opt into the paid Defender for Storage V2 plan
- `monthly_budget_amount` — Review the monthly budget; alerts do not impose a spending cap.
- `location`, `allowed_locations`, `log_analytics_workspace_location` — Review resource, policy and workspace regions together.

```bash
# Isolated local development only: replace the remote backend with local state
cp local-backend.tf.example backend_override.tf

# Initialize Terraform with the selected backend
terraform init

# Preview what will be created (no changes made)
terraform plan -out=tfplan

# Deploy (review the plan output carefully before confirming)
terraform apply tfplan
```

> **Important:** Local state is only for an isolated development exercise. Keep the ignored `backend_override.tf`, state and saved plan protected, and use the same directory and state for teardown. For CI/CD and team use, configure the remote backend before deployment instead of copying the local override. From the repository root, `./scripts/bootstrap-backend.sh -s <storage-account-name>` provisions backend resources; review its changes and follow [CI/CD Setup](docs/ci-cd-setup.md). `terraform init -backend=false` does not select local state. If migrating existing state, stop and follow Terraform's reviewed state-migration procedure rather than removing state or reinitializing blindly.

For the second environment, repeat the Terraform option in a **separate clean
clone**, with that environment's subscription and variables. Keep its local state
separate, or use a distinct remote backend key when using shared storage. Editing
`environment` or `subscription_id` in a directory holding the first environment's
state can plan destruction of that deployment.

### Step 4: Verify the Deployment (5 min)

After deployment completes, return from `infra/bicep` or `infra/terraform` to the
repository root. Select the subscription just deployed, including when Terraform
used a `subscription_id` different from your Azure CLI default. Repeat verification
for each environment. Replace `yourcompany` in the query with the deployed name.
These listing commands aid inspection; compare the exact resources and settings
to the reviewed plan rather than treating successful CLI exit codes as acceptance.

```bash
cd ../..
az account set --subscription <DEPLOYED_SUBSCRIPTION_ID>

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

Return to the repository root first and select the subscription used for that
deployment. Run only the command for your provider and actual environment.
Preserve the Terraform backend configuration and original state; do not use
another environment's state or assume `--env` selects a different state file.
Review all listed changes, including subscription-level settings, before confirming.
For Bicep, `--company` is required and the script selects only the baseline's
monitoring and networking groups. Names alone do not prove ownership: check them
against the pre-deployment inventory and do not delete pre-existing groups.
Group deletion is asynchronous and does not undo subscription policies, Defender
plans, security contacts, diagnostics or budgets. Verify deletion completion and
restore shared settings from that inventory; do not delete role assignments by
role name or reset paid security plans blindly.

Terraform has an additional guard: the Defender workspace association uses
`prevent_destroy`, and the generic teardown command does not restore shared
subscription settings. If this deployment created that association or changed
Defender pricing, first restore those settings to the pre-deployment inventory.
Back up the Terraform state, confirm the exact addresses with `terraform state
list`, and remove only the restored subscription-level objects from state; this
does not delete Azure resources:

```bash
cd infra/terraform
# Include the workspace address only if it exists in this deployment's state.
terraform state rm \
  'azurerm_security_center_workspace.defender[0]' \
  'module.security.azurerm_security_center_subscription_pricing.arm' \
  'module.security.azurerm_security_center_subscription_pricing.containers' \
  'module.security.azurerm_security_center_subscription_pricing.cspm' \
  'module.security.azurerm_security_center_subscription_pricing.keyvault' \
  'module.security.azurerm_security_center_subscription_pricing.oss_db' \
  'module.security.azurerm_security_center_subscription_pricing.servers' \
  'module.security.azurerm_security_center_subscription_pricing.sql' \
  'module.security.azurerm_security_center_subscription_pricing.storage'
terraform plan -destroy -out=tfplan
terraform show tfplan
terraform apply tfplan
```

Review the destroy plan and apply it only when it contains expected
exercise-owned deletions and no changes to restored shared settings. Do not
remove the `prevent_destroy` lifecycle guard to bypass this review.

```bash
# Terraform
./scripts/teardown.sh --tool terraform --env nonprod --company yourcompany

# Bicep (deletes only the two resource groups)
./scripts/teardown.sh --tool bicep --env nonprod --company yourcompany

# Either tool, plus leftovers from the other tool or outside Terraform state:
# baseline resource groups, policy assignments, diagnostic setting, budget and
# security contact. Use only on a subscription that is not shared with other
# workloads. Defender plans are left unchanged.
./scripts/teardown.sh --tool bicep --env nonprod --company yourcompany --include-subscription-settings
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
- [ ] Configure [Cost Management anomaly detection and email alerts](https://learn.microsoft.com/azure/cost-management-billing/understand/analyze-unexpected-charges) for each subscription. In Azure portal, open **Cost Management > Cost Analysis**, select a subscription scope and a **Smart view** to onboard anomaly detection; status can take up to 24 hours. Then open **Cost alerts > Add > Anomaly**, choose recipients and create the rule. Creation requires Owner, Contributor, Cost Management Contributor or the documented custom permission. Anomaly emails are sent once per detected event, not as a spending cap; the rule creator must retain Reader or equivalent access for email delivery. Available in Azure public cloud, not Azure Government.
- [ ] Test a sample deployment end-to-end

The 30-minute estimate does not include anomaly detection onboarding, which can
take up to 24 hours. Do not treat a budget or anomaly alert as a hard spending cap.

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

- [Architecture Decisions](docs/architecture.md) — Why this layout, what we skipped, and when to revisit
- [Resource Inventory](docs/resource-inventory.md) — Complete list of every Azure resource created
- [Networking Deep Dive](docs/networking.md) — VNet design, NSGs, when you need a hub
- [Security Baseline](docs/security.md) — Defender, RBAC, logging, network security
- [Cost Management](docs/cost-management.md) — Budgets, RI guidance, common mistakes
- [CI/CD Setup](docs/ci-cd-setup.md) — Workload Identity Federation, GitHub Actions, secrets
- [Troubleshooting](docs/troubleshooting.md) — Common deployment errors and fixes
- [Graduation Guide](docs/graduation-guide.md) — When and how to migrate to full ALZ

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We welcome PRs, especially real-world configurations from startup CTOs and platform engineers who have used this.

## License

[MIT](LICENSE)
