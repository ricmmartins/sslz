---
layout: page
title: "Troubleshooting"
nav_order: 6
description: "Common deployment errors and fixes"
---

# Troubleshooting

## Common Deployment Errors

### Management Group Permissions

**Error:** `AuthorizationFailed` when deploying management groups.

**Cause:** The deploying identity lacks tenant-level permissions. Management group operations require `Microsoft.Management/managementGroups/write` at the **tenant root group** scope (`/`). A subscription-level role assignment is not sufficient.

**Fix:**
1. Assign the identity the "Management Group Contributor" role at the **tenant root group** scope:
   ```bash
   az role assignment create \
     --assignee "<SP_OBJECT_ID>" \
     --role "Management Group Contributor" \
     --scope "/"
   ```
2. Or deploy management groups separately with a privileged identity:
   ```bash
   cd infra/terraform/modules/management-groups
   terraform init && terraform apply
   ```

### Budget Start Date Format

**Error:** `budget_start_date must be the first of a month in ISO 8601 format`

**Cause:** The budget start date must be exactly `YYYY-MM-01T00:00:00Z`.

**Fix:**
- Leave `budget_start_date` empty to use the default (1st of current month)
- Or set it explicitly: `budget_start_date = "2026-01-01T00:00:00Z"`
- In CI, it's auto-set: `TF_VAR_budget_start_date=$(date -u +%Y-%m-01T00:00:00Z)`

### Backend Not Configured

**Error:** `Backend initialization required` or state file conflicts in CI.

**Cause:** The default backend is local. CI runs need remote state to persist between runs.

**Fix:**
1. Run `scripts/bootstrap-backend.sh` to create the storage account
2. Uncomment and configure the `backend "azurerm"` block in `infra/terraform/main.tf`
3. Run `terraform init -migrate-state` to move existing state

### Policy Assignment Conflicts

**Error:** `PolicyAssignmentAlreadyExists` or `PolicyDefinitionNotFound`

**Cause:** Policy assignments are subscription-scoped singletons. Re-deploying to the same subscription with different names causes conflicts.

**Fix:**
- Ensure only one deployment targets each subscription at a time
- If you renamed a policy assignment, delete the old one first:
  ```bash
  az policy assignment delete --name "old-assignment-name" --scope "/subscriptions/$SUB_ID"
  ```

### Defender Plan Costs

**Warning:** Unexpected charges after enabling Defender plans.

**Context:** Defender plans are billed per-resource:
- **Servers P2:** ~$15/server/month
- **Containers:** ~$7/vCore/month
- **Key Vault:** ~$0.02/10K transactions
- **Databases:** ~$15/server/month
- **ARM:** ~$4/subscription/month (always enabled)

**Fix:**
- Review which plans are enabled: check `enable_defender_for_*` variables
- For cost-sensitive environments, only enable Key Vault (low cost) and ARM (always on)
- Disable unused plans: set the corresponding variable to `false`

### Provider Registration

**Error:** `MissingSubscriptionRegistration` for `Microsoft.Insights`, `Microsoft.Security`, etc.

**Cause:** Azure resource providers must be registered before use.

**Fix:**
```bash
az provider register --namespace Microsoft.Insights
az provider register --namespace Microsoft.Security
az provider register --namespace Microsoft.PolicyInsights
az provider register --namespace Microsoft.App
```

Or run `scripts/validate-prerequisites.sh` to check all required providers.

### Subscription Tenant Mismatch

**Error:** `InvalidSubscriptionId` or `SubscriptionNotFound`

**Cause:** The subscription belongs to a different Entra ID tenant than the one you're authenticated to.

**Fix:**
1. Verify your current tenant: `az account show --query tenantId`
2. Login to the correct tenant: `az login --tenant <TENANT_ID>`
3. Set the correct subscription: `az account set --subscription <SUB_ID>`

### Public Network Access Disabled Without Private Endpoints

**Error:** Timeout or connection refused when accessing SQL Server or Redis.

**Cause:** `publicNetworkAccess: 'Disabled'` blocks all public traffic, but no Private Endpoints exist.

**Fix:**
- Deploy Private Endpoints (see `deploy_private_endpoints` variable in the SaaS example)
- Or temporarily enable public access for testing:
  ```bash
  az sql server update --name <server> --resource-group <rg> --set publicNetworkAccess=Enabled
  ```

### Terraform "Resource Already Exists" on First Apply

**Error:** `a resource with the ID "…" already exists - to be managed via Terraform this resource needs to be imported into the State`

**Cause:** Azure auto-creates `securityContacts/default` with empty values when any Defender plan is enabled on a subscription. The activity log diagnostic setting may exist from a prior deployment or from the `activity-log-diag` DINE policy. Common examples:

- `securityContacts/default` — auto-created by Azure when any Defender plan is enabled (even via Portal)
- `diag-activity-log-to-law` — created by a prior Bicep deployment or the `activity-log-diag` DINE policy

**Fix:** The Terraform code includes an `import` block that automatically adopts the pre-existing security contact into state. If you still see this error, run:
```bash
SUB_ID="<YOUR_SUBSCRIPTION_ID>"

# Import pre-existing security contact
terraform import module.security.azurerm_security_center_contact.default \
  "/subscriptions/${SUB_ID}/providers/Microsoft.Security/securityContacts/default"

# Import pre-existing diagnostic setting
terraform import azurerm_monitor_diagnostic_setting.activity_log \
  "/subscriptions/${SUB_ID}|diag-activity-log-to-law"

# Re-plan and apply
terraform plan -out=tfplan && terraform apply tfplan
```

> **Tip:** On a fresh subscription with no prior deployments, these errors should not occur.

### Bicep What-If Shows Unexpected Changes

**Error:** `what-if` output shows resources being recreated.

**Cause:** Bicep deployments are idempotent but some property changes (like SKU changes) require recreation.

**Fix:**
- Review the what-if output carefully before deploying
- For critical resources, use `az deployment sub create --mode Incremental` (default)
- Never use `--mode Complete` at subscription scope — it will delete unmanaged resource groups
