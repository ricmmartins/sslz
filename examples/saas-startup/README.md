# Example: SaaS Startup

A multi-tenant SaaS application running on Azure Container Apps with Azure SQL.

## Architecture

```
Internet
    │
Azure Container Apps Environment (public mode or VNet-injected private-data mode)
    ├── ca-<app>-api            (backend API)
    └── ca-<app>-web            (frontend SPA / SSR)
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
| Redis | Standard C1 (prod) / Basic C0 (nonprod) | $54 / $16 |
| Key Vault | Standard | $1-5 |
| **Total** | | **~$330-440/month** |

## Deploy

### Prerequisites

- Azure CLI `>= 2.53.0` with Bicep CLI (or Terraform `>= 1.5.0`)
- An existing resource group (you must create this — the landing zone does not create application resource groups)

### Bicep

```bash
cd examples/saas-startup

# Copy and customize the parameter file (keeps secrets out of git)
cp main.bicepparam main.local.bicepparam
# Edit main.local.bicepparam with your values

az deployment group create \
  --resource-group rg-mycompany-prod-app \
  --template-file main.bicep \
  --parameters main.local.bicepparam
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

Store secrets (SQL connection strings, Redis keys, API keys) in Key Vault and reference them from Container Apps via managed identity. The API container app has a system-assigned identity with `Key Vault Secrets User` access. Never put connection strings in environment variables directly.

### Private Endpoints (Optional)

By default, Azure SQL and Redis have `publicNetworkAccess: Enabled`, and the Container Apps environment keeps its platform-managed network. This default public path is unchanged.

Private mode is an atomic network configuration: the Container Apps environment is injected into a dedicated infrastructure subnet, SQL and Redis public access is disabled, both services receive Private Endpoints in a separate subnet, and both Private DNS zones are linked to the VNet containing those subnets.

Before enabling private mode, prepare one VNet with:

- A dedicated Container Apps infrastructure subnet with a single IPv4 prefix of `/27` or larger, delegated to `Microsoft.App/environments`. Size for expected replicas and zero-downtime revision changes; `/23` is a practical growth-oriented starting point.
- A distinct, non-overlapping subnet for SQL and Redis Private Endpoints.
- Address space that does not overlap the Container Apps reserved ranges documented in [Azure Container Apps virtual network configuration](https://learn.microsoft.com/azure/container-apps/custom-virtual-networks#subnet).

The templates reject malformed or cross-VNet resource IDs, reuse of one subnet for both purposes, undersized or overlapping subnet prefixes, and Container Apps reserved-range overlap. Bicep also verifies the existing subnet delegation before creating the environment; Terraform relies on Azure's Container Apps resource validation for the delegation because the AzureRM subnet data source does not expose delegation metadata.

**Bicep:**
```bash
az deployment group create \
  --resource-group rg-mycompany-prod-app \
  --template-file main.bicep \
  --parameters main.bicepparam \
  --parameters deployPrivateEndpoints=true \
               containerAppsInfrastructureSubnetId='/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>/subnets/snet-container-apps' \
               privateEndpointSubnetId='/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>/subnets/snet-private-endpoints' \
               vnetId='/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>'
```

**Terraform:**
```hcl
deploy_private_endpoints   = true
vnet_id                    = "/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>"
container_apps_infrastructure_subnet_id = "/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>/subnets/snet-container-apps"
private_endpoint_subnet_id              = "/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Network/virtualNetworks/<VNET>/subnets/snet-private-endpoints"
```

The outputs include the Container Apps environment ID, both subnet IDs in private mode, and the two Private DNS zone IDs. These make the runtime path explicit for post-deployment checks without exposing credentials.

## Teardown

### Bicep

```bash
# Remove resource locks first if deploying to prod
az lock delete --name protect-kv \
  --resource-group <RG> \
  --resource-type Microsoft.KeyVault/vaults \
  --resource-name kv-<APP_NAME>-<ENV>
az lock delete --name protect-sql \
  --resource-group <RG> \
  --resource-type Microsoft.Sql/servers \
  --resource-name sql-<APP_NAME>-<ENV>

az group delete --name <RG> --yes
```

### Terraform

```bash
cd examples/saas-startup/terraform
terraform destroy
```
