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

Grant the service principal Contributor access on both subscriptions. Contributor can create and manage resources but cannot modify role assignments (which is the right level of access for CI/CD).

```bash
PROD_SUB_ID="your-prod-subscription-id"
NONPROD_SUB_ID="your-nonprod-subscription-id"

# Contributor on prod subscription
az role assignment create \
  --assignee "$APP_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$PROD_SUB_ID"

# Contributor on nonprod subscription
az role assignment create \
  --assignee "$APP_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$NONPROD_SUB_ID"
```

Some resources in this landing zone also need these additional roles:

```bash
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

## Step 5: Configure GitHub Repository Secrets (5 min)

In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add these secrets:

| Secret Name | Value | Where to Find It |
|---|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID from Step 1 | `az ad app show --id $APP_ID --query appId -o tsv` |
| `AZURE_TENANT_ID` | Your Entra ID tenant ID | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID_PROD` | Prod subscription UUID | Azure Portal > Subscriptions |
| `AZURE_SUBSCRIPTION_ID_NONPROD` | Non-prod subscription UUID | Azure Portal > Subscriptions |

Also add these **repository variables** (Settings > Secrets and variables > Actions > Variables tab):

| Variable Name | Value | Used By | Purpose |
|---|---|---|---|
| `AZURE_LOCATION` | Azure region (e.g., `eastus2`) | Bicep + Terraform | Deployment location |
| `COMPANY_NAME` | Your company name (e.g., `acme`) | Terraform only | Used in resource naming |
| `BUDGET_ALERT_EMAILS` | `["team@acme.com"]` | Terraform only | Budget alert recipients (JSON array) |
| `SECURITY_CONTACT_EMAIL` | `security@acme.com` | Terraform only | Defender alert recipient |

> **Bicep users:** The Terraform-only variables above have sensible defaults in the workflow, but Bicep gets its values from parameter files instead. See Step 5b below.

### Step 5b: Customize Bicep Parameter Files (Bicep only)

If deploying with the Bicep workflow, update the parameter files with your actual values **before** triggering a deploy:

- `infra/bicep/parameters/prod.bicepparam` — production settings
- `infra/bicep/parameters/nonprod.bicepparam` — non-production settings

At minimum, update `companyName`, `budgetAlertEmails`, `securityContactEmail`, and `allowedLocations`. Commit and push the changes.

## Step 6: Create GitHub Environments (Optional, Recommended)

GitHub Environments add an approval gate before production deployments.

1. Go to **Settings > Environments**
2. Create **nonprod** environment (no protection rules needed)
3. Create **prod** environment with:
   - **Required reviewers:** Add 1-2 team members who must approve production deployments
   - **Deployment branches:** Restrict to `main` only

## Step 7: Test the Setup

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

If you configured GitHub Environments with required reviewers in Step 6, production deployments will wait for approval before the deploy step runs.

## Troubleshooting

### "AADSTS70021: No matching federated identity record found"

The federated credential `subject` doesn't match the GitHub Actions context. Common causes:
- Typo in the org/repo name
- Using `ref:refs/heads/main` but the workflow runs on a PR (needs `pull_request` subject)
- Using `environment:prod` but the job doesn't have `environment: prod` set

**Fix:** Check the exact subject claim in the GitHub Actions run log and compare to your federated credential.

### "AuthorizationFailed" on resource creation

The service principal doesn't have the right role on the subscription.

**Fix:** Verify role assignments:
```bash
az role assignment list --assignee "$APP_ID" --all --query "[].{role:roleDefinitionName, scope:scope}" -o table
```

### "Resource provider not registered"

Some providers need to be registered before use. Run `./scripts/validate-prerequisites.sh` to check, or register manually:

```bash
az provider register --namespace Microsoft.Insights
az provider register --namespace Microsoft.Security
az provider register --namespace Microsoft.PolicyInsights
```
