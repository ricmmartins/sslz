# Example: SaaS Startup

A multi-tenant SaaS application running on Azure Container Apps with Azure SQL.

## Architecture

```
Internet
    │
Azure Container Apps Environment
    ├── container-app-api      (backend API)
    └── container-app-web      (frontend SPA / SSR)
    │
    ├── Azure SQL (Elastic Pool)
    ├── Azure Cache for Redis
    └── Azure Key Vault
```

> **Tip:** When you need global load balancing, WAF, or CDN, add Azure Front Door in front of the Container Apps ingress.

## Why This Stack

| Choice | Rationale |
|---|---|
| Container Apps over AKS | No cluster management. Scale to zero. Pay per use. Good enough until you need custom Kubernetes operators. |
| Azure SQL Elastic Pool | Multi-tenant database with shared resources. DTU pooling saves 50-70% vs individual databases. |
| Redis | Session cache, rate limiting, pub/sub for real-time features. |

## Estimated Monthly Cost

| Resource | SKU | Est. Cost |
|---|---|---|
| Container Apps | Consumption (2 vCPU, 4GB per app) | $50-150 |
| Azure SQL Elastic Pool | Standard 100 eDTU | $225 |
| Redis | Basic C0 | $16 |
| Key Vault | Standard | $1-5 |
| **Total** | | **~$300-400/month** |

## Deploy

### Bicep

```bash
cd examples/saas-startup

az deployment group create \
  --resource-group rg-mycompany-prod-app \
  --template-file main.bicep \
  --parameters main.bicepparam
```

### Terraform

```bash
cd examples/saas-startup/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

## Key Decisions

### Multi-Tenancy

This example uses **shared database, shared schema** with a `tenant_id` column. This is the simplest model and works until:
- A single tenant needs dedicated resources (noisy neighbor)
- Compliance requires data isolation (HIPAA, per-customer encryption keys)
- You exceed ~1000 tenants per database

When you hit these limits, move to **database-per-tenant** using Elastic Pool (each tenant gets a database in the pool, sharing DTUs).

### Scaling

Container Apps scales based on HTTP traffic or KEDA scalers. Set:
- **Min replicas:** 1 for prod (avoid cold starts), 0 for non-prod
- **Max replicas:** Start with 10, increase based on load testing
- **Scale rule:** HTTP concurrent requests (default: 10 per replica)

### Secrets

All secrets in Key Vault, referenced by Container Apps via managed identity. Never put connection strings in environment variables directly.
