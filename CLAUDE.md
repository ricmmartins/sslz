# Azure Landing Zone for Startups

## Project Structure

```
infra/
  bicep/           # Bicep IaC (subscription-scoped deployment)
    modules/       # Reusable Bicep modules
    parameters/    # Environment-specific .bicepparam files
  terraform/       # Terraform IaC (equivalent to Bicep)
    modules/       # Reusable TF modules (each has main.tf, variables.tf, outputs.tf)
examples/
  saas-startup/    # Container Apps + Azure SQL + Redis + Key Vault + optional Private Endpoints
  ai-startup/      # AKS with GPU pools + Azure OpenAI + Blob Storage
  api-first-startup/ # App Service + API Management + Cosmos DB
docs/
  architecture.md  # Architecture decisions, rollback guidance
  networking.md    # VNet design, NSGs, Private Endpoints
  security.md      # Defender, RBAC, logging
  cost-management.md # Budgets, RI guidance
  ci-cd-setup.md   # Workload Identity Federation setup for GitHub Actions
  troubleshooting.md # Common deployment errors and fixes
  graduation-guide.md # Migration path to full ESLZ
scripts/
  bootstrap-backend.sh     # Create Azure Storage for TF remote state
  validate-prerequisites.sh # Pre-flight checks (CLI tools, auth, providers)
  teardown.sh              # Safely destroy landing zone resources
.github/workflows/         # CI/CD pipelines (validate, deploy, integration test)
```

## Conventions

### Naming
- Resources: `{type}-{prefix}-{purpose}` (e.g., `rg-myco-prod-monitoring`, `law-myco-prod`)
- Prefix: `{company_name}-{environment}` by default
- Terraform modules: snake_case for resources/variables, kebab-case for Azure resource names
- Bicep: camelCase for params/vars, kebab-case for Azure resource names

### Module Structure (Terraform)
Every module under `infra/terraform/modules/` must have:
- `main.tf` — Resources and locals only
- `variables.tf` — All input variables
- `outputs.tf` — All outputs

### Bicep Patterns
- Subscription-scoped deployments (`targetScope = 'subscription'`)
- Module params use `@description()` decorators
- Validation via `@allowed()`, `@minValue()`, `@maxValue()`

## Validation Commands

```bash
# Terraform
terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate
terraform -chdir=examples/saas-startup/terraform init -backend=false && terraform -chdir=examples/saas-startup/terraform validate

# Bicep
az bicep build --file infra/bicep/main.bicep --stdout > /dev/null
az bicep lint --file infra/bicep/main.bicep

# Shell scripts
shellcheck scripts/*.sh

# Linting
tflint --config=.tflint.hcl --chdir=infra/terraform
```

## Key Architecture Decisions
- Single management group (not deep hierarchy) — suitable for startups with 2-5 subscriptions
- No hub VNet — self-contained VNets per subscription to avoid Azure Firewall costs
- Policy in Audit mode for MCSB — Deny mode used only for locations and tags
- Defender plans are opt-in via variables (except CSPM Free and ARM which are always on)
- Budget start date defaults to 1st of current month via `plantimestamp()`

## Environment Variables for CI
- `TF_VAR_subscription_id` — Target subscription
- `TF_VAR_budget_start_date` — Auto-set in CI via `date -u +%Y-%m-01T00:00:00Z`
- `TF_VAR_budget_alert_emails` — JSON array of emails
- `TF_VAR_security_contact_email` — Defender alert recipient
