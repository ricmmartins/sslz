---
title: Cost Management
nav_order: 5
---

# Cost Management

## Budget Alerts

Set these on both subscriptions immediately. Budget alerts are free and take 5 minutes to configure.

### Thresholds

| Threshold | Who Gets Notified | Action |
|---|---|---|
| 50% of monthly budget | Platform team / SRE | Awareness. Check if spend is tracking normally. |
| 80% of monthly budget | Platform team + CTO | Review. Are there unexpected resources? Runaway scaling? |
| 100% of monthly budget | Platform team + CTO + Finance | Investigate immediately. |

### Setting Your Initial Budget

If you don't know your expected spend, set the budget at **2x your current monthly burn**. You'll get a 50% alert when you hit your actual expected spend, which is a good sanity check. Adjust after 2-3 months of data.

## Tagging Strategy

### Required Tags

Enforced via Azure Policy (deny mode):

| Tag | Values | Purpose |
|---|---|---|
| `environment` | `prod`, `dev`, `staging`, `qa`, `sandbox` | Cost allocation, lifecycle management |
| `team` | Team name / cost center | Who owns this, who pays for this |

### Optional Tags (Recommended)

| Tag | Purpose |
|---|---|
| `project` | Which product/feature this supports |
| `created-by` | CI/CD pipeline URL or person (for debugging) |
| `auto-shutdown` | `true` — for non-prod VMs that should shut down at night |

### Tag Inheritance

Azure Policy can auto-inherit tags from resource groups to child resources. Deploy the built-in policy `Inherit a tag from the resource group` for `environment` and `team`. This way you only need to tag the resource group, and resources inside automatically get tagged.

## Common Startup Cost Mistakes

### 1. Forgotten Dev Resources

**The problem:** Someone spins up a `Standard_D4s_v5` VM to test something. Three weeks later it's still running. Multiply by 5 engineers.

**The fix:**
- Set auto-shutdown on all non-prod VMs (7 PM local time, no auto-start)
- Review Azure Advisor cost recommendations weekly (it flags idle resources)
- Deploy a policy that requires the `auto-shutdown` tag on VMs in non-prod

```bicep
resource autoShutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = {
  name: 'shutdown-computevm-${vm.name}'
  location: location
  properties: {
    status: 'Enabled'
    taskType: 'ComputeVmShutdownTask'
    dailyRecurrence: { time: '1900' }
    timeZoneId: 'Eastern Standard Time'
    targetResourceId: vm.id
  }
}
```

### 2. Over-Provisioned Databases

**The problem:** "Let's start with S3 to be safe" turns into $600/month for a database handling 10 requests/minute.

**The fix:**
- Start with the smallest tier. Always.
- Azure SQL: Basic ($5/month) or S0 ($15/month) for dev. S1 or elastic pool for prod.
- Cosmos DB: Serverless for dev (pay per request). Autoscale provisioned for prod.
- Azure Database for PostgreSQL: Burstable B1ms ($13/month) for dev. General Purpose for prod.
- Scale up is instant. Scale down requires no downtime for most services.

### 3. Not Using Reserved Instances

**The problem:** Paying on-demand prices for workloads that have been running for 6 months.

**The fix:**
- After a workload runs for 3+ months and isn't going away, buy a **1-year reservation**
- Typical savings: 30-40% on compute (VMs, AKS nodes, App Service plans)
- Start with 1-year commitments only — don't lock into 3 years at your stage
- Azure Advisor shows RI recommendations based on your actual usage

| Resource | On-Demand (est.) | 1-Year RI (est.) | Savings |
|---|---|---|---|
| D4s_v5 VM | ~$140/month | ~$90/month | 36% |
| App Service P1v3 | ~$81/month | ~$53/month | 35% |
| Azure SQL S3 | ~$150/month | ~$100/month | 33% |

### 4. Premium Storage Where Standard Works

**The problem:** All VMs provisioned with Premium SSD because "it's the default."

**The fix:**
- Non-prod: Standard SSD (E-series disks). 1/3 the cost of Premium.
- Prod with low IOPS: Standard SSD is often sufficient.
- Prod with high IOPS: Premium SSD or Ultra Disk.
- Managed disks are billed whether the VM is running or not — right-size them.

### 5. Ignoring Spot VMs

**The problem:** Paying full price for fault-tolerant workloads.

**The fix:**
- CI/CD agents: Run on Spot VMs (up to 90% discount). If evicted, the job retries.
- Batch processing: Spot VMs or Spot node pools in AKS.
- Dev/test environments: Spot VMs with `Deallocate` eviction policy.

Setting `maxPrice: -1` (or `spot_max_price = -1` in Terraform) means "pay up to the current on-demand price." Azure will **only** evict the VM when it needs the capacity back for on-demand customers — never because of price fluctuations. This is the recommended default for most Spot workloads because it maximizes uptime while still getting the Spot discount (typically 60-90% off).

```bicep
resource vmss 'Microsoft.Compute/virtualMachineScaleSets@2024-03-01' = {
  properties: {
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Deallocate'
      billingProfile: {
        maxPrice: -1  // pay up to on-demand price, evict only when Azure needs capacity
      }
    }
  }
}
```

If you want to cap the price (e.g., only run when the Spot price is below $0.05/hr), set `maxPrice` to that value instead. The VM will be evicted if the Spot price exceeds your cap **or** if Azure needs the capacity.

### 6. Not Using Azure Dev/Test Pricing

**The problem:** Paying full price for non-prod Windows VMs and licensed services.

**The fix:**
- Create your non-prod subscription as a Dev/Test subscription (or convert it)
- Benefits: No Windows OS license charges on VMs, discounted rates on several services
- Requires Visual Studio subscribers (most startups with MSDN/MPN have these)

## Automated Cost Reporting

Budget alerts catch spikes, but you also need regular visibility into where money goes. Azure Cost Management provides built-in scheduled exports — no extra tooling required.

### Set Up Cost Exports

In the Azure Portal: **Cost Management** → **Exports** → **Add**

| Setting | Recommended Value |
|---|---|
| Export type | Actual cost (amortized) |
| Frequency | Weekly (every Monday) |
| Storage account | A dedicated `stcostexports<company>` in the prod subscription |
| Container | `cost-exports` |
| Format | CSV |

Or via CLI:

```bash
# Create a weekly cost export for the subscription
az costmanagement export create \
  --name "weekly-cost-export" \
  --scope "subscriptions/<SUBSCRIPTION_ID>" \
  --type "ActualCost" \
  --timeframe "MonthToDate" \
  --storage-account-id "/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.Storage/storageAccounts/<SA>" \
  --storage-container "cost-exports" \
  --schedule-recurrence "Weekly" \
  --schedule-status "Active" \
  --recurrence-period-from "$(date -u +%Y-%m-%dT00:00:00Z)" \
  --recurrence-period-to "2030-01-01T00:00:00Z"
```

### What to Do With the Data

- **Small team (< 10 engineers):** Weekly portal review is enough. Set up exports as a backup audit trail.
- **Growing team (10-50):** Import exports into Power BI with the [Cost Management connector](https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-connect-azure-cost-management) for team-level dashboards.
- **Enterprise path:** Feed exports into a FinOps tool (e.g., Azure FinOps toolkit, or third-party like Infracost).

### Cost Anomaly Alerts

Azure Cost Management also supports **anomaly detection** (preview). Enable it to get automatic alerts when daily spend deviates significantly from the baseline — catches issues that fixed-threshold budget alerts miss.

**Cost Management** → **Cost alerts** → **Anomaly alerts** → Enable for each subscription.

## Cost Monitoring Routine

### Weekly (5 minutes)

1. Open **Cost Management** in Azure Portal
2. Check cost trend — is it flat, growing, or spiking?
3. Review **Azure Advisor** cost recommendations — usually 2-3 quick wins
4. Check for resources with no tags (use Resource Graph: `resources | where tags == {}`)

### Monthly (30 minutes)

1. Review cost by resource group and tag
2. Compare actual vs budget
3. Check RI utilization (if you have reservations)
4. Review and resize over-provisioned resources
5. Delete old snapshots, unattached disks, unused public IPs

### Useful Azure Resource Graph Queries

```kusto
// Resources with no environment tag
resources
| where isnull(tags.environment) or tags.environment == ""
| project name, type, resourceGroup, subscriptionId

// Unattached managed disks (wasting money)
resources
| where type == "microsoft.compute/disks"
| where properties.diskState == "Unattached"
| project name, resourceGroup, sku.name, properties.diskSizeGB

// Public IPs not attached to anything
resources
| where type == "microsoft.network/publicipaddresses"
| where isnull(properties.ipConfiguration)
| project name, resourceGroup
```

## Azure Savings Plans vs Reserved Instances

| Feature | Reserved Instances | Savings Plans |
|---|---|---|
| Commitment | Specific VM size + region | $/hour spend across compute |
| Flexibility | Limited (can exchange) | High (applies to any VM, App Service, Container Apps) |
| Savings | 30-40% (1yr), 50-60% (3yr) | 15-25% (1yr), 30-45% (3yr) |
| Best for startups | Stable, predictable workloads | Variable workloads, frequent changes |

**Recommendation:** Start with Savings Plans for flexibility. Switch to RIs for workloads that are very stable (same VM size for 6+ months).

## See Also

- [Architecture Decisions](architecture.md) — Why two subscriptions, budget design
- [Troubleshooting](troubleshooting.md) — Budget start date format errors
- [Graduation Guide](graduation-guide.md) — When to add cost management tooling
