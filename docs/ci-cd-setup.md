---
layout: page
title: "CI/CD Setup"
nav_order: 5
description: "Workload Identity Federation, GitHub Actions, and secrets management"
---

# CI/CD Setup with GitHub Actions

This guide walks you through setting up GitHub Actions to deploy the landing zone automatically using Workload Identity Federation (WIF). WIF eliminates the need for client secrets — instead, GitHub Actions gets short-lived tokens via OIDC.

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

Save the output — this is your **Application (client) ID**. You'll need it later.

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

Save the output — this is the **Object ID** of the service principal.

## Step 3: Add Federated Credentials for GitHub Actions (5 min)

This tells Entra ID to trust tokens from your specific GitHub repository. You need one credential for the `main` branch (for deployments) and one for pull requests (for plan/what-if).

```bash
# Credential for the main branch (used by deploy workflows)
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-actions-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"],
  "description": "GitHub Actions deploy from main branch"
}'

# Credential for pull requests (used by plan/what-if workflows)
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-actions-pr",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':pull_request",
  "audiences": ["api://AzureADTokenExchange"],
  "description": "GitHub Actions plan on pull requests"
}'
```

If you use GitHub Environments (recommended for production approvals), add credentials for each environment:

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

> **Why User Access Administrator?** The landing zone includes DINE (Deploy If Not Exists) and Modify policies. When Azure enforces these policies, it creates system-assigned managed identities and grants them role assignments. The service principal deploying these policies needs `Microsoft.Authorization/roleAssignments/write` permission, which Contributor alone does not provide.

## Step 5: Set Up Terraform Remote Backend (5 min)

The Terraform deploy workflow requires a remote backend to persist state between runs. Without it, each run starts from scratch and fails on existing resources.

```bash
# Create the storage account for Terraform state
# Run this from the repo root, targeting the prod subscription
az account set --subscription <YOUR_PROD_SUBSCRIPTION_ID>
./scripts/bootstrap-backend.sh -s <storage-account-name>
```

The storage account name must be globally unique, 3-24 lowercase alphanumeric characters (e.g., `stterraformsslz`).

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

In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add these as **repository-level** secrets (not environment secrets — the validate/plan jobs don't reference a GitHub environment):

| Secret Name | Value | Where to Find It |
|---|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID from Step 1 | `az ad app show --id $APP_ID --query appId -o tsv` |
| `AZURE_TENANT_ID` | Your Entra ID tenant ID | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID_PROD` | Prod subscription UUID | Azure Portal > Subscriptions |
| `AZURE_SUBSCRIPTION_ID_NONPROD` | Non-prod subscription UUID | Azure Portal > Subscriptions |

> **Single subscription?** If you only have one subscription, set both `AZURE_SUBSCRIPTION_ID_PROD` and `AZURE_SUBSCRIPTION_ID_NONPROD` to the same value.

Also add these **repository-level variables** (Settings > Secrets and variables > Actions > Variables tab):

| Variable Name | Value | Used By | Purpose |
|---|---|---|---|
| `AZURE_LOCATION` | Azure region (e.g., `eastus2`) | Bicep + Terraform | Deployment location |
| `COMPANY_NAME` | Your company name (e.g., `acme`) | Terraform only | Used in resource naming |
| `BUDGET_ALERT_EMAILS` | `team@acme.com,cto@acme.com` | Terraform only | Budget alert recipients (comma-separated) |
| `SECURITY_CONTACT_EMAIL` | `security@acme.com` | Terraform only | Defender alert recipient |
| `TF_BACKEND_STORAGE_ACCOUNT` | Storage account name from Step 5 | Terraform only | Remote state backend |
| `TF_BACKEND_RESOURCE_GROUP` | `rg-terraform-state` | Terraform only | Resource group for state (default: `rg-terraform-state`) |

> **Bicep users:** The Terraform-only variables above have sensible defaults in the workflow, but Bicep gets its values from parameter files instead. See Step 5b below.

### Step 6b: Customize Bicep Parameter Files (Bicep only)

If deploying with the Bicep workflow, update the parameter files with your actual values **before** triggering a deploy:

- `infra/bicep/parameters/prod.bicepparam` — production settings
- `infra/bicep/parameters/nonprod.bicepparam` — non-production settings

At minimum, update `companyName`, `budgetAlertEmails`, `securityContactEmail`, and `allowedLocations`. Commit and push the changes.

## Step 7: Create GitHub Environments (Optional, Recommended)

GitHub Environments add an approval gate before production deployments.

1. Go to **Settings > Environments**
2. Create **nonprod** environment (no protection rules needed)
3. Create **prod** environment with:
   - **Required reviewers:** Add 1-2 team members who must approve production deployments
   - **Deployment branches:** Restrict to `main` only

## Local agent-generated review inputs

The startup IaC planner is additive and does not replace either manual deployment workflow. It writes generated
`.local.bicepparam` and `.auto.tfvars` files only under the ignored `.sslz/generated/` directory:

```bash
./scripts/startup-iac-plan.sh generate \
  --input <iac-plan-input.json> \
  --provider both \
  --output-dir .sslz/generated/review
```

Add `--preview` only in an authenticated environment. Bicep uses subscription-scope what-if with incremental-only
semantics. Terraform uses plan and requires explicit `azurerm` remote-backend coordinates, including the backend
subscription ID, in the input. Backend access uses Azure AD data-plane authentication; the command does not invent
credentials or allow local shared state. Raw preview output is not retained unless
`--raw-artifact-dir` explicitly names a subdirectory beneath the selected generated output directory.

## Step 8: Test the Setup

### Validate on a Pull Request

Push a change to a branch and create a pull request:

```bash
git checkout -b test-cicd
# Make a small change (e.g., edit a comment in infra/terraform/main.tf)
git add . && git commit -m "test: verify CI/CD setup"
git push -u origin test-cicd
```

The **Validate IaC** workflow should run automatically on the PR. If you see the Terraform plan and Bicep what-if succeed, your setup is working.

### Deploy via Workflow Dispatch

The deploy workflows are triggered manually (not on push). To run a deployment:

1. Go to **Actions** tab in your GitHub repository
2. Select **Deploy Bicep** or **Deploy Terraform** from the left sidebar
3. Click **Run workflow**
4. Choose the target environment (`prod` or `nonprod`)
5. Click **Run workflow** to start

If you configured GitHub Environments with required reviewers in Step 7, production deployments will wait for approval before the deploy step runs.

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

Some providers need to be registered before use. Run `./scripts/validate-prerequisites.sh` to check. A provider
required by the selected startup workload profile can be registered only through a reviewed Phase 4 action and
separate approval:

```bash
./scripts/startup-provider-remediation.sh dry-run \
  --plan .sslz/generated/my-plan/plan-summary.json \
  --action provider.register.prod.microsoft-app
```

See [Approved Provider Remediation](provider-remediation.md). Other providers remain manual prerequisites.

## Optional approved deployment integration

The agent-assisted deployment command is additive and is not called by either existing deployment workflow. Provision
the Ed25519 approval public key as a protected read-only runner file and expose only its absolute path through
`SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE`. Keep `.sslz/generated/` and `.sslz/deployment-state/` on protected storage
for the review and apply jobs.

Run Phase 6 preview first, send its nested immutable manifest to the approval system, and apply only the returned signed
artifact:

```bash
./scripts/startup-deployment-integration.sh preview \
  --plan .sslz/generated/my-plan/plan-summary.json \
  --provider terraform \
  --environment nonprod \
  --terraform-auth oidc
```

The identity needs only the existing SSLZ root's permissions at the exact target subscription, read permissions for the
post-deployment checks, and access to the reviewed Terraform backend. Do not grant automatic role escalation. See
[Approved Deployment Integration](approved-deployment-integration.md).
