---
layout: page
title: "CI/CD Setup"
nav_order: 5
description: "Workload Identity Federation, GitHub Actions, and secrets management"
---

# CI/CD Setup with GitHub Actions

This guide walks you through setting up GitHub Actions authentication and Terraform state for direct operator-managed
Bicep or Terraform automation using Workload Identity Federation (WIF). WIF eliminates client secrets by issuing
short-lived tokens through OIDC. The classic SSLZ path remains operator-owned: review `what-if` or `terraform plan`
output, control the deployment identity and state, and run the provider command yourself.

## What you get at the end

| Piece | When it runs | What it needs |
|---|---|---|
| **Validate IaC** (bundled) | Automatically on every pull request | Nothing from Azure. It builds, lints and validates the code only. |
| **Deploy workflows** (`deploy-bicep.yml`, `deploy-terraform.yml`) | Only when you start them in **Actions > Run workflow** | The four secrets from Step 6 and an approved plan from the [agent path](https://startupscalelanding.zone/agent/docs/approved-deployment-integration/). Without that plan they refuse to run. |
| **Terraform Classic** (`terraform-classic.yml`) | Plan on pull requests, apply on `main` after you approve the `prod` environment | The identity, state and secrets from Steps 1-7, plus the repository variables listed in Step 8. Bicep has no equivalent workflow. |

Steps 1-7 prepare the identity, the Terraform state and the secrets. Step 8 proves the automatic validation works. It does not sign in to Azure, so the first real test of the Azure login happens in a deploy run.

## Prerequisites

- Azure CLI installed and authenticated (`az login`)
- Owner or User Access Administrator role on both subscriptions
- A GitHub repository with this code pushed to it

## Step 1: Create an Entra ID App Registration (5 min)

This creates the identity that GitHub Actions will use to authenticate to Azure.

```bash
# Set your variables
GITHUB_ORG="your-github-org"       # e.g., "acme-corp"
GITHUB_REPO="sslz"
APP_NAME="github-actions-landing-zone"

# Create the app registration
az ad app create --display-name "$APP_NAME" --query appId -o tsv
```

Save the output. This is your **Application (client) ID**, which you'll need later.

```bash
# Store it in a variable for the next steps
APP_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)
echo "App ID: $APP_ID"
```

## Step 2: Create a Service Principal (2 min)

The service principal is the Azure-side identity linked to your app registration.

```bash
az ad sp create --id "$APP_ID" --query id -o tsv
```

Save the output. This is the **Object ID** of the service principal.

## Step 3: Add Federated Credentials for GitHub Actions (5 min)

This tells Entra ID to trust tokens from your specific GitHub repository. You need one credential for the `main` branch
and one for pull requests.

```bash
# Credential for the main branch
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-actions-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"],
  "description": "GitHub Actions deploy from main branch"
}'

# Credential for pull requests
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-actions-pr",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':pull_request",
  "audiences": ["api://AzureADTokenExchange"],
  "description": "GitHub Actions validation on pull requests"
}'
```

A job that sets `environment:` sends the `environment:<name>` subject instead of the branch or pull request subject. The bundled deploy workflows set it, so add these credentials if you use them or Step 7 environments:

```bash
# Credential for nonprod environment
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-actions-nonprod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':environment:nonprod",
  "audiences": ["api://AzureADTokenExchange"],
  "description": "GitHub Actions deploy to nonprod"
}'

# Credential for prod environment
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-actions-prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':environment:prod",
  "audiences": ["api://AzureADTokenExchange"],
  "description": "GitHub Actions deploy to prod"
}'

```

## Step 4: Assign Azure Roles (5 min)

Grant the service principal the required roles on both subscriptions:

```bash
PROD_SUB_ID="your-prod-subscription-id"
NONPROD_SUB_ID="your-nonprod-subscription-id"

# Contributor — create and manage all resources
az role assignment create \
  --assignee "$APP_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$PROD_SUB_ID"

az role assignment create \
  --assignee "$APP_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$NONPROD_SUB_ID"

# User Access Administrator — required for DINE/Modify policies that create
# managed identities and their role assignments
az role assignment create \
  --assignee "$APP_ID" \
  --role "User Access Administrator" \
  --scope "/subscriptions/$PROD_SUB_ID"

az role assignment create \
  --assignee "$APP_ID" \
  --role "User Access Administrator" \
  --scope "/subscriptions/$NONPROD_SUB_ID"

# Resource Policy Contributor — required for policy assignments
az role assignment create \
  --assignee "$APP_ID" \
  --role "Resource Policy Contributor" \
  --scope "/subscriptions/$PROD_SUB_ID"

az role assignment create \
  --assignee "$APP_ID" \
  --role "Resource Policy Contributor" \
  --scope "/subscriptions/$NONPROD_SUB_ID"

# Security Admin — required for Defender for Cloud configuration
az role assignment create \
  --assignee "$APP_ID" \
  --role "Security Admin" \
  --scope "/subscriptions/$PROD_SUB_ID"

az role assignment create \
  --assignee "$APP_ID" \
  --role "Security Admin" \
  --scope "/subscriptions/$NONPROD_SUB_ID"
```

> **Deploying management groups?** The roles above are subscription-scoped. Creating the management group hierarchy also needs tenant-level access for the service principal (for example Management Group Contributor on the Tenant Root Group, and deployment permission at / for Bicep; see Step 2 of the README). Skip this if you only deploy to the subscriptions.

> **Why User Access Administrator?** The landing zone includes DINE (Deploy If Not Exists) and Modify policies. When Azure enforces these policies, it creates system-assigned managed identities and grants them role assignments. The service principal deploying these policies needs `Microsoft.Authorization/roleAssignments/write` permission, which Contributor alone does not provide.

## Step 5: Set Up Terraform Remote Backend (5 min)

Terraform keeps a state file that records what it created. In CI each run starts on a fresh machine, so the state must live in Azure Storage. That storage account has to exist **before** the first `terraform init`. You create it once, with the script below. It is not part of the landing zone itself.

The script creates the resource group `rg-terraform-state`, a storage account (locked, with blob versioning) and a `tfstate` container.

```bash
# Create the storage account for Terraform state
# Run this from the repo root, targeting the prod subscription
# Reuses PROD_SUB_ID from Step 4 (set it again if you opened a new terminal)
az account set --subscription "$PROD_SUB_ID"

# Pick a globally unique name: 3-24 lowercase letters and digits
STATE_SA="stsslz$RANDOM$RANDOM"
echo "State storage account: $STATE_SA"   # save this name for main.tf
./scripts/bootstrap-backend.sh -s "$STATE_SA"
```

Prefer to create it by hand? This is what the script does:

```bash
az group create --name rg-terraform-state --location eastus2
az storage account create --name "$STATE_SA" --resource-group rg-terraform-state \
  --location eastus2 --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false
az storage container create --name tfstate --account-name "$STATE_SA" --auth-mode login
```

`infra/terraform/main.tf` ships with the placeholder `storage_account_name = "yourStorageAccount"`. Replace it with `$STATE_SA` (and `resource_group_name` if you passed `-g`), then commit the change. Without this, `terraform init` in CI fails to find the backend.

Next, grant the CI/CD service principal access to the state storage:

```bash
# Get the service principal object ID
SP_OID=$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)

# Grant Storage Blob Data Contributor on the state resource group
az role assignment create \
  --assignee-object-id "$SP_OID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/rg-terraform-state"
```

## Step 6: Configure GitHub Repository Secrets (5 min)

In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add these as **repository-level** secrets (the Azure login step reads them as secrets.*):

| Secret Name | Value | Where to Find It |
|---|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID from Step 1 | `az ad app show --id $APP_ID --query appId -o tsv` |
| `AZURE_TENANT_ID` | Your Entra ID tenant ID | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID_PROD` | Prod subscription UUID | Azure Portal > Subscriptions |
| `AZURE_SUBSCRIPTION_ID_NONPROD` | Non-prod subscription UUID | Azure Portal > Subscriptions |

> **Single subscription?** If you only have one subscription, set both `AZURE_SUBSCRIPTION_ID_PROD` and `AZURE_SUBSCRIPTION_ID_NONPROD` to the same value.

The bundled deploy workflows (`deploy-bicep.yml` and `deploy-terraform.yml`) read only these four secrets plus the
optional repository variables `SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE`, `SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE`
and `SSLZ_TERRAFORM_EXECUTABLE`. They do not read company name, budget, region or backend values. Those come from the
approved plan (agent path) or from your own parameter files and workflow (classic path).

If you write your own Terraform workflow, pass the values from Step 5 (backend storage account and resource group) and
your `terraform.tfvars` settings to it yourself.

### Step 6b: Customize Bicep Parameter Files (Bicep only)

If you automate Bicep yourself, update the parameter files with your actual values **before** triggering a deploy:

- `infra/bicep/parameters/prod.bicepparam` — production settings
- `infra/bicep/parameters/nonprod.bicepparam` — non-production settings

Edit the two files in place. Do not copy them to `*.local.bicepparam` for CI: those files are git-ignored, so they never
reach the runner. (The "copy to `.local`" comment at the top of each file is for local deploys from your machine.)

Change every value in SECTION 1 except `environment`, which must stay `prod` and `nonprod` (`companyName`, `location`,
`securityContactEmail`, `monthlyBudgetAmount`, `budgetAlertEmails`, `budgetStartDate`), and review `allowedLocations`.

- Use the same `companyName` in both files: lowercase letters and digits, 2-10 characters. It ends up in every resource name.
- `budgetStartDate` must be the first day of the month of your deployment, for example `2026-11-01T00:00:00Z`.
- `budgetAlertEmails` and `securityContactEmail` must be real addresses you read.

Commit and push the changes.

## Step 7: Create GitHub Environments (Optional, Recommended)

GitHub Environments add an approval gate before production deployments.

1. Go to **Settings > Environments**
2. Create a **nonprod** environment.
3. Create a **prod** environment with required reviewers and deployment branches restricted to `main`.

## Step 8: Test the Setup

### Validate on a Pull Request

Push a change to a branch and create a pull request:

```bash
git checkout -b test-cicd
# Make a small change (e.g., edit a comment in infra/terraform/main.tf)
git add . && git commit -m "test: verify CI/CD setup"
git push -u origin test-cicd
```

The **Validate IaC** workflow should run automatically on the PR. It builds and lints Bicep, formats and validates
Terraform, and runs repository contract tests without deploying Azure resources.

### Automate the classic direct-operator path

The repository ships a ready Terraform workflow for this path: `.github/workflows/terraform-classic.yml`. It runs
`terraform plan` on pull requests that touch `infra/terraform/`, and on `main` it applies the saved plan only after you
approve the **prod** environment (Step 7). It signs in with the OIDC identity from Steps 1-6 and keeps state in the
storage account from Step 5. It does not use the agent approval flow.

Add these **repository variables** (**Settings > Secrets and variables > Actions > Variables**; they are not secret):

| Variable | Example |
|---|---|
| `SSLZ_STATE_STORAGE_ACCOUNT` | The `$STATE_SA` name from Step 5 |
| `SSLZ_COMPANY_NAME` | `contoso` (lowercase letters and digits) |
| `SSLZ_SECURITY_CONTACT_EMAIL` | `security@contoso.com` |
| `SSLZ_MONTHLY_BUDGET_AMOUNT` | `500` |
| `SSLZ_BUDGET_ALERT_EMAILS` | `["finance@contoso.com"]` (a JSON list) |

The workflow deploys the **prod** environment to `AZURE_SUBSCRIPTION_ID_PROD`. To try it, open **Actions > Terraform
Classic > Run workflow**, check the plan in the run summary, then approve the **prod** environment on the `apply` job. The
`apply` job runs only on `main`. For Bicep, build a similar workflow around `az deployment sub what-if` and
`az deployment sub create`. The operator remains responsible for identity, state, review, validation, and rollback.

The repository's bundled approval-bound deployment workflows belong to the
[optional agent-aware experience](https://startupscalelanding.zone/agent/docs/approved-deployment-integration/); they are not
required by the classic Quick Start.

## Troubleshooting

### "AADSTS70021: No matching federated identity record found"

The federated credential `subject` doesn't match the GitHub Actions context. Common causes:
- Typo in the org/repo name
- Using `ref:refs/heads/main` but the workflow runs on a PR (needs `pull_request` subject)
- Using `environment:prod` but the job doesn't have `environment: prod` set

**Fix:** Check the exact subject claim in the GitHub Actions run log and compare to your federated credential.

### "AuthorizationFailed" on role assignments

The deployment fails with `does not have permission to perform action 'Microsoft.Authorization/roleAssignments/write'`.

**Cause:** The DINE/Modify policies create managed identities that need role assignments. The service principal needs `User Access Administrator` to create these.

**Fix:** Add the missing role:
```bash
az role assignment create \
  --assignee "$APP_ID" \
  --role "User Access Administrator" \
  --scope "/subscriptions/$SUB_ID"
```

### "AuthorizationFailed" on resource creation

The service principal doesn't have the right role on the subscription.

**Fix:** Verify role assignments:
```bash
az role assignment list --assignee "$APP_ID" --all --query "[].{role:roleDefinitionName, scope:scope}" -o table
```

### "Resource provider not registered"

Some providers need to be registered before use. Run `./scripts/validate-prerequisites.sh` to check, or register them
manually:

```bash
for ns in Microsoft.Resources Microsoft.Network Microsoft.OperationalInsights Microsoft.Security \
  Microsoft.PolicyInsights Microsoft.Consumption Microsoft.Authorization Microsoft.Insights; do
  az provider register --namespace "$ns"
done
```
