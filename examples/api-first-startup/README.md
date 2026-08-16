# Example: API-First Startup

A developer-facing API product running on Azure App Service with API Management, Cosmos DB, and Application Insights.

## Status and execution boundary

The Bicep and Terraform examples are direct operator IaC, not Phase 6 agent-approved workload deployments. Current-main
evidence covers Bicep build/lint plus Terraform format/lint/validation in hosted CI; it does not include example-specific
Terraform behavioral tests or a retained live deployment, application-health, or recovery record for this example.

## Architecture

```
Internet
    │
Azure API Management (Consumption tier)
    ├── Rate limiting, API keys, developer portal
    │
Azure App Service (Linux, P1v3)
    ├── app-api-v1          (production API)
    └── app-api-v1-staging  (deployment slot)
    │
    ├── Azure Cosmos DB     (NoSQL, multi-region ready)
    ├── Azure Cache for Redis (response caching)
    ├── Application Insights (APM, distributed tracing)
    └── Azure Key Vault
```

## Why This Stack

| Choice | Rationale |
|---|---|
| App Service over Container Apps | Simpler ops for a pure API workload. Deployment slots for zero-downtime deploys. Built-in autoscale. |
| API Management (Consumption) | Pay-per-call. Built-in rate limiting, API key management, and developer portal. No idle cost. |
| Cosmos DB over SQL | Schema flexibility for an evolving API. Global distribution when you expand. Serverless tier for dev. |
| Application Insights | Deep APM for API latency tracking. Distributed tracing. Dependency mapping. Smart detection for anomalies. |

## Estimated Monthly Cost

| Resource | SKU | Est. Cost |
|---|---|---|
| App Service | P1v3 (1yr RI) | $53 |
| APIM Consumption | ~500k calls/month | $17 |
| Cosmos DB | Serverless (dev) / 400 RU/s autoscale (prod) | $25-200 |
| Redis | Standard C1 (prod) / Basic C0 (nonprod) | $54 / $16 |
| Application Insights | ~5GB/month | $12 |
| Key Vault | Standard | $1-5 |
| **Total** | | **~$163-345/month** |

## Key Decisions

### API Versioning

Use URL path versioning (`/v1/`, `/v2/`). It's the most visible and debuggable pattern. API Management handles routing different versions to different backends.

### Rate Limiting

APIM Consumption tier includes built-in rate limiting policies:
```xml
<rate-limit calls="100" renewal-period="60" />
<quota calls="10000" renewal-period="86400" />
```

Tier your API plans:
- **Free:** 100 calls/minute, 1,000/day
- **Pro:** 1,000 calls/minute, 100,000/day
- **Enterprise:** Custom limits

### Database Strategy

- **Dev/Staging:** Cosmos DB Serverless (pay per request, $0 when idle)
- **Prod:** Cosmos DB Autoscale (400-4000 RU/s) — scales with traffic, caps cost
- **Partition key:** Choose based on your most common query pattern (usually `tenantId` or `userId`)

### Zero-Downtime Deployments

Use App Service deployment slots:
1. Deploy new version to staging slot
2. Run health checks / smoke tests against staging
3. Swap staging ↔ production (instant, zero-downtime)
4. If issues, swap back (instant rollback)

### Monitoring

Application Insights gives you:
- **Live Metrics:** Real-time request rate, failures, response time
- **Application Map:** Visual dependency graph (API → DB → Cache)
- **Failures:** Automatic exception grouping and impact analysis
- **Performance:** P50/P95/P99 response times per endpoint
- **Availability tests:** Synthetic pings from global locations

## Deploy

### Prerequisites

- Azure CLI >= 2.53.0 with Bicep CLI (or Terraform >= 1.5.0)
- An existing resource group (you must create this — the landing zone does not create application resource groups)
- APIM publisher email and name for API Management configuration

### Bicep

```bash
cd examples/api-first-startup

# Edit the parameter file with your values
cp main.bicepparam main.local.bicepparam
# Update appName, apimPublisherEmail, apimPublisherName, etc.

az deployment group create \
  --resource-group rg-mycompany-prod-app \
  --template-file main.bicep \
  --parameters main.local.bicepparam
```

### Terraform

```bash
cd examples/api-first-startup/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

### Post-Deploy

1. Access your API:
   ```bash
   curl https://app-<APP_NAME>-api-<ENV>.azurewebsites.net/health
   ```
2. Configure APIM policies (rate limiting, API keys) in the Azure Portal under API Management > APIs
3. Deploy your application code:
   ```bash
   az webapp deploy --resource-group <RG> --name app-<APP_NAME>-api-<ENV> --src-path <YOUR_ZIP>
   ```
4. Test the staging slot (prod only):
   ```bash
   curl https://app-<APP_NAME>-api-<ENV>-staging.azurewebsites.net/health
   ```

## Teardown

To destroy all resources created by this example:

### Bicep

```bash
# Remove resource locks first if deploying to prod
az lock delete --name protect-kv \
  --resource-group rg-mycompany-prod-app \
  --resource-type Microsoft.KeyVault/vaults \
  --resource-name kv-<APP_NAME>-<ENV>

az group delete --name rg-mycompany-prod-app --yes --no-wait
```

### Terraform

```bash
cd examples/api-first-startup/terraform
terraform destroy
```

> **Note:** Cosmos DB accounts with `enablePurgeProtection` may remain in a soft-deleted state. API Management in Consumption tier may take a few minutes to fully deprovision.
