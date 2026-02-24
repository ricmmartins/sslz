---
layout: home
title: "Startup-Scale Landing Zone"
description: "A stripped-down, opinionated, deployable Azure Landing Zone for startups. Deploy in under 1 hour."
---

<section class="hero">
  <h1>Azure Landing Zone<br>for Startups</h1>
  <p class="tagline">A stripped-down, opinionated, production-ready Azure Landing Zone designed for startups and digital-native teams. Built for companies with 5–50 engineers that need to get Azure right from day one without enterprise complexity.</p>
  <div class="hero-ctas">
    <a href="#quick-start" class="btn btn-primary">Quick Start</a>
    <a href="{{ site.github_repo }}" class="btn btn-secondary" target="_blank" rel="noopener">View on GitHub</a>
  </div>
</section>

<section class="landing-section" markdown="1">

## TL;DR

- **One management group, two subscriptions** (Prod + Non-Prod) is all you need to start. Don't over-engineer your hierarchy.
- **Skip the hub network, Azure Firewall, and dedicated Connectivity subscription** until you actually have hybrid/on-prem requirements or 10+ workloads.
- **Enable Defender for Cloud CSPM (free) + Defender for Servers P2 on prod only.** Turn on diagnostic settings to a single Log Analytics workspace. That's your security baseline.
- **Set budget alerts at 50%, 80%, and 100% of your monthly burn.** Tag everything with `environment` and `team`. No exceptions.
- **Deploy this in under 1 hour with Bicep or Terraform.** Graduate to full ESLZ when you hit ~50 engineers, multi-region, or regulatory compliance requirements.

</section>

<section class="key-points landing-section">
  <h2>Why This Landing Zone</h2>
  <p class="section-subtitle">Enterprise-grade foundations without enterprise complexity.</p>
  <div class="cards-grid">
    <div class="card">
      <div class="card-icon">&#9889;</div>
      <h3>1 Hour Deploy</h3>
      <p>From zero to production-ready Azure with Bicep or Terraform. No consultants required.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#9878;</div>
      <h3>2 Subscriptions</h3>
      <p>One management group, prod + non-prod. Simple hierarchy that grows with you.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#128737;</div>
      <h3>Security Built-in</h3>
      <p>Defender for Cloud, RBAC, NSG deny-all defaults, policy enforcement from day one.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#128176;</div>
      <h3>Cost Aware</h3>
      <p>Budget alerts at 50/80/100%, tag enforcement, and reservation guidance built in.</p>
    </div>
  </div>
</section>

<section class="landing-section" markdown="1">

## Why This Exists

| What Exists Today | The Problem |
|---|---|
| [ALZ (Enterprise Scale)](https://aka.ms/alz) | 100+ modules, months to understand, built for 10k-seat enterprises |
| [ALZ-Bicep](https://github.com/Azure/ALZ-Bicep) | Still enterprise-scoped, overwhelming for a 10-person startup |
| [CAF Terraform Module](https://github.com/Azure/terraform-azurerm-caf-enterprise-scale) | Enterprise-scoped, entering extended support (archived Aug 2026). Microsoft now recommends [Azure Verified Modules](https://aka.ms/avm). |
| **This project** | **Deploys in 1 hour. Grows with you. Written for engineers, not consultants.** |

</section>

<section class="architecture-preview landing-section">
  <h2>Architecture Overview</h2>
  <p class="section-subtitle">Simple, self-contained subscriptions. No hub network, no Azure Firewall — until you need them.</p>
  <img src="{{ '/assets/images/architecture-overview.png' | relative_url }}" alt="Architecture overview showing Entra ID Tenant with management group, prod and nonprod subscriptions, networking, monitoring, policies, and budget alerts" style="max-width: 100%; border-radius: 10px; border: 1px solid var(--border-color);">
</section>

<section class="landing-section" id="quick-start" markdown="1">

## Quick Start

### Step 1: Check Prerequisites (5 min)

You need:
- **Azure CLI** — [Install guide](https://learn.microsoft.com/cli/azure/install-azure-cli)
- **Terraform** >= 1.5.0 — [Install guide](https://developer.hashicorp.com/terraform/install) (only for Terraform option)
- **Two Azure subscriptions** — One for prod, one for non-prod. [Create a subscription](https://learn.microsoft.com/azure/cost-management-billing/manage/create-subscription)
- **Permissions** — Owner on both subscriptions (or Owner on the Tenant Root Group if deploying management groups)

Fork this repo then run the pre-flight check to verify everything:

```bash
git clone https://github.com/<your-username>/sslz.git
cd sslz

# Login to Azure
az login
az account set --subscription <YOUR_PROD_SUBSCRIPTION_ID>

# Check all prerequisites
./scripts/validate-prerequisites.sh
```

If the script reports errors, fix them before proceeding. See [Troubleshooting]({{ '/docs/troubleshooting' | relative_url }}) for common issues.

### Step 2: Deploy the Landing Zone (20 min)

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

### Step 3: Verify the Deployment (5 min)

After deployment completes, verify in the Azure Portal or CLI:

```bash
# Check resource groups were created
az group list --query "[?contains(name, 'yourcompany')].name" -o tsv

# Check Log Analytics workspace
az monitor log-analytics workspace list --query "[].name" -o tsv

# Check policy assignments
az policy assignment list --query "[?contains(name, 'mcsb')].displayName" -o tsv
```

### Teardown

To destroy all landing zone resources:

```bash
# Terraform
./scripts/teardown.sh --tool terraform --env nonprod

# Bicep
./scripts/teardown.sh --tool bicep --env nonprod
```

### Step 4: Post-Deployment Setup (30 min)

See the [Day-1 Checklist](#day-1-checklist) below, and [CI/CD Setup]({{ '/docs/ci-cd-setup' | relative_url }}) if you're configuring GitHub Actions.

</section>

<section class="landing-section" id="day-1-checklist" markdown="1">

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
- [ ] Assign RBAC roles (see [Security docs]({{ '/docs/security' | relative_url }}))
- [ ] Set up CI/CD with Workload Identity Federation
- [ ] Test a sample deployment end-to-end

</section>

<section class="whats-included landing-section" markdown="1">

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

</section>

<section class="landing-section" markdown="1">

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

See [Graduation Guide]({{ '/docs/graduation-guide' | relative_url }}) for detailed migration paths to full ESLZ.

</section>

<section class="landing-section">
  <h2>Starter Examples</h2>
  <p class="section-subtitle">Pre-built configurations for common startup archetypes.</p>
  <div class="examples-grid">
    <a href="{{ site.github_repo }}/tree/main/examples/saas-startup" class="example-card" target="_blank" rel="noopener">
      <h3>SaaS Startup</h3>
      <p>Container Apps + Azure SQL Elastic Pool + Redis + Key Vault</p>
      <span class="card-link">View on GitHub &rarr;</span>
    </a>
    <a href="{{ site.github_repo }}/tree/main/examples/ai-startup" class="example-card" target="_blank" rel="noopener">
      <h3>AI Startup</h3>
      <p>AKS with GPU node pools + Azure OpenAI + Blob Storage</p>
      <span class="card-link">View on GitHub &rarr;</span>
    </a>
    <a href="{{ site.github_repo }}/tree/main/examples/api-first-startup" class="example-card" target="_blank" rel="noopener">
      <h3>API-First Startup</h3>
      <p>App Service + API Management + Cosmos DB</p>
      <span class="card-link">View on GitHub &rarr;</span>
    </a>
  </div>
</section>

<section class="landing-section">
  <h2>Documentation</h2>
  <p class="section-subtitle">Practical guides written for engineers, not consultants.</p>
  <div class="docs-grid">
    <a href="{{ '/docs/architecture' | relative_url }}" class="doc-card">
      <h3>Architecture Decisions</h3>
      <p>Why this layout, what we skipped, and when to revisit</p>
    </a>
    <a href="{{ '/docs/networking' | relative_url }}" class="doc-card">
      <h3>Networking Deep Dive</h3>
      <p>VNet design, NSGs, and when you actually need a hub</p>
    </a>
    <a href="{{ '/docs/security' | relative_url }}" class="doc-card">
      <h3>Security Baseline</h3>
      <p>Defender, RBAC, logging, and network security</p>
    </a>
    <a href="{{ '/docs/cost-management' | relative_url }}" class="doc-card">
      <h3>Cost Management</h3>
      <p>Budgets, reservations, and common cost mistakes</p>
    </a>
    <a href="{{ '/docs/ci-cd-setup' | relative_url }}" class="doc-card">
      <h3>CI/CD Setup</h3>
      <p>Workload Identity Federation and GitHub Actions</p>
    </a>
    <a href="{{ '/docs/troubleshooting' | relative_url }}" class="doc-card">
      <h3>Troubleshooting</h3>
      <p>Common deployment errors and fixes</p>
    </a>
    <a href="{{ '/docs/graduation-guide' | relative_url }}" class="doc-card">
      <h3>Graduation Guide</h3>
      <p>When and how to migrate to full ESLZ</p>
    </a>
    <a href="{{ '/diagrams/architecture' | relative_url }}" class="doc-card">
      <h3>Architecture Diagrams</h3>
      <p>Visual diagrams of the full landing zone</p>
    </a>
  </div>
</section>
